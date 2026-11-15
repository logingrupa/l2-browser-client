from contextlib import redirect_stdout
import hashlib
import io
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
from hash_reference_client_tree import canonical_json_bytes
from native_assets_lib.texture_mips import REVIEWED_VERSIONS
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, ReferenceClientLock, read_reference_client_lock, require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from texture_package_census import (HEADER_BYTE_COUNT, TEXTURE_PACKAGE_PATH_PATTERN, TexturePackageCensusError, build_texture_package_census,
    main, texture_package_census_bytes, texture_package_census_row, validate_texture_package_census)

UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
LINEAGE_VERSION_121_WRAPPER = 'Lineage2Ver121'.encode('utf-16le')
SYNTHETIC_UNREVIEWED_PAIR = (1, 2)
REVIEWED_PAIR = min(REVIEWED_VERSIONS)
UE2_118_REVIEWED_PAIR = (118, 0)
UE2_118_UNREVIEWED_PAIR = (118, 11)
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

    def test_ue2_118_0_package_is_reviewed_and_118_11_keeps_its_licensee_reason(self):
        self.assertIn(UE2_118_REVIEWED_PAIR, REVIEWED_VERSIONS)
        self.assertNotIn(UE2_118_UNREVIEWED_PAIR, REVIEWED_VERSIONS)
        tree = SyntheticTexturePackageTree(self, {
            'systextures/Synthetic_Reviewed.utx': synthetic_wrapped_package_header('Synthetic_Reviewed.utx', *UE2_118_REVIEWED_PAIR),
            'systextures/Synthetic_Unreviewed.utx': synthetic_wrapped_package_header('Synthetic_Unreviewed.utx', *UE2_118_UNREVIEWED_PAIR)})
        reviewed_row = texture_package_census_row(tree.access, 'systextures/Synthetic_Reviewed.utx')
        unreviewed_row = texture_package_census_row(tree.access, 'systextures/Synthetic_Unreviewed.utx')
        self.assertEqual((reviewed_row['packageVersion'], reviewed_row['licensee'], reviewed_row['reviewed'], reviewed_row['reason']), (118, 0, True, None))
        self.assertEqual((unreviewed_row['packageVersion'], unreviewed_row['licensee'], unreviewed_row['reviewed'], unreviewed_row['reason']),
                         (118, 11, False, 'texture-licensee-unsupported:118/11'))

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
        with patch.object(texture_package_census, 'TEXTURE_PACKAGE_CENSUS_PATH', output_path), redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(main(['--client', str(tree.client_root)]), 0)
        self.assertEqual(json.loads(printed.getvalue()), {'output': str(output_path), 'packages': 3, 'reviewed': 1})
        self.assertEqual(output_path.read_bytes(), texture_package_census_bytes(build_texture_package_census(tree.access, tree.access.lock)))


class CommittedTexturePackageCensusTests(unittest.TestCase):
    PACKAGES_LATER_PLANS_CONVERT = ('systextures/L2UI_CH3.utx', 'systextures/l2ui.utx', 'systextures/Icon.utx',
        'systextures/L2_RadarMap.utx', 'systextures/town_map.utx', 'systextures/l2zonename.utx')
    UNREVIEWED_REASON_PATTERN = r'texture-licensee-unsupported:\d+/\d+|decode-failed:\w+'

    def setUp(self):
        self.census = validate_texture_package_census(json.loads(texture_package_census.TEXTURE_PACKAGE_CENSUS_PATH.read_bytes().decode('utf-8')))
        self.lock = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH)

    def test_census_has_one_row_per_lock_equal_texture_package_in_census_order(self):
        lock_equal_package_paths = [path for path, record in self.lock.records_by_path.items()
            if record['class'] == 'equal' and TEXTURE_PACKAGE_PATH_PATTERN.fullmatch(path)]
        census_paths = [row['path'] for row in self.census['packages']]
        self.assertEqual(sorted(census_paths), sorted(lock_equal_package_paths))
        self.assertEqual(census_paths, sorted(census_paths, key=lambda path: (path.casefold(), path)))

    def test_census_names_the_committed_lock(self):
        self.assertEqual(self.census['referenceTreeLockSha256'], hashlib.sha256(canonical_json_bytes(self.lock.document)).hexdigest())

    def test_every_unreviewed_row_states_its_reason(self):
        for row in self.census['packages']:
            if not row['reviewed']:
                with self.subTest(path=row['path']):
                    self.assertRegex(row['reason'], f'^(?:{self.UNREVIEWED_REASON_PATTERN})$')

    def test_every_row_of_a_reviewed_pair_is_reviewed_with_no_reason(self):
        for row in self.census['packages']:
            if (row['packageVersion'], row['licensee']) in REVIEWED_VERSIONS:
                with self.subTest(path=row['path']):
                    self.assertEqual((row['reviewed'], row['reason']), (True, None))
        ue2_118_paths = {row['path'] for row in self.census['packages'] if (row['packageVersion'], row['licensee']) == UE2_118_REVIEWED_PAIR}
        self.assertTrue({'systextures/L2UI_CH3.utx', 'systextures/l2ui.utx', 'systextures/L2_RadarMap.utx'} <= ue2_118_paths)

    def test_packages_later_plans_convert_are_censused(self):
        census_paths = {row['path'] for row in self.census['packages']}
        for path in self.PACKAGES_LATER_PLANS_CONVERT:
            with self.subTest(path=path):
                self.assertIn(path, census_paths)


if __name__ == '__main__':
    unittest.main()
