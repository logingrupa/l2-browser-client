import struct
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.actor_field_values import UNRESOLVED_PROVENANCE, resolved_actor_field, serialized_actor_values
from world.bsp_leaf_membership import leaves_for_box
from world.error_detail import first_line_of_error
from world.static_mesh_light_list_fields import native_local_to_world
from world.static_mesh_vertex_streams import static_mesh_export
from world.static_placement_plan import static_mesh_actors
from world.terrain_coordinates import f32

AMBIENT_ZONES_UNRESOLVED_REASON_PREFIX = 'static-mesh-ambient-zones-unresolved:'
STATIC_MESH_BOUNDING_BOX_FORMAT = '<6fB'
BOX_AXES = 3
PULSING_AMBIENT_GLOW = 255
ANTI_PORTAL_DRAW_TYPE = 10
UNNAMED_TAG_VALUES = (None, 'None')
STATIC_MESH_REFERENCE_UNRESOLVED_DETAIL = 'StaticMesh reference has no static mesh request'
BOUNDING_BOX_INVALID_DETAIL = 'StaticMesh bounding box is not valid'
AMBIENT_ACTOR_FIELDS = ('Physics', 'DrawType', 'ForcedRegionTag', 'ForcedRegion', 'ForcedVisibilityZoneTag', 'bUseLightingFromBase', 'AmbientGlow', 'bUnlit')


class StaticMeshAmbientZones(NamedTuple):
    actor_export_index: int
    zones: tuple
    ambient_glow: int
    unlit: bool
    unresolved_detail: str | None

    def resolved(self):
        return self.unresolved_detail is None


class AmbientActorFields(NamedTuple):
    physics: int
    draw_type: int
    forced_region_tag: str | None
    forced_region: int
    forced_visibility_zone_tag: str | None
    use_lighting_from_base: bool
    ambient_glow: int
    unlit: bool


def unresolved_ambient_zones(actor_export_index, detail):
    return StaticMeshAmbientZones(actor_export_index, (), 0, False, detail)


def static_mesh_local_box(load_mesh_package, request):
    mesh_package, _ = load_mesh_package(request['package'])
    _, reader = mesh_package.properties(static_mesh_export(mesh_package, request['object']))
    *bounds, valid = struct.unpack(STATIC_MESH_BOUNDING_BOX_FORMAT, reader.take(struct.calcsize(STATIC_MESH_BOUNDING_BOX_FORMAT)))
    if not valid:
        raise FormatError(BOUNDING_BOX_INVALID_DETAIL)
    return tuple(bounds)


def transformed_box(local_box, local_to_world):
    corners = [(x, y, z) for x in (local_box[0], local_box[3]) for y in (local_box[1], local_box[4]) for z in (local_box[2], local_box[5])]
    world_corners = [tuple(f32(f32(f32(f32(x * local_to_world[axis]) + f32(y * local_to_world[4 + axis])) + f32(z * local_to_world[8 + axis]))
                               + local_to_world[12 + axis]) for axis in range(BOX_AXES)) for x, y, z in corners]
    return (tuple(min(corner[axis] for corner in world_corners) for axis in range(BOX_AXES))
            + tuple(max(corner[axis] for corner in world_corners) for axis in range(BOX_AXES)))


def touched_zones(model, world_box):
    center = tuple(f32((world_box[axis] + world_box[BOX_AXES + axis]) * 0.5) for axis in range(BOX_AXES))
    half_extent = tuple(f32((world_box[BOX_AXES + axis] - world_box[axis]) * 0.5) for axis in range(BOX_AXES))
    return tuple(sorted({model.leaves[leaf][0] for leaf in leaves_for_box(model, center, half_extent)}))


def read_ambient_actor_fields(map_package, actor_export_index, class_defaults):
    export = map_package.exports[actor_export_index - 1]
    serialized = serialized_actor_values(map_package, export)
    fields = [resolved_actor_field(field, serialized, export['classObject'], class_defaults) for field in AMBIENT_ACTOR_FIELDS]
    unresolved = next((field.field for field in fields if field.provenance == UNRESOLVED_PROVENANCE), None)
    if unresolved is not None:
        return None, f'{unresolved} unresolved'
    physics, draw_type, forced_region_tag, forced_region, forced_visibility_zone_tag, use_lighting_from_base, ambient_glow, unlit = (field.value for field in fields)
    return AmbientActorFields(physics or 0, draw_type or 0, forced_region_tag, forced_region or 0, forced_visibility_zone_tag, use_lighting_from_base is True,
                              ambient_glow or 0, unlit is True), None


def ambient_field_refusal(fields):
    if fields.physics:
        return f'Physics {fields.physics} widens the render box'
    if fields.draw_type == ANTI_PORTAL_DRAW_TYPE:
        return f'DrawType {ANTI_PORTAL_DRAW_TYPE} widens the render box'
    if fields.forced_region_tag not in UNNAMED_TAG_VALUES or fields.forced_region:
        return 'ForcedRegionTag or ForcedRegion filters BoxLeaves'
    if fields.forced_visibility_zone_tag not in UNNAMED_TAG_VALUES:
        return 'ForcedVisibilityZoneTag filters the touched zones'
    if fields.use_lighting_from_base:
        return 'bUseLightingFromBase reads the AmbientGlow of the Base actor'
    if fields.ambient_glow == PULSING_AMBIENT_GLOW:
        return f'AmbientGlow {PULSING_AMBIENT_GLOW} pulses with the level time'
    return None


def actor_ambient_zones(map_package, model, actor, class_defaults, requests_by_reference, load_mesh_package):
    actor_export_index = actor['exportIndex']
    fields, unresolved_detail = read_ambient_actor_fields(map_package, actor_export_index, class_defaults)
    refusal = unresolved_detail or ambient_field_refusal(fields)
    if refusal is not None:
        return unresolved_ambient_zones(actor_export_index, refusal)
    request = requests_by_reference.get(actor['staticMesh']['object'])
    if request is None:
        return unresolved_ambient_zones(actor_export_index, STATIC_MESH_REFERENCE_UNRESOLVED_DETAIL)
    local_to_world, transform_detail = native_local_to_world(actor, class_defaults)
    if local_to_world is None:
        return unresolved_ambient_zones(actor_export_index, transform_detail)
    try:
        local_box = static_mesh_local_box(load_mesh_package, request)
    except FormatError as error:
        return unresolved_ambient_zones(actor_export_index, first_line_of_error(error))
    return StaticMeshAmbientZones(actor_export_index, touched_zones(model, transformed_box(local_box, local_to_world)), fields.ambient_glow, fields.unlit, None)


def static_mesh_ambient_zones(map_package, model, actors, class_defaults, requests_by_reference, load_mesh_package):
    return tuple(actor_ambient_zones(map_package, model, actor, class_defaults, requests_by_reference, load_mesh_package)
                 for actor in static_mesh_actors(actors))


def static_mesh_ambient_zones_unresolved_reasons(ambient_zones):
    return sorted({f'{AMBIENT_ZONES_UNRESOLVED_REASON_PREFIX}{row.unresolved_detail}' for row in ambient_zones if not row.resolved()})
