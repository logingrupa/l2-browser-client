import math
import re

from actors.actor_unit_inventory import CHARACTER_PART_NAME, NO_MESH_IN_ROW_REASON
from actors.npc_requests import ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN, validate_gap_row

CHARGRP_TABLE_NAME = 'chargrp'
CHARGRP_ROW_COLLECTION = 'Char'
CLASSINFO_TABLE_NAME = 'classinfo-e'
CHARACTER_STEP = 'characters'
BODY_MESH_GROUP, BODY_TEXTURE_GROUP = 'body_mesh', 'body_texture'
BODY_MESH_FIELD_PATTERN = re.compile(r'^body_mesh([1-9][0-9]*)$')
FACE_MESH_GROUP, FACE_MESH_FIELD = 'face_mesh', 'param_face_mesh'
FACE_TEXTURE_GROUP, FACE_TEXTURE_FIELD = 'face_texture', 'param_face_texture'
CLASSINFO_CHARGRP_INDEX_FIELD = 'chargrp_index'
CLASSINFO_ACTOR_CLASS_FIELD = 'actor_class'
CONVERTER_ASSEMBLY_PART_LIMIT = 16
ASSEMBLY_PART_LIMIT_EXCEEDED_REASON_PREFIX = 'assembly-part-limit-exceeded:'
CLASS_TEMPLATE_MAPPING_UNDECODED_REASON = 'class-template-mapping-undecoded'
CHARACTER_CLASS_SOURCES_RELATIVE_PATH = 'docs/parts/player-characters/character-class-sources.json'
CLASS_SOURCES_ROUTE = 'character-class-sources'
ADOPTED_CLASS_SOURCES_VERDICT, NOT_DECIDED_CLASS_SOURCES_VERDICT = 'adopted', 'not-decided'
HEAD_BONE_FIELD, RIGHT_HAND_BONE_FIELD, SUB_MESHES_FIELD, CLASS_MESH_FIELD = 'HeadBone', 'RightHandBone', 'SubMeshes', 'Mesh'
COLLISION_SOURCE_FIELDS = (('collisionRadius', 'CollisionRadius'), ('collisionHeight', 'CollisionHeight'))
DRAW_SCALE_FIELD, DRAW_SCALE_3D_FIELD, PRE_PIVOT_FIELD = 'DrawScale', 'DrawScale3D', 'PrePivot'
VECTOR_AXES = ('X', 'Y', 'Z')
CHARACTER_PIVOT_UNAPPLIED_REASON = 'character-pivot-unapplied'
PROFILE_REQUIRED_FAMILY_FIELDS = ('WaitAnimName', 'RunAnimName', 'Atk01AnimName', 'DeathAnimName')
PROFILE_WEAPON_TYPE = 'WT_HAND'
REQUESTED_STATUS, UNBOUND_TEXTURE_STATUS, BOUND_STATUS, GAP_STATUS, RESOLVED_STATUS = 'requested', 'requested-unbound', 'bound', 'gap', 'resolved'
DECODED_STATUS = 'decoded'
FACE_FIELD_NAME, HAIR_FIELD_NAME = 'face', 'hair'
HAIR_SELECTION_FIELD = 'hairSelection'
HAIR_EXPORT_UNRESOLVED_REASON_PREFIX, HAIR_SUBMESH_UNLISTED_REASON_PREFIX = 'hair-export-unresolved:', 'hair-submesh-unlisted:'
DYNAMIC_HAIR_SIMULATION_UNPORTED_REASON_PREFIX = 'dynamic-hair-simulation-unported:'
HAIR_HALF_NONE_STATUS, HAIR_HALF_RESOLVED_STATUS = 'none', 'resolved'
HAIR_HALF_DYNAMIC_ROUTE = 'dynamic'
HELMET_APPLIED_BY = 'equipment-03-30'
CHARACTER_REQUEST_LIMITATIONS = (
    'Generated from the decoded chargrp row: body parts follow body_mesh1 upward with their body_texture fields; no recipe value is copied.',
    'The face attaches only through a source-joined actor class.',
    'Hair halves come from the RM-11 hairgrp rule at the default appearance, HairStyle 0 and HairColor 0, with the face texture at Face 0, '
    'until a server packet selects another one (Phase 4); group-less names resolve by the RM-13 leaf and class rule, and dynamic halves stay a gap (RM-14).',
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
    part = {'package': package_name, 'object': object_name, 'materials': [f'0={texture}'] if texture else []}
    if texture_path is not None:
        part['sourceBinding'] = {'table': CHARGRP_TABLE_NAME, 'sourceSha256': chargrp_table['sourceSha256'], 'meshPath': mesh_path,
                                 'texturePath': texture_path}
    return part


def body_parts(chargrp_row, row_index, chargrp_table):
    parts, statuses = [], []
    for mesh_field, texture_field in body_mesh_field_pairs(chargrp_row):
        mesh, texture = chargrp_row[BODY_MESH_GROUP][mesh_field], chargrp_row[BODY_TEXTURE_GROUP].get(texture_field, '')
        reason = (NO_MESH_IN_ROW_REASON if not mesh else
                  unqualified_reference_reason(mesh_field, mesh) or (texture and unqualified_reference_reason(texture_field, texture)) or None)
        if reason:
            statuses.append(part_status(mesh_field, GAP_STATUS, reason))
            continue
        texture_path = ([CHARGRP_ROW_COLLECTION, row_index, BODY_TEXTURE_GROUP, texture_field]
                        if texture_field in chargrp_row[BODY_TEXTURE_GROUP] else None)
        parts.append(table_mesh_part(mesh, texture, [CHARGRP_ROW_COLLECTION, row_index, BODY_MESH_GROUP, mesh_field], texture_path,
                                     chargrp_table))
        statuses.append(part_status(mesh_field, REQUESTED_STATUS if texture else UNBOUND_TEXTURE_STATUS))
    return parts, statuses


def class_head_bone_reason(actor_class):
    if actor_class is None:
        return CLASS_TEMPLATE_MAPPING_UNDECODED_REASON
    head_bone = actor_class['properties'].get(HEAD_BONE_FIELD)
    return None if isinstance(head_bone, str) and head_bone else ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + HEAD_BONE_FIELD


def class_face_mesh_reason(actor_class, face_mesh):
    class_mesh = actor_class['properties'].get(CLASS_MESH_FIELD)
    class_mesh_object = class_mesh.get('object') if isinstance(class_mesh, dict) else None
    matches = isinstance(class_mesh_object, str) and class_mesh_object.casefold() == face_mesh.casefold()
    return None if matches else ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + CLASS_MESH_FIELD


def rigid_head_attachment(actor_class, mesh_path):
    return {'bone': actor_class['properties'][HEAD_BONE_FIELD],
            'source': {'class': actor_class['class'], 'packageSha256': actor_class['packageSha256'], 'bonePath': [HEAD_BONE_FIELD],
                       'meshPath': mesh_path}}


def face_part(chargrp_row, row_index, chargrp_table, actor_class, face):
    meshes = [entry[FACE_MESH_FIELD] for entry in chargrp_row[FACE_MESH_GROUP]]
    texture_entries = chargrp_row[FACE_TEXTURE_GROUP]
    reason = (NO_MESH_IN_ROW_REASON if len(meshes) != 1 or not meshes[0] else
              unqualified_reference_reason(FACE_MESH_FIELD, meshes[0]) or class_head_bone_reason(actor_class)
              or class_face_mesh_reason(actor_class, meshes[0]))
    if reason:
        return None, part_status(FACE_FIELD_NAME, GAP_STATUS, reason)
    selected = face < len(texture_entries)
    texture = texture_entries[face][FACE_TEXTURE_FIELD] if selected else ''
    part = table_mesh_part(actor_class['properties'][CLASS_MESH_FIELD]['object'], texture, [CHARGRP_ROW_COLLECTION, row_index, FACE_MESH_GROUP, 0, FACE_MESH_FIELD],
                           [CHARGRP_ROW_COLLECTION, row_index, FACE_TEXTURE_GROUP, face, FACE_TEXTURE_FIELD] if selected else None,
                           chargrp_table)
    part['rigidAttachment'] = rigid_head_attachment(actor_class, [CLASS_MESH_FIELD])
    return part, part_status(FACE_FIELD_NAME, REQUESTED_STATUS if texture else UNBOUND_TEXTURE_STATUS)


def unbound_face_limitation(chargrp_row, row_index, actor_class, face):
    return (f'The face mesh is chargrp {CHARGRP_ROW_COLLECTION}/{row_index}/{FACE_MESH_GROUP}/0, checked against the {actor_class["class"]} '
            f'{CLASS_MESH_FIELD} default; its {len(chargrp_row[FACE_TEXTURE_GROUP])} {FACE_TEXTURE_GROUP} entries hold no entry for Face {face}, '
            'so slot 0 stays unbound.')


def classinfo_rows(classinfo_table):
    collections = [value for value in classinfo_table['records'].values() if isinstance(value, list)]
    if len(collections) != 1:
        raise CharacterRequestError(f'{CLASSINFO_TABLE_NAME} manifest must hold exactly one record list')
    return collections[0]


def classinfo_class_resolution(classinfo_table, row_index):
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


def class_sources_resolution(class_sources, row_index):
    document = class_sources['document']
    entry = document['rows'].get(str(row_index))
    evidence = {'path': class_sources['path'], 'resultSha256': class_sources['sha256'], 'verdict': document['verdict'],
                'candidateCount': entry['candidateCount'] if entry else 0}
    actor_class = entry['actorClass'] if entry and document['verdict'] == ADOPTED_CLASS_SOURCES_VERDICT else None
    if not (isinstance(actor_class, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(actor_class)):
        return {'class': None, 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, 'evidence': evidence}
    return {'class': actor_class, 'reason': None, 'evidence': {**evidence, 'classPackageSha256': entry['classPackageSha256']}}


def resolve_character_actor_class(classinfo_table, class_sources, row_index):
    classinfo = classinfo_class_resolution(classinfo_table, row_index)
    if classinfo['class']:
        return {**classinfo, 'route': CLASSINFO_TABLE_NAME, 'evidence': {'classinfo': classinfo['evidence']}}
    sourced = class_sources_resolution(class_sources, row_index)
    return {**sourced, 'route': CLASS_SOURCES_ROUTE if sourced['class'] else None,
            'evidence': {'classinfo': classinfo['evidence'], 'classSources': sourced['evidence']}}


def actor_class_join_limitation(actor_class):
    join = actor_class['joinSource']
    return (f'The actor class {actor_class["class"]} (package sha256 {actor_class["packageSha256"]}) is joined to this chargrp row by '
            f'{join["source"]} (sha256 {join["sha256"]}).')


def hair_half_summary(half):
    summary = {'half': half['half'], 'pawnSlot': half['pawnSlot'], 'mappedStyle': half['mappedStyle'], 'status': half['status']}
    return ({**summary, 'mesh': half['mesh']['object'], 'material': half['material']['object'], 'route': half['route']}
            if half['status'] == HAIR_HALF_RESOLVED_STATUS else summary)


def class_sub_mesh_index(actor_class, mesh_object):
    sub_meshes = actor_class['properties'].get(SUB_MESHES_FIELD, [])
    matching = [index for index, mesh in enumerate(sub_meshes) if isinstance(mesh, dict) and isinstance(mesh.get('object'), str)
                and mesh['object'].casefold() == mesh_object.casefold()]
    return matching[0] if len(matching) == 1 else None


def hair_half_part(half, mesh_type, hair_parts, actor_class):
    sub_mesh_index = class_sub_mesh_index(actor_class, half['mesh']['object'])
    if sub_mesh_index is None:
        return None
    package_name, object_name = actor_class['properties'][SUB_MESHES_FIELD][sub_mesh_index]['object'].split('.', 1)
    selection = {'recipe': hair_parts['path'], 'recipeSha256': hair_parts['sha256'], 'meshType': mesh_type['meshType'], 'half': half['half'],
                 'pawnSlot': half['pawnSlot'], 'mappedStyle': half['mappedStyle'], 'hairColor': hair_parts['defaultAppearance']['hairColor'],
                 'route': half['route']}
    return {'package': package_name, 'object': object_name, 'materials': [f'0={half["material"]["object"]}'], HAIR_SELECTION_FIELD: selection,
            'rigidAttachment': rigid_head_attachment(actor_class, [SUB_MESHES_FIELD, sub_mesh_index])}


def hair_parts_and_binding(row_index, actor_class, hair_parts):
    mesh_type = hair_parts['byChargrpRow'].get(row_index)
    if mesh_type is None:
        raise CharacterRequestError(f'{hair_parts["path"]} holds no mesh type for chargrp row {row_index}; rerun scripts/actors/character_hair_recipe.py')
    appearance = {field: hair_parts['defaultAppearance'][field] for field in ('hairStyle', 'hairColor', 'face')}
    parts, reasons, class_reason = [], [], class_head_bone_reason(actor_class)
    for half in mesh_type['defaultHalves']:
        if half['status'] == HAIR_HALF_NONE_STATUS:
            continue
        if half['status'] != HAIR_HALF_RESOLVED_STATUS:
            reasons.append(HAIR_EXPORT_UNRESOLVED_REASON_PREFIX + half['half'])
            continue
        if half['route'] == HAIR_HALF_DYNAMIC_ROUTE:
            reasons.append(DYNAMIC_HAIR_SIMULATION_UNPORTED_REASON_PREFIX + half['half'])
            continue
        part = None if class_reason else hair_half_part(half, mesh_type, hair_parts, actor_class)
        if part is None:
            reasons.append(class_reason or HAIR_SUBMESH_UNLISTED_REASON_PREFIX + half['half'])
            continue
        parts.append(part)
    binding = {'status': GAP_STATUS if reasons else BOUND_STATUS, 'reason': reasons[0] if reasons else None, 'appearance': appearance,
               'meshType': mesh_type['meshType'], 'halves': [hair_half_summary(half) for half in mesh_type['defaultHalves']]}
    return parts, binding, [{'field': HAIR_FIELD_NAME, 'reason': reason} for reason in reasons]


def is_finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def positive_number_value(properties, source_field):
    value = properties.get(source_field)
    return value if is_finite_number(value) and value > 0 else None


def finite_vector_value(properties, source_field):
    value = properties.get(source_field)
    return value if isinstance(value, dict) and set(value) == set(VECTOR_AXES) and all(is_finite_number(value[axis]) for axis in VECTOR_AXES) else None


def positive_vector_value(properties, source_field):
    value = finite_vector_value(properties, source_field)
    return value if value is not None and all(value[axis] > 0 for axis in VECTOR_AXES) else None


def class_supplying_field(class_reference, source_field, read_class_definition, read_value=positive_number_value):
    reference, chain = class_reference, []
    while reference:
        if reference in chain:
            raise CharacterRequestError(f'cyclic class chain at {reference}')
        chain.append(reference)
        definition = read_class_definition(reference)
        value = read_value(definition['properties'], source_field)
        if value is not None:
            return {'value': value, 'class': reference}
        reference = definition['nativeSuperClass']
    return {'reason': ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + source_field, 'classChain': chain}


def collision_from_class_chain(class_reference, read_class_definition):
    return {profile_field: class_supplying_field(class_reference, source_field, read_class_definition)
            for profile_field, source_field in COLLISION_SOURCE_FIELDS}


def presentation_from_class_chain(class_reference, read_class_definition):
    return {'drawScale': class_supplying_field(class_reference, DRAW_SCALE_FIELD, read_class_definition),
            'drawScale3D': class_supplying_field(class_reference, DRAW_SCALE_3D_FIELD, read_class_definition, positive_vector_value),
            'prePivot': class_supplying_field(class_reference, PRE_PIVOT_FIELD, read_class_definition, finite_vector_value)}


def presentation_reason(presentation):
    scale_reason = next((presentation[field]['reason'] for field in ('drawScale', 'drawScale3D') if 'reason' in presentation[field]), None)
    pivot = presentation['prePivot'].get('value')
    return scale_reason or (CHARACTER_PIVOT_UNAPPLIED_REASON if pivot and any(pivot[axis] != 0 for axis in VECTOR_AXES) else None)


def animation_families_of_class(animation_families, class_reference):
    family = animation_families['byClass'].get(class_reference)
    if family is None:
        return None
    return {'recipe': animation_families['path'], 'recipeSha256': animation_families['sha256'], 'familySource': animation_families['source'],
            'meshType': family['meshType'], 'section': family['section'], 'getters': animation_families['getters'],
            'byWeaponType': [{'weaponType': slot['weaponType'], 'values': slot['values'], 'lines': slot['lines']} for slot in family['weaponTypes']]}


def profile_weapon_type_slot(families_of_class):
    slots = [slot for slot in families_of_class['byWeaponType'] if slot['weaponType'] == PROFILE_WEAPON_TYPE] if families_of_class else []
    return slots[0] if slots else {'values': {}, 'lines': {}}


def character_profile_fields(actor_class, read_class_definition, animation_families):
    if actor_class is None:
        return {'status': GAP_STATUS, 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, 'collision': None, 'presentation': None,
                'actorClassDefaults': None, 'animationFamilies': None}
    collision = collision_from_class_chain(actor_class['class'], read_class_definition)
    presentation = presentation_from_class_chain(actor_class['class'], read_class_definition)
    properties = actor_class['properties']
    class_defaults = {'class': actor_class['class'], 'classPackageSha256': actor_class['packageSha256'],
                      HEAD_BONE_FIELD: properties.get(HEAD_BONE_FIELD), RIGHT_HAND_BONE_FIELD: properties.get(RIGHT_HAND_BONE_FIELD)}
    families_of_class = animation_families_of_class(animation_families, actor_class['class'])
    profile_values = profile_weapon_type_slot(families_of_class)['values']
    unsourced_reasons = [ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + field for field in PROFILE_REQUIRED_FAMILY_FIELDS if profile_values.get(field) is None]
    reason = (next((entry['reason'] for entry in collision.values() if 'reason' in entry), None) or next(iter(unsourced_reasons), None)
              or presentation_reason(presentation))
    return {'status': GAP_STATUS if reason else RESOLVED_STATUS, 'reason': reason, 'collision': collision, 'presentation': presentation,
            'actorClassDefaults': class_defaults, 'animationFamilies': families_of_class}


def root_mesh_animation_source(actor_class):
    if actor_class is None:
        return {'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON}
    class_mesh = actor_class['properties'].get(CLASS_MESH_FIELD)
    mesh_object = class_mesh.get('object') if isinstance(class_mesh, dict) else None
    if not (isinstance(mesh_object, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(mesh_object)):
        return {'reason': ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + CLASS_MESH_FIELD}
    package_name, object_name = mesh_object.split('.', 1)
    return {'reason': None, 'package': package_name, 'object': object_name, 'class': actor_class['class'],
            'classPackageSha256': actor_class['packageSha256'], 'meshPath': [CLASS_MESH_FIELD]}


def root_mesh_animation_limitation(root_mesh, animation_families):
    return (f'The animation set is the Animation that the {root_mesh["class"]} {CLASS_MESH_FIELD} default {root_mesh["package"]}.'
            f'{root_mesh["object"]} serializes, the root mesh binding recorded in {animation_families["path"]} (sha256 {animation_families["sha256"]}).')


def build_character_request(chargrp_row, row_index, actor_class, sources):
    parts, statuses = body_parts(chargrp_row, row_index, sources.chargrp)
    face_index = sources.hair_parts['defaultAppearance']['face']
    face, face_status = face_part(chargrp_row, row_index, sources.chargrp, actor_class, face_index)
    hair_parts, hair, hair_gaps = hair_parts_and_binding(row_index, actor_class, sources.hair_parts)
    helmet = {'status': DECODED_STATUS, 'reason': None, 'appliedBy': HELMET_APPLIED_BY}
    parts += ([face] if face else []) + hair_parts
    gaps = [{'field': status['field'], 'reason': status['reason']} for status in statuses + [face_status] if status['status'] == GAP_STATUS]
    gaps += hair_gaps
    request, root_mesh = None, root_mesh_animation_source(actor_class)
    if len(parts) > CONVERTER_ASSEMBLY_PART_LIMIT:
        gaps.insert(0, {'field': 'parts', 'reason': ASSEMBLY_PART_LIMIT_EXCEEDED_REASON_PREFIX + str(len(parts))})
    elif parts:
        limitations = (list(CHARACTER_REQUEST_LIMITATIONS) + ([actor_class_join_limitation(actor_class)] if actor_class else [])
                       + ([unbound_face_limitation(chargrp_row, row_index, actor_class, face_index)] if face and 'sourceBinding' not in face else [])
                       + ([root_mesh_animation_limitation(root_mesh, sources.animation_families)] if root_mesh['reason'] is None else []))
        request = {'kind': 'model', 'name': character_key(row_index).replace(':', '-'), 'animation': None, 'withEventAudio': True,
                   'parts': parts, 'limitations': limitations}
    return {'request': request, 'rootMesh': root_mesh,
            'profileFields': character_profile_fields(actor_class, sources.read_class_definition, sources.animation_families),
            'parts': statuses + [face_status], 'hair': hair, 'helmet': helmet, 'gaps': gaps}


def character_gap_rows(row_index, step, status, reason, source_identity, evidence):
    return [validate_gap_row({'key': character_key(row_index), 'part': CHARACTER_PART_NAME, 'step': step, 'status': status,
                              'reason': reason, 'sourceIdentity': source_identity, 'evidence': evidence})]
