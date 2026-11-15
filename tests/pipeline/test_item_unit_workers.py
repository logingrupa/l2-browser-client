import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import item_unit_workers
from actors.item_census import run_pooled_item_batch, write_item_census_and_gap_rows
from actors.item_conversion import ItemConversionError
from actors.item_unit_workers import converted_unit_outcome, initialize_item_unit_worker
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import SEAL_RECORD_NAME, BatchPreflightRefusedError, UnitLedger
from test_item_batch_bookkeeping import ItemBatchFixture, item_record_id, weapon_unit_key
from test_item_conversion_run import CHANGED_CONVERTER_SHA256, WEAPON_ROWS, SyntheticItemRun
from test_item_requests import synthetic_weapon_row

POOL_WORKER_COUNT = 4
POOL_SHUTDOWN_KEYWORDS = {'wait': True, 'cancel_futures': True}
SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE = 'synthetic preflight refusal for the third unit'
SYNTHETIC_TRANSIENT_FAILURE_MESSAGE = 'synthetic transient failure'
WEAPON_ROW_OF_NO_UNIT = synthetic_weapon_row(9, meshes=('LineageWeapons.dagger_m00_wp',))


class DeferredFuture:
    def __init__(self, executor, function, unit_key):
        self.executor, self.function, self.unit_key = executor, function, unit_key

    def result(self):
        self.executor.run_the_initializer_before_the_first_task()
        return self.function(self.unit_key)


class DeferredExecutor:
    def __init__(self, max_workers, initializer, initargs):
        self.max_workers, self.initializer, self.initargs = max_workers, initializer, initargs
        self.submitted_unit_keys, self.shutdown_keywords, self.initializer_has_run = [], [], False

    def submit(self, function, unit_key):
        self.submitted_unit_keys.append(unit_key)
        return DeferredFuture(self, function, unit_key)

    def run_the_initializer_before_the_first_task(self):
        if not self.initializer_has_run:
            self.initializer_has_run = True
            self.initializer(*self.initargs)

    def shutdown(self, wait, cancel_futures):
        self.shutdown_keywords.append({'wait': wait, 'cancel_futures': cancel_futures})


class SecondUnitTransientFailureItemRun(SyntheticItemRun):
    def converted_model_reason(self, unit):
        if unit['unitKey'] == self.units[1]['unitKey']:
            raise OSError(SYNTHETIC_TRANSIENT_FAILURE_MESSAGE)
        return super().converted_model_reason(unit)


class DeferredPoolFixture(ItemBatchFixture):
    weapon_rows = WEAPON_ROWS
    worker_run_class = SyntheticItemRun

    def setUp(self):
        super().setUp()
        self.executors, self.worker_runs = [], []
        for name, replacement in (('ProcessPoolExecutor', self.deferred_executor), ('item_unit_worker', None),
                                  ('hold_lane_in_use_part_until_process_end', mock.Mock())):
            patcher = mock.patch.object(item_unit_workers, name, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.worker_run_arguments = (self.project_root, self.client_root)

    def deferred_executor(self, max_workers, initializer, initargs):
        self.executors.append(DeferredExecutor(max_workers, initializer, initargs))
        return self.executors[-1]

    def worker_run(self, project_root, client_root):
        self.worker_runs.append(self.worker_run_class(project_root, client_root))
        return self.worker_runs[-1]

    def seal_units_in_an_earlier_run(self, unit_indexes):
        earlier_run = SyntheticItemRun(self.project_root, self.client_root)
        for unit_index in unit_indexes:
            earlier_run.convert(earlier_run.units[unit_index])

    def coordinator_run_and_unit_keys(self):
        run = SyntheticItemRun(self.project_root, self.client_root)
        return run, [unit['unitKey'] for unit in run.units]

    def pooled_slice_outcomes(self, run, limit, preflight, worker_run_factory):
        return run_pooled_item_batch(run, limit, preflight, POOL_WORKER_COUNT, worker_run_factory, self.worker_run_arguments)

    def sealed_receipt_reads_from_now_on(self):
        reads, sealed_receipt = [], UnitLedger.sealed_receipt

        def recorded_sealed_receipt(ledger, unit_key):
            receipt = sealed_receipt(ledger, unit_key)
            reads.append((ledger, unit_key, receipt is not None))
            return receipt

        patcher = mock.patch.object(UnitLedger, 'sealed_receipt', recorded_sealed_receipt)
        patcher.start()
        self.addCleanup(patcher.stop)
        return reads

    def catalog_model_ids(self):
        return [record['id'] for record in json.loads(self.catalog_path.read_bytes())['models']]


class PooledSliceSelectionTests(DeferredPoolFixture, unittest.TestCase):
    def test_units_sealed_at_process_start_are_not_submitted_and_their_receipt_is_read_once(self):
        self.seal_units_in_an_earlier_run([0, 1])
        reads, preflight = self.sealed_receipt_reads_from_now_on(), mock.Mock()
        run, unit_keys = self.coordinator_run_and_unit_keys()
        outcomes = self.pooled_slice_outcomes(run, 1, preflight, self.worker_run)
        write_item_census_and_gap_rows(run, 1)
        sealed_first, sealed_second, converted_in_the_slice, beyond_the_limit = unit_keys
        executor, = self.executors
        self.assertEqual(executor.submitted_unit_keys, [converted_in_the_slice])
        self.assertEqual({unit_key: [returned for _, read_unit_key, returned in reads if read_unit_key == unit_key] for unit_key in unit_keys},
                         {sealed_first: [True], sealed_second: [True], converted_in_the_slice: [False, False, True], beyond_the_limit: [False]})
        self.assertEqual([outcome['cacheHit'] for outcome in outcomes], [True, True, False])
        self.assertEqual((executor.max_workers, executor.initializer, executor.initargs),
                         (POOL_WORKER_COUNT, initialize_item_unit_worker, (self.worker_run, self.worker_run_arguments, preflight)))
        self.assertEqual(executor.shutdown_keywords, [POOL_SHUTDOWN_KEYWORDS])

    def test_sealed_and_converted_units_come_back_in_unit_order(self):
        self.seal_units_in_an_earlier_run([0, 2])
        run, unit_keys = self.coordinator_run_and_unit_keys()
        outcomes = self.pooled_slice_outcomes(run, 2, mock.Mock(), self.worker_run)
        executor, = self.executors
        self.assertEqual(executor.submitted_unit_keys, [unit_keys[1], unit_keys[3]])
        self.assertEqual([(outcome['key'], outcome['cacheHit']) for outcome in outcomes], list(zip(unit_keys, [True, False, True, False])))
        self.assertEqual(self.catalog_model_ids(), [item_record_id(item_id) for item_id in (1, 2, 3, 4)])

    def test_a_slice_whose_units_are_all_sealed_runs_no_worker_run_factory(self):
        self.seal_units_in_an_earlier_run([0, 1, 2, 3])
        run, unit_keys = self.coordinator_run_and_unit_keys()
        outcomes = self.pooled_slice_outcomes(run, 4, mock.Mock(), self.worker_run)
        executor, = self.executors
        self.assertEqual((executor.submitted_unit_keys, self.worker_runs), ([], []))
        self.assertEqual(outcomes, [run.sealed_outcomes_by_unit_key()[unit_key] for unit_key in unit_keys])
        self.assertEqual([outcome['cacheHit'] for outcome in outcomes], [True] * 4)

    def test_the_lane_work_root_and_the_lane_store_root_exist_before_the_pool_is_built(self):
        lane_roots_existed = []

        def pool_built_after_the_lane_roots(max_workers, initializer, initargs):
            lane_roots_existed.append((lane_work_root(self.project_root, 'actors').is_dir(), self.store_root.is_dir()))
            return self.deferred_executor(max_workers, initializer, initargs)

        run, _ = self.coordinator_run_and_unit_keys()
        with mock.patch.object(item_unit_workers, 'ProcessPoolExecutor', pool_built_after_the_lane_roots):
            self.pooled_slice_outcomes(run, 1, mock.Mock(), self.worker_run)
        self.assertEqual(lane_roots_existed, [(True, True)])

    def test_a_worker_never_builds_the_sealed_outcome_map(self):
        run, unit_keys = self.coordinator_run_and_unit_keys()
        self.pooled_slice_outcomes(run, 4, mock.Mock(), self.worker_run)
        worker_run, = self.worker_runs
        self.assertIsNone(worker_run.sealed_outcomes)
        self.assertEqual((worker_run.converted_unit_keys, run.converted_unit_keys), (unit_keys, []))


class PooledSliceRefusalTests(DeferredPoolFixture, unittest.TestCase):
    def test_a_preflight_refusal_for_the_third_unit_stops_the_slice_and_cancels_the_rest(self):
        refusal = BatchPreflightRefusedError(SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE)
        preflight = mock.Mock(side_effect=[None, None, refusal])
        run, unit_keys = self.coordinator_run_and_unit_keys()
        with self.assertRaises(BatchPreflightRefusedError) as raised:
            self.pooled_slice_outcomes(run, 4, preflight, self.worker_run)
        executor, = self.executors
        worker_run, = self.worker_runs
        self.assertIs(raised.exception, refusal)
        self.assertEqual((preflight.call_count, executor.shutdown_keywords), (3, [POOL_SHUTDOWN_KEYWORDS]))
        self.assertEqual([(run.ledger.unit_step_directory(unit_key) / SEAL_RECORD_NAME).is_file() for unit_key in unit_keys[:2]], [True, True])
        self.assertEqual([run.ledger.unit_step_directory(unit_key).parent.exists() for unit_key in unit_keys[2:]], [False, False])
        self.assertEqual(worker_run.converted_unit_keys, unit_keys[:2])
        self.assertEqual((self.write_store.call_count, self.catalog_path.exists()), (0, False))

    def test_a_transient_failure_in_a_worker_comes_back_as_a_failed_outcome_in_place(self):
        self.worker_run_class = SecondUnitTransientFailureItemRun
        reads = self.sealed_receipt_reads_from_now_on()
        run, unit_keys = self.coordinator_run_and_unit_keys()
        outcomes = self.pooled_slice_outcomes(run, 3, mock.Mock(), self.worker_run)
        self.assertEqual([(outcome['key'], outcome['status']) for outcome in outcomes], list(zip(unit_keys, ['pass', 'failed', 'pass'])))
        self.assertEqual(list(run.sealed_outcomes_by_unit_key()), [unit_keys[0], unit_keys[2]])
        self.assertEqual([returned for ledger, unit_key, returned in reads if ledger is run.ledger and unit_key == unit_keys[1]], [False])
        self.assertEqual(self.catalog_model_ids(), [item_record_id(1), item_record_id(3)])

    def test_a_worker_seal_under_another_fingerprint_is_refused_by_the_coordinator(self):
        def worker_run_under_a_changed_converter(project_root, client_root):
            self.implementation_hash.return_value = CHANGED_CONVERTER_SHA256
            return SyntheticItemRun(project_root, client_root)

        run, unit_keys = self.coordinator_run_and_unit_keys()
        with self.assertRaises(ItemConversionError) as refusal:
            self.pooled_slice_outcomes(run, 2, mock.Mock(), worker_run_under_a_changed_converter)
        self.assertEqual(str(refusal.exception), f'converted item unit {unit_keys[0]} has no seal under the fingerprint of this run')
        self.assertEqual((run.sealed_outcomes_by_unit_key(), self.catalog_path.exists()), ({}, False))

    def test_a_converted_outcome_without_a_seal_is_refused(self):
        run, unit_keys = self.coordinator_run_and_unit_keys()
        with self.assertRaises(ItemConversionError) as refusal:
            run.add_sealed_outcome_of_converted_unit(run.units[0], run.outcome(run.units[0], 'pass', None, False, []))
        self.assertEqual(str(refusal.exception), f'converted item unit {unit_keys[0]} has no seal under the fingerprint of this run')
        self.assertEqual(run.sealed_outcomes_by_unit_key(), {})

    def test_a_worker_refuses_a_unit_key_its_run_does_not_hold(self):
        preflight, unit_key_of_no_unit = mock.Mock(), weapon_unit_key(WEAPON_ROW_OF_NO_UNIT)
        initialize_item_unit_worker(self.worker_run, self.worker_run_arguments, preflight)
        with self.assertRaises(item_unit_workers.ItemUnitWorkerError) as refusal:
            converted_unit_outcome(unit_key_of_no_unit)
        worker_run, = self.worker_runs
        self.assertEqual(str(refusal.exception), f'the run of this item unit worker holds no unit {unit_key_of_no_unit}')
        self.assertEqual((preflight.call_count, worker_run.converted_unit_keys), (1, []))


if __name__ == '__main__':
    unittest.main()
