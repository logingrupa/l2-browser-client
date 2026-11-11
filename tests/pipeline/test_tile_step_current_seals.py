from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tile_step_seal_fixture import LOCKED_TILE_ID, object_gap_rows, seal_raw_unit, seal_unit, tile_map_inputs, unpinned_music_encoder
from world import convert_tile_batch, world_audio_step
from world.eligible_tile_selection import SealedTileStep, sealed_unit_step
from world.raw_map_step import read_tile_map_lock_record, tile_map_path, tile_step_row, tile_unit_key
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH
from world.tile_music import pinned_music_encoder
from world.tile_step_current_seals import (CURRENT_SEAL_STATE, PENDING_SEAL_STATE, STALE_SEAL_STATE, TILE_STEP_SEAL_CHECKS, UNSEALED_STATE,
                                           unit_step_seal)
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_unit_config

CURRENT_WORLD_AUDIO_VERSION = 3
OLDER_RAW_FINGERPRINT = 'f' * 64


class CurrentSealTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.enterContext(unpinned_music_encoder())
        self.enterContext(patch.object(world_audio_step, 'WORLD_AUDIO_STEP_ALGORITHM_VERSION', CURRENT_WORLD_AUDIO_VERSION))
        self.unit_key = tile_unit_key(LOCKED_TILE_ID)

    def seal_state(self, step):
        return unit_step_seal(self.project_root, self.unit_key, step, TILE_STEP_SEAL_CHECKS)


class WorldAudioCurrentSealTests(CurrentSealTestCase):
    def current_world_audio_config(self):
        return world_audio_unit_config(self.project_root, LOCKED_TILE_ID, read_tile_map_lock_record(LOCKED_TILE_ID), pinned_music_encoder())

    def seal_world_audio(self, algorithm_version, config, gap_rows=()):
        seal_unit(self.project_root, WORLD_AUDIO_STEP_NAME, algorithm_version, self.unit_key, config, tile_map_inputs(LOCKED_TILE_ID), gap_rows)

    def test_a_receipt_two_versions_below_the_step_is_stale(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION - 2, self.current_world_audio_config())
        seal = self.seal_state(WORLD_AUDIO_STEP_NAME)
        self.assertEqual((seal.state, seal.receipt), (STALE_SEAL_STATE, None))
        self.assertIsNone(sealed_unit_step(self.project_root, self.unit_key, WORLD_AUDIO_STEP_NAME, TILE_STEP_SEAL_CHECKS))

    def test_a_receipt_with_the_current_version_config_and_inputs_is_current(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        gap_rows = object_gap_rows(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 1)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, self.current_world_audio_config(), gap_rows)
        seal = self.seal_state(WORLD_AUDIO_STEP_NAME)
        self.assertEqual((seal.state, seal.receipt['algorithmVersion']), (CURRENT_SEAL_STATE, CURRENT_WORLD_AUDIO_VERSION))
        self.assertEqual(sealed_unit_step(self.project_root, self.unit_key, WORLD_AUDIO_STEP_NAME, TILE_STEP_SEAL_CHECKS),
                         SealedTileStep(gap_rows, f'work/tile__{LOCKED_TILE_ID}/audio/receipt.json'))

    def test_a_receipt_holding_an_older_raw_fingerprint_than_the_raw_seal_is_stale(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, {**self.current_world_audio_config(), 'rawFingerprint': OLDER_RAW_FINGERPRINT})
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME).state, STALE_SEAL_STATE)

    def test_a_receipt_whose_raw_unit_is_unsealed_answers_pending(self):
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, {'rawFingerprint': OLDER_RAW_FINGERPRINT})
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME), (PENDING_SEAL_STATE, None, f'work/tile__{LOCKED_TILE_ID}/audio/receipt.json'))

    def test_a_step_without_a_seal_answers_unsealed(self):
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME).state, UNSEALED_STATE)

    def test_a_stale_receipt_writes_its_step_pending_instead_of_its_recorded_gap_row(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        gap_rows = object_gap_rows(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 2)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION - 2, self.current_world_audio_config(), gap_rows)
        source_identity = {'path': tile_map_path(LOCKED_TILE_ID), 'sha256': read_tile_map_lock_record(LOCKED_TILE_ID)['eSha256']}
        recorded_gap_row = tile_step_row(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 'gap', 'object-gaps:2', source_identity, 'evidence.json')
        rows = convert_tile_batch.tile_rows(self.project_root, LOCKED_TILE_ID, source_identity, (WORLD_AUDIO_STEP_NAME,), {},
                                            {(self.unit_key, WORLD_AUDIO_STEP_NAME): recorded_gap_row}, TILE_STEP_SEAL_CHECKS)
        self.assertEqual([(row['status'], row['reason'], row['evidence']) for row in rows], [('pending', 'batch-pending', TILE_CENSUS_RELATIVE_PATH)])


if __name__ == '__main__':
    unittest.main()
