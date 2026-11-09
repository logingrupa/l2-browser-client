import json
import struct

from world.terrain_coordinates import f32

SYNTHETIC_TERRAIN_OBJECT = 'Fixture.TerrainInfo0'
SYNTHETIC_QUADS_PER_SECTOR = 2
SYNTHETIC_SAMPLE_SPACING = 128.0
ALL_BITS_SET = 0xFFFFFFFF
ALTERNATING_BITS = 0x55555555
IDENTITY_TEXTURE_MATRIX = [[1 / 128, 0, 0, 0], [0, 1 / 128, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def synthetic_native_terrain(sector_columns, sector_rows, quads_per_sector=SYNTHETIC_QUADS_PER_SECTOR):
    sectors = []
    for row in range(sector_rows):
        for column in range(sector_columns):
            sectors.append({'object': f'{SYNTHETIC_TERRAIN_OBJECT}.TerrainSector{len(sectors)}',
                            'offset': [column * quads_per_sector, row * quads_per_sector],
                            'quads': [quads_per_sector, quads_per_sector], 'bounds': [0.0] * 6})
    return {'object': SYNTHETIC_TERRAIN_OBJECT, 'exportIndex': 1, 'width': sector_columns * quads_per_sector + 1,
            'height': sector_rows * quads_per_sector + 1, 'sectorsX': sector_columns, 'sectorsY': sector_rows, 'sectors': sectors}


def synthetic_height(x, y):
    return f32(((x * 7 + y * 13) % 11) * 16.0)


def synthetic_terrain_points(native):
    return [[f32(x * SYNTHETIC_SAMPLE_SPACING), f32(y * SYNTHETIC_SAMPLE_SPACING), synthetic_height(x, y)]
            for y in range(native['height']) for x in range(native['width'])]


def with_reconstructed_sector_bounds(native, points):
    width = native['width']
    for sector in native['sectors']:
        origin_x, origin_y = sector['offset']
        quads_x, quads_y = sector['quads']
        vertices = [points[y * width + x] for y in range(origin_y, origin_y + quads_y + 1) for x in range(origin_x, origin_x + quads_x + 1)]
        sector['bounds'] = [min(p[i] for p in vertices) for i in range(3)] + [max(p[i] for p in vertices) for i in range(3)]
    return native


def bitmap_words(native, word):
    return tuple([word] * (-(-native['width'] * native['height'] // 32)))


def synthetic_topology_words(native, visibility_word=ALL_BITS_SET, edge_turn_word=ALTERNATING_BITS):
    return {'QuadVisibilityBitmap': bitmap_words(native, visibility_word), 'EdgeTurnBitmap': bitmap_words(native, edge_turn_word)}


def synthetic_layer_records(indices, textures=None):
    return [{'index': index, 'texture': (textures or {}).get(index, f'Fixture.Diffuse{index}'), 'alphaMap': f'Fixture.Mask{index}',
             'useAlpha': True, 'worldToTextureRowMajor': IDENTITY_TEXTURE_MATRIX} for index in indices]


def synthetic_terrain(sector_columns, sector_rows):
    native = synthetic_native_terrain(sector_columns, sector_rows)
    points = synthetic_terrain_points(native)
    return with_reconstructed_sector_bounds(native, points), points


def glb_document_and_binary(glb):
    json_size = struct.unpack_from('<I', glb, 12)[0]
    return json.loads(glb[20:20 + json_size]), glb[28 + json_size:]


def glb_accessor_rows(document, binary, accessor_index):
    accessor = document['accessors'][accessor_index]
    view = document['bufferViews'][accessor['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[accessor['type']]
    code = 'I' if accessor['componentType'] == 5125 else 'f'
    payload = binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]
    return [row if width > 1 else row[0] for row in struct.iter_unpack('<' + str(width) + code, payload)]


def glb_mesh_arrays(glb):
    document, binary = glb_document_and_binary(glb)
    primitive = document['meshes'][0]['primitives'][0]
    return {'POSITION': glb_accessor_rows(document, binary, primitive['attributes']['POSITION']),
            'NORMAL': glb_accessor_rows(document, binary, primitive['attributes']['NORMAL']),
            'indices': glb_accessor_rows(document, binary, primitive['indices']), 'extras': document['meshes'][0]['extras']}


def glb_triangle_positions(arrays):
    indices = arrays['indices']
    return {tuple(arrays['POSITION'][index] for index in indices[offset:offset + 3]) for offset in range(0, len(indices), 3)}
