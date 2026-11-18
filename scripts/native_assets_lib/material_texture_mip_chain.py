import hashlib
import re
from typing import NamedTuple

from native_assets_lib.texture_source_reader import FORMATS, MAX_DIMENSION, MAX_MIPS, UnsupportedTextureSource, expected_mip_bytes
from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER

NATIVE_RESOURCE_PREFIX = '/l2/'
MATERIAL_TEXTURE_MIPS_FOLDER = 'texture-mips'
MATERIAL_TEXTURE_MIP_LEVEL_NAME = 'level.bin'
PUBLISHED_MIP_CHAIN_FORMAT_NAMES = ('DXT1', 'DXT3', 'DXT5', 'RGBA8')
FORMAT_IDS_BY_NAME = {name: format_id for format_id, name in FORMATS.items()}
MIP_CHAIN_MEMBERS = ('format', 'levels')
MIP_LEVEL_MEMBERS = ('bytes', 'height', 'path', 'sha256', 'width')
SHA256_PATTERN = re.compile(r'[a-f0-9]{64}')


class MaterialTextureMipChainError(ValueError):
    pass


class NativeMipLevel(NamedTuple):
    width: int
    height: int
    payload: bytes


class NativeMipChain(NamedTuple):
    format_name: str
    levels: tuple


def native_mip_chain_of_texture_source(native_source):
    if isinstance(native_source, UnsupportedTextureSource):
        return None
    metadata, files = native_source
    format_name = metadata['format']['name']
    if format_name not in PUBLISHED_MIP_CHAIN_FORMAT_NAMES:
        return None
    return NativeMipChain(format_name, tuple(NativeMipLevel(mip['width'], mip['height'], files[mip['file']]) for mip in metadata['mips']))


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
    return {'format': chain.format_name, 'levels': levels}


def require_mip_chain(condition, message):
    if not condition:
        raise MaterialTextureMipChainError(message)


def is_bounded_dimension(value):
    return type(value) is int and 1 <= value <= MAX_DIMENSION


def checked_mip_level(label, format_name, level, previous):
    require_mip_chain(isinstance(level, dict) and sorted(level) == list(MIP_LEVEL_MEMBERS),
                      f'{label} must be an object that holds exactly the members {", ".join(MIP_LEVEL_MEMBERS)}')
    width, height, size, level_sha256, path = level['width'], level['height'], level['bytes'], level['sha256'], level['path']
    require_mip_chain(is_bounded_dimension(width) and is_bounded_dimension(height), f'{label} width and height must be 1 to {MAX_DIMENSION}')
    if previous is not None:
        require_mip_chain((previous['width'], previous['height']) != (1, 1) and (width, height) == (max(1, previous['width'] // 2), max(1, previous['height'] // 2)),
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
    format_name, levels = chain['format'], chain['levels']
    require_mip_chain(format_name in PUBLISHED_MIP_CHAIN_FORMAT_NAMES, f'{label} format {format_name!r} is not one of {", ".join(PUBLISHED_MIP_CHAIN_FORMAT_NAMES)}')
    require_mip_chain(isinstance(levels, list) and 1 <= len(levels) <= MAX_MIPS, f'{label} levels must hold 1 to {MAX_MIPS} levels')
    checked_levels = []
    for index, level in enumerate(levels):
        checked_levels.append(checked_mip_level(f'{label} level {index}', format_name, level, checked_levels[-1] if checked_levels else None))
    return {'format': format_name, 'levels': checked_levels}
