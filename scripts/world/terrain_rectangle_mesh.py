from world.gltf_builder import GltfBuilder
from world.native_terrain_sectors import bit, quad_triangles, vertex_normal
from world.terrain_coordinates import SOURCE_TO_GLTF, native_to_gltf
from world.terrain_layers import terrain_mask_uv, texture_uv

NEUTRAL_INSPECTION_MATERIAL_NAME = 'Neutral geometry inspection; native terrain shader pending'
RECTANGLE_REGION_KIND = 'native-sector-rectangle'


def rectangle_sample_grid(region):
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    return [(x, y) for y in range(origin_y, origin_y+quads_y+1) for x in range(origin_x, origin_x+quads_x+1)]


def build_terrain_rectangle_gltf(native, points, words, layers, region, mask_uv_rule, sector_rectangle, generator):
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    width, height = native['width'], native['height']
    positions, normals, mask_uv = [], [], []
    layer_uvs = [[] for _ in layers]
    for x, y in rectangle_sample_grid(region):
        point = points[y*width+x]
        positions.append(native_to_gltf(point))
        normal = vertex_normal(points, words['EdgeTurnBitmap'], width, height, x, y)
        normals.append([normal[0], normal[2], normal[1]])
        mask_uv.append(terrain_mask_uv(x, y, width, height, mask_uv_rule))
        for index, layer in enumerate(layers):
            layer_uvs[index].append(texture_uv(layer['worldToTextureRowMajor'], point))
    indices, hidden_quads, turned_quads = [], 0, 0
    for y in range(quads_y):
        for x in range(quads_x):
            if not bit(words['QuadVisibilityBitmap'], width, origin_x+x, origin_y+y):
                hidden_quads += 1
                continue
            turned = bit(words['EdgeTurnBitmap'], width, origin_x+x, origin_y+y)
            turned_quads += turned
            first_vertex = y*(quads_x+1)+x
            for triangle in quad_triangles(first_vertex, first_vertex+1, first_vertex+quads_x+1, first_vertex+quads_x+2, turned,
                                           native_render_order=True):
                indices.extend(triangle)
    builder = GltfBuilder(generator)
    attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'),
                  'NORMAL': builder.accessor(normals, len(normals), 'VEC3'),
                  'TEXCOORD_0': builder.accessor(mask_uv, len(mask_uv), 'VEC2'),
                  'TEXCOORD_1': builder.accessor(layer_uvs[0], len(positions), 'VEC2')}
    index_accessor = builder.accessor(indices, len(indices), 'SCALAR', 5125)
    for index, layer in enumerate(layers):
        layer['uvAccessor'] = builder.accessor(layer_uvs[index], len(positions), 'VEC2')
    builder.data.update(meshes=[{'name': region['object'], 'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}],
                                'extras': {'nativeObject': region['object'], 'nativeBounds': region['bounds'], 'sourceToGltf': SOURCE_TO_GLTF,
                                           'maskUvSet': 0, 'baseLayerUvSet': 1, 'nativeLayers': layers}}],
                        materials=[{'name': NEUTRAL_INSPECTION_MATERIAL_NAME,
                                    'pbrMetallicRoughness': {'baseColorFactor': [.5, .5, .5, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
                        nodes=[{'name': region['object'], 'mesh': 0}], scenes=[{'nodes': [0]}], scene=0)
    extras = builder.data['meshes'][0]['extras']
    if mask_uv_rule is not None:
        extras['maskUVRule'] = mask_uv_rule
    if region.get('kind') == RECTANGLE_REGION_KIND:
        extras.pop('nativeBounds')
        extras.update(nativeSectorObjects=region['sectorObjects'], reconstructedBounds=region['bounds'],
                      nativeSectorRectangle=sector_rectangle)
    return builder.files(), {'vertexCount': len(positions), 'triangleCount': len(indices)//3,
                             'hiddenQuads': hidden_quads, 'turnedQuads': turned_quads}
