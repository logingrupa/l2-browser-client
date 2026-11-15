import importlib
from pathlib import Path
from types import SimpleNamespace

from native_catalog.ue2 import FormatError
from world.map_sources import sha

READER_SHA = '572bd29fd5dbe54e369005d502fc05355512535bf99d42a060c81e6d9df3c1cd'
VENDORED_READER_DIRECTORY = Path(__file__).resolve().parents[1] / 'vendor' / 'lineage2elbera_bsp'


def pinned_bytes(path, expected):
    data = Path(path).read_bytes()
    if sha(data) != expected:
        raise FormatError('Pinned input changed: ' + str(path))
    return data


class PackageAdapter:
    def __init__(self, source):
        self.source, self.data, self.path = source, source.data, source.filename
        self.file_version = source.summary['version']
        self.licensee_version = source.summary['licenseeVersion']
        self.exports = [SimpleNamespace(index=e['exportIndex']-1, class_index=e['classIndex'],
            package_index=e['outerIndex'], object_flags=e['flags'], serial_offset=e['offset'],
            serial_size=e['size']) for e in source.exports]

    def name(self, index):
        return self.source.name(index)

    def export_name(self, export):
        return self.source.exports[export.index]['name']

    def require_resolvable_reference(self, reference):
        self.source.object_name(reference)

    def resolve_ref(self, reference):
        self.require_resolvable_reference(reference)
        if reference > 0:
            return self.exports[reference-1]
        if reference < 0:
            return self.source.imports[-reference-1]
        return None


def reviewed_reader():
    pinned_bytes(VENDORED_READER_DIRECTORY / '__init__.py', READER_SHA)
    return importlib.import_module('vendor.lineage2elbera_bsp')
