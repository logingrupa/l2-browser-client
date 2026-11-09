import math
from types import SimpleNamespace

INDEX_NONE = -1
ALL_ZONES_MASK = (1 << 64) - 1


def subtract(first, second):
    return [first[axis] - second[axis] for axis in range(3)]


def cross(first, second):
    return [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2],
            first[0] * second[1] - first[1] * second[0]]


def polygon_plane(points):
    normal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]))
    length = math.sqrt(sum(component * component for component in normal))
    unit_normal = [component / length for component in normal]
    return (*unit_normal, sum(unit_normal[axis] * points[0][axis] for axis in range(3)))


def synthetic_polygon(points, *, material=1, surface_flags=0, light_map=INDEX_NONE, zones=(1, 1), node_flags=0, front=INDEX_NONE,
                      back=INDEX_NONE, coplanar=INDEX_NONE, collision_bound=INDEX_NONE, render_bound=INDEX_NONE, actor=2,
                      texture_u=(1.0, 0.0, 0.0), texture_v=(0.0, 1.0, 0.0)):
    return {'points': [tuple(float(value) for value in point) for point in points], 'material': material, 'surfaceFlags': surface_flags,
            'lightMap': light_map, 'zones': tuple(zones), 'nodeFlags': node_flags, 'front': front, 'back': back, 'coplanar': coplanar,
            'collisionBound': collision_bound, 'renderBound': render_bound, 'actor': actor, 'textureU': texture_u, 'textureV': texture_v}


def synthetic_zone(actor_reference=0):
    return (actor_reference, ALL_ZONES_MASK, ALL_ZONES_MASK, 0.0)


def synthetic_node(polygon, surface_index, vertex_pool, plane):
    return SimpleNamespace(plane=plane, zone_mask=ALL_ZONES_MASK, flags=polygon['nodeFlags'], i_vert_pool=vertex_pool, i_surf=surface_index,
                           i_back=polygon['back'], i_front=polygon['front'], i_plane=polygon['coplanar'],
                           num_vertices=len(polygon['points']), i_zone=polygon['zones'], i_section=0, i_vert_offset=0,
                           i_light_map=polygon['lightMap'], i_collision_bound=polygon['collisionBound'],
                           i_render_bound=polygon['renderBound'], exclusive_sphere=(0.0, 0.0, 0.0, 0.0), reserved=bytes(16),
                           i_leaf=(INDEX_NONE, INDEX_NONE))


def synthetic_surface(polygon, base_point, normal_vector, texture_u_vector, texture_v_vector, plane):
    return SimpleNamespace(material=polygon['material'], flags=polygon['surfaceFlags'], p_base=base_point, v_normal=normal_vector,
                           v_texture_u=texture_u_vector, v_texture_v=texture_v_vector, i_brush_poly=0, actor=polygon['actor'],
                           plane=plane, light_map_scale=32.0, i_lightmap_index=INDEX_NONE)


def build_synthetic_level_model(polygons, *, zones=(synthetic_zone(),), leaf_hulls=(), model_bounds=(), leaves=(), root_outside=0):
    points, vectors, verts, nodes, surfaces = [], [], [], [], []
    for polygon in polygons:
        plane = polygon_plane(polygon['points'])
        base_point = len(points)
        vertex_pool = len(verts)
        for point in polygon['points']:
            verts.append((len(points), 0))
            points.append(point)
        normal_vector = len(vectors)
        vectors.extend([tuple(plane[:3]), tuple(polygon['textureU']), tuple(polygon['textureV'])])
        surfaces.append(synthetic_surface(polygon, base_point, normal_vector, normal_vector + 1, normal_vector + 2, plane))
        nodes.append(synthetic_node(polygon, len(surfaces) - 1, vertex_pool, plane))
    return SimpleNamespace(export=None, bounds=((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0), vectors=vectors, points=points, nodes=nodes,
                           surfs=surfaces, verts=verts, num_shared_sides=0, zones=list(zones), polys=0, root_outside=root_outside, linked=0,
                           lightmap_tail=0, bounding_sphere=(0.0, 0.0, 0.0, 0.0), model_bounds=list(model_bounds),
                           leaf_hulls=list(leaf_hulls), leaves=list(leaves), lights=[], source_spans={})


def square_points(minimum_x, minimum_y, size, height=0.0):
    return [(minimum_x, minimum_y, height), (minimum_x + size, minimum_y, height), (minimum_x + size, minimum_y + size, height),
            (minimum_x, minimum_y + size, height)]
