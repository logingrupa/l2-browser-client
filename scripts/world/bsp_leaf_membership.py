from typing import NamedTuple

INDEX_NONE = -1
BACK_SIDE = 0
FRONT_SIDE = 1
ROOT_NODE_INDEX = 0


class PointLeaf(NamedTuple):
    leaf: int
    zone: int


class SolidityDisagreement(NamedTuple):
    point: tuple
    leaf: int
    zone: int
    point_check_outside: bool

    def to_record(self):
        return {'point': list(self.point), 'leaf': self.leaf, 'zone': self.zone, 'pointCheckOutside': self.point_check_outside}


def plane_dot(plane, point):
    return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] - plane[3]


def leaf_for_point(model, point):
    if not model.nodes:
        return PointLeaf(INDEX_NONE, 0)
    node = model.nodes[ROOT_NODE_INDEX]
    while True:
        side = FRONT_SIDE if plane_dot(node.plane, point) >= 0 else BACK_SIDE
        child = node.i_front if side == FRONT_SIDE else node.i_back
        if child == INDEX_NONE:
            break
        node = model.nodes[child]
    leaf = node.i_leaf[side] if node.i_leaf[side] != INDEX_NONE else node.i_leaf[1 - side]
    return PointLeaf(leaf, model.leaves[leaf][0] if leaf != INDEX_NONE else node.i_zone[side])


def leaves_for_box(model, center, half_extent):
    leaves, pending = set(), [ROOT_NODE_INDEX] if model.nodes else []
    while pending:
        node = model.nodes[pending.pop()]
        distance = plane_dot(node.plane, center)
        extent = sum(abs(node.plane[axis] * half_extent[axis]) for axis in range(3))
        for side, child, reaches in ((BACK_SIDE, node.i_back, distance < extent), (FRONT_SIDE, node.i_front, -distance < extent)):
            if not reaches:
                continue
            if child != INDEX_NONE:
                pending.append(child)
            elif node.i_leaf[side] != INDEX_NONE:
                leaves.add(node.i_leaf[side])
    return tuple(sorted(leaves))


def zone_set_of_leaves(model, leaves):
    zone_set = 0
    for leaf in leaves:
        zone_set |= 1 << model.leaves[leaf][0]
    return zone_set


def zones_for_box(model, center, half_extent):
    return zone_set_of_leaves(model, leaves_for_box(model, center, half_extent))


def is_csg_node(node, not_csg_node_flags):
    return node.num_vertices > 0 and not node.flags & not_csg_node_flags


def point_check_outside(model, point, not_csg_node_flags):
    outside = bool(model.root_outside)
    index = ROOT_NODE_INDEX if model.nodes else INDEX_NONE
    while index != INDEX_NONE:
        node = model.nodes[index]
        front = plane_dot(node.plane, point) > 0
        csg = is_csg_node(node, not_csg_node_flags)
        outside = (outside or csg) if front else (outside and not csg)
        index = node.i_front if front else node.i_back
    return outside


def model_sample_bounds(model):
    minimum, maximum, valid = model.bounds
    if valid:
        return tuple(minimum), tuple(maximum)
    if not model.points:
        return None
    return tuple(min(point[axis] for point in model.points) for axis in range(3)), tuple(max(point[axis] for point in model.points) for axis in range(3))


def sample_grid_points(bounds, cells_per_axis):
    minimum, maximum = bounds
    axes = [[minimum[axis] + (maximum[axis] - minimum[axis]) * (cell + 0.5) / cells_per_axis[axis] for cell in range(cells_per_axis[axis])]
            for axis in range(3)]
    return [(x, y, z) for x in axes[0] for y in axes[1] for z in axes[2]]


def solidity_disagreements(model, cells_per_axis, not_csg_node_flags):
    bounds = model_sample_bounds(model)
    disagreements = []
    for point in sample_grid_points(bounds, cells_per_axis) if bounds else []:
        located = leaf_for_point(model, point)
        outside = point_check_outside(model, point, not_csg_node_flags)
        if (located.leaf == INDEX_NONE) != (not outside):
            disagreements.append(SolidityDisagreement(point, located.leaf, located.zone, outside))
    return disagreements
