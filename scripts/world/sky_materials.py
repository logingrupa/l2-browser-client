import hashlib
import io
from pathlib import Path
from typing import NamedTuple

import PIL
from PIL import DdsImagePlugin, Image

from native_assets_lib.gltf import json_bytes
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_program import derive_material_program, read_material_class_defaults
from native_assets_lib.material_resources import write_native_material_resources
from native_assets_lib.texture_dds import UnsupportedTextureDDS, build_texture_dds
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source
from native_catalog.ue2 import FormatError, Package, Reader, summary, unwrap
from world.bsp_reader_binding import pinned_bytes

PINNED_PILLOW_VERSION = '12.3.0'
DDS_PLUGIN_SHA256 = 'eae2016bb3476be917ff549086c18b89d8e911d0f6d3f0900486a90fe2808cac'
IMAGING_BINARY_SHA256 = 'c8c519ec72bf75b2945b4fc4afa854af2fca8b970a403134f9ddda3e164d85e9'
SKY_PACKAGE_LAYOUT_VERSION = 118
SKY_PACKAGE_LAYOUT_LICENSEE = 0
TABLE_PACKAGE_LAYOUT_VERSION = 123
MAXIMUM_PACKAGE_TABLE_ENTRIES = 1_000_000
MAXIMUM_SKY_MIPS = 16
MAXIMUM_SKY_MIP_BYTES = 2 * 1024 * 1024
TEXTURE_FORMAT_NAMES = {3: 'DXT1', 8: 'DXT5'}
TEXTURE_CLASS = 'Engine.Texture'
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


class SkyLayoutPackage(Package):
    def __init__(self, data, filename):
        self.filename = filename
        self.package_name = filename.rsplit('.', 1)[0]
        self.source_hash = sha256_hex(data)
        self.summary = summary(data[:128], filename)
        if (self.summary['version'], self.summary['licenseeVersion']) != (SKY_PACKAGE_LAYOUT_VERSION, SKY_PACKAGE_LAYOUT_LICENSEE):
            raise FormatError(f'{filename} layout {self.summary["version"]}/{self.summary["licenseeVersion"]} is not the reviewed sky package layout '
                              f'{SKY_PACKAGE_LAYOUT_VERSION}/{SKY_PACKAGE_LAYOUT_LICENSEE}')
        _, self.data = unwrap(data, filename)
        if any(self.summary[field] > MAXIMUM_PACKAGE_TABLE_ENTRIES for field in ('nameCount', 'exportCount', 'importCount')):
            raise FormatError(f'{filename} package tables are oversized')
        self.names = self.read_names()
        self.imports = self.read_imports()
        self.exports = self.read_exports()
        for item in self.exports:
            item['object'] = self.object_name(item['exportIndex'])
            item['classObject'] = self.object_name(item['classIndex']) or 'Core.Class'
            item['className'] = item['classObject'].rsplit('.', 1)[-1]
        for index, item in enumerate(self.imports, 1):
            item['object'] = self.object_name(-index)

    def read_names(self):
        reader, names = Reader(self.data, self.summary['nameOffset']), []
        for _ in range(self.summary['nameCount']):
            names.append(reader.string())
            reader.number('I')
        return names

    def read_imports(self):
        reader, imports = Reader(self.data, self.summary['importOffset']), []
        for _ in range(self.summary['importCount']):
            imports.append({'classPackage': self.name(reader.compact()), 'className': self.name(reader.compact()),
                            'outerIndex': reader.number('i'), 'name': self.name(reader.compact())})
        return imports

    def read_exports(self):
        reader, exports = Reader(self.data, self.summary['exportOffset']), []
        for index in range(self.summary['exportCount']):
            item = {'exportIndex': index + 1, 'classIndex': reader.compact(), 'superIndex': reader.compact(), 'outerIndex': reader.number('i'),
                    'name': self.name(reader.compact()), 'flags': reader.number('I'), 'size': reader.compact()}
            item['offset'] = reader.compact() if item['size'] else 0
            if not (0 <= item['size'] and 0 <= item['offset'] <= item['offset'] + item['size'] <= len(self.data)):
                raise FormatError(f'{self.filename} export {index + 1} lies outside the package')
            exports.append(item)
        return exports


def read_sky_material_package(data, filename):
    if summary(data[:128], filename)['version'] == TABLE_PACKAGE_LAYOUT_VERSION:
        return Package(data, filename)
    return SkyLayoutPackage(data, filename)


def external_reference_reasons(graph):
    return sorted({SKY_MATERIAL_EXTERNAL_REASON_PREFIX + reference['to'].split('.')[0]
                   for reference in graph['references'] if reference['target'] == OBJECT_PROPERTY_IMPORT_TARGET})


def read_sky_material_graph(package, root_exports):
    graphs = []
    for root_export in root_exports:
        graph = read_material_graph(package, root_export)
        graphs.append(SkyMaterialGraph(root_export, graph, sorted({*graph['gapReasons'], *external_reference_reasons(graph)})))
    return graphs


def sky_material_program(graph, class_work_root, class_scripts):
    return derive_material_program(graph, read_material_class_defaults(graph, class_work_root, class_scripts))


def write_sky_material_program(store_root, graph, program):
    written = write_native_material_resources(store_root, graph, program)
    program_file = next(record for record in written['files'] if record['path'].endswith('program.json'))
    return {'directory': written['directory'], 'programSha256': program_file['sha256']}, written['files']


def graph_texture_exports(package, graph):
    return [package.exports[node['exportIndex'] - 1] for node in graph['nodes'] if node['classObject'] == TEXTURE_CLASS]


def single_graph_texture_export(package, graph):
    textures = graph_texture_exports(package, graph)
    if len(textures) != 1:
        raise SkyTextureUnsupported(f'{SKY_MATERIAL_TEXTURE_COUNT_REASON_PREFIX}{len(textures)}',
                                    f'sky material {graph["root"]} reaches {len(textures)} textures, the sky part draws exactly one')
    return textures[0]


def authored_integer_tag(tags, name):
    found = [tag for tag in tags if tag['name'] == name]
    if len(found) > 1:
        raise FormatError(f'texture property {name} is serialized {len(found)} times')
    return found[0]['value'] if found else None


def format_unsupported(format_id, message):
    return SkyTextureUnsupported(f'{SKY_TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX}{format_id}', message)


def sky_layout_texture_source(package, item):
    tags, reader = package.properties(item)
    format_id = authored_integer_tag(tags, 'Format')
    if format_id not in TEXTURE_FORMAT_NAMES:
        raise format_unsupported(format_id, f'sky texture {item["object"]} format {format_id} has no DDS block wrapper')
    dimensions = [authored_integer_tag(tags, name) for name in ('USize', 'VSize')]
    export = bytes(package.data[item['offset']:item['offset'] + item['size']])
    files, mips = {'native/texture-export.bin': export}, []
    for level in range(reader.count(MAXIMUM_SKY_MIPS)):
        lazy_array_end = reader.number('i')
        size = reader.count(MAXIMUM_SKY_MIP_BYTES)
        payload_offset = reader.position
        if lazy_array_end != payload_offset + size:
            raise FormatError(f'sky texture {item["object"]} mip {level} lazy-array end differs from its payload')
        payload = bytes(reader.take(size))
        width, height = reader.number('i'), reader.number('i')
        bits = [reader.number('B'), reader.number('B')]
        if [1 << bit for bit in bits] != [width, height] or level == 0 and [width, height] != dimensions:
            raise FormatError(f'sky texture {item["object"]} mip {level} dimensions differ from its bits or properties')
        name = f'native/mip{level:02d}.bin'
        files[name] = payload
        mips.append({'level': level, 'width': width, 'height': height, 'sourceOffset': payload_offset, 'sourceBytes': size, 'file': name,
                     'sha256': sha256_hex(payload)})
    if reader.position != reader.end or not mips:
        raise FormatError(f'sky texture {item["object"]} native record does not end at its mips')
    source = {'package': package.filename, 'packageSha256': package.source_hash, 'object': item['object'], 'sourceOffset': item['offset'],
              'sourceBytes': item['size'], 'sourceExportSha256': sha256_hex(export)}
    metadata = {'schemaVersion': 1, 'kind': 'native-texture-source', 'source': source,
                'layout': {'packageVersion': SKY_PACKAGE_LAYOUT_VERSION, 'licenseeVersion': SKY_PACKAGE_LAYOUT_LICENSEE},
                'format': {'id': format_id, 'name': TEXTURE_FORMAT_NAMES[format_id]}, 'originalExportFile': 'native/texture-export.bin',
                'sourceExportFullyConsumed': True, 'pixelDecodingApplied': False, 'mipsGenerated': False, 'colorOrAlphaModified': False,
                'mipCount': len(mips), 'nativeMipBytes': sum(mip['sourceBytes'] for mip in mips),
                'completeTo1x1': (mips[-1]['width'], mips[-1]['height']) == (1, 1), 'mips': mips}
    files['native-texture-source.json'] = json_bytes(metadata)
    return metadata, files


def native_texture_source(package, item):
    if package.summary['version'] == TABLE_PACKAGE_LAYOUT_VERSION:
        try:
            return build_texture_source(package, item)
        except UnsupportedTextureSource as error:
            raise format_unsupported(authored_integer_tag(package.properties(item)[0], 'Format'), str(error)) from error
    return sky_layout_texture_source(package, item)


def require_pinned_decoder():
    if PIL.__version__ != PINNED_PILLOW_VERSION:
        raise FormatError(f'sky textures decode only with the pinned Pillow {PINNED_PILLOW_VERSION}, found {PIL.__version__}')
    pinned_bytes(Path(DdsImagePlugin.__file__), DDS_PLUGIN_SHA256)
    pinned_bytes(Path(Image.core.__file__), IMAGING_BINARY_SHA256)


def sky_texture_products(package, texture_export):
    metadata, originals = native_texture_source(package, texture_export)
    try:
        dds_metadata, dds_files = build_texture_dds(metadata, originals)
    except UnsupportedTextureDDS as error:
        raise format_unsupported(metadata['format']['id'], str(error)) from error
    require_pinned_decoder()
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
