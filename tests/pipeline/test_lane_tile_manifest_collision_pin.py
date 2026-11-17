import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from catalog_store_fixture import minimal_runtime_tile_record_and_files
from native_assets_lib.gltf import json_bytes
from native_store.merge_lane_store import LaneStoreMergeRefusedError
from native_store.store_paths import lane_store_root
from native_store.write_lane_catalog import LaneCatalogError, write_lane_catalog
from test_merge_lane_store import GOLDEN_ROOT, LaneStoreFixture, relative_resource, snapshot_tree, write_file

GOLDEN_CATALOG_BYTES = (GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes()
TILE_ID = '20_20'
MISSING_COLLISION_REFUSAL = f'catalog tiles record {TILE_ID} manifest pins no native-tile-collision resource'


class LaneCatalogTileCollisionPinTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        write_file(self.project / 'public' / 'l2' / 'catalog.json', GOLDEN_CATALOG_BYTES)
        self.world_store = lane_store_root(self.project, 'world')

    def write_world_lane_without_collision(self, source_catalog_sha256=None):
        tile_record, files = minimal_runtime_tile_record_and_files(TILE_ID, pins_collision=False)
        for resource_path, payload in files.items():
            write_file(self.world_store / relative_resource(resource_path), payload)
        catalog = {'schemaVersion': 1, 'models': [], 'tiles': [tile_record]}
        if source_catalog_sha256 is not None:
            catalog['sourceCatalogSha256'] = source_catalog_sha256
        write_file(self.world_store / 'catalog.json', json_bytes(catalog))

    def test_a_lane_tile_manifest_without_a_collision_resource_is_neither_pinned_nor_planned(self):
        self.write_world_lane_without_collision()
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, MISSING_COLLISION_REFUSAL):
            write_lane_catalog(self.project, 'world')
        with self.assertRaisesRegex(LaneCatalogError, MISSING_COLLISION_REFUSAL):
            write_lane_catalog(self.project, 'world', plan_only=True)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_a_union_lane_tile_manifest_without_a_collision_resource_is_refused_before_any_write(self):
        self.write_world_lane_without_collision(hashlib.sha256(GOLDEN_CATALOG_BYTES).hexdigest())
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, MISSING_COLLISION_REFUSAL):
            write_lane_catalog(self.project, 'integration', ('world',))
        self.assertEqual(snapshot_tree(self.project), snapshot)
        self.assertFalse(lane_store_root(self.project, 'integration').exists())


class LaneStoreMergeTileCollisionPinTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def write_lane_with_tile(self, pins_collision):
        tile_record, files = minimal_runtime_tile_record_and_files(TILE_ID, pins_collision)
        self.fixture.lane_records = {'models': [], 'tiles': [tile_record]}
        self.fixture.lane_files = files
        self.fixture.write_lane_store()
        return tile_record

    def test_the_restage_refuses_a_tile_manifest_without_a_collision_resource_before_any_write(self):
        self.write_lane_with_tile(pins_collision=False)
        snapshot = snapshot_tree(self.fixture.target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, MISSING_COLLISION_REFUSAL):
            self.fixture.merge()
        self.assertEqual(snapshot_tree(self.fixture.target_root), snapshot)

    def test_the_restage_merges_a_tile_manifest_that_pins_its_collision_resource(self):
        tile_record = self.write_lane_with_tile(pins_collision=True)
        self.assertEqual(self.fixture.merge()['addedRecordsBySlice'], {'tiles': 1})
        self.assertIn(tile_record, json.loads((self.fixture.target_root / 'catalog.json').read_bytes())['tiles'])


if __name__ == '__main__':
    unittest.main()
