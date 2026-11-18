import hashlib
import re
from types import MappingProxyType
from typing import NamedTuple

from native_assets_lib.texture_source_reader import (FORMATS, INTEGER_PROPERTY_TYPE, MAX_DIMENSION, MAX_MIPS, UnsupportedTextureSource, expected_mip_bytes,
                                                     integer_property)
from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER

NATIVE_RESOURCE_PREFIX = '/l2/'
MATERIAL_TEXTURE_MIPS_FOLDER = 'texture-mips'
MATERIAL_TEXTURE_MIP_LEVEL_NAME = 'level.bin'
PUBLISHED_MIP_CHAIN_FORMAT_NAMES = ('DXT1', 'DXT3', 'DXT5', 'RGBA8')
FORMAT_IDS_BY_NAME = {name: format_id for format_id, name in FORMATS.items()}
MIP_CHAIN_MEMBERS = ('firstMip', 'format', 'levels')
MIP_LEVEL_MEMBERS = ('bytes', 'height', 'path', 'sha256', 'width')
SHA256_PATTERN = re.compile(r'[a-f0-9]{64}')
NATIVE_TEXTURE_RETENTION_SETTINGS = MappingProxyType({'textureDetail': 0, 'keepMinFrameRate': False})
MIN_LOD_PROPERTY = 'MinLOD'
MIN_LOD_CLASS_DEFAULT = 0
KEEP_MIN_FRAME_RATE_TEXTURE_DETAIL = 2
FIRST_MIP_MINIMUM_EDGE = 64
POSTLOAD_WIDE_EDGE = 256


class MaterialTextureMipChainError(ValueError):
    pass


class NativeMipLevel(NamedTuple):
    width: int
    height: int
    payload: bytes


class NativeMipChain(NamedTuple):
    format_name: str
    first_mip: int
    levels: tuple


class NativeMipRetention(NamedTuple):
    first_mip: int
    retained_count: int

    @property
    def level_count(self):
        return self.retained_count - self.first_mip


def require_mip_chain(condition, message):
    if not condition:
        raise MaterialTextureMipChainError(message)


def postload_max_lod(mip_dimensions):
    for index, (width, height) in enumerate(mip_dimensions):
        if width < FIRST_MIP_MINIMUM_EDGE or (height < FIRST_MIP_MINIMUM_EDGE and width < POSTLOAD_WIDE_EDGE and height < POSTLOAD_WIDE_EDGE):
            return index
    return len(mip_dimensions) - 1


def native_default_lod(texture_detail, keep_min_frame_rate, min_lod, max_lod):
    requested = KEEP_MIN_FRAME_RATE_TEXTURE_DETAIL if keep_min_frame_rate else texture_detail
    return min_lod if requested < min_lod else min(requested, max_lod)


def native_first_mip_of_lod(width, height, lod, min_lod):
    if (width >> lod) < FIRST_MIP_MINIMUM_EDGE:
        while (height >> lod) < FIRST_MIP_MINIMUM_EDGE and lod > 0:
            lod -= 1
            if (width >> lod) >= FIRST_MIP_MINIMUM_EDGE:
                break
    return max(lod, min_lod)


def native_retained_mip_count(stored_count, width, height):
    return min(stored_count, min(width, height).bit_length())


def native_size_capped_first_mip(first_mip, retained_count, width, height, maximum_width, maximum_height):
    while (width >> first_mip) > maximum_width or (height >> first_mip) > maximum_height:
        first_mip += 1
        require_mip_chain(first_mip < retained_count, f'a {width}x{height} texture exceeds {maximum_width}x{maximum_height} at every retained level and takes the native alternate route')
    return first_mip


def native_mip_retention(width, height, stored_dimensions, min_lod, settings=NATIVE_TEXTURE_RETENTION_SETTINGS):
    lod = native_default_lod(settings['textureDetail'], settings['keepMinFrameRate'], min_lod, postload_max_lod(stored_dimensions))
    retained_count = native_retained_mip_count(len(stored_dimensions), width, height)
    first_mip = native_size_capped_first_mip(native_first_mip_of_lod(width, height, lod, min_lod), retained_count, width, height,
                                             MAX_DIMENSION, MAX_DIMENSION)
    require_mip_chain(first_mip < retained_count, f'a {width}x{height} texture with MinLOD {min_lod} starts at mip {first_mip} but retains {retained_count} levels')
    return NativeMipRetention(first_mip, retained_count)


def texture_min_lod(metadata):
    min_lod = integer_property(metadata['propertyTags'], MIN_LOD_PROPERTY, INTEGER_PROPERTY_TYPE)
    return MIN_LOD_CLASS_DEFAULT if min_lod is None else min_lod


def native_mip_chain_of_texture_source(native_source):
    if isinstance(native_source, UnsupportedTextureSource):
        return None
    metadata, files = native_source
    format_name = metadata['format']['name']
    if format_name not in PUBLISHED_MIP_CHAIN_FORMAT_NAMES:
        return None
    mips = metadata['mips']
    retention = native_mip_retention(mips[0]['width'], mips[0]['height'], [(mip['width'], mip['height']) for mip in mips], texture_min_lod(metadata))
    retained = mips[retention.first_mip:retention.retained_count]
    return NativeMipChain(format_name, retention.first_mip, tuple(NativeMipLevel(mip['width'], mip['height'], files[mip['file']]) for mip in retained))


def material_texture_mip_level_store_path(level_sha256):
    return f'{NATIVE_MATERIALS_FOLDER}/{MATERIAL_TEXTURE_MIPS_FOLDER}/{level_sha256}/{MATERIAL_TEXTURE_MIP_LEVEL_NAME}'


def material_texture_mip_level_file(payload):
    level_sha256 = hashlib.sha256(payload).hexdigest()
    return {'path': material_texture_mip_level_store_path(level_sha256), 'sha256': level_sha256, 'bytes': len(payload)}


def material_texture_mip_chain_pin(chain):
    levels = []
    for level in chain.levels:
        level_file = material_texture_mip_level_file(level.payload)
        levels.append({'width': level.width, 'height': level.height, 'bytes': level_file['bytes'], 'sha256': level_file['sha256'],
                       'path': NATIVE_RESOURCE_PREFIX + level_file['path']})
    return {'format': chain.format_name, 'firstMip': chain.first_mip, 'levels': levels}


def is_bounded_dimension(value):
    return type(value) is int and 1 <= value <= MAX_DIMENSION


def checked_mip_level(label, format_name, level, previous):
    require_mip_chain(isinstance(level, dict) and sorted(level) == list(MIP_LEVEL_MEMBERS),
                      f'{label} must be an object that holds exactly the members {", ".join(MIP_LEVEL_MEMBERS)}')
    width, height, size, level_sha256, path = level['width'], level['height'], level['bytes'], level['sha256'], level['path']
    require_mip_chain(is_bounded_dimension(width) and is_bounded_dimension(height), f'{label} width and height must be 1 to {MAX_DIMENSION}')
    if previous is not None:
        require_mip_chain(min(previous['width'], previous['height']) > 1 and (width, height) == (max(1, previous['width'] // 2), max(1, previous['height'] // 2)),
                          f'{label} {width}x{height} does not halve the previous level {previous["width"]}x{previous["height"]}')
    expected_bytes = expected_mip_bytes(FORMAT_IDS_BY_NAME[format_name], width, height)
    require_mip_chain(type(size) is int and size == expected_bytes, f'{label} bytes {size!r} differ from the {expected_bytes} bytes of a {width}x{height} {format_name} level')
    require_mip_chain(isinstance(level_sha256, str) and SHA256_PATTERN.fullmatch(level_sha256) is not None, f'{label} sha256 {level_sha256!r} is not a SHA-256')
    expected_path = NATIVE_RESOURCE_PREFIX + material_texture_mip_level_store_path(level_sha256)
    require_mip_chain(path == expected_path, f'{label} path {path!r} is not its SHA-256 store path {expected_path}')
    return {'width': width, 'height': height, 'bytes': size, 'sha256': level_sha256, 'path': path}


def checked_material_texture_mip_chain_pin(label, chain):
    require_mip_chain(isinstance(chain, dict) and sorted(chain) == list(MIP_CHAIN_MEMBERS),
                      f'{label} must be an object that holds exactly the members {", ".join(MIP_CHAIN_MEMBERS)}')
    format_name, first_mip, levels = chain['format'], chain['firstMip'], chain['levels']
    require_mip_chain(format_name in PUBLISHED_MIP_CHAIN_FORMAT_NAMES, f'{label} format {format_name!r} is not one of {", ".join(PUBLISHED_MIP_CHAIN_FORMAT_NAMES)}')
    require_mip_chain(type(first_mip) is int and 0 <= first_mip < MAX_MIPS, f'{label} firstMip {first_mip!r} is not a level index below {MAX_MIPS}')
    require_mip_chain(isinstance(levels, list) and 1 <= len(levels) <= MAX_MIPS, f'{label} levels must hold 1 to {MAX_MIPS} levels')
    checked_levels = []
    for index, level in enumerate(levels):
        checked_levels.append(checked_mip_level(f'{label} level {index}', format_name, level, checked_levels[-1] if checked_levels else None))
    return {'format': format_name, 'firstMip': first_mip, 'levels': checked_levels}
