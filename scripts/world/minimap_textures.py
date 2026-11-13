import hashlib
from pathlib import Path
import struct

from native_assets import UMODEL, Converter
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source
from native_assets_lib.texture_package_118 import read_unreal_package
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import add_store_file
from native_store.interprocess_lock import convert_under_request_lock
from native_store.store_file_publish import publish_store_files
from native_store.store_paths import lane_work_root
from reference_client_guard import require_reference_client
from world.static_mesh_step import MODEL_CONVERSION_ERRORS, conversion_failure_reason
from world.tile_census import WORLD_LANE_NAME

MINIMAP_TEXTURE_CONVERTER_FOLDER = 'minimap-texture-converter'
TEXTURE_ARCHIVE_NAME = 'asset.l2asset'
TEXTURE_IMAGE_NAME = 'texture.png'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
TEXTURE_CLASS_NAME = 'Texture'
TEXTURE_SOURCE_READABLE_STATUS = 'readable'
TEXTURE_SOURCE_GAP_STATUS = 'gap'


class MinimapTextureError(ValueError):
    pass


class MinimapTextureConversion:
    def __init__(self, conversion, image):
        self.conversion, self.image = conversion, image


def texture_export_source_status(package, export):
    try:
        metadata, _ = build_texture_source(package, export)
    except UnsupportedTextureSource as error:
        return {'status': TEXTURE_SOURCE_GAP_STATUS, 'reason': error.reason}
    except FormatError as error:
        return {'status': TEXTURE_SOURCE_GAP_STATUS, 'reason': conversion_failure_reason(error)}
    return {'status': TEXTURE_SOURCE_READABLE_STATUS, 'format': metadata['format']['name']}


def texture_package_index(package, relative_path):
    return {'path': relative_path, 'sha256': package.source_hash, 'packageVersion': package.summary['version'],
            'licensee': package.summary['licenseeVersion'], 'packageName': package.package_name,
            'exports': [{'exportIndex': export['exportIndex'], 'name': export['name'], 'object': export['object'],
                         'textureSource': texture_export_source_status(package, export)}
                        for export in package.exports if export['className'] == TEXTURE_CLASS_NAME]}


def read_texture_package(client, relative_path):
    path = require_reference_client(client).require_equal_file(relative_path)
    return read_unreal_package(path.read_bytes(), path.name)


def read_texture_package_index(client, relative_path):
    return texture_package_index(read_texture_package(client, relative_path), relative_path)


def export_named(package_index, object_name):
    return next((export for export in package_index['exports'] if export['object'].casefold() == object_name.casefold()), None)


def png_dimensions(png_bytes):
    if png_bytes[:8] != PNG_SIGNATURE or png_bytes[12:16] != b'IHDR':
        raise MinimapTextureError('converted minimap texture is not a PNG with an IHDR chunk')
    return list(struct.unpack('>II', png_bytes[16:24]))


def minimap_texture_converter(project_root, client):
    return Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / MINIMAP_TEXTURE_CONVERTER_FOLDER, UMODEL, project_root=project_root)


def convert_minimap_texture(converter, package_name, object_name):
    try:
        conversion = convert_under_request_lock(converter, {'kind': 'texture', 'package': package_name, 'object': object_name})
    except MODEL_CONVERSION_ERRORS as error:
        return None, conversion_failure_reason(error)
    archive_path = Path(conversion['file'])
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != conversion['sha256']:
        raise MinimapTextureError(f'converted archive {archive_path} differs from its reported SHA-256')
    return MinimapTextureConversion(conversion, (archive_path.parent / TEXTURE_IMAGE_NAME).read_bytes()), None


def store_converted_texture(store_root, texture_conversion, texture):
    conversion = texture_conversion.conversion
    archive = Path(conversion['file']).read_bytes()
    dimensions = png_dimensions(texture_conversion.image)
    relative = f'{conversion["sha256"]}/{TEXTURE_ARCHIVE_NAME}'
    destination = {}
    add_store_file(destination, relative, archive)
    publish_store_files(store_root, destination)
    record = {'archive': f'/l2/{relative}', 'archiveSha256': conversion['sha256'], 'archiveBytes': len(archive),
              'sourceObject': texture['object'], 'rule': texture['rule']}
    output = {'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': conversion['sha256'], 'bytes': len(archive)}
    return record, dimensions, output
