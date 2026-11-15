import hashlib
import json
from pathlib import Path

from native_store.catalog_writer import add_store_file
from native_store.native_material_program_pins import MATERIAL_PROGRAM_FILE_NAME, NATIVE_MATERIALS_FOLDER
from native_store.store_file_publish import publish_store_files
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
    records_by_path, store_files = {}, {}
    for png in pngs_by_node.values():
        record = material_texture_image_file(png)
        add_store_file(store_files, record['path'], png)
        records_by_path[record['path']] = record
    publish_store_files(store_root, store_files)
    return [records_by_path[path] for path in sorted(records_by_path)]


def texture_image_pins_of_stored_programs(store_root):
    pins_by_texture = {}
    for program_path in sorted((store_root / NATIVE_MATERIALS_FOLDER).glob(f'*/{MATERIAL_PROGRAM_FILE_NAME}')):
        for node in json.loads(program_path.read_bytes())['nodes']:
            if node.get('image') is not None:
                pins_by_texture.setdefault(node['id'].casefold(), node['image'])
    return pins_by_texture


class StoredMaterialTextureImages:
    def __init__(self, store_root):
        self.store_root = store_root
        self.pins_by_texture = None

    def stored_pins(self):
        if self.pins_by_texture is None:
            self.pins_by_texture = texture_image_pins_of_stored_programs(self.store_root)
        return self.pins_by_texture

    def stored_png(self, texture_object):
        pin = self.stored_pins().get(texture_object.casefold())
        if pin is None:
            return None
        path = confined_child_path(self.store_root, pin['path'].removeprefix(NATIVE_RESOURCE_PREFIX))
        if not path.is_file():
            return None
        png = path.read_bytes()
        if hashlib.sha256(png).hexdigest() != pin['sha256']:
            raise MaterialTextureImageError(f'stored texture image {pin["path"]} of {texture_object} differs from its SHA-256 {pin["sha256"]}')
        return png

    def remember(self, texture_object, png):
        self.stored_pins()[texture_object.casefold()] = material_texture_image_pins({texture_object: png})[texture_object]


stored_texture_images_by_store_root = {}


def stored_material_texture_images(store_root):
    resolved_store_root = Path(store_root).resolve()
    return stored_texture_images_by_store_root.setdefault(resolved_store_root, StoredMaterialTextureImages(resolved_store_root))
