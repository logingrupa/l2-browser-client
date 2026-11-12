import os
from pathlib import Path
import re
import sys
import tracemalloc
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_assets_lib.gltf import json_bytes
from native_store import catalog_writer
from native_store.catalog_writer import CatalogWriteError, add_store_file, sha256_of_file, write_store
from native_store.pinned_store_verification import VerifiedStoreFile
from native_store import store_file_copy
from native_store.store_file_copy import STORE_FILE_COPY_CHUNK_BYTES, StoreFileSource, add_store_file_source, copy_store_files
from native_store.store_paths import StorePathError
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES
from test_bundle_member_pins import TemporaryStoreTestCase, sha256_hex, snapshot_tree, write_file

STORE_FILES = (('models/Synthetic-Archive.bin', b'synthetic archive bytes'), ('notes/second.bin', b'second store file bytes'))
EMPTY_CATALOG_BYTES = json_bytes({'schemaVersion': 1, 'models': []})
PINNED_CATALOG_BYTES = json_bytes({'schemaVersion': 1, 'models': [], 'sourceCatalogSha256': '6' * 64})
OTHER_WRITER_CATALOG_BYTES = json_bytes({'schemaVersion': 1, 'models': [{'id': 'other-writer'}]})
OTHER_WRITER_BYTES = b'bytes of another writer'
AMPLE_FREE_BYTES = 2 * BATCH_MINIMUM_FREE_BYTES
FIXED_PAST_MODIFICATION_TIME_NS = 1_600_000_000 * 10 ** 9
LARGE_FILE_CHUNK_COUNT = 8


def disk_usage_reader(free_bytes):
    return Mock(return_value=SimpleNamespace(free=free_bytes))


def bytes_by_relative_path(root):
    return {relative: payload for relative, (payload, _) in snapshot_tree(root).items()}


def temporary_file_paths(root):
    return sorted(root.rglob('*.tmp'))


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

    def assert_write_store_and_the_copy_refuse_alike(self, prepare_store_root, before, after, message_for_store_root):
        twin_root = self.temporary_root / 'twin' / 'l2'
        for store_root in (twin_root, self.target_root):
            prepare_store_root(store_root)
        snapshot = snapshot_tree(self.target_root)
        with self.assertRaises(CatalogWriteError) as write_store_refusal:
            write_store(twin_root, self.store_file_payloads(), before, after)
        with self.assertRaises(CatalogWriteError) as copy_refusal:
            self.copy_with_free_bytes(AMPLE_FREE_BYTES, before, after)
        self.assertEqual((str(write_store_refusal.exception), str(copy_refusal.exception)),
                         (message_for_store_root(twin_root), message_for_store_root(self.target_root)))
        self.assertEqual(snapshot_tree(self.target_root), snapshot)

    def assert_the_copy_without_free_bytes_is_refused_and_the_target_is_unchanged(self, message_pattern):
        snapshot = snapshot_tree(self.target_root)
        with self.assertRaisesRegex(CatalogWriteError, message_pattern):
            self.copy_with_free_bytes(0, None, PINNED_CATALOG_BYTES)
        self.assertEqual(snapshot_tree(self.target_root), snapshot)

    def test_an_existing_destination_with_other_bytes_is_refused_as_write_store_refuses_it(self):
        relative = STORE_FILES[1][0]
        self.assert_write_store_and_the_copy_refuse_alike(
            lambda store_root: write_file(store_root / relative, OTHER_WRITER_BYTES), None, EMPTY_CATALOG_BYTES,
            lambda store_root: f'Existing immutable store file differs; preserved: {store_root / relative}')

    def test_a_catalog_changed_before_the_first_write_is_refused_as_write_store_refuses_it(self):
        self.assert_write_store_and_the_copy_refuse_alike(
            lambda store_root: write_file(store_root / 'catalog.json', OTHER_WRITER_CATALOG_BYTES), None, EMPTY_CATALOG_BYTES,
            lambda store_root: 'Catalog changed since it was read; preserved')

    def test_a_catalog_over_the_byte_cap_is_refused_as_write_store_refuses_it_and_one_at_the_cap_is_written(self):
        catalog_bytes = len(EMPTY_CATALOG_BYTES)
        with patch.object(catalog_writer, 'MAXIMUM_CATALOG_BYTES', catalog_bytes - 1):
            self.assert_write_store_and_the_copy_refuse_alike(
                lambda store_root: store_root.mkdir(parents=True), None, EMPTY_CATALOG_BYTES,
                lambda store_root: f'Store catalog of {catalog_bytes} bytes exceeds {catalog_bytes - 1} bytes; preserved: '
                                   f'{store_root / "catalog.json"}')
        with patch.object(catalog_writer, 'MAXIMUM_CATALOG_BYTES', catalog_bytes):
            self.assertEqual(self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)['filesWritten'], 3)
        self.assertEqual((self.target_root / 'catalog.json').read_bytes(), EMPTY_CATALOG_BYTES)

    def test_a_catalog_changed_while_files_were_copied_is_refused_and_keeps_the_bytes_of_the_other_writer(self):
        copy_immutable_store_file = store_file_copy.copy_immutable_store_file

        def copy_then_change_catalog(target_root, store_file_source):
            copy_immutable_store_file(target_root, store_file_source)
            write_file(self.target_root / 'catalog.json', OTHER_WRITER_CATALOG_BYTES)

        with patch.object(store_file_copy, 'copy_immutable_store_file', copy_then_change_catalog):
            with self.assertRaisesRegex(CatalogWriteError, '^Catalog changed since it was read; preserved$'):
                self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        self.assertEqual((self.target_root / 'catalog.json').read_bytes(), OTHER_WRITER_CATALOG_BYTES)

    def test_a_destination_that_reads_back_with_another_sha256_is_refused_and_leaves_no_catalog_and_no_temporary_file(self):
        destination = self.target_root / STORE_FILES[0][0]
        real_sha256_of_file = store_file_copy.sha256_of_file

        def sha256_with_a_differing_read_back(path):
            return '0' * 64 if Path(path) == destination else real_sha256_of_file(path)

        with patch.object(store_file_copy, 'sha256_of_file', sha256_with_a_differing_read_back):
            with self.assertRaises(CatalogWriteError) as refusal:
                self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        self.assertEqual(str(refusal.exception), f'Runtime copy hash differs: {destination}')
        self.assertFalse((self.target_root / 'catalog.json').exists())
        self.assertEqual(temporary_file_paths(self.target_root), [])

    def assert_a_first_destination_rewritten_after_the_free_space_guard_is_refused_as_immutable_write_refuses_it(self):
        (first_relative, first_payload), (second_relative, _) = STORE_FILES
        destination = self.target_root / first_relative
        require_free_bytes_for_missing_store_files = store_file_copy.require_free_bytes_for_missing_store_files

        def guard_then_rewrite_the_first_destination(target_root, missing_sources, disk_usage):
            require_free_bytes_for_missing_store_files(target_root, missing_sources, disk_usage)
            write_file(destination, OTHER_WRITER_BYTES)

        with patch.object(store_file_copy, 'require_free_bytes_for_missing_store_files', guard_then_rewrite_the_first_destination):
            with self.assertRaises(CatalogWriteError) as copy_refusal:
                self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        self.assertEqual(str(copy_refusal.exception), f'Existing immutable runtime asset is corrupt; preserved: {destination}')
        self.assertEqual(destination.read_bytes(), OTHER_WRITER_BYTES)
        self.assertFalse((self.target_root / second_relative).exists())
        self.assertFalse((self.target_root / 'catalog.json').exists())
        self.assertEqual(temporary_file_paths(self.target_root), [])
        with self.assertRaises(CatalogWriteError) as immutable_write_refusal:
            catalog_writer.immutable_write(destination, first_payload)
        self.assertEqual(str(immutable_write_refusal.exception), str(copy_refusal.exception))

    def test_a_destination_created_with_other_bytes_after_the_destination_check_is_refused_and_never_overwritten(self):
        self.assert_a_first_destination_rewritten_after_the_free_space_guard_is_refused_as_immutable_write_refuses_it()

    def test_a_destination_changed_after_the_destination_check_found_it_identical_is_refused_and_never_overwritten(self):
        first_relative, first_payload = STORE_FILES[0]
        write_file(self.target_root / first_relative, first_payload)
        self.assert_a_first_destination_rewritten_after_the_free_space_guard_is_refused_as_immutable_write_refuses_it()

    def copy_while_another_writer_creates_the_missing_destination(self, other_writer_payload):
        (present_relative, present_payload), (missing_relative, _) = STORE_FILES
        write_file(self.target_root / present_relative, present_payload)
        destination = self.target_root / missing_relative
        write_hashed_source_chunks = store_file_copy.write_hashed_source_chunks
        chunk_step_source_paths = []

        def write_chunks_then_create_the_destination(source_path, temporary_file):
            chunk_step_source_paths.append(source_path)
            copied_sha256 = write_hashed_source_chunks(source_path, temporary_file)
            write_file(destination, other_writer_payload)
            os.utime(destination, ns=(FIXED_PAST_MODIFICATION_TIME_NS, FIXED_PAST_MODIFICATION_TIME_NS))
            return copied_sha256

        try:
            with patch.object(store_file_copy, 'write_hashed_source_chunks', write_chunks_then_create_the_destination):
                return self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, EMPTY_CATALOG_BYTES)
        finally:
            self.assertEqual(chunk_step_source_paths, [self.source_root / missing_relative])
            self.assertEqual(temporary_file_paths(self.target_root), [])

    def test_a_destination_created_with_other_bytes_while_its_source_is_copied_is_refused_and_never_overwritten(self):
        destination = self.target_root / STORE_FILES[1][0]
        with self.assertRaises(CatalogWriteError) as refusal:
            self.copy_while_another_writer_creates_the_missing_destination(OTHER_WRITER_BYTES)
        self.assertEqual(str(refusal.exception), f'Existing immutable runtime asset is corrupt; preserved: {destination}')
        self.assertEqual(destination.read_bytes(), OTHER_WRITER_BYTES)
        self.assertFalse((self.target_root / 'catalog.json').exists())

    def test_a_destination_created_with_identical_bytes_while_its_source_is_copied_is_kept_and_not_replaced(self):
        missing_relative, missing_payload = STORE_FILES[1]
        destination = self.target_root / missing_relative
        self.assertEqual(self.copy_while_another_writer_creates_the_missing_destination(missing_payload),
                         {'filesWritten': 2, 'catalogSha256': sha256_hex(EMPTY_CATALOG_BYTES)})
        self.assertEqual((destination.read_bytes(), destination.stat().st_mtime_ns), (missing_payload, FIXED_PAST_MODIFICATION_TIME_NS))

    def test_the_refusals_before_the_first_write_come_in_the_order_of_write_store_and_the_free_space_guard_comes_last(self):
        differing_destination = self.target_root / STORE_FILES[1][0]
        write_file(differing_destination, OTHER_WRITER_BYTES)
        write_file(self.target_root / 'catalog.json', EMPTY_CATALOG_BYTES)
        with patch.object(catalog_writer, 'MAXIMUM_CATALOG_BYTES', len(PINNED_CATALOG_BYTES) - 1):
            self.assert_the_copy_without_free_bytes_is_refused_and_the_target_is_unchanged('^Existing immutable store file differs; preserved: ')
            differing_destination.unlink()
            self.assert_the_copy_without_free_bytes_is_refused_and_the_target_is_unchanged('^Catalog changed since it was read; preserved$')
            (self.target_root / 'catalog.json').unlink()
            self.assert_the_copy_without_free_bytes_is_refused_and_the_target_is_unchanged(
                '^Store catalog of [0-9]+ bytes exceeds [0-9]+ bytes; preserved: ')
        self.assert_the_copy_without_free_bytes_is_refused_and_the_target_is_unchanged('free bytes of the volume of .*; nothing was written$')
        self.assertEqual(self.copy_with_free_bytes(AMPLE_FREE_BYTES, None, PINNED_CATALOG_BYTES)['filesWritten'], 3)

    def test_a_store_root_below_a_junction_is_refused_and_the_junction_target_keeps_what_it_held(self):
        junction_target = self.temporary_root / 'junction-target'
        write_file(junction_target / 'store-file.bin', b'shared store bytes')
        snapshot = snapshot_tree(junction_target)
        link = self.temporary_root / 'store-link'
        self.make_junction(link, junction_target)
        with self.assertRaisesRegex(StorePathError, 'Symlink/junction/reparse boundary refused'):
            copy_store_files(link / 'l2', self.store_file_sources(), None, EMPTY_CATALOG_BYTES, disk_usage=disk_usage_reader(AMPLE_FREE_BYTES))
        self.assertEqual(snapshot_tree(junction_target), snapshot)

    def test_copying_a_file_of_eight_chunks_keeps_the_traced_peak_below_the_file_size(self):
        relative = 'models/large-archive.bin'
        with open(self.source_root / relative, 'wb') as large_source_file:
            for block_index in range(LARGE_FILE_CHUNK_COUNT):
                large_source_file.write(bytes([block_index]) * STORE_FILE_COPY_CHUNK_BYTES)
        store_file_sources = {}
        add_store_file_source(store_file_sources, relative, self.source_root / relative, {})
        (large_source,) = store_file_sources.values()
        tracemalloc.start()
        try:
            copy_store_files(self.target_root, store_file_sources, None, EMPTY_CATALOG_BYTES, disk_usage=disk_usage_reader(AMPLE_FREE_BYTES))
            traced_peak_bytes = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertLess(traced_peak_bytes, LARGE_FILE_CHUNK_COUNT * STORE_FILE_COPY_CHUNK_BYTES)
        self.assertEqual(sha256_of_file(self.target_root / relative), large_source.sha256)


if __name__ == '__main__':
    unittest.main()
