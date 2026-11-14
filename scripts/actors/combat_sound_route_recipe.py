import hashlib
import json
from pathlib import Path
import re

from actors.combat_role_routes import TABLE_SELECTION_KINDS, descriptor_record_field_names
from native_assets_lib.combat_audio_bundle import CONFIG_TABLE, SELECTION_KINDS
from native_catalog.tables import interlude_table_layout
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH = 'recipes/actors/combat-sound-routes.json'
COMBAT_SOUND_ROUTE_RECIPE_KIND = 'combat-sound-routes'
ENGINE_RELATIVE_PATH = 'system/Engine.dll'
SHA256_HEX = re.compile(r'[0-9a-f]{64}')
HEX_ADDRESS = re.compile(r'0x[0-9a-f]+')
ROUTE_TEXT_FIELDS = ('selector', 'trigger')
MEMBER_FIELDS = {'member', 'rowMember', 'datFieldOrdinal', 'ordinalConstant', 'ordinalCountTerms'}
ROUTE_FIELDS = {'table', 'role', 'anchors', 'selector', 'trigger', 'members'}
OPTIONAL_ROUTE_FIELDS = {'memberCountDerivation'}
CONFIG_ROUTE_FIELDS = {'table', 'role', 'file', 'sha256', 'section', 'key', 'values', 'anchors', 'selector', 'trigger'}
CONFIRMED_UNRESOLVED_FIELDS = {'table', 'role', 'detail'}
CASTER_INDEXED_ROUTE_FIELDS = {'table', 'role', 'tableMember', 'address', 'anchors', 'selector', 'trigger', 'meshTypes'}
MESH_TYPE_FIELDS = {'meshType', 'meshClass', 'ordinalConstant', 'ordinalCountTerms'}
UNROUTED_FIELD_FIELDS = {'table', 'reason', 'ordinalConstants', 'ordinalCountTerms', 'detail'}
UNROUTED_FIELD_REASON = re.compile(r'[a-z][a-z-]*:[a-z0-9]+')
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'engine', 'verification', 'ordinalNotation', 'routes'}
OPTIONAL_DOCUMENT_FIELDS = {'ordinalTermDefinitions', 'configRoutes', 'confirmedUnresolved', 'casterIndexedRoutes', 'unroutedFields'}
TABLE_SECTIONS = ('routes', 'confirmedUnresolved', 'casterIndexedRoutes', 'unroutedFields')


class CombatSoundRouteRecipeError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CombatSoundRouteRecipeError(f'{COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH}: {message}')


def refuse_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    require(len(keys) == len(set(keys)), f'repeats a JSON key in {sorted(keys)}')
    return dict(pairs)


def refuse_non_finite_number(value):
    raise CombatSoundRouteRecipeError(f'{COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH}: holds the non-finite number {value}')


def is_count(value):
    return type(value) is int and value >= 0


def is_text(value):
    return isinstance(value, str) and value != ''


def require_anchors(entry, label):
    require(isinstance(entry.get('anchors'), list) and entry['anchors'] and all(is_text(anchor) for anchor in entry['anchors']),
            f'{label} needs a non-empty anchors list')


def require_locked_engine(engine, lock_path):
    require(isinstance(engine, dict) and set(engine) == {'path', 'sha256', 'imageBase'}, 'engine must hold path, sha256 and imageBase')
    require(engine['path'] == ENGINE_RELATIVE_PATH and HEX_ADDRESS.fullmatch(str(engine['imageBase'])), 'engine names another file or no image base')
    record = read_reference_client_lock(lock_path).record(engine['path'])
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == engine['sha256'],
            f'engine pin {engine["sha256"]} differs from the {engine["path"].casefold()} entry of the reference client lock')


def require_table_role(entry, table_kinds, label):
    require(entry['table'] in table_kinds and entry['table'] != CONFIG_TABLE, f'{label} names no supported table')
    require(entry['role'] in SELECTION_KINDS[table_kinds[entry['table']]], f'{label} names no role of its selection kind')
    require_anchors(entry, label)
    require(all(is_text(entry[field]) for field in ROUTE_TEXT_FIELDS), f'{label} needs a selector and a trigger')


def require_route_entry(entry, table_kinds):
    require(isinstance(entry, dict) and ROUTE_FIELDS <= set(entry) <= ROUTE_FIELDS | OPTIONAL_ROUTE_FIELDS,
            f'route entry fields must be {sorted(ROUTE_FIELDS)} with optional {sorted(OPTIONAL_ROUTE_FIELDS)}')
    label = f'route {entry["table"]}/{entry["role"]}'
    require_table_role(entry, table_kinds, label)
    require(all(is_text(entry[field]) for field in OPTIONAL_ROUTE_FIELDS if field in entry), f'{label} has an empty member count derivation')
    members = entry['members']
    require(isinstance(members, list) and members, f'{label} needs members')
    for position, member in enumerate(members):
        require(isinstance(member, dict) and set(member) == MEMBER_FIELDS, f'{label} member {position} must hold {sorted(MEMBER_FIELDS)}')
        require(member['member'] == position and is_text(member['rowMember']) and is_text(member['datFieldOrdinal']),
                f'{label} member {position} needs its number, row member and verbatim DAT ordinal')
        require(is_count(member['ordinalConstant']) and is_count(member['ordinalCountTerms']),
                f'{label} member {position} needs an ordinalConstant and an ordinalCountTerms number')


def require_config_route_entry(entry, lock_path):
    require(isinstance(entry, dict) and set(entry) == CONFIG_ROUTE_FIELDS, f'config route fields must be {sorted(CONFIG_ROUTE_FIELDS)}')
    label = f'config route {entry["table"]}/{entry["role"]}'
    require(entry['table'] == CONFIG_TABLE and entry['role'] in SELECTION_KINDS['config'], f'{label} names no config role')
    require(all(is_text(entry[field]) for field in ('file', 'section', 'key', 'selector', 'trigger')), f'{label} needs text fields')
    require(isinstance(entry['values'], dict) and entry['values'], f'{label} needs its values')
    require_anchors(entry, label)
    record = read_reference_client_lock(lock_path).record(entry['file'])
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == entry['sha256'],
            f'{label} pin differs from the {entry["file"]} entry of the reference client lock')


def require_caster_indexed_route_entry(entry, table_kinds):
    require(isinstance(entry, dict) and set(entry) == CASTER_INDEXED_ROUTE_FIELDS,
            f'caster-indexed route fields must be {sorted(CASTER_INDEXED_ROUTE_FIELDS)}')
    label = f'caster-indexed route {entry["table"]}/{entry["role"]}'
    require_table_role(entry, table_kinds, label)
    require(is_text(entry['tableMember']) and is_text(entry['address']), f'{label} needs its table member and address')
    mesh_types = entry['meshTypes']
    require(isinstance(mesh_types, list) and mesh_types, f'{label} needs mesh types')
    for position, mesh_type in enumerate(mesh_types):
        require(isinstance(mesh_type, dict) and set(mesh_type) == MESH_TYPE_FIELDS and mesh_type['meshType'] == position
                and is_text(mesh_type['meshClass']) and is_count(mesh_type['ordinalConstant']) and is_count(mesh_type['ordinalCountTerms']),
                f'{label} mesh type {position} must hold {sorted(MESH_TYPE_FIELDS)} in mesh type order')


def require_unrouted_field_entry(entry, table_kinds):
    require(isinstance(entry, dict) and set(entry) == UNROUTED_FIELD_FIELDS, f'unrouted field entries must hold {sorted(UNROUTED_FIELD_FIELDS)}')
    require(entry['table'] in table_kinds and entry['table'] != CONFIG_TABLE and UNROUTED_FIELD_REASON.fullmatch(str(entry['reason'])),
            'unrouted field entries need a table and a listed reason with its value')
    require(isinstance(entry['ordinalConstants'], list) and entry['ordinalConstants'] and all(is_count(value) for value in entry['ordinalConstants'])
            and is_count(entry['ordinalCountTerms']) and is_text(entry['detail']),
            f'unrouted field {entry["reason"]} needs ordinal constants, count terms and a detail')


def recipe_strings(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [string for key, item in value.items() for string in (key, *recipe_strings(item))]
    if isinstance(value, list):
        return [string for item in value for string in recipe_strings(item)]
    return []


def require_no_descriptor_field_name(document):
    tables = sorted({entry['table'] for section in TABLE_SECTIONS for entry in document.get(section, [])})
    field_names = {name for table in tables for name in descriptor_record_field_names(interlude_table_layout(table)[1])}
    named = sorted(field_names.intersection(recipe_strings(document)))
    require(not named, f'names the descriptor fields {named}; routes are DAT ordinals only')


def validate_combat_sound_route_document(document, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(isinstance(document, dict) and DOCUMENT_FIELDS <= set(document) <= DOCUMENT_FIELDS | OPTIONAL_DOCUMENT_FIELDS,
            f'fields must be {sorted(DOCUMENT_FIELDS)} with optional {sorted(OPTIONAL_DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == COMBAT_SOUND_ROUTE_RECIPE_KIND, 'is not a combat-sound-routes v1 recipe')
    require_locked_engine(document['engine'], lock_path)
    verification = document['verification']
    require(isinstance(verification, dict) and SHA256_HEX.fullmatch(str(verification.get('verifiedFactsSha256'))),
            'verification needs the SHA-256 of the verified facts')
    claimed = []
    for entry in document['routes']:
        require_route_entry(entry, TABLE_SELECTION_KINDS)
        claimed.append((entry['table'], entry['role']))
    for entry in document.get('configRoutes', []):
        require_config_route_entry(entry, lock_path)
        claimed.append((entry['table'], entry['role']))
    for entry in document.get('confirmedUnresolved', []):
        require(isinstance(entry, dict) and set(entry) == CONFIRMED_UNRESOLVED_FIELDS and entry['table'] in TABLE_SELECTION_KINDS
                and entry['role'] in SELECTION_KINDS[TABLE_SELECTION_KINDS[entry['table']]] and is_text(entry['detail']),
                'confirmedUnresolved entries need a table, a role of it and a detail')
        claimed.append((entry['table'], entry['role']))
    require(len(claimed) == len(set(claimed)), 'lists a table and role more than once')
    caster_indexed = []
    for entry in document.get('casterIndexedRoutes', []):
        require_caster_indexed_route_entry(entry, TABLE_SELECTION_KINDS)
        caster_indexed.append((entry['table'], entry['role']))
    require(len(caster_indexed) == len(set(caster_indexed)), 'lists a caster-indexed table and role more than once')
    for entry in document.get('unroutedFields', []):
        require_unrouted_field_entry(entry, TABLE_SELECTION_KINDS)
    require(isinstance(document.get('ordinalTermDefinitions', {}), dict)
            and all(is_text(value) for value in document.get('ordinalTermDefinitions', {}).values()), 'ordinal term definitions must be text')
    require_no_descriptor_field_name(document)
    return document


def read_combat_sound_route_recipe(project_root, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    path = Path(project_root) / COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH
    require(path.is_file(), 'is missing')
    payload = path.read_bytes()
    try:
        document = json.loads(payload, object_pairs_hook=refuse_duplicate_keys, parse_constant=refuse_non_finite_number)
    except json.JSONDecodeError as error:
        raise CombatSoundRouteRecipeError(f'{COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH} is not JSON: {error}') from error
    return {'path': COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(),
            'document': validate_combat_sound_route_document(document, lock_path)}
