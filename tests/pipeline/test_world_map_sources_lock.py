from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from reference_client_guard import ReferenceClientLockError
from reference_client_lock_fixture import use_reference_client_lock
from test_reference_client_guard import SyntheticReferenceClientTrees
from world import map_sources

DIFFERING_TABLE = 'system/chargrp.dat'
EQUAL_TABLE = 'system/npcgrp.dat'


class MapSourcesLockTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name).resolve()
        self.trees = SyntheticReferenceClientTrees(self.base)
        use_reference_client_lock(self, self.trees.lock_path)
        self.trees.write_lock()
        self.client = self.trees.conversion_root

    def test_map_sources_read_only_lock_equal_packages(self):
        with patch.object(map_sources, 'Package', lambda data, name: data):
            sources = map_sources.MapSources(self.client)
            self.assertEqual(sources.get(EQUAL_TABLE), b'equal table')
            with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
                sources.get(DIFFERING_TABLE)


if __name__ == '__main__':
    unittest.main()
