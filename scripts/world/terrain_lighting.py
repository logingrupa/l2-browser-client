from typing import NamedTuple

from native_catalog.ue2 import FormatError

TERRAIN_SECTOR_CLASS = 'Engine.TerrainSector'
SECTOR_HEAD_INTEGERS = 4
SECTOR_HEAD_FLOATS = 6
SECTOR_VISIBILITY_MASK_WORDS = 32
MAXIMUM_SECTOR_LIGHTS = 65_536
MAXIMUM_SECTOR_BYTES = 1 << 20
MAXIMUM_SHADOW_MAPS = 64
MAXIMUM_TEXTURE_INFO_WORDS = 65_536
SHADOW_FLAGS = (0, 1)


class TerrainSectorLight(NamedTuple):
    light_reference: int
    visibility_bits: bytes


class TerrainSectorLighting(NamedTuple):
    export_index: int
    object: str
    lights: tuple
    shadow_maps: tuple


def counted_bytes(reader, label):
    byte_count = reader.compact()
    if not 0 <= byte_count <= MAXIMUM_SECTOR_BYTES:
        raise FormatError(f'{label} declares {byte_count} bytes')
    return bytes(reader.take(byte_count))


def skip_sector_head(reader):
    reader.compact()
    for _ in range(SECTOR_HEAD_INTEGERS):
        reader.number('i')
    for _ in range(SECTOR_HEAD_FLOATS):
        reader.number('f')
    reader.number('B')


def read_sector_lights(reader, label):
    count = reader.compact()
    if not 0 <= count <= MAXIMUM_SECTOR_LIGHTS:
        raise FormatError(f'{label} declares {count} lights')
    return tuple(TerrainSectorLight(reader.compact(), counted_bytes(reader, f'{label} light visibility')) for _ in range(count))


def read_sector_shadow_maps(reader, label):
    has_shadow_maps = reader.number('i')
    if has_shadow_maps not in SHADOW_FLAGS:
        raise FormatError(f'{label} shadow flag is {has_shadow_maps}')
    if not has_shadow_maps:
        return ()
    count = reader.number('i')
    if not 0 <= count <= MAXIMUM_SHADOW_MAPS:
        raise FormatError(f'{label} declares {count} shadow maps')
    return tuple(counted_bytes(reader, f'{label} shadow map') for _ in range(count))


def skip_sector_render_tail(reader, label):
    for _ in range(SECTOR_VISIBILITY_MASK_WORDS):
        reader.number('h')
    word_count = reader.compact()
    if not 0 <= word_count <= MAXIMUM_TEXTURE_INFO_WORDS:
        raise FormatError(f'{label} declares {word_count} texture info words')
    reader.take(2 * word_count)


def read_terrain_sector_lighting(package, sector_export_index):
    sector = package.exports[sector_export_index - 1]
    if sector['classObject'] != TERRAIN_SECTOR_CLASS:
        raise FormatError(f'export {sector_export_index} is a {sector["classObject"]}, not a terrain sector')
    label = f'terrain sector {sector["object"]}'
    _, reader = package.properties(sector)
    skip_sector_head(reader)
    lights = read_sector_lights(reader, label)
    shadow_maps = read_sector_shadow_maps(reader, label)
    skip_sector_render_tail(reader, label)
    if reader.position != reader.end:
        raise FormatError(f'{label} holds {reader.end - reader.position} bytes after its lighting')
    return TerrainSectorLighting(sector_export_index, sector['object'], lights, shadow_maps)


def read_terrain_lighting(package, terrain):
    return tuple(read_terrain_sector_lighting(package, sector['exportIndex']) for sector in terrain['sectors'])
