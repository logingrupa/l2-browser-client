import json
from pathlib import Path
import struct

from world.map_actor_properties import HAS_STACK
from world.reader_licensee_layouts import NO_MATERIAL_PREFIX, RESERVED_INT32_MATERIAL_PREFIX, SHADER_BLOCK_MATERIAL_PREFIX
from ue2_package_fixture import compact, package_bytes, tag

ROOT = Path(__file__).resolve().parents[2]
WORLD_READER_FIXTURE_ROOT = ROOT / 'tests/fixtures/world-readers'
LICENSEE_HEADER_OFFSET = 6
OBJECT_PROPERTY_TYPE = 5
BYTE_PROPERTY_TYPE = 1
INTEGER_PROPERTY_TYPE = 2
STRUCT_PROPERTY_TYPE = 10
EMPTY_STATE_FRAME = compact(0) + compact(0) + struct.pack('<QI', 0, 0)
SHADER_BLOCK_MATRIX_ENTRIES = 8
SHADER_BLOCK_MATRIX_ENTRY_BYTES = 128
SHADER_BLOCK_TEXTURE_STRINGS = 16
TEXTURE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Texture')]
TEXTURE_CLASS_IMPORT = -2
MAP_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'StaticMeshActor'), ('Core', 'Class', -1, 'TerrainInfo'),
               ('Core', 'Class', -1, 'TerrainSector'), ('Core', 'Class', -1, 'Texture'), ('Core', 'Package', 0, 'T_FixtureTerrain'),
               ('Engine', 'Texture', -6, 'HeightFixture')]
STATIC_MESH_ACTOR_CLASS_IMPORT = -2
TERRAIN_INFO_CLASS_IMPORT = -3
TERRAIN_SECTOR_CLASS_IMPORT = -4
MAP_TEXTURE_CLASS_IMPORT = -5
TERRAIN_MAP_IMPORT = -7
TERRAIN_INFO_EXPORT_INDEX = 2
TERRAIN_SECTOR_EXPORT_INDEX = 3


def read_world_reader_fixture(name):
    return json.loads((WORLD_READER_FIXTURE_ROOT / name).read_text(encoding='utf-8'))


def world_reader_fixture_names(stem):
    return sorted(path.name for path in WORLD_READER_FIXTURE_ROOT.glob(f'{stem}-*.json'))


def with_licensee(data, licensee):
    patched = bytearray(data)
    struct.pack_into('<H', patched, LICENSEE_HEADER_OFFSET, licensee)
    return bytes(patched)


def material_prefix_bytes(prefix):
    if prefix == NO_MATERIAL_PREFIX:
        return b''
    reserved = struct.pack('<i', 0)
    if prefix == RESERVED_INT32_MATERIAL_PREFIX:
        return reserved
    if prefix != SHADER_BLOCK_MATERIAL_PREFIX:
        raise ValueError(f'unknown material prefix {prefix!r}')
    blend_state = bytes(6) + struct.pack('<3i', 1, 2, 3)
    matrix_table = b''.join(bytes([index, 0]) + bytes(SHADER_BLOCK_MATRIX_ENTRY_BYTES - 2) for index in range(SHADER_BLOCK_MATRIX_ENTRIES))
    fade_fields = bytes(8) + struct.pack('<3i', 0, 0, 0)
    empty_strings = compact(0) * (SHADER_BLOCK_TEXTURE_STRINGS + 1)
    return reserved + blend_state + matrix_table + fade_fields + empty_strings


def g16_texture_body(texture):
    def body(offset, names):
        properties = (tag(names, 'Format', BYTE_PROPERTY_TYPE, bytes([texture['format']]))
                      + tag(names, 'USize', INTEGER_PROPERTY_TYPE, struct.pack('<i', texture['uSize']))
                      + tag(names, 'VSize', INTEGER_PROPERTY_TYPE, struct.pack('<i', texture['vSize'])) + compact(names['None']))
        samples = struct.pack(f'<{len(texture["samples"])}H', *texture['samples'])
        head = properties + material_prefix_bytes(texture['materialPrefix']) + compact(1)
        sample_count = compact(len(samples))
        skip = offset + len(head) + 4 + len(sample_count) + len(samples)
        return (head + struct.pack('<i', skip) + sample_count + samples
                + struct.pack('<ii', texture['uSize'], texture['vSize']) + bytes([texture['uBits'], texture['vBits']]))
    return body


def g16_heightmap_package_bytes(fixture, licensee=None):
    texture = fixture['texture']
    data = package_bytes(['Format', 'USize', 'VSize'], TEXTURE_IMPORTS,
                         [{'name': texture['name'], 'class': TEXTURE_CLASS_IMPORT, 'body': g16_texture_body(texture)}])
    return with_licensee(data, fixture['licenseeVersion'] if licensee is None else licensee)


def static_mesh_actor_body(actor):
    def body(offset, names):
        location = tag(names, 'Location', STRUCT_PROPERTY_TYPE, struct.pack('<3f', *actor['location']), 'Vector')
        return EMPTY_STATE_FRAME + location + compact(names['None'])
    return body


def terrain_info_body(terrain):
    def body(offset, names):
        terrain_map = tag(names, 'TerrainMap', OBJECT_PROPERTY_TYPE, compact(TERRAIN_MAP_IMPORT))
        coordinates = b''.join(struct.pack('<3f', *row) for row in (*terrain['toWorld'], *terrain['toHeightmap']))
        colors = bytes(terrain['vertexColorsBGRA'])
        native_payload = (compact(1) + compact(TERRAIN_SECTOR_EXPORT_INDEX) + struct.pack('<2i', *terrain['sectorCounts']) + coordinates
                          + struct.pack('<2i', *terrain['heightmapSize']) + compact(len(colors) // 4) + colors)
        return EMPTY_STATE_FRAME + terrain_map + compact(names['None']) + native_payload
    return body


def terrain_sector_body(sector):
    def body(offset, names):
        extent = struct.pack('<4i', *sector['quads'], *sector['offset'])
        return compact(names['None']) + compact(TERRAIN_INFO_EXPORT_INDEX) + extent + struct.pack('<6f', *sector['bounds']) + b'\x01'
    return body


def material_export_body(material):
    def body(offset, names):
        return compact(names['None']) + material_prefix_bytes(material['materialPrefix']) + compact(0)
    return body


def map_package_bytes(fixture, licensee=None, include_terrain_info=True):
    terrain = fixture['terrainInfo']
    exports = [{'name': fixture['staticMeshActor']['name'], 'class': STATIC_MESH_ACTOR_CLASS_IMPORT, 'flags': HAS_STACK,
                'body': static_mesh_actor_body(fixture['staticMeshActor'])}]
    if include_terrain_info:
        exports += [{'name': terrain['name'], 'class': TERRAIN_INFO_CLASS_IMPORT, 'flags': HAS_STACK, 'body': terrain_info_body(terrain)},
                    {'name': terrain['sector']['name'], 'class': TERRAIN_SECTOR_CLASS_IMPORT, 'outer': TERRAIN_INFO_EXPORT_INDEX,
                     'body': terrain_sector_body(terrain['sector'])}]
    exports.append({'name': fixture['materialExport']['name'], 'class': MAP_TEXTURE_CLASS_IMPORT,
                    'body': material_export_body(fixture['materialExport'])})
    data = package_bytes(['Location', 'Vector', 'TerrainMap'], MAP_IMPORTS, exports)
    return with_licensee(data, fixture['licenseeVersion'] if licensee is None else licensee)
