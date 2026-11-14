import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import CatalogWriteError, add_store_file, merge_catalog_slice, read_store_catalog, write_store
from native_store.store_paths import lane_store_root
from native_store.write_lane_catalog import LaneCatalogError, write_lane_catalog
from test_lane_catalog_writer import (GOLDEN_CATALOG_BYTES, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES, MODEL_VERSION_ONE_RECORD,
                                      MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES, MODEL_VERSION_TWO_RECORD, snapshot_tree)

RESEALED_MODEL_VERSION_ONE_RECORD = dict(MODEL_VERSION_ONE_RECORD, source={'object': 'SyntheticFixture.ResealedSource'})
DISAGREEING_MODEL_VERSION_TWO_RECORD = dict(MODEL_VERSION_TWO_RECORD, source={'object': 'SyntheticFixture.DisagreeingSource'})
UNION_LANE_NAMES = ('world', 'actors')


class LaneUnionRebuildTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        (self.project / 'public' / 'l2').mkdir(parents=True)
        (self.project / 'public' / 'l2' / 'catalog.json').write_bytes(GOLDEN_CATALOG_BYTES)
        self.world_store = lane_store_root(self.project, 'world')
        self.actors_store = lane_store_root(self.project, 'actors')
        self.integration_store = lane_store_root(self.project, 'integration')
        self.stage_model(self.world_store, MODEL_VERSION_TWO_RECORD, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        self.stage_model(self.actors_store, MODEL_VERSION_ONE_RECORD, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES)
        write_lane_catalog(self.project, 'world')
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)

    def stage_model(self, store_root, record, relative, payload):
        catalog, before = read_store_catalog(store_root)
        files = {}
        add_store_file(files, relative, payload)
        write_store(store_root, files, before, json_bytes(merge_catalog_slice(catalog, 'models', record, 4)))

    def replace_lane_models(self, store_root, model_records):
        catalog, before = read_store_catalog(store_root)
        write_store(store_root, {}, before, json_bytes(dict(catalog, models=model_records)))

    def integration_models(self):
        return json.loads((self.integration_store / 'catalog.json').read_bytes())['models']

    def test_a_resealed_lane_record_replaces_the_earlier_union_record(self):
        self.replace_lane_models(self.actors_store, [RESEALED_MODEL_VERSION_ONE_RECORD])
        write_lane_catalog(self.project, 'actors')
        rebuilt = write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(self.integration_models(), [MODEL_VERSION_TWO_RECORD, RESEALED_MODEL_VERSION_ONE_RECORD])
        self.assertEqual((rebuilt['filesWritten'], rebuilt['recordsBySlice']), (1, {'models': 2}))

    def test_two_union_lanes_disagreeing_on_one_record_are_refused_before_any_write(self):
        self.stage_model(self.actors_store, DISAGREEING_MODEL_VERSION_TWO_RECORD, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        write_lane_catalog(self.project, 'actors')
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, f'^catalog models record {MODEL_VERSION_TWO_RECORD["id"]} differs; preserved$'):
            write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_earlier_union_record_no_union_lane_owns_is_refused_before_any_write(self):
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, f'^lane integration catalog models record {MODEL_VERSION_ONE_RECORD["id"]} '
                                                      'is owned by no union lane; preserved$'):
            write_lane_catalog(self.project, 'integration', ('world',))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_unchanged_union_rebuild_is_byte_identical_and_writes_nothing(self):
        catalog_bytes = (self.integration_store / 'catalog.json').read_bytes()
        snapshot = snapshot_tree(self.project)
        self.assertEqual(write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)['filesWritten'], 0)
        self.assertEqual((self.integration_store / 'catalog.json').read_bytes(), catalog_bytes)
        self.assertEqual(snapshot_tree(self.project), snapshot)


if __name__ == '__main__':
    unittest.main()
