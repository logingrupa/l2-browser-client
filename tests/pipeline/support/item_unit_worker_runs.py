from collections import namedtuple
from concurrent.futures import ProcessPoolExecutor
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import time
from unittest import mock

from actors import convert_actors, item_census, item_conversion, item_unit_workers
from actors.item_census import run_pooled_item_batch, write_item_census_and_gap_rows
from actors.item_conversion import ItemConversionRun
from actors.item_requests import ITEM_CENSUS_RELATIVE_PATH
from native_store import lane_coverage_refresh
from native_store.store_paths import lane_gap_rows_path, lane_store_root
from native_store.unit_ledger import SEAL_RECORD_NAME, BatchPreflightRefusedError, run_at_below_normal_priority
from test_item_batch_bookkeeping import SLICE_LIMIT, BookkeepingItemRun, archive_derived_store_files_and_record
from test_item_conversion_run import FIRST_CONVERTER_SHA256

GATE_POLL_SECONDS = 0.01
GATE_TIMEOUT_SECONDS = 60
WORKER_RECORDS_FOLDER_NAME = 'item-unit-workers'
SHARED_FILE_WRITE_MESSAGE = 'an item unit worker called a shared-file writer'
SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE = 'synthetic preflight refusal once the first two units have begun'
PooledBatchScenario = namedtuple('PooledBatchScenario', 'worker_run_factory worker_run_arguments_after_the_roots preflight')
synthetic_worker_run = None


def wait_until_path_exists(path):
    deadline = time.monotonic() + GATE_TIMEOUT_SECONDS
    while not path.exists():
        if time.monotonic() > deadline:
            raise AssertionError(f'the gate waited {GATE_TIMEOUT_SECONDS} seconds for {path}')
        time.sleep(GATE_POLL_SECONDS)


def start_synthetic_item_conversion_patches():
    patchers = [mock.patch.object(item_conversion, 'implementation_hash', mock.Mock(return_value=FIRST_CONVERTER_SHA256)),
                mock.patch.object(item_conversion, 'converted_model_store_files_and_record',
                                  mock.Mock(side_effect=archive_derived_store_files_and_record))]
    for patcher in patchers:
        patcher.start()
    return patchers


def refuse_shared_file_writers_in_this_process():
    for owner, writer_name in ((item_conversion, 'write_store'), (item_census, 'write_gap_rows'),
                               (item_census, 'write_item_census_and_gap_rows'), (ItemConversionRun, 'write_item_records'),
                               (lane_coverage_refresh, 'refresh_lane_coverage')):
        mock.patch.object(owner, writer_name, side_effect=AssertionError(SHARED_FILE_WRITE_MESSAGE)).start()


def current_process_priority_class():
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.GetPriorityClass.argtypes = (wintypes.HANDLE,)
    kernel32.GetPriorityClass.restype = wintypes.DWORD
    return kernel32.GetPriorityClass(kernel32.GetCurrentProcess())


def write_worker_record(client_root):
    worker_records_folder = Path(client_root).parent / WORKER_RECORDS_FOLDER_NAME
    worker_records_folder.mkdir(exist_ok=True)
    (worker_records_folder / f'{os.getpid()}.json').write_text(json.dumps({'priorityClass': current_process_priority_class()}))


class LaterUnitsSealFirstItemRun(BookkeepingItemRun):
    def __init__(self, project_root, client_root, gated_unit_count):
        super().__init__(project_root, client_root)
        gated_unit_keys = [unit['unitKey'] for unit in self.units[:gated_unit_count]]
        self.successor_seal_path_by_unit_key = {unit_key: self.ledger.unit_step_directory(successor_unit_key) / SEAL_RECORD_NAME
                                                for unit_key, successor_unit_key in zip(gated_unit_keys, gated_unit_keys[1:])}

    def converted_model_reason(self, unit):
        successor_seal_path = self.successor_seal_path_by_unit_key.get(unit['unitKey'])
        if successor_seal_path is not None:
            wait_until_path_exists(successor_seal_path)
        return super().converted_model_reason(unit)


class FirstTwoUnitsBeginTogetherItemRun(BookkeepingItemRun):
    def first_two_unit_folders(self):
        return [self.ledger.unit_step_directory(unit['unitKey']) for unit in self.units[:2]]

    def converted_model_reason(self, unit):
        first_two_unit_folders = self.first_two_unit_folders()
        if self.ledger.unit_step_directory(unit['unitKey']) in first_two_unit_folders:
            for unit_folder in first_two_unit_folders:
                wait_until_path_exists(unit_folder)
        return super().converted_model_reason(unit)


def synthetic_worker_run_of_class(run_class, project_root, client_root, *run_arguments_after_the_roots):
    global synthetic_worker_run
    start_synthetic_item_conversion_patches()
    refuse_shared_file_writers_in_this_process()
    write_worker_record(client_root)
    synthetic_worker_run = run_class(project_root, client_root, *run_arguments_after_the_roots)
    return synthetic_worker_run


def later_units_seal_first_worker_run(project_root, client_root, gated_unit_count):
    return synthetic_worker_run_of_class(LaterUnitsSealFirstItemRun, project_root, client_root, gated_unit_count)


def first_two_units_begin_together_worker_run(project_root, client_root):
    return synthetic_worker_run_of_class(FirstTwoUnitsBeginTogetherItemRun, project_root, client_root)


def passing_preflight():
    pass


def preflight_refused_once_the_first_two_units_have_begun():
    if all(unit_folder.exists() for unit_folder in synthetic_worker_run.first_two_unit_folders()):
        raise BatchPreflightRefusedError(SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE)


POOLED_BATCH_SCENARIOS_BY_NAME = {
    'later-units-seal-first': PooledBatchScenario(later_units_seal_first_worker_run, (SLICE_LIMIT,), passing_preflight),
    'refused-third-unit': PooledBatchScenario(first_two_units_begin_together_worker_run, (),
                                              preflight_refused_once_the_first_two_units_have_begun)}


class RecordingProcessPoolExecutor(ProcessPoolExecutor):
    constructed_worker_counts = []

    def __init__(self, max_workers, initializer, initargs):
        self.constructed_worker_counts.append(max_workers)
        super().__init__(max_workers=max_workers, initializer=initializer, initargs=initargs)


def existing_shared_file_names(project_root):
    shared_file_exists_by_name = {
        'store': any(path.is_file() for path in lane_store_root(project_root, 'actors').rglob('*')),
        'gap-rows': lane_gap_rows_path(project_root, 'actors', 'items').exists(),
        'census': (project_root / ITEM_CENSUS_RELATIVE_PATH).exists()}
    return [name for name, exists in shared_file_exists_by_name.items() if exists]


class RecordingStoreWrite:
    def __init__(self, project_root, write_store):
        self.project_root, self.write_store = project_root, write_store
        self.call_count = 0
        self.shared_files_before_the_first_call = None

    def __call__(self, *write_store_arguments):
        if self.call_count == 0:
            self.shared_files_before_the_first_call = existing_shared_file_names(self.project_root)
        self.call_count += 1
        return self.write_store(*write_store_arguments)


def pooled_batch_report(scenario_name, project_root, client_root, worker_count):
    run_at_below_normal_priority()
    start_synthetic_item_conversion_patches()
    scenario = POOLED_BATCH_SCENARIOS_BY_NAME[scenario_name]
    item_unit_workers.ProcessPoolExecutor = RecordingProcessPoolExecutor
    item_conversion.write_store = RecordingStoreWrite(project_root, item_conversion.write_store)
    run = BookkeepingItemRun(project_root, client_root)
    outcomes = refusal_type = refusal_message = None
    try:
        outcomes = run_pooled_item_batch(run, SLICE_LIMIT, scenario.preflight, worker_count, scenario.worker_run_factory,
                                         (project_root, client_root, *scenario.worker_run_arguments_after_the_roots))
        write_item_census_and_gap_rows(run, SLICE_LIMIT)
    except ValueError as refusal:
        outcomes = None
        refusal_type, refusal_message = f'{type(refusal).__module__}.{type(refusal).__qualname__}', str(refusal)
    return {'outcomes': outcomes,
            'printedLines': outcomes and [json.dumps(convert_actors.printed_outcome(outcome), sort_keys=True) for outcome in outcomes],
            'poolWorkerCounts': RecordingProcessPoolExecutor.constructed_worker_counts, 'coordinatorPid': os.getpid(),
            'coordinatorConvertedUnitKeys': run.converted_unit_keys,
            'sharedFilesBeforeTheFirstStoreWrite': item_conversion.write_store.shared_files_before_the_first_call,
            'storeWriteCallCount': item_conversion.write_store.call_count, 'refusalType': refusal_type, 'refusalMessage': refusal_message}


def print_pooled_batch_report(program_arguments):
    scenario_name, project_root, client_root, worker_count = program_arguments
    print(json.dumps(pooled_batch_report(scenario_name, Path(project_root), Path(client_root), int(worker_count))))
