from native_catalog.ue2 import FormatError
from world.actor_field_values import UNRESOLVED_PROVENANCE, resolved_actor_field, serialized_actor_values
from world.level_actors import level_actor_references
from world.level_zones import SUN_AFFECT_FIELD
from world.light_actors import LEVEL_INFO_CLASS

SUN_AFFECT_ZONE_SIDE = 1
SUN_AFFECTED = 1
NOT_SUN_AFFECTED = 0
SUN_AFFECT_UNRESOLVED = -1
NO_ZONE_ACTOR_REFERENCE = 0


def sun_affect_of_field(field):
    if field.provenance == UNRESOLVED_PROVENANCE:
        return SUN_AFFECT_UNRESOLVED
    return SUN_AFFECTED if field.value is True else NOT_SUN_AFFECTED


def level_info_sun_affect(package, level, class_defaults, class_chains):
    references = level_actor_references(level)
    if not references or references[0] <= 0:
        return SUN_AFFECT_UNRESOLVED
    export = package.exports[references[0] - 1]
    if class_chains.chain(export['classObject']) is None or not class_chains.is_subclass(export['classObject'], LEVEL_INFO_CLASS):
        return SUN_AFFECT_UNRESOLVED
    return sun_affect_of_field(resolved_actor_field(SUN_AFFECT_FIELD, serialized_actor_values(package, export), export['classObject'], class_defaults))


def zone_sun_affect(model, zones, zone_index, level_info_value):
    if not 0 <= zone_index < len(zones):
        raise FormatError(f'a BSP node names zone {zone_index} outside the {len(zones)} level zones')
    zone = zones[zone_index]
    if zone.actor is None:
        return level_info_value if model.zones[zone_index][0] == NO_ZONE_ACTOR_REFERENCE else SUN_AFFECT_UNRESOLVED
    if zone.sun_affect.value is True:
        return SUN_AFFECTED
    return SUN_AFFECT_UNRESOLVED if zone.unresolved else NOT_SUN_AFFECTED


def node_range_sun_affect(model, zones, node_ranges, level_info_value):
    return tuple(zone_sun_affect(model, zones, model.nodes[node_range['node']].i_zone[SUN_AFFECT_ZONE_SIDE], level_info_value) for node_range in node_ranges)
