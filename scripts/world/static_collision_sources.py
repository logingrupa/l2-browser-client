import json
from pathlib import Path
import struct
from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError
from native_catalog.ue2 import FormatError

COLLISION_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'collision-declaration-rules.json'
COLLISION_RULES_SCHEMA_VERSION = 1
CONSTANTS_ROW_FIELDS = frozenset({'id', 'value', 'provenance', 'status', 'interludeEvidence', 'runtimeDefault'})
CONSTANTS_ROW_STATUSES = ('ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown')
COLLISION_UNREADABLE_REASON = 'collision-unreadable'
DECLARED_NONE_DECISION = 'declared-none'
SLOTS_DECISION = 'slots'
BLOCKING_DECISION = 'blocking'
GAP_DECISION = 'gap'
SERIALIZED_STATUS = 'serialized'
DECODED_PROPERTY_STATUS = 'decoded'
UE_ZERO_PROVENANCE = 'ue-zero'
ENABLE_COLLISION_FIELD = 'EnableCollision'
COLLISION_MODEL_SELECTOR = 'CollisionModel'
UNRESOLVED_INTRINSIC_SELECTORS_EVIDENCE = 'selectors:unresolved-intrinsic'
GLTF_TO_SOURCE_UNITS = 100.0
GLTF_TO_SOURCE_AXIS_ORDER = (0, 2, 1)
INDEX_FORMAT_OF_COMPONENT = {5121: 'B', 5123: 'H', 5125: 'I'}
GLTF_FLOAT_COMPONENT = 5126
GLTF_TRIANGLES_MODE = 4


class CollisionRules(NamedTuple):
    volume_classes: tuple
    placement_class: str
    blocking_fields: tuple
    cross_check_fields: tuple
    transform_fields: tuple
    selector_fields: tuple
    rows: tuple


def load_collision_rules(path=COLLISION_RULES_PATH):
    document = json.loads(Path(path).read_text(encoding='utf-8'))
    if document.get('schemaVersion') != COLLISION_RULES_SCHEMA_VERSION:
        raise FormatError(f'collision declaration rules must be schemaVersion {COLLISION_RULES_SCHEMA_VERSION}: {path}')
    for row in document['rules']:
        if not (isinstance(row, dict) and set(row) == CONSTANTS_ROW_FIELDS and isinstance(row['provenance'], str) and row['provenance']
                and row['status'] in CONSTANTS_ROW_STATUSES):
            raise FormatError(f'collision declaration rule row is invalid: {row!r}')
    return CollisionRules(tuple(document['volumeClasses']), document['placementClass'], tuple(document['blockingFlagFields']),
                          tuple(document['crossCheckFlagFields']), tuple(document['transformFields']),
                          tuple(document['staticMeshSelectorFields']), tuple(row['id'] for row in document['rules']))


def serialized_actor_value(actor, field):
    record = actor['collision'].get(field)
    if record is not None and record['status'] == SERIALIZED_STATUS:
        return True, record['value']
    decoded = [prop for prop in actor['properties'] if prop['name'] == field and prop['status'] == DECODED_PROPERTY_STATUS]
    return (True, decoded[-1]['value']) if decoded else (False, None)


def class_default_or_none(class_defaults, class_name, field):
    try:
        return class_defaults.values(class_name, [field])[field]
    except ClassDefaultError:
        return None


def resolve_actor_flags(actor, class_defaults, fields):
    values, provenance = {}, {}
    for field in dict.fromkeys(fields):
        serialized, value = serialized_actor_value(actor, field)
        if serialized:
            values[field], provenance[field] = value if type(value) is bool else None, 'authored'
            continue
        default = class_default_or_none(class_defaults, actor['classObject'], field)
        if default is None:
            values[field], provenance[field] = None, None
        elif default.provenance == UE_ZERO_PROVENANCE:
            values[field], provenance[field] = False, UE_ZERO_PROVENANCE
        else:
            values[field], provenance[field] = default.value if type(default.value) is bool else None, 'class-default'
    return values, provenance


def blocking_decision(values, rules):
    for field in (*rules.blocking_fields, *rules.cross_check_fields):
        if values.get(field) is None:
            return GAP_DECISION, [f'field:{field}']
    blocking = all(values[field] for field in rules.blocking_fields)
    if blocking != all(values[field] for field in rules.cross_check_fields):
        return GAP_DECISION, [f'rule-disagreement:{next(field for field in rules.cross_check_fields if not values[field])}']
    return (SLOTS_DECISION if blocking else DECLARED_NONE_DECISION), []


def selector_evidence(static_mesh_selectors, rules):
    unresolved = [field for field in rules.selector_fields if field not in static_mesh_selectors]
    routed = [field for field, value in static_mesh_selectors.items()
              if (field == COLLISION_MODEL_SELECTOR and value is not None) or (field != COLLISION_MODEL_SELECTOR and value is True)]
    return routed, [UNRESOLVED_INTRINSIC_SELECTORS_EVIDENCE + ':' + ','.join(unresolved)] if unresolved else []


def decide_placement_collision(placement, class_evidence, model_slot_properties, static_mesh_selectors, rules=None):
    rules = rules or load_collision_rules()
    values, provenance = resolve_actor_flags(placement, class_evidence, (*rules.blocking_fields, *rules.cross_check_fields))
    record = {'placementId': placement['id'], 'exportIndex': placement['exportIndex'], 'decision': None, 'slots': [], 'evidence': [],
              'provenance': provenance}
    decision, evidence = blocking_decision(values, rules)
    if decision != SLOTS_DECISION:
        return {**record, 'decision': decision, 'evidence': evidence}
    if model_slot_properties is None:
        return {**record, 'decision': GAP_DECISION, 'evidence': ['field:nativeSlotProperties']}
    routed, selector_notes = selector_evidence(static_mesh_selectors, rules)
    if routed:
        return {**record, 'decision': GAP_DECISION, 'evidence': [f'field:{routed[0]}']}
    if any(type(properties.get(ENABLE_COLLISION_FIELD)) is not bool for properties in model_slot_properties):
        return {**record, 'decision': GAP_DECISION, 'evidence': [f'field:{ENABLE_COLLISION_FIELD}']}
    slots = [index for index, properties in enumerate(model_slot_properties) if properties[ENABLE_COLLISION_FIELD]]
    return {**record, 'decision': SLOTS_DECISION, 'slots': slots, 'evidence': selector_notes}


def glb_document_and_binary(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    binary_length = struct.unpack_from('<I', glb, 20 + json_length)[0]
    return json.loads(glb[20:20 + json_length]), glb[28 + json_length:28 + json_length + binary_length]


def accessor_rows(document, binary, accessor_index, components, formats):
    accessor = document['accessors'][accessor_index]
    view = document['bufferViews'][accessor['bufferView']]
    component_format = formats.get(accessor['componentType'])
    if component_format is None or 'byteStride' in view or 'sparse' in accessor:
        raise FormatError(f'converted model accessor {accessor_index} has an unsupported layout')
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    values = struct.unpack_from(f'<{accessor["count"] * components}{component_format}', binary, start)
    return [values[index:index + components] for index in range(0, len(values), components)]


def model_slot_properties(glb):
    document, _ = glb_document_and_binary(glb)
    return [material.get('extras', {}).get('nativeSlotProperties', {}) for material in document.get('materials', [])]


def static_mesh_collision_triangles(glb, slots):
    document, binary = glb_document_and_binary(glb)
    if any(set(node) - {'mesh', 'name', 'children'} for node in document['nodes']):
        raise FormatError('converted model nodes carry a transform; collision triangles need mesh-local positions')
    positions, indices = [], []
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            slot = document['materials'][primitive['material']].get('extras', {}).get('nativeSectionIndex')
            if slot not in slots:
                continue
            if primitive.get('mode', GLTF_TRIANGLES_MODE) != GLTF_TRIANGLES_MODE:
                raise FormatError('converted model primitive is not a triangle list')
            first_vertex = len(positions)
            for row in accessor_rows(document, binary, primitive['attributes']['POSITION'], 3, {GLTF_FLOAT_COMPONENT: 'f'}):
                positions.append([row[axis] * GLTF_TO_SOURCE_UNITS for axis in GLTF_TO_SOURCE_AXIS_ORDER])
            gltf_indices = [row[0] for row in accessor_rows(document, binary, primitive['indices'], 1, INDEX_FORMAT_OF_COMPONENT)]
            for corner in range(0, len(gltf_indices) - 2, 3):
                first, second, third = gltf_indices[corner:corner + 3]
                indices.extend((first_vertex + first, first_vertex + third, first_vertex + second))
    return positions, indices
