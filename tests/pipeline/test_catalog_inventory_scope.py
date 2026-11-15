import builtins
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_catalog.cli import file_hash, inventory, json_bytes, verify
from native_catalog.ue2 import FormatError
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH, require_reference_client
from reference_client_lock_fixture import (equal_lock_record, lock_client_as_reference_root, use_synthetic_reference_client_lock,
                                           write_synthetic_engine_library)

EQUAL_FILES = {'animations/Fighter.ukx': b'equal package bytes', 'sounds/sample.ogg': b'OggS equal media fixture'}
OUT_OF_SCOPE_FILES = {'system/chargrp.dat': ('differing', b'conversion table differs'), 'Start-Kingdom.cmd': ('e-only', b'conversion only'),
                      'system/l2.ini': ('volatile-config', b'[Engine]')}
UNLISTED_FILE = 'system/unlisted.dat'


def write_tree_file(root, relative_path, payload):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def out_of_scope_lock_record(lock_class, payload):
    return [lock_class, len(payload) + 1, '1' * 64, len(payload), '2' * 64, 0]


class OpenedPathRecorder:
    def __init__(self, test_case):
        self.opened_paths = []
        original_open = io.open

        def recording_open(file, *arguments, **keywords):
            if isinstance(file, (str, os.PathLike)):
                self.opened_paths.append(Path(os.fspath(file)).resolve())
            return original_open(file, *arguments, **keywords)

        for patcher in (patch.object(io, 'open', recording_open), patch.object(builtins, 'open', recording_open)):
            patcher.start()
            test_case.addCleanup(patcher.stop)


class CatalogInventoryReadScopeTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name).resolve()
        self.client_root = self.base / 'conversion-client'

    def lock_conversion_root(self):
        write_synthetic_engine_library(self.client_root)
        for relative_path, payload in EQUAL_FILES.items():
            write_tree_file(self.client_root, relative_path, payload)
        for relative_path, (_, payload) in OUT_OF_SCOPE_FILES.items():
            write_tree_file(self.client_root, relative_path, payload)
        write_tree_file(self.client_root, UNLISTED_FILE, b'not in the lock')
        files = {relative_path: equal_lock_record(self.client_root / relative_path) for relative_path in (ENGINE_LIBRARY_RELATIVE_PATH, *EQUAL_FILES)}
        files.update({relative_path: out_of_scope_lock_record(lock_class, payload) for relative_path, (lock_class, payload) in OUT_OF_SCOPE_FILES.items()})
        use_synthetic_reference_client_lock(self, self.base / 'reference-client', files)
        return require_reference_client(self.client_root)

    def write_catalog(self, client_access, document):
        output = self.base / 'catalog.json'
        output.write_bytes(json_bytes({'sourceRoot': str(client_access.root), **document}))
        output.with_suffix('.receipt.json').write_bytes(json_bytes({'catalogSha256': file_hash(output), 'artifacts': []}))
        return output

    def test_a_lock_checked_root_inventories_only_lock_equal_files_and_never_opens_the_others(self):
        client_access = self.lock_conversion_root()
        recorder = OpenedPathRecorder(self)
        document = inventory(client_access)
        self.assertEqual([row['path'] for row in document['files']], sorted([ENGINE_LIBRARY_RELATIVE_PATH, *EQUAL_FILES]))
        self.assertEqual(document['filesOutsideReadScope'], sorted([*OUT_OF_SCOPE_FILES, UNLISTED_FILE]))
        opened = set(recorder.opened_paths)
        for relative_path in (*OUT_OF_SCOPE_FILES, UNLISTED_FILE):
            with self.subTest(relative_path=relative_path):
                self.assertNotIn((self.client_root / relative_path).resolve(), opened)
        for relative_path in EQUAL_FILES:
            self.assertIn((self.client_root / relative_path).resolve(), opened)

    def test_the_lock_checked_inventory_records_the_locked_sha256_of_each_equal_file(self):
        client_access = self.lock_conversion_root()
        rows = {row['path']: row for row in inventory(client_access)['files']}
        for relative_path, payload in EQUAL_FILES.items():
            self.assertEqual((rows[relative_path]['bytes'], rows[relative_path]['sha256']),
                             (len(payload), equal_lock_record(self.client_root / relative_path)[4]))

    def test_verification_on_a_lock_checked_root_never_opens_an_out_of_scope_file_and_detects_a_new_one(self):
        client_access = self.lock_conversion_root()
        output = self.write_catalog(client_access, inventory(client_access))
        recorder = OpenedPathRecorder(self)
        self.assertEqual(verify(client_access, output)['fileCount'], 1 + len(EQUAL_FILES))
        self.assertTrue(set(recorder.opened_paths).isdisjoint({(self.client_root / relative_path).resolve()
                                                               for relative_path in (*OUT_OF_SCOPE_FILES, UNLISTED_FILE)}))
        write_tree_file(self.client_root, 'system/another-unlisted.dat', b'appeared after the inventory')
        with self.assertRaisesRegex(FormatError, 'Native client file inventory changed'):
            verify(client_access, output)

    def test_the_locked_reference_root_inventories_every_file_and_verification_detects_a_changed_source(self):
        write_tree_file(self.client_root, 'sample.ogg', b'OggS unchanged media fixture')
        lock_client_as_reference_root(self, self.client_root)
        client_access = require_reference_client(self.client_root)
        first, second = inventory(client_access), inventory(client_access)
        self.assertEqual(first['inventorySha256'], second['inventorySha256'])
        self.assertEqual([row['path'] for row in first['files']], ['sample.ogg', ENGINE_LIBRARY_RELATIVE_PATH])
        self.assertEqual(first['filesOutsideReadScope'], [])
        output = self.write_catalog(client_access, first)
        self.assertEqual(verify(client_access, output)['fileCount'], 2)
        write_tree_file(self.client_root, 'sample.ogg', b'OggS mutated media fixture!!')
        with self.assertRaisesRegex(FormatError, 'source hash mismatch'):
            verify(client_access, output)


if __name__ == '__main__':
    unittest.main()
