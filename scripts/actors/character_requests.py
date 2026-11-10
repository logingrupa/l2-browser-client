import math
import re

from actors.actor_unit_inventory import CHARACTER_PART_NAME, NO_MESH_IN_ROW_REASON, decoded_string_values
from actors.npc_requests import ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX
from data.hair_table_adapter import HAIR_LAYOUT_UNDECODED_REASON, HAIR_TABLE_FIELD_PROOF, HELMET_LAYOUT_UNDECODED_REASON
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN, validate_gap_row

CHARGRP_TABLE_NAME = 'chargrp'
CHARGRP_ROW_COLLECTION = 'Char'
CLASSINFO_TABLE_NAME = 'classinfo-e'
HAIRGRP_TABLE_NAME = 'hairgrp'
HELMETGRP_TABLE_NAME = 'helmetgrp'
CHARACTER_STEP = 'characters'
BODY_MESH_GROUP, BODY_TEXTURE_GROUP = 'body_mesh', 'body_texture'
BODY_MESH_FIELD_PATTERN = re.compile(r'^body_mesh([1-9][0-9]*)$')
FACE_MESH_GROUP, FACE_MESH_FIELD = 'face_mesh', 'param_face_mesh'
FACE_TEXTURE_GROUP, FACE_TEXTURE_FIELD = 'face_texture', 'param_face_texture'
HAIR_MESH_GROUP, HAIR_MESH_FIELD = 'hair_mesh', 'param_hair_mesh'
HAIR_TEXTURE_GROUP, HAIR_TEXTURE_FIELD = 'hair_texture', 'param_hair_texture'
CLASSINFO_CHARGRP_INDEX_FIELD = 'chargrp_index'
CLASSINFO_ACTOR_CLASS_FIELD = 'actor_class'
CONVERTER_ASSEMBLY_PART_LIMIT = 16
ASSEMBLY_PART_LIMIT_EXCEEDED_REASON_PREFIX = 'assembly-part-limit-exceeded:'
CLASS_TEMPLATE_MAPPING_UNDECODED_REASON = 'class-template-mapping-undecoded'
HEAD_BONE_FIELD, RIGHT_HAND_BONE_FIELD, SUB_MESHES_FIELD = 'HeadBone', 'RightHandBone', 'SubMeshes'
COLLISION_SOURCE_FIELDS = (('collisionRadius', 'CollisionRadius'), ('collisionHeight', 'CollisionHeight'))
IDLE_ANIMATION_FAMILY_FIELD = 'WaitAnimName'
REQUESTED_STATUS, UNBOUND_TEXTURE_STATUS, BOUND_STATUS, GAP_STATUS = 'requested', 'requested-unbound', 'bound', 'gap'
FACE_FIELD_NAME = 'face'
CHARACTER_REQUEST_LIMITATIONS = (
    'Generated from the decoded chargrp row: body parts follow body_mesh1 upward with their body_texture fields; no recipe value is copied.',
    'The face attaches only through a source-joined actor class; hair and helmet bind only from decoded hairgrp and helmetgrp joins.',
)


class CharacterRequestError(ValueError):
    pass


def chargrp_row_at(chargrp_table, row_index):
    rows = chargrp_table['data'][CHARGRP_ROW_COLLECTION]
    if not (type(row_index) is int and 0 <= row_index < len(rows)):
        raise CharacterRequestError(f'chargrp row index {row_index!r} is outside the decoded table of {len(rows)} rows')
    return rows[row_index]


def character_key(row_index):
    return f'character:{row_index}'


def body_mesh_field_pairs(chargrp_row):
    numbers = sorted(int(match[1]) for match in map(BODY_MESH_FIELD_PATTERN.fullmatch, chargrp_row[BODY_MESH_GROUP]) if match)
    return [(f'{BODY_MESH_GROUP}{number}', f'{BODY_TEXTURE_GROUP}{number}') for number in numbers]


def is_padding_row(chargrp_row):
    return not any(chargrp_row[BODY_MESH_GROUP].values())


def unqualified_reference_reason(field, reference):
    return None if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(reference) else ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + field


def part_status(field, status, reason=None):
    return {'field': field, 'status': status, 'reason': reason}


def table_mesh_part(mesh, texture, mesh_path, texture_path, chargrp_table):
    package_name, object_name = mesh.split('.', 1)
    binding = {'table': CHARGRP_TABLE_NAME, 'sourceSha256': chargrp_table['sourceSha256'], 'meshPath': mesh_path}
    if texture:
        binding['texturePath'] = texture_path
    return {'package': package_name, 'object': object_name, 'materials': [f'0={texture}'] if texture else [], 'sourceBinding': binding}


def body_parts(chargrp_row, row_index, chargrp_table):
    parts, statuses = [], []
    for mesh_field, texture_field in body_mesh_field_pairs(chargrp_row):
        mesh, texture = chargrp_row[BODY_MESH_GROUP][mesh_field], chargrp_row[BODY_TEXTURE_GROUP].get(texture_field, '')
        reason = (NO_MESH_IN_ROW_REASON if not mesh else
                  unqualified_reference_reason(mesh_field, mesh) or (texture and unqualified_reference_reason(texture_field, texture)) or None)
        if reason:
            statuses.append(part_status(mesh_field, GAP_STATUS, reason))
            continue
        parts.append(table_mesh_part(mesh, texture, [CHARGRP_ROW_COLLECTION, row_index, BODY_MESH_GROUP, mesh_field],
                                     [CHARGRP_ROW_COLLECTION, row_index, BODY_TEXTURE_GROUP, texture_field], chargrp_table))
        statuses.append(part_status(mesh_field, REQUESTED_STATUS if texture else UNBOUND_TEXTURE_STATUS))
    return parts, statuses


def class_head_bone_reason(actor_class):
    if actor_class is None:
        return CLASS_TEMPLATE_MAPPING_UNDECODED_REASON
    head_bone = actor_class['properties'].get(HEAD_BONE_FIELD)
    return None if isinstance(head_bone, str) and head_bone else ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + HEAD_BONE_FIELD


def rigid_head_attachment(actor_class, mesh_path):
    return {'bone': actor_class['properties'][HEAD_BONE_FIELD],
            'source': {'class': actor_class['class'], 'packageSha256': actor_class['packageSha256'], 'bonePath': [HEAD_BONE_FIELD],
                       'meshPath': mesh_path}}


def face_part(chargrp_row, row_index, chargrp_table, actor_class):
    meshes = [entry[FACE_MESH_FIELD] for entry in chargrp_row[FACE_MESH_GROUP]]
    textures = [entry[FACE_TEXTURE_FIELD] for entry in chargrp_row[FACE_TEXTURE_GROUP] if entry[FACE_TEXTURE_FIELD]]
    reason = (NO_MESH_IN_ROW_REASON if len(meshes) != 1 or not meshes[0] else
              unqualified_reference_reason(FACE_MESH_FIELD, meshes[0]) or class_head_bone_reason(actor_class))
    if reason:
        return None, part_status(FACE_FIELD_NAME, GAP_STATUS, reason)
    texture = textures[0] if len(textures) == 1 else ''
    part = table_mesh_part(meshes[0], texture, [CHARGRP_ROW_COLLECTION, row_index, FACE_MESH_GROUP, 0, FACE_MESH_FIELD],
                           [CHARGRP_ROW_COLLECTION, row_index, FACE_TEXTURE_GROUP, 0, FACE_TEXTURE_FIELD], chargrp_table)
    part['rigidAttachment'] = rigid_head_attachment(actor_class, ['Mesh'])
    return part, part_status(FACE_FIELD_NAME, REQUESTED_STATUS if texture else UNBOUND_TEXTURE_STATUS)


def classinfo_rows(classinfo_table):
    collections = [value for value in classinfo_table['records'].values() if isinstance(value, list)]
    if len(collections) != 1:
        raise CharacterRequestError(f'{CLASSINFO_TABLE_NAME} manifest must hold exactly one record list')
    return collections[0]


def resolve_character_actor_class(classinfo_table, row_index):
    rows = classinfo_rows(classinfo_table) if classinfo_table else []
    fields = sorted({field for row in rows for field in row})
    evidence = {'table': CLASSINFO_TABLE_NAME, 'sourceSha256': classinfo_table['sourceSha256'] if classinfo_table else None, 'fields': fields}
    if not {CLASSINFO_CHARGRP_INDEX_FIELD, CLASSINFO_ACTOR_CLASS_FIELD} <= set(fields):
        return {'class': None, 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, 'evidence': evidence}
    joined = [row for row in rows if row.get(CLASSINFO_CHARGRP_INDEX_FIELD) == row_index]
    actor_class = joined[0].get(CLASSINFO_ACTOR_CLASS_FIELD) if len(joined) == 1 else None
    if not (isinstance(actor_class, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(actor_class)):
        return {'class': None, 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, 'evidence': {**evidence, 'joinedRecords': len(joined)}}
    return {'class': actor_class, 'reason': None, 'evidence': {**evidence, 'joinedRecords': 1}}


def layout_gap(reason, join_field, candidate_count, record_fields):
    return {'status': GAP_STATUS, 'reason': reason, 'joinField': join_field, 'candidateCount': candidate_count, 'recordFields': record_fields}


def manifest_record_fields(manifest):
    return sorted({field for record in manifest['records'] if isinstance(record, dict) for field in record}) if manifest else None


def layout_binding(table_name, manifest, reason, chargrp_row):
    if manifest is None:
        return layout_gap(reason, None, None, None)
    records, record_fields = manifest['records'], manifest_record_fields(manifest)
    join_fields = sorted(set(record_fields) & set(chargrp_row) - {HAIR_MESH_GROUP, HAIR_TEXTURE_GROUP})
    if len(join_fields) != 1:
        return layout_gap(reason, None, None, record_fields)
    join_field = join_fields[0]
    joined = [(ordinal, record) for ordinal, record in enumerate(records)
              if isinstance(record, dict) and record.get(join_field) == chargrp_row[join_field]]
    if len(joined) != 1:
        return layout_gap(reason, join_field, len(joined), record_fields)
    ordinal, record = joined[0]
    meshes = [mesh for mesh in decoded_string_values(record.get(HAIR_MESH_GROUP, [])) if mesh]
    textures = [texture for texture in decoded_string_values(record.get(HAIR_TEXTURE_GROUP, [])) if texture]
    if len(meshes) != 1 or len(textures) != 1 or any(unqualified_reference_reason(HAIR_MESH_FIELD, value) for value in meshes + textures):
        return layout_gap(reason, join_field, len(textures), record_fields)
    return {'status': BOUND_STATUS, 'reason': None, 'joinField': join_field, 'candidateCount': 1, 'recordFields': record_fields,
            'mesh': meshes[0], 'texture': textures[0],
            'binding': {'table': table_name, 'sourceSha256': manifest['sourceSha256'], 'recordOrdinal': ordinal,
                        'fieldPath': [HAIR_TEXTURE_GROUP, 0, HAIR_TEXTURE_FIELD]}}


def layout_part(binding, actor_class):
    package_name, object_name = binding['mesh'].split('.', 1)
    part = {'package': package_name, 'object': object_name, 'materials': [f'0={binding["texture"]}'], 'layoutBinding': binding['binding']}
    sub_meshes = actor_class['properties'].get(SUB_MESHES_FIELD, []) if actor_class else []
    matching = [index for index, mesh in enumerate(sub_meshes) if isinstance(mesh, dict) and mesh.get('object') == binding['mesh']]
    if len(matching) == 1 and class_head_bone_reason(actor_class) is None:
        part['rigidAttachment'] = rigid_head_attachment(actor_class, [SUB_MESHES_FIELD, matching[0]])
    return part


def layout_binding_limitation(binding):
    citation = binding['binding']
    return (f'{citation["table"]} record {citation["recordOrdinal"]} field {"/".join(map(str, citation["fieldPath"]))} binds the texture; '
            f'{HAIR_TABLE_FIELD_PROOF}; unverified presentation until the side-by-side check.')


def collision_value(properties, source_field):
    value = properties.get(source_field)
    return value if type(value) in (int, float) and math.isfinite(value) and value > 0 else None


def class_supplying_field(class_reference, source_field, read_class_definition):
    reference, chain = class_reference, []
    while reference:
        if reference in chain:
            raise CharacterRequestError(f'cyclic class chain at {reference}')
        chain.append(reference)
        definition = read_class_definition(reference)
        value = collision_value(definition['properties'], source_field)
        if value is not None:
            return {'value': value, 'class': reference}
        reference = definition['nativeSuperClass']
    return {'reason': ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + source_field, 'classChain': chain}


def collision_from_class_chain(class_reference, read_class_definition):
    return {profile_field: class_supplying_field(class_reference, source_field, read_class_definition)
            for profile_field, source_field in COLLISION_SOURCE_FIELDS}


def character_profile_fields(actor_class, read_class_definition):
    if actor_class is None:
        return {'status': GAP_STATUS, 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, 'collision': None, 'actorClassDefaults': None}
    collision = collision_from_class_chain(actor_class['class'], read_class_definition)
    properties = actor_class['properties']
    class_defaults = {'class': actor_class['class'], 'classPackageSha256': actor_class['packageSha256'],
                      HEAD_BONE_FIELD: properties.get(HEAD_BONE_FIELD), RIGHT_HAND_BONE_FIELD: properties.get(RIGHT_HAND_BONE_FIELD)}
    reason = next((entry['reason'] for entry in collision.values() if 'reason' in entry),
                  ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + IDLE_ANIMATION_FAMILY_FIELD)
    return {'status': GAP_STATUS, 'reason': reason, 'collision': collision, 'actorClassDefaults': class_defaults}


def build_character_request(chargrp_row, row_index, actor_class, sources):
    parts, statuses = body_parts(chargrp_row, row_index, sources.chargrp)
    face, face_status = face_part(chargrp_row, row_index, sources.chargrp, actor_class)
    hair = layout_binding(HAIRGRP_TABLE_NAME, sources.hairgrp, HAIR_LAYOUT_UNDECODED_REASON, chargrp_row)
    helmet = layout_binding(HELMETGRP_TABLE_NAME, sources.helmetgrp, HELMET_LAYOUT_UNDECODED_REASON, chargrp_row)
    parts += [face] if face else []
    parts += [layout_part(binding, actor_class) for binding in (hair, helmet) if binding['status'] == BOUND_STATUS]
    gaps = [{'field': status['field'], 'reason': status['reason']} for status in statuses + [face_status] if status['status'] == GAP_STATUS]
    gaps += [{'field': name, 'reason': binding['reason']} for name, binding in (('hair', hair), ('helmet', helmet)) if binding['status'] == GAP_STATUS]
    request = None
    if len(parts) > CONVERTER_ASSEMBLY_PART_LIMIT:
        gaps.insert(0, {'field': 'parts', 'reason': ASSEMBLY_PART_LIMIT_EXCEEDED_REASON_PREFIX + str(len(parts))})
    elif parts:
        limitations = list(CHARACTER_REQUEST_LIMITATIONS) + [layout_binding_limitation(binding) for binding in (hair, helmet)
                                                              if binding['status'] == BOUND_STATUS]
        request = {'kind': 'model', 'name': character_key(row_index).replace(':', '-'), 'animation': None, 'withEventAudio': True,
                   'parts': parts, 'limitations': limitations}
    return {'request': request, 'profileFields': character_profile_fields(actor_class, sources.read_class_definition),
            'parts': statuses + [face_status], 'hair': hair, 'helmet': helmet, 'gaps': gaps}


def character_gap_rows(row_index, step, status, reason, source_identity, evidence):
    return [validate_gap_row({'key': character_key(row_index), 'part': CHARACTER_PART_NAME, 'step': step, 'status': status,
                              'reason': reason, 'sourceIdentity': source_identity, 'evidence': evidence})]
