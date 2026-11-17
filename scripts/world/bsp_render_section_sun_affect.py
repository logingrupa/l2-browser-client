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


def combined_sun_affect(node_states):
    if SUN_AFFECTED in node_states:
        return SUN_AFFECTED
    return SUN_AFFECT_UNRESOLVED if SUN_AFFECT_UNRESOLVED in node_states else NOT_SUN_AFFECTED


def render_section_sun_affect(model, section_count, zones, drawn_node_indices):
    node_states = [set() for _ in range(section_count)]
    for node_index in sorted(drawn_node_indices):
        node = model.nodes[node_index]
        if node.num_vertices > 0 and 0 <= node.i_section < section_count:
            node_states[node.i_section].add(zone_sun_affect(zones, node.i_zone[SUN_AFFECT_ZONE_SIDE]))
    return tuple(combined_sun_affect(states) for states in node_states)
