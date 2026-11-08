from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog import cli
from reference_client_guard import ReferenceClientLockError, require_reference_client
from reference_client_lock_fixture import use_reference_client_lock
from test_reference_client_guard import SyntheticReferenceClientTrees, write_tree_file
from test_umodel_import_closure import synthetic_package

FAILED_UMODEL_LISTING = type('FailedUModelListing', (), {'stdout': b'', 'stderr': b'', 'returncode': 1})()


class CatalogPackageLockTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name).resolve()
        self.trees = SyntheticReferenceClientTrees(self.base)
        for root in (self.trees.importa_root, self.trees.conversion_root):
            write_tree_file(root, 'animations/Target.ukx', synthetic_package(['Engine']))
            write_tree_file(root, 'system/Core.u', synthetic_package([]))
        write_tree_file(self.trees.importa_root, 'animations/Mage.ukx', synthetic_package([]))
        write_tree_file(self.trees.conversion_root, 'animations/Mage.ukx', synthetic_package(['Core']))
        use_reference_client_lock(self, self.trees.lock_path)
        self.output = self.base / 'catalog' / 'catalog.json'

    def catalog_conversion_package(self, relative_path):
        self.trees.write_lock()
        client_access = require_reference_client(self.trees.conversion_root)
        with patch.object(cli.subprocess, 'run', return_value=FAILED_UMODEL_LISTING) as umodel_call:
            try:
                cli.catalog_package(client_access, relative_path, self.output, self.base / 'umodel.exe')
            finally:
                self.umodel_calls = umodel_call.call_count

    def write_engine_package(self, conversion_payload):
        write_tree_file(self.trees.importa_root, 'system/Engine.u', synthetic_package(['Core']))
        write_tree_file(self.trees.conversion_root, 'system/Engine.u', conversion_payload)

    def test_differing_package_is_refused_before_umodel_or_any_output(self):
        self.write_engine_package(synthetic_package(['Core']))
        with self.assertRaisesRegex(ReferenceClientLockError, 'animations/Mage.ukx is differing, not equal'):
            self.catalog_conversion_package('animations/Mage.ukx')
        self.assertEqual(self.umodel_calls, 0)
        self.assertFalse(self.output.parent.exists())

    def test_equal_package_with_a_differing_import_is_refused_before_umodel(self):
        self.write_engine_package(synthetic_package([]))
        with self.assertRaisesRegex(ReferenceClientLockError, 'UModel would read Engine .*system/Engine.u is differing, not equal'):
            self.catalog_conversion_package('animations/Target.ukx')
        self.assertEqual(self.umodel_calls, 0)
        self.assertFalse(self.output.parent.exists())

    def test_umodel_runs_once_the_whole_import_closure_is_lock_equal(self):
        self.write_engine_package(synthetic_package(['Core']))
        with self.assertRaisesRegex(cli.FormatError, 'UModel listing failed'):
            self.catalog_conversion_package('animations/Target.ukx')
        self.assertEqual(self.umodel_calls, 1)


if __name__ == '__main__':
    unittest.main()
