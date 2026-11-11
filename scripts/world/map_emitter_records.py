from typing import NamedTuple

from native_catalog.ue2 import FormatError, Reader
from native_effect_bundle import CONVERTED_EMITTER_CLASSES, object_values
from world.actor_field_values import resolved_actor_field
from world.map_actor_properties import MAXIMUM_ARRAY_ELEMENTS, actor_properties
from world.static_placement import TransformFieldError, resolved_transform_values, static_matrix

EMITTER_ACTOR_CLASS = 'Engine.Emitter'
EMITTERS_PROPERTY = 'Emitters'
ARRAY_PROPERTY_TYPE = 9
ACTOR_RULE_FIELDS = ('GlobalOffsetRange', 'TimeTillResetRange', 'AutoReset', 'AutoDestroy', 'SpeedRate', 'bRotEmitter', 'RotPerSecond')
EMITTER_RULE_FIELDS = ('InitialDelayRange', 'WarmupTicksPerSecond', 'RelativeWarmupTime')
EMITTER_CLASS_UNPORTED_REASON_PREFIX = 'emitter-class-unported:'
EMITTER_STRUCT_UNPARSED_REASON_PREFIX = 'map-emitter-struct-unparsed:'
EMITTER_RESOURCE_UNCONVERTED_REASON_PREFIX = 'map-emitter-resource-unconverted:'
ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX = 'actor-default-unresolved:'
EMITTER_REFERENCE_NOT_LOCAL_REASON = 'decode-failed:emitter-reference-not-local'


class MapEmitterGap(NamedTuple):
    object_name: str
    reason: str


class MapEmitterPlacement(NamedTuple):
    record: dict
    origin: tuple
    gaps: tuple


def emitter_actor_exports(package):
    return sorted((item for item in package.exports if item['classObject'] == EMITTER_ACTOR_CLASS), key=lambda item: item['exportIndex'])


def emitter_references(tags):
    arrays = [tag for tag in tags if tag['name'] == EMITTERS_PROPERTY]
    if not arrays:
        return []
    if len(arrays) != 1 or arrays[0]['type'] != ARRAY_PROPERTY_TYPE:
        raise FormatError('Emitter actor Emitters property is not one object array')
    reader = Reader(bytes.fromhex(arrays[0]['payloadHex']))
    references = [reader.compact() for _ in range(reader.count(MAXIMUM_ARRAY_ELEMENTS))]
    if reader.position != reader.end:
        raise FormatError('Emitter actor Emitters array has trailing bytes')
    return [reference for reference in references if reference != 0]


def emitter_record(package, reference, class_defaults):
    if not 1 <= reference <= len(package.exports):
        raise FormatError(f'Emitter actor names emitter export {reference} outside the export table of {len(package.exports)} exports')
    item = package.exports[reference - 1]
    tags, reader = package.properties(item)
    values = object_values(package, tags)
    return {'object': item['object'], 'class': item['classObject'], 'exportIndex': item['exportIndex'],
            'converted': item['classObject'] in CONVERTED_EMITTER_CLASSES, 'trailingNativeBytes': reader.end - reader.position,
            'rules': [resolved_actor_field(field, values, item['classObject'], class_defaults).to_record() for field in EMITTER_RULE_FIELDS],
            'properties': values}


def emitter_property_entries(properties):
    for name, value in properties.items():
        if isinstance(value, list):
            yield from ((f'{name}[{index}]', element) for index, element in enumerate(value))
        else:
            yield name, value


def is_unparsed_struct(value):
    return isinstance(value, dict) and 'unparsedHex' in value


def is_object_reference(value):
    return isinstance(value, dict) and isinstance(value.get('object'), str)


def emitter_record_gap_reason(record, simulated_emitter_classes):
    if record['class'] not in simulated_emitter_classes:
        return EMITTER_CLASS_UNPORTED_REASON_PREFIX + record['class']
    entries = list(emitter_property_entries(record['properties']))
    unparsed_property = next((label for label, value in entries if is_unparsed_struct(value)), None)
    if unparsed_property is not None:
        return EMITTER_STRUCT_UNPARSED_REASON_PREFIX + unparsed_property
    referenced_object = next((value['object'] for _, value in entries if is_object_reference(value)), None)
    return None if referenced_object is None else EMITTER_RESOURCE_UNCONVERTED_REASON_PREFIX + referenced_object


def emitter_bundle(package, references, class_defaults, simulated_emitter_classes):
    emitters, gaps = [], []
    for reference in references:
        if reference < 0:
            gaps.append(MapEmitterGap(package.object_name(reference), EMITTER_REFERENCE_NOT_LOCAL_REASON))
            continue
        record = emitter_record(package, reference, class_defaults)
        emitters.append(record)
        reason = emitter_record_gap_reason(record, simulated_emitter_classes)
        if reason is not None:
            gaps.append(MapEmitterGap(record['object'], reason))
    return {'emitters': emitters}, gaps


def emitter_source_rows(actor, class_defaults):
    return static_matrix(resolved_transform_values(actor, class_defaults, EMITTER_ACTOR_CLASS))


def read_map_emitter_placement(package, item, actor, class_defaults, simulated_emitter_classes):
    tags, _, _, _ = actor_properties(package, item)
    values = object_values(package, tags)
    try:
        rows = emitter_source_rows(actor, class_defaults)
    except TransformFieldError as error:
        return None, MapEmitterGap(item['object'], ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + error.field)
    bundle, gaps = emitter_bundle(package, emitter_references(tags), class_defaults, simulated_emitter_classes)
    record = {'id': actor['id'], 'exportIndex': item['exportIndex'], 'transform': rows,
              'actorRules': [resolved_actor_field(field, values, EMITTER_ACTOR_CLASS, class_defaults).to_record() for field in ACTOR_RULE_FIELDS],
              'bundle': bundle}
    return MapEmitterPlacement(record, tuple(rows[3][:3]), tuple(gaps)), None
