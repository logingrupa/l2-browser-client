import copy

from data.pinned_elbera_module import ELBERA_COMMIT
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_assets_lib.texture_source_reader import OMITTED_FORMAT_EVIDENCE, read_native_texture_source
from native_catalog.ue2 import FormatError, Package, Reader, summary, unwrap

PACKAGE_118_VERSION = 118
PACKAGE_118_LICENSEE = 0
PACKAGE_118_LAYOUT = (PACKAGE_118_VERSION, PACKAGE_118_LICENSEE)
MAXIMUM_PACKAGE_TABLE_ENTRIES = 1_000_000
SUMMARY_HEADER_BYTES = 128
PACKAGE_118_LAYOUT_EVIDENCE = {
    'source': 'Elbera l2lib',
    'commit': ELBERA_COMMIT,
    'files': {
        'tools/l2lib/README.md': '32b12d39022a92f4fef951edbecf4094c0a01a8237531c92d81918da752f0a9c',
        'tools/l2lib/ue2package.py': '18fc5bf7b6e5a8758a426a7264b103f34ddbdad6fb9b784319ef7ba6bfe050fe',
    },
    'records': ['UE2 package container: the table layout is identical for the Interlude package versions',
                'Texture export body: property stream, Lineage2 UMaterial block for v123 only, then the native mip array',
                'parse_texture reads the Lineage2 UMaterial block only when file_version >= 123'],
    'omittedFormat': OMITTED_FORMAT_EVIDENCE,
}


class UnrealPackage118(Package):
    def __init__(self, data, filename):
        self.filename = filename
        self.package_name = filename.rsplit('.', 1)[0]
        self.source_hash = sha256_hex_digest(data)
        self.summary = summary(data[:SUMMARY_HEADER_BYTES], filename)
        layout = (self.summary['version'], self.summary['licenseeVersion'])
        if layout != PACKAGE_118_LAYOUT:
            raise FormatError(f'{filename} layout {layout[0]}/{layout[1]} is not the reviewed package layout '
                              f'{PACKAGE_118_VERSION}/{PACKAGE_118_LICENSEE}')
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


def read_unreal_package(data, filename):
    if summary(data[:SUMMARY_HEADER_BYTES], filename)['version'] == PACKAGE_118_VERSION:
        return UnrealPackage118(data, filename)
    return Package(data, filename)


def read_texture_source_118(package, item):
    if not isinstance(package, UnrealPackage118):
        raise FormatError(f'{package.filename} is not read by the reviewed {PACKAGE_118_VERSION}/{PACKAGE_118_LICENSEE} package reader')
    layout = {'packageVersion': PACKAGE_118_VERSION, 'licenseeVersion': PACKAGE_118_LICENSEE, 'evidence': copy.deepcopy(PACKAGE_118_LAYOUT_EVIDENCE)}
    return read_native_texture_source(package, item, layout)
