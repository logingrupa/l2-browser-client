import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_assets import Converter, sha
from reference_client_guard import ReferenceClientAccess, ReferenceClientLockError
from test_native_map_audio import package_bytes


def empty_export(offset, names):
    return b''


def synthetic_package(imported_package_names):
    imports = [('Core', 'Package', 0, name) for name in imported_package_names]
    return package_bytes([], imports, [{'name': 'SyntheticTexture', 'class': 0, 'body': empty_export}])


def lock_record(path, lock_class):
    status = os.stat(path)
    digest = sha(path.read_bytes())
    return {'class': lock_class, 'importaBytes': status.st_size, 'importaSha256': digest,
        'eBytes': status.st_size, 'eSha256': digest, 'eModifiedNanoseconds': status.st_mtime_ns}


class UModelImportClosureTests(unittest.TestCase):
    def converter_for(self, root, packages_by_relative_path, lock_classes_by_relative_path):
        client = root / 'client'
        for relative_path, imported_names in packages_by_relative_path.items():
            (client / relative_path).parent.mkdir(parents=True, exist_ok=True)
            (client / relative_path).write_bytes(synthetic_package(imported_names))
        records = {relative_path.casefold(): lock_record(client / relative_path, lock_class) for relative_path, lock_class in lock_classes_by_relative_path.items()}
        tool = root / 'umodel.exe'
        tool.write_bytes(b'stand-in tool, never executed by these tests')
        with patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())), patch('native_assets.require_reference_client', return_value=ReferenceClientAccess(client.resolve(), records)):
            return Converter(client, root / 'output', tool), client

    def run_umodel(self, converter, client, root):
        work = root / 'work'
        work.mkdir(exist_ok=True)
        completed = type('CompletedUModel', (), {'stdout': b'', 'returncode': 0})()
        with patch('native_assets.subprocess.run', return_value=completed) as umodel_call:
            try:
                converter.run(work, client / 'Textures/Target.utx', {'name': 'SyntheticTexture', 'className': 'Texture'})
            finally:
                self.umodel_calls = umodel_call.call_count

    def test_refuses_a_transitive_import_that_is_not_lock_equal_before_umodel_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            converter, client = self.converter_for(root,
                {'Textures/Target.utx': ['Engine'], 'System/Engine.u': ['Core'], 'System/Core.u': []},
                {'Textures/Target.utx': 'equal', 'System/Engine.u': 'equal', 'System/Core.u': 'differs'})
            with self.assertRaisesRegex(ReferenceClientLockError, 'UModel would read Core .*not equal'):
                self.run_umodel(converter, client, root)
            self.assertEqual(self.umodel_calls, 0)

    def test_refuses_an_import_with_no_package_file_before_umodel_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            converter, client = self.converter_for(root, {'Textures/Target.utx': ['Absent']}, {'Textures/Target.utx': 'equal'})
            with self.assertRaisesRegex(ValueError, 'UModel would read Absent .*missing or ambiguous'):
                self.run_umodel(converter, client, root)
            self.assertEqual(self.umodel_calls, 0)

    def test_runs_umodel_once_every_package_in_the_closure_is_lock_equal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            converter, client = self.converter_for(root,
                {'Textures/Target.utx': ['Engine', 'Core'], 'System/Engine.u': ['Core'], 'System/Core.u': []},
                {'Textures/Target.utx': 'equal', 'System/Engine.u': 'equal', 'System/Core.u': 'equal'})
            self.run_umodel(converter, client, root)
            self.assertEqual(self.umodel_calls, 1)
            self.assertEqual(sorted(converter.dependencies), ['System/Core.u', 'System/Engine.u', 'Textures/Target.utx'])


if __name__ == '__main__':
    unittest.main()
