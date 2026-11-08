import copy
import hashlib
import json
import os
from pathlib import Path
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
from native_store.store_paths import StorePathError, lane_store_root
from native_store.write_lane_catalog import LaneCatalogError, write_lane_catalog

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG_BYTES = (GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes()
GOLDEN_CATALOG = json.loads(GOLDEN_CATALOG_BYTES)
MODEL_VERSION_TWO_BYTES = (GOLDEN_ROOT / 'model-v2.l2asset').read_bytes()
MODEL_VERSION_TWO_RECORD = GOLDEN_CATALOG['models'][1]
MODEL_VERSION_TWO_ARCHIVE = MODEL_VERSION_TWO_RECORD['archive'][len('/l2/'):]
BROWSER_RESOURCE_URL_SOURCE = ROOT / 'src' / 'assets' / 'native' / 'nativeResourceUrl.ts'

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
    JUNCTION_UNAVAILABLE_REASON = None
except (ImportError, AttributeError) as error:
    JUNCTION_FACTORY = None
    JUNCTION_UNAVAILABLE_REASON = f'NTFS junctions unavailable: {error}'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


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

    def stage_model_version_two(self, store_root):
        catalog, before = read_store_catalog(store_root)
        catalog = merge_catalog_slice(catalog, 'models', MODEL_VERSION_TWO_RECORD, 4)
        files = {}
        add_store_file(files, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        return write_store(store_root, files, before, json_bytes(catalog))

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
        with self.assertRaisesRegex(LaneCatalogError, 'SHA-256 differs: ' + MODEL_VERSION_TWO_ARCHIVE):
            write_lane_catalog(self.project, 'world')
        archive.unlink()
        catalog_bytes = (self.world_store / 'catalog.json').read_bytes()
        with self.assertRaisesRegex(LaneCatalogError, 'missing from the lane store: ' + MODEL_VERSION_TWO_ARCHIVE):
            write_lane_catalog(self.project, 'world')
        self.assertEqual((self.world_store / 'catalog.json').read_bytes(), catalog_bytes)

    def test_lane_catalog_refuses_a_missing_base_catalog_naming_the_path(self):
        base_catalog_path = self.project / 'public' / 'l2' / 'catalog.json'
        base_catalog_path.unlink()
        with self.assertRaises(LaneCatalogError) as refusal:
            write_lane_catalog(self.project, 'world')
        self.assertIn(str(base_catalog_path), str(refusal.exception))
        self.assertFalse(self.world_store.exists())

    def test_resource_path_pattern_is_the_browser_regex(self):
        self.assertIn('/' + NATIVE_RESOURCE_PATH_PATTERN.pattern + '/', BROWSER_RESOURCE_URL_SOURCE.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
