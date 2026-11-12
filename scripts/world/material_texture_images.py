import hashlib
from pathlib import Path

from native_store.catalog_writer import immutable_write
from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, require_converter_output

NATIVE_RESOURCE_PREFIX = '/l2/'
MATERIAL_TEXTURE_IMAGES_FOLDER = 'textures'
MATERIAL_TEXTURE_IMAGE_NAME = 'texture.png'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
TEXTURE_CLASS = 'Engine.Texture'
REVIEWED_NODE_STATUS = 'reviewed'


class MaterialTextureImageError(ValueError):
    pass


def reviewed_texture_nodes(graph):
    return [node for node in graph['nodes'] if node['classObject'] == TEXTURE_CLASS and node['status'] == REVIEWED_NODE_STATUS]


def material_texture_image_store_path(png_sha256):
    return f'{NATIVE_MATERIALS_FOLDER}/{MATERIAL_TEXTURE_IMAGES_FOLDER}/{png_sha256}/{MATERIAL_TEXTURE_IMAGE_NAME}'


def material_texture_image_file(png):
    if not png.startswith(PNG_SIGNATURE):
        raise MaterialTextureImageError('a material texture image must be a PNG')
    png_sha256 = hashlib.sha256(png).hexdigest()
    return {'path': material_texture_image_store_path(png_sha256), 'sha256': png_sha256, 'bytes': len(png)}


def material_texture_image_pins(pngs_by_node):
    return {node: {**(file := material_texture_image_file(png)), 'path': NATIVE_RESOURCE_PREFIX + file['path']}
            for node, png in pngs_by_node.items()}


def write_material_texture_images(output_root, pngs_by_node):
    store_root = require_converter_output(REPOSITORY_ROOT, Path(output_root))
    files = {}
    for png in pngs_by_node.values():
        record = material_texture_image_file(png)
        immutable_write(confined_child_path(store_root, record['path']), png)
        files[record['path']] = record
    return [files[path] for path in sorted(files)]
