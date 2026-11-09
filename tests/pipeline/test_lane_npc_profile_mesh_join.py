import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from catalog_store_fixture import profile_manifest_payload_and_record
from native_assets_lib.gltf import json_bytes
from native_store.coverage_denominators import CoverageReportError
from native_store.merge_lane_store import LaneStoreMergeRefusedError
from native_store.store_paths import lane_store_root
from native_store.write_lane_catalog import write_lane_catalog
from test_merge_lane_store import (GOLDEN_ROOT, MODEL_VERSION_TWO_BYTES, MODEL_VERSION_TWO_RECORD, LaneStoreFixture, relative_resource,
                                   snapshot_tree, write_file)

GOLDEN_CATALOG_BYTES = (GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes()
SABER_TOOTHED_TIGER_EXPORT = 'LineageMonsters.Saber_toothed_tiger_m00'
SABER_TOOTHED_TIGER_NPCGRP_SPELLING = 'LineageMonsters.saber_toothed_tiger_m00'
TIGER_MODEL_CATALOG_ID = 'npc-model:' + 'a' * 64
TIGER_MODEL_RECORD = dict(MODEL_VERSION_TWO_RECORD, id=TIGER_MODEL_CATALOG_ID, source={'object': SABER_TOOTHED_TIGER_EXPORT})
DIFFERENT_MESH_REFUSAL = (f"NPC profile 16015 names model {TIGER_MODEL_CATALOG_ID} of a different mesh: the model source object is "
                          f"'{SABER_TOOTHED_TIGER_EXPORT}', the profile mesh is '{SABER_TOOTHED_TIGER_NPCGRP_SPELLING}'")


def tiger_profile_manifest(profile_mesh):
    return profile_manifest_payload_and_record('native-npc-profiles', [
        {'npcId': 16015, 'mesh': profile_mesh, 'modelCatalogId': TIGER_MODEL_CATALOG_ID}])


class LaneCatalogNpcProfileMeshJoinTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        write_file(self.project / 'public' / 'l2' / 'catalog.json', GOLDEN_CATALOG_BYTES)
        self.actors_store = lane_store_root(self.project, 'actors')

    def write_actors_lane(self, profile_mesh, source_catalog_sha256=None):
        manifest_payload, profile_record = tiger_profile_manifest(profile_mesh)
        write_file(self.actors_store / relative_resource(TIGER_MODEL_RECORD['archive']), MODEL_VERSION_TWO_BYTES)
        write_file(self.actors_store / relative_resource(profile_record['manifest']), manifest_payload)
        catalog = {'schemaVersion': 1, 'models': [TIGER_MODEL_RECORD], 'npcProfiles': [profile_record]}
        if source_catalog_sha256 is not None:
            catalog['sourceCatalogSha256'] = source_catalog_sha256
        write_file(self.actors_store / 'catalog.json', json_bytes(catalog))

    def test_a_profile_mesh_differing_from_its_model_only_in_case_is_neither_pinned_nor_planned(self):
        self.write_actors_lane(SABER_TOOTHED_TIGER_NPCGRP_SPELLING)
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CoverageReportError, DIFFERENT_MESH_REFUSAL):
            write_lane_catalog(self.project, 'actors')
        with self.assertRaisesRegex(CoverageReportError, DIFFERENT_MESH_REFUSAL):
            write_lane_catalog(self.project, 'actors', plan_only=True)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_a_union_lane_pinned_before_the_check_is_refused_before_any_write(self):
        self.write_actors_lane(SABER_TOOTHED_TIGER_NPCGRP_SPELLING, hashlib.sha256(GOLDEN_CATALOG_BYTES).hexdigest())
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CoverageReportError, DIFFERENT_MESH_REFUSAL):
            write_lane_catalog(self.project, 'integration', ('actors',))
        self.assertEqual(snapshot_tree(self.project), snapshot)
        self.assertFalse(lane_store_root(self.project, 'integration').exists())

    def test_a_profile_naming_the_export_spelling_its_model_carries_is_pinned(self):
        self.write_actors_lane(SABER_TOOTHED_TIGER_EXPORT)
        summary = write_lane_catalog(self.project, 'actors')
        self.assertEqual(summary['recordsBySlice'], {'models': 1, 'npcProfiles': 1})
        pinned_catalog = json.loads((self.actors_store / 'catalog.json').read_bytes())
        self.assertEqual(pinned_catalog['sourceCatalogSha256'], hashlib.sha256(GOLDEN_CATALOG_BYTES).hexdigest())


class LaneStoreMergeNpcProfileMeshJoinTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def write_lane_with_tiger_profile(self, profile_mesh):
        manifest_payload, profile_record = tiger_profile_manifest(profile_mesh)
        self.fixture.lane_records = {'models': [TIGER_MODEL_RECORD], 'npcProfiles': [profile_record]}
        self.fixture.lane_files = {TIGER_MODEL_RECORD['archive']: MODEL_VERSION_TWO_BYTES, profile_record['manifest']: manifest_payload}
        self.fixture.write_lane_store()

    def test_the_restage_refuses_a_profile_naming_a_model_of_another_mesh_before_any_write(self):
        self.write_lane_with_tiger_profile(SABER_TOOTHED_TIGER_NPCGRP_SPELLING)
        snapshot = snapshot_tree(self.fixture.target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, DIFFERENT_MESH_REFUSAL):
            self.fixture.merge()
        self.assertEqual(snapshot_tree(self.fixture.target_root), snapshot)

    def test_the_restage_merges_a_profile_naming_the_export_spelling_its_model_carries(self):
        self.write_lane_with_tiger_profile(SABER_TOOTHED_TIGER_EXPORT)
        self.assertEqual(self.fixture.merge()['addedRecordsBySlice'], {'models': 1, 'npcProfiles': 1})


if __name__ == '__main__':
    unittest.main()
