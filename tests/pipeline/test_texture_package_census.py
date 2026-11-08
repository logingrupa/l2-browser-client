import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
import texture_package_census
from native_assets_lib.texture_mips import REVIEWED_VERSIONS
from reference_client_guard import ReferenceClientLock, require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from texture_package_census import (HEADER_BYTE_COUNT, TexturePackageCensusError, build_texture_package_census, main,
    texture_package_census_bytes, texture_package_census_row, validate_texture_package_census)

UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
LINEAGE_VERSION_121_WRAPPER = 'Lineage2Ver121'.encode('utf-16le')
SYNTHETIC_UNREVIEWED_PAIR = (1, 2)
REVIEWED_PAIR = min(REVIEWED_VERSIONS)
GARBAGE_HEADER = bytes(range(HEADER_BYTE_COUNT))


def synthetic_wrapped_package_header(file_name, package_version, licensee):
    package_summary = struct.pack('<IHHIIIIIII', UNREAL_PACKAGE_SIGNATURE, package_version, licensee, 0, 1, 0, 1, 0, 1, 0)
    body = package_summary.ljust(4096 - len(LINEAGE_VERSION_121_WRAPPER), b'\0')
    xor_key = sum(file_name.lower().encode('ascii')) & 255
    return LINEAGE_VERSION_121_WRAPPER + bytes(value ^ xor_key for value in body)


class SyntheticTexturePackageTree:
    def __init__(self, test_case, packages):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.client_root = base / 'conversion'
        for relative_path, payload in packages.items():
            path = self.client_root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        lock_client_as_checked_conversion_root(test_case, self.client_root, base / 'reference', list(packages))
        self.access = require_reference_client(self.client_root)


class HeaderReadSpy:
    def __init__(self):
        self.read_sizes = []

    def open(self, path, mode):
        stream = open(path, mode)
        spy = self

        class SpiedStream:
            def __enter__(self):
                return self

            def __exit__(self, *exception):
                stream.close()
                return False

            def read(self, size=-1):
                spy.read_sizes.append(size)
                return stream.read(size)

        return SpiedStream()


class TexturePackageCensusRowTests(unittest.TestCase):
    def test_reviewed_wrapped_header_reports_version_licensee_and_no_reason(self):
        tree = SyntheticTexturePackageTree(self, {'systextures/Synthetic_Ui.utx': synthetic_wrapped_package_header('Synthetic_Ui.utx', *REVIEWED_PAIR)})
        self.assertEqual(texture_package_census_row(tree.access, 'systextures/Synthetic_Ui.utx'), {
            'path': 'systextures/Synthetic_Ui.utx', 'packageVersion': REVIEWED_PAIR[0], 'licensee': REVIEWED_PAIR[1],
            'reviewed': True, 'reason': None})

    def test_unreviewed_pair_names_the_unsupported_licensee(self):
        self.assertNotIn(SYNTHETIC_UNREVIEWED_PAIR, REVIEWED_VERSIONS)
        tree = SyntheticTexturePackageTree(self, {'systextures/Other.utx': synthetic_wrapped_package_header('Other.utx', *SYNTHETIC_UNREVIEWED_PAIR)})
        row = texture_package_census_row(tree.access, 'systextures/Other.utx')
        self.assertEqual((row['packageVersion'], row['licensee'], row['reviewed']), (*SYNTHETIC_UNREVIEWED_PAIR, False))
        self.assertEqual(row['reason'], f'texture-licensee-unsupported:{SYNTHETIC_UNREVIEWED_PAIR[0]}/{SYNTHETIC_UNREVIEWED_PAIR[1]}')

    def test_garbage_header_is_a_decode_failed_row(self):
        tree = SyntheticTexturePackageTree(self, {'systextures/Broken.utx': GARBAGE_HEADER})
        self.assertEqual(texture_package_census_row(tree.access, 'systextures/Broken.utx'), {
            'path': 'systextures/Broken.utx', 'packageVersion': None, 'licensee': None, 'reviewed': False,
            'reason': 'decode-failed:FormatError'})

    def test_only_one_bounded_header_read_of_the_package(self):
        tree = SyntheticTexturePackageTree(self, {'systextures/Synthetic_Ui.utx': synthetic_wrapped_package_header('Synthetic_Ui.utx', *REVIEWED_PAIR)})
        header_read_spy = HeaderReadSpy()
        with patch.object(texture_package_census, 'open', header_read_spy.open, create=True):
            texture_package_census_row(tree.access, 'systextures/Synthetic_Ui.utx')
        self.assertEqual(header_read_spy.read_sizes, [HEADER_BYTE_COUNT])
        self.assertEqual(HEADER_BYTE_COUNT, 128)

    def test_package_that_is_not_lock_equal_is_refused(self):
        tree = SyntheticTexturePackageTree(self, {'systextures/Synthetic_Ui.utx': synthetic_wrapped_package_header('Synthetic_Ui.utx', *REVIEWED_PAIR)})
        with self.assertRaisesRegex(ValueError, 'systextures/Unlisted.utx is absent, not equal'):
            texture_package_census_row(tree.access, 'systextures/Unlisted.utx')


class TexturePackageCensusBuildTests(unittest.TestCase):
    def synthetic_tree(self):
        return SyntheticTexturePackageTree(self, {
            'systextures/b_second.utx': synthetic_wrapped_package_header('b_second.utx', *SYNTHETIC_UNREVIEWED_PAIR),
            'systextures/A_First.utx': synthetic_wrapped_package_header('A_First.utx', *REVIEWED_PAIR),
            'systextures/Broken.utx': GARBAGE_HEADER,
            'systextures/Preview.bmp': b'not a package',
            'textures/Elsewhere.utx': synthetic_wrapped_package_header('Elsewhere.utx', *REVIEWED_PAIR),
        })

    def test_census_keeps_every_lock_equal_package_in_casefolded_order_with_lock_spelling(self):
        tree = self.synthetic_tree()
        census = build_texture_package_census(tree.access, tree.access.lock)
        self.assertEqual([row['path'] for row in census['packages']], ['systextures/A_First.utx', 'systextures/b_second.utx', 'systextures/Broken.utx'])
        self.assertEqual(census['schemaVersion'], 1)
        self.assertRegex(census['referenceTreeLockSha256'], '^[0-9a-f]{64}$')
        self.assertEqual(census['packages'][2]['reason'], 'decode-failed:FormatError')

    def test_rerun_is_byte_identical(self):
        tree = self.synthetic_tree()
        first = texture_package_census_bytes(build_texture_package_census(tree.access, tree.access.lock))
        second = texture_package_census_bytes(build_texture_package_census(tree.access, tree.access.lock))
        self.assertEqual(first, second)
        self.assertTrue(first.endswith(b'}\n'))

    def test_lock_without_texture_packages_is_refused(self):
        tree = SyntheticTexturePackageTree(self, {'textures/Elsewhere.utx': synthetic_wrapped_package_header('Elsewhere.utx', *REVIEWED_PAIR)})
        with self.assertRaisesRegex(TexturePackageCensusError, 'no lock-equal systextures'):
            build_texture_package_census(tree.access, tree.access.lock)

    def test_casefold_equal_lock_paths_are_refused_naming_both(self):
        tree = SyntheticTexturePackageTree(self, {'systextures/A.utx': synthetic_wrapped_package_header('A.utx', *REVIEWED_PAIR)})
        record = dict(tree.access.lock.records_by_path['systextures/A.utx'])
        colliding_lock = ReferenceClientLock(tree.access.lock.document, {'systextures/A.utx': record, 'systextures/a.utx': record})
        with self.assertRaises(TexturePackageCensusError) as refusal:
            build_texture_package_census(tree.access, colliding_lock)
        self.assertIn('systextures/A.utx', str(refusal.exception))
        self.assertIn('systextures/a.utx', str(refusal.exception))

    def test_validator_refuses_a_reviewed_row_outside_the_reviewed_versions(self):
        tree = self.synthetic_tree()
        census = build_texture_package_census(tree.access, tree.access.lock)
        census['packages'][1].update(reviewed=True, reason=None)
        with self.assertRaisesRegex(TexturePackageCensusError, 'b_second.utx'):
            validate_texture_package_census(census)

    def test_main_writes_the_census_to_its_fixed_path(self):
        tree = self.synthetic_tree()
        output_path = tree.client_root.parent / 'census' / 'texture-package-census.json'
        with patch.object(texture_package_census, 'TEXTURE_PACKAGE_CENSUS_PATH', output_path):
            self.assertEqual(main(['--client', str(tree.client_root)]), 0)
        self.assertEqual(output_path.read_bytes(), texture_package_census_bytes(build_texture_package_census(tree.access, tree.access.lock)))


if __name__ == '__main__':
    unittest.main()
