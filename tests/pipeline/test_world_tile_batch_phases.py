import ast
from concurrent.futures import Future
from concurrent.futures.process import BrokenProcessPool
import contextlib
import io
import json
import multiprocessing
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_store.gap_rows import sorted_gap_rows, write_gap_rows
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, FreeDiskFloorRefusedError
from test_convert_tile_batch import (SYNTHETIC_LAYOUT_GAP_REASON, SYNTHETIC_STEP_NAMES, LedgerBackedSteps, RecordingPreflight, TileBatchTestCase,
                                     synthetic_seal_checks, synthetic_source_identity, synthetic_step_ledger, synthetic_unit_fingerprint)
from world import convert_tile_batch, tile_step_workers
from world.raw_map_step import tile_step_row
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH
from world.tile_step_registry import source_tile_step_runners
from world.tile_step_workers import (BATCH_EXIT_DISK_FLOOR, BATCH_EXIT_DONE, BATCH_EXIT_ERROR, NO_STOPPED_POSITION, WORKER_DIED_MESSAGE,
                                     TileBatchStop, TileStepRun, TileStepsOutcome, TileStepsTask, TileStepWorkers, ordered_tile_steps_outcome)

OWNER_TILE_ID = '10_11'
ROW_NEIGHBOUR_TILE_ID = '10_12'
COLUMN_NEIGHBOUR_TILE_ID = '11_11'
CORNER_NEIGHBOUR_TILE_ID = '11_12'
LONE_TILE_ID = '14_15'
SEAM_NEIGHBOUR_TILE_IDS = (ROW_NEIGHBOUR_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID, CORNER_NEIGHBOUR_TILE_ID)
SEAM_INPUT_TILE_IDS = (OWNER_TILE_ID, *SEAM_NEIGHBOUR_TILE_IDS)
STEPS_AFTER_RAW = SYNTHETIC_STEP_NAMES[1:]
SYNTHETIC_FAILURE_REASON = 'decode-failed:ValueError:synthetic decode failure'
TILE_HAS_WORK_CALL = 'tile-has-work'
LANE_CATALOG_NAMES = {'read_store_catalog', 'write_store'}
MANIFEST_MODULE_NAME = 'world.tile_manifest_step'
WORLD_PACKAGE_PREFIX = 'world.'
ONE_GIBIBYTE = 1024 ** 3


class RawFailingOnceSteps(LedgerBackedSteps):
    def __call__(self, step, tile_id):
        try:
            return super().__call__(step, tile_id)
        finally:
            self.failing.discard((tile_id, step))


class PoolBrokenAtTheSecondSubmit:
    first_outcome = TileStepsOutcome(True, {}, None, [])

    def __init__(self, **pool_arguments):
        self.submitted_tasks = []

    def submit(self, function, task):
        if self.submitted_tasks:
            raise BrokenProcessPool('a worker process ended while the tasks were submitted')
        self.submitted_tasks.append(task)
        future = Future()
        future.set_result(self.first_outcome)
        return future

    def shutdown(self, wait, cancel_futures):
        self.submitted_tasks.clear()


def raw_is_sealed(project_root, tile_id):
    ledger = synthetic_step_ledger(project_root, 'raw')
    return ledger.is_sealed(f'tile:{tile_id}', synthetic_unit_fingerprint(ledger, f'tile:{tile_id}'))


def imported_world_module_names(module_name):
    tree = ast.parse((ROOT / 'scripts' / Path(*module_name.split('.'))).with_suffix('.py').read_text(encoding='utf-8'))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module == 'world':
            names.update(f'{WORLD_PACKAGE_PREFIX}{alias.name}' for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            names.add(node.module)
    return {name for name in names if name.startswith(WORLD_PACKAGE_PREFIX)}


def world_import_closure(module_names):
    closure, waiting = set(), list(module_names)
    while waiting:
        module_name = waiting.pop()
        if module_name not in closure:
            closure.add(module_name)
            waiting.extend(imported_world_module_names(module_name))
    return closure


def names_used_by_module(module_name):
    tree = ast.parse((ROOT / 'scripts' / Path(*module_name.split('.'))).with_suffix('.py').read_text(encoding='utf-8'))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
        elif isinstance(node, ast.alias):
            names.update({node.name, node.asname})
    return names


class TileBatchPhaseTestCase(TileBatchTestCase):
    eligible_tile_ids = (OWNER_TILE_ID, *SEAM_NEIGHBOUR_TILE_IDS, LONE_TILE_ID)

    def record_rows(self, step, statuses_and_reasons_by_tile):
        write_gap_rows(self.project_root, 'world', step, sorted_gap_rows([
            tile_step_row(tile_id, step, status, reason, synthetic_source_identity(tile_id), TILE_CENSUS_RELATIVE_PATH)
            for tile_id, (status, reason) in statuses_and_reasons_by_tile.items()]))

    def run_main(self, arguments, steps, preflight):
        printed, errors, preflight_worker_counts = io.StringIO(), io.StringIO(), []

        def preflight_of_worker_count(project_root, worker_count):
            preflight_worker_counts.append(worker_count)
            return preflight

        with (patch.object(convert_tile_batch, 'REPOSITORY_ROOT', self.project_root),
              patch.object(convert_tile_batch, 'require_reference_client'),
              patch.object(convert_tile_batch, 'TILE_STEP_SEAL_CHECKS', synthetic_seal_checks()),
              patch.object(convert_tile_batch, 'world_batch_preflight', preflight_of_worker_count),
              patch.object(convert_tile_batch, 'locked_tile_source_identity', synthetic_source_identity),
              patch.object(convert_tile_batch, 'refresh_world_lane_outputs', lambda project_root: {'refreshed': True}),
              patch.object(convert_tile_batch, 'run_tile_step', lambda project_root, step, client, tile_id, store_root: steps(step, tile_id)),
              patch.object(tile_step_workers, 'ProcessPoolExecutor', side_effect=AssertionError('no process pool may be built')),
              contextlib.redirect_stdout(printed), contextlib.redirect_stderr(errors)):
            exit_code = convert_tile_batch.main(arguments)
        return exit_code, printed.getvalue(), errors.getvalue(), preflight_worker_counts


class SeamInputPhaseTests(TileBatchPhaseTestCase):
    def test_the_first_limit_tiles_with_work_are_selected_in_census_order_before_any_step_runs(self):
        steps = LedgerBackedSteps(self.project_root)
        for step in SYNTHETIC_STEP_NAMES:
            steps(step, OWNER_TILE_ID)
        steps.calls.clear()
        tile_has_work = convert_tile_batch.tile_has_work

        def recorded_tile_has_work(project_root, tile_id, *selection_arguments):
            steps.calls.append((tile_id, TILE_HAS_WORK_CALL))
            return tile_has_work(project_root, tile_id, *selection_arguments)

        with patch.object(convert_tile_batch, 'tile_has_work', recorded_tile_has_work):
            outcome = self.run_batch(steps, limit=2)
        self.assertEqual(outcome.attempted_tile_ids, [ROW_NEIGHBOUR_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID])
        call_names = [step for _, step in steps.calls]
        first_step_call = call_names.index('raw')
        self.assertIn(TILE_HAS_WORK_CALL, call_names[:first_step_call])
        self.assertNotIn(TILE_HAS_WORK_CALL, call_names[first_step_call:])

    def test_phase_a_runs_raw_once_for_each_selected_tile_and_each_eligible_seam_neighbour_before_any_other_step(self):
        steps = LedgerBackedSteps(self.project_root)
        outcome = self.run_batch(steps)
        self.assertEqual(outcome.attempted_tile_ids, [OWNER_TILE_ID])
        self.assertEqual(steps.calls, [*((tile_id, 'raw') for tile_id in SEAM_INPUT_TILE_IDS), *((OWNER_TILE_ID, step) for step in STEPS_AFTER_RAW)])

    def test_phase_a_skips_a_neighbour_whose_raw_seal_is_current(self):
        steps = LedgerBackedSteps(self.project_root)
        steps('raw', ROW_NEIGHBOUR_TILE_ID)
        steps.calls.clear()
        self.run_batch(steps)
        self.assertEqual([tile_id for tile_id, step in steps.calls if step == 'raw'],
                         [OWNER_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID, CORNER_NEIGHBOUR_TILE_ID])

    def test_phase_a_skips_a_neighbour_whose_recorded_raw_row_is_a_settled_failure_or_gap(self):
        settled_raw_rows = {ROW_NEIGHBOUR_TILE_ID: ('failed', SYNTHETIC_FAILURE_REASON), COLUMN_NEIGHBOUR_TILE_ID: ('gap', SYNTHETIC_LAYOUT_GAP_REASON)}
        self.record_rows('raw', settled_raw_rows)
        steps = LedgerBackedSteps(self.project_root)
        self.run_batch(steps)
        self.assertEqual([tile_id for tile_id, step in steps.calls if step == 'raw'], [OWNER_TILE_ID, CORNER_NEIGHBOUR_TILE_ID])
        rows = self.rows_by_tile_and_step()
        self.assertEqual({tile_id: (rows[(f'tile:{tile_id}', 'raw')]['status'], rows[(f'tile:{tile_id}', 'raw')]['reason'])
                          for tile_id in settled_raw_rows}, settled_raw_rows)

    def test_a_neighbour_that_is_not_selected_is_not_attempted_and_no_row_it_returns_is_recorded(self):
        steps = LedgerBackedSteps(self.project_root, failing={(ROW_NEIGHBOUR_TILE_ID, 'raw')})
        outcome = self.run_batch(steps)
        self.assertEqual(outcome.attempted_tile_ids, [OWNER_TILE_ID])
        self.assertIn((ROW_NEIGHBOUR_TILE_ID, 'raw'), steps.calls)
        rows = self.rows_by_tile_and_step()
        self.assertEqual((rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', 'raw')]['status'], rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', 'raw')]['reason']),
                         ('pending', 'batch-pending'))
        self.assertEqual(rows[(f'tile:{COLUMN_NEIGHBOUR_TILE_ID}', 'raw')]['status'], 'pass')
        self.assertEqual(rows[(f'tile:{COLUMN_NEIGHBOUR_TILE_ID}', 'chunks')]['reason'], 'batch-pending')

    def test_a_neighbour_only_tile_keeps_the_recorded_rows_of_its_other_steps(self):
        self.record_rows('chunks', {ROW_NEIGHBOUR_TILE_ID: ('gap', SYNTHETIC_LAYOUT_GAP_REASON)})
        self.record_rows('meshes', {ROW_NEIGHBOUR_TILE_ID: ('failed', SYNTHETIC_FAILURE_REASON)})
        recorded_rows = self.rows_by_tile_and_step()
        steps = LedgerBackedSteps(self.project_root)
        self.run_batch(steps)
        rows = self.rows_by_tile_and_step()
        self.assertEqual(rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', 'raw')]['status'], 'pass')
        for step in ('chunks', 'meshes'):
            self.assertEqual(rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', step)], recorded_rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', step)])
        self.assertEqual([step for tile_id, step in steps.calls if tile_id == ROW_NEIGHBOUR_TILE_ID], ['raw'])

    def test_every_eligible_seam_neighbour_has_a_sealed_raw_unit_when_a_selected_tile_runs_its_second_step(self):
        steps, sealed_neighbours_at_the_second_step = LedgerBackedSteps(self.project_root), {}

        def inspecting_steps(step, tile_id):
            if (tile_id, step) == (OWNER_TILE_ID, 'chunks'):
                sealed_neighbours_at_the_second_step.update({neighbour: raw_is_sealed(self.project_root, neighbour)
                                                             for neighbour in SEAM_NEIGHBOUR_TILE_IDS})
            return steps(step, tile_id)

        self.run_batch(inspecting_steps)
        self.assertEqual(sealed_neighbours_at_the_second_step, dict.fromkeys(SEAM_NEIGHBOUR_TILE_IDS, True))

    def test_a_selected_tile_whose_raw_failed_in_phase_a_is_not_run_again_and_its_other_steps_become_upstream_failed_rows(self):
        steps = RawFailingOnceSteps(self.project_root, failing={(ROW_NEIGHBOUR_TILE_ID, 'raw')})
        outcome = self.run_batch(steps, limit=2)
        self.assertEqual(outcome.attempted_tile_ids, [OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID])
        self.assertEqual([step for tile_id, step in steps.calls if tile_id == ROW_NEIGHBOUR_TILE_ID], ['raw', 'manifest'])
        self.assertFalse(raw_is_sealed(self.project_root, ROW_NEIGHBOUR_TILE_ID))
        rows = self.rows_by_tile_and_step()
        self.assertEqual([(rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', step)]['status'], rows[(f'tile:{ROW_NEIGHBOUR_TILE_ID}', step)]['reason'])
                          for step in SYNTHETIC_STEP_NAMES],
                         [('failed', SYNTHETIC_FAILURE_REASON), ('pending', 'upstream-step-failed:raw'), ('pending', 'upstream-step-failed:raw'),
                          ('pass', None)])

    def test_no_raw_step_runs_after_phase_a(self):
        steps = LedgerBackedSteps(self.project_root)
        self.run_batch(steps, limit=2)
        raw_call_count = len(SEAM_INPUT_TILE_IDS)
        self.assertEqual(steps.calls[:raw_call_count], [(tile_id, 'raw') for tile_id in SEAM_INPUT_TILE_IDS])
        self.assertNotIn('raw', [step for _, step in steps.calls[raw_call_count:]])


class TileStepsPhaseTests(TileBatchPhaseTestCase):
    def test_manifests_run_in_tile_order_each_right_after_the_other_steps_of_its_tile(self):
        steps = LedgerBackedSteps(self.project_root)
        self.run_batch(steps, limit=2)
        self.assertEqual(steps.calls[len(SEAM_INPUT_TILE_IDS):],
                         [(tile_id, step) for tile_id in (OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID) for step in STEPS_AFTER_RAW])

    def test_the_summary_preflights_are_grouped_by_tile_in_census_order_and_by_step_within_a_tile(self):
        outcome = self.run_batch(LedgerBackedSteps(self.project_root), limit=2)
        self.assertEqual([(record['tile'], record['step']) for record in outcome.preflights],
                         [*((tile_id, step) for tile_id in (OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID) for step in SYNTHETIC_STEP_NAMES),
                          (COLUMN_NEIGHBOUR_TILE_ID, 'raw'), (CORNER_NEIGHBOUR_TILE_ID, 'raw')])

    def test_a_preflight_refusal_in_phase_a_stops_the_batch_with_no_attempted_tile_and_no_nothing_to_do_line(self):
        steps = LedgerBackedSteps(self.project_root)
        refusing_preflight = RecordingPreflight({2: FreeDiskFloorRefusedError('free disk 1 bytes is below the batch floor')})
        exit_code, printed, _, _ = self.run_main(['--eligible', '--limit', '1'], steps, refusing_preflight)
        self.assertEqual(exit_code, BATCH_EXIT_DISK_FLOOR)
        summary = json.loads(printed)
        self.assertEqual(summary['attemptedTiles'], [])
        self.assertEqual((summary['stop']['tile_id'], summary['stop']['step']), (ROW_NEIGHBOUR_TILE_ID, 'raw'))
        self.assertIsNone(summary['laneOutputs'])
        self.assertEqual(steps.calls, [(OWNER_TILE_ID, 'raw')])

    def test_no_tile_after_the_first_stopped_tile_starts(self):
        steps = LedgerBackedSteps(self.project_root)
        preflight_call_of_the_second_tile_chunks = len(SEAM_INPUT_TILE_IDS) + len(STEPS_AFTER_RAW) + 1
        refusal = FreeDiskFloorRefusedError('free disk 1 bytes is below the batch floor')
        outcome = self.run_batch(steps, limit=3, preflight=RecordingPreflight({preflight_call_of_the_second_tile_chunks: refusal}))
        self.assertEqual(outcome.exit_code, BATCH_EXIT_DISK_FLOOR)
        self.assertEqual((outcome.stop.tile_id, outcome.stop.step), (ROW_NEIGHBOUR_TILE_ID, 'chunks'))
        self.assertEqual(outcome.attempted_tile_ids, [OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID])
        self.assertEqual([step for tile_id, step in steps.calls if tile_id == COLUMN_NEIGHBOUR_TILE_ID], ['raw'])
        self.assertEqual([step for tile_id, step in steps.calls if tile_id == ROW_NEIGHBOUR_TILE_ID], ['raw'])
        rows = self.rows_by_tile_and_step()
        self.assertEqual([rows[(f'tile:{COLUMN_NEIGHBOUR_TILE_ID}', step)]['status'] for step in SYNTHETIC_STEP_NAMES],
                         ['pass', 'pending', 'pending', 'pending'])

    def test_a_running_tile_ends_before_its_next_preflight_once_an_earlier_tile_has_stopped(self):
        steps, preflight = LedgerBackedSteps(self.project_root, layout_gaps={(LONE_TILE_ID, 'chunks')}), RecordingPreflight()
        first_stopped_position = multiprocessing.Value('q', NO_STOPPED_POSITION)

        def steps_with_a_refusal_of_another_worker(step, tile_id):
            first_stopped_position.value = 1
            return steps(step, tile_id)

        tile_step_run = TileStepRun(self.project_root, steps_with_a_refusal_of_another_worker, preflight, synthetic_seal_checks())
        outcome = ordered_tile_steps_outcome(tile_step_run, first_stopped_position,
                                             TileStepsTask(2, LONE_TILE_ID, synthetic_source_identity(LONE_TILE_ID), ('chunks', 'meshes'), None))
        self.assertEqual((outcome.started, outcome.stop, list(outcome.step_results)), (True, None, ['chunks']))
        self.assertEqual([(record['tile'], record['step']) for record in outcome.preflights], [(LONE_TILE_ID, 'chunks')])
        self.assertEqual((steps.calls, preflight.calls, first_stopped_position.value), ([(LONE_TILE_ID, 'chunks')], 1, 1))

    def test_a_tile_before_the_first_stopped_tile_runs_every_step(self):
        steps, preflight = LedgerBackedSteps(self.project_root), RecordingPreflight()
        first_stopped_position = multiprocessing.Value('q', 1)
        tile_step_run = TileStepRun(self.project_root, steps, preflight, synthetic_seal_checks())
        outcome = ordered_tile_steps_outcome(tile_step_run, first_stopped_position,
                                             TileStepsTask(0, OWNER_TILE_ID, synthetic_source_identity(OWNER_TILE_ID), ('chunks', 'meshes'), None))
        self.assertEqual((outcome.started, outcome.stop), (True, None))
        self.assertEqual((steps.calls, preflight.calls, first_stopped_position.value), ([(OWNER_TILE_ID, 'chunks'), (OWNER_TILE_ID, 'meshes')], 2, 1))

    def test_the_lane_work_root_exists_before_the_workers_are_built(self):
        lane_work_root_existed = []

        def workers_built_after_the_work_root(*workers_arguments):
            lane_work_root_existed.append(lane_work_root(self.project_root, 'world').is_dir())
            return TileStepWorkers(*workers_arguments)

        with patch.object(convert_tile_batch, 'TileStepWorkers', workers_built_after_the_work_root):
            self.run_batch(LedgerBackedSteps(self.project_root))
        self.assertEqual(lane_work_root_existed, [True])

    def test_a_pool_that_breaks_while_tasks_are_submitted_gives_the_worker_died_outcome_for_every_task_without_a_future(self):
        tasks = [TileStepsTask(position, tile_id, synthetic_source_identity(tile_id), ('chunks',), None)
                 for position, tile_id in enumerate((OWNER_TILE_ID, ROW_NEIGHBOUR_TILE_ID, COLUMN_NEIGHBOUR_TILE_ID))]
        with patch.object(tile_step_workers, 'ProcessPoolExecutor', PoolBrokenAtTheSecondSubmit):
            workers = TileStepWorkers(2, None, TileStepRun, ())
            outcomes = list(workers.outcomes(tasks))
            workers.close()
        self.assertEqual(outcomes, [PoolBrokenAtTheSecondSubmit.first_outcome,
                                    *(TileStepsOutcome(False, {}, TileBatchStop(BATCH_EXIT_ERROR, task.tile_id, None, WORKER_DIED_MESSAGE), [])
                                      for task in tasks[1:])])


class TileBatchWorkerCountTests(TileBatchPhaseTestCase):
    def refused_steps(self, *step_arguments):
        self.fail(f'no step may run: {step_arguments}')

    def test_the_preflight_floor_is_the_batch_floor_with_one_worker_and_one_gibibyte_more_with_two(self):
        floors = []

        def recorded_batch_preflight(project_root, lane_name, minimum_free_bytes):
            floors.append(minimum_free_bytes)
            return {'rigaTime': '2026-11-10T12:00:00+02:00', 'freeBytes': minimum_free_bytes}

        with (patch.object(convert_tile_batch, 'require_batch_preflight', recorded_batch_preflight),
              patch.object(convert_tile_batch, 'run_at_below_normal_priority')):
            for worker_count in (1, 2):
                convert_tile_batch.world_batch_preflight(self.project_root, worker_count)()
        self.assertEqual(floors, [BATCH_MINIMUM_FREE_BYTES, BATCH_MINIMUM_FREE_BYTES + ONE_GIBIBYTE])

    def test_workers_zero_and_workers_x_are_usage_errors_with_the_exit_code_of_a_bad_limit(self):
        bad_limit_exit_code, _, bad_limit_errors, _ = self.run_main(['--eligible', '--limit', '0'], self.refused_steps, RecordingPreflight())
        self.assertIn('error:', bad_limit_errors)
        for worker_count_text in ('0', 'x'):
            with self.subTest(worker_count_text=worker_count_text):
                exit_code, printed, errors, _ = self.run_main(['--eligible', '--limit', '1', '--workers', worker_count_text], self.refused_steps,
                                                              RecordingPreflight())
                self.assertEqual((exit_code, printed), (bad_limit_exit_code, ''))
                self.assertIn(f'error: argument --workers: --workers must be an integer from 1 to 61: {worker_count_text!r}', errors)

    def test_without_workers_the_batch_runs_with_one_worker_and_builds_no_process_pool(self):
        steps = LedgerBackedSteps(self.project_root)
        exit_code, printed, _, preflight_worker_counts = self.run_main(['--eligible', '--limit', '1'], steps, RecordingPreflight())
        self.assertEqual(exit_code, BATCH_EXIT_DONE)
        self.assertEqual(json.loads(printed)['attemptedTiles'], [OWNER_TILE_ID])
        self.assertEqual(preflight_worker_counts, [1])
        self.assertIn((OWNER_TILE_ID, 'manifest'), steps.calls)


class WorkerStepModuleTests(unittest.TestCase):
    def test_no_world_step_module_that_runs_in_a_worker_opens_the_lane_catalog(self):
        closure = world_import_closure({runner.__module__ for runner in source_tile_step_runners().values()})
        self.assertIn('world.static_mesh_step', closure)
        self.assertEqual({module_name: sorted(names_used_by_module(module_name) & LANE_CATALOG_NAMES)
                          for module_name in sorted(closure - {MANIFEST_MODULE_NAME})
                          if names_used_by_module(module_name) & LANE_CATALOG_NAMES}, {})


if __name__ == '__main__':
    unittest.main()
