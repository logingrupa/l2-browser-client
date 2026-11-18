from collections import namedtuple
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
import faulthandler
import multiprocessing
import signal
import sys
import traceback
from typing import NamedTuple

from native_store.interprocess_lock import hold_lane_in_use_part_until_process_end
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import FreeDiskFloorRefusedError, MachineWindowRefusedError
from world.eligible_tile_selection import (FAILED_STATUS, PASS_STATUS, StepSealMissingError, failed_step_row, own_step_row, sealed_tile_step,
                                           unit_step_evidence)
from world.raw_map_step import tile_unit_key
from world.world_lane_names import WORLD_LANE_NAME
from world.tile_step_gap_rows import UPSTREAM_BLOCKING_STATUSES, inherited_upstream_row

BATCH_EXIT_DONE = 0
BATCH_EXIT_ERROR = 1
BATCH_EXIT_MACHINE_WINDOW = 2
BATCH_EXIT_DISK_FLOOR = 3
NO_STOPPED_POSITION = 2 ** 62
SIGNED_64_BIT_INTEGER_TYPE_CODE = 'q'
WORKER_DIED_MESSAGE = ('a tile step worker process died and the batch does not restart it: the shared converter folders may hold a '
                       'half-published request and UModel child processes of the ended workers may still run')
POOL_TERMINATED_WORKER_EXIT_CODE = -signal.SIGTERM
UNSIGNED_32_BIT_MASK = 0xFFFFFFFF
TileStepWorker = namedtuple('TileStepWorker', 'run first_stopped_position')
tile_step_worker = None


class TileBatchStop(NamedTuple):
    exit_code: int
    tile_id: str
    step: str | None
    message: str


class TileStepsTask(NamedTuple):
    position: int
    tile_id: str
    source_identity: dict
    step_names: tuple
    blocking_earlier_row: dict | None
    expected_cost: int


class TileStepsOutcome(NamedTuple):
    started: bool
    step_results: dict
    stop: TileBatchStop | None
    preflights: list


def write_failed_step_traceback(tile_id, step, error):
    sys.stderr.write(f'tile {tile_id} step {step} failed\n' + ''.join(traceback.format_exception(error)))
    sys.stderr.flush()


class TileStepRun:
    def __init__(self, project_root, step_runner, preflight, step_seal_checks):
        self.project_root, self.step_runner, self.preflight, self.step_seal_checks = project_root, step_runner, preflight, step_seal_checks

    def checked_preflight(self, tile_id, step, preflights):
        try:
            preflights.append({'tile': tile_id, 'step': step, **self.preflight()})
        except MachineWindowRefusedError as error:
            return TileBatchStop(BATCH_EXIT_MACHINE_WINDOW, tile_id, step, str(error))
        except FreeDiskFloorRefusedError as error:
            return TileBatchStop(BATCH_EXIT_DISK_FLOOR, tile_id, step, str(error))
        return None

    def step_result(self, tile_id, step, source_identity):
        evidence = unit_step_evidence(self.project_root, tile_id, step, self.step_seal_checks)
        try:
            row = own_step_row(step, self.step_runner(step, tile_id))
            if row['status'] == FAILED_STATUS:
                return row
            if sealed_tile_step(self.project_root, tile_id, step, self.step_seal_checks) is not None:
                return None
            if row['status'] == PASS_STATUS:
                raise StepSealMissingError(f'step {step} of {tile_unit_key(tile_id)} reported pass without a ledger seal')
            return row
        except Exception as error:
            write_failed_step_traceback(tile_id, step, error)
            return failed_step_row(tile_id, step, source_identity, error, evidence)

    def run_tile(self, tile_id, source_identity, step_names, blocking_earlier_row, earlier_tile_stopped):
        step_results, preflights, blocking_row = {}, [], blocking_earlier_row
        for step in step_names:
            if blocking_row is not None:
                step_results[step] = inherited_upstream_row(tile_id, step, source_identity, blocking_row,
                                                            unit_step_evidence(self.project_root, tile_id, blocking_row['step'], self.step_seal_checks))
                continue
            if earlier_tile_stopped():
                return TileStepsOutcome(True, step_results, None, preflights)
            stop = self.checked_preflight(tile_id, step, preflights)
            if stop is not None:
                return TileStepsOutcome(True, step_results, stop, preflights)
            result = self.step_result(tile_id, step, source_identity)
            if result is None:
                continue
            step_results[step] = result
            if result['status'] in UPSTREAM_BLOCKING_STATUSES:
                blocking_row = result
        return TileStepsOutcome(True, step_results, None, preflights)


def ordered_tile_steps_outcome(tile_step_run, first_stopped_position, task):
    def earlier_tile_stopped():
        return first_stopped_position.value < task.position

    if earlier_tile_stopped():
        return TileStepsOutcome(False, {}, None, [])
    outcome = tile_step_run.run_tile(task.tile_id, task.source_identity, task.step_names, task.blocking_earlier_row, earlier_tile_stopped)
    if outcome.stop is not None:
        with first_stopped_position.get_lock():
            first_stopped_position.value = min(first_stopped_position.value, task.position)
    return outcome


def initialize_tile_step_worker(run_factory, run_factory_arguments, first_stopped_position):
    global tile_step_worker
    faulthandler.enable(file=sys.__stderr__, all_threads=True)
    tile_step_worker = TileStepWorker(run_factory(*run_factory_arguments), first_stopped_position)
    hold_lane_in_use_part_until_process_end(lane_work_root(tile_step_worker.run.project_root, WORLD_LANE_NAME))


def worker_tile_steps_outcome(task):
    return ordered_tile_steps_outcome(tile_step_worker.run, tile_step_worker.first_stopped_position, task)


def worker_exit_code_text(exit_code):
    if exit_code is None:
        return 'still running'
    if exit_code == POOL_TERMINATED_WORKER_EXIT_CODE:
        return 'ended by the broken pool'
    return f'0x{exit_code & UNSIGNED_32_BIT_MASK:08X}'


def last_line_of_pool_cause(broken_pool_error):
    cause_lines = [] if broken_pool_error.__cause__ is None else str(broken_pool_error.__cause__).strip().splitlines()
    return cause_lines[-1].strip() if cause_lines else None


def worker_died_stop_message(worker_exit_codes, pool_cause):
    exit_code_texts = ', '.join(f'{process_id}={worker_exit_code_text(exit_code)}' for process_id, exit_code in sorted(worker_exit_codes.items()))
    pool_cause_text = '' if pool_cause is None else f'; pool cause: {pool_cause}'
    return f'{WORKER_DIED_MESSAGE}; worker exit codes: {exit_code_texts or "none recorded"}{pool_cause_text}'


class TileStepWorkers:
    def __init__(self, worker_count, coordinator_run, run_factory, run_factory_arguments):
        self.coordinator_run = coordinator_run
        self.first_stopped_position = multiprocessing.Value(SIGNED_64_BIT_INTEGER_TYPE_CODE, NO_STOPPED_POSITION)
        self.executor = None if worker_count == 1 else ProcessPoolExecutor(
            max_workers=worker_count, initializer=initialize_tile_step_worker,
            initargs=(run_factory, run_factory_arguments, self.first_stopped_position))

    def worker_exit_codes(self):
        return {process_id: process.exitcode for process_id, process in (self.executor._processes or {}).items()}

    def worker_died_outcome(self, task, broken_pool_error):
        message = worker_died_stop_message(self.worker_exit_codes(), last_line_of_pool_cause(broken_pool_error))
        return TileStepsOutcome(False, {}, TileBatchStop(BATCH_EXIT_ERROR, task.tile_id, None, message), [])

    def future_outcome(self, future, task):
        try:
            return future.result()
        except BrokenProcessPool as broken_pool_error:
            return self.worker_died_outcome(task, broken_pool_error)

    def coordinator_outcome(self, task):
        return ordered_tile_steps_outcome(self.coordinator_run, self.first_stopped_position, task)

    def futures_submitted_until_the_pool_breaks(self, tasks):
        futures_by_position = {}
        for task in sorted(tasks, key=lambda task: task.expected_cost, reverse=True):
            try:
                futures_by_position[task.position] = self.executor.submit(worker_tile_steps_outcome, task)
            except BrokenProcessPool as broken_pool_error:
                return futures_by_position, broken_pool_error
        return futures_by_position, None

    def outcomes(self, tasks):
        if self.executor is None:
            return (self.coordinator_outcome(task) for task in tasks)
        futures_by_position, submit_refusal = self.futures_submitted_until_the_pool_breaks(tasks)
        return (self.future_outcome(futures_by_position[task.position], task) if task.position in futures_by_position
                else self.worker_died_outcome(task, submit_refusal) for task in tasks)

    def close(self):
        if self.executor is not None:
            self.executor.shutdown(wait=True, cancel_futures=True)
