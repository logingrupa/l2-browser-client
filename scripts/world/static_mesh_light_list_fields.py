import math
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.actor_field_values import UNRESOLVED_PROVENANCE, resolved_actor_field, serialized_actor_values
from world.bsp_node_sun_affect import NOT_SUN_AFFECTED, SUN_AFFECT_UNRESOLVED, SUN_AFFECTED
from world.level_zones import SUN_AFFECT_FIELD
from world.static_placement import UE_ZERO_PROVENANCE, resolved_static_values, static_matrix

SCALE_GLOW_FIELD = 'ScaleGlow'
LOCAL_TO_WORLD_COMPONENTS = 16


class StaticMeshLightListFields(NamedTuple):
    sun_affect: int
    scale_glow: float | None
    local_to_world: tuple | None

    def ordinary_inputs_resolved(self):
        return self.scale_glow is not None and self.local_to_world is not None


def sun_affect_of_field(field):
    if field.provenance == UNRESOLVED_PROVENANCE:
        return SUN_AFFECT_UNRESOLVED
    return SUN_AFFECTED if field.value is True else NOT_SUN_AFFECTED


def scale_glow_of_field(field):
    if field.provenance == UNRESOLVED_PROVENANCE:
        return None
    if field.provenance == UE_ZERO_PROVENANCE and field.value is None:
        return 0.0
    return float(field.value) if type(field.value) in (int, float) and math.isfinite(field.value) else None


def native_local_to_world(actor, class_defaults):
    if actor is None:
        return None
    try:
        rows = static_matrix(resolved_static_values(actor, class_defaults))
    except FormatError:
        return None
    return tuple(value for row in rows for value in row)


def static_mesh_light_list_fields(package, actors, light_lists, class_defaults):
    actors_by_export_index = {actor['exportIndex']: actor for actor in actors}
    rows = []
    for light_list in light_lists:
        export = package.exports[light_list.actor_export_index - 1]
        serialized = serialized_actor_values(package, export)
        sun_affect = resolved_actor_field(SUN_AFFECT_FIELD, serialized, export['classObject'], class_defaults)
        scale_glow = resolved_actor_field(SCALE_GLOW_FIELD, serialized, export['classObject'], class_defaults)
        rows.append(StaticMeshLightListFields(sun_affect_of_field(sun_affect), scale_glow_of_field(scale_glow),
                                              native_local_to_world(actors_by_export_index.get(light_list.actor_export_index), class_defaults)))
    return tuple(rows)
