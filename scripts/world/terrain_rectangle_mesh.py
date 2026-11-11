from world.gltf_builder import GltfBuilder
from world.native_terrain_sectors import bit, quad_triangles
from world.terrain_coordinates import SOURCE_TO_GLTF, native_to_gltf
from world.terrain_layers import terrain_mask_uv, texture_uv
from world.terrain_seam_strip import edge_vertex_normal, strip_quads, strip_vertices

NEUTRAL_INSPECTION_MATERIAL_NAME = 'Neutral geometry inspection; native terrain shader pending'
RECTANGLE_REGION_KIND = 'native-sector-rectangle'
MASK_UV_SET = 0
BASE_LAYER_UV_SET = 1


def rectangle_sample_grid(region):
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    return [(x, y) for y in range(origin_y, origin_y+quads_y+1) for x in range(origin_x, origin_x+quads_x+1)]


def quad_vertex_indices(vertex_index, x, y):
    return vertex_index[(x, y)], vertex_index[(x+1, y)], vertex_index[(x, y+1)], vertex_index[(x+1, y+1)]


def bounds_with_points(bounds, points):
    return [min([bounds[axis], *(point[axis] for point in points)]) for axis in range(3)] + \
           [max([bounds[3+axis], *(point[axis] for point in points)]) for axis in range(3)]


def build_terrain_rectangle_gltf(native, points, words, layers, region, mask_uv_rule, sector_rectangle, generator, seam_far_heights):
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    width, height = native['width'], native['height']
    seam_vertices = strip_vertices(native, seam_far_heights, region)
    vertex_keys = [*rectangle_sample_grid(region), *sorted(seam_vertices, key=lambda key: (key[1], key[0]))]
    vertex_index = {key: index for index, key in enumerate(vertex_keys)}
    positions, normals, mask_uv = [], [], []
    layer_uvs = [[] for _ in layers]
    for x, y in vertex_keys:
        point = seam_vertices[(x, y)] if (x, y) in seam_vertices else points[y*width+x]
        positions.append(native_to_gltf(point))
        normal = edge_vertex_normal(points, words['EdgeTurnBitmap'], width, height, x, y)
        normals.append([normal[0], normal[2], normal[1]])
        mask_uv.append(terrain_mask_uv(x, y, width, height, mask_uv_rule))
        for index, layer in enumerate(layers):
            layer_uvs[index].append(texture_uv(layer['worldToTextureRowMajor'], point))
    indices, hidden_quads, turned_quads = [], 0, 0
    for y in range(origin_y, origin_y+quads_y):
        for x in range(origin_x, origin_x+quads_x):
            if not bit(words['QuadVisibilityBitmap'], width, x, y):
                hidden_quads += 1
                continue
            turned = bit(words['EdgeTurnBitmap'], width, x, y)
            turned_quads += turned
            for triangle in quad_triangles(*quad_vertex_indices(vertex_index, x, y), turned, native_render_order=True):
                indices.extend(triangle)
    seam_quads = strip_quads(native, region, seam_vertices)
    for x, y in seam_quads:
        turned = bit(words['EdgeTurnBitmap'], width, x, y)
        turned_quads += turned
        for triangle in quad_triangles(*quad_vertex_indices(vertex_index, x, y), turned, native_render_order=True):
            indices.extend(triangle)
    builder = GltfBuilder(generator)
    attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'),
                  'NORMAL': builder.accessor(normals, len(normals), 'VEC3'),
                  'TEXCOORD_0': builder.accessor(mask_uv, len(mask_uv), 'VEC2')}
    if layers:
        attributes['TEXCOORD_1'] = builder.accessor(layer_uvs[0], len(positions), 'VEC2')
    index_accessor = builder.accessor(indices, len(indices), 'SCALAR', 5125)
    for index, layer in enumerate(layers):
        layer['uvAccessor'] = builder.accessor(layer_uvs[index], len(positions), 'VEC2')
    builder.data.update(meshes=[{'name': region['object'], 'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}],
                                'extras': {'nativeObject': region['object'], 'nativeBounds': region['bounds'], 'sourceToGltf': SOURCE_TO_GLTF,
                                           'maskUvSet': MASK_UV_SET, 'baseLayerUvSet': BASE_LAYER_UV_SET if layers else None,
                                           'nativeLayers': layers}}],
                        materials=[{'name': NEUTRAL_INSPECTION_MATERIAL_NAME,
                                    'pbrMetallicRoughness': {'baseColorFactor': [.5, .5, .5, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
                        nodes=[{'name': region['object'], 'mesh': 0}], scenes=[{'nodes': [0]}], scene=0)
    extras = builder.data['meshes'][0]['extras']
    if mask_uv_rule is not None:
        extras['maskUVRule'] = mask_uv_rule
    if region.get('kind') == RECTANGLE_REGION_KIND:
        extras.pop('nativeBounds')
        extras.update(nativeSectorObjects=region['sectorObjects'], reconstructedBounds=bounds_with_points(region['bounds'], seam_vertices.values()),
                      nativeSectorRectangle=sector_rectangle)
    if seam_quads:
        extras['seamStripQuads'] = len(seam_quads)
    return builder.files(), {'vertexCount': len(positions), 'triangleCount': len(indices)//3,
                             'hiddenQuads': hidden_quads, 'turnedQuads': turned_quads, 'seamStripQuads': len(seam_quads)}
