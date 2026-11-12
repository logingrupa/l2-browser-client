import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import convert_actors, item_unit_workers
from actors.item_census import run_item_batch, write_item_census_and_gap_rows
from actors.item_conversion import ITEM_ALGORITHM_VERSION
from actors.item_requests import ITEM_CENSUS_RELATIVE_PATH, ITEM_STEP
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.interprocess_lock import LOCK_FILE_SUFFIX, STORE_LOCK_KEY_PREFIX, lane_lock_folder, lock_file_path
from native_store.store_paths import lane_gap_rows_path, lane_store_root, lane_work_root
from native_store.unit_ledger import (BELOW_NORMAL_PRIORITY_CLASS, OWNER_RECORD_NAME, RECEIPT_RECORD_NAME, RUNNING_MARKER_NAME, SEAL_RECORD_NAME,
                                      UnitLedger)
from support.item_unit_worker_runs import (SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE, WORKER_RECORDS_FOLDER_NAME,
                                           start_synthetic_item_conversion_patches)
from test_item_batch_bookkeeping import (BOOKKEEPING_WEAPON_ROWS, BOW_ROW, REFUSED_LONG_SWORD_ROW, SHARED_SWORD_ROWS, SLICE_LIMIT,
                                         BookkeepingItemRun, expected_census, expected_gap_row_document, expected_item_records, weapon_unit_key)
from test_item_conversion_run import write_actor_unit_census

POOLED_BATCH_PROGRAM = '\n'.join([
    'import sys',
    'sys.path[:0] = sys.argv[1:3]',
    'from support.item_unit_worker_runs import print_pooled_batch_report',
    'print_pooled_batch_report(sys.argv[3:])',
])
POOLED_BATCH_TIMEOUT_SECONDS = 240
LATER_UNITS_SEAL_FIRST_WORKER_COUNT = 4
REFUSED_THIRD_UNIT_WORKER_COUNT = 2
SLICE_UNIT_KEYS = [weapon_unit_key(SHARED_SWORD_ROWS[0]), weapon_unit_key(REFUSED_LONG_SWORD_ROW), weapon_unit_key(BOW_ROW)]
LEDGER_RECORD_NAMES_WITH_PROCESS_FIELDS = (OWNER_RECORD_NAME, RECEIPT_RECORD_NAME, SEAL_RECORD_NAME)
RECEIPT_CLOCK_AND_FREE_BYTE_FIELDS = ('finishedAtRiga', 'freeBytesBefore', 'freeBytesAfter')
OWNER_PROCESS_AND_CLOCK_FIELDS = ('pid', 'startedAtRiga')
SEAL_RECEIPT_HASH_FIELDS = ('receiptSha256',)


def build_project_tree(tree_root):
    project_root, client_root = tree_root / 'project', tree_root / 'client'
    (project_root / 'artifacts').mkdir(parents=True)
    write_actor_unit_census(project_root, BOOKKEEPING_WEAPON_ROWS)
    return project_root, client_root


def child_interpreter_report(scenario_name, project_root, client_root, worker_count):
    completed = subprocess.run([sys.executable, '-B', '-c', POOLED_BATCH_PROGRAM, str(ROOT / 'scripts'), str(ROOT / 'tests' / 'pipeline'),
                                scenario_name, str(project_root), str(client_root), str(worker_count)],
                               capture_output=True, text=True, check=False, timeout=POOLED_BATCH_TIMEOUT_SECONDS)
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return json.loads(completed.stdout)


def shared_file_bytes(project_root):
    return [(lane_store_root(project_root, 'actors') / 'catalog.json').read_bytes(),
            lane_gap_rows_path(project_root, 'actors', 'items').read_bytes(), (project_root / ITEM_CENSUS_RELATIVE_PATH).read_bytes()]


def sha256_by_relative_path(root, excluded_file_names=()):
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob('*') if path.is_file() and path.name not in excluded_file_names and path.suffix != LOCK_FILE_SUFFIX}


def lock_file_paths(project_root):
    return sorted(lane_work_root(project_root, 'actors').rglob('*' + LOCK_FILE_SUFFIX))


def store_lock_file_path(project_root):
    return lock_file_path(lane_lock_folder(lane_work_root(project_root, 'actors')),
                          STORE_LOCK_KEY_PREFIX + lane_store_root(project_root, 'actors').as_posix())


def unit_record_path(project_root, unit_key, record_name):
    ledger = UnitLedger(lane_work_root(project_root, 'actors'), ITEM_STEP, ITEM_ALGORITHM_VERSION)
    return ledger.unit_step_directory(unit_key) / record_name


def unit_records_without_fields(project_root, record_name, dropped_field_names):
    records = [json.loads(unit_record_path(project_root, unit_key, record_name).read_bytes()) for unit_key in SLICE_UNIT_KEYS]
    return [{name: value for name, value in record.items() if name not in dropped_field_names} for record in records]


class PooledItemBatchByteIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary_directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        process_pool_guard = mock.patch.object(item_unit_workers, 'ProcessPoolExecutor', side_effect=AssertionError(
            'the unittest process must not start a pool; use child_interpreter_report'))
        process_pool_guard.start()
        for patcher in (process_pool_guard, *start_synthetic_item_conversion_patches()):
            cls.addClassCleanup(patcher.stop)
        cls.one_process_project_root, one_process_client_root = build_project_tree(temporary_root / 'one-process')
        cls.pooled_project_root, cls.pooled_client_root = build_project_tree(temporary_root / 'pooled')
        one_process_run = BookkeepingItemRun(cls.one_process_project_root, one_process_client_root)
        cls.one_process_outcomes = run_item_batch(one_process_run, SLICE_LIMIT, lambda: None)
        write_item_census_and_gap_rows(one_process_run, SLICE_LIMIT)
        cls.pooled_report = child_interpreter_report('later-units-seal-first', cls.pooled_project_root, cls.pooled_client_root,
                                                     LATER_UNITS_SEAL_FIRST_WORKER_COUNT)

    def test_four_workers_that_seal_later_units_first_leave_the_shared_files_of_the_one_process_batch(self):
        pooled_shared_file_bytes = shared_file_bytes(self.pooled_project_root)
        self.assertEqual(pooled_shared_file_bytes, shared_file_bytes(self.one_process_project_root))
        self.assertEqual(pooled_shared_file_bytes, [
            json_bytes({'schemaVersion': 1, 'models': expected_item_records()}), canonical_json_bytes(expected_gap_row_document()),
            (json.dumps(expected_census(), indent=1, sort_keys=True, ensure_ascii=True) + '\n').encode('ascii')])

    def test_the_store_files_and_the_ledger_outputs_have_the_same_paths_and_sha256(self):
        one_process_store_root, pooled_store_root = (lane_store_root(project_root, 'actors')
                                                     for project_root in (self.one_process_project_root, self.pooled_project_root))
        one_process_work_root, pooled_work_root = (lane_work_root(project_root, 'actors')
                                                   for project_root in (self.one_process_project_root, self.pooled_project_root))
        self.assertEqual(sha256_by_relative_path(pooled_store_root), sha256_by_relative_path(one_process_store_root))
        pooled_ledger_outputs = sha256_by_relative_path(pooled_work_root, LEDGER_RECORD_NAMES_WITH_PROCESS_FIELDS)
        self.assertEqual(pooled_ledger_outputs, sha256_by_relative_path(one_process_work_root, LEDGER_RECORD_NAMES_WITH_PROCESS_FIELDS))
        self.assertEqual(len(pooled_ledger_outputs), 2)
        pooled_work_paths = sorted(sha256_by_relative_path(pooled_work_root))
        self.assertEqual(pooled_work_paths, sorted(sha256_by_relative_path(one_process_work_root)))
        self.assertEqual([path for path in pooled_work_paths if path.endswith(RUNNING_MARKER_NAME)], [])

    def test_each_run_leaves_the_lock_file_of_its_own_store_root_and_no_other_lock_file(self):
        for project_root in (self.one_process_project_root, self.pooled_project_root):
            self.assertEqual(lock_file_paths(project_root), [store_lock_file_path(project_root)])

    def test_the_receipts_owner_records_and_seals_differ_in_clock_pid_free_byte_and_receipt_hash_fields_only(self):
        for record_name, dropped_field_names in ((RECEIPT_RECORD_NAME, RECEIPT_CLOCK_AND_FREE_BYTE_FIELDS),
                                                 (OWNER_RECORD_NAME, OWNER_PROCESS_AND_CLOCK_FIELDS),
                                                 (SEAL_RECORD_NAME, SEAL_RECEIPT_HASH_FIELDS)):
            self.assertEqual(unit_records_without_fields(self.pooled_project_root, record_name, dropped_field_names),
                             unit_records_without_fields(self.one_process_project_root, record_name, dropped_field_names), record_name)
        for project_root in (self.one_process_project_root, self.pooled_project_root):
            for unit_key in SLICE_UNIT_KEYS:
                receipt_bytes = unit_record_path(project_root, unit_key, RECEIPT_RECORD_NAME).read_bytes()
                seal = json.loads(unit_record_path(project_root, unit_key, SEAL_RECORD_NAME).read_bytes())
                self.assertEqual(seal['receiptSha256'], hashlib.sha256(receipt_bytes).hexdigest())

    def test_the_outcomes_and_the_printed_lines_follow_unit_order_in_both_runs(self):
        self.assertEqual(self.pooled_report['outcomes'], self.one_process_outcomes)
        self.assertEqual([(outcome['key'], outcome['status'], outcome['cacheHit']) for outcome in self.pooled_report['outcomes']],
                         list(zip(SLICE_UNIT_KEYS, ['pass', 'gap', 'pass'], [False, False, False])))
        one_process_printed_lines = [json.dumps(convert_actors.printed_outcome(outcome), sort_keys=True)
                                     for outcome in self.one_process_outcomes]
        self.assertEqual(self.pooled_report['printedLines'], one_process_printed_lines)
        self.assertEqual([json.loads(line)['key'] for line in self.pooled_report['printedLines']], SLICE_UNIT_KEYS)

    def test_later_units_were_sealed_before_earlier_ones_in_the_pooled_run(self):
        first_sealed_at, second_sealed_at, third_sealed_at = (
            unit_record_path(self.pooled_project_root, unit_key, SEAL_RECORD_NAME).stat().st_mtime_ns for unit_key in SLICE_UNIT_KEYS)
        self.assertLessEqual(third_sealed_at, second_sealed_at)
        self.assertLessEqual(second_sealed_at, first_sealed_at)

    def test_no_worker_writes_a_shared_file_and_the_coordinator_converts_no_unit(self):
        self.assertEqual((self.pooled_report['sharedFilesBeforeTheFirstStoreWrite'], self.pooled_report['coordinatorConvertedUnitKeys'],
                          self.pooled_report['poolWorkerCounts'], self.pooled_report['refusalType']),
                         ([], [], [LATER_UNITS_SEAL_FIRST_WORKER_COUNT], None))

    def test_every_unit_was_converted_by_its_own_below_normal_worker_process(self):
        owner_process_ids = [json.loads(unit_record_path(self.pooled_project_root, unit_key, OWNER_RECORD_NAME).read_bytes())['pid']
                             for unit_key in SLICE_UNIT_KEYS]
        worker_records_by_process_id = {int(path.stem): json.loads(path.read_bytes())
                                        for path in (self.pooled_client_root.parent / WORKER_RECORDS_FOLDER_NAME).glob('*.json')}
        self.assertEqual(len(set(owner_process_ids)), len(SLICE_UNIT_KEYS))
        self.assertNotIn(self.pooled_report['coordinatorPid'], owner_process_ids)
        self.assertEqual(sorted(worker_records_by_process_id), sorted(owner_process_ids))
        self.assertEqual(list(worker_records_by_process_id.values()),
                         [{'priorityClass': BELOW_NORMAL_PRIORITY_CLASS}] * len(SLICE_UNIT_KEYS))


class PooledItemBatchRefusalTests(unittest.TestCase):
    def test_a_preflight_refusal_in_a_worker_for_the_third_unit_stops_the_slice_and_keeps_two_sealed_units(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        project_root, client_root = build_project_tree(Path(temporary_directory.name).resolve())
        report = child_interpreter_report('refused-third-unit', project_root, client_root, REFUSED_THIRD_UNIT_WORKER_COUNT)
        self.assertEqual((report['refusalType'], report['refusalMessage'], report['poolWorkerCounts'], report['storeWriteCallCount']),
                         ('native_store.unit_ledger.BatchPreflightRefusedError', SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE,
                          [REFUSED_THIRD_UNIT_WORKER_COUNT], 0))
        seal_paths = [unit_record_path(project_root, unit_key, SEAL_RECORD_NAME) for unit_key in SLICE_UNIT_KEYS]
        self.assertEqual([seal_path.is_file() for seal_path in seal_paths[:2]], [True, True])
        self.assertFalse(seal_paths[2].parents[1].exists())
        self.assertEqual([path.exists() for path in (lane_store_root(project_root, 'actors'), lane_gap_rows_path(project_root, 'actors', 'items'),
                                                     project_root / ITEM_CENSUS_RELATIVE_PATH)], [False, False, False])


if __name__ == '__main__':
    unittest.main()
