from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import CatalogWriteError, add_store_file, write_store
from native_store.pinned_store_verification import VerifiedStoreFile
from native_store import store_file_copy
from native_store.store_file_copy import StoreFileSource, add_store_file_source, copy_store_files
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES
from test_bundle_member_pins import TemporaryStoreTestCase, sha256_hex, snapshot_tree, write_file

STORE_FILES = (('models/Synthetic-Archive.bin', b'synthetic archive bytes'), ('notes/second.bin', b'second store file bytes'))
EMPTY_CATALOG_BYTES = json_bytes({'schemaVersion': 1, 'models': []})
PINNED_CATALOG_BYTES = json_bytes({'schemaVersion': 1, 'models': [], 'sourceCatalogSha256': '6' * 64})
AMPLE_FREE_BYTES = 2 * BATCH_MINIMUM_FREE_BYTES


def disk_usage_reader(free_bytes):
    return Mock(return_value=SimpleNamespace(free=free_bytes))


def bytes_by_relative_path(root):
    return {relative: payload for relative, (payload, _) in snapshot_tree(root).items()}


class StoreFileCopyTests(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.source_root = self.temporary_root / 'source' / 'l2'
        self.target_root = self.temporary_root / 'target' / 'l2'
        for relative, payload in STORE_FILES:
            write_file(self.source_root / relative, payload)

    def store_file_sources(self):
        store_file_sources = {}
        for relative, _ in STORE_FILES:
            add_store_file_source(store_file_sources, relative, self.source_root / relative, {})
        return store_file_sources

    def store_file_payloads(self):
        files = {}
        for relative, payload in STORE_FILES:
            add_store_file(files, relative, payload)
        return files

    def copy_with_free_bytes(self, free_bytes, before, after):
        return copy_store_files(self.target_root, self.store_file_sources(), before, after, disk_usage=disk_usage_reader(free_bytes))

    def test_the_copy_returns_and_leaves_what_write_store_does_and_a_second_copy_writes_nothing(self):
        twin_root = self.temporary_root / 'twin' / 'l2'
        written = write_store(twin_root, self.store_file_payloads(), None, EMPTY_CATALOG_BYTES)
        copied = self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        self.assertEqual((copied, sorted(copied)), (written, ['catalogSha256', 'filesWritten']))
        self.assertEqual(bytes_by_relative_path(self.target_root), bytes_by_relative_path(twin_root))
        snapshot = snapshot_tree(self.target_root)
        catalog_on_disk = (self.target_root / 'catalog.json').read_bytes()
        self.assertEqual(self.copy_with_free_bytes(AMPLE_FREE_BYTES, catalog_on_disk, catalog_on_disk),
                         {'filesWritten': 0, 'catalogSha256': sha256_hex(EMPTY_CATALOG_BYTES)})
        self.assertEqual(snapshot_tree(self.target_root), snapshot)

    def test_a_source_takes_the_verified_sha256_of_its_key_and_is_hashed_once_only_when_no_catalog_pins_it(self):
        relative, payload = STORE_FILES[0]
        source_path = self.source_root / relative
        verified_store_file_by_key = {relative.casefold(): VerifiedStoreFile(relative, '7' * 64)}
        with patch.object(store_file_copy, 'sha256_of_file', wraps=store_file_copy.sha256_of_file) as hashed:
            pinned_sources, unpinned_sources = {}, {}
            add_store_file_source(pinned_sources, relative, source_path, verified_store_file_by_key)
            self.assertEqual((pinned_sources, hashed.call_count), ({relative.casefold(): StoreFileSource(relative, source_path, '7' * 64)}, 0))
            add_store_file_source(unpinned_sources, relative, source_path, {})
            self.assertEqual((unpinned_sources, hashed.call_count),
                             ({relative.casefold(): StoreFileSource(relative, source_path, sha256_hex(payload))}, 1))

    def test_one_key_is_kept_once_with_its_first_source_and_refused_with_other_bytes_or_in_another_spelling(self):
        relative, payload = STORE_FILES[0]
        second_source_path = self.temporary_root / 'second-source' / 'l2' / relative
        write_file(second_source_path, payload)
        store_file_sources = self.store_file_sources()
        first_sources = dict(store_file_sources)
        add_store_file_source(store_file_sources, relative, second_source_path, {})
        self.assertEqual(store_file_sources, first_sources)
        self.assertEqual(store_file_sources[relative.casefold()], StoreFileSource(relative, self.source_root / relative, sha256_hex(payload)))
        other_spelling = relative.lower()
        self.assertNotEqual(other_spelling, relative)
        with self.assertRaisesRegex(CatalogWriteError, f'^Conflicting store file paths: {re.escape(other_spelling)}$'):
            add_store_file_source(store_file_sources, other_spelling, second_source_path, {})
        write_file(second_source_path, b'other bytes at the same path')
        with self.assertRaisesRegex(CatalogWriteError, f'^Conflicting store file paths: {re.escape(relative)}$'):
            add_store_file_source(store_file_sources, relative, second_source_path, {})
        self.assertEqual(store_file_sources, first_sources)

    def test_a_source_follows_the_store_file_path_rule(self):
        cases = (('.hidden/x.bin', 'Store file path is not a bounded /l2 resource path: .hidden/x.bin'),
                 ('catalog.json', 'The store catalog is written only by write_store: catalog.json'))
        for relative, message in cases:
            with self.subTest(relative=relative):
                write_file(self.source_root / relative, b'bytes outside the store file path rule')
                with self.assertRaisesRegex(CatalogWriteError, f'^{re.escape(message)}$'):
                    add_store_file_source({}, relative, self.source_root / relative, {})

    def test_a_source_changed_after_its_sha256_was_taken_stops_the_copy_and_leaves_the_target_as_it_was(self):
        write_file(self.target_root / 'catalog.json', EMPTY_CATALOG_BYTES)
        store_file_sources = self.store_file_sources()
        first_relative, first_payload = STORE_FILES[0]
        write_file(self.source_root / first_relative, b'bytes written after the verification')
        snapshot = snapshot_tree(self.target_root)
        with self.assertRaises(CatalogWriteError) as refusal:
            copy_store_files(self.target_root, store_file_sources, EMPTY_CATALOG_BYTES, PINNED_CATALOG_BYTES,
                             disk_usage=disk_usage_reader(AMPLE_FREE_BYTES))
        self.assertEqual(str(refusal.exception), f'Store file source no longer has its expected SHA-256 {sha256_hex(first_payload)}; '
                                                 f'copy stopped: {self.source_root / first_relative}')
        self.assertEqual(snapshot_tree(self.target_root), snapshot)

    def test_missing_bytes_plus_the_floor_over_the_free_bytes_are_refused_and_one_more_free_byte_lets_the_copy_write(self):
        (present_relative, present_payload), (_, missing_payload) = STORE_FILES
        write_file(self.target_root / present_relative, present_payload)
        snapshot = snapshot_tree(self.target_root)
        free_bytes = len(missing_payload) + BATCH_MINIMUM_FREE_BYTES - 1
        with self.assertRaises(CatalogWriteError) as refusal:
            self.copy_with_free_bytes(free_bytes, None, EMPTY_CATALOG_BYTES)
        self.assertEqual(str(refusal.exception),
                         f'Missing store files of {len(missing_payload)} bytes plus the floor of {BATCH_MINIMUM_FREE_BYTES} bytes exceed the '
                         f'{free_bytes} free bytes of the volume of {self.target_root}; nothing was written')
        self.assertEqual(snapshot_tree(self.target_root), snapshot)
        self.assertEqual(self.copy_with_free_bytes(free_bytes + 1, None, EMPTY_CATALOG_BYTES)['filesWritten'], 2)

    def test_the_free_bytes_are_read_at_the_nearest_existing_ancestor_of_a_target_root_that_does_not_exist(self):
        disk_usage = disk_usage_reader(AMPLE_FREE_BYTES)
        copy_store_files(self.target_root, self.store_file_sources(), None, EMPTY_CATALOG_BYTES, disk_usage=disk_usage)
        disk_usage.assert_called_once_with(self.temporary_root)

    def test_a_copy_with_no_missing_file_is_not_refused_for_low_free_space_and_does_not_read_the_free_bytes(self):
        self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        snapshot = snapshot_tree(self.target_root)
        disk_usage = disk_usage_reader(0)
        self.assertEqual(copy_store_files(self.target_root, self.store_file_sources(), EMPTY_CATALOG_BYTES, EMPTY_CATALOG_BYTES,
                                          disk_usage=disk_usage)['filesWritten'], 0)
        disk_usage.assert_not_called()
        self.assertEqual(snapshot_tree(self.target_root), snapshot)


if __name__ == '__main__':
    unittest.main()
