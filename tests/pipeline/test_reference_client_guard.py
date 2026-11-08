import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import reference_client_guard
from build_reference_client_lock import classify_reference_client_trees, write_reference_client_lock
from hash_reference_client_tree import hash_tree
from reference_client_guard import ReferenceClientLockError, require_reference_client

HASHING_SCRIPT_SHA256 = '0' * 64


def write_tree_file(root, relative_path, payload):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


class SyntheticReferenceClientTrees:
    def __init__(self, base):
        self.importa_root, self.conversion_root = base / 'importa', base / 'conversion'
        self.lock_path = base / 'lock' / 'reference-client-tree.lock.json'
        for root in (self.importa_root, self.conversion_root):
            write_tree_file(root, 'system/Engine.dll', b'engine')
            write_tree_file(root, 'animations/Fighter.ukx', b'equal package')
            write_tree_file(root, 'system/npcgrp.dat', b'equal table')
        write_tree_file(self.importa_root, 'system/chargrp.dat', b'importa table')
        write_tree_file(self.conversion_root, 'system/chargrp.dat', b'conversion table differs')
        write_tree_file(self.conversion_root, 'Start-Kingdom.cmd', b'conversion only')
        write_tree_file(self.importa_root, 'system/l2.ini', b'[Engine]')
        write_tree_file(self.conversion_root, 'system/l2.ini', b'[Engine]')

    def write_lock(self):
        lock = classify_reference_client_trees(hash_tree(str(self.importa_root)), hash_tree(str(self.conversion_root)), HASHING_SCRIPT_SHA256)
        write_reference_client_lock(lock, self.lock_path)
        return lock


class GuardedConversionRootTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.trees = SyntheticReferenceClientTrees(Path(self.temporary_directory.name).resolve())
        for name, value in (('DATABASE_PC_CONVERSION_ROOT', self.trees.conversion_root), ('REFERENCE_CLIENT_LOCK_PATH', self.trees.lock_path)):
            patcher = patch.object(reference_client_guard, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        cache_patcher = patch.dict(reference_client_guard.accesses_by_root_and_lock, clear=True)
        cache_patcher.start()
        self.addCleanup(cache_patcher.stop)


class ReferenceClientGuardTests(GuardedConversionRootTestCase):
    def test_conversion_root_without_lock_is_refused(self):
        with self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock missing'):
            require_reference_client(self.trees.conversion_root)

    def test_conversion_root_spelling_is_compared_casefolded(self):
        spelled_differently = Path(str(self.trees.conversion_root).upper())
        with self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock missing'):
            require_reference_client(spelled_differently)

    def test_equal_file_is_accepted(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        self.assertTrue(access.requires_lock)
        self.assertEqual(access.require_equal_file('animations/Fighter.ukx'), self.trees.conversion_root / 'animations/Fighter.ukx')
        self.assertEqual(access.require_equal_file('Animations/fighter.UKX').name.casefold(), 'fighter.ukx')

    def test_differing_conversion_only_volatile_and_unlisted_files_are_refused(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        for relative_path, lock_class in (('system/chargrp.dat', 'differing'), ('Start-Kingdom.cmd', 'e-only'), ('system/l2.ini', 'volatile-config'), ('system/unknown.dat', 'absent')):
            with self.subTest(path=relative_path), self.assertRaisesRegex(ReferenceClientLockError, f'is {lock_class}, not equal'):
                access.require_equal_file(relative_path)

    def test_modification_time_change_alone_is_accepted_after_rehash(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        package = self.trees.conversion_root / 'animations/Fighter.ukx'
        status = os.stat(package)
        os.utime(package, ns=(status.st_atime_ns, status.st_mtime_ns + 1))
        self.assertEqual(access.require_equal_file('animations/Fighter.ukx'), package)

    def test_changed_bytes_report_a_stale_lock(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        (self.trees.conversion_root / 'animations/Fighter.ukx').write_bytes(b'edited package')
        with self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock is stale for animations/Fighter.ukx; re-lock ordered'):
            access.require_equal_file('animations/Fighter.ukx')

    def test_changed_engine_library_refuses_the_whole_root(self):
        self.trees.write_lock()
        (self.trees.conversion_root / 'system/Engine.dll').write_bytes(b'patched engine')
        with self.assertRaisesRegex(ReferenceClientLockError, 'stale for system/Engine.dll'):
            require_reference_client(self.trees.conversion_root)

    def test_other_roots_only_confine_paths(self):
        access = require_reference_client(self.trees.importa_root)
        self.assertFalse(access.requires_lock)
        self.assertEqual(access.require_equal_file('system/l2.ini'), self.trees.importa_root / 'system/l2.ini')
        for relative_path in ('../x', 'system/../../x', '/system/Engine.dll', 'C:/Windows/win.ini', 'system\\Engine.dll', '', 'system//Engine.dll'):
            with self.subTest(path=relative_path), self.assertRaises(ReferenceClientLockError):
                access.require_equal_file(relative_path)


class CentralReadHelperBindingTests(GuardedConversionRootTestCase):
    def create_converter(self):
        from native_assets import Converter
        umodel = write_tree_file(Path(self.temporary_directory.name), 'tools/umodel.exe', b'dummy umodel')
        with patch('native_assets.UMODEL_SHA256', hashlib.sha256(umodel.read_bytes()).hexdigest()):
            return Converter(self.trees.conversion_root, Path(self.temporary_directory.name) / 'output', umodel)

    def test_converter_on_conversion_root_without_lock_is_refused_before_indexing(self):
        with patch('pathlib.Path.rglob') as package_index, self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock missing'):
            self.create_converter()
        package_index.assert_not_called()

    def test_converter_source_accepts_equal_and_refuses_differing_files(self):
        self.trees.write_lock()
        converter = self.create_converter()
        package = self.trees.conversion_root / 'animations/Fighter.ukx'
        self.assertEqual(converter.source(package), package)
        with self.assertRaisesRegex(ReferenceClientLockError, 'is differing, not equal'):
            converter.source(self.trees.conversion_root / 'system/chargrp.dat')

    def test_table_source_path_refuses_volatile_and_differing_system_files(self):
        from native_catalog.tables import table_source_path
        self.trees.write_lock()
        self.assertEqual(table_source_path(self.trees.conversion_root, 'npcgrp', r'npcgrp\.dat'), self.trees.conversion_root / 'system/npcgrp.dat')
        with self.assertRaisesRegex(ReferenceClientLockError, 'is differing, not equal'):
            table_source_path(self.trees.conversion_root, 'chargrp', r'chargrp\.dat')
        write_tree_file(self.trees.conversion_root, 'system/npcname-e.dat', b'conversion names')
        self.trees.write_lock()
        with self.assertRaisesRegex(ReferenceClientLockError, 'is e-only, not equal'):
            table_source_path(self.trees.conversion_root, 'npcname', r'npcname-e\.dat')
        with self.assertRaisesRegex(ReferenceClientLockError, 'is volatile-config, not equal'):
            table_source_path(self.trees.conversion_root, 'npcname', r'l2\.ini', 'l2.ini')


if __name__ == '__main__':
    unittest.main()
