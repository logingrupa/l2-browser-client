import math
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.actor_field_values import UNRESOLVED_PROVENANCE, resolved_actor_field, serialized_actor_values
from world.error_detail import first_line_of_error
from world.static_placement import UE_ZERO_PROVENANCE, resolved_static_values, static_matrix

SCALE_GLOW_FIELD = 'ScaleGlow'
LOCAL_TO_WORLD_COMPONENTS = 16
ORDINARY_INPUTS_UNRESOLVED_REASON_PREFIX = 'static-mesh-ordinary-inputs-unresolved:'
SCALE_GLOW_UNRESOLVED_DETAIL = 'ScaleGlow unresolved'
ACTOR_ROW_ABSENT_DETAIL = 'actor row absent'


class StaticMeshLightListFields(NamedTuple):
    scale_glow: float | None
    local_to_world: tuple | None
    ordinary_inputs_unresolved_detail: str | None

    def ordinary_inputs_resolved(self):
        return self.ordinary_inputs_unresolved_detail is None


def scale_glow_of_field(field):
    if field.provenance == UNRESOLVED_PROVENANCE:
        return None
    if field.provenance == UE_ZERO_PROVENANCE and field.value is None:
        return 0.0
    return float(field.value) if type(field.value) in (int, float) and math.isfinite(field.value) else None


def native_local_to_world(actor, class_defaults):
    if actor is None:
        return None, ACTOR_ROW_ABSENT_DETAIL
    try:
        rows = static_matrix(resolved_static_values(actor, class_defaults))
    except FormatError as error:
        return None, first_line_of_error(error)
    return tuple(value for row in rows for value in row), None


def light_list_fields_of(scale_glow, actor, class_defaults):
    local_to_world, local_to_world_detail = native_local_to_world(actor, class_defaults)
    unresolved_detail = SCALE_GLOW_UNRESOLVED_DETAIL if scale_glow is None else local_to_world_detail
    return StaticMeshLightListFields(scale_glow, local_to_world, unresolved_detail)


def static_mesh_light_list_fields(package, actors, light_lists, class_defaults):
    actors_by_export_index = {actor['exportIndex']: actor for actor in actors}
    rows = []
    for light_list in light_lists:
        export = package.exports[light_list.actor_export_index - 1]
        serialized = serialized_actor_values(package, export)
        scale_glow = resolved_actor_field(SCALE_GLOW_FIELD, serialized, export['classObject'], class_defaults)
        rows.append(light_list_fields_of(scale_glow_of_field(scale_glow),
                                         actors_by_export_index.get(light_list.actor_export_index), class_defaults))
    return tuple(rows)


def static_mesh_ordinary_inputs_unresolved_reasons(light_list_fields):
    return sorted({f'{ORDINARY_INPUTS_UNRESOLVED_REASON_PREFIX}{fields.ordinary_inputs_unresolved_detail}'
                   for fields in light_list_fields if not fields.ordinary_inputs_resolved()})
