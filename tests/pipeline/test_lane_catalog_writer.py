import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.gltf import json_bytes
from native_store import catalog_writer
from native_store.catalog_writer import (CatalogWriteError, NATIVE_RESOURCE_PATH_PATTERN, add_store_file, merge_catalog_slice,
                                         read_store_catalog, write_store)
from native_store.merge_lane_store import main_checkout_root
from native_store.store_paths import StorePathError, lane_store_root
from native_store import write_lane_catalog as lane_catalog_module
from native_store.write_lane_catalog import LaneCatalogError, write_lane_catalog

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG_BYTES = (GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes()
GOLDEN_CATALOG = json.loads(GOLDEN_CATALOG_BYTES)
MODEL_VERSION_TWO_BYTES = (GOLDEN_ROOT / 'model-v2.l2asset').read_bytes()
MODEL_VERSION_TWO_RECORD = GOLDEN_CATALOG['models'][1]
MODEL_VERSION_TWO_ARCHIVE = MODEL_VERSION_TWO_RECORD['archive'][len('/l2/'):]
MODEL_VERSION_ONE_BYTES = (GOLDEN_ROOT / 'model-v1.l2asset').read_bytes()
MODEL_VERSION_ONE_RECORD = GOLDEN_CATALOG['models'][0]
MODEL_VERSION_ONE_ARCHIVE = MODEL_VERSION_ONE_RECORD['archive'][len('/l2/'):]
BROWSER_RESOURCE_URL_SOURCE = ROOT / 'src' / 'assets' / 'native' / 'nativeResourceUrl.ts'
MALFORMED_MANIFEST_RECORD_FIELDS = {'tiles': {'id': '0_00'}, 'tables': {'records': [{'id': 0}]}, 'windows': {'id': 'StatusWnd#0'}}


def golden_store_relative_paths(slice_name):
    record = GOLDEN_CATALOG[slice_name][0]
    relative_paths = [record['manifest'][len('/l2/'):]]
    if slice_name == 'tiles':
        tile_manifest = json.loads((GOLDEN_ROOT / 'l2' / relative_paths[0]).read_bytes())
        relative_paths += [chunk['manifest'][len('/l2/'):] for chunk in tile_manifest['chunks']]
    return relative_paths

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
    JUNCTION_UNAVAILABLE_REASON = None
except (ImportError, AttributeError) as error:
    JUNCTION_FACTORY = None
    JUNCTION_UNAVAILABLE_REASON = f'NTFS junctions unavailable: {error}'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def git_absolute_path(directory, query):
    completed = subprocess.run(['git', 'rev-parse', '--path-format=absolute', query], cwd=directory, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in root.rglob('*') if path.is_file()}


class LaneCatalogWriterTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.project = self.temporary_root / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        (self.project / 'public' / 'l2').mkdir(parents=True)
        (self.project / 'public' / 'l2' / 'catalog.json').write_bytes(GOLDEN_CATALOG_BYTES)
        self.world_store = lane_store_root(self.project, 'world')

    def make_junction(self, link, target):
        if JUNCTION_FACTORY is None:
            self.skipTest(JUNCTION_UNAVAILABLE_REASON)
        JUNCTION_FACTORY(str(target), str(link))
        self.addCleanup(os.rmdir, link)
        return link

    def stage_model(self, store_root, record, relative, payload, extra_files=()):
        catalog, before = read_store_catalog(store_root)
        catalog = merge_catalog_slice(catalog, 'models', record, 4)
        files = {}
        add_store_file(files, relative, payload)
        for extra_relative, extra_payload in extra_files:
            add_store_file(files, extra_relative, extra_payload)
        return write_store(store_root, files, before, json_bytes(catalog))

    def stage_model_version_two(self, store_root):
        return self.stage_model(store_root, MODEL_VERSION_TWO_RECORD, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)

    def build_world_and_actors_lanes(self):
        self.actors_store = lane_store_root(self.project, 'actors')
        self.stage_model_version_two(self.world_store)
        self.stage_model(self.actors_store, MODEL_VERSION_ONE_RECORD, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES,
                         extra_files=(('notes/actors-only.bin', b'actors lane file'),))
        write_lane_catalog(self.project, 'world')
        write_lane_catalog(self.project, 'actors')
        self.integration_store = lane_store_root(self.project, 'integration')

    def run_main(self, arguments):
        output, errors = io.StringIO(), io.StringIO()
        with (patch.object(lane_catalog_module, 'REPOSITORY_ROOT', self.project),
              contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors)):
            try:
                exit_code = lane_catalog_module.main(arguments)
            except SystemExit as exit_request:
                exit_code = exit_request.code
        return exit_code, output.getvalue(), errors.getvalue()

    def test_library_flow_writes_the_record_file_and_catalog(self):
        self.assertEqual(read_store_catalog(self.world_store), ({'schemaVersion': 1, 'models': []}, None))
        written = self.stage_model_version_two(self.world_store)
        self.assertEqual(written['filesWritten'], 2)
        self.assertEqual((self.world_store / MODEL_VERSION_TWO_ARCHIVE).read_bytes(), MODEL_VERSION_TWO_BYTES)
        catalog_bytes = (self.world_store / 'catalog.json').read_bytes()
        self.assertEqual(written['catalogSha256'], sha256_hex(catalog_bytes))
        self.assertEqual(json.loads(catalog_bytes), {'schemaVersion': 1, 'models': [MODEL_VERSION_TWO_RECORD]})

    def test_lane_catalog_is_pinned_and_byte_identical_twice(self):
        self.stage_model_version_two(self.world_store)
        first = write_lane_catalog(self.project, 'world')
        first_bytes = (self.world_store / 'catalog.json').read_bytes()
        self.assertEqual(first['sourceCatalogSha256'], sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(json.loads(first_bytes)['sourceCatalogSha256'], sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual((first['filesWritten'], first['recordsBySlice'], first['lane']), (1, {'models': 1}, 'world'))
        before_second = snapshot_tree(self.project)
        second = write_lane_catalog(self.project, 'world')
        self.assertEqual(second['filesWritten'], 0)
        self.assertEqual((self.world_store / 'catalog.json').read_bytes(), first_bytes)
        self.assertEqual(second['catalogSha256'], sha256_hex(first_bytes))
        self.assertEqual(snapshot_tree(self.project), before_second)

    def test_empty_lane_gets_an_empty_pinned_catalog(self):
        written = write_lane_catalog(self.project, 'actors')
        catalog = json.loads((lane_store_root(self.project, 'actors') / 'catalog.json').read_bytes())
        self.assertEqual(catalog, {'schemaVersion': 1, 'models': [], 'sourceCatalogSha256': sha256_hex(GOLDEN_CATALOG_BYTES)})
        self.assertEqual(written['filesWritten'], 1)

    def test_merge_keeps_identical_records_and_refuses_differing_records_and_bad_arguments(self):
        catalog = merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'models', MODEL_VERSION_TWO_RECORD, 4)
        self.assertEqual(merge_catalog_slice(catalog, 'models', copy.deepcopy(MODEL_VERSION_TWO_RECORD), 4), catalog)
        changed = dict(MODEL_VERSION_TWO_RECORD, archiveSha256='0' * 64)
        with self.assertRaisesRegex(CatalogWriteError, f'catalog models record {changed["id"]} differs; preserved'):
            merge_catalog_slice(catalog, 'models', changed, 4)
        full = {'schemaVersion': 1, 'models': [{'id': f'record-{index}'} for index in range(4)]}
        with self.assertRaisesRegex(CatalogWriteError, 'catalog models capacity 4 exceeded'):
            merge_catalog_slice(full, 'models', {'id': 'record-4'}, 4)
        with self.assertRaisesRegex(CatalogWriteError, 'unknown catalog slice'):
            merge_catalog_slice(catalog, 'unknownSlice', {'id': 'x'}, 4)
        with self.assertRaisesRegex(CatalogWriteError, 'needs a string id'):
            merge_catalog_slice(catalog, 'models', {'id': 7}, 4)
        self.assertEqual(catalog['models'], [MODEL_VERSION_TWO_RECORD])

    def test_lane_converter_refuses_a_malformed_manifest_record_before_any_write(self):
        for slice_name, malformed_fields in MALFORMED_MANIFEST_RECORD_FIELDS.items():
            with self.subTest(slice_name):
                catalog, _ = read_store_catalog(self.world_store)
                snapshot = snapshot_tree(self.project)
                with self.assertRaises(CatalogWriteError):
                    merge_catalog_slice(catalog, slice_name, dict(GOLDEN_CATALOG[slice_name][0], **malformed_fields), 1)
                self.assertEqual(snapshot_tree(self.project), snapshot)
                self.assertFalse(self.world_store.exists())

    def test_golden_manifest_records_merge_and_pass_the_lane_catalog(self):
        catalog, before = read_store_catalog(self.world_store)
        files = {}
        for slice_name in MALFORMED_MANIFEST_RECORD_FIELDS:
            catalog = merge_catalog_slice(catalog, slice_name, GOLDEN_CATALOG[slice_name][0], 1)
            for relative in golden_store_relative_paths(slice_name):
                add_store_file(files, relative, (GOLDEN_ROOT / 'l2' / relative).read_bytes())
        write_store(self.world_store, files, before, json_bytes(catalog))
        summary = write_lane_catalog(self.project, 'world')
        self.assertEqual(summary['recordsBySlice'], {'models': 0, 'tiles': 1, 'tables': 1, 'windows': 1})
        lane_catalog = json.loads((self.world_store / 'catalog.json').read_bytes())
        for slice_name in MALFORMED_MANIFEST_RECORD_FIELDS:
            self.assertEqual(lane_catalog[slice_name], GOLDEN_CATALOG[slice_name])

    def test_add_store_file_refuses_unsafe_unbounded_and_case_conflicting_names(self):
        files = {}
        for unsafe in ('a\\b', '../x'):
            with self.subTest(unsafe=unsafe), self.assertRaises(StorePathError):
                add_store_file(files, unsafe, b'payload')
        with self.assertRaisesRegex(CatalogWriteError, 'bounded /l2 resource path'):
            add_store_file(files, '.hidden/x', b'payload')
        add_store_file(files, 'Folder/file.bin', b'first')
        add_store_file(files, 'Folder/file.bin', b'first')
        with self.assertRaisesRegex(CatalogWriteError, 'Conflicting store file paths: folder/FILE.bin'):
            add_store_file(files, 'folder/FILE.bin', b'second')
        self.assertEqual(list(files.values()), [('Folder/file.bin', b'first')])

    def test_write_store_refuses_a_differing_existing_file_before_any_write(self):
        self.stage_model_version_two(self.world_store)
        catalog, before = read_store_catalog(self.world_store)
        corrupt = self.world_store / MODEL_VERSION_TWO_ARCHIVE
        corrupt.write_bytes(b'corrupt bytes preserved for review')
        files = {}
        add_store_file(files, 'aaa/first.bin', b'new file')
        add_store_file(files, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, 'Existing immutable store file differs; preserved'):
            write_store(self.world_store, files, before, json_bytes(dict(catalog, extra=1)))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_write_store_refuses_a_store_root_below_a_junction(self):
        target = self.temporary_root / 'junction-target'
        target.mkdir()
        (target / 'store-file.bin').write_bytes(b'shared store bytes')
        link = self.make_junction(self.temporary_root / 'store-link', target)
        files = {}
        add_store_file(files, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        with self.assertRaisesRegex(StorePathError, 'Symlink/junction/reparse boundary refused'):
            write_store(link / 'l2', files, None, json_bytes({'schemaVersion': 1, 'models': []}))
        self.assertEqual(snapshot_tree(target), {'store-file.bin': (b'shared store bytes', (target / 'store-file.bin').stat().st_mtime_ns)})

    def test_write_store_refuses_a_catalog_changed_after_it_was_read(self):
        catalog, before = read_store_catalog(self.world_store)
        self.world_store.mkdir(parents=True)
        (self.world_store / 'catalog.json').write_bytes(json_bytes({'schemaVersion': 1, 'models': [{'id': 'other-writer'}]}))
        files = {}
        add_store_file(files, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, 'Catalog changed since it was read; preserved'):
            write_store(self.world_store, files, before, json_bytes(merge_catalog_slice(catalog, 'models', MODEL_VERSION_TWO_RECORD, 4)))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_write_store_refuses_a_catalog_changed_while_files_were_written(self):
        catalog, before = read_store_catalog(self.world_store)
        files = {}
        add_store_file(files, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        original_immutable_write = catalog_writer.immutable_write

        def write_then_change_catalog(path, payload):
            original_immutable_write(path, payload)
            (self.world_store / 'catalog.json').write_bytes(b'{"schemaVersion":1,"models":[]}')

        with patch.object(catalog_writer, 'immutable_write', write_then_change_catalog):
            with self.assertRaisesRegex(CatalogWriteError, 'Catalog changed since it was read; preserved'):
                write_store(self.world_store, files, before, json_bytes(merge_catalog_slice(catalog, 'models', MODEL_VERSION_TWO_RECORD, 4)))
        self.assertEqual((self.world_store / 'catalog.json').read_bytes(), b'{"schemaVersion":1,"models":[]}')

    def test_write_store_refuses_a_catalog_over_the_byte_limit_before_any_write_and_accepts_one_at_the_limit(self):
        self.stage_model_version_two(self.world_store)
        catalog, before = read_store_catalog(self.world_store)
        after = json_bytes(merge_catalog_slice(catalog, 'models', MODEL_VERSION_ONE_RECORD, 4))
        files = {}
        add_store_file(files, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES)
        snapshot = snapshot_tree(self.project)
        with patch.object(catalog_writer, 'MAXIMUM_CATALOG_BYTES', len(after) - 1):
            with self.assertRaisesRegex(CatalogWriteError, f'Store catalog of {len(after)} bytes exceeds {len(after) - 1} bytes; preserved'):
                write_store(self.world_store, files, before, after)
        self.assertEqual(snapshot_tree(self.project), snapshot)
        with patch.object(catalog_writer, 'MAXIMUM_CATALOG_BYTES', len(after)):
            self.assertEqual(write_store(self.world_store, files, before, after)['filesWritten'], 2)
        self.assertEqual((self.world_store / 'catalog.json').read_bytes(), after)
        self.assertEqual((self.world_store / MODEL_VERSION_ONE_ARCHIVE).read_bytes(), MODEL_VERSION_ONE_BYTES)

    def test_read_store_catalog_refuses_duplicate_keys_non_finite_numbers_and_other_schemas(self):
        self.world_store.mkdir(parents=True)
        for payload, message in ((b'{"schemaVersion":1,"models":[],"models":[]}', 'Duplicate JSON key'),
                                 (b'{"schemaVersion":1,"models":[],"scale":NaN}', 'Nonfinite JSON'),
                                 (b'{"schemaVersion":2,"models":[]}', 'Invalid native catalog')):
            with self.subTest(message=message):
                (self.world_store / 'catalog.json').write_bytes(payload)
                with self.assertRaisesRegex(CatalogWriteError, message):
                    read_store_catalog(self.world_store)

    def test_lane_catalog_refuses_a_missing_or_differing_record_file(self):
        self.stage_model_version_two(self.world_store)
        archive = self.world_store / MODEL_VERSION_TWO_ARCHIVE
        archive.write_bytes(b'different archive bytes')
        with self.assertRaisesRegex(CatalogWriteError, 'SHA-256 differs from its pin [0-9a-f]{64}: ' + MODEL_VERSION_TWO_ARCHIVE):
            write_lane_catalog(self.project, 'world')
        archive.unlink()
        catalog_bytes = (self.world_store / 'catalog.json').read_bytes()
        with self.assertRaisesRegex(CatalogWriteError, 'pinned store file is missing from .*: ' + MODEL_VERSION_TWO_ARCHIVE):
            write_lane_catalog(self.project, 'world')
        self.assertEqual((self.world_store / 'catalog.json').read_bytes(), catalog_bytes)

    def test_lane_catalog_follows_the_pins_of_a_pinned_tile_manifest(self):
        catalog, before = read_store_catalog(self.world_store)
        catalog = merge_catalog_slice(catalog, 'tiles', GOLDEN_CATALOG['tiles'][0], 1)
        files = {}
        tile_manifest_relative, chunk_manifest_relative = golden_store_relative_paths('tiles')
        add_store_file(files, tile_manifest_relative, (GOLDEN_ROOT / 'l2' / tile_manifest_relative).read_bytes())
        write_store(self.world_store, files, before, json_bytes(catalog))
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, 'pinned store file is missing from .*: ' + chunk_manifest_relative):
            write_lane_catalog(self.project, 'world')
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_lane_catalog_refuses_a_missing_base_catalog_naming_the_path(self):
        base_catalog_path = self.project / 'public' / 'l2' / 'catalog.json'
        base_catalog_path.unlink()
        with self.assertRaises(LaneCatalogError) as refusal:
            write_lane_catalog(self.project, 'world')
        self.assertIn(str(base_catalog_path), str(refusal.exception))
        self.assertFalse(self.world_store.exists())

    def test_resource_path_pattern_is_the_browser_regex(self):
        self.assertIn('/' + NATIVE_RESOURCE_PATH_PATTERN.pattern + '/', BROWSER_RESOURCE_URL_SOURCE.read_text(encoding='utf-8'))

    def test_union_copies_lane_files_and_merges_records_in_order_byte_identically(self):
        self.build_world_and_actors_lanes()
        (self.actors_store / 'coverage.json').write_bytes(b'{"lane":"actors"}')
        first = write_lane_catalog(self.project, 'integration', ('world', 'actors'))
        catalog_bytes = (self.integration_store / 'catalog.json').read_bytes()
        catalog = json.loads(catalog_bytes)
        self.assertEqual(catalog['models'], [MODEL_VERSION_TWO_RECORD, MODEL_VERSION_ONE_RECORD])
        self.assertEqual(catalog['sourceCatalogSha256'], sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual((self.integration_store / MODEL_VERSION_TWO_ARCHIVE).read_bytes(), MODEL_VERSION_TWO_BYTES)
        self.assertEqual((self.integration_store / MODEL_VERSION_ONE_ARCHIVE).read_bytes(), MODEL_VERSION_ONE_BYTES)
        self.assertEqual((self.integration_store / 'notes/actors-only.bin').read_bytes(), b'actors lane file')
        self.assertFalse((self.integration_store / 'coverage.json').exists())
        self.assertEqual((first['filesWritten'], first['recordsBySlice']), (4, {'models': 2}))
        before_rerun = snapshot_tree(self.project)
        self.assertEqual(write_lane_catalog(self.project, 'integration', ('world', 'actors'))['filesWritten'], 0)
        self.assertEqual((self.integration_store / 'catalog.json').read_bytes(), catalog_bytes)
        self.assertEqual(snapshot_tree(self.project), before_rerun)

    def test_union_refuses_a_differing_duplicate_record_before_any_write_and_keeps_an_identical_one_once(self):
        self.build_world_and_actors_lanes()
        self.stage_model_version_two(self.actors_store)
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', ('world', 'actors'))
        models = json.loads((self.integration_store / 'catalog.json').read_bytes())['models']
        self.assertEqual(models, [MODEL_VERSION_TWO_RECORD, MODEL_VERSION_ONE_RECORD])
        data_ui_store = lane_store_root(self.project, 'data-ui')
        differing = dict(MODEL_VERSION_TWO_RECORD, source={'object': 'SyntheticFixture.DifferentSource'})
        self.stage_model(data_ui_store, differing, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES,
                         extra_files=(('notes/data-ui-only.bin', b'data-ui lane file'),))
        write_lane_catalog(self.project, 'data-ui')
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, f'catalog models record {MODEL_VERSION_TWO_RECORD["id"]} differs; preserved'):
            write_lane_catalog(self.project, 'integration', ('world', 'data-ui'))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_union_refuses_another_base_a_missing_catalog_the_target_lane_and_a_repeated_lane(self):
        self.build_world_and_actors_lanes()
        with self.assertRaisesRegex(LaneCatalogError, 'union lane data-ui has no catalog'):
            write_lane_catalog(self.project, 'integration', ('data-ui',))
        with self.assertRaisesRegex(LaneCatalogError, 'target lane world cannot also be a union lane'):
            write_lane_catalog(self.project, 'world', ('world',))
        with self.assertRaisesRegex(LaneCatalogError, 'union lane actors is listed twice'):
            write_lane_catalog(self.project, 'integration', ('actors', 'actors'))
        old_base_sha256 = sha256_hex(GOLDEN_CATALOG_BYTES)
        changed_base = GOLDEN_CATALOG_BYTES.replace(b'map-00-00-section', b'map-00-01-section')
        (self.project / 'public' / 'l2' / 'catalog.json').write_bytes(changed_base)
        with self.assertRaises(LaneCatalogError) as refusal:
            write_lane_catalog(self.project, 'integration', ('world',))
        self.assertIn(old_base_sha256, str(refusal.exception))
        self.assertIn(sha256_hex(changed_base), str(refusal.exception))
        self.assertFalse(self.integration_store.exists())

    def test_union_refuses_two_lanes_holding_one_path_with_different_bytes(self):
        self.build_world_and_actors_lanes()
        (self.world_store / 'notes').mkdir()
        (self.world_store / 'notes/actors-only.bin').write_bytes(b'world lane bytes at the same path')
        with self.assertRaisesRegex(CatalogWriteError, 'Conflicting store file paths: notes/actors-only.bin'):
            write_lane_catalog(self.project, 'integration', ('world', 'actors'))
        self.assertFalse(self.integration_store.exists())

    def test_unknown_lane_is_an_argument_error_listing_the_lanes(self):
        exit_code, output, errors = self.run_main(['--lane', 'plan'])
        self.assertEqual((exit_code, output), (2, ''))
        for lane_name in ('actors', 'data-ui', 'integration', 'world'):
            self.assertIn(lane_name, errors)

    def test_plan_prints_the_exact_merge_command_and_writes_nothing(self):
        subprocess.run(['git', 'init', '--quiet', str(self.project)], check=True, capture_output=True)
        self.build_world_and_actors_lanes()
        source_catalog_sha256 = json.loads((self.world_store / 'catalog.json').read_bytes())['sourceCatalogSha256']
        snapshot = snapshot_tree(self.project)
        exit_code, output, errors = self.run_main(['--lane', 'world', '--plan'])
        self.assertEqual((exit_code, errors), (0, ''))
        main_checkout = Path(git_absolute_path(self.project, '--git-common-dir')).resolve().parent
        merge_script = ROOT / 'scripts' / 'native_store' / 'merge_lane_store.py'
        self.assertEqual(output.splitlines(), [f'cd {main_checkout.as_posix()} && python -B {merge_script.as_posix()} '
                                               f'--lane-store {self.world_store.as_posix()} --target public/l2 '
                                               f'--expected-base-catalog-sha256 {source_catalog_sha256}'])
        self.assertEqual(source_catalog_sha256, sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_main_checkout_of_this_checkout_is_the_parent_of_its_git_common_directory(self):
        expected = Path(git_absolute_path(ROOT, '--git-common-dir')).resolve().parent
        self.assertEqual(main_checkout_root(ROOT), expected)
        self.assertTrue((expected / 'public' / 'l2').exists())

    def test_plan_refuses_a_lane_without_a_catalog_or_with_unwritten_changes(self):
        exit_code, output, errors = self.run_main(['--lane', 'integration', '--plan'])
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('has no catalog', errors)
        self.build_world_and_actors_lanes()
        write_lane_catalog(self.project, 'integration')
        snapshot = snapshot_tree(self.project)
        exit_code, output, errors = self.run_main(['--lane', 'integration', '--union', 'world', '--plan'])
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('is not written yet', errors)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_main_writes_the_lane_catalog_and_prints_the_summary(self):
        self.build_world_and_actors_lanes()
        exit_code, output, errors = self.run_main(['--lane', 'integration', '--union', 'world', '--union', 'actors'])
        self.assertEqual((exit_code, errors), (0, ''))
        summary = json.loads(output)
        self.assertEqual(sorted(summary), ['catalogSha256', 'filesWritten', 'lane', 'laneStoreRoot', 'recordsBySlice', 'sourceCatalogSha256'])
        self.assertEqual((summary['lane'], summary['filesWritten']), ('integration', 4))


if __name__ == '__main__':
    unittest.main()
