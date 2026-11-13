from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_tile_step_current_seals import CurrentSealTestCase
from tile_step_seal_fixture import LOCKED_TILE_ID, seal_raw_unit
from native_store import unit_ledger
from world import convert_tile_batch
from world.eligible_tile_selection import PASS_STATUS, locked_tile_source_identity
from world.raw_map_step import RAW_STEP_NAME, read_tile_map_lock_record
from world.tile_music import pinned_music_encoder
from world.tile_step_current_seals import TILE_STEP_SEAL_CHECKS
from world.tile_step_registry import TILE_STEP_NAMES
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_unit_config

SEALED_STEP_NAMES = (RAW_STEP_NAME, WORLD_AUDIO_STEP_NAME)


class TileRowsPassCountTests(CurrentSealTestCase):
    def seal_the_raw_unit_and_a_current_world_audio_unit(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_step(WORLD_AUDIO_STEP_NAME, world_audio_unit_config(self.project_root, LOCKED_TILE_ID, read_tile_map_lock_record(LOCKED_TILE_ID),
                                                                      pinned_music_encoder()))

    def tile_rows_of_one_pass(self):
        return convert_tile_batch.tile_rows(self.project_root, LOCKED_TILE_ID, locked_tile_source_identity(LOCKED_TILE_ID), TILE_STEP_NAMES, {}, {},
                                            TILE_STEP_SEAL_CHECKS)

    def test_one_tile_rows_pass_verifies_each_sealed_unit_once(self):
        self.seal_the_raw_unit_and_a_current_world_audio_unit()
        with (mock.patch.dict(unit_ledger.verified_receipts_by_step_directory_and_unit_key, clear=True),
              mock.patch.object(unit_ledger, 'read_ledger_record', wraps=unit_ledger.read_ledger_record) as read_ledger_record):
            rows = self.tile_rows_of_one_pass()
        self.assertEqual({row['step'] for row in rows if row['status'] == PASS_STATUS}, set(SEALED_STEP_NAMES))
        self.assertEqual(read_ledger_record.call_count, len(SEALED_STEP_NAMES),
                         f'{read_ledger_record.call_count} receipt verifications in one tile_rows pass over {len(SEALED_STEP_NAMES)} sealed units')


if __name__ == '__main__':
    unittest.main()
