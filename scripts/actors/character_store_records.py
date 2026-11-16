import json
import math
import re

from actors.npc_store_records import NATIVE_RESOURCE_PREFIX, catalog_with_records_replaced, native_resource_store_path, write_catalog_without_record
from native_assets_lib.gltf import json_bytes
from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_store.catalog_writer import add_store_file, read_store_catalog, write_store

PLAYER_PROFILE_ID_PATTERN = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
PLAYER_CATALOG_ID_PATTERN = re.compile(r'[a-z0-9][a-z0-9:-]{0,95}')
QUALIFIED_OBJECT_PATTERN = re.compile(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+')
SOCIAL_ANIMATION_FIELD = 'PcSocialAnimName'
PLAYER_ALIAS_FIELDS = (
    ('idle', 'WaitAnimName'), ('walk', 'WalkAnimName'), ('run', 'RunAnimName'), ('turn', 'TurnAnimName'),
    ('atkWait', 'AtkWaitAnimName'), ('attack', 'Atk01AnimName'), ('atk02', 'Atk02AnimName'), ('atk03', 'Atk03AnimName'),
    ('shieldAtk', 'ShieldAtkAnimName'), ('castShort', 'CastShortAnimName'), ('castMid', 'CastMidAnimName'),
    ('castLong', 'CastLongAnimName'), ('castEnd', 'CastEndAnimName'), ('magicShot', 'MagicShotAnimName'),
    ('magicThrow', 'MagicThrowAnimName'), ('magicNoTarget', 'MagicNoTargetAnimName'), ('sit', 'SitAnimName'),
    ('sitWait', 'SitWaitAnimName'), ('stand', 'StandAnimName'), ('chairSit', 'ChairSitAnimName'), ('chairWait', 'ChairWaitAnimName'),
    ('chairStand', 'ChairStandAnimName'), ('pickup', 'PicItemAnimName'), ('death', 'DeathAnimName'), ('deathWait', 'DeathWaitAnimName'),
    ('deathStand', 'DeathStandAnimName'), ('damage', 'DamageAnimName'), ('damageFly', 'DamageFlyAnimName'), ('fall', 'FallAnimName'),
    ('swim', 'SwimAnimName'), ('swimWait', 'SwimWaitAnimName'), ('swimAtkWait', 'SwimAtkWaitAnimName'), ('swimDeath', 'SwimDeathAnimName'),
    ('swimDeathWait', 'SwimDeathWaitAnimName'),
    *((f'social{index}', SOCIAL_ANIMATION_FIELD) for index in range(2, 14)))
PLAYER_ALIASES = tuple(alias for alias, _ in PLAYER_ALIAS_FIELDS)
REQUIRED_ALIASES = ('idle', 'run', 'attack', 'death')
BOUND_STATUSES = frozenset({'exact', 'case-only'})
UNBOUND_STATUSES = frozenset({'no-family-value', 'no-native-field', 'missing-clip', 'conflict-unresolved', 'ambiguous', 'unsupported-syntax'})
EVIDENCE_FIELDS = {'generator', 'report', 'reportSha256', 'family', 'familySource', 'familySourceSha256', 'rows'}
EVIDENCE_ROW_FIELDS = {'alias', 'key', 'status', 'reference', 'line', 'selectionPath', 'reason'}
PLAYER_PROFILE_FIELDS = {'id', 'name', 'catalogId', 'assetId', 'sourceObject', 'sourceSha256', 'clips', 'forwardAxis', 'actorScale',
                         'collisionRadius', 'collisionHeight', 'sourceUnitsPerMetre', 'upperItems', 'sourceEvidence', 'limitations'}
PLAYER_PROFILE_OPTIONAL_FIELDS = {'aliasEvidence', 'chargrpIndex'}
PLAYER_PROFILE_PACK_KIND = 'native-player-profiles'
PLAYER_PROFILE_PACK_SCHEMA_VERSION = 1
PLAYER_PROFILE_STORE_FOLDER = 'player-profiles'
PLAYER_PROFILE_MANIFEST_FILE_NAME = 'manifest.json'
PLAYER_PROFILES_SLICE = 'playerProfiles'
CHARACTER_PLAYER_PROFILES_RECORD_ID = 'character-player-profiles'
PLAYER_PROFILE_RECORD_CAPACITY = 16
PLAYER_PROFILE_PACK_CAPACITY = 128
MAXIMUM_PLAYER_MANIFEST_BYTES = 2_000_000
MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1


def is_browser_string_within_utf16_units(value, maximum=512):
    return isinstance(value, str) and 0 < len(value.encode('utf-16-le')) // 2 <= maximum


def alias_evidence_shape(evidence, clips):
    require_condition(isinstance(evidence, dict) and set(evidence) == EVIDENCE_FIELDS, 'Invalid player alias evidence fields')
    require_condition(all(is_browser_string_within_utf16_units(evidence[name]) for name in ('generator', 'report', 'family', 'familySource')) and
                      all(isinstance(evidence[name], str) and SHA256_HEX_PATTERN.fullmatch(evidence[name]) for name in ('reportSha256', 'familySourceSha256')),
                      'Invalid player alias evidence source')
    rows = evidence['rows']
    require_condition(isinstance(rows, list) and 0 < len(rows) <= 64, 'Invalid player alias evidence rows')
    seen = set()
    for row in rows:
        require_condition(isinstance(row, dict) and {'alias', 'key', 'status'} <= set(row) <= EVIDENCE_ROW_FIELDS, 'Invalid player alias evidence row fields')
        alias, status = row['alias'], row['status']
        require_condition(alias in PLAYER_ALIASES and alias not in seen, 'Unknown/duplicate player alias evidence: ' + str(alias))
        seen.add(alias)
        require_condition(status in BOUND_STATUSES or status in UNBOUND_STATUSES, 'Unknown player alias status: ' + str(status))
        require_condition(is_browser_string_within_utf16_units(row['key'], 128) and
                          all(is_browser_string_within_utf16_units(row[name]) for name in ('reference', 'selectionPath', 'reason') if name in row),
                          'Invalid player alias evidence strings')
        require_condition('line' not in row or (type(row['line']) is int and 0 < row['line'] <= 2**31 - 1), 'Invalid player alias evidence line')
        require_condition((alias in clips) if status in BOUND_STATUSES else (alias not in clips and 'reason' in row),
                          'Player alias evidence disagrees with its clip: ' + alias)
    require_condition(set(clips) <= seen, 'Player clip aliases lack evidence rows')


def require_upper_items_shape(items):
    require_condition(isinstance(items, list) and len(items) <= 64, 'Invalid upper-item bindings')
    item_ids = set()
    for item in items:
        require_condition(isinstance(item, dict) and set(item) == {'itemId', 'catalogId', 'sourceObject', 'sourceSha256'}, 'Invalid upper-item fields')
        require_condition(type(item['itemId']) is int and 0 < item['itemId'] <= 2**31 - 1 and item['itemId'] not in item_ids,
                          'Invalid/duplicate upper-item identity')
        item_ids.add(item['itemId'])
        require_condition(isinstance(item['catalogId'], str) and PLAYER_CATALOG_ID_PATTERN.fullmatch(item['catalogId']) and
                          is_browser_string_within_utf16_units(item['sourceObject']) and QUALIFIED_OBJECT_PATTERN.fullmatch(item['sourceObject']) and
                          isinstance(item['sourceSha256'], str) and SHA256_HEX_PATTERN.fullmatch(item['sourceSha256']), 'Invalid upper-item source binding')


def profile_shape(profile):
    require_condition(isinstance(profile, dict) and PLAYER_PROFILE_FIELDS <= set(profile) <= PLAYER_PROFILE_FIELDS | PLAYER_PROFILE_OPTIONAL_FIELDS,
                      'Invalid player profile fields')
    require_condition(isinstance(profile['id'], str) and PLAYER_PROFILE_ID_PATTERN.fullmatch(profile['id']) and
                      isinstance(profile['name'], str) and 0 < len(profile['name']) <= 128, 'Invalid player profile identity')
    require_condition('chargrpIndex' not in profile or (type(profile['chargrpIndex']) is int and 0 <= profile['chargrpIndex'] <= MAXIMUM_SAFE_INTEGER),
                      'Invalid player profile chargrpIndex')
    require_condition(isinstance(profile['catalogId'], str) and PLAYER_CATALOG_ID_PATTERN.fullmatch(profile['catalogId']) and
                      is_browser_string_within_utf16_units(profile['assetId']) and
                      is_browser_string_within_utf16_units(profile['sourceObject']) and QUALIFIED_OBJECT_PATTERN.fullmatch(profile['sourceObject']) and
                      isinstance(profile['sourceSha256'], str) and SHA256_HEX_PATTERN.fullmatch(profile['sourceSha256']), 'Invalid player source identity')
    require_condition(type(profile['sourceUnitsPerMetre']) is int and profile['sourceUnitsPerMetre'] == 100, 'Player profile source units must be 100 per metre')
    for name in ('collisionRadius', 'collisionHeight'):
        value = profile[name]
        require_condition(type(value) in (int, float) and math.isfinite(value) and 0 < value <= 10000, 'Invalid player collision dimension')
    axis = profile['forwardAxis']
    require_condition(isinstance(axis, list) and len(axis) == 3 and all(type(value) in (int, float) and math.isfinite(value) for value in axis)
                      and axis[1] == 0 and abs(math.hypot(axis[0], axis[2]) - 1) <= 1e-6, 'Player facing must be a finite normalized horizontal vector')
    scale = profile['actorScale']
    require_condition(isinstance(scale, list) and len(scale) == 3 and all(type(value) in (int, float) and math.isfinite(value) and 0 < value <= 100 for value in scale),
                      'Player actorScale must contain three positive finite presentation-axis values')
    clips = profile['clips']
    require_condition(isinstance(clips, dict) and set(REQUIRED_ALIASES) <= set(clips) <= set(PLAYER_ALIASES) and
                      all(isinstance(value, str) and 0 < len(value) <= 128 for value in clips.values()), 'Invalid player clip selection')
    if 'aliasEvidence' in profile:
        alias_evidence_shape(profile['aliasEvidence'], clips)
    require_condition(isinstance(profile['sourceEvidence'], dict) and profile['sourceEvidence'], 'Player profile requires source evidence')
    require_condition(isinstance(profile['limitations'], list) and 0 < len(profile['limitations']) <= 64 and
                      all(is_browser_string_within_utf16_units(value) for value in profile['limitations']), 'Player profile requires explicit limitations')
    require_upper_items_shape(profile['upperItems'])


def player_profile_pack_files_and_record(record_id, profiles):
    ordered = sorted(profiles, key=lambda profile: profile['chargrpIndex'])
    require_condition(0 < len(ordered) <= PLAYER_PROFILE_PACK_CAPACITY and len({profile['id'] for profile in ordered}) == len(ordered),
                      'Player profile pack needs 1 to 128 distinct profiles')
    for profile in ordered:
        profile_shape(profile)
    manifest_bytes = json_bytes({'schemaVersion': PLAYER_PROFILE_PACK_SCHEMA_VERSION, 'kind': PLAYER_PROFILE_PACK_KIND, 'profiles': ordered})
    require_condition(len(manifest_bytes) <= MAXIMUM_PLAYER_MANIFEST_BYTES, 'Player profile manifest exceeds the browser limit')
    manifest_sha256 = sha256_hex_digest(manifest_bytes)
    relative = f'{PLAYER_PROFILE_STORE_FOLDER}/{manifest_sha256}/{PLAYER_PROFILE_MANIFEST_FILE_NAME}'
    files = {}
    add_store_file(files, relative, manifest_bytes)
    return files, {'id': record_id, 'manifest': NATIVE_RESOURCE_PREFIX + relative, 'manifestSha256': manifest_sha256,
                   'manifestBytes': len(manifest_bytes)}


def write_player_profile_pack(store_root, record_id, profiles):
    if not profiles:
        write_catalog_without_record(store_root, PLAYER_PROFILES_SLICE, record_id)
        return None
    files, record = player_profile_pack_files_and_record(record_id, profiles)
    catalog, before = read_store_catalog(store_root)
    catalog = catalog_with_records_replaced(catalog, PLAYER_PROFILES_SLICE, [record], PLAYER_PROFILE_RECORD_CAPACITY)
    write_store(store_root, files, before, json_bytes(catalog))
    return record


def stored_player_profiles(store_root, record_id):
    catalog, _ = read_store_catalog(store_root)
    records = [record for record in catalog.get(PLAYER_PROFILES_SLICE, []) if record.get('id') == record_id]
    if not records:
        return []
    manifest_bytes = native_resource_store_path(store_root, records[0]['manifest']).read_bytes()
    require_condition(sha256_hex_digest(manifest_bytes) == records[0]['manifestSha256'], f'player profile pack {record_id} differs from its catalog pin')
    return json.loads(manifest_bytes)['profiles']
