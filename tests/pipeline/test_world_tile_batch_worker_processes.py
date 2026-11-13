import filecmp
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import NamedTuple
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_gap_rows_folder
from support.tile_step_worker_runs import (FOUR_SEPARATE_TILE_IDS, RAW_FAILED_ONCE_MESSAGE, SEPARATE_TILE_IDS, SYNTHETIC_FLOOR_REFUSAL_MESSAGE,
                                           TWO_COSTLIEST_OF_FOUR_TILE_IDS)
from test_convert_tile_batch import SYNTHETIC_STEP_NAMES
from world.tile_step_workers import BATCH_EXIT_DISK_FLOOR, BATCH_EXIT_DONE, BATCH_EXIT_ERROR, WORKER_DIED_MESSAGE

TILE_BATCH_PROGRAM = '\n'.join([
    'import sys',
    'sys.path[:0] = sys.argv[1:3]',
    'from support.tile_step_worker_runs import print_tile_batch_report',
    'print_tile_batch_report(sys.argv[3:])',
])
TILE_BATCH_TIMEOUT_SECONDS = 240
WORKER_COUNTS = (1, 2)
FIRST_TILE_ID, SECOND_TILE_ID, THIRD_TILE_ID = SEPARATE_TILE_IDS
OWNER_TILE_ID = '10_11'
ROW_NEIGHBOUR_TILE_ID = '10_12'
NEIGHBOURS_THAT_ARE_NOT_SELECTED = ('11_11', '11_12')
PASS_ROW = ('pass', None)
BATCH_PENDING_ROW = ('pending', 'batch-pending')
RAW_FAILED_ROW = ('failed', f'decode-failed:OSError:{RAW_FAILED_ONCE_MESSAGE}')
CHUNKS_FAILED_ROW = ('failed', 'decode-failed:ValueError:synthetic decode failure')
CLOCK_AND_FREE_BYTE_FIELDS = ('rigaTime', 'freeBytes')
STEPS_SEALED_BEFORE_THE_STOP = ['raw', 'chunks']
TWO_CHEAPEST_OF_FOUR_TILE_IDS = FOUR_SEPARATE_TILE_IDS[:2]


class ScenarioRun(NamedTuple):
    project_root: Path
    stdout: str
    report: dict


def scenario_run(temporary_root, scenario_name, worker_count):
    project_root = temporary_root / f'{scenario_name}-with-{worker_count}-workers' / 'project'
    completed = subprocess.run([sys.executable, '-B', '-c', TILE_BATCH_PROGRAM, str(ROOT / 'scripts'), str(ROOT / 'tests' / 'pipeline'),
                                scenario_name, str(project_root), str(worker_count)],
                               capture_output=True, text=True, check=False, timeout=TILE_BATCH_TIMEOUT_SECONDS)
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return ScenarioRun(project_root, completed.stdout, json.loads(completed.stdout))


def gap_row_file_names(project_root):
    return sorted(path.name for path in lane_gap_rows_folder(project_root, 'world').glob('*.json'))


def tile_step_rows(project_root, tile_id):
    rows = {(row['key'], row['step']): (row['status'], row['reason']) for row in read_gap_rows(project_root, 'world')}
    return [rows[(f'tile:{tile_id}', step)] for step in SYNTHETIC_STEP_NAMES]


def called_steps_of_tile(report, tile_id):
    return sorted(record['step'] for record in report['stepCalls'] if record['tile'] == tile_id)


def calls_recorded_before_the_chunks_call_of_each_tile(report):
    return {record['tile']: record['callsRecordedBefore'] for record in report['stepCalls'] if record['step'] == 'chunks'}


def summary_without_clock_and_free_bytes(report):
    preflights = [{name: value for name, value in record.items() if name not in CLOCK_AND_FREE_BYTE_FIELDS}
                  for record in report['summary']['preflights']]
    return {**report['summary'], 'preflights': preflights}


class TileBatchWorkerProcessTestCase(unittest.TestCase):
    def temporary_root(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        return Path(temporary_directory.name).resolve()

    def assert_two_workers_gave_the_outcome_of_one_worker(self, one_worker_run, two_worker_run):
        file_names = gap_row_file_names(one_worker_run.project_root)
        self.assertEqual(file_names, sorted(f'{step}.json' for step in SYNTHETIC_STEP_NAMES))
        self.assertEqual(gap_row_file_names(two_worker_run.project_root), file_names)
        self.assertEqual(filecmp.cmpfiles(lane_gap_rows_folder(one_worker_run.project_root, 'world'),
                                          lane_gap_rows_folder(two_worker_run.project_root, 'world'), file_names, shallow=False),
                         (file_names, [], []))
        self.assertEqual(two_worker_run.report['summary']['attemptedTiles'], one_worker_run.report['summary']['attemptedTiles'])
        self.assertEqual(summary_without_clock_and_free_bytes(two_worker_run.report), summary_without_clock_and_free_bytes(one_worker_run.report))

    def compared_scenario_runs(self, scenario_name):
        temporary_root = self.temporary_root()
        one_worker_run, two_worker_run = (scenario_run(temporary_root, scenario_name, worker_count) for worker_count in WORKER_COUNTS)
        self.assert_two_workers_gave_the_outcome_of_one_worker(one_worker_run, two_worker_run)
        return one_worker_run, two_worker_run


class PlainTileBatchWorkerProcessTests(TileBatchWorkerProcessTestCase):
    @classmethod
    def setUpClass(cls):
        temporary_directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        cls.one_worker_run, cls.two_worker_run = (scenario_run(temporary_root, 'plain', worker_count) for worker_count in WORKER_COUNTS)

    def test_two_workers_give_the_rows_the_attempted_tiles_and_the_summary_of_one_worker(self):
        self.assert_two_workers_gave_the_outcome_of_one_worker(self.one_worker_run, self.two_worker_run)
        summary = self.two_worker_run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']), (BATCH_EXIT_DONE, list(SEPARATE_TILE_IDS), None))
        self.assertEqual(summary['rowStatusCounts'], {'pass': len(SEPARATE_TILE_IDS) * len(SYNTHETIC_STEP_NAMES)})
        self.assertEqual([(record['tile'], record['step']) for record in summary['preflights']],
                         [(tile_id, step) for tile_id in SEPARATE_TILE_IDS for step in SYNTHETIC_STEP_NAMES])

    def test_the_other_steps_run_in_worker_processes_and_every_manifest_in_the_coordinator_in_tile_order(self):
        report = self.two_worker_run.report
        coordinator_process_id = report['coordinatorProcessId']
        worker_process_ids = {record['processId'] for record in report['stepCalls'] if record['step'] != 'manifest'}
        self.assertEqual(len(report['stepCalls']), len(SEPARATE_TILE_IDS) * len(SYNTHETIC_STEP_NAMES))
        self.assertEqual([(record['tile'], record['processId']) for record in report['stepCalls'] if record['step'] == 'manifest'],
                         [(tile_id, coordinator_process_id) for tile_id in SEPARATE_TILE_IDS])
        self.assertNotIn(coordinator_process_id, worker_process_ids)
        self.assertIn(len(worker_process_ids), WORKER_COUNTS)
        one_worker_report = self.one_worker_run.report
        self.assertEqual({record['processId'] for record in one_worker_report['stepCalls']}, {one_worker_report['coordinatorProcessId']})

    def test_worker_processes_print_nothing_to_stdout(self):
        stdout = self.two_worker_run.stdout
        self.assertEqual(stdout, json.dumps(self.two_worker_run.report) + '\n')
        self.assertEqual(len(stdout.splitlines()), 1)


class OneWorkerAgainstTwoWorkersTests(TileBatchWorkerProcessTestCase):
    def test_two_workers_give_the_same_outcome_when_one_tile_fails_a_step(self):
        _, two_worker_run = self.compared_scenario_runs('one-tile-fails-a-step')
        summary = two_worker_run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles']), (BATCH_EXIT_DONE, list(SEPARATE_TILE_IDS)))
        self.assertEqual(tile_step_rows(two_worker_run.project_root, SECOND_TILE_ID),
                         [PASS_ROW, CHUNKS_FAILED_ROW, ('pending', 'upstream-step-failed:chunks'), PASS_ROW])
        self.assertEqual(tile_step_rows(two_worker_run.project_root, THIRD_TILE_ID), [PASS_ROW] * len(SYNTHETIC_STEP_NAMES))

    def test_two_workers_give_the_same_outcome_when_a_preflight_refuses_on_the_second_tile(self):
        _, two_worker_run = self.compared_scenario_runs('preflight-refuses-on-the-second-tile')
        summary = two_worker_run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']),
                         (BATCH_EXIT_DISK_FLOOR, [FIRST_TILE_ID, SECOND_TILE_ID],
                          {'exit_code': BATCH_EXIT_DISK_FLOOR, 'tile_id': SECOND_TILE_ID, 'step': 'meshes', 'message': SYNTHETIC_FLOOR_REFUSAL_MESSAGE}))
        self.assertEqual(tile_step_rows(two_worker_run.project_root, FIRST_TILE_ID), [PASS_ROW] * len(SYNTHETIC_STEP_NAMES))
        self.assertEqual(tile_step_rows(two_worker_run.project_root, SECOND_TILE_ID), [PASS_ROW, PASS_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW])
        self.assertEqual(tile_step_rows(two_worker_run.project_root, THIRD_TILE_ID), [BATCH_PENDING_ROW] * len(SYNTHETIC_STEP_NAMES))

    def test_two_workers_give_the_same_outcome_with_seam_neighbours_that_are_not_selected(self):
        runs = self.compared_scenario_runs('seam-neighbours-that-are-not-selected')
        for run in runs:
            self.assertEqual(run.report['summary']['attemptedTiles'], [OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID])
            for tile_id in NEIGHBOURS_THAT_ARE_NOT_SELECTED:
                self.assertEqual(called_steps_of_tile(run.report, tile_id), ['raw'])
                self.assertEqual(tile_step_rows(run.project_root, tile_id), [PASS_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW])

    def test_two_workers_give_the_same_outcome_when_the_raw_step_of_a_selected_seam_neighbour_fails_once_in_phase_a(self):
        runs = self.compared_scenario_runs('raw-fails-once')
        for run in runs:
            self.assertEqual(run.report['summary']['attemptedTiles'], [OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID])
            self.assertEqual(called_steps_of_tile(run.report, ROW_NEIGHBOUR_TILE_ID), ['manifest', 'raw'])
            self.assertEqual(run.report['tilesWithARawSeal'], [OWNER_TILE_ID])
            self.assertEqual(tile_step_rows(run.project_root, ROW_NEIGHBOUR_TILE_ID),
                             [RAW_FAILED_ROW, ('pending', 'upstream-step-failed:raw'), ('pending', 'upstream-step-failed:raw'), PASS_ROW])


class TwoWorkerStopTests(TileBatchWorkerProcessTestCase):
    def test_with_two_workers_a_tile_that_is_running_when_an_earlier_tile_is_refused_ends_before_its_next_preflight(self):
        run = scenario_run(self.temporary_root(), 'later-tile-running-at-the-refusal', 2)
        summary = run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']),
                         (BATCH_EXIT_DISK_FLOOR, list(SEPARATE_TILE_IDS),
                          {'exit_code': BATCH_EXIT_DISK_FLOOR, 'tile_id': SECOND_TILE_ID, 'step': 'meshes', 'message': SYNTHETIC_FLOOR_REFUSAL_MESSAGE}))
        self.assertEqual(tile_step_rows(run.project_root, FIRST_TILE_ID), [PASS_ROW] * len(SYNTHETIC_STEP_NAMES))
        for tile_id in (SECOND_TILE_ID, THIRD_TILE_ID):
            self.assertEqual(tile_step_rows(run.project_root, tile_id), [PASS_ROW, PASS_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW])
            self.assertEqual(called_steps_of_tile(run.report, tile_id), sorted(STEPS_SEALED_BEFORE_THE_STOP))
        self.assertEqual([record['step'] for record in summary['preflights'] if record['tile'] == THIRD_TILE_ID], STEPS_SEALED_BEFORE_THE_STOP)

    def test_a_worker_that_dies_ends_the_batch_with_exit_code_one_after_the_rows_of_the_finished_tiles_are_written(self):
        run = scenario_run(self.temporary_root(), 'worker-dies', 2)
        summary = run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']),
                         (BATCH_EXIT_ERROR, [FIRST_TILE_ID],
                          {'exit_code': BATCH_EXIT_ERROR, 'tile_id': SECOND_TILE_ID, 'step': None, 'message': WORKER_DIED_MESSAGE}))
        self.assertEqual(BATCH_EXIT_ERROR, 1)
        self.assertEqual(tile_step_rows(run.project_root, FIRST_TILE_ID), [PASS_ROW] * len(SYNTHETIC_STEP_NAMES))
        self.assertEqual(tile_step_rows(run.project_root, SECOND_TILE_ID), [PASS_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW])
        self.assertEqual(tile_step_rows(run.project_root, THIRD_TILE_ID), [BATCH_PENDING_ROW] * len(SYNTHETIC_STEP_NAMES))


class HeavyTilesFirstWorkerProcessTests(TileBatchWorkerProcessTestCase):
    @classmethod
    def setUpClass(cls):
        temporary_directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        cls.one_worker_run, cls.two_worker_run = (scenario_run(temporary_root, 'costliest-tiles-last', worker_count)
                                                  for worker_count in WORKER_COUNTS)

    def test_two_workers_start_the_costliest_tiles_first_and_give_the_outcome_of_one_worker(self):
        self.assert_two_workers_gave_the_outcome_of_one_worker(self.one_worker_run, self.two_worker_run)
        report = self.two_worker_run.report
        summary = report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']), (BATCH_EXIT_DONE, list(FOUR_SEPARATE_TILE_IDS), None))
        calls_recorded_before = calls_recorded_before_the_chunks_call_of_each_tile(report)
        for cheap_tile_id in TWO_CHEAPEST_OF_FOUR_TILE_IDS:
            for costly_tile_id in TWO_COSTLIEST_OF_FOUR_TILE_IDS:
                self.assertIn([costly_tile_id, 'chunks'], calls_recorded_before[cheap_tile_id], cheap_tile_id)
        self.assertEqual([(record['tile'], record['processId']) for record in report['stepCalls'] if record['step'] == 'manifest'],
                         [(tile_id, report['coordinatorProcessId']) for tile_id in FOUR_SEPARATE_TILE_IDS])

    def test_one_worker_runs_the_tiles_in_tile_order_when_the_costliest_tiles_are_last(self):
        report = self.one_worker_run.report
        self.assertEqual({record['processId'] for record in report['stepCalls']}, {report['coordinatorProcessId']})
        self.assertEqual([(record['tile'], record['step']) for record in report['stepCalls']],
                         [*((tile_id, 'raw') for tile_id in FOUR_SEPARATE_TILE_IDS),
                          *((tile_id, step) for tile_id in FOUR_SEPARATE_TILE_IDS for step in SYNTHETIC_STEP_NAMES[1:])])

    def test_the_stop_of_the_first_tile_is_reported_when_a_costlier_later_tile_stopped_first(self):
        run = scenario_run(self.temporary_root(), 'first-tile-stops-after-the-costliest-last-tile', 2)
        summary = run.report['summary']
        self.assertEqual((summary['exitCode'], summary['attemptedTiles'], summary['stop']),
                         (BATCH_EXIT_DISK_FLOOR, list(SEPARATE_TILE_IDS),
                          {'exit_code': BATCH_EXIT_DISK_FLOOR, 'tile_id': FIRST_TILE_ID, 'step': 'meshes', 'message': SYNTHETIC_FLOOR_REFUSAL_MESSAGE}))
        self.assertIn([THIRD_TILE_ID, 'chunks'], calls_recorded_before_the_chunks_call_of_each_tile(run.report)[FIRST_TILE_ID])
        for tile_id in SEPARATE_TILE_IDS:
            self.assertEqual(tile_step_rows(run.project_root, tile_id), [PASS_ROW, PASS_ROW, BATCH_PENDING_ROW, BATCH_PENDING_ROW])
            self.assertEqual(called_steps_of_tile(run.report, tile_id), sorted(STEPS_SEALED_BEFORE_THE_STOP))


if __name__ == '__main__':
    unittest.main()
