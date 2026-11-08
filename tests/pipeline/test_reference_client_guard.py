import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_reference_client_lock
import reference_client_guard
from build_reference_client_lock import classify_reference_client_trees, write_reference_client_lock
from hash_reference_client_tree import hash_tree
from reference_client_guard import (ReferenceClientLock, ReferenceClientLockError, current_host_name, is_locked_reference_root,
    require_reference_client)
from reference_client_lock_fixture import use_reference_client_lock

HASHING_SCRIPT_SHA256 = '0' * 64
BACKSLASH = chr(92)


def write_tree_file(root, relative_path, payload):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def windows_share_spelling(local_path, server):
    drive, rest = os.path.splitdrive(str(local_path))
    return BACKSLASH * 2 + server + BACKSLASH + drive.rstrip(':') + '$' + rest


def device_spelling(local_path):
    return BACKSLASH * 2 + '?' + BACKSLASH + str(local_path)


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

    def origins(self):
        return {'REFERENCE_HOST': current_host_name(), 'REFERENCE_ROOT': self.importa_root.as_posix(),
                'CONVERSION_HOST': current_host_name(), 'CONVERSION_ROOT': self.conversion_root.as_posix()}

    def write_lock(self):
        with patch.multiple(build_reference_client_lock, **self.origins()):
            lock = classify_reference_client_trees(hash_tree(str(self.importa_root)), hash_tree(str(self.conversion_root)), HASHING_SCRIPT_SHA256)
        write_reference_client_lock(lock, self.lock_path)
        return lock


class GuardedConversionRootTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.trees = SyntheticReferenceClientTrees(Path(self.temporary_directory.name).resolve())
        use_reference_client_lock(self, self.trees.lock_path)


class ReferenceClientGuardTests(GuardedConversionRootTestCase):
    def test_every_root_without_lock_is_refused(self):
        for root in (self.trees.conversion_root, self.trees.importa_root):
            with self.subTest(root=root), self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock missing'):
                require_reference_client(root)

    def test_reference_root_spelled_in_another_case_is_the_reference_root(self):
        self.trees.write_lock()
        self.assertFalse(require_reference_client(Path(str(self.trees.importa_root).upper())).requires_lock)

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

    def test_changed_bytes_with_the_locked_size_and_modification_time_report_a_stale_lock(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        package = self.trees.conversion_root / 'animations/Fighter.ukx'
        locked_status = os.stat(package)
        package.write_bytes(b'edited packag')
        os.utime(package, ns=(locked_status.st_atime_ns, locked_status.st_mtime_ns))
        self.assertEqual((os.stat(package).st_size, os.stat(package).st_mtime_ns), (locked_status.st_size, locked_status.st_mtime_ns))
        with self.assertRaisesRegex(ReferenceClientLockError, 'reference client lock is stale for animations/Fighter.ukx; re-lock ordered'):
            access.require_equal_file('animations/Fighter.ukx')

    def test_unchanged_file_is_hashed_once_per_size_and_modification_time(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        package = self.trees.conversion_root / 'animations/Fighter.ukx'
        with patch.object(reference_client_guard, 'sha256_of_file', wraps=reference_client_guard.sha256_of_file) as hashing:
            for _ in range(3):
                access.require_equal_file('animations/Fighter.ukx')
            self.assertEqual(hashing.call_count, 1)
            status = os.stat(package)
            os.utime(package, ns=(status.st_atime_ns, status.st_mtime_ns + 1_000_000_000))
            access.require_equal_file('animations/Fighter.ukx')
            self.assertEqual(hashing.call_count, 2)

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

    def test_root_without_the_engine_library_names_the_root_and_orders_no_relock(self):
        self.trees.write_lock()
        partial_root = Path(self.temporary_directory.name).resolve() / 'partial'
        write_tree_file(partial_root, 'animations/Fighter.ukx', b'equal package')
        with self.assertRaises(ReferenceClientLockError) as refusal:
            require_reference_client(partial_root)
        self.assertEqual(str(refusal.exception),
            f'reference client root {partial_root.as_posix()} has no system/Engine.dll; a lock-checked root must hold every file it reads')
        self.assertNotIn('re-lock', str(refusal.exception))

    def test_equal_file_missing_from_a_lock_checked_root_names_the_root_and_orders_no_relock(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.conversion_root)
        (self.trees.conversion_root / 'animations/Fighter.ukx').unlink()
        with self.assertRaises(ReferenceClientLockError) as refusal:
            access.require_equal_file('animations/Fighter.ukx')
        self.assertEqual(str(refusal.exception), f'reference client root {self.trees.conversion_root.as_posix()} has no animations/Fighter.ukx; '
            'a lock-checked root must hold every file it reads')

    def test_locked_reference_root_on_the_reference_host_only_confines_paths(self):
        self.trees.write_lock()
        access = require_reference_client(self.trees.importa_root)
        self.assertFalse(access.requires_lock)
        self.assertEqual(access.require_equal_file('system/l2.ini'), self.trees.importa_root / 'system/l2.ini')
        for relative_path in ('../x', 'system/../../x', '/system/Engine.dll', 'C:/Windows/win.ini', 'system\\Engine.dll', '', 'system//Engine.dll'):
            with self.subTest(path=relative_path), self.assertRaises(ReferenceClientLockError):
                access.require_equal_file(relative_path)

    def test_reference_root_on_another_host_requires_the_lock(self):
        self.trees.write_lock()
        with patch.object(reference_client_guard, 'current_host_name', lambda: 'ANOTHER-HOST'):
            access = require_reference_client(self.trees.importa_root)
        self.assertTrue(access.requires_lock)
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            access.require_equal_file('system/chargrp.dat')

    def test_root_outside_the_lock_requires_the_lock(self):
        self.trees.write_lock()
        copied_root = Path(self.temporary_directory.name).resolve() / 'copied'
        shutil.copytree(self.trees.importa_root, copied_root)
        access = require_reference_client(copied_root)
        self.assertTrue(access.requires_lock)
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            access.require_equal_file('system/chargrp.dat')
        (copied_root / 'system/Engine.dll').write_bytes(b'another engine')
        reference_client_guard.accesses_by_root_and_lock.clear()
        with self.assertRaisesRegex(ReferenceClientLockError, 'stale for system/Engine.dll'):
            require_reference_client(copied_root)

    @unittest.skipUnless(sys.platform == 'win32', 'device and share spellings are Windows paths')
    def test_device_and_share_spellings_of_the_reference_root_require_the_lock(self):
        self.trees.write_lock()
        for spelling in (device_spelling(self.trees.importa_root), windows_share_spelling(self.trees.importa_root, 'localhost'),
                         windows_share_spelling(self.trees.importa_root, '127.0.0.1')):
            with self.subTest(spelling=spelling):
                if not os.path.isdir(spelling):
                    self.skipTest(f'{spelling} is not reachable on this host')
                access = require_reference_client(spelling)
                self.assertTrue(access.requires_lock)
                with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
                    access.require_equal_file('system/chargrp.dat')

    @unittest.skipUnless(sys.platform == 'win32', 'drive, share and device spellings are Windows paths')
    def test_only_the_exact_reference_root_on_the_reference_host_skips_the_lock(self):
        lock = ReferenceClientLock({'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client'}, {})
        local_root = Path('C:/Lineage2-client')
        other_spellings = (
            windows_share_spelling(local_root, 'IMPORTA-PC'),
            windows_share_spelling(local_root, 'localhost'),
            windows_share_spelling(local_root, '127.0.0.1'),
            device_spelling(local_root),
            BACKSLASH * 2 + '?' + BACKSLASH + 'UNC' + BACKSLASH + 'IMPORTA-PC' + BACKSLASH + 'C$' + BACKSLASH + 'Lineage2-client',
            'Z:/Lineage2-client',
            'E:/Lineage2-client',
        )
        with patch.object(reference_client_guard, 'current_host_name', lambda: 'IMPORTA-PC'):
            for spelling in ('C:/Lineage2-client', 'c:\\lineage2-client'):
                with self.subTest(spelling=spelling):
                    self.assertTrue(is_locked_reference_root(Path(spelling), lock))
            for spelling in other_spellings:
                with self.subTest(spelling=spelling):
                    self.assertFalse(is_locked_reference_root(Path(spelling), lock))
        with patch.object(reference_client_guard, 'current_host_name', lambda: 'DATABASE-PC'):
            self.assertFalse(is_locked_reference_root(local_root, lock))


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


def load_script_module(module_name, file_name):
    specification = importlib.util.spec_from_file_location(module_name, ROOT / 'scripts' / file_name)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class PerFileReaderBindingTests(GuardedConversionRootTestCase):
    def setUp(self):
        super().setUp()
        write_tree_file(self.trees.importa_root, 'animations/Mage.ukx', b'importa package')
        write_tree_file(self.trees.conversion_root, 'animations/Mage.ukx', b'conversion package differs')
        self.trees.write_lock()

    def locked_input_row(self, relative_path):
        payload = (self.trees.conversion_root / relative_path).read_bytes()
        return {'relativePath': relative_path, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}

    def test_effect_source_packages_read_only_lock_equal_packages(self):
        from native_catalog import effects
        with patch.object(effects, 'Package', lambda data, name: data):
            packages = effects.SourcePackages(self.trees.conversion_root)
            self.assertEqual(packages.get('Fighter')[1], b'equal package')
            with self.assertRaisesRegex(ReferenceClientLockError, 'animations/Mage.ukx is differing, not equal'):
                packages.get('Mage')

    def test_map_audio_sources_read_only_lock_equal_files(self):
        map_audio = load_script_module('map_audio_sources_under_test', 'export-native-map-audio.py')
        lock = {'schemaVersion': 1, 'sourceHost': 'TEST-HOST', 'sourceRoot': 'C:/test-client',
            'files': [self.locked_input_row('animations/Fighter.ukx'), self.locked_input_row('animations/Mage.ukx')]}
        sources = map_audio.Sources(self.trees.conversion_root, lock)
        self.assertEqual(sources.read('animations/Fighter.ukx'), b'equal package')
        with self.assertRaisesRegex(ReferenceClientLockError, 'animations/Mage.ukx is differing, not equal'):
            sources.read('animations/Mage.ukx')

    def test_effect_bundle_and_actor_profile_source_checks_refuse_differing_files(self):
        import native_actor_profiles
        import native_effect_bundle
        equal_record, differing_record = ({'path': row.pop('relativePath'), **row} for row in
            (self.locked_input_row('animations/Fighter.ukx'), self.locked_input_row('animations/Mage.ukx')))
        for check_sources in (native_effect_bundle._check_sources, native_actor_profiles._check_sources):
            with self.subTest(check_sources=check_sources.__module__):
                check_sources(self.trees.conversion_root, [equal_record])
                with self.assertRaisesRegex(ReferenceClientLockError, 'animations/Mage.ukx is differing, not equal'):
                    check_sources(self.trees.conversion_root, [differing_record])

    def test_musveren_probe_refuses_a_package_absent_from_the_lock(self):
        from audit_musveren_weights import source_package
        with self.assertRaisesRegex(ReferenceClientLockError, 'animations/LineageMonsters.ukx is absent, not equal'):
            source_package(self.trees.conversion_root)


if __name__ == '__main__':
    unittest.main()
