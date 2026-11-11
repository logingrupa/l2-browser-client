import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import UnitLedger
from static_material_package_census import STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH
from test_world_static_mesh_step import RecordingConverter, mesh_request, synthetic_store_record
from world import static_mesh_step
from world.static_mesh_step import ConvertedStaticMesh, StaticMeshStepError, static_material_review_state, static_mesh_outcomes

COMMITTED_STATIC_MESH_PACKAGE_CENSUS = json.loads((ROOT / STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH).read_text(encoding='utf-8'))
NEWLY_REVIEWED_PACKAGE_PATH = 'staticmeshes/Old_S.usx'
NEWLY_REVIEWED_VERSION = (123, 13)
BASELINE_PACKAGE_PATH = 'staticmeshes/Rock_S.usx'
BASELINE_VERSION = (123, 28)


def package_sha256(path):
    return hashlib.sha256(path.encode()).hexdigest()


def census_package_row(path, version):
    return {'licensee': version[1], 'packageVersion': version[0], 'path': path, 'reason': None, 'reviewed': True,
            'sha256': package_sha256(path), 'staticMeshExportCount': 1}


def synthetic_census():
    census = copy.deepcopy(COMMITTED_STATIC_MESH_PACKAGE_CENSUS)
    census['packages'] = [census_package_row(BASELINE_PACKAGE_PATH, BASELINE_VERSION),
                          census_package_row(NEWLY_REVIEWED_PACKAGE_PATH, NEWLY_REVIEWED_VERSION)]
    return census


def package_records(*paths):
    return [{'path': path, 'sha256': package_sha256(path)} for path in paths]


class StaticMaterialReviewStateTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.ledger = UnitLedger(lane_work_root(Path(temporary_directory.name), 'world'), 'meshes', 1)
        self.records = package_records(NEWLY_REVIEWED_PACKAGE_PATH, BASELINE_PACKAGE_PATH)

    def fingerprint(self, reviewed_versions):
        with patch.object(static_mesh_step, 'REVIEWED_VERSIONS', frozenset(reviewed_versions)):
            state = static_material_review_state(synthetic_census(), self.records)
        return self.ledger.unit_fingerprint([record['sha256'] for record in self.records], {'staticMaterialReviewState': state}), state

    def test_the_state_lists_every_package_with_its_version_licensee_and_review_flag_in_path_order(self):
        _, state = self.fingerprint({BASELINE_VERSION})
        self.assertEqual(state, [[NEWLY_REVIEWED_PACKAGE_PATH, 123, 13, False], [BASELINE_PACKAGE_PATH, 123, 28, True]])

    def test_an_equal_review_state_keeps_the_fingerprint(self):
        self.assertEqual(self.fingerprint({BASELINE_VERSION})[0], self.fingerprint({BASELINE_VERSION})[0])

    def test_a_package_flipping_to_reviewed_changes_the_fingerprint(self):
        self.assertNotEqual(self.fingerprint({BASELINE_VERSION})[0], self.fingerprint({BASELINE_VERSION, NEWLY_REVIEWED_VERSION})[0])

    def test_a_package_missing_from_the_census_or_with_another_hash_is_refused_naming_it(self):
        census = synthetic_census()
        cases = (package_records('staticmeshes/Absent_S.usx'), [{'path': BASELINE_PACKAGE_PATH, 'sha256': '0' * 64}])
        for records in cases:
            with self.subTest(path=records[0]['path']):
                with self.assertRaisesRegex(StaticMeshStepError, records[0]['path']):
                    static_material_review_state(census, records)

    def test_every_locked_package_of_the_committed_census_has_a_review_state(self):
        records = [{'path': row['path'], 'sha256': row['sha256']} for row in COMMITTED_STATIC_MESH_PACKAGE_CENSUS['packages']]
        state = static_material_review_state(COMMITTED_STATIC_MESH_PACKAGE_CENSUS, records)
        self.assertEqual(len(state), len(records))
        self.assertEqual([reviewed for _, _, _, reviewed in state],
                         [row['reviewed'] for row in sorted(COMMITTED_STATIC_MESH_PACKAGE_CENSUS['packages'], key=lambda row: row['path'])])


class NewlyReviewedPackageConversionTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        RecordingConverter.instances = []

    def outcomes(self, reviewed_versions):
        requests = [mesh_request('Old_S', 'Rock')]
        with patch.object(static_mesh_step, 'REVIEWED_VERSIONS', frozenset(reviewed_versions)), \
                patch.object(static_mesh_step, 'Converter', RecordingConverter), \
                patch.object(static_mesh_step, 'read_package_header', return_value={'packageVersion': 123, 'licensee': 13}), \
                patch.object(static_mesh_step, 'require_reference_client'), \
                patch.object(static_mesh_step, 'converted_model_store_files_and_record', side_effect=synthetic_store_record):
            return static_mesh_outcomes(self.project_root, Path('E:/Lineage2-client'), requests)

    def test_a_package_flipping_to_reviewed_converts_its_objects_instead_of_gapping_them(self):
        self.assertEqual(self.outcomes({BASELINE_VERSION}), {'Old_S.Rock': ('gap', 'static-material-layout-unreviewed:123/13')})
        self.assertEqual(RecordingConverter.instances, [])
        converted = self.outcomes({BASELINE_VERSION, NEWLY_REVIEWED_VERSION})
        self.assertIsInstance(converted['Old_S.Rock'], ConvertedStaticMesh)
        self.assertEqual(len(RecordingConverter.instances), 1)


if __name__ == '__main__':
    unittest.main()
