import hashlib
import io
from typing import NamedTuple

import PIL
from PIL import Image

from native_assets_lib.gltf import json_bytes
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_program import derive_material_program
from native_assets_lib.texture_dds import UnsupportedTextureDDS, build_texture_dds
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source
from native_assets_lib.texture_source_reader import TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX
from native_catalog.ue2 import FormatError
from world.class_default_reads import kept_material_class_defaults
from world.material_texture_images import TEXTURE_CLASS, material_texture_image_pins, reviewed_texture_nodes
from world.pinned_image_decoder import DDS_PLUGIN_SHA256, IMAGING_BINARY_SHA256, require_pinned_image_decoder

OBJECT_PROPERTY_IMPORT_TARGET = 'import'
SKY_MATERIAL_EXTERNAL_REASON_PREFIX = 'sky-material-external:'
SKY_TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX = 'sky-texture-format-unsupported:'
SKY_MATERIAL_TEXTURE_COUNT_REASON_PREFIX = 'sky-material-texture-count:'


class SkyTextureUnsupported(ValueError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


class SkyMaterialGraph(NamedTuple):
    root_export: dict
    graph: dict
    gap_reasons: list


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def external_reference_reasons(graph):
    return sorted({SKY_MATERIAL_EXTERNAL_REASON_PREFIX + reference['to'].split('.')[0]
                   for reference in graph['references'] if reference['target'] == OBJECT_PROPERTY_IMPORT_TARGET})


def read_sky_material_graph(package, root_exports):
    graphs = []
    for root_export in root_exports:
        graph = read_material_graph(package, root_export)
        graphs.append(SkyMaterialGraph(root_export, graph, sorted({*graph['gapReasons'], *external_reference_reasons(graph)})))
    return graphs


def sky_material_program(graph, class_work_root, class_scripts, pngs_by_node):
    return derive_material_program(graph, kept_material_class_defaults(graph, class_work_root, class_scripts),
                                   texture_images=material_texture_image_pins(pngs_by_node))


def graph_texture_exports(package, graph):
    return [package.exports[node['exportIndex'] - 1] for node in graph['nodes'] if node['classObject'] == TEXTURE_CLASS]


def single_graph_texture_export(package, graph):
    textures = graph_texture_exports(package, graph)
    if len(textures) != 1:
        raise SkyTextureUnsupported(f'{SKY_MATERIAL_TEXTURE_COUNT_REASON_PREFIX}{len(textures)}',
                                    f'sky material {graph["root"]} reaches {len(textures)} textures, the sky part draws exactly one')
    return textures[0]


def format_unsupported(format_id, message):
    return SkyTextureUnsupported(f'{SKY_TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX}{format_id}', message)


def native_texture_source(package, item):
    try:
        return build_texture_source(package, item)
    except UnsupportedTextureSource as error:
        if error.reason.startswith(TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX):
            raise format_unsupported(error.reason.removeprefix(TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX), str(error)) from error
        raise SkyTextureUnsupported(error.reason, str(error)) from error


def sky_texture_products(package, texture_export):
    metadata, originals = native_texture_source(package, texture_export)
    try:
        dds_metadata, dds_files = build_texture_dds(metadata, originals)
    except UnsupportedTextureDDS as error:
        raise format_unsupported(metadata['format']['id'], str(error)) from error
    require_pinned_image_decoder()
    dds = dds_files['texture.dds']
    width, height = metadata['mips'][0]['width'], metadata['mips'][0]['height']
    image = Image.open(io.BytesIO(dds)).convert('RGBA')
    if image.size != (width, height):
        raise FormatError(f'decoded sky texture {texture_export["object"]} is {image.size}, not {width}x{height}')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', compress_level=9)
    name = texture_export['object'].rsplit('.', 1)[-1]
    files = {f'{name}.png': buffer.getvalue(), f'{name}.dds': dds, f'{name}.export.bin': originals['native/texture-export.bin'],
             f'{name}.native.json': json_bytes(metadata), f'{name}.dds.json': json_bytes(dds_metadata)}
    files.update({f'{name}.mip{mip["level"]}.bin': originals[mip['file']] for mip in metadata['mips']})
    receipt = {'sourceReference': texture_export['object'], 'width': width, 'height': height, 'format': metadata['format'],
               'source': metadata['source'], 'mips': metadata['mips'], 'png': {'file': f'{name}.png', 'sha256': sha256_hex(files[f'{name}.png'])},
               'dds': {'file': f'{name}.dds', 'sha256': sha256_hex(dds)}, 'decodedRgbaSha256': sha256_hex(image.tobytes()),
               'decoder': {'pillow': PIL.__version__, 'ddsPluginSha256': DDS_PLUGIN_SHA256, 'imagingBinarySha256': IMAGING_BINARY_SHA256}}
    return receipt, files


def sky_texture_products_by_node(package, graph):
    products, gap_reasons = {}, []
    for node in reviewed_texture_nodes(graph):
        try:
            products[node['object']] = sky_texture_products(package, package.exports[node['exportIndex'] - 1])
        except SkyTextureUnsupported as error:
            gap_reasons.append(error.reason)
    return products, gap_reasons


def sky_texture_pngs_by_node(products):
    return {node: files[receipt['png']['file']] for node, (receipt, files) in products.items()}
