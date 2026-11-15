import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import convert_actors
from native_store import identical_file_sharing, interprocess_lock as interprocess_lock_module, share_identical_lane_files as sharing_command
from native_store.examined_file_record import examined_file_record_path, identical_file_sharing_folder
from native_store.interprocess_lock import (LaneInUseError, hold_lane_in_use_part_until_process_end, lane_batch_lock, lane_lock_file_path,
                                            lane_sharing_lock)
from native_store.share_identical_lane_files import share_identical_files_of_batch_lane
from native_store.store_paths import lane_folder, lane_work_root
from native_store.unit_ledger import MachineWindowRefusedError
from support.shared_lane_fixture import (CONVERTER_RELATIVE_FOLDER, SharedLaneFixture, link_count, payload_of, snapshot_of_every_entry,
                                         write_file)
from test_convert_tile_batch import (LedgerBackedSteps, RecordingPreflight, TileBatchTestCase, synthetic_expected_cost, synthetic_seal_checks,
                                     synthetic_source_identity, write_synthetic_tile_census)
from world import convert_tile_batch
from world.tile_step_workers import BATCH_EXIT_DONE, BATCH_EXIT_ERROR, BATCH_EXIT_MACHINE_WINDOW

TWIN = payload_of('twin')
TWIN_STORE_PATHS = ('l2/models/first.bin', 'l2/models/second.bin')
SCRATCH_JOB_FILE = CONVERTER_RELATIVE_FOLDER + '/.work/job-1/export/scratch.png'
SHARED_MESSAGE_PREFIX = 'identical lane files shared: '
NOT_SHARED_MESSAGE_PREFIX = 'identical lane files not shared: '
RECORD_OF_ANOTHER_SHAPE = b'[]'
REPLACE_FAILURE_MESSAGE = 'synthetic replace failure'
CONVERSION_REFUSAL_MESSAGE = 'synthetic conversion refusal'
ATTEMPTED_TILE_ID = '10_11'
PRINTED_ITEM_OUTCOMES = [{'key': f'synthetic item unit {number}', 'step': 'items', 'status': 'pass', 'reason': None, 'cacheHit': False}
                         for number in (1, 2)]
PRINTED_ITEM_OUTCOME_LINES = ''.join(json.dumps(outcome, sort_keys=True) + '\n' for outcome in PRINTED_ITEM_OUTCOMES)
ITEM_BATCH_ARGUMENTS = ['--batch', 'items', '--limit', '1']
CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS = ('require_actors_lane_store_output', 'require_reference_client', 'require_batch_preflight',
                                                  'run_at_below_normal_priority', 'Converter')


def write_lane_twins(lane_folder_path):
    return [write_file(lane_folder_path / relative, TWIN) for relative in TWIN_STORE_PATHS]


def write_scratch_job_file(lane_folder_path):
    (lane_folder_path / CONVERTER_RELATIVE_FOLDER / 'index').mkdir(parents=True)
    return write_file(lane_folder_path / SCRATCH_JOB_FILE, TWIN)


def link_counts(paths):
    return [link_count(path) for path in paths]


def record_of_another_shape_refusal(lane_folder_path):
    record_path = write_file(examined_file_record_path(lane_folder_path), RECORD_OF_ANOTHER_SHAPE)
    return (f'examined file record is not a map of file identities to SHA-256 values: {record_path}; '
            'delete it and the next run hashes every file again')


def report_of_the_one_printed_line(test_case, error_output):
    [line] = error_output.splitlines()
    test_case.assertTrue(line.startswith(SHARED_MESSAGE_PREFIX), line)
    report = json.loads(line.removeprefix(SHARED_MESSAGE_PREFIX))
    test_case.assertEqual(error_output, SHARED_MESSAGE_PREFIX + json.dumps(report, sort_keys=True, separators=(',', ':')) + '\n')
    return report


def hold_the_in_use_part_like_a_worker_left_by_a_stopped_batch(test_case, work_root):
    held_lock_files = []
    test_case.addCleanup(lambda: [lock_file.close() for lock_file in held_lock_files])
    with mock.patch.object(interprocess_lock_module, 'lane_lock_files_held_until_process_end', held_lock_files):
        hold_lane_in_use_part_until_process_end(work_root)


def sharing_recorded_while_the_whole_lane_is_held(test_case, work_root, events):
    share = sharing_command.share_identical_lane_files

    def recorded_share(lane_stores_root, lane_names, plan_only, lanes_free_of_conversions):
        with test_case.assertRaises(LaneInUseError):
            hold_lane_in_use_part_until_process_end(work_root)
        with test_case.assertRaises(LaneInUseError):
            with lane_batch_lock(work_root):
                test_case.fail('the lane was granted')
        events.append(('shared', lane_stores_root, lane_names, plan_only, lanes_free_of_conversions, sys.stdout.getvalue()))
        return share(lane_stores_root, lane_names, plan_only, lanes_free_of_conversions)

    return mock.patch.object(sharing_command, 'share_identical_lane_files', recorded_share)


class TileBatchEndSharingTests(TileBatchTestCase):
    eligible_tile_ids = (ATTEMPTED_TILE_ID,)

    def setUp(self):
        super().setUp()
        self.world_lane_folder = lane_folder(self.project_root, 'world')
        self.world_work_root = lane_work_root(self.project_root, 'world')
        self.twin_paths = write_lane_twins(self.world_lane_folder)
        self.scratch_job_file = write_scratch_job_file(self.world_lane_folder)
        self.events = []

    def refreshed_lane_outputs(self, project_root):
        self.events.append('refreshed')
        return {'refreshed': True}

    def run_main(self, preflight=None, project_root=None):
        project_root = project_root or self.project_root
        printed, errors, steps = io.StringIO(), io.StringIO(), LedgerBackedSteps(project_root)
        with (mock.patch.multiple(convert_tile_batch, REPOSITORY_ROOT=project_root, require_reference_client=mock.DEFAULT,
                                  TILE_STEP_SEAL_CHECKS=synthetic_seal_checks(),
                                  world_batch_preflight=lambda preflight_project_root, worker_count: preflight or RecordingPreflight(),
                                  locked_tile_source_identity=synthetic_source_identity, locked_tile_map_bytes=synthetic_expected_cost,
                                  refresh_world_lane_outputs=self.refreshed_lane_outputs,
                                  run_tile_step=lambda step_project_root, step, client, tile_id, store_root: steps(step, tile_id)),
              contextlib.redirect_stdout(printed), contextlib.redirect_stderr(errors)):
            exit_code = convert_tile_batch.main(['--eligible', '--limit', '1'])
        return exit_code, printed.getvalue(), errors.getvalue()

    def assert_the_done_batch_prints_its_summary_and_exits_with_the_error_code(self, expected_error_text):
        exit_code, printed, errors = self.run_main()
        self.assertEqual((exit_code, errors), (BATCH_EXIT_ERROR, NOT_SHARED_MESSAGE_PREFIX + expected_error_text + '\n'))
        summary = json.loads(printed)
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['laneOutputs']),
                         (BATCH_EXIT_DONE, [ATTEMPTED_TILE_ID], {'refreshed': True}))
        self.assertEqual(link_counts(self.twin_paths), [1, 1])

    def test_a_done_tile_batch_shares_the_world_lane_after_the_refresh_with_its_summary_printed_and_the_whole_lane_held(self):
        with sharing_recorded_while_the_whole_lane_is_held(self, self.world_work_root, self.events):
            exit_code, printed, _ = self.run_main()
        self.assertEqual(exit_code, BATCH_EXIT_DONE)
        self.assertEqual(self.events, ['refreshed', ('shared', self.world_lane_folder.parent, ['world'], False, ['world'], printed)])
        self.assertEqual(json.loads(printed)['laneOutputs'], {'refreshed': True})
        self.assertEqual(link_counts(self.twin_paths), [2, 2])
        self.assertFalse(self.scratch_job_file.parents[1].exists())
        with lane_sharing_lock(self.world_work_root):
            pass

    def test_a_tile_batch_stopped_by_a_machine_window_shares_nothing(self):
        exit_code, printed, errors = self.run_main(RecordingPreflight({1: MachineWindowRefusedError('inside nightly backup window')}))
        self.assertEqual((exit_code, errors, self.events), (BATCH_EXIT_MACHINE_WINDOW, '', []))
        self.assertIsNone(json.loads(printed)['laneOutputs'])
        self.assertEqual(link_counts(self.twin_paths), [1, 1])
        self.assertTrue(self.scratch_job_file.is_file())
        self.assertFalse(identical_file_sharing_folder(self.world_lane_folder).exists())

    def test_the_summary_is_unchanged_and_the_pass_prints_one_line_on_standard_error(self):
        project_without_pass = self.project_root.with_name('project-without-pass')
        write_synthetic_tile_census(project_without_pass, self.eligible_tile_ids)
        with mock.patch.object(convert_tile_batch, 'share_identical_files_of_batch_lane', return_value=True) as replaced_pass:
            outcome_without_pass = self.run_main(project_root=project_without_pass)
        exit_code, printed, errors = self.run_main()
        self.assertEqual(replaced_pass.call_count, 1)
        self.assertEqual((outcome_without_pass, exit_code), ((BATCH_EXIT_DONE, printed, ''), BATCH_EXIT_DONE))
        self.assertEqual(json.loads(printed)['attemptedTiles'], [ATTEMPTED_TILE_ID])
        report = report_of_the_one_printed_line(self, errors)
        self.assertEqual((report['lanes'], report['planOnly'], report['sharedNames'], report['sharedBytes'], report['scratchJobFoldersRemoved']),
                         (['world'], False, 1, len(TWIN), 1))

    def test_a_done_tile_batch_whose_pass_raises_an_os_error_of_a_replace_prints_its_summary_and_exits_with_the_error_code(self):
        with mock.patch.object(sharing_command, 'replace_name_by_hard_link', side_effect=OSError(REPLACE_FAILURE_MESSAGE)):
            self.assert_the_done_batch_prints_its_summary_and_exits_with_the_error_code(REPLACE_FAILURE_MESSAGE)

    def test_a_done_tile_batch_whose_pass_reads_a_record_of_another_shape_prints_its_summary_and_exits_with_the_error_code(self):
        self.assert_the_done_batch_prints_its_summary_and_exits_with_the_error_code(record_of_another_shape_refusal(self.world_lane_folder))

    def test_a_done_tile_batch_beside_an_in_use_holder_left_by_a_stopped_batch_prints_its_summary_and_exits_with_the_error_code(self):
        hold_the_in_use_part_like_a_worker_left_by_a_stopped_batch(self, self.world_work_root)
        self.assert_the_done_batch_prints_its_summary_and_exits_with_the_error_code(
            'lane world is in use by a conversion process, which may be a worker left by a stopped batch and this run does not wait for it: '
            f'{lane_lock_file_path(self.world_work_root)}')
        self.assertTrue(self.scratch_job_file.is_file())


class ActorBatchEndSharingTests(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)
        self.actors_lane_folder = self.lanes.lane_folder('actors')
        self.actors_work_root = self.actors_lane_folder / 'work'
        self.twin_paths = write_lane_twins(self.actors_lane_folder)
        self.events = []

    @contextlib.contextmanager
    def coverage_refreshed_at_exit(self, project_root, lane_name):
        yield
        self.events.append('coverage refreshed')

    def run_main(self, mode_arguments, run_item_conversion):
        printed, errors = io.StringIO(), io.StringIO()
        with (mock.patch.multiple(convert_actors, REPOSITORY_ROOT=self.lanes.project,
                                  **dict.fromkeys(CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS, mock.DEFAULT),
                                  lane_coverage_refreshed_at_exit=self.coverage_refreshed_at_exit, run_item_conversion=run_item_conversion),
              contextlib.redirect_stdout(printed), contextlib.redirect_stderr(errors)):
            exit_code = convert_actors.main(['--client', 'client', *mode_arguments])
        return exit_code, printed.getvalue(), errors.getvalue()

    def test_an_actor_batch_shares_the_actors_lane_after_the_coverage_refresh(self):
        with sharing_recorded_while_the_whole_lane_is_held(self, self.actors_work_root, self.events):
            exit_code, printed, errors = self.run_main(ITEM_BATCH_ARGUMENTS, mock.Mock(return_value=PRINTED_ITEM_OUTCOMES))
        self.assertEqual((exit_code, printed), (0, PRINTED_ITEM_OUTCOME_LINES))
        self.assertEqual(self.events, ['coverage refreshed',
                                       ('shared', self.lanes.lane_stores_root, ['actors'], False, ['actors'], PRINTED_ITEM_OUTCOME_LINES)])
        self.assertEqual((report_of_the_one_printed_line(self, errors)['sharedNames'], link_counts(self.twin_paths)), (1, [2, 2]))
        with lane_sharing_lock(self.actors_work_root):
            pass

    def test_an_actor_batch_whose_pass_raises_prints_every_outcome_and_exits_one(self):
        refusal = record_of_another_shape_refusal(self.actors_lane_folder)
        outcome = self.run_main(ITEM_BATCH_ARGUMENTS, mock.Mock(return_value=PRINTED_ITEM_OUTCOMES))
        self.assertEqual(outcome, (1, PRINTED_ITEM_OUTCOME_LINES, NOT_SHARED_MESSAGE_PREFIX + refusal + '\n'))
        self.assertEqual((self.events, link_counts(self.twin_paths)), (['coverage refreshed'], [1, 1]))

    def test_a_single_actor_conversion_and_an_actor_batch_that_raises_share_nothing(self):
        single_conversion_outcome = self.run_main(['--item', '1'], mock.Mock(return_value=PRINTED_ITEM_OUTCOMES))
        raising_batch_outcome = self.run_main(ITEM_BATCH_ARGUMENTS, mock.Mock(side_effect=ValueError(CONVERSION_REFUSAL_MESSAGE)))
        self.assertEqual((single_conversion_outcome, raising_batch_outcome),
                         ((0, PRINTED_ITEM_OUTCOME_LINES, ''), (1, '', f'Actor conversion failed: {CONVERSION_REFUSAL_MESSAGE}\n')))
        self.assertEqual((self.events, link_counts(self.twin_paths)), (['coverage refreshed'], [1, 1]))
        self.assertFalse(identical_file_sharing_folder(self.actors_lane_folder).exists())


class BatchLanePassTests(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)
        self.twin_paths_by_lane_name = {lane_name: write_lane_twins(self.lanes.lane_folder(lane_name))
                                        for lane_name in ('actors', 'integration', 'world')}

    def pass_outcome(self, lane_name):
        errors = io.StringIO()
        with (lane_batch_lock(self.lanes.lane_folder(lane_name) / 'work') as held_lane_lock, contextlib.redirect_stderr(errors),
              mock.patch.object(identical_file_sharing, 'sha256_of_file_with_identity',
                                wraps=identical_file_sharing.sha256_of_file_with_identity) as hashed):
            lane_was_shared = share_identical_files_of_batch_lane(self.lanes.project, lane_name, held_lane_lock)
        report = report_of_the_one_printed_line(self, errors.getvalue())
        return lane_was_shared, hashed.call_count, report['filesHashed'], report['sharedNames']

    def test_a_second_pass_hashes_nothing_and_changes_nothing(self):
        self.assertEqual(self.pass_outcome('world'), (True, 2, 2, 1))
        snapshot = snapshot_of_every_entry(self.lanes.project)
        self.assertEqual(self.pass_outcome('world'), (True, 0, 0, 0))
        self.assertEqual(snapshot_of_every_entry(self.lanes.project), snapshot)

    def test_the_pass_of_one_lane_leaves_the_other_lanes_untouched(self):
        write_scratch_job_file(self.lanes.lane_folder('actors'))
        other_lane_folders = [self.lanes.lane_folder(lane_name) for lane_name in ('actors', 'integration')]
        snapshots = [snapshot_of_every_entry(folder) for folder in other_lane_folders]
        self.assertEqual(self.pass_outcome('world'), (True, 2, 2, 1))
        self.assertEqual([snapshot_of_every_entry(folder) for folder in other_lane_folders], snapshots)
        self.assertEqual({lane_name: link_counts(paths) for lane_name, paths in self.twin_paths_by_lane_name.items()},
                         {'actors': [1, 1], 'integration': [1, 1], 'world': [2, 2]})


if __name__ == '__main__':
    unittest.main()
