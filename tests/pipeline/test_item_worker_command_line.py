import contextlib
import io
import json
from pathlib import Path
import pickle
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import convert_actors, item_census, item_unit_workers
from actors.item_census import run_item_conversion
from actors.item_requests import ITEM_CENSUS_RELATIVE_PATH
from native_catalog.tables import decode_table
from native_store.store_paths import lane_work_root
from native_store.worker_count_argument import worker_count_argument
from test_item_batch_bookkeeping import SLICE_LIMIT, BookkeepingItemRun, ItemBatchFixture
from test_item_unit_worker_processes import build_project_tree

POOLED_WORKER_COUNT = 4
WORKER_RUN_PATHS = tuple(Path(name) for name in ('project', 'client', 'converter-output', 'umodel.exe', 'lane-work', 'lane-store'))
CLIENT_ARGUMENTS = ['--client', 'client-no-argument-error-reads']
BATCH_NAMES_WITHOUT_WORKERS = ('npcs', 'skills', 'actor-sounds', 'characters')
MODES_THAT_REFUSE_WORKERS = (*(['--batch', batch_name, '--limit', '1', '--workers', '2'] for batch_name in BATCH_NAMES_WITHOUT_WORKERS),
                             ['--batch', 'npcs', '--limit', '1', '--workers', '1'], ['--item', '1', '--workers', '2'],
                             ['--npc', '1', '--workers', '2'], ['--print-batch-plan', '--workers', '2'])
WORKER_COUNTS_OUTSIDE_THE_RANGE = ('0', '62', '04', '-1', 'x')
WORKERS_MODE_REFUSAL = '--workers is only valid with --batch items'
WORKER_COUNT_REFUSAL = '--workers must be an integer from 1 to 61: '
PRINTED_PASS_OUTCOMES = [{'key': f'synthetic item unit {number}', 'step': 'items', 'status': 'pass', 'reason': None, 'cacheHit': False}
                         for number in (1, 2)]
CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS = ('require_actors_lane_store_output', 'require_reference_client', 'require_batch_preflight',
                                                  'run_at_below_normal_priority', 'Converter', 'lane_batch_lock',
                                                  'share_identical_files_of_batch_lane')


class ItemConversionWorkerWiringTests(ItemBatchFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.preflight = mock.Mock()
        self.process_pool_executor = mock.Mock(side_effect=AssertionError('the unittest process constructed an item unit worker pool'))
        for owner, name, replacement in ((item_unit_workers, 'ProcessPoolExecutor', self.process_pool_executor),
                                         (item_census, 'read_item_sources', mock.Mock()), (item_census, 'ItemConversionRun', mock.Mock())):
            patcher = mock.patch.object(owner, name, replacement)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def run_converter_and_outcomes(self, project_root, client_root, workers):
        run = BookkeepingItemRun(project_root, client_root)
        converter = SimpleNamespace(output=run.converter.output, umodel=client_root.with_name('umodel.exe'))
        self.read_item_sources.return_value, self.ItemConversionRun.return_value = run.sources, run
        arguments = SimpleNamespace(batch='items', item=None, limit=SLICE_LIMIT, workers=workers)
        outcomes = run_item_conversion(project_root, run.client_access, converter, run.store_root, decode_table, arguments, self.preflight)
        self.assertEqual((self.read_item_sources.call_args, self.ItemConversionRun.call_args),
                         (mock.call(project_root, client_root, decode_table),
                          mock.call(project_root, run.client_access, converter, lane_work_root(project_root, 'actors'), run.store_root, run.sources)))
        return run, converter, outcomes

    def test_without_workers_and_with_one_worker_the_units_convert_in_the_calling_process(self):
        for tree_name, workers in (('without-workers', None), ('one-worker', 1)):
            with self.subTest(workers=workers):
                project_root, client_root = build_project_tree(self.project_root.parent / tree_name)
                run, _, outcomes = self.run_converter_and_outcomes(project_root, client_root, workers)
                slice_unit_keys = [unit['unitKey'] for unit in run.units[:SLICE_LIMIT]]
                self.assertEqual([(outcome['key'], outcome['cacheHit']) for outcome in outcomes], [(unit_key, False) for unit_key in slice_unit_keys])
                self.assertEqual((run.converted_unit_keys, self.process_pool_executor.call_count), (slice_unit_keys, 0))
                self.assertTrue((project_root / ITEM_CENSUS_RELATIVE_PATH).is_file())

    def test_several_workers_hand_the_pool_the_real_factory_and_the_six_paths(self):
        with mock.patch.object(item_census, 'run_pooled_item_batch', return_value=[]) as run_pooled_item_batch:
            run, converter, outcomes = self.run_converter_and_outcomes(self.project_root, self.client_root, POOLED_WORKER_COUNT)
        self.assertEqual(run_pooled_item_batch.call_args_list,
                         [mock.call(run, SLICE_LIMIT, self.preflight, POOLED_WORKER_COUNT, item_unit_workers.item_worker_run,
                                    (self.project_root, self.client_root, converter.output, converter.umodel,
                                     lane_work_root(self.project_root, 'actors'), self.store_root))])
        self.assertIs(outcomes, run_pooled_item_batch.return_value)
        self.assertEqual((run.converted_unit_keys, self.preflight.call_count), ([], 0))
        self.assertTrue((self.project_root / ITEM_CENSUS_RELATIVE_PATH).is_file())


class ItemWorkerRunFactoryTests(unittest.TestCase):
    def test_the_worker_run_is_built_from_the_six_paths_like_the_run_of_the_coordinator(self):
        project_root, client_root, converter_output_root, umodel_path, ledger_root, store_root = WORKER_RUN_PATHS
        with mock.patch.multiple(item_unit_workers, require_reference_client=mock.DEFAULT, Converter=mock.DEFAULT, read_item_sources=mock.DEFAULT,
                                 ItemConversionRun=mock.DEFAULT) as replaced:
            run = item_unit_workers.item_worker_run(*WORKER_RUN_PATHS)
        client_access, converter = replaced['require_reference_client'].return_value, replaced['Converter'].return_value
        sources = replaced['read_item_sources'].return_value
        self.assertEqual([replaced[name].call_args_list for name in ('require_reference_client', 'Converter', 'read_item_sources', 'ItemConversionRun')],
                         [[mock.call(client_root)], [mock.call(client_access.root, converter_output_root, umodel_path)],
                          [mock.call(project_root, client_access.root, decode_table)],
                          [mock.call(project_root, client_access, converter, ledger_root, store_root, sources)]])
        self.assertIs(run, replaced['ItemConversionRun'].return_value)

    def test_the_worker_task_the_initializer_the_real_factory_and_the_lane_preflight_pickle_by_reference(self):
        for function in (item_unit_workers.converted_unit_outcome, item_unit_workers.initialize_item_unit_worker,
                         item_unit_workers.item_worker_run, convert_actors.lane_batch_preflight):
            with self.subTest(function=function.__name__):
                self.assertIs(pickle.loads(pickle.dumps(function)), function)


class WorkersArgumentTests(unittest.TestCase):
    def argument_error_text(self, mode_arguments):
        standard_error = io.StringIO()
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(standard_error):
            convert_actors.main([*CLIENT_ARGUMENTS, *mode_arguments])
        self.assertEqual(raised.exception.code, 2)
        return standard_error.getvalue()

    def test_workers_with_any_mode_other_than_the_items_batch_is_an_argument_error(self):
        for mode_arguments in MODES_THAT_REFUSE_WORKERS:
            with self.subTest(mode_arguments=mode_arguments):
                self.assertIn(WORKERS_MODE_REFUSAL, self.argument_error_text(mode_arguments))

    def test_a_worker_count_outside_one_to_sixty_one_is_an_argument_error(self):
        for worker_count_text in WORKER_COUNTS_OUTSIDE_THE_RANGE:
            with self.subTest(worker_count_text=worker_count_text):
                self.assertIn(WORKER_COUNT_REFUSAL + repr(worker_count_text),
                              self.argument_error_text(['--batch', 'items', '--limit', '1', '--workers', worker_count_text]))
        self.assertEqual([worker_count_argument(text) for text in ('1', '61')], [1, 61])

    def test_the_items_batch_accepts_workers_and_hands_the_count_to_the_item_conversion(self):
        run_item_conversion_of_the_command = mock.Mock(return_value=PRINTED_PASS_OUTCOMES)
        printed_lines = ''.join(json.dumps(convert_actors.printed_outcome(outcome), sort_keys=True) + '\n' for outcome in PRINTED_PASS_OUTCOMES)
        with mock.patch.multiple(convert_actors, **dict.fromkeys(CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS, mock.DEFAULT),
                                 lane_coverage_refreshed_at_exit=mock.Mock(return_value=contextlib.nullcontext()),
                                 run_item_conversion=run_item_conversion_of_the_command):
            for worker_arguments, expected_workers in ((['--workers', '2'], 2), ([], None)):
                with self.subTest(worker_arguments=worker_arguments):
                    standard_output = io.StringIO()
                    with contextlib.redirect_stdout(standard_output):
                        exit_status = convert_actors.main([*CLIENT_ARGUMENTS, '--batch', 'items', '--limit', '1', *worker_arguments])
                    arguments, preflight = run_item_conversion_of_the_command.call_args.args[5:]
                    self.assertEqual((exit_status, arguments.workers, standard_output.getvalue()), (0, expected_workers, printed_lines))
                    self.assertIs(preflight, convert_actors.lane_batch_preflight)


if __name__ == '__main__':
    unittest.main()
