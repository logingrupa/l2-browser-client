from world.actor_field_values import UNRESOLVED_PROVENANCE
from world.bsp_leaf_membership import leaf_for_point
from world.shared_sky_visibility_rules import read_shared_sky_visibility_rules

SKY_EYE_ZONE_DIFFERS_REASON_PREFIX = 'shared-sky-eye-zone-differs:'


class SkyMaterialSortingMismatch(ValueError):
    pass


def node_field(node, name, declaring_class):
    matches = [field for field in node['fields'] if field['field'] == name and field['declaringClass'] == declaring_class]
    return matches[0] if len(matches) == 1 else None


def resolved_field_value(field):
    if field is None or field['provenance'] == UNRESOLVED_PROVENANCE:
        return False, None
    return True, field['value']


def output_blending_ordinal(value):
    if value is None:
        return 0
    return value['ordinal'] if isinstance(value, dict) else value


def node_requires_sorting(nodes_by_id, node_id, rules, visited):
    node = nodes_by_id.get(node_id)
    if node is None or node_id in visited:
        return None
    visited = visited | {node_id}
    forwarding, shader, texture = rules['forwarding'], rules['shader'], rules['texture']
    forwarded = node_field(node, forwarding['field'], forwarding['class'])
    if forwarded is not None:
        resolved, value = resolved_field_value(forwarded)
        if not resolved:
            return None
        return False if value is None else node_requires_sorting(nodes_by_id, value.get('node'), rules, visited)
    output_blending = node_field(node, shader['outputBlendingField'], shader['class'])
    if output_blending is not None:
        blending_resolved, blending = resolved_field_value(output_blending)
        opacity_resolved, opacity = resolved_field_value(node_field(node, shader['opacityField'], shader['class']))
        if not (blending_resolved and opacity_resolved):
            return None
        ordinal = output_blending_ordinal(blending)
        return ordinal in shader['sortingOutputBlending'] or (ordinal == shader['opacityOutputBlending'] and opacity is not None)
    alpha_flag = node_field(node, texture['flagField'], texture['class'])
    if alpha_flag is not None:
        resolved, value = resolved_field_value(alpha_flag)
        return value is True if resolved else None
    return None


def program_requires_sorting(program):
    rules = read_shared_sky_visibility_rules()['document']['requiresSortingRules']
    return node_requires_sorting({node['id']: node for node in program['nodes']}, program['root'], rules, frozenset())


def observed_material_route(material):
    rows = [row for row in read_shared_sky_visibility_rules()['document']['materialSorting'] if row['material'].casefold() == material.casefold()]
    return rows[0]['requiresSorting'] if rows else None


def require_sorting_matches_observed_route(material, requires_sorting):
    observed = observed_material_route(material)
    if observed is not None and observed != requires_sorting:
        raise SkyMaterialSortingMismatch(f'{material} RequiresSorting derives {requires_sorting} from its package fields but draws through the '
                                         f'{"sorted" if observed else "unsorted"} route in the RM-24 frame')


def sky_eye_zone_gap(model, location, sky_zone_index):
    zone = leaf_for_point(model, location).zone
    return None if zone == sky_zone_index else f'{SKY_EYE_ZONE_DIFFERS_REASON_PREFIX}{zone}'
