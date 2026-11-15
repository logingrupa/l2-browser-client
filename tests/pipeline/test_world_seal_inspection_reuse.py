import contextlib
import json
from pathlib import Path
import sys
import tempfile
from typing import NamedTuple
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference_client_lock_fixture import use_reference_client_lock
from test_convert_tile_batch import write_synthetic_tile_census
from test_tile_step_current_seals import CurrentSealTestCase
from test_world_tile_batch_phases import names_used_by_module
from tile_step_seal_fixture import LOCKED_TILE_ID, seal_raw_unit
from native_store import unit_ledger
import reference_client_guard
from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS, ReferenceClientLockError
from world import convert_tile_batch
from world.eligible_tile_selection import PASS_STATUS, locked_tile_source_identity
from world.environment_program import environment_lock_input_records
from world.minimap_sources import lock_equal_minimap_source_paths, locked_tile_ids
from world.raw_map_step import RAW_STEP_NAME, RawMapStepError, read_map_lock_record, read_tile_map_lock_record, tile_map_path
from world.terrain_seam_strip import neighbour_tile_id, seam_neighbour_inputs
from world.tile_music import pinned_music_encoder
from world.tile_step_current_seals import TILE_STEP_SEAL_CHECKS
from world.tile_step_registry import TILE_STEP_NAMES
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_unit_config

SEALED_STEP_NAMES = (RAW_STEP_NAME, WORLD_AUDIO_STEP_NAME)
OWNER_TILE_ID = '10_11'
COLUMN_NEIGHBOUR_TILE_ID, ROW_NEIGHBOUR_TILE_ID, CORNER_NEIGHBOUR_TILE_ID = (neighbour_tile_id(OWNER_TILE_ID, role)
                                                                             for role in ('column', 'row', 'corner'))
OWNER_MAP_PATH, COLUMN_NEIGHBOUR_MAP_PATH, ROW_NEIGHBOUR_MAP_PATH, CORNER_NEIGHBOUR_MAP_PATH = (
    tile_map_path(tile_id) for tile_id in (OWNER_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID, ROW_NEIGHBOUR_TILE_ID, CORNER_NEIGHBOUR_TILE_ID))
FIRST_MAP_SHA256, SECOND_MAP_SHA256, THIRD_MAP_SHA256 = 'c' * 64, 'd' * 64, 'e' * 64
ENVIRONMENT_SETUP_PATH = 'system/Env.int'
ENVIRONMENT_TYPE_PATH = 'system/TimeEnv0.int'
ZONE_NAME_PACKAGE_PATH = 'systextures/l2zonename.utx'


class CountedLockParses(NamedTuple):
    through_the_unit_ledger: object
    through_the_guard: object
    parsed_lock_objects: object

    def counts(self):
        return self.through_the_unit_ledger.call_count, self.through_the_guard.call_count, self.parsed_lock_objects.call_count


@contextlib.contextmanager
def counted_lock_parses():
    real_read_reference_client_lock = reference_client_guard.read_reference_client_lock
    with (mock.patch.object(unit_ledger, 'read_reference_client_lock', wraps=real_read_reference_client_lock) as through_the_unit_ledger,
          mock.patch.object(reference_client_guard, 'read_reference_client_lock', wraps=real_read_reference_client_lock) as through_the_guard,
          mock.patch.object(reference_client_guard, 'ReferenceClientLock', wraps=reference_client_guard.ReferenceClientLock) as parsed_lock_objects):
        yield CountedLockParses(through_the_unit_ledger, through_the_guard, parsed_lock_objects)


class LockParseReuseTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name).resolve()
        self.lock_path = self.base / 'reference-client-tree.lock.json'
        use_reference_client_lock(self, self.lock_path)

    def write_lock(self, sha256s_by_path):
        self.lock_path.write_text(json.dumps({
            'schemaVersion': 1, 'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client', 'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
            'files': {path: ['equal', 10, sha256, 10, sha256, 1] for path, sha256 in sha256s_by_path.items()}}), encoding='utf-8')

    def replace_lock_with_one_more_record(self, sha256s_by_path, added_path, added_sha256):
        first_lock_bytes = self.lock_path.stat().st_size
        self.write_lock({**sha256s_by_path, added_path: added_sha256})
        self.assertNotEqual(self.lock_path.stat().st_size, first_lock_bytes)

    def test_read_map_lock_record_called_many_times_parses_the_lock_once_and_again_after_the_file_is_replaced(self):
        self.write_lock({OWNER_MAP_PATH: FIRST_MAP_SHA256})
        with counted_lock_parses() as lock_parses:
            for _ in range(10):
                self.assertEqual(read_map_lock_record(OWNER_MAP_PATH)['eSha256'], FIRST_MAP_SHA256)
            with self.assertRaisesRegex(RawMapStepError, f'^reference client lock has no record for {COLUMN_NEIGHBOUR_MAP_PATH}$'):
                read_map_lock_record(COLUMN_NEIGHBOUR_MAP_PATH)
            self.assertEqual(lock_parses.counts(), (1, 0, 1))
            self.replace_lock_with_one_more_record({OWNER_MAP_PATH: FIRST_MAP_SHA256}, COLUMN_NEIGHBOUR_MAP_PATH, SECOND_MAP_SHA256)
            for _ in range(10):
                self.assertEqual(read_map_lock_record(COLUMN_NEIGHBOUR_MAP_PATH)['eSha256'], SECOND_MAP_SHA256)
        self.assertEqual(lock_parses.counts(), (2, 0, 2))

    def test_seam_neighbour_inputs_called_many_times_parses_the_lock_once_and_again_after_the_file_is_replaced(self):
        project_root = self.base / 'project'
        write_synthetic_tile_census(project_root, (OWNER_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID))
        two_neighbour_maps = {COLUMN_NEIGHBOUR_MAP_PATH: FIRST_MAP_SHA256, ROW_NEIGHBOUR_MAP_PATH: SECOND_MAP_SHA256}
        self.write_lock(two_neighbour_maps)
        expected_inputs = [
            {'role': 'column', 'tileId': COLUMN_NEIGHBOUR_TILE_ID, 'mapSha256': FIRST_MAP_SHA256, 'eligible': True, 'rawFingerprint': None},
            {'role': 'row', 'tileId': ROW_NEIGHBOUR_TILE_ID, 'mapSha256': SECOND_MAP_SHA256, 'eligible': False, 'rawFingerprint': None},
            {'role': 'corner', 'tileId': CORNER_NEIGHBOUR_TILE_ID, 'mapSha256': None, 'eligible': False, 'rawFingerprint': None}]
        with counted_lock_parses() as lock_parses:
            for _ in range(10):
                self.assertEqual(seam_neighbour_inputs(project_root, OWNER_TILE_ID), expected_inputs)
            self.assertEqual(lock_parses.counts(), (1, 0, 1))
            self.replace_lock_with_one_more_record(two_neighbour_maps, CORNER_NEIGHBOUR_MAP_PATH, THIRD_MAP_SHA256)
            for _ in range(10):
                self.assertEqual(seam_neighbour_inputs(project_root, OWNER_TILE_ID),
                                 [*expected_inputs[:2], {**expected_inputs[2], 'mapSha256': THIRD_MAP_SHA256}])
        self.assertEqual(lock_parses.counts(), (2, 0, 2))

    def test_the_environment_and_minimap_lock_readers_parse_the_lock_once_and_again_after_the_file_is_replaced(self):
        locked_sources = {ENVIRONMENT_SETUP_PATH: FIRST_MAP_SHA256, ENVIRONMENT_TYPE_PATH: SECOND_MAP_SHA256,
                          ZONE_NAME_PACKAGE_PATH: THIRD_MAP_SHA256, OWNER_MAP_PATH: FIRST_MAP_SHA256}
        self.write_lock(locked_sources)
        with counted_lock_parses() as lock_parses:
            for _ in range(5):
                self.assertEqual(environment_lock_input_records(self.lock_path),
                                 [{'path': ENVIRONMENT_SETUP_PATH, 'sha256': FIRST_MAP_SHA256}, {'path': ENVIRONMENT_TYPE_PATH, 'sha256': SECOND_MAP_SHA256}])
                self.assertEqual(lock_equal_minimap_source_paths(self.lock_path), [ZONE_NAME_PACKAGE_PATH])
                self.assertEqual(locked_tile_ids(self.lock_path), [OWNER_TILE_ID])
            self.assertEqual(lock_parses.counts(), (1, 0, 1))
            self.replace_lock_with_one_more_record(locked_sources, ROW_NEIGHBOUR_MAP_PATH, SECOND_MAP_SHA256)
            for _ in range(5):
                self.assertEqual(locked_tile_ids(self.lock_path), [OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID])
                self.assertEqual(lock_equal_minimap_source_paths(self.lock_path), [ZONE_NAME_PACKAGE_PATH])
                self.assertEqual(len(environment_lock_input_records(self.lock_path)), 2)
        self.assertEqual(lock_parses.counts(), (2, 0, 2))

    def test_a_missing_lock_is_refused_by_read_map_lock_record_on_every_call(self):
        with counted_lock_parses() as lock_parses:
            for _ in range(2):
                with self.assertRaisesRegex(ReferenceClientLockError, '^reference client lock missing: '):
                    read_map_lock_record(OWNER_MAP_PATH)
        self.assertEqual(lock_parses.counts(), (0, 0, 0))

    def test_no_world_module_names_read_reference_client_lock(self):
        world_module_names = sorted(f'world.{path.stem}' for path in (ROOT / 'scripts' / 'world').glob('*.py'))
        self.assertIn('world.raw_map_step', world_module_names)
        self.assertEqual([module_name for module_name in world_module_names
                          if 'read_reference_client_lock' in names_used_by_module(module_name)], [])


class TileRowsPassCountTests(CurrentSealTestCase):
    def setUp(self):
        super().setUp()
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_step(WORLD_AUDIO_STEP_NAME, world_audio_unit_config(self.project_root, LOCKED_TILE_ID, read_tile_map_lock_record(LOCKED_TILE_ID),
                                                                      pinned_music_encoder()))
        self.source_identity = locked_tile_source_identity(LOCKED_TILE_ID)

    def tile_rows_of_one_pass(self):
        return convert_tile_batch.tile_rows(self.project_root, LOCKED_TILE_ID, self.source_identity, TILE_STEP_NAMES, {}, {}, TILE_STEP_SEAL_CHECKS)

    def test_one_tile_rows_pass_verifies_each_sealed_unit_once(self):
        with (mock.patch.dict(unit_ledger.verified_receipts_by_step_directory_and_unit_key, clear=True),
              mock.patch.object(unit_ledger, 'read_ledger_record', wraps=unit_ledger.read_ledger_record) as read_ledger_record):
            rows = self.tile_rows_of_one_pass()
        self.assertEqual({row['step'] for row in rows if row['status'] == PASS_STATUS}, set(SEALED_STEP_NAMES))
        self.assertEqual(read_ledger_record.call_count, len(SEALED_STEP_NAMES),
                         f'{read_ledger_record.call_count} receipt verifications in one tile_rows pass over {len(SEALED_STEP_NAMES)} sealed units')

    def test_one_tile_rows_pass_parses_the_reference_client_lock_once(self):
        with mock.patch.dict(unit_ledger.reference_client_locks_by_path_and_identity, clear=True), counted_lock_parses() as lock_parses:
            rows = self.tile_rows_of_one_pass()
        self.assertEqual({row['step'] for row in rows if row['status'] == PASS_STATUS}, set(SEALED_STEP_NAMES))
        self.assertEqual(lock_parses.counts(), (1, 0, 1),
                         f'{lock_parses.counts()} lock parses through the unit ledger, through the guard and in all in one tile_rows pass')


if __name__ == '__main__':
    unittest.main()
