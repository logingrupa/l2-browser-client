import argparse
from collections import Counter
import json
import re
from pathlib import Path

from actors.actor_sound_bindings import actor_sound_reference_counts, skill_actor_row
from actors.actor_sound_conversion import ActorSoundConversionRun, combat_audio_manifest_outputs
from actors.character_census import CHARACTER_CENSUS_RELATIVE_PATH, CHARACTER_CENSUS_SCHEMA_VERSION, PENDING_STATUS
from actors.character_requests import GAP_STATUS
from actors.combat_role_routes import (COMBAT_ROLE_ROUTE_PROOF, bind_combat_role_routes, combat_route_config_manifest)
from actors.skill_binding_table import DecodedSkillTables
from native_assets_lib.footstep_config import decode_config
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import read_pinned_file, read_store_catalog, replace_file, require_file_pin
from reference_client_guard import ReferenceClientLockError

ACTOR_SOUND_CENSUS_RELATIVE_PATH = 'docs/parts/audio/actor-sound-census.json'
CHARACTER_CENSUS_ABSENT_REASON = 'character-census-absent'
CHARACTER_PROFILE_PENDING_REASON = 'character-profile-pending'
CHARACTER_SOUND_BUNDLE_NOT_BUILT_REASON = 'character-sound-bundle-not-built'
ALAUDIO_CONFIG_RELATIVE_PATH = 'system/ALAudio.int'
ROUTE_CENSUS_TABLES = ('chargrp', 'npcgrp', 'armorgrp', 'weapongrp', 'skillsoundgrp')
SKILL_COMPONENT_ID = re.compile(r'^interlude:skill:(?P<id>[0-9]{1,9}):level:(?P<level>[1-9][0-9]{0,3}):native-description-action$')
CONFIG_SECTION_HEADER = re.compile(r'^\[(?P<section>[A-Za-z_][A-Za-z_0-9]*)\]$')
CONFIG_ASSIGNMENT = re.compile(r'^\s*(?P<key>[A-Za-z_][A-Za-z_0-9]*)\s*=')
BUNDLE_KIND_ORDER = ('npc', 'skill')
ACTOR_SOUND_KEY = re.compile(r'^(?:npc:[0-9]{1,9}|skill:[0-9]{1,9}:[1-9][0-9]{0,3})$')


def npc_profile_rows(store_root, catalog):
    profiles = {}
    for record in catalog.get('npcProfiles', []):
        payload = read_pinned_file(store_root, require_file_pin(record, 'manifest', 'manifestSha256', 'manifestBytes',
                                                                f'npc profile manifest of {record["id"]}'))
        for profile in json.loads(payload)['profiles']:
            profiles[f'npc:{profile["npcId"]}'] = profile
    return profiles


def npc_actor_row(profile):
    return {'table': 'npcgrp', 'kind': 'actor', 'label': f'{profile["name"]} (npcgrp npc_id {profile["npcId"]})',
            'catalogId': profile['modelCatalogId'], 'sourceObject': profile['mesh'], 'match': [{'pointer': '/npc_id', 'value': profile['npcId']}]}


def skill_bundle_keys(catalog):
    keys = set()
    for record in catalog.get('effectComponents', []):
        match = SKILL_COMPONENT_ID.fullmatch(record['id'])
        if match:
            keys.add(f'skill:{int(match["id"])}:{int(match["level"])}')
    return keys


def character_census_skipped_reason(census_row):
    if census_row['profile'] == GAP_STATUS:
        return next(gap['reason'] for gap in census_row['gaps'] if gap['field'] == 'profile')
    if census_row['profile'] == PENDING_STATUS:
        return CHARACTER_PROFILE_PENDING_REASON
    return CHARACTER_SOUND_BUNDLE_NOT_BUILT_REASON


def skipped_character_bundles(project_root):
    census_path = Path(project_root) / CHARACTER_CENSUS_RELATIVE_PATH
    if not census_path.is_file():
        return {'count': 0, 'skippedReason': CHARACTER_CENSUS_ABSENT_REASON, 'skippedByReason': {}}
    census = json.loads(census_path.read_bytes())
    if not (isinstance(census, dict) and census.get('schemaVersion') == CHARACTER_CENSUS_SCHEMA_VERSION and isinstance(census.get('rows'), list)):
        raise ValueError(f'{CHARACTER_CENSUS_RELATIVE_PATH} is not a character census v{CHARACTER_CENSUS_SCHEMA_VERSION} with rows')
    skipped = Counter(character_census_skipped_reason(row) for row in census['rows'] if not row['padding'])
    return {'count': 0, 'skippedReason': None, 'skippedByReason': dict(sorted(skipped.items()))}


def bundle_sort_key(bundle_key):
    kind, rest = bundle_key.split(':', 1)
    return BUNDLE_KIND_ORDER.index(kind), [int(part) for part in rest.split(':')]


class ActorSoundBundles:
    def __init__(self, project_root, store_root):
        catalog, _ = read_store_catalog(store_root)
        self.npc_profiles = npc_profile_rows(store_root, catalog)
        self.skill_keys = skill_bundle_keys(catalog)
        self.skipped_characters = skipped_character_bundles(project_root)
        self.keys = sorted([*self.npc_profiles, *self.skill_keys], key=bundle_sort_key)
        self.skill_tables, self.skill_bindings_by_key = None, None

    def capacity(self):
        return max(1, len(self.keys))

    def skill_binding(self, run, bundle_key):
        if self.skill_tables is None:
            self.skill_tables = DecodedSkillTables(run.project_root, run.client_access.root, run.decode_table)
            self.skill_bindings_by_key = {row['key']: row for row in self.skill_tables.binding_rows}
        return self.skill_bindings_by_key[bundle_key]

    def sound_table_identity(self):
        return {'path': self.skill_tables.sound_table['source'], 'sha256': self.skill_tables.sound_table['sourceSha256']}

    def actor_rows(self, run, bundle_key):
        if bundle_key in self.npc_profiles:
            return [npc_actor_row(self.npc_profiles[bundle_key])]
        if bundle_key not in self.skill_keys:
            raise ValueError(f'{bundle_key} is not an actor bundle of the actors lane catalog')
        actor_row = skill_actor_row(self.skill_binding(run, bundle_key), self.skill_tables.sound_rows)
        return None if actor_row is None else [actor_row]

    def is_sealed(self, run, bundle_key):
        actor_rows = self.actor_rows(run, bundle_key)
        if actor_rows is None:
            return run.is_no_sound_row_bundle_sealed(self.skill_binding(run, bundle_key), self.sound_table_identity())
        return run.is_bundle_sealed(bundle_key, actor_rows)

    def convert(self, run, bundle_key):
        actor_rows = self.actor_rows(run, bundle_key)
        if actor_rows is None:
            return run.convert_no_sound_row_bundle(self.skill_binding(run, bundle_key), self.sound_table_identity(), self.capacity())
        return run.convert_bundle(bundle_key, actor_rows, self.capacity())


def run_actor_sound_slice(run, bundles, limit, preflight):
    outcomes = []
    for bundle_key in bundles.keys:
        if len(outcomes) == limit:
            break
        if bundles.is_sealed(run, bundle_key):
            continue
        preflight()
        outcomes.append(bundles.convert(run, bundle_key))
    return outcomes


def decoded_config_keys(decoded):
    keys, section = [], None
    for raw in decoded.decode('ascii', errors='strict').splitlines():
        header = CONFIG_SECTION_HEADER.fullmatch(raw.strip())
        if header:
            section = header['section']
            continue
        assignment = CONFIG_ASSIGNMENT.match(raw)
        if section is not None and assignment and not raw.lstrip().startswith(';'):
            keys.append(f'{section}.{assignment["key"]}')
    return keys


def config_routes(run):
    try:
        path = run.client_access.require_equal_file(ALAUDIO_CONFIG_RELATIVE_PATH)
    except ReferenceClientLockError as error:
        return {'routes': {}, 'unresolved': {role: {'reason': f'combat-role-route-unresolved:alaudio/{role}', 'detail': str(error)}
                                             for role in ('critical', 'soulshot')}}
    original = path.read_bytes()
    decoded, _ = decode_config(original)
    return bind_combat_role_routes(combat_route_config_manifest(sha256_hex_digest(original), decoded_config_keys(decoded)), run.route_proof)


def route_census_entries(binding):
    entries = {role: {'status': 'bound', 'fieldOrdinal': route['fieldOrdinal'], 'fieldName': route['fieldName'], 'reason': None,
                      'anchors': route['routeProof']['anchors']} for role, route in binding['routes'].items()}
    entries.update({role: {'status': 'unresolved', 'fieldOrdinal': None, 'fieldName': None, 'reason': entry['reason'], 'detail': entry['detail']}
                    for role, entry in binding['unresolved'].items()})
    return entries


def summed_counts(counts):
    total = {'exactIdentity': 0, 'uniquePackageLeafCandidate': 0, 'unresolved': 0, 'empty': 0}
    for count in counts:
        for name in total:
            total[name] += count[name]
    return total


def actor_sound_census(run, bundles):
    routes = {table: route_census_entries(run.routes(table)) for table in ROUTE_CENSUS_TABLES}
    routes['alaudio'] = route_census_entries(config_routes(run))
    per_table, sealed = {}, []
    for receipt in run.bundle_ledger.sealed_receipts():
        sealed.append(receipt['unitKey'])
        manifests = combat_audio_manifest_outputs(receipt)
        manifest = json.loads(run.bundle_ledger.lane_output_path(manifests[0]['path']).read_bytes()) if manifests else None
        for table in sorted({row['table'] for row in receipt['config']['actorRows']}):
            per_table.setdefault(table, []).append(actor_sound_reference_counts(
                {'selections': [row for row in manifest['selections'] if row['table'] == table]} if manifest else None))
    return {'schemaVersion': 1, 'routeProof': {'path': COMBAT_ROLE_ROUTE_PROOF['path'],
                                               'sha256': run.route_proof['sha256'] if run.route_proof else None},
            'routes': routes,
            'bundles': {'npc': len(bundles.npc_profiles), 'skill': len(bundles.skill_keys),
                        'character': bundles.skipped_characters},
            'references': summed_counts(count for counts in per_table.values() for count in counts),
            'perTable': {table: summed_counts(counts) for table, counts in sorted(per_table.items())},
            'sealedBundles': sorted(sealed, key=bundle_sort_key)}


def write_actor_sound_census(run, bundles):
    census = actor_sound_census(run, bundles)
    path = Path(run.project_root) / ACTOR_SOUND_CENSUS_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    replace_file(path, canonical_json_bytes(census))
    return census


def actor_sound_key_argument(text):
    if not ACTOR_SOUND_KEY.fullmatch(text):
        raise argparse.ArgumentTypeError(f'--actor-sounds must be an actor bundle key matching {ACTOR_SOUND_KEY.pattern}: {text!r}')
    return text


def printed_actor_sound_outcome(outcome):
    return {key: outcome[key] for key in ('key', 'step', 'status', 'reason', 'cacheHit', 'bundleId', 'references')}


def run_actor_sound_conversion(project_root, client_access, converter, store_root, work_root, decode_table, bundle_key, limit, preflight):
    run = ActorSoundConversionRun(project_root, client_access, converter, store_root, work_root, decode_table)
    bundles = ActorSoundBundles(project_root, store_root)
    outcomes = run_actor_sound_slice(run, bundles, limit, preflight) if bundle_key is None else [bundles.convert(run, bundle_key)]
    for outcome in outcomes:
        print(json.dumps(printed_actor_sound_outcome(outcome), sort_keys=True), flush=True)
    census = write_actor_sound_census(run, bundles)
    print(json.dumps({'sealedBundles': len(census['sealedBundles']), 'references': census['references'],
                      'census': ACTOR_SOUND_CENSUS_RELATIVE_PATH}, sort_keys=True), flush=True)
    return outcomes
