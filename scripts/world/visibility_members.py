import math
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.bsp_leaf_membership import leaf_for_point, leaves_for_box, zone_set_of_leaves
from world.gltf_builder import GLTF_FLOAT_COMPONENT
from world.static_collision_sources import GLTF_TO_SOURCE_AXIS_ORDER, GLTF_TO_SOURCE_UNITS, accessor_rows, glb_document_and_binary
from world.static_placement import static_matrix, resolved_static_values

STATIC_MESH_MEMBER_KIND = 0
MAP_EMITTER_MEMBER_KIND = 1
MEMBER_KIND_NAMES = {STATIC_MESH_MEMBER_KIND: 'static-mesh', MAP_EMITTER_MEMBER_KIND: 'map-emitter'}
MEMBER_SKY_FLAG = 1
MEMBER_UNBOUNDED_FLAG = 2
ZERO_EXTENT = (0.0, 0.0, 0.0)


class VisibilityMember(NamedTuple):
    member_id: str
    kind: int
    export_index: int
    flags: int
    center: tuple
    zone_set: int
    leaves: tuple

    def to_record(self):
        return {'id': self.member_id, 'kind': MEMBER_KIND_NAMES[self.kind], 'exportIndex': self.export_index, 'flags': self.flags,
                'leafCount': len(self.leaves), 'zoneSet': self.zone_set}


def static_mesh_source_bounds(glb):
    document, binary = glb_document_and_binary(glb)
    minimum, maximum = [math.inf] * 3, [-math.inf] * 3
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            for row in accessor_rows(document, binary, primitive['attributes']['POSITION'], 3, {GLTF_FLOAT_COMPONENT: 'f'}):
                for axis, value in enumerate(row[source_axis] * GLTF_TO_SOURCE_UNITS for source_axis in GLTF_TO_SOURCE_AXIS_ORDER):
                    minimum[axis], maximum[axis] = min(minimum[axis], value), max(maximum[axis], value)
    if not all(math.isfinite(value) for value in (*minimum, *maximum)):
        raise FormatError('converted model has no positions to bound')
    return tuple(minimum), tuple(maximum)


def transformed_point(point, rows):
    return tuple(sum(point[row] * rows[row][axis] for row in range(3)) + rows[3][axis] for axis in range(3))


def placed_box(bounds, rows, margin):
    minimum, maximum = bounds
    corners = [transformed_point((x, y, z), rows) for x in (minimum[0], maximum[0]) for y in (minimum[1], maximum[1]) for z in (minimum[2], maximum[2])]
    low = [min(corner[axis] for corner in corners) for axis in range(3)]
    high = [max(corner[axis] for corner in corners) for axis in range(3)]
    center = tuple((low[axis] + high[axis]) / 2 for axis in range(3))
    half_extent = tuple((high[axis] - low[axis]) / 2 * (1 + margin) for axis in range(3))
    return center, half_extent


def located_member(model, member_id, kind, export_index, center, half_extent, sky_zones):
    leaves = leaves_for_box(model, center, half_extent)
    sky = leaf_for_point(model, center).zone in sky_zones
    return VisibilityMember(member_id, kind, export_index, MEMBER_SKY_FLAG if sky else 0, center, zone_set_of_leaves(model, leaves), leaves)


def unbounded_member(member_id, kind, export_index):
    return VisibilityMember(member_id, kind, export_index, MEMBER_UNBOUNDED_FLAG, ZERO_EXTENT, 0, ())


def map_emitter_members(model, map_emitters, sky_zones):
    return [located_member(model, placement['id'], MAP_EMITTER_MEMBER_KIND, placement['exportIndex'], tuple(placement['origin']), ZERO_EXTENT, sky_zones)
            for placement in map_emitters['placements']]


def static_mesh_placements(static_meshes):
    return sorted((placement for chunk in static_meshes['chunks'].values() for model in chunk['models'] for placement in model['placements']),
                  key=lambda placement: placement['exportIndex'])


def static_mesh_members(model, static_meshes, actors_by_object, class_defaults, model_glb_of_id, margin, sky_zones):
    bounds_of_model, members = {}, []
    for placement in static_mesh_placements(static_meshes):
        try:
            rows = static_matrix(resolved_static_values(actors_by_object[placement['sourceActor']], class_defaults))
        except FormatError:
            members.append(unbounded_member(placement['id'], STATIC_MESH_MEMBER_KIND, placement['exportIndex']))
            continue
        if placement['modelId'] not in bounds_of_model:
            bounds_of_model[placement['modelId']] = static_mesh_source_bounds(model_glb_of_id(placement['modelId']))
        center, half_extent = placed_box(bounds_of_model[placement['modelId']], rows, margin)
        members.append(located_member(model, placement['id'], STATIC_MESH_MEMBER_KIND, placement['exportIndex'], center, half_extent, sky_zones))
    return members
