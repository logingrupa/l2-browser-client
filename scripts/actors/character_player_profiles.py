import io
import json
from pathlib import Path
import re
import string
import struct
import zipfile

from actors.character_requests import CHARGRP_ROW_COLLECTION, PROFILE_WEAPON_TYPE, profile_weapon_type_slot
from actors.character_store_records import (CHARACTER_PLAYER_PROFILES_RECORD_ID, PLAYER_ALIAS_FIELDS, REQUIRED_ALIASES, SOCIAL_ANIMATION_FIELD,
                                            write_player_profile_pack)
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_store.catalog_index_keys import character_model_record_id
from native_store.catalog_writer import read_store_catalog
from native_store.unit_ledger import RECEIPT_RECORD_NAME

CHARACTER_PLAYER_PROFILES_GENERATOR = 'scripts/actors/character_player_profiles.py'
CLIP_BINDING_FILE_NAME = 'clip-binding.json'
CHARACTER_CLIP_MISSING_REASON_PREFIX = 'character-clip-missing:'
CHARACTER_PROFILE_ID_PREFIX = 'character-'
CHARACTER_FORWARD_AXIS = [1, 0, 0]
CHARACTER_SOURCE_UNITS_PER_METRE = 100
IDENTIFIER_PATTERN = re.compile(r'[A-Za-z_][A-Za-z_0-9]*')
ASCII_UPPERCASE_TO_LOWERCASE = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)
GLB_MAGIC, GLB_JSON_CHUNK_KIND = 0x46546c67, 0x4e4f534a
ALIAS_FIELD_BY_ALIAS = dict(PLAYER_ALIAS_FIELDS)
SOCIAL_ALIAS_PREFIX = 'social'
CLIP_NAME_CASE_RULE = ('Clip names match their native sequence ASCII case-insensitively: Engine GetAnimNamed 0x106b3b70 compares FName indices, '
                       'and Core FName hash 0x1014fa60 uppercases a-z (RM-9, verified-animation-name-resolution.md); a case-only binding follows that rule.')
CHARACTER_PROFILE_LIMITATIONS = (
    'Only the WT_HAND (weapon type 0) clips are bound; the other weapon slots follow CurWeaponType once equipment sets it (03-30).',
    'Movement speed comes from server data, not from this profile.',
    'No equipment is bound; upperItems stays empty until the equipment plan (03-30).',
    'HairStyle 0, HairColor 0 and Face 0 are the default appearance (RM-11 hairgrp rule, face_texture[0]) until a server packet selects one (Phase 4).',
    'The helmetgrp and hairaccessarygrp hair mappings are stored in recipes/actors/character-hair-parts.json and applied by equipment (03-30).',
)


class CharacterPlayerProfileError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CharacterPlayerProfileError(message)


def ascii_case_folded(name):
    return name.translate(ASCII_UPPERCASE_TO_LOWERCASE)


def bound_family_clip(value, clips):
    if value is None:
        return 'no-family-value', None, []
    if not isinstance(value, str) or IDENTIFIER_PATTERN.fullmatch(value) is None:
        return 'unsupported-syntax', None, []
    matches = [name for name in clips if ascii_case_folded(name) == ascii_case_folded(value)]
    if not matches:
        return 'missing-clip', None, []
    if len(matches) != 1:
        return 'ambiguous', None, matches
    return ('exact' if matches[0] == value else 'case-only'), matches[0], matches


def glb_animation_clip_names(glb):
    require(len(glb) >= 28 and struct.unpack_from('<3I', glb) == (GLB_MAGIC, 2, len(glb)), 'Invalid model GLB header')
    length, kind = struct.unpack_from('<2I', glb, 12)
    require(kind == GLB_JSON_CHUNK_KIND and 20 + length <= len(glb), 'Invalid model GLB JSON chunk')
    names = [animation.get('name') for animation in json.loads(glb[20:20 + length]).get('animations', [])]
    require(names and all(isinstance(name, str) and name for name in names) and len(set(names)) == len(names), 'Missing or duplicate clip names')
    return names


def archive_animation_clip_names(archive_path):
    with zipfile.ZipFile(io.BytesIO(Path(archive_path).read_bytes())) as archive:
        manifest = json.loads(archive.read('asset.json'))
        return glb_animation_clip_names(archive.read(manifest['model']['file']))


def alias_key(alias, field):
    return f'{field}[{alias[len(SOCIAL_ALIAS_PREFIX):]}]' if field == SOCIAL_ANIMATION_FIELD else f'{field}[0]'


def unbound_reason(status, key, value, families_of_class, catalog_id, matches):
    if status == 'no-family-value' and key.split('[', 1)[0] not in families_of_class['getters']:
        return f'{key} is outside the {len(families_of_class["getters"])} standard families of {families_of_class["recipe"]} (RM-7)'
    return {'no-family-value': f'{key} of [{families_of_class["section"]}] is FName None ({families_of_class["recipe"]})',
            'unsupported-syntax': f'{key} value {value!r} is not a name',
            'missing-clip': f'{value} is not a clip of {catalog_id}',
            'ambiguous': f'{value} matches {len(matches)} clips of {catalog_id}: {", ".join(matches)}'}[status]


def alias_binding_row(alias, field, families_of_class, slot, clip_names, catalog_id):
    key = alias_key(alias, field)
    value = slot['values'].get(field) if field != SOCIAL_ANIMATION_FIELD else None
    status, clip, matches = bound_family_clip(value, clip_names)
    if clip is None:
        return {'alias': alias, 'key': key, 'status': status, 'reason': unbound_reason(status, key, value, families_of_class, catalog_id, matches)}, None
    getter = families_of_class['getters'][field]
    return {'alias': alias, 'key': key, 'status': status, 'reference': value, 'line': slot['lines'][field],
            'selectionPath': f'{getter["getter"]} {getter["address"]}'}, clip


def family_clip_binding(families_of_class, clip_names, catalog_id):
    slot = profile_weapon_type_slot(families_of_class)
    rows, clips = [], {}
    for alias, field in PLAYER_ALIAS_FIELDS:
        row, clip = alias_binding_row(alias, field, families_of_class, slot, clip_names, catalog_id)
        rows.append(row)
        if clip is not None:
            clips[alias] = clip
    missing = [ALIAS_FIELD_BY_ALIAS[alias] for alias in REQUIRED_ALIASES if alias not in clips]
    return {'catalogId': catalog_id, 'weaponType': PROFILE_WEAPON_TYPE, 'clipNames': len(clip_names), 'clips': clips, 'rows': rows,
            'missingRequiredFields': missing}


def clip_binding_reason(binding):
    return CHARACTER_CLIP_MISSING_REASON_PREFIX + binding['missingRequiredFields'][0] if binding['missingRequiredFields'] else None


def actor_scale(presentation):
    draw_scale, scale_3d = presentation['drawScale']['value'], presentation['drawScale3D']['value']
    return [scale_3d['X'] * draw_scale, scale_3d['Z'] * draw_scale, scale_3d['Y'] * draw_scale]


def pivot_limitation(pivot):
    if 'value' in pivot:
        return f'PrePivot is authored as zero by {pivot["class"]}; no offset is applied.'
    return f'PrePivot is absent through the checked ancestry {" > ".join(pivot["classChain"])}; no offset is applied.'


def case_only_limitations(rows):
    return [CLIP_NAME_CASE_RULE] if any(row['status'] == 'case-only' for row in rows) else []


def character_player_profile(receipt, receipt_identity, binding, model_record):
    row_index = int(receipt['unitKey'].split(':', 1)[1])
    fields = receipt['config']['generated']['profileFields']
    families = fields['animationFamilies']
    require(model_record['id'] == character_model_record_id(row_index) == binding['catalogId'], f'{receipt["unitKey"]} binding names another model')
    class_reference = fields['actorClassDefaults']['class']
    return {'id': f'{CHARACTER_PROFILE_ID_PREFIX}{row_index}', 'chargrpIndex': row_index, 'name': class_reference,
            'catalogId': model_record['id'], 'assetId': model_record['assetId'], 'sourceObject': model_record['source']['object'],
            'sourceSha256': model_record['source']['sha256'], 'clips': binding['clips'],
            'aliasEvidence': {'generator': CHARACTER_PLAYER_PROFILES_GENERATOR, 'report': families['recipe'], 'reportSha256': families['recipeSha256'],
                              'family': families['section'], 'familySource': families['familySource']['path'],
                              'familySourceSha256': families['familySource']['sha256'], 'rows': binding['rows']},
            'collisionRadius': fields['collision']['collisionRadius']['value'], 'collisionHeight': fields['collision']['collisionHeight']['value'],
            'actorScale': actor_scale(fields['presentation']), 'forwardAxis': list(CHARACTER_FORWARD_AXIS), 'upperItems': [],
            'sourceUnitsPerMetre': CHARACTER_SOURCE_UNITS_PER_METRE,
            'sourceEvidence': {'animationFamilies': {'path': families['recipe'], 'sha256': families['recipeSha256'], 'meshType': families['meshType']},
                               'unitReceipt': receipt_identity, 'chargrp': {'collection': CHARGRP_ROW_COLLECTION, 'row': row_index},
                               'classChain': {'class': class_reference, 'classPackageSha256': fields['actorClassDefaults']['classPackageSha256'],
                                              'collision': fields['collision'], 'presentation': fields['presentation']}},
            'limitations': case_only_limitations(binding['rows']) + list(CHARACTER_PROFILE_LIMITATIONS)
            + [pivot_limitation(fields['presentation']['prePivot'])]}


def sealed_output_bytes(ledger, receipt, file_name):
    outputs = [output for output in receipt['outputs'] if output['path'].rsplit('/', 1)[-1] == file_name]
    require(len(outputs) == 1, f'{receipt["unitKey"]} receipt holds {len(outputs)} {file_name} outputs')
    payload = ledger.lane_output_path(outputs[0]['path']).read_bytes()
    require(sha256_hex_digest(payload) == outputs[0]['sha256'], f'{receipt["unitKey"]} {file_name} differs from its receipt')
    return payload


def receipt_identity(ledger, unit_key):
    path = ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME
    return {'path': path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex_digest(path.read_bytes())}


def passing_character_player_profiles(ledger, store_root, receipts):
    catalog, _ = read_store_catalog(store_root)
    models_by_id = {model['id']: model for model in catalog.get('models', [])}
    profiles = []
    for receipt in receipts:
        if receipt is None or receipt['gapRows']:
            continue
        binding = json.loads(sealed_output_bytes(ledger, receipt, CLIP_BINDING_FILE_NAME))
        model_record = models_by_id.get(binding['catalogId'])
        require(model_record is not None, f'{receipt["unitKey"]} passes but its model record {binding["catalogId"]} is not in the lane catalog')
        profiles.append(character_player_profile(receipt, receipt_identity(ledger, receipt['unitKey']), binding, model_record))
    return profiles


def write_character_player_profile_pack(ledger, store_root, receipts):
    profiles = passing_character_player_profiles(ledger, store_root, receipts)
    record = write_player_profile_pack(store_root, CHARACTER_PLAYER_PROFILES_RECORD_ID, profiles)
    return {'record': record, 'chargrpIndexes': [profile['chargrpIndex'] for profile in profiles]}
