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
    item = package.exports[reference - 1]
    tags, reader = package.properties(item)
    values = object_values(package, tags)
    return {'object': item['object'], 'class': item['classObject'], 'exportIndex': item['exportIndex'],
            'converted': item['classObject'] in CONVERTED_EMITTER_CLASSES, 'trailingNativeBytes': reader.end - reader.position,
            'rules': [resolved_actor_field(field, values, item['classObject'], class_defaults).to_record() for field in EMITTER_RULE_FIELDS],
            'properties': values}


def emitter_bundle(package, references, class_defaults):
    emitters, gaps = [], []
    for reference in references:
        if reference < 0:
            gaps.append(MapEmitterGap(package.object_name(reference), EMITTER_REFERENCE_NOT_LOCAL_REASON))
            continue
        record = emitter_record(package, reference, class_defaults)
        emitters.append(record)
        if not record['converted']:
            gaps.append(MapEmitterGap(record['object'], EMITTER_CLASS_UNPORTED_REASON_PREFIX + record['class']))
    return {'emitters': emitters}, gaps


def emitter_source_rows(actor, class_defaults):
    return static_matrix(resolved_transform_values(actor, class_defaults, EMITTER_ACTOR_CLASS))


def read_map_emitter_placement(package, item, actor, class_defaults):
    tags, _, _, _ = actor_properties(package, item)
    values = object_values(package, tags)
    try:
        rows = emitter_source_rows(actor, class_defaults)
    except TransformFieldError as error:
        return None, MapEmitterGap(item['object'], ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + error.field)
    bundle, gaps = emitter_bundle(package, emitter_references(tags), class_defaults)
    record = {'id': actor['id'], 'exportIndex': item['exportIndex'], 'transform': rows,
              'actorRules': [resolved_actor_field(field, values, EMITTER_ACTOR_CLASS, class_defaults).to_record() for field in ACTOR_RULE_FIELDS],
              'bundle': bundle}
    return MapEmitterPlacement(record, tuple(rows[3][:3]), tuple(gaps)), None
