from world.level_model import LevelModelRangeError, require_level_model_ranges
from world.typed_payload import TypedPayloadArray

ZONE_SET_WORD_MASK = 0xFFFFFFFF
ZONE_SET_WORD_BITS = 32
VISIBILITY_OUTDOOR_ZONE_BIT = 8
OUTDOOR_ZONE_INDEX = 0
FALLBACK_OUTDOOR_ZONE_INDEX = 1


def array(name, kind, values):
    return TypedPayloadArray(name, kind, tuple(values))


def zone_set_words(zone_set):
    return zone_set & ZONE_SET_WORD_MASK, zone_set >> ZONE_SET_WORD_BITS


def require_visibility_model(model, zones):
    require_level_model_ranges(model)
    if len(zones) != len(model.zones):
        raise LevelModelRangeError('Zones', f'the zone table holds {len(zones)} rows for {len(model.zones)} zones')


def portal_node_indices(model, portal_flag):
    return [index for index, node in enumerate(model.nodes)
            if model.surfs[node.i_surf].flags & portal_flag and node.i_zone[0] != node.i_zone[1]]


def visibility_outdoor_zones(zones, zone_one_fallback):
    outdoor = {zone.zone_index for zone in zones if zone.outdoor or zone.unresolved}
    if zone_one_fallback and outdoor == {OUTDOOR_ZONE_INDEX} and len(zones) > FALLBACK_OUTDOOR_ZONE_INDEX:
        outdoor.add(FALLBACK_OUTDOOR_ZONE_INDEX)
    return frozenset(outdoor)


def node_arrays(model):
    nodes = model.nodes
    return [array('NODE.plane', 'float32', [value for node in nodes for value in node.plane]),
            array('NODE.front', 'int32', [node.i_front for node in nodes]), array('NODE.back', 'int32', [node.i_back for node in nodes]),
            array('NODE.coplanar', 'int32', [node.i_plane for node in nodes]),
            array('NODE.leaf', 'int32', [leaf for node in nodes for leaf in node.i_leaf]),
            array('NODE.zone', 'uint8', [zone for node in nodes for zone in node.i_zone]),
            array('NODE.zoneSet', 'uint32', [word for node in nodes for word in zone_set_words(node.zone_mask)]),
            array('NODE.renderBound', 'int32', [node.i_render_bound for node in nodes]),
            array('NODE.sphere', 'float32', [value for node in nodes for value in node.exclusive_sphere])]


def bound_arrays(model):
    return [array('BNDS.box', 'float32', [value for bound in model.model_bounds for value in bound[:6]]),
            array('BNDS.valid', 'uint8', [bound[6] for bound in model.model_bounds])]


def leaf_arrays(model):
    return [array('LEAF.zone', 'uint8', [leaf[0] for leaf in model.leaves]),
            array('LEAF.pvs', 'uint32', [word for leaf in model.leaves for word in zone_set_words(leaf[3])])]


def zone_arrays(zones, outdoor_zones):
    return [array('ZONE.connectivity', 'uint32', [word for zone in zones for word in zone_set_words(zone.connectivity)]),
            array('ZONE.visibility', 'uint32', [word for zone in zones for word in zone_set_words(zone.visibility)]),
            array('ZONE.class', 'uint8', [zone.class_bits | (VISIBILITY_OUTDOOR_ZONE_BIT if zone.zone_index in outdoor_zones else 0) for zone in zones])]


def node_range_arrays(node_ranges):
    return [array(f'RNGE.{field}', 'int32', [node_range[field] for node_range in node_ranges])
            for field in ('chunk', 'node', 'primitive', 'firstIndex', 'indexCount')]


def member_arrays(members):
    leaf_starts = [0]
    for member in members:
        leaf_starts.append(leaf_starts[-1] + len(member.leaves))
    return [array('MEMB.kind', 'uint8', [member.kind for member in members]),
            array('MEMB.exportIndex', 'int32', [member.export_index for member in members]),
            array('MEMB.flags', 'uint8', [member.flags for member in members]),
            array('MEMB.center', 'float32', [value for member in members for value in member.center]),
            array('MEMB.zoneSet', 'uint32', [word for member in members for word in zone_set_words(member.zone_set)]),
            array('MEMB.leafStart', 'uint32', leaf_starts), array('MEMB.leaves', 'int32', [leaf for member in members for leaf in member.leaves])]


def bsp_visibility_arrays(model, zones, outdoor_zones, portal_nodes, node_ranges, members):
    return [*node_arrays(model), *bound_arrays(model), *leaf_arrays(model), *zone_arrays(zones, outdoor_zones),
            array('PORT.node', 'int32', portal_nodes), *node_range_arrays(node_ranges), *member_arrays(members)]
