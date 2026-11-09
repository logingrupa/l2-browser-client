from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
from native_catalog import effects
from reference_client_guard import ReferenceClientLockError
from reference_client_lock_fixture import use_reference_client_lock
from test_reference_client_guard import SyntheticReferenceClientTrees, write_tree_file
from world import map_sources
from world.map_sources import file_hash, sha
from world.static_placement import read_class_evidence

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

    def test_reused_class_evidence_refuses_a_package_the_lock_marks_differing(self):
        class_parser = write_tree_file(self.base, 'tools/UELib.dll', b'stand-in class parser')
        reused_evidence = self.base / 'class-evidence'
        script = write_tree_file(reused_evidence / 'Engine.Actor', 'Actor.uc', b'class Actor extends Object;')
        write_tree_file(reused_evidence / 'Engine.Actor', 'defaults.json', json_bytes({
            'sourceScript': 'Actor.uc', 'sourceScriptSha256': sha(script.read_bytes()),
            'source': {'package': DIFFERING_TABLE, 'packageSha256': sha((self.client / DIFFERING_TABLE).read_bytes())}}))
        with patch.object(effects, 'UELIB', class_parser), patch.object(effects, 'UELIB_SHA256', file_hash(class_parser)), \
                self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            read_class_evidence(self.client, self.base / 'work', reused_evidence)

    def test_map_sources_read_only_lock_equal_packages(self):
        with patch.object(map_sources, 'Package', lambda data, name: data):
            sources = map_sources.MapSources(self.client)
            self.assertEqual(sources.get(EQUAL_TABLE), b'equal table')
            with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
                sources.get(DIFFERING_TABLE)


if __name__ == '__main__':
    unittest.main()
