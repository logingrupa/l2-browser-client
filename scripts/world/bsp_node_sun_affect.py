from native_catalog.ue2 import FormatError

SUN_AFFECT_ZONE_SIDE = 1
SUN_AFFECTED = 1
NOT_SUN_AFFECTED = 0
SUN_AFFECT_UNRESOLVED = -1


def zone_sun_affect(zones, zone_index):
    if not 0 <= zone_index < len(zones):
        raise FormatError(f'a BSP node names zone {zone_index} outside the {len(zones)} level zones')
    zone = zones[zone_index]
    if zone.sun_affect.value is True:
        return SUN_AFFECTED
    return SUN_AFFECT_UNRESOLVED if zone.unresolved else NOT_SUN_AFFECTED


def node_range_sun_affect(model, zones, node_ranges):
    return tuple(zone_sun_affect(zones, model.nodes[node_range['node']].i_zone[SUN_AFFECT_ZONE_SIDE]) for node_range in node_ranges)
