import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_reference_client_lock import (ReferenceClientManifestError, classify_reference_client_trees,
    hashing_script_sha256, write_reference_client_lock)
from hash_reference_client_tree import canonical_json_bytes
from native_assets_lib.gltf import json_bytes

HASHING_SCRIPT = ROOT / 'scripts' / 'hash_reference_client_tree.py'


def write_tree_file(root, relative_path, payload):
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def run_hashing_script(root):
    return subprocess.run([sys.executable, '-I', '-B', str(HASHING_SCRIPT), str(root)], capture_output=True, timeout=120, check=False)


def hash_tree_manifest(root):
    result = run_hashing_script(root)
    if result.returncode != 0:
        raise AssertionError(result.stderr.decode('utf-8', errors='replace'))
    return json.loads(result.stdout.decode('utf-8'))


def create_directory_junction(link, target):
    try:
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)], capture_output=True, timeout=30, check=False)
    except OSError:
        return False
    return result.returncode == 0 and link.exists()


class ReferenceClientTreeTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        base = Path(self.temporary_directory.name)
        self.importa_root, self.e_root = base / 'importa', base / 'e'
        for root in (self.importa_root, self.e_root):
            write_tree_file(root, 'system/Engine.dll', b'engine')
            write_tree_file(root, 'textures/Equal Name++.utx', b'equal texture')
        write_tree_file(self.importa_root, 'maps/differing.unr', b'importa map')
        write_tree_file(self.e_root, 'maps/differing.unr', b'e map with other bytes')
        write_tree_file(self.importa_root, 'READ-ME.txt', b'importa only')
        write_tree_file(self.e_root, 'Start-Kingdom.cmd', b'e only')
        write_tree_file(self.importa_root, 'system/l2.ini', b'[Engine]\nimporta')
        write_tree_file(self.e_root, 'system/l2.ini', b'[Engine]\nconversion')
        write_tree_file(self.importa_root, 'Music/Case.dat', b'case payload')
        write_tree_file(self.e_root, 'music/case.dat', b'case payload')

    def build_lock(self):
        return classify_reference_client_trees(hash_tree_manifest(self.importa_root), hash_tree_manifest(self.e_root), hashing_script_sha256())

    def test_lock_classifies_every_path_and_records_case_differences(self):
        lock = self.build_lock()
        classes = {path: values[0] for path, values in lock['files'].items()}
        self.assertEqual(classes, {
            'maps/differing.unr': 'differing',
            'READ-ME.txt': 'importa-only',
            'Start-Kingdom.cmd': 'e-only',
            'Music/Case.dat': 'equal',
            'system/Engine.dll': 'equal',
            'system/l2.ini': 'volatile-config',
            'textures/Equal Name++.utx': 'equal',
        })
        self.assertEqual(lock['caseDifferences'], [['Music/Case.dat', 'music/case.dat']])
        self.assertEqual(lock['classCounts'], {'equal': 3, 'differing': 1, 'importa-only': 1, 'e-only': 1, 'volatile-config': 1, 'unreadable': 0})
        self.assertEqual(lock['files']['Start-Kingdom.cmd'][1:3], [None, None])
        self.assertEqual(lock['files']['READ-ME.txt'][3:], [None, None, None])
        self.assertEqual(lock['hashingScriptSha256'], hashing_script_sha256())
        self.assertEqual(lock['hosts']['e']['fileCount'], 6)

    def test_manifest_rows_are_sorted_with_exact_integer_sizes_and_times(self):
        manifest = hash_tree_manifest(self.importa_root)
        paths = [row['path'] for row in manifest['files']]
        self.assertEqual(paths, sorted(paths, key=lambda path: (path.casefold(), path)))
        engine = next(row for row in manifest['files'] if row['path'] == 'system/Engine.dll')
        status = os.stat(self.importa_root / 'system/Engine.dll')
        self.assertEqual((engine['bytes'], engine['modifiedNanoseconds']), (status.st_size, status.st_mtime_ns))
        self.assertIsInstance(engine['modifiedNanoseconds'], int)

    def test_lock_bytes_are_identical_across_two_runs(self):
        output = Path(self.temporary_directory.name) / 'locks'
        first = write_reference_client_lock(self.build_lock(), output / 'first.lock.json').read_bytes()
        second = write_reference_client_lock(self.build_lock(), output / 'second.lock.json').read_bytes()
        self.assertEqual(first, second)
        self.assertTrue(first.endswith(b'\n'))
        self.assertNotIn(b'\r\n', first)

    def test_unsorted_or_wrong_schema_manifest_is_refused(self):
        manifest = hash_tree_manifest(self.importa_root)
        unsorted = dict(manifest, files=list(reversed(manifest['files'])))
        with self.assertRaisesRegex(ReferenceClientManifestError, 'not sorted'):
            classify_reference_client_trees(unsorted, manifest, hashing_script_sha256())
        with self.assertRaisesRegex(ReferenceClientManifestError, 'schemaVersion'):
            classify_reference_client_trees(dict(manifest, schemaVersion=2), manifest, hashing_script_sha256())

    def test_unreadable_rows_are_classified_never_dropped(self):
        importa = hash_tree_manifest(self.importa_root)
        e = hash_tree_manifest(self.e_root)
        locked_engine = [row for row in e['files'] if row['path'] != 'system/Engine.dll']
        e_with_sharing_violation = dict(e, files=locked_engine, unreadable=[{'path': 'system/Engine.dll', 'reason': 'PermissionError errno 13'}])
        lock = classify_reference_client_trees(importa, e_with_sharing_violation, hashing_script_sha256())
        self.assertEqual(lock['files']['system/Engine.dll'][0], 'unreadable')
        self.assertEqual(lock['unreadable'], [{'path': 'system/Engine.dll', 'side': 'e', 'reason': 'PermissionError errno 13'}])

    def test_walker_serialiser_matches_repository_canonical_json(self):
        value = {'b': [1, 2.5, None], 'a': 'Līnija ünïcode', 'nested': {'z': True, 'y': 'x'}}
        self.assertEqual(canonical_json_bytes(value), json_bytes(value))

    def test_empty_or_missing_root_fails_naming_the_root(self):
        empty = Path(self.temporary_directory.name) / 'empty root'
        (empty / 'only-a-directory').mkdir(parents=True)
        for root in (empty, Path(self.temporary_directory.name) / 'missing root'):
            with self.subTest(root=root):
                result = run_hashing_script(root)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(str(root), result.stderr.decode('utf-8', errors='replace'))
                self.assertEqual(result.stdout, b'')

    def test_walker_never_opens_files_for_writing(self):
        source = HASHING_SCRIPT.read_text(encoding='utf-8')
        self.assertEqual(re.findall(r"""open\([^)]*['"][rb]*[wax+]""", source), [])
        self.assertEqual(re.findall(r'\.(write_bytes|write_text|unlink|rename|replace|mkdir|rmdir)\(', source), [])

    def test_junction_inside_tree_is_refused(self):
        if os.name != 'nt':
            self.skipTest('Directory junctions are a Windows reparse point')
        outside = write_tree_file(Path(self.temporary_directory.name) / 'outside', 'secret.dat', b'outside').parent
        if not create_directory_junction(self.importa_root / 'linked', outside):
            self.skipTest('This account may not create a directory junction')
        result = run_hashing_script(self.importa_root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Reparse point inside the reference tree', result.stderr.decode('utf-8', errors='replace'))


if __name__ == '__main__':
    unittest.main()
