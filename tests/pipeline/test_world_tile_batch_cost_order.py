from concurrent.futures import Future
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS
from reference_client_lock_fixture import use_reference_client_lock
from test_convert_tile_batch import (SYNTHETIC_STEP_NAMES, LedgerBackedSteps, RecordingPreflight, TileBatchTestCase, synthetic_seal_checks,
                                     synthetic_source_identity)
from test_world_tile_batch_phases import PoolBrokenAtTheSecondSubmit
from world import tile_step_workers
from world.convert_tile_batch import run_tile_batch
from world.raw_map_step import RawMapStepError, locked_tile_map_bytes, tile_map_path
from world.tile_step_workers import (BATCH_EXIT_DONE, BATCH_EXIT_ERROR, WORKER_DIED_MESSAGE, TileBatchStop, TileStepRun, TileStepsOutcome,
                                     TileStepsTask, TileStepWorkers)

FIRST_TILE_ID, SECOND_TILE_ID, THIRD_TILE_ID = TileBatchTestCase.eligible_tile_ids
FOUR_TILE_IDS = (*TileBatchTestCase.eligible_tile_ids, '16_17')
ASCENDING_EXPECTED_COSTS = {FIRST_TILE_ID: 5, SECOND_TILE_ID: 7, THIRD_TILE_ID: 9}
STEPS_AFTER_RAW = SYNTHETIC_STEP_NAMES[1:]
WORKER_STEP_NAMES = SYNTHETIC_STEP_NAMES[1:-1]
LOCKED_MAP_SHA256 = 'c' * 64
LOCKED_MAP_IMPORTA_BYTES = 111
LOCKED_MAP_BYTES = 222
MAP_BYTES_THAT_ARE_NO_WHOLE_NUMBER = (-1, 2.5, None, False, '222222', [222, 222])


def outcome_of_position(position):
    return TileStepsOutcome(True, {'position': position}, None, [])


def tasks_with_expected_costs(expected_costs):
    return [TileStepsTask(position, tile_id, synthetic_source_identity(tile_id), ('chunks',), None, expected_cost)
            for position, (tile_id, expected_cost) in enumerate(zip(FOUR_TILE_IDS, expected_costs))]


class RecordingPool:
    def __init__(self, **pool_arguments):
        self.submitted_tasks = []

    def submit(self, function, task):
        self.submitted_tasks.append(task)
        future = Future()
        future.set_result(outcome_of_position(task.position))
        return future

    def shutdown(self, wait, cancel_futures):
        self.submitted_tasks.clear()


class PoolRunningInThisProcess:
    def __init__(self, max_workers, initializer, initargs):
        self.submitted_tasks = []
        initializer(*initargs)

    def submit(self, function, task):
        self.submitted_tasks.append(task)
        future = Future()
        future.set_result(function(task))
        return future

    def shutdown(self, wait, cancel_futures):
        pass


class PoolSubmissionOrderTests(unittest.TestCase):
    def submitted_positions_and_outcomes(self, tasks, pool_type=RecordingPool):
        with patch.object(tile_step_workers, 'ProcessPoolExecutor', pool_type):
            workers = TileStepWorkers(2, None, TileStepRun, ())
            outcomes = list(workers.outcomes(tasks))
            submitted_positions = [task.position for task in workers.executor.submitted_tasks]
            workers.close()
        return submitted_positions, outcomes

    def test_the_pool_is_given_the_tasks_in_descending_expected_cost(self):
        submitted_positions, _ = self.submitted_positions_and_outcomes(tasks_with_expected_costs((10, 30, 20, 40)))
        self.assertEqual(submitted_positions, [3, 1, 2, 0])

    def test_tasks_of_equal_expected_cost_are_given_to_the_pool_in_task_order(self):
        submitted_positions, _ = self.submitted_positions_and_outcomes(tasks_with_expected_costs((1, 3, 3, 2)))
        self.assertEqual(submitted_positions, [1, 2, 3, 0])

    def test_the_outcomes_of_a_cost_ordered_pool_are_yielded_in_task_order(self):
        tasks = tasks_with_expected_costs((10, 30, 20, 40))
        _, outcomes = self.submitted_positions_and_outcomes(tasks)
        self.assertEqual(outcomes, [outcome_of_position(task.position) for task in tasks])

    def test_a_pool_that_breaks_while_cost_ordered_tasks_are_submitted_gives_the_worker_died_outcome_for_every_task_without_a_future(self):
        tasks = tasks_with_expected_costs((1, 2, 3, 4))
        submitted_positions, outcomes = self.submitted_positions_and_outcomes(tasks, PoolBrokenAtTheSecondSubmit)
        self.assertEqual(submitted_positions, [3])
        self.assertEqual(outcomes, [*(TileStepsOutcome(False, {}, TileBatchStop(BATCH_EXIT_ERROR, task.tile_id, None, WORKER_DIED_MESSAGE), [])
                                      for task in tasks[:3]), PoolBrokenAtTheSecondSubmit.first_outcome])


class TileBatchExpectedCostTests(TileBatchTestCase):
    def test_one_worker_runs_the_tasks_in_task_order_whatever_their_expected_costs(self):
        steps = LedgerBackedSteps(self.project_root)
        with patch.object(tile_step_workers, 'ProcessPoolExecutor', side_effect=AssertionError('no process pool may be built')):
            outcome = self.run_batch(steps, limit=3, tile_expected_cost=ASCENDING_EXPECTED_COSTS.__getitem__)
        self.assertEqual((outcome.exit_code, outcome.attempted_tile_ids), (BATCH_EXIT_DONE, list(self.eligible_tile_ids)))
        self.assertEqual(steps.calls, [*((tile_id, 'raw') for tile_id in self.eligible_tile_ids),
                                       *((tile_id, step) for tile_id in self.eligible_tile_ids for step in STEPS_AFTER_RAW)])

    def test_the_batch_gives_each_task_of_both_phases_the_expected_cost_of_its_tile(self):
        steps, pools = LedgerBackedSteps(self.project_root), []
        costs_of_the_two_selected_tiles = {tile_id: ASCENDING_EXPECTED_COSTS[tile_id] for tile_id in (FIRST_TILE_ID, SECOND_TILE_ID)}

        def pool_running_in_this_process(**pool_arguments):
            pools.append(PoolRunningInThisProcess(**pool_arguments))
            return pools[-1]

        with (patch.object(tile_step_workers, 'ProcessPoolExecutor', pool_running_in_this_process),
              patch.object(tile_step_workers, 'tile_step_worker', None)):
            outcome = run_tile_batch(2, 2, TileStepRun, (self.project_root, steps, RecordingPreflight(), synthetic_seal_checks()),
                                     step_names=SYNTHETIC_STEP_NAMES, tile_source_identity=synthetic_source_identity,
                                     tile_expected_cost=costs_of_the_two_selected_tiles.__getitem__)
        self.assertEqual((outcome.exit_code, outcome.attempted_tile_ids), (BATCH_EXIT_DONE, [FIRST_TILE_ID, SECOND_TILE_ID]))
        [pool] = pools
        self.assertEqual([(task.position, task.tile_id, task.step_names, task.expected_cost) for task in pool.submitted_tasks],
                         [(position, tile_id, step_names, costs_of_the_two_selected_tiles[tile_id])
                          for step_names in (('raw',), WORKER_STEP_NAMES) for position, tile_id in ((1, SECOND_TILE_ID), (0, FIRST_TILE_ID))])
        self.assertEqual([record['tile'] for record in outcome.preflights],
                         [tile_id for tile_id in (FIRST_TILE_ID, SECOND_TILE_ID) for _ in SYNTHETIC_STEP_NAMES])


class LockedTileMapBytesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.lock_path = Path(temporary_directory.name).resolve() / 'reference-client-tree.lock.json'
        use_reference_client_lock(self, self.lock_path)

    def write_lock_with_map_bytes(self, map_bytes):
        self.lock_path.write_text(json.dumps({
            'schemaVersion': 1, 'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client', 'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
            'files': {tile_map_path(FIRST_TILE_ID): ['equal', LOCKED_MAP_IMPORTA_BYTES, LOCKED_MAP_SHA256, map_bytes, LOCKED_MAP_SHA256, 1]}}),
            encoding='utf-8')

    def test_the_expected_cost_of_a_tile_is_the_byte_size_of_its_map_in_the_reference_client_lock(self):
        self.write_lock_with_map_bytes(LOCKED_MAP_BYTES)
        self.assertEqual(locked_tile_map_bytes(FIRST_TILE_ID), LOCKED_MAP_BYTES)
        with self.assertRaisesRegex(RawMapStepError, f'^reference client lock has no record for {tile_map_path(SECOND_TILE_ID)}$'):
            locked_tile_map_bytes(SECOND_TILE_ID)

    def test_a_lock_record_whose_byte_size_is_not_a_whole_number_is_refused(self):
        lock_sizes = set()
        for map_bytes in MAP_BYTES_THAT_ARE_NO_WHOLE_NUMBER:
            with self.subTest(map_bytes=map_bytes):
                self.write_lock_with_map_bytes(map_bytes)
                lock_sizes.add(self.lock_path.stat().st_size)
                with self.assertRaises(RawMapStepError) as refusal:
                    locked_tile_map_bytes(FIRST_TILE_ID)
                self.assertEqual(str(refusal.exception),
                                 f'reference client lock holds no whole byte size for {tile_map_path(FIRST_TILE_ID)}: {map_bytes!r}')
        self.assertEqual(len(lock_sizes), len(MAP_BYTES_THAT_ARE_NO_WHOLE_NUMBER))


if __name__ == '__main__':
    unittest.main()
