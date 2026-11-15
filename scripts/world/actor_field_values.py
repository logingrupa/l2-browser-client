from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError
from world.declared_property_types import declared_property_types
from world.map_actor_properties import actor_properties
from world.static_placement import placement_provenance
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.struct_property_values import decode_property_tags

AUTHORED_PROVENANCE = 'authored'
UNRESOLVED_PROVENANCE = 'unresolved'


class ActorField(NamedTuple):
    field: str
    value: object
    provenance: str
    declaring_class: str | None

    def to_record(self):
        return {'field': self.field, 'value': self.value, 'provenance': self.provenance, 'declaringClass': self.declaring_class}


class SerializedPropertyTags(NamedTuple):
    package: object
    tags_by_field: dict


def serialized_property_tags(package, tags):
    tags_by_field = {}
    for tag in tags:
        tags_by_field.setdefault(tag['name'], []).append(tag)
    return SerializedPropertyTags(package, tags_by_field)


def serialized_actor_values(package, export):
    tags, _, _, _ = actor_properties(package, export)
    return serialized_property_tags(package, tags)


def resolved_actor_field(field, serialized_tags, object_class, class_defaults):
    if field in serialized_tags.tags_by_field:
        values = decode_property_tags(serialized_tags.package, serialized_tags.tags_by_field[field], object_class, declared_property_types(class_defaults),
                                      read_struct_property_tag_rules())
        return ActorField(field, values[field], AUTHORED_PROVENANCE, object_class)
    try:
        default = class_defaults.values(object_class, [field])[field]
    except ClassDefaultError:
        return ActorField(field, None, UNRESOLVED_PROVENANCE, None)
    return ActorField(field, default.value, placement_provenance(default), default.declaring_class)


def unresolved_actor_field(field):
    return ActorField(field, None, UNRESOLVED_PROVENANCE, None)
