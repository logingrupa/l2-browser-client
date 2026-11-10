from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError
from native_effect_bundle import object_values
from world.map_actor_properties import actor_properties
from world.static_placement import placement_provenance

AUTHORED_PROVENANCE = 'authored'
UNRESOLVED_PROVENANCE = 'unresolved'
COLOR_STRUCT_NAME = 'Color'
SERIALIZED_COLOR_CHANNEL_ORDER = ('R', 'G', 'B', 'A')


class ActorField(NamedTuple):
    field: str
    value: object
    provenance: str
    declaring_class: str | None

    def to_record(self):
        return {'field': self.field, 'value': self.value, 'provenance': self.provenance, 'declaringClass': self.declaring_class}


def decoded_serialized_value(value):
    if isinstance(value, dict) and value.get('struct') == COLOR_STRUCT_NAME and len(value.get('unparsedHex', '')) == 2 * len(SERIALIZED_COLOR_CHANNEL_ORDER):
        return dict(zip(SERIALIZED_COLOR_CHANNEL_ORDER, bytes.fromhex(value['unparsedHex'])))
    return value


def serialized_actor_values(package, export):
    tags, _, _, _ = actor_properties(package, export)
    return object_values(package, tags)


def resolved_actor_field(field, serialized_values, object_class, class_defaults):
    if field in serialized_values:
        return ActorField(field, decoded_serialized_value(serialized_values[field]), AUTHORED_PROVENANCE, object_class)
    try:
        default = class_defaults.values(object_class, [field])[field]
    except ClassDefaultError:
        return ActorField(field, None, UNRESOLVED_PROVENANCE, None)
    return ActorField(field, default.value, placement_provenance(default), default.declaring_class)


def unresolved_actor_field(field):
    return ActorField(field, None, UNRESOLVED_PROVENANCE, None)
