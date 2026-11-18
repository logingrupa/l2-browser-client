import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.verified_file_writes import StorePayloadIntegrityError
from synthetic_class_scripts import scratch_work_root
from world.tile_step_current_seals import TILE_STEP_SEAL_CHECKS
from world.tile_step_workers import TileStepRun

TILE_ID = '25_12'
STEP_NAME = 'meshes'
SOURCE_IDENTITY = {'path': 'maps/25_12.unr', 'sha256': 'e' * 64}
FIRST_MESSAGE_LINE = "Archive work/asset.l2asset is not a readable zip: Bad CRC-32 for file 'model.glb'"
SECOND_MESSAGE_LINE = 'second line of the failure message'


def publish_a_converted_archive_that_reads_back_with_a_bad_crc(step, tile_id):
    raise StorePayloadIntegrityError(f'{FIRST_MESSAGE_LINE}\n{SECOND_MESSAGE_LINE}')


class TileStepFailureTracebackTests(unittest.TestCase):
    def test_a_failed_step_keeps_its_first_line_in_the_row_and_writes_its_full_traceback_to_stderr(self):
        tile_step_run = TileStepRun(scratch_work_root(self, 'traceback-project-'), publish_a_converted_archive_that_reads_back_with_a_bad_crc,
                                    mock.Mock(), TILE_STEP_SEAL_CHECKS)
        standard_error = io.StringIO()
        with contextlib.redirect_stderr(standard_error):
            row = tile_step_run.step_result(TILE_ID, STEP_NAME, SOURCE_IDENTITY)
        self.assertEqual((row['status'], row['reason']), ('failed', f'decode-failed:StorePayloadIntegrityError:{FIRST_MESSAGE_LINE}'))
        traceback_text = standard_error.getvalue()
        self.assertTrue(traceback_text.startswith(f'tile {TILE_ID} step {STEP_NAME} failed\nTraceback (most recent call last):\n'), traceback_text)
        for expected_text in ('publish_a_converted_archive_that_reads_back_with_a_bad_crc',
                              f'StorePayloadIntegrityError: {FIRST_MESSAGE_LINE}\n{SECOND_MESSAGE_LINE}\n'):
            self.assertIn(expected_text, traceback_text)


if __name__ == '__main__':
    unittest.main()
