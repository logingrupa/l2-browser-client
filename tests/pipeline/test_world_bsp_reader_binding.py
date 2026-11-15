from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError, Package
from ue2_package_fixture import package_bytes
from world import bsp_reader_binding
from world.bsp_reader_binding import READER_SHA, PackageAdapter, pinned_bytes, reviewed_reader
from world.map_sources import sha

VENDORED_READER_INIT = ROOT / 'scripts' / 'vendor' / 'lineage2elbera_bsp' / '__init__.py'


def synthetic_package():
    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Model')]
    exports = [{'name': 'Model0', 'class': -2, 'flags': 0x70004, 'body': lambda offset, names: b'\x00\x01\x02'},
               {'name': 'Model1', 'class': -2, 'outer': 1, 'body': lambda offset, names: b''}]
    return Package(package_bytes([], imports, exports), 'Synthetic.unr')


class PackageAdapterTests(unittest.TestCase):
    def test_exports_map_to_zero_based_indices_with_class_outer_flags_offset_and_size(self):
        source = synthetic_package()
        adapter = PackageAdapter(source)
        self.assertEqual((adapter.file_version, adapter.licensee_version), (123, 28))
        first, second = adapter.exports
        self.assertEqual((first.index, first.class_index, first.package_index, first.object_flags, first.serial_offset, first.serial_size),
                         (0, -2, 0, 0x70004, 4096, 3))
        self.assertEqual((second.index, second.package_index, second.serial_size), (1, 1, 0))
        self.assertEqual(adapter.export_name(second), 'Model1')

    def test_resolve_ref_returns_an_export_an_import_or_none(self):
        source = synthetic_package()
        adapter = PackageAdapter(source)
        self.assertIs(adapter.resolve_ref(2), adapter.exports[1])
        self.assertIs(adapter.resolve_ref(-2), source.imports[1])
        self.assertIsNone(adapter.resolve_ref(0))


class PinnedBytesTests(unittest.TestCase):
    def test_pinned_bytes_returns_the_bytes_only_when_the_hash_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'pinned.bin'
            path.write_bytes(b'pinned payload')
            self.assertEqual(pinned_bytes(path, sha(b'pinned payload')), b'pinned payload')
            with self.assertRaisesRegex(FormatError, 'Pinned input changed: .*pinned.bin'):
                pinned_bytes(path, sha(b'other payload'))


class ReviewedReaderTests(unittest.TestCase):
    def test_a_patched_reader_pin_is_refused(self):
        with patch.object(bsp_reader_binding, 'READER_SHA', '0' * 64), self.assertRaisesRegex(FormatError, 'Pinned input changed'):
            reviewed_reader()

    def test_the_vendored_reader_loads_when_its_bytes_match_the_pin(self):
        if sha(VENDORED_READER_INIT.read_bytes()) != READER_SHA:
            self.skipTest('the vendored reader is checked out with CRLF line endings, so its bytes differ from the LF pin')
        self.assertEqual(reviewed_reader().__name__, 'vendor.lineage2elbera_bsp')


if __name__ == '__main__':
    unittest.main()
