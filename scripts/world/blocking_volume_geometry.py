from native_assets_lib.class_defaults import ClassDefaultError
from native_catalog.ue2 import FormatError
from world.level_model import read_model_body, require_level_model_ranges
from world.static_collision_sources import (BLOCKING_DECISION, DECLARED_NONE_DECISION, GAP_DECISION, SLOTS_DECISION, blocking_decision,
                                            resolve_actor_flags, serialized_actor_value)
from world.static_placement import TransformFieldError, resolved_transform_values, static_matrix

BRUSH_FIELD = 'Brush'
MODEL_CLASS = 'Engine.Model'
NO_BRUSH_REFERENCE = 0
UNREADABLE_BRUSH_REFERENCE = -1


def transformed_point(rows, point):
    return [sum(point[axis] * rows[axis][column] for axis in range(3)) + rows[3][column] for column in range(3)]


def bounds_centroid(points):
    return [(min(point[axis] for point in points) + max(point[axis] for point in points)) / 2 for axis in range(3)]


def brush_reference(actor, class_evidence):
    serialized, value = serialized_actor_value(actor, BRUSH_FIELD)
    if serialized:
        return value['index'] if isinstance(value, dict) and type(value.get('index')) is int else UNREADABLE_BRUSH_REFERENCE
    try:
        default = class_evidence.values(actor['classObject'], [BRUSH_FIELD])[BRUSH_FIELD]
    except ClassDefaultError:
        return UNREADABLE_BRUSH_REFERENCE
    return NO_BRUSH_REFERENCE if default.value is None else UNREADABLE_BRUSH_REFERENCE


def brush_nodes(model):
    nodes = []
    for node in model.nodes:
        polygon = [list(model.points[model.verts[node.i_vert_pool + offset][0]]) for offset in range(node.num_vertices)]
        nodes.append({'plane': list(node.plane), 'front': node.i_front, 'back': node.i_back, 'flags': node.flags, 'polygon': polygon})
    return nodes


def volume_record(actor, decision, evidence, provenance, transform=None, brush=None, model=None, centroid=None):
    return {'exportIndex': actor['exportIndex'], 'object': actor['object'], 'classObject': actor['classObject'], 'decision': decision,
            'evidence': evidence, 'flagProvenance': provenance, 'transform': transform, 'brush': brush,
            'rootOutside': None if model is None else model.root_outside, 'nodes': [] if model is None else brush_nodes(model),
            'centroid': centroid}


def read_volume(package, adapter, reader, actor, class_evidence, rules):
    values, provenance = resolve_actor_flags(actor, class_evidence, (*rules.blocking_fields, *rules.cross_check_fields))
    decision, evidence = blocking_decision(values, rules)
    decision = BLOCKING_DECISION if decision == SLOTS_DECISION else decision
    try:
        transform = resolved_transform_values(actor, class_evidence, actor['classObject'])
        rows = static_matrix(transform)
    except TransformFieldError as error:
        return volume_record(actor, GAP_DECISION, [f'transform-field:{error.field}'], provenance)
    except FormatError:
        return volume_record(actor, GAP_DECISION, ['transform-singular-scale'], provenance)
    reference = brush_reference(actor, class_evidence)
    if reference == NO_BRUSH_REFERENCE:
        return volume_record(actor, DECLARED_NONE_DECISION, ['field:Brush:none'], provenance, transform)
    if not 0 < reference <= len(adapter.exports) or package.exports[reference - 1]['classObject'] != MODEL_CLASS:
        return volume_record(actor, GAP_DECISION, ['field:Brush'], provenance, transform)
    try:
        model = read_model_body(adapter, reader, adapter.exports[reference - 1])
        reader.validate_graph(model.nodes)
        require_level_model_ranges(model)
    except ValueError:
        return volume_record(actor, GAP_DECISION, ['field:Brush'], provenance, transform)
    if not model.points:
        return volume_record(actor, GAP_DECISION, ['field:Brush'], provenance, transform)
    centroid = bounds_centroid([transformed_point(rows, point) for point in model.points])
    brush = {'object': package.exports[reference - 1]['object'], 'exportIndex': reference}
    return volume_record(actor, decision, evidence, provenance, transform, brush, model, centroid)
