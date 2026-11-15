from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from data import lane_unit_outcomes
from data.lane_unit_outcomes import StepGapRowReplacements, replace_step_gap_row, replace_step_gap_rows
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import gap_reason_list_versions
from native_store.store_paths import lane_gap_rows_path

LANE_NAME = 'actors'
MODEL_STEP, PROFILE_STEP = 'npc-model', 'npc-profile'
NO_MESH_REASON, NAME_ROW_MISSING_REASON = 'no-mesh-in-row', 'npc-name-row-missing'


def gap_row(npc_id, step=MODEL_STEP, reason=NO_MESH_REASON):
    return {'key': f'npc:{npc_id}', 'part': 'npcs', 'step': step, 'status': 'gap', 'reason': reason,
            'sourceIdentity': {'path': 'system/npcgrp.dat', 'sha256': 'a' * 64}, 'evidence': f'work/npc__{npc_id}/{step}/receipt.json'}


def expected_step_file_bytes(step, rows):
    return canonical_json_bytes({'schemaVersion': 1, 'lane': LANE_NAME, 'step': step, 'reasonListVersions': gap_reason_list_versions(),
                                 'rows': rows})


class StepGapRowFixture:
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        self.model_rows_path = lane_gap_rows_path(self.project_root, LANE_NAME, MODEL_STEP)
        self.profile_rows_path = lane_gap_rows_path(self.project_root, LANE_NAME, PROFILE_STEP)
        for name in ('read_gap_rows', 'write_gap_rows'):
            patcher = mock.patch.object(lane_unit_outcomes, name, wraps=getattr(lane_unit_outcomes, name))
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def write_model_rows(self, rows):
        replace_step_gap_rows(self.project_root, LANE_NAME, MODEL_STEP, set(), rows, True)
        self.read_gap_rows.reset_mock()
        self.write_gap_rows.reset_mock()

    def replacements(self):
        return StepGapRowReplacements(self.project_root, LANE_NAME)


class ReplaceStepGapRowTests(StepGapRowFixture, unittest.TestCase):
    def test_a_gap_row_rewrites_the_step_file_even_when_the_row_is_unchanged(self):
        self.write_model_rows([gap_row(1), gap_row(2)])
        replace_step_gap_row(self.project_root, LANE_NAME, MODEL_STEP, 'npc:2', gap_row(2))
        self.assertEqual(self.write_gap_rows.call_count, 1)
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1), gap_row(2)]))

    def test_no_gap_row_for_a_key_without_a_row_writes_nothing(self):
        replace_step_gap_row(self.project_root, LANE_NAME, MODEL_STEP, 'npc:1', None)
        self.assertFalse(self.model_rows_path.exists())
        self.write_model_rows([gap_row(1)])
        replace_step_gap_row(self.project_root, LANE_NAME, MODEL_STEP, 'npc:2', None)
        self.assertEqual(self.write_gap_rows.call_count, 0)

    def test_no_gap_row_for_a_key_with_a_row_removes_that_row(self):
        self.write_model_rows([gap_row(1), gap_row(2)])
        replace_step_gap_row(self.project_root, LANE_NAME, MODEL_STEP, 'npc:1', None)
        self.assertEqual(self.write_gap_rows.call_count, 1)
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(2)]))

    def test_a_row_of_another_step_stays_in_its_own_file(self):
        self.write_model_rows([gap_row(1)])
        replace_step_gap_row(self.project_root, LANE_NAME, PROFILE_STEP, 'npc:1', gap_row(1, PROFILE_STEP, NAME_ROW_MISSING_REASON))
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1)]))
        self.assertEqual(self.profile_rows_path.read_bytes(),
                         expected_step_file_bytes(PROFILE_STEP, [gap_row(1, PROFILE_STEP, NAME_ROW_MISSING_REASON)]))


class ReplaceStepGapRowsTests(StepGapRowFixture, unittest.TestCase):
    def test_differing_rows_are_written_and_the_other_keys_keep_their_rows(self):
        self.write_model_rows([gap_row(1), gap_row(2), gap_row(3)])
        changed_row = gap_row(2, reason='converter-refused:Synthetic refusal')
        desired_rows = replace_step_gap_rows(self.project_root, LANE_NAME, MODEL_STEP, {'npc:2', 'npc:3'}, [gap_row(4), changed_row], False)
        self.assertEqual(desired_rows, [gap_row(1), changed_row, gap_row(4)])
        self.assertEqual((self.read_gap_rows.call_count, self.write_gap_rows.call_count), (1, 1))
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1), changed_row, gap_row(4)]))

    def test_equal_rows_are_written_again_only_when_asked(self):
        self.write_model_rows([gap_row(1), gap_row(2)])
        replace_step_gap_rows(self.project_root, LANE_NAME, MODEL_STEP, {'npc:2'}, [gap_row(2)], False)
        self.assertEqual(self.write_gap_rows.call_count, 0)
        replace_step_gap_rows(self.project_root, LANE_NAME, MODEL_STEP, {'npc:2'}, [gap_row(2)], True)
        self.assertEqual(self.write_gap_rows.call_count, 1)
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1), gap_row(2)]))

    def test_equal_rows_in_another_order_write_nothing(self):
        self.write_model_rows([gap_row(1), gap_row(2), gap_row(3)])
        bytes_before, modified_before = self.model_rows_path.read_bytes(), self.model_rows_path.stat().st_mtime_ns
        desired_rows = replace_step_gap_rows(self.project_root, LANE_NAME, MODEL_STEP, {'npc:1', 'npc:2', 'npc:3'},
                                             [gap_row(3), gap_row(2), gap_row(1)], False)
        self.assertEqual(desired_rows, [gap_row(1), gap_row(2), gap_row(3)])
        self.assertEqual(self.write_gap_rows.call_count, 0)
        self.assertEqual((self.model_rows_path.read_bytes(), self.model_rows_path.stat().st_mtime_ns), (bytes_before, modified_before))


class StepGapRowReplacementsTests(StepGapRowFixture, unittest.TestCase):
    def test_outside_a_recording_a_replaced_row_is_on_disk_when_replace_returns(self):
        self.replacements().replace(MODEL_STEP, 'npc:1', gap_row(1))
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1)]))

    def test_a_recording_reads_once_and_writes_once_at_its_end(self):
        self.write_model_rows([gap_row(1), gap_row(9)])
        replacements = self.replacements()
        with replacements.recorded_until_exit():
            for npc_id in (5, 4, 3, 2):
                replacements.replace(MODEL_STEP, f'npc:{npc_id}', gap_row(npc_id))
            replacements.replace(MODEL_STEP, 'npc:1', None)
            self.assertEqual((self.read_gap_rows.call_count, self.write_gap_rows.call_count), (0, 0))
        self.assertEqual((self.read_gap_rows.call_count, self.write_gap_rows.call_count), (1, 1))
        self.assertEqual(self.model_rows_path.read_bytes(),
                         expected_step_file_bytes(MODEL_STEP, [gap_row(2), gap_row(3), gap_row(4), gap_row(5), gap_row(9)]))

    def test_a_recording_keeps_the_last_row_of_a_key(self):
        replacements = self.replacements()
        with replacements.recorded_until_exit():
            replacements.replace(MODEL_STEP, 'npc:1', gap_row(1))
            replacements.replace(MODEL_STEP, 'npc:1', gap_row(1, reason='converter-refused:Synthetic refusal'))
        self.assertEqual(self.model_rows_path.read_bytes(),
                         expected_step_file_bytes(MODEL_STEP, [gap_row(1, reason='converter-refused:Synthetic refusal')]))

    def test_a_recording_that_removes_no_row_and_sets_none_writes_nothing(self):
        self.write_model_rows([gap_row(1)])
        replacements = self.replacements()
        with replacements.recorded_until_exit():
            replacements.replace(MODEL_STEP, 'npc:2', None)
        self.assertEqual((self.read_gap_rows.call_count, self.write_gap_rows.call_count), (1, 0))

    def test_a_taken_step_is_not_written_at_the_end_of_the_recording(self):
        replacements = self.replacements()
        with replacements.recorded_until_exit():
            replacements.replace(MODEL_STEP, 'npc:1', gap_row(1))
            replacements.replace(PROFILE_STEP, 'npc:2', gap_row(2, PROFILE_STEP, NAME_ROW_MISSING_REASON))
            self.assertEqual(replacements.take_recorded(MODEL_STEP), {'npc:1': gap_row(1)})
            self.assertEqual(replacements.take_recorded(MODEL_STEP), {})
        self.assertFalse(self.model_rows_path.exists())
        self.assertEqual(self.profile_rows_path.read_bytes(),
                         expected_step_file_bytes(PROFILE_STEP, [gap_row(2, PROFILE_STEP, NAME_ROW_MISSING_REASON)]))
        self.assertEqual((self.read_gap_rows.call_count, self.write_gap_rows.call_count), (1, 1))

    def test_a_recording_left_by_an_exception_still_writes_its_rows(self):
        replacements = self.replacements()
        with self.assertRaisesRegex(RuntimeError, 'synthetic stop'):
            with replacements.recorded_until_exit():
                replacements.replace(MODEL_STEP, 'npc:1', gap_row(1))
                raise RuntimeError('synthetic stop')
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1)]))

    def test_after_a_recording_replace_writes_at_once_again(self):
        replacements = self.replacements()
        with replacements.recorded_until_exit():
            replacements.replace(MODEL_STEP, 'npc:1', gap_row(1))
        replacements.replace(MODEL_STEP, 'npc:2', gap_row(2))
        self.assertEqual(self.write_gap_rows.call_count, 2)
        self.assertEqual(self.model_rows_path.read_bytes(), expected_step_file_bytes(MODEL_STEP, [gap_row(1), gap_row(2)]))


if __name__ == '__main__':
    unittest.main()
