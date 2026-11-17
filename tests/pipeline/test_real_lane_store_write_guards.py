import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets import Converter
from native_store import store_paths
from native_store.build_coverage_report import write_coverage_report
from native_store.gap_rows import write_gap_rows
from native_store.interprocess_lock import interprocess_lock, lane_batch_lock, lane_lock_folder, unit_lock
from native_store.store_paths import (PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE, REAL_LANE_STORES_FOLDER, REPOSITORY_ROOT,
                                      RealLaneStoreWriteRefusedError, lane_gap_rows_path, lane_store_root, lane_work_root,
                                      require_lane_write_outside_real_lane_stores)
from native_store.verified_file_writes import immutable_write, replace_file
from native_store.write_lane_catalog import write_lane_catalog

GUARD_PROBE_STEP = 'guard-probe'
REAL_UNIT_FOLDER = REAL_LANE_STORES_FOLDER / 'world' / 'work' / 'tile__20_21' / 'raw'
REFUSAL_PATTERN = 'may not write the real lane stores'
GUARD_PROGRAM = textwrap.dedent('''
    import sys
    sys.path.insert(0, sys.argv[1])
    from native_store.store_paths import RealLaneStoreWriteRefusedError, require_lane_write_outside_real_lane_stores
    try:
        require_lane_write_outside_real_lane_stores(sys.argv[2])
    except RealLaneStoreWriteRefusedError:
        print('refused')
    else:
        print('admitted')
''')
PLAIN_UNITTEST_MODULE = textwrap.dedent('''
    import sys
    import unittest

    class PlainUnittestGuardProbe(unittest.TestCase):
        def test_the_real_lane_store_path_is_refused(self):
            sys.path.insert(0, {scripts!r})
            from native_store.store_paths import RealLaneStoreWriteRefusedError, require_lane_write_outside_real_lane_stores
            with self.assertRaises(RealLaneStoreWriteRefusedError):
                require_lane_write_outside_real_lane_stores({real_path!r})
''')


def environment_without_the_test_run_flag():
    return {name: value for name, value in os.environ.items() if name != PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE}


def refuse_any_machine_schedule_read(*arguments, **options):
    raise AssertionError('the machine schedule is read only after the write guard admits the output')


class TestRunDetectionTests(unittest.TestCase):
    def guard_outcome_under_main_module(self, main_module):
        with patch.dict(os.environ), patch.dict(sys.modules, {'__main__': main_module}):
            os.environ.pop(PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE, None)
            try:
                require_lane_write_outside_real_lane_stores(REAL_UNIT_FOLDER)
            except RealLaneStoreWriteRefusedError:
                return 'refused'
            return 'admitted'

    def test_a_repository_test_file_run_as_main_refuses_without_the_harness_flag(self):
        for main_file in (ROOT / 'scripts' / 'test_pipeline.py', ROOT / 'tests' / 'pipeline' / 'support' / 'shared_lane_fixture.py'):
            with self.subTest(main_file=main_file):
                self.assertEqual(self.guard_outcome_under_main_module(SimpleNamespace(__spec__=None, __file__=str(main_file))), 'refused')

    def test_a_converter_script_run_as_main_admits_a_real_lane_store_path(self):
        main_module = SimpleNamespace(__spec__=None, __file__=str(ROOT / 'scripts' / 'world' / 'convert_tile_batch.py'))
        self.assertEqual(self.guard_outcome_under_main_module(main_module), 'admitted')

    def test_a_plain_unittest_discover_run_refuses_a_real_lane_store_path(self):
        with tempfile.TemporaryDirectory() as probe_folder:
            probe_module = Path(probe_folder) / 'test_plain_unittest_guard_probe.py'
            probe_module.write_text(PLAIN_UNITTEST_MODULE.format(scripts=str(ROOT / 'scripts'), real_path=str(REAL_UNIT_FOLDER)), encoding='utf-8')
            completed = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', probe_folder], capture_output=True, text=True,
                                       check=False, timeout=120, env=environment_without_the_test_run_flag())
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('Ran 1 test', completed.stderr)

    def test_a_converter_process_admits_a_real_lane_store_path(self):
        completed = subprocess.run([sys.executable, '-B', '-c', GUARD_PROGRAM, str(ROOT / 'scripts'), str(REAL_UNIT_FOLDER)], capture_output=True,
                                   text=True, check=True, timeout=120, env=environment_without_the_test_run_flag())
        self.assertEqual(completed.stdout.strip(), 'admitted')

    def test_a_child_of_the_harness_inherits_the_test_run_flag_and_refuses(self):
        completed = subprocess.run([sys.executable, '-B', '-c', GUARD_PROGRAM, str(ROOT / 'scripts'), str(REAL_UNIT_FOLDER)], capture_output=True,
                                   text=True, check=True, timeout=120, env={**os.environ, PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE: '1'})
        self.assertEqual(completed.stdout.strip(), 'refused')


class LaneStoreWriterGuardTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.lane_stores = self.project / 'artifacts' / 'lane-store'
        real_lane_stores_patch = patch.object(store_paths, 'REAL_LANE_STORES_FOLDER', self.lane_stores)
        real_lane_stores_patch.start()
        self.addCleanup(real_lane_stores_patch.stop)

    def assert_refused_without_writing(self, write):
        with self.assertRaisesRegex(RealLaneStoreWriteRefusedError, REFUSAL_PATTERN):
            write()
        self.assertFalse(self.lane_stores.exists())

    def test_replaced_and_immutable_files_are_refused(self):
        store_file = self.lane_stores / 'world' / 'l2' / 'catalog.json'
        self.assert_refused_without_writing(lambda: replace_file(store_file, b'{}'))
        self.assert_refused_without_writing(lambda: immutable_write(store_file, b'{}'))

    def test_replaced_and_immutable_files_outside_the_lane_stores_are_written(self):
        scratch_file = self.project / 'artifacts' / 'scratch' / 'catalog.json'
        replace_file(scratch_file, b'{}')
        immutable_write(scratch_file.with_name('immutable.json'), b'{}')
        self.assertEqual((scratch_file.read_bytes(), scratch_file.with_name('immutable.json').read_bytes()), (b'{}', b'{}'))

    def test_gap_rows_are_refused(self):
        self.assert_refused_without_writing(lambda: write_gap_rows(self.project, 'world', GUARD_PROBE_STEP, []))

    def test_the_lane_batch_lock_file_is_refused(self):
        def take_lane_batch_lock():
            with lane_batch_lock(lane_work_root(self.project, 'world')):
                pass
        self.assert_refused_without_writing(take_lane_batch_lock)

    def test_unit_and_request_lock_files_are_refused(self):
        def take_unit_lock():
            with unit_lock(lane_work_root(self.project, 'world'), 'tile__20_21'):
                pass

        def take_request_lock():
            with interprocess_lock(lane_lock_folder(lane_work_root(self.project, 'world')), 'request'):
                pass
        self.assert_refused_without_writing(take_unit_lock)
        self.assert_refused_without_writing(take_request_lock)

    def test_the_lane_catalog_is_refused(self):
        self.assert_refused_without_writing(lambda: write_lane_catalog(self.project, 'world'))

    def test_the_coverage_report_is_refused_before_the_machine_schedule_read(self):
        self.assert_refused_without_writing(lambda: write_coverage_report(self.project, lane_store_root(self.project, 'world'), ('world',),
                                                                          run_command=refuse_any_machine_schedule_read))

    def test_a_converter_work_folder_is_refused(self):
        self.assert_refused_without_writing(lambda: Converter(self.project / 'client', self.lane_stores / 'actors' / 'converter',
                                                              self.project / 'umodel.exe', project_root=self.project))


class RealRepositoryGapRowsGuardTests(unittest.TestCase):
    def test_gap_rows_of_the_real_world_lane_are_refused_before_any_write(self):
        gap_rows_path = lane_gap_rows_path(REPOSITORY_ROOT, 'world', GUARD_PROBE_STEP)
        with self.assertRaisesRegex(RealLaneStoreWriteRefusedError, REFUSAL_PATTERN):
            write_gap_rows(REPOSITORY_ROOT, 'world', GUARD_PROBE_STEP, [])
        self.assertFalse(gap_rows_path.exists())


if __name__ == '__main__':
    unittest.main()
