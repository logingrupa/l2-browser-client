from collections import namedtuple
import json
import os
from pathlib import Path
import shutil
import time

from native_store.unit_ledger import SEAL_RECORD_NAME, FreeDiskFloorRefusedError, current_riga_timestamp
from test_convert_tile_batch import (SYNTHETIC_STEP_NAMES, LedgerBackedSteps, synthetic_seal_checks, synthetic_source_identity,
                                     synthetic_step_ledger, write_synthetic_tile_census)
from test_world_tile_batch_phases import raw_is_sealed
from world import tile_step_workers
from world.convert_tile_batch import batch_summary, run_tile_batch
from world.tile_step_workers import NO_STOPPED_POSITION, TileStepRun

GATE_POLL_SECONDS = 0.01
GATE_TIMEOUT_SECONDS = 60
STEP_CALL_RECORDS_FOLDER_NAME = 'tile-step-calls'
RAW_FAILED_ONCE_MARKER_NAME = 'raw-failed-once.marker'
RAW_FAILED_ONCE_MESSAGE = 'synthetic raw failure of the first call'
SYNTHETIC_FLOOR_REFUSAL_MESSAGE = 'synthetic free disk floor refusal after the chunks step of the second tile'
WORKER_DEATH_EXIT_CODE = 1
SEPARATE_TILE_IDS = ('10_11', '12_13', '14_15')
OWNER_AND_ROW_NEIGHBOUR_TILE_IDS = ('10_11', '10_12', '14_15')
OWNER_AND_SEAM_NEIGHBOUR_TILE_IDS = ('10_11', '10_12', '11_11', '11_12', '14_15')
ROW_NEIGHBOUR_RAW_CALL = ('10_12', 'raw')
SECOND_TILE_CHUNKS_CALL = (SEPARATE_TILE_IDS[1], 'chunks')
THIRD_TILE_CHUNKS_CALL = (SEPARATE_TILE_IDS[2], 'chunks')
PreflightRefusal = namedtuple('PreflightRefusal', 'after_call wait_before_refusing')


def wait_at_the_gate_until(condition_holds, awaited):
    deadline = time.monotonic() + GATE_TIMEOUT_SECONDS
    while not condition_holds():
        if time.monotonic() > deadline:
            raise AssertionError(f'the gate waited {GATE_TIMEOUT_SECONDS} seconds for {awaited}')
        time.sleep(GATE_POLL_SECONDS)


def step_call_records_folder(project_root):
    return project_root.parent / STEP_CALL_RECORDS_FOLDER_NAME


def step_call_is_recorded(project_root, tile_id, step):
    return any(step_call_records_folder(project_root).glob(f'{tile_id}.{step}.*.json'))


def step_call_records(project_root):
    records = [json.loads(path.read_text(encoding='utf-8')) for path in step_call_records_folder(project_root).glob('*.json')]
    return sorted(records, key=lambda record: (record['processId'], record['callNumber']))


def do_nothing(project_root):
    pass


def fail_the_first_raw_call(project_root):
    marker_path = project_root.parent / RAW_FAILED_ONCE_MARKER_NAME
    if not marker_path.exists():
        marker_path.write_bytes(b'')
        raise OSError(RAW_FAILED_ONCE_MESSAGE)


def wait_until_an_earlier_tile_has_stopped(project_root):
    first_stopped_position = tile_step_workers.tile_step_worker.first_stopped_position
    wait_at_the_gate_until(lambda: first_stopped_position.value < NO_STOPPED_POSITION, 'the stop of an earlier tile')


def wait_for_the_chunks_call_of_the_third_tile(project_root):
    wait_at_the_gate_until(lambda: step_call_is_recorded(project_root, *THIRD_TILE_CHUNKS_CALL), 'the chunks call of the third tile')


def end_this_process_once_the_first_manifest_is_sealed(project_root):
    seal_path = synthetic_step_ledger(project_root, 'manifest').unit_step_directory(f'tile:{SEPARATE_TILE_IDS[0]}') / SEAL_RECORD_NAME
    wait_at_the_gate_until(seal_path.exists, seal_path)
    os._exit(WORKER_DEATH_EXIT_CODE)


NO_REFUSAL = PreflightRefusal(None, do_nothing)
TileBatchScenario = namedtuple('TileBatchScenario', 'eligible_tile_ids limit failing actions_before_a_step refusal', defaults=((), {}, NO_REFUSAL))
TILE_BATCH_SCENARIOS_BY_NAME = {
    'plain': TileBatchScenario(SEPARATE_TILE_IDS, 3),
    'one-tile-fails-a-step': TileBatchScenario(SEPARATE_TILE_IDS, 3, failing=(SECOND_TILE_CHUNKS_CALL,)),
    'preflight-refuses-on-the-second-tile': TileBatchScenario(SEPARATE_TILE_IDS, 2, refusal=PreflightRefusal(SECOND_TILE_CHUNKS_CALL, do_nothing)),
    'seam-neighbours-that-are-not-selected': TileBatchScenario(OWNER_AND_SEAM_NEIGHBOUR_TILE_IDS, 2),
    'raw-fails-once': TileBatchScenario(OWNER_AND_ROW_NEIGHBOUR_TILE_IDS, 2, actions_before_a_step={ROW_NEIGHBOUR_RAW_CALL: fail_the_first_raw_call}),
    'later-tile-running-at-the-refusal': TileBatchScenario(
        SEPARATE_TILE_IDS, 3, actions_before_a_step={THIRD_TILE_CHUNKS_CALL: wait_until_an_earlier_tile_has_stopped},
        refusal=PreflightRefusal(SECOND_TILE_CHUNKS_CALL, wait_for_the_chunks_call_of_the_third_tile)),
    'worker-dies': TileBatchScenario(SEPARATE_TILE_IDS, 2,
                                     actions_before_a_step={SECOND_TILE_CHUNKS_CALL: end_this_process_once_the_first_manifest_is_sealed})}


class RecordedSteps(LedgerBackedSteps):
    def __init__(self, project_root, failing, actions_before_a_step):
        super().__init__(project_root, failing=failing)
        self.actions_before_a_step, self.started_calls = actions_before_a_step, []

    def __call__(self, step, tile_id):
        self.started_calls.append((tile_id, step))
        process_id, call_number = os.getpid(), len(self.started_calls)
        records_folder = step_call_records_folder(self.project_root)
        records_folder.mkdir(exist_ok=True)
        (records_folder / f'{tile_id}.{step}.{process_id}.{call_number}.json').write_text(
            json.dumps({'tile': tile_id, 'step': step, 'processId': process_id, 'callNumber': call_number}), encoding='utf-8')
        self.actions_before_a_step.get((tile_id, step), do_nothing)(self.project_root)
        return super().__call__(step, tile_id)


class ScenarioPreflight:
    def __init__(self, project_root, steps, refusal):
        self.project_root, self.steps, self.refusal = project_root, steps, refusal

    def __call__(self):
        if self.steps.started_calls[-1:] == [self.refusal.after_call]:
            self.refusal.wait_before_refusing(self.project_root)
            raise FreeDiskFloorRefusedError(SYNTHETIC_FLOOR_REFUSAL_MESSAGE)
        return {'rigaTime': current_riga_timestamp(), 'freeBytes': shutil.disk_usage(self.project_root).free}


def scenario_tile_step_run(project_root, scenario_name):
    scenario = TILE_BATCH_SCENARIOS_BY_NAME[scenario_name]
    steps = RecordedSteps(project_root, scenario.failing, scenario.actions_before_a_step)
    return TileStepRun(project_root, steps, ScenarioPreflight(project_root, steps, scenario.refusal), synthetic_seal_checks())


def tile_batch_report(scenario_name, project_root, worker_count):
    scenario = TILE_BATCH_SCENARIOS_BY_NAME[scenario_name]
    write_synthetic_tile_census(project_root, scenario.eligible_tile_ids)
    outcome = run_tile_batch(scenario.limit, worker_count, scenario_tile_step_run, (project_root, scenario_name),
                             step_names=SYNTHETIC_STEP_NAMES, tile_source_identity=synthetic_source_identity)
    return {'summary': batch_summary(outcome, None), 'coordinatorProcessId': os.getpid(), 'stepCalls': step_call_records(project_root),
            'tilesWithARawSeal': [tile_id for tile_id in scenario.eligible_tile_ids if raw_is_sealed(project_root, tile_id)]}


def print_tile_batch_report(program_arguments):
    scenario_name, project_root, worker_count = program_arguments
    print(json.dumps(tile_batch_report(scenario_name, Path(project_root), int(worker_count))))
