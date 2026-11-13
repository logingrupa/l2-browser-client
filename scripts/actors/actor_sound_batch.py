import argparse
from collections import Counter
import json
import re
from pathlib import Path

from actors.actor_sound_bindings import (ACTOR_SOUND_STEP, NPC_NAMES_NO_SOUND_REASON, SKILL_SOUND_ROW_MATCH_AMBIGUOUS_REASON_PREFIX,
                                         SKILL_SOUND_ROW_NAMES_NO_SOUND_REASON, SKILL_SOUND_TABLE_NAME, actor_sound_bundle_id,
                                         actor_sound_reference_counts, skill_sound_row_actor_row, skill_sound_row_key)
from actors.actor_sound_conversion import (ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH, ActorSoundConversionRun, NoSoundBundle, bundle_store_state,
                                           combat_audio_manifest_outputs)
from actors.actor_unit_inventory import decoded_string_values
from actors.character_census import CHARACTER_CENSUS_RELATIVE_PATH, CHARACTER_CENSUS_SCHEMA_VERSION, PENDING_STATUS
from actors.character_requests import GAP_STATUS
from actors.combat_role_routes import (COMBAT_ROLE_ROUTE_PROOF, bind_combat_role_routes, combat_route_config_manifest)
from actors.npc_store_records import catalog_with_records_replaced, catalog_without_records
from actors.skill_unit_inventory import SKILL_SOUND_ROW_UNIT_KIND
from native_assets_lib.footstep_config import decode_config
from native_assets_lib.gltf import json_bytes
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import read_pinned_file, read_store_catalog, replace_file, require_file_pin, write_store
from native_store.gap_rows import gap_reason_list_versions, load_gap_reason_patterns, sorted_gap_rows, validate_gap_row
from reference_client_guard import ReferenceClientLockError

ACTOR_SOUND_CENSUS_RELATIVE_PATH = 'docs/parts/audio/actor-sound-census.json'
CHARACTER_CENSUS_ABSENT_REASON = 'character-census-absent'
CHARACTER_PROFILE_PENDING_REASON = 'character-profile-pending'
CHARACTER_SOUND_BUNDLE_NOT_BUILT_REASON = 'character-sound-bundle-not-built'
ALAUDIO_CONFIG_RELATIVE_PATH = 'system/ALAudio.int'
ROUTE_CENSUS_TABLES = ('chargrp', 'npcgrp', 'armorgrp', 'weapongrp', 'skillsoundgrp')
CONFIG_SECTION_HEADER = re.compile(r'^\[(?P<section>[A-Za-z_][A-Za-z_0-9]*)\]$')
CONFIG_ASSIGNMENT = re.compile(r'^\s*(?P<key>[A-Za-z_][A-Za-z_0-9]*)\s*=')
BUNDLE_KIND_ORDER = ('npc', SKILL_SOUND_ROW_UNIT_KIND)
ACTOR_SOUND_KEY = re.compile(rf'^(?:npc:[0-9]{{1,9}}|{SKILL_SOUND_ROW_UNIT_KIND}:[0-9]{{1,5}})$')


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


def write_bundle_catalog_records(store_root, converted_states, skipped_sealed_states, catalog_capacity):
    catalog, before = read_store_catalog(store_root)
    catalog_records_by_id = {record.get('id'): record for record in catalog.get('combatAudio', [])}
    replaced_records = [state.combat_audio_record for state in converted_states.values() if state.combat_audio_record is not None]
    replaced_records += [state.combat_audio_record for state in skipped_sealed_states.values() if state.combat_audio_record is not None
                         and catalog_records_by_id.get(state.combat_audio_record['id']) != state.combat_audio_record]
    removed_ids = {actor_sound_bundle_id(bundle_key) for bundle_key, state in converted_states.items() if state.combat_audio_record is None}
    removed_ids |= {actor_sound_bundle_id(bundle_key) for bundle_key, state in skipped_sealed_states.items()
                    if state.combat_audio_record is None and actor_sound_bundle_id(bundle_key) in catalog_records_by_id}
    synchronized_catalog = catalog_with_records_replaced(catalog_without_records(catalog, 'combatAudio', removed_ids), 'combatAudio',
                                                         replaced_records, catalog_capacity)
    if replaced_records:
        synchronized_catalog['combatAudio'] = sorted(synchronized_catalog['combatAudio'], key=lambda record: record['id'])
    if replaced_records or synchronized_catalog != catalog:
        write_store(store_root, {}, before, json_bytes(synchronized_catalog))


def write_bundle_gap_rows(lane_folder, lane_name, converted_states, skipped_sealed_states):
    path = lane_folder / ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH
    file_rows = json.loads(path.read_bytes())['rows'] if path.is_file() else []
    file_rows_by_key = {}
    for row in file_rows:
        file_rows_by_key.setdefault(row['key'], []).append(row)
    restored_states = {bundle_key: state for bundle_key, state in skipped_sealed_states.items()
                       if file_rows_by_key.get(bundle_key, []) != state.gap_rows}
    written_states = {**converted_states, **restored_states}
    if not written_states:
        return
    merged_rows = [row for row in file_rows if row['key'] not in written_states]
    merged_rows += [row for state in written_states.values() for row in state.gap_rows]
    reason_patterns = load_gap_reason_patterns()
    for row in merged_rows:
        validate_gap_row(row, reason_patterns)
    document = {'schemaVersion': 1, 'lane': lane_name, 'step': ACTOR_SOUND_STEP, 'reasonListVersions': gap_reason_list_versions(),
                'rows': sorted_gap_rows(merged_rows)}
    replace_file(path, canonical_json_bytes(document))


def skill_sound_row_match_identity(sound_row):
    return sound_row['skill_id'], sound_row['skill_level']


def skill_sound_row_no_sound_reason(sound_row, match_counts):
    match_count = match_counts[skill_sound_row_match_identity(sound_row)]
    if match_count > 1:
        return f'{SKILL_SOUND_ROW_MATCH_AMBIGUOUS_REASON_PREFIX}{match_count}'
    if not any(string for value in sound_row.values() for string in decoded_string_values(value)):
        return SKILL_SOUND_ROW_NAMES_NO_SOUND_REASON
    return None


class ActorSoundBundles:
    def __init__(self, project_root, store_root, skill_sound_rows):
        catalog, _ = read_store_catalog(store_root)
        self.npc_profiles = npc_profile_rows(store_root, catalog)
        self.skill_sound_rows = skill_sound_rows
        self.skill_sound_row_match_counts = Counter(skill_sound_row_match_identity(row) for row in skill_sound_rows)
        self.skill_sound_row_ordinals = {skill_sound_row_key(row_ordinal): row_ordinal for row_ordinal in range(len(skill_sound_rows))}
        self.skipped_characters = skipped_character_bundles(project_root)
        self.keys = sorted([*self.npc_profiles, *self.skill_sound_row_ordinals], key=bundle_sort_key)

    def capacity(self):
        return max(1, len(self.keys))

    def skill_sound_row_ordinal(self, bundle_key):
        if bundle_key not in self.skill_sound_row_ordinals:
            raise ValueError(f'{bundle_key} is neither an NPC of the actors lane catalog nor a decoded {SKILL_SOUND_TABLE_NAME} row')
        return self.skill_sound_row_ordinals[bundle_key]

    def actor_rows(self, run, bundle_key):
        if bundle_key in self.npc_profiles:
            return [npc_actor_row(self.npc_profiles[bundle_key])]
        row_ordinal = self.skill_sound_row_ordinal(bundle_key)
        return [skill_sound_row_actor_row(row_ordinal, self.skill_sound_rows[row_ordinal])]

    def no_sound_bundle(self, run, bundle_key):
        if bundle_key in self.npc_profiles:
            actor_row = npc_actor_row(self.npc_profiles[bundle_key])
            if not run.names_no_sound(actor_row):
                return None
            return NoSoundBundle(bundle_key, NPC_NAMES_NO_SOUND_REASON, run.table(actor_row['table'])['identity'],
                                 {'npcMatch': actor_row['match']})
        row_ordinal = self.skill_sound_row_ordinal(bundle_key)
        reason = skill_sound_row_no_sound_reason(self.skill_sound_rows[row_ordinal], self.skill_sound_row_match_counts)
        if reason is None:
            return None
        actor_row = skill_sound_row_actor_row(row_ordinal, self.skill_sound_rows[row_ordinal])
        return NoSoundBundle(bundle_key, reason, run.table(SKILL_SOUND_TABLE_NAME)['identity'],
                             {'skillSoundRow': {'rowOrdinal': row_ordinal, 'match': actor_row['match']}})

    def sealed_store_state(self, run, bundle_key):
        no_sound_bundle = self.no_sound_bundle(run, bundle_key)
        if no_sound_bundle is not None:
            receipt = run.sealed_no_sound_bundle_receipt(no_sound_bundle)
        else:
            receipt = run.sealed_bundle_receipt(bundle_key, self.actor_rows(run, bundle_key))
        return None if receipt is None else bundle_store_state(bundle_key, receipt)

    def convert(self, run, bundle_key):
        no_sound_bundle = self.no_sound_bundle(run, bundle_key)
        if no_sound_bundle is not None:
            return run.convert_no_sound_bundle(no_sound_bundle)
        return run.convert_bundle(bundle_key, self.actor_rows(run, bundle_key))

    def synchronize_store(self, run, converted_states, skipped_sealed_states):
        write_bundle_catalog_records(run.store_root, converted_states, skipped_sealed_states, self.capacity())
        write_bundle_gap_rows(run.lane_folder, run.bundle_ledger.lane_name, converted_states, skipped_sealed_states)


def run_actor_sound_slice(run, bundles, limit, preflight):
    outcomes, converted_states, skipped_sealed_states = [], {}, {}
    try:
        for bundle_key in bundles.keys:
            if len(outcomes) == limit:
                break
            sealed_state = bundles.sealed_store_state(run, bundle_key)
            if sealed_state is not None:
                skipped_sealed_states[bundle_key] = sealed_state
                continue
            preflight()
            outcome, converted_states[bundle_key] = bundles.convert(run, bundle_key)
            outcomes.append(outcome)
    finally:
        bundles.synchronize_store(run, converted_states, skipped_sealed_states)
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
    return bind_combat_role_routes(combat_route_config_manifest(sha256_hex_digest(original), decoded_config_keys(decoded)), run.route_proof,
                                   run.route_recipe)


def bound_route_census_entry(route):
    if isinstance(route, list):
        return {'status': 'bound', 'members': [{'member': record['member'], 'fieldOrdinal': record['fieldOrdinal'], 'fieldName': record['fieldName']}
                                               for record in route], 'reason': None, 'anchors': route[0]['routeProof']['anchors']}
    return {'status': 'bound', 'fieldOrdinal': route['fieldOrdinal'], 'fieldName': route['fieldName'], 'reason': None,
            'anchors': route['routeProof']['anchors']}


def route_census_entries(binding):
    entries = {role: bound_route_census_entry(route) for role, route in binding['routes'].items()}
    entries.update({role: {'status': 'unresolved', 'fieldOrdinal': None, 'fieldName': None, 'reason': entry['reason'], 'detail': entry['detail']}
                    for role, entry in binding['unresolved'].items()})
    return entries


def summed_counts(counts):
    total = {'exactIdentity': 0, 'uniquePackageLeafCandidate': 0, 'unresolved': 0, 'empty': 0}
    for count in counts:
        for name in total:
            total[name] += count[name]
    return total


def caster_indexed_census_entries(binding):
    return {role: [{key: record[key] for key in ('meshType', 'meshClass', 'fieldOrdinal', 'fieldName')} for record in records]
            for role, records in binding['casterIndexedRoutes'].items()}


def actor_sound_census(run, bundles):
    bindings = {table: run.routes(table) for table in ROUTE_CENSUS_TABLES}
    routes = {table: route_census_entries(binding) for table, binding in bindings.items()}
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
            'routeRecipe': {'path': run.route_recipe['path'], 'sha256': run.route_recipe['sha256']},
            'routes': routes,
            'casterIndexedRoutes': {table: caster_indexed_census_entries(binding) for table, binding in bindings.items()
                                    if 'casterIndexedRoutes' in binding},
            'unroutedFields': {table: binding['unroutedFields'] for table, binding in bindings.items() if 'unroutedFields' in binding},
            'bundles': {'npc': len(bundles.npc_profiles), 'skillSoundRow': len(bundles.skill_sound_row_ordinals),
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
    bundles = ActorSoundBundles(project_root, store_root, run.table(SKILL_SOUND_TABLE_NAME)['rows'])
    if bundle_key is None:
        outcomes = run_actor_sound_slice(run, bundles, limit, preflight)
    else:
        outcome, store_state = bundles.convert(run, bundle_key)
        bundles.synchronize_store(run, {bundle_key: store_state}, {})
        outcomes = [outcome]
    for outcome in outcomes:
        print(json.dumps(printed_actor_sound_outcome(outcome), sort_keys=True), flush=True)
    census = write_actor_sound_census(run, bundles)
    print(json.dumps({'sealedBundles': len(census['sealedBundles']), 'references': census['references'],
                      'census': ACTOR_SOUND_CENSUS_RELATIVE_PATH}, sort_keys=True), flush=True)
    return outcomes
