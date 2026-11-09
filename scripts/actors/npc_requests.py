import re
import subprocess

from actors.actor_unit_inventory import decoded_string_values
from native_assets_lib.skill_audio_bundle import reference_candidates
from native_catalog.skeletal import SkeletalReader

NPCGRP_TABLE_NAME = 'npcgrp'
NPCGRP_ROW_COLLECTION = 'npc'
NPC_PROFILE_RECIPE_SCHEMA_VERSION = 1
CONVERTER_SOURCE_UNITS_PER_METRE = 100
NPC_PROFILE_RECIPE_ID_PREFIX = 'interlude:npc-profiles:'
ANIMATION_REFERENCE_MISSING_REASON = 'animation-reference-missing'
ANIMATION_OUTSIDE_MESH_PACKAGE_REASON_PREFIX = 'animation-outside-mesh-package:'
SOUND_IDENTITY_UNRESOLVED_REASON = 'sound-identity-unresolved'
NPC_NAME_ROW_MISSING_REASON = 'npc-name-row-missing'
NPC_NAME_EMPTY_REASON = 'npc-name-empty'
ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX = 'actor-default-unresolved:'
CONVERTER_REFUSED_REASON_PREFIX = 'converter-refused:'
PASS_STATUS, GAP_STATUS, FAILED_STATUS = 'pass', 'gap', 'failed'
TRANSIENT_FAILURES = (OSError, subprocess.SubprocessError)
ADMITTED_SOUND_IDENTITY_STATUSES = ('exact-identity', 'unique-package-leaf-candidate')
SOUND_PACKAGE_NOT_IN_CLIENT_STATUS = 'sound-package-not-in-client'
SOUND_PACKAGE_REFUSED_STATUS = 'sound-package-refused'
EMPTY_REFERENCE_STATUS = 'empty'
EFFECT_BINDING_RECORD_STATUS = 'binding-record-only'
NPC_SOUND_FIELD_PATTERN = re.compile(r'^[a-z0-9_]+_sound\d*$')
NPC_EFFECT_FIELD_PATTERN = re.compile(r'^[a-z0-9_]+_effect$')
NPC_SOUND_NUMERIC_FIELDS = ('sound_vol', 'sound_radius')
NPC_SOUND_NUMERIC_FIELD_NOTE = ('npcgrp sound_vol and sound_radius are copied as decoded; their decoded labels are swapped '
                                '(native_assets_lib/combat_audio_bundle.py) and they are not interpreted here.')
TEXTURE_LIST_INDEX_SLOT_LIMITATION = ('npcgrp texture_name[i] binds material slot i by the UE2 Skins array convention, which is not read '
                                      'from the client; the binding is unverified presentation until a paired screenshot against L2.exe '
                                      'at the same NPC id settles it.')
MESH_IDENTITY_LIMITATION = 'The npcgrp row names this mesh; no NPC id, DrawScale or gameplay identity is inferred from the mesh.'


class NpcRequestError(ValueError):
    pass


def serialized_animation_reference(package, mesh_export):
    return SkeletalReader(package, mesh_export).decode()['animation']


def animation_reference_gap_reason(animation_reference, mesh_package_name):
    if animation_reference is None:
        return ANIMATION_REFERENCE_MISSING_REASON
    reference_package_name = animation_reference.split('.', 1)[0]
    if reference_package_name != mesh_package_name or '.' not in animation_reference:
        return ANIMATION_OUTSIDE_MESH_PACKAGE_REASON_PREFIX + reference_package_name
    return None


def npcgrp_row(npcgrp_table, row_index):
    rows = npcgrp_table['data'][NPCGRP_ROW_COLLECTION]
    if not (type(row_index) is int and 0 <= row_index < len(rows)):
        raise NpcRequestError(f'npcgrp row index {row_index!r} is outside the decoded table of {len(rows)} rows')
    return rows[row_index]


def npc_texture_field_path(row_index, texture_index):
    return [NPCGRP_ROW_COLLECTION, row_index, 'texture_name', texture_index, 'param_texture_name']


def npc_texture_source_binding(row_index, textures):
    if len(textures) == 1:
        return {'texturePath': npc_texture_field_path(row_index, 0)}
    return {'slotBindings': [{'slot': texture_index, 'texturePath': npc_texture_field_path(row_index, texture_index)}
                             for texture_index in range(len(textures))]}


def npc_material_overrides(textures):
    if len(textures) == 1:
        return [f'0={textures[0]}']
    return [f'{texture_index}={texture}' for texture_index, texture in enumerate(textures) if texture]


def npc_model_request(unit, npcgrp_table, row_index, animation_reference):
    mesh, textures = unit['selection']['mesh'], unit['selection']['textures']
    row = npcgrp_row(npcgrp_table, row_index)
    row_textures = [slot['param_texture_name'] for slot in row['texture_name']]
    if row['mesh_name'] != mesh or row_textures != textures:
        raise NpcRequestError(f'npcgrp row {row_index} does not name the exact mesh and textures of unit {unit["key"]}')
    if not textures:
        raise NpcRequestError(f'unit {unit["key"]} has no texture slot; a model request needs at least one')
    if '.' not in mesh:
        raise NpcRequestError(f'npcgrp mesh {mesh!r} is not a qualified native object name')
    package_name, object_name = mesh.split('.', 1)
    return {'kind': 'model', 'name': unit['key'].replace(':', '-'), 'package': package_name, 'object': object_name,
            'animation': animation_reference, 'withEventAudio': True, 'materials': npc_material_overrides(textures),
            'sourceBinding': {'table': NPCGRP_TABLE_NAME, 'sourceSha256': npcgrp_table['sourceSha256'],
                              'meshPath': [NPCGRP_ROW_COLLECTION, row_index, 'mesh_name'], **npc_texture_source_binding(row_index, textures)},
            'limitations': [TEXTURE_LIST_INDEX_SLOT_LIMITATION, MESH_IDENTITY_LIMITATION]}


def npc_profile_selection(npc_id, npcname_row, npcgrp_row_value, model_catalog_id):
    if npcname_row['id'] != npc_id or npcgrp_row_value['npc_id'] != npc_id:
        raise NpcRequestError(f'npcname and npcgrp rows do not both belong to npc {npc_id}')
    return {'npcId': npc_id, 'expectedName': npcname_row['name'], 'expectedMesh': npcgrp_row_value['mesh_name'],
            'expectedActorClass': npcgrp_row_value['class_name'], 'modelCatalogId': model_catalog_id}


def npc_profiles_recipe(recipe_id, profile_selections, name_table):
    return {'schemaVersion': NPC_PROFILE_RECIPE_SCHEMA_VERSION, 'id': recipe_id, 'nameTable': name_table,
            'sourceUnitsPerMetre': CONVERTER_SOURCE_UNITS_PER_METRE, 'profiles': list(profile_selections)}


def npc_profile_recipe(npc_id, npcname_row, npcgrp_row_value, model_catalog_id, name_table):
    return npc_profiles_recipe(f'{NPC_PROFILE_RECIPE_ID_PREFIX}{npc_id}',
                               [npc_profile_selection(npc_id, npcname_row, npcgrp_row_value, model_catalog_id)], name_table)


def npc_reference_fields(npcgrp_row_value, field_pattern):
    return [(field, decoded_string_values(value)) for field, value in npcgrp_row_value.items() if field_pattern.fullmatch(field)]


def package_stem(reference):
    return reference.split('.', 1)[0].casefold()


def sound_identity_label(field, index, reference, sound_package_exports):
    if reference == '':
        return {'field': field, 'index': index, 'reference': reference, 'status': EMPTY_REFERENCE_STATUS, 'candidates': [], 'gapReason': None}
    exports = sound_package_exports.get(package_stem(reference), SOUND_PACKAGE_NOT_IN_CLIENT_STATUS)
    if isinstance(exports, str):
        status, candidates = exports, []
    else:
        status, candidates = reference_candidates(reference, [{'export': {'object': export_object}} for export_object in exports])
    return {'field': field, 'index': index, 'reference': reference, 'status': status,
            'candidates': [candidate['export']['object'] for candidate in candidates],
            'gapReason': None if status in ADMITTED_SOUND_IDENTITY_STATUSES else SOUND_IDENTITY_UNRESOLVED_REASON}


def npc_sound_references(npcgrp_row_value):
    return [(field, index, reference) for field, references in npc_reference_fields(npcgrp_row_value, NPC_SOUND_FIELD_PATTERN)
            for index, reference in enumerate(references)]


def label_npc_sound_identities(npcgrp_row_value, sound_package_exports):
    return {'labels': [sound_identity_label(field, index, reference, sound_package_exports)
                       for field, index, reference in npc_sound_references(npcgrp_row_value)],
            'numericFields': {field: npcgrp_row_value[field] for field in NPC_SOUND_NUMERIC_FIELDS if field in npcgrp_row_value},
            'numericFieldNote': NPC_SOUND_NUMERIC_FIELD_NOTE}


def npc_effect_binding_record(npcgrp_row_value):
    return [{'field': field, 'index': index, 'reference': reference,
             'status': EMPTY_REFERENCE_STATUS if reference == '' else EFFECT_BINDING_RECORD_STATUS}
            for field, references in npc_reference_fields(npcgrp_row_value, NPC_EFFECT_FIELD_PATTERN)
            for index, reference in enumerate(references)]
