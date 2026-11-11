from __future__ import annotations

import hashlib
from types import MappingProxyType

from native_assets_lib.class_defaults import read_class_defaults_with_provenance, read_class_field_declarations
from native_assets_lib.material_graph import ARRAY_PROPERTY_TYPE, OBJECT_PROPERTY_TYPE, material_feature_unported_reason
from native_store.canonical_json import canonical_json_bytes

MATERIAL_PROGRAM_SCHEMA_VERSION = 1
MATERIAL_PROGRAM_KIND = 'ue2-material-program'
CORE_OBJECT_CLASS = 'Core.Object'
BYTE_PROPERTY_TYPE = 1
PROGRAM_PROVENANCE_OF_CLASS_DEFAULT = {'authored': 'class-default', 'class-default': 'class-default', 'ue-zero': 'ue-zero'}
UNCONFIRMED_ENUM_MEMBERS = {('Engine.FinalBlend', 'FrameBufferBlending'): ('FB_Add',)}
TRIGGER_IGNORING_ENUM_MEMBERS = {('Engine.MaterialSequence', 'TriggerAction'): 'MSTA_Ignore'}
TEXTURE_CLASS = 'Engine.Texture'
NO_TEXTURE_IMAGES = MappingProxyType({})


class MaterialProgramError(ValueError):
    pass


def material_graph_sha256(graph):
    return hashlib.sha256(canonical_json_bytes(graph)).hexdigest()


def read_material_class_defaults(graph, work_root, class_scripts):
    class_defaults = {}
    for class_object in sorted({node['classObject'] for node in graph['nodes'] if node['status'] == 'reviewed'}):
        declarations = [declaration for declaration in read_class_field_declarations(class_object, work_root, class_scripts)
                        if declaration.declaring_class != CORE_OBJECT_CLASS]
        values = read_class_defaults_with_provenance(class_object, [declaration.field for declaration in declarations],
                                                     work_root, class_scripts) if declarations else []
        class_defaults[class_object] = [{**declaration.to_record(), 'classDefault': value.to_record()}
                                        for declaration, value in zip(declarations, values)]
    return class_defaults


def enum_value(ordinal, members, node_id, field):
    if not (type(ordinal) is int and 0 <= ordinal < len(members)):
        raise MaterialProgramError(f'{node_id}.{field} enum ordinal {ordinal!r} lies outside {len(members)} declared members')
    return {'ordinal': ordinal, 'name': members[ordinal]}


def typed_tag_value(tag, declaration, node_id):
    if tag['type'] == OBJECT_PROPERTY_TYPE:
        index, object_name = tag['value']['index'], tag['value']['object']
        if index == 0:
            return None, 'typed'
        return ({'node': object_name} if index > 0 else {'externalObject': object_name}), 'typed'
    if tag['status'] != 'decoded':
        raw = {'rawHex': tag['payloadHex'], 'propertyType': tag['type'], 'structName': tag['structName']}
        return raw, 'unported' if tag['type'] == ARRAY_PROPERTY_TYPE else 'raw'
    members = declaration['enumMembers'] if declaration else None
    if members and tag['type'] == BYTE_PROPERTY_TYPE:
        return enum_value(tag['value'], members, node_id, tag['name']), 'typed'
    return tag['value'], 'typed'


def authored_field_value(tags, declaration, node_id):
    if len(tags) == 1 and tags[0]['arrayIndex'] is None:
        return typed_tag_value(tags[0], declaration, node_id)
    elements_by_index = {}
    for tag in tags:
        array_index = tag['arrayIndex'] or 0
        if array_index in elements_by_index:
            raise MaterialProgramError(f'{node_id}.{tag["name"]} repeats array index {array_index}')
        elements_by_index[array_index] = typed_tag_value(tag, declaration, node_id)
    elements = [elements_by_index.get(index, (None, 'typed')) for index in range(max(elements_by_index) + 1)]
    statuses = {status for _, status in elements}
    status = 'unported' if 'unported' in statuses else 'raw' if 'raw' in statuses else 'typed'
    return [value for value, _ in elements], status


def class_default_field_value(declaration, node_id):
    value, members = declaration['classDefault']['value'], declaration['enumMembers']
    if members and type(value) is int:
        return enum_value(value, members, node_id, declaration['field'])
    if members and isinstance(value, dict) and set(value) == {'symbol'} and value['symbol'] in members:
        return {'ordinal': members.index(value['symbol']), 'name': value['symbol']}
    return value


def declared_program_field(declaration, tags, node_id):
    record = {'field': declaration['field'], 'declaredType': declaration['declaredType'], 'declaringClass': declaration['declaringClass']}
    if tags:
        value, status = authored_field_value(tags, declaration, node_id)
        return {**record, 'provenance': 'authored', 'value': value, 'status': status}
    class_default = declaration['classDefault']
    return {**record, 'provenance': PROGRAM_PROVENANCE_OF_CLASS_DEFAULT[class_default['provenance']],
            'valueDeclaringClass': class_default['declaringClass'], 'value': class_default_field_value(declaration, node_id),
            'status': 'typed'}


def undeclared_program_field(tags, node_id):
    value, _ = authored_field_value(tags, None, node_id)
    return {'field': tags[0]['name'], 'declaredType': None, 'declaringClass': None, 'provenance': 'authored', 'value': value,
            'status': 'unported'}


def enum_name_of(field):
    return field['value']['name'] if isinstance(field['value'], dict) and 'name' in field['value'] else None


def apply_unported_value_rules(class_object, field):
    key = (class_object, field['field'])
    if enum_name_of(field) in UNCONFIRMED_ENUM_MEMBERS.get(key, ()):
        return {**field, 'status': 'unconfirmed'}, material_feature_unported_reason(field['field'])
    ignoring_member = TRIGGER_IGNORING_ENUM_MEMBERS.get(key)
    if ignoring_member is not None and field['provenance'] != 'ue-zero' and enum_name_of(field) != ignoring_member:
        return {**field, 'status': 'unported'}, material_feature_unported_reason(field['field'])
    if field['status'] == 'unported':
        return field, material_feature_unported_reason(field['field'])
    return field, None


def reviewed_program_fields(node, declarations):
    tags_by_field = {}
    for tag in node['propertyTags']:
        tags_by_field.setdefault(tag['name'].casefold(), []).append(tag)
    fields = [declared_program_field(declaration, tags_by_field.pop(declaration['field'].casefold(), []), node['object'])
              for declaration in declarations]
    fields.extend(undeclared_program_field(tags, node['object']) for tags in tags_by_field.values())
    checked_fields, reasons = [], set(node['gapReasons'])
    for field in fields:
        checked_field, reason = apply_unported_value_rules(node['classObject'], field)
        checked_fields.append(checked_field)
        if reason is not None:
            reasons.add(reason)
    return checked_fields, sorted(reasons)


def program_node(node, class_defaults, texture_images):
    record = {'id': node['object'], 'class': node['classObject'], 'status': node['status']}
    if node['classObject'] == TEXTURE_CLASS:
        record['image'] = texture_images.get(node['object'])
    if node['status'] != 'reviewed':
        return {**record, 'gapReasons': list(node['gapReasons']), 'fields': []}
    if node['classObject'] not in class_defaults:
        raise MaterialProgramError(f'no class defaults were read for {node["classObject"]} of {node["object"]}')
    fields, reasons = reviewed_program_fields(node, class_defaults[node['classObject']])
    return {**record, 'gapReasons': reasons, 'fields': fields}


def derive_material_program(graph, class_defaults, texture_images=NO_TEXTURE_IMAGES):
    nodes = [program_node(node, class_defaults, texture_images) for node in graph['nodes']]
    return {'schemaVersion': MATERIAL_PROGRAM_SCHEMA_VERSION, 'kind': MATERIAL_PROGRAM_KIND, 'graphSha256': material_graph_sha256(graph),
            'root': graph['root'], 'nodes': nodes,
            'gapReasons': sorted(set(graph['gapReasons']) | {reason for node in nodes for reason in node['gapReasons']})}
