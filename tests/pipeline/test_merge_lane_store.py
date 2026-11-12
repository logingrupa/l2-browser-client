import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.gltf import json_bytes
from native_store import merge_lane_store as merge_lane_store_module
from native_store.merge_lane_store import LaneStoreMergeRefusedError, merge_lane_store

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG = json.loads((GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes())
MODEL_VERSION_ONE_RECORD = GOLDEN_CATALOG['models'][0]
MODEL_VERSION_TWO_RECORD = GOLDEN_CATALOG['models'][1]
MODEL_VERSION_ONE_BYTES = (GOLDEN_ROOT / 'model-v1.l2asset').read_bytes()
MODEL_VERSION_TWO_BYTES = (GOLDEN_ROOT / 'model-v2.l2asset').read_bytes()
MODEL_VERSION_TWO_SHA256 = MODEL_VERSION_TWO_RECORD['archiveSha256']
NATIVE_RESOURCE_PREFIX = '/l2/'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def archive_member(archive_bytes, name):
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        return archive.read(name)


MODEL_VERSION_TWO_GLB = archive_member(MODEL_VERSION_TWO_BYTES, 'model.glb')
LANE_MODEL_RECORD = dict(MODEL_VERSION_TWO_RECORD, model=f'/l2/{MODEL_VERSION_TWO_SHA256}/model.glb',
                         modelSha256=sha256_hex(MODEL_VERSION_TWO_GLB))
LANE_SCRATCH_FILES = ('.work/x.tmp', 'index/key.json', f'{MODEL_VERSION_TWO_SHA256}/evidence/000-export-x.log', 'export-manifest.json',
                      'coverage.json', 'load-checks/check.json', 'logs/convert.log')


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in sorted(root.rglob('*')) if path.is_file()}


def write_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def relative_resource(path):
    return path[len(NATIVE_RESOURCE_PREFIX):]


class LaneStoreFixture:
    def __init__(self, test_case):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.target_root = self.temporary_root / 'target' / 'l2'
        self.lane_root = self.temporary_root / 'lane' / 'l2'
        self.build_target_store(self.target_root)
        self.lane_records = {'models': [copy.deepcopy(LANE_MODEL_RECORD)]}
        self.lane_files = {MODEL_VERSION_TWO_RECORD['archive']: MODEL_VERSION_TWO_BYTES, LANE_MODEL_RECORD['model']: MODEL_VERSION_TWO_GLB}
        self.write_lane_store()

    @staticmethod
    def build_target_store(target_root):
        shutil.copytree(GOLDEN_ROOT / 'l2', target_root)
        target_catalog = copy.deepcopy(GOLDEN_CATALOG)
        target_catalog['models'] = [MODEL_VERSION_ONE_RECORD]
        write_file(target_root / 'catalog.json', json_bytes(target_catalog))
        write_file(target_root / relative_resource(MODEL_VERSION_ONE_RECORD['archive']), MODEL_VERSION_ONE_BYTES)

    def target_catalog_sha256(self, target_root=None):
        return sha256_hex(((target_root or self.target_root) / 'catalog.json').read_bytes())

    def write_lane_store(self, source_catalog_sha256=None):
        lane_catalog = {'schemaVersion': 1, **self.lane_records,
                        'sourceCatalogSha256': source_catalog_sha256 or self.target_catalog_sha256()}
        if self.lane_root.exists():
            shutil.rmtree(self.lane_root)
        write_file(self.lane_root / 'catalog.json', json_bytes(lane_catalog))
        for resource_path, payload in self.lane_files.items():
            write_file(self.lane_root / relative_resource(resource_path), payload)
        for scratch in LANE_SCRATCH_FILES:
            write_file(self.lane_root / scratch, b'converter scratch ' + scratch.encode())

    def merge(self, target_root=None, expected_base_catalog_sha256=None):
        target_root = target_root or self.target_root
        return merge_lane_store(self.lane_root, target_root, expected_base_catalog_sha256 or self.target_catalog_sha256(target_root))


class LaneStoreMergeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def test_one_lane_model_record_and_its_pinned_files_merge_catalog_last_and_a_repeat_is_refused(self):
        base_sha256 = self.fixture.target_catalog_sha256()
        result = self.fixture.merge()
        target_root = self.fixture.target_root
        merged_catalog_bytes = (target_root / 'catalog.json').read_bytes()
        merged_catalog = json.loads(merged_catalog_bytes)
        self.assertEqual(merged_catalog['models'], [MODEL_VERSION_ONE_RECORD, LANE_MODEL_RECORD])
        self.assertNotIn('sourceCatalogSha256', merged_catalog)
        for resource_path, payload in self.fixture.lane_files.items():
            self.assertEqual((target_root / relative_resource(resource_path)).read_bytes(), payload)
        for scratch in LANE_SCRATCH_FILES:
            self.assertFalse((target_root / scratch).exists(), scratch)
        self.assertEqual(result, {'beforeCatalogSha256': base_sha256, 'afterCatalogSha256': sha256_hex(merged_catalog_bytes),
                                  'copiedFiles': sorted(relative_resource(path) for path in self.fixture.lane_files),
                                  'unchangedFiles': [], 'addedRecordsBySlice': {'models': 1}})
        snapshot = snapshot_tree(target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, f'expected base catalog sha256 {base_sha256} differs'):
            merge_lane_store(self.fixture.lane_root, target_root, base_sha256)
        self.assertEqual(snapshot_tree(target_root), snapshot)

    def test_two_fresh_targets_merged_with_one_lane_store_get_byte_identical_catalogs(self):
        second_target_root = self.fixture.temporary_root / 'second-target' / 'l2'
        LaneStoreFixture.build_target_store(second_target_root)
        self.fixture.merge()
        self.fixture.merge(second_target_root)
        self.assertEqual((self.fixture.target_root / 'catalog.json').read_bytes(), (second_target_root / 'catalog.json').read_bytes())

    def test_identical_files_already_in_the_target_keep_their_modification_time_and_count_as_unchanged(self):
        target_root = self.fixture.target_root
        target_catalog = json.loads((target_root / 'catalog.json').read_bytes())
        tile_record = target_catalog.pop('tiles')[0]
        write_file(target_root / 'catalog.json', json_bytes(target_catalog))
        tile_manifest_relative = relative_resource(tile_record['manifest'])
        chunk_manifest_relative = relative_resource(json.loads((target_root / tile_manifest_relative).read_bytes())['chunks'][0]['manifest'])
        self.fixture.lane_records['tiles'] = [tile_record]
        for relative in (tile_manifest_relative, chunk_manifest_relative):
            self.fixture.lane_files['/l2/' + relative] = (target_root / relative).read_bytes()
        self.fixture.write_lane_store()
        modification_times = {relative: (target_root / relative).stat().st_mtime_ns for relative in (tile_manifest_relative, chunk_manifest_relative)}
        result = self.fixture.merge()
        self.assertEqual(result['unchangedFiles'], sorted([chunk_manifest_relative, tile_manifest_relative]))
        self.assertEqual(result['addedRecordsBySlice'], {'models': 1, 'tiles': 1})
        self.assertEqual({relative: (target_root / relative).stat().st_mtime_ns for relative in modification_times}, modification_times)
        self.assertEqual(json.loads((target_root / 'catalog.json').read_bytes())['tiles'], [tile_record])


class LaneStoreMergeRefusalTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def assert_refused_without_touching_the_target(self, message_pattern, expected_base_catalog_sha256=None):
        snapshot = snapshot_tree(self.fixture.target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, message_pattern):
            self.fixture.merge(expected_base_catalog_sha256=expected_base_catalog_sha256)
        self.assertEqual(snapshot_tree(self.fixture.target_root), snapshot)

    def replace_lane_model_record(self, record, files):
        self.fixture.lane_records['models'] = [record]
        self.fixture.lane_files = files
        self.fixture.write_lane_store()

    def test_an_expected_base_that_differs_from_the_target_catalog_is_refused(self):
        self.assert_refused_without_touching_the_target('expected base catalog sha256 0{64} differs', '0' * 64)

    def test_a_lane_catalog_built_on_another_base_is_refused(self):
        self.fixture.write_lane_store(source_catalog_sha256='1' * 64)
        self.assert_refused_without_touching_the_target('lane catalog sourceCatalogSha256 1{64} differs')

    def test_a_lane_record_id_already_in_the_target_slice_is_refused(self):
        self.replace_lane_model_record(dict(LANE_MODEL_RECORD, id=MODEL_VERSION_ONE_RECORD['id']), self.fixture.lane_files)
        self.assert_refused_without_touching_the_target(f'lane record id {MODEL_VERSION_ONE_RECORD["id"]} is already in the target models slice')

    def test_a_target_file_with_different_bytes_at_a_lane_path_is_refused(self):
        write_file(self.fixture.target_root / relative_resource(LANE_MODEL_RECORD['model']), b'different target bytes')
        self.assert_refused_without_touching_the_target('Existing immutable store file differs; preserved')

    def test_a_version_one_lane_archive_is_refused(self):
        record = dict(MODEL_VERSION_ONE_RECORD, id='interlude:SyntheticFixture.LaneCopyOfVersionOne')
        self.replace_lane_model_record(record, {MODEL_VERSION_ONE_RECORD['archive']: MODEL_VERSION_ONE_BYTES})
        self.assert_refused_without_touching_the_target(
            'lane archive asset.json schemaVersion is 1, only 2 merges: ' + relative_resource(MODEL_VERSION_ONE_RECORD['archive']))

    def test_a_pinned_file_missing_from_the_lane_store_is_refused(self):
        (self.fixture.lane_root / relative_resource(LANE_MODEL_RECORD['model'])).unlink()
        self.assert_refused_without_touching_the_target('pinned store file is missing from .*: ' + relative_resource(LANE_MODEL_RECORD['model']))

    def test_a_pinned_file_whose_bytes_differ_from_its_pin_is_refused(self):
        write_file(self.fixture.lane_root / relative_resource(LANE_MODEL_RECORD['archive']), b'tampered lane archive')
        self.assert_refused_without_touching_the_target('pinned store file SHA-256 differs from its pin')

    def test_record_paths_with_a_parent_step_or_a_backslash_are_refused(self):
        for unsafe_archive in (f'/l2/../{MODEL_VERSION_TWO_SHA256}/asset.l2asset', f'/l2/{MODEL_VERSION_TWO_SHA256}\\asset.l2asset'):
            with self.subTest(unsafe_archive=unsafe_archive):
                self.replace_lane_model_record(dict(MODEL_VERSION_TWO_RECORD, archive=unsafe_archive), {})
                self.assert_refused_without_touching_the_target('Unsafe relative path')

    def test_a_pinned_manifest_whose_bundle_file_is_missing_from_its_folder_is_refused(self):
        manifest_bytes = json_bytes({'kind': 'native-window-layout', 'texture': {'file': 'skin.png', 'sha256': '2' * 64}})
        manifest_sha256 = sha256_hex(manifest_bytes)
        window_record = {'id': 'LaneFixtureWnd', 'manifest': f'/l2/windows/{manifest_sha256}/window.json', 'manifestSha256': manifest_sha256,
                         'manifestBytes': len(manifest_bytes)}
        self.fixture.lane_records['windows'] = [window_record]
        self.fixture.lane_files[window_record['manifest']] = manifest_bytes
        self.fixture.write_lane_store()
        self.assert_refused_without_touching_the_target(f'pinned store file is missing from .*: windows/{manifest_sha256}/skin.png')

    def test_a_lane_catalog_with_no_records_is_refused(self):
        self.fixture.lane_records['models'] = []
        self.fixture.lane_files = {}
        self.fixture.write_lane_store()
        self.assert_refused_without_touching_the_target('lane catalog has no records to merge')

    def test_a_lane_catalog_field_the_merge_does_not_know_is_refused(self):
        self.fixture.lane_records['skillTrees'] = []
        self.fixture.write_lane_store()
        self.assert_refused_without_touching_the_target('lane catalog holds fields the merge does not know: skillTrees')


class LaneStoreMergeCommandLineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)
        self.addCleanup(os.chdir, os.getcwd())

    def run_main_in(self, current_directory, arguments):
        os.chdir(current_directory)
        output, errors = io.StringIO(), io.StringIO()
        with (patch.object(merge_lane_store_module, 'run_at_below_normal_priority') as below_normal_priority,
              contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors)):
            exit_code = merge_lane_store_module.main(arguments)
        below_normal_priority.assert_called_once_with()
        return exit_code, output.getvalue(), errors.getvalue()

    def merge_arguments(self, target, expected_base_catalog_sha256=None):
        return ['--lane-store', str(self.fixture.lane_root), '--target', str(target),
                '--expected-base-catalog-sha256', expected_base_catalog_sha256 or self.fixture.target_catalog_sha256()]

    def build_main_checkout(self):
        main_checkout = self.fixture.temporary_root / 'main-checkout'
        main_checkout.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(main_checkout)], check=True, capture_output=True)
        shutil.copytree(self.fixture.target_root, main_checkout / 'public' / 'l2')
        return main_checkout

    def test_this_worktree_is_refused_before_any_store_is_opened(self):
        missing_lane_store, missing_target = self.fixture.temporary_root / 'missing-lane', self.fixture.temporary_root / 'missing-target'
        with patch.object(merge_lane_store_module, 'merge_lane_store', side_effect=AssertionError('merge must not run')):
            exit_code, output, errors = self.run_main_in(ROOT, ['--lane-store', str(missing_lane_store), '--target', str(missing_target),
                                                                '--expected-base-catalog-sha256', '3' * 64])
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('merge_lane_store runs only in the main checkout', errors)
        self.assertFalse(missing_lane_store.exists() or missing_target.exists())

    def test_a_folder_that_is_not_a_git_checkout_is_refused(self):
        not_a_checkout = self.fixture.temporary_root / 'not-a-checkout'
        not_a_checkout.mkdir()
        with patch.dict(os.environ, {'GIT_CEILING_DIRECTORIES': str(self.fixture.temporary_root)}):
            exit_code, output, errors = self.run_main_in(not_a_checkout, self.merge_arguments(self.fixture.target_root))
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('Lane store merge refused: not a git checkout', errors)

    def test_a_target_other_than_public_l2_of_the_main_checkout_is_refused(self):
        main_checkout = self.build_main_checkout()
        snapshot = snapshot_tree(self.fixture.target_root)
        exit_code, output, errors = self.run_main_in(main_checkout, self.merge_arguments(self.fixture.target_root))
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('--target must be public/l2 of the main checkout', errors)
        self.assertEqual(snapshot_tree(self.fixture.target_root), snapshot)

    def test_an_expected_base_that_is_not_lowercase_hex_is_refused(self):
        main_checkout = self.build_main_checkout()
        exit_code, output, errors = self.run_main_in(main_checkout, self.merge_arguments('public/l2', 'A' * 64))
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('--expected-base-catalog-sha256 must be 64 lowercase hex characters', errors)

    def test_the_main_checkout_merges_into_public_l2_and_prints_the_result_as_json(self):
        main_checkout = self.build_main_checkout()
        exit_code, output, errors = self.run_main_in(main_checkout, self.merge_arguments('public/l2'))
        self.assertEqual((exit_code, errors), (0, ''))
        result = json.loads(output)
        self.assertEqual(result['addedRecordsBySlice'], {'models': 1})
        merged_catalog_bytes = (main_checkout / 'public' / 'l2' / 'catalog.json').read_bytes()
        self.assertEqual(result['afterCatalogSha256'], sha256_hex(merged_catalog_bytes))
        self.assertEqual(json.loads(merged_catalog_bytes)['models'], [MODEL_VERSION_ONE_RECORD, LANE_MODEL_RECORD])


if __name__ == '__main__':
    unittest.main()
