import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import npc_batch
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, NPC_MODEL_UNIT_KIND, conversion_unit_key
from data import lane_unit_outcomes
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, pinned_store_files
from native_store.gap_rows import gap_reason_list_versions
from native_store.store_paths import lane_gap_rows_path, lane_store_root, lane_work_root
from test_npc_batch import MESH_PACKAGE_PATH, OTHER_MESH_PACKAGE_PATH, FakeConverter, NpcBatchFixture, synthetic_unit

REFUSED_MESH_OBJECT = 'alpha_m00'
REFUSAL_MESSAGE = 'Synthetic refusal'
REFUSAL_REASON = 'converter-refused:Synthetic refusal'
PACK_NPC_IDS = [11, 12, 20, 30]
SINGLE_NPC_PROFILE_RECORD = {'id': 'interlude:npc-profiles:999', 'manifest': '/l2/npc-profiles/' + '9' * 64 + '/manifest.json',
                             'manifestSha256': '9' * 64, 'manifestBytes': 2}
OTHER_ARCHIVE_BYTES = b'other archive bytes'


class AlphaRefusingConverter(FakeConverter):
    def convert(self, request):
        if request['object'] == REFUSED_MESH_OBJECT:
            raise ValueError(REFUSAL_MESSAGE)
        return super().convert(request)


def records_sorted_by_id(records):
    return sorted(records, key=lambda record: record['id'])


class NpcBookkeepingFixture(NpcBatchFixture):
    def setUp(self):
        super().setUp()
        self.converter = AlphaRefusingConverter(self.converter.output)
        self.alpha, self.beta, self.gamma = self.selections
        self.store_root = lane_store_root(self.project_root, 'actors')
        self.catalog_path = self.store_root / 'catalog.json'
        self.model_rows_path = lane_gap_rows_path(self.project_root, 'actors', 'npc-model')
        self.profile_rows_path = lane_gap_rows_path(self.project_root, 'actors', 'npc-profile')
        self.model_record_builds = npc_batch.converted_model_store_files_and_record
        self.profile_record_builds = npc_batch.profile_bundle_store_files_and_record
        write_store_patcher = mock.patch.object(npc_batch, 'write_store', wraps=npc_batch.write_store)
        self.write_store = write_store_patcher.start()
        self.addCleanup(write_store_patcher.stop)

    def unit_key(self, selection):
        return conversion_unit_key(NPC_MODEL_UNIT_KIND, selection)

    def expected_model_record(self, selection):
        archive_sha256 = hashlib.sha256((self.model_step_directory(selection) / 'asset.l2asset').read_bytes()).hexdigest()
        return {'id': self.unit_key(selection), 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256}

    def expected_pack_profile_record(self):
        pack_directory = npc_batch.pack_unit_key(npc_batch.npc_profile_pack_id(PACK_NPC_IDS)).replace(':', '__')
        manifest_bytes = (lane_work_root(self.project_root, 'actors') / pack_directory / 'npc-profile-pack' / 'bundle' / 'manifest.json').read_bytes()
        manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
        return {'id': json.loads(manifest_bytes)['id'], 'manifest': f'/l2/npc-profiles/{manifest_sha256}/manifest.json',
                'manifestSha256': manifest_sha256, 'manifestBytes': len(manifest_bytes)}

    def expected_catalog(self):
        return {'schemaVersion': 1, 'models': records_sorted_by_id([self.expected_model_record(self.beta), self.expected_model_record(self.gamma)]),
                'npcProfiles': [self.expected_pack_profile_record()]}

    def expected_model_gap_row_bytes(self, npc_ids):
        evidence = f'work/{self.unit_key(self.alpha).replace(":", "__")}/npc-model/receipt.json'
        rows = [{'key': f'npc:{npc_id}', 'part': 'npcs', 'step': 'npc-model', 'status': 'gap', 'reason': REFUSAL_REASON,
                 'sourceIdentity': {'path': MESH_PACKAGE_PATH, 'sha256': 'c' * 64, 'object': 'LineageMonsters.alpha_m00'}, 'evidence': evidence}
                for npc_id in npc_ids]
        return canonical_json_bytes({'schemaVersion': 1, 'lane': 'actors', 'step': 'npc-model', 'reasonListVersions': gap_reason_list_versions(),
                                     'rows': rows})

    def write_catalog(self, catalog):
        self.catalog_path.write_bytes(json_bytes(catalog))

    def forget_the_first_slice(self):
        for recorded in (self.model_record_builds, self.profile_record_builds, self.write_store):
            recorded.reset_mock()
        self.preflight_calls = 0

    def run_slice_that_converts_nothing(self):
        result = self.run_slice()
        self.assertEqual((result['convertedUnits'], result['unitOutcomes'], result['stopReason'], self.preflight_calls), (0, [], None, 0))
        return result

    def built_model_record_ids(self):
        return [call.args[0] for call in self.model_record_builds.call_args_list]


class NpcBatchByteIdentityTests(NpcBookkeepingFixture):
    def test_one_slice_writes_the_catalog_and_the_gap_rows_with_the_expected_bytes(self):
        result = self.run_slice()
        self.assertEqual((sorted(outcome['status'] for outcome in result['unitOutcomes']), [outcome['status'] for outcome in result['packOutcomes']],
                          result['stopReason']), (['gap', 'pass', 'pass'], ['pass'], None))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.expected_catalog()))
        self.assertEqual(self.model_rows_path.read_bytes(), self.expected_model_gap_row_bytes([11, 12]))
        self.assertFalse(self.profile_rows_path.exists())
        self.assertEqual((self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH).read_bytes(), json.dumps(self.census).encode('utf-8'))

    def test_the_bundle_of_the_expected_profile_record_holds_the_rows_of_the_passed_units_only(self):
        self.run_slice()
        manifest_path = self.store_root / self.expected_pack_profile_record()['manifest'][len('/l2/'):]
        self.assertEqual(sorted(profile['npcId'] for profile in json.loads(manifest_path.read_bytes())['profiles']), [20, 30])


class NpcBatchGapRowWriteTests(NpcBookkeepingFixture):
    def test_a_three_unit_slice_reads_the_lane_gap_rows_once_per_step(self):
        with mock.patch.object(lane_unit_outcomes, 'read_gap_rows', wraps=lane_unit_outcomes.read_gap_rows) as read_gap_rows:
            result = self.run_slice()
        self.assertEqual((result['convertedUnits'], read_gap_rows.call_count), (3, 2))

    def test_a_refusal_before_the_second_unit_leaves_the_row_of_the_first_npc_key_of_the_gap_unit(self):
        self.census['units'][1:] = [synthetic_unit(self.beta, OTHER_MESH_PACKAGE_PATH), synthetic_unit(self.gamma, OTHER_MESH_PACKAGE_PATH)]
        self.write_census()
        self.refuse_on_preflight_call = 2
        with mock.patch.object(lane_unit_outcomes, 'read_gap_rows', wraps=lane_unit_outcomes.read_gap_rows) as read_gap_rows:
            result = self.run_slice()
        self.assertIn('below the batch floor', result['stopReason'])
        self.assertEqual(([outcome['key'] for outcome in result['unitOutcomes']], result['packOutcomes'], result['store']),
                         ([self.unit_key(self.alpha)], [], None))
        self.assertEqual(self.model_rows_path.read_bytes(), self.expected_model_gap_row_bytes([11]))
        self.assertEqual(read_gap_rows.call_count, 1)
        self.assertFalse(self.catalog_path.exists())

    def test_the_deleted_model_gap_row_file_gets_the_rows_of_the_sealed_gap_unit_again(self):
        self.run_slice()
        self.forget_the_first_slice()
        self.model_rows_path.unlink()
        self.run_slice_that_converts_nothing()
        self.assertEqual(self.model_rows_path.read_bytes(), self.expected_model_gap_row_bytes([11, 12]))


class NpcBatchRecordRebuildTests(NpcBookkeepingFixture):
    def setUp(self):
        super().setUp()
        self.run_slice()
        self.forget_the_first_slice()
        self.full_catalog = self.expected_catalog()
        self.beta_record = self.expected_model_record(self.beta)
        self.beta_store_file = self.store_root / self.beta_record['archive'][len('/l2/'):]

    def catalog_with_models(self, model_records):
        return {**self.full_catalog, 'models': records_sorted_by_id(model_records)}

    def test_a_model_record_missing_from_the_catalog_is_added_again_from_its_own_archive(self):
        self.write_catalog(self.catalog_with_models([self.expected_model_record(self.gamma)]))
        self.run_slice_that_converts_nothing()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([self.unit_key(self.beta)], 0))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.full_catalog))

    def test_a_model_record_that_pins_another_archive_is_built_again(self):
        stale_record = {**self.beta_record, 'archive': '/l2/' + '1' * 64 + '/asset.l2asset', 'archiveSha256': '1' * 64}
        self.write_catalog(self.catalog_with_models([stale_record, self.expected_model_record(self.gamma)]))
        self.run_slice_that_converts_nothing()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([self.unit_key(self.beta)], 0))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.full_catalog))

    def test_the_pack_profile_record_missing_from_the_catalog_is_added_again_from_its_own_bundle(self):
        self.write_catalog({**self.full_catalog, 'npcProfiles': []})
        self.run_slice_that_converts_nothing()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([], 1))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.full_catalog))

    def test_a_slice_that_builds_no_record_still_refuses_a_models_slice_over_capacity(self):
        with mock.patch.object(npc_batch, 'model_record_capacity', return_value=len(self.full_catalog['models']) - 1):
            with self.assertRaisesRegex(CatalogWriteError, '^catalog models capacity 1 exceeded$'):
                self.run_slice()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([], 0))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.full_catalog))

    def test_a_slice_that_builds_no_record_still_refuses_a_profile_slice_over_capacity(self):
        over_capacity_catalog = {**self.full_catalog,
                                 'npcProfiles': records_sorted_by_id([SINGLE_NPC_PROFILE_RECORD, *self.full_catalog['npcProfiles']])}
        self.write_catalog(over_capacity_catalog)
        with mock.patch.object(npc_batch, 'MAXIMUM_NPC_PROFILE_BUNDLES', 1):
            with self.assertRaisesRegex(CatalogWriteError, '^catalog npcProfiles capacity 1 exceeded$'):
                self.run_slice()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([], 0))
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(over_capacity_catalog))

    def test_a_slice_over_current_records_verifies_no_archive_or_bundle_and_offers_no_store_file(self):
        self.run_slice_that_converts_nothing()
        self.assertEqual((self.built_model_record_ids(), self.profile_record_builds.call_count), ([], 0))
        self.assertEqual([call.args[1] for call in self.write_store.call_args_list], [{}])
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes(self.full_catalog))

    def test_the_deleted_store_file_of_a_current_record_stays_absent_until_the_verification_walk_refuses_it(self):
        self.beta_store_file.unlink()
        self.run_slice_that_converts_nothing()
        self.assertFalse(self.beta_store_file.exists())
        with self.assertRaisesRegex(CatalogWriteError, '^pinned store file is missing from'):
            pinned_store_files(self.store_root, json.loads(self.catalog_path.read_bytes()))

    def test_the_changed_store_file_of_a_current_record_is_refused_by_the_verification_walk_only(self):
        self.beta_store_file.write_bytes(OTHER_ARCHIVE_BYTES)
        self.run_slice_that_converts_nothing()
        self.assertEqual(self.beta_store_file.read_bytes(), OTHER_ARCHIVE_BYTES)
        with self.assertRaisesRegex(CatalogWriteError, '^pinned store file SHA-256 differs from its pin'):
            pinned_store_files(self.store_root, json.loads(self.catalog_path.read_bytes()))


if __name__ == '__main__':
    unittest.main()
