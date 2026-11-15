import contextlib
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import character_class_sources, convert_actors, item_unit_workers
from native_store import interprocess_lock as interprocess_lock_module, share_identical_lane_files as sharing_command
from native_store.interprocess_lock import (LOCK_FILE_SUFFIX, InterprocessLockError, LaneInUseError, hold_lane_in_use_part_until_process_end,
                                            interprocess_lock, lane_batch_lock, lane_lock_file_path, lane_lock_folder, lane_sharing_lock,
                                            lock_file_path)
from native_store.lane_sharing_candidates import LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK
from native_store.store_paths import lane_work_root
from support.interprocess_lock_programs import event_marker_path
from support.item_unit_worker_runs import wait_until_path_exists
from support.shared_lane_fixture import SharedLaneFixture, link_count, payload_of, run_sharing_command
from test_interprocess_lock import LOCK_PROGRAM_TIMEOUT_SECONDS, lock_program_command
from world import convert_tile, convert_tile_batch, tile_step_workers
from world.tile_step_workers import BATCH_EXIT_ERROR

ANOTHER_RUN_HOLDER = 'another batch, conversion or sharing run'
CONVERSION_PROCESS_HOLDER = 'a conversion process, which may be a worker left by a stopped batch'
FIRST_KEY = 'unit:first'
SECOND_KEY = 'unit:second'
FIRST_STOPPED_POSITION = SimpleNamespace(value=0)
TWIN = payload_of('twin')


def lane_refusal_text(lane_name, holder, work_root):
    return f'lane {lane_name} is in use by {holder} and this run does not wait for it: {lane_lock_file_path(work_root)}'


class LaneLockTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.project_root = self.temporary_root / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.events_folder = self.temporary_root / 'events'
        self.events_folder.mkdir()
        self.world_work_root = lane_work_root(self.project_root, 'world')
        self.actors_work_root = lane_work_root(self.project_root, 'actors')

    def release_path(self, process_name):
        return self.temporary_root / (process_name + '.release')

    def start_holder(self, program_name, process_name, work_root=None):
        process = subprocess.Popen(lock_program_command(program_name, work_root or self.world_work_root, self.events_folder, process_name,
                                                        self.release_path(process_name)),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.end_holder, process)
        wait_until_path_exists(event_marker_path(self.events_folder, process_name + ' entered'))
        return process

    def end_holder(self, process):
        if process.poll() is None:
            process.kill()
        process.communicate()

    def release_holder(self, process_name, process):
        self.release_path(process_name).write_bytes(b'')
        _, error_output = process.communicate(timeout=LOCK_PROGRAM_TIMEOUT_SECONDS)
        self.assertEqual(process.returncode, 0, error_output)

    def assert_lane_is_refused(self, lane_lock, holder):
        with self.assertRaises(LaneInUseError) as refusal:
            with lane_lock(self.world_work_root):
                self.fail('the lane was granted')
        self.assertEqual(str(refusal.exception), lane_refusal_text('world', holder, self.world_work_root))
        self.assertIsInstance(refusal.exception, InterprocessLockError)
        self.assertNotIsInstance(refusal.exception, ValueError)


class LaneBatchLockTests(LaneLockTestCase):
    def test_a_second_batch_and_a_sharing_run_beside_a_batch_are_refused_at_once(self):
        self.start_holder('hold-lane-batch-parts', 'batch')
        for lane_lock in (lane_batch_lock, lane_sharing_lock):
            with self.subTest(lane_lock=lane_lock.__name__):
                self.assert_lane_is_refused(lane_lock, ANOTHER_RUN_HOLDER)

    def test_a_batch_a_worker_and_a_second_sharing_run_beside_a_sharing_run_are_refused_at_once(self):
        self.start_holder('hold-whole-lane', 'sharing')
        for lane_lock in (lane_batch_lock, lane_sharing_lock):
            with self.subTest(lane_lock=lane_lock.__name__):
                self.assert_lane_is_refused(lane_lock, ANOTHER_RUN_HOLDER)
        with self.assertRaises(LaneInUseError) as refusal:
            hold_lane_in_use_part_until_process_end(self.world_work_root)
        self.assertEqual(str(refusal.exception), lane_refusal_text('world', ANOTHER_RUN_HOLDER, self.world_work_root))
        self.assertEqual(interprocess_lock_module.lane_lock_files_held_until_process_end, [])

    def test_under_the_lane_batch_lock_the_waiting_locks_work_one_at_a_time_and_held_lock_file_path_stays_none(self):
        lock_folder = lane_lock_folder(self.world_work_root)
        with lane_batch_lock(self.world_work_root):
            self.assertIsNone(interprocess_lock_module.held_lock_file_path)
            with interprocess_lock(lock_folder, FIRST_KEY):
                self.assertEqual(interprocess_lock_module.held_lock_file_path, lock_file_path(lock_folder, FIRST_KEY))
                with self.assertRaises(InterprocessLockError):
                    with interprocess_lock(lock_folder, SECOND_KEY):
                        self.fail('a second waiting lock was granted')
            self.assertIsNone(interprocess_lock_module.held_lock_file_path)
            with interprocess_lock(lock_folder, SECOND_KEY):
                self.assertEqual(interprocess_lock_module.held_lock_file_path, lock_file_path(lock_folder, SECOND_KEY))
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)

    def test_a_worker_takes_the_in_use_part_beside_a_batch(self):
        self.start_holder('hold-lane-batch-parts', 'batch')
        worker = self.start_holder('hold-lane-in-use-part', 'worker')
        self.release_holder('worker', worker)

    def test_the_whole_lane_is_refused_beside_an_in_use_holder_whose_batch_was_killed_and_granted_once_that_holder_ends(self):
        batch = self.start_holder('hold-lane-batch-parts', 'batch')
        worker = self.start_holder('hold-lane-in-use-part', 'worker')
        self.assert_lane_is_refused(lane_sharing_lock, ANOTHER_RUN_HOLDER)
        batch.kill()
        batch.wait(timeout=LOCK_PROGRAM_TIMEOUT_SECONDS)
        self.assert_lane_is_refused(lane_sharing_lock, CONVERSION_PROCESS_HOLDER)
        self.release_holder('worker', worker)
        with lane_sharing_lock(self.world_work_root):
            self.assert_lane_is_refused(lane_batch_lock, ANOTHER_RUN_HOLDER)

    def test_beside_a_leftover_in_use_holder_a_batch_starts_and_its_exclusive_hold_of_the_in_use_part_is_refused(self):
        self.start_holder('hold-lane-in-use-part', 'worker')
        with lane_batch_lock(self.world_work_root) as held_lane_lock:
            with self.assertRaises(LaneInUseError) as refusal:
                held_lane_lock.hold_the_lane_in_use_part_exclusively()
            self.assertEqual(str(refusal.exception), lane_refusal_text('world', CONVERSION_PROCESS_HOLDER, self.world_work_root))
            self.assert_lane_is_refused(lane_batch_lock, ANOTHER_RUN_HOLDER)
        with lane_batch_lock(self.world_work_root):
            pass

    def test_a_batch_that_holds_the_in_use_part_exclusively_refuses_a_worker_and_frees_the_lane_when_it_leaves(self):
        with lane_batch_lock(self.world_work_root) as held_lane_lock:
            held_lane_lock.hold_the_lane_in_use_part_exclusively()
            with self.assertRaises(LaneInUseError):
                hold_lane_in_use_part_until_process_end(self.world_work_root)
        self.assertEqual(interprocess_lock_module.lane_lock_files_held_until_process_end, [])
        with lane_sharing_lock(self.world_work_root):
            pass
        lane_lock_file = lane_lock_folder(self.world_work_root) / (hashlib.sha256(b'lane').hexdigest() + LOCK_FILE_SUFFIX)
        self.assertEqual((lane_lock_file_path(self.world_work_root), sorted(lane_lock_folder(self.world_work_root).iterdir())),
                         (lane_lock_file, [lane_lock_file]))

    def test_the_lock_of_one_lane_leaves_the_other_lanes_free(self):
        with lane_sharing_lock(self.world_work_root), lane_batch_lock(self.actors_work_root), lane_sharing_lock(
                lane_work_root(self.project_root, 'integration')):
            self.assert_lane_is_refused(lane_batch_lock, ANOTHER_RUN_HOLDER)

    def test_the_in_use_part_held_until_process_end_keeps_its_open_lock_file_and_lets_a_batch_in_but_no_sharing_run(self):
        held_lock_files = []
        self.addCleanup(lambda: [lock_file.close() for lock_file in held_lock_files])
        with mock.patch.object(interprocess_lock_module, 'lane_lock_files_held_until_process_end', held_lock_files):
            hold_lane_in_use_part_until_process_end(self.world_work_root)
        [lock_file] = held_lock_files
        self.assertEqual((Path(lock_file.name), lock_file.closed), (lane_lock_file_path(self.world_work_root), False))
        self.assert_lane_is_refused(lane_sharing_lock, CONVERSION_PROCESS_HOLDER)
        with lane_batch_lock(self.world_work_root):
            self.assertIsNone(interprocess_lock_module.held_lock_file_path)


class WorkerInitializerLaneLockTests(LaneLockTestCase):
    def test_the_tile_step_worker_initializer_holds_the_in_use_part_of_the_world_work_root_of_its_run(self):
        run = SimpleNamespace(project_root=self.project_root)
        with (mock.patch.object(tile_step_workers, 'hold_lane_in_use_part_until_process_end') as hold_lane_in_use_part,
              mock.patch.object(tile_step_workers, 'tile_step_worker', None)):
            tile_step_workers.initialize_tile_step_worker(lambda built_run: built_run, (run,), FIRST_STOPPED_POSITION)
            self.assertEqual(tile_step_workers.tile_step_worker, (run, FIRST_STOPPED_POSITION))
        self.assertEqual(hold_lane_in_use_part.call_args_list, [mock.call(self.world_work_root)])

    def test_the_item_unit_worker_initializer_holds_the_in_use_part_of_the_ledger_work_root_of_its_run(self):
        run, preflight = SimpleNamespace(ledger=SimpleNamespace(work_root=self.actors_work_root)), mock.Mock()
        with (mock.patch.object(item_unit_workers, 'hold_lane_in_use_part_until_process_end') as hold_lane_in_use_part,
              mock.patch.object(item_unit_workers, 'item_unit_worker', None)):
            item_unit_workers.initialize_item_unit_worker(lambda built_run: built_run, (run,), preflight)
            self.assertEqual(item_unit_workers.item_unit_worker, (run, preflight))
        self.assertEqual(hold_lane_in_use_part.call_args_list, [mock.call(self.actors_work_root)])


class ConvertingMainLaneLockTests(LaneLockTestCase):
    def setUp(self):
        super().setUp()
        self.no_work = mock.Mock(side_effect=AssertionError('work was done beside a held lane'))

    def run_main_beside_a_held_lane(self, work_root, main, arguments):
        standard_output, standard_error = io.StringIO(), io.StringIO()
        with lane_batch_lock(work_root), contextlib.redirect_stdout(standard_output), contextlib.redirect_stderr(standard_error):
            exit_code = main(arguments)
        return exit_code, standard_output.getvalue(), standard_error.getvalue()

    def test_convert_tile_refuses_a_held_world_lane_and_does_no_work(self):
        with mock.patch.multiple(convert_tile, REPOSITORY_ROOT=self.project_root, require_reference_client=mock.DEFAULT,
                                 require_batch_preflight=mock.DEFAULT, run_at_below_normal_priority=mock.DEFAULT,
                                 lane_coverage_refreshed_at_exit=self.no_work, run_tile_step=self.no_work):
            outcome = self.run_main_beside_a_held_lane(self.world_work_root, convert_tile.main,
                                                       ['--client', 'client', '--map', '20_21', '--step', 'raw'])
        self.assertEqual(outcome, (1, '', 'Tile conversion failed: '
                                   + lane_refusal_text('world', ANOTHER_RUN_HOLDER, self.world_work_root) + '\n'))
        self.assertEqual([path.name for path in self.world_work_root.iterdir()], ['interprocess-locks'])

    def test_the_tile_batch_refuses_a_held_world_lane_and_does_no_work(self):
        with mock.patch.multiple(convert_tile_batch, REPOSITORY_ROOT=self.project_root, require_reference_client=mock.DEFAULT,
                                 run_tile_batch=self.no_work, refresh_world_lane_outputs=self.no_work):
            outcome = self.run_main_beside_a_held_lane(self.world_work_root, convert_tile_batch.main, ['--eligible', '--limit', '1'])
        self.assertEqual(outcome, (BATCH_EXIT_ERROR, '', 'Tile batch failed: '
                                   + lane_refusal_text('world', ANOTHER_RUN_HOLDER, self.world_work_root) + '\n'))

    def test_convert_actors_refuses_a_held_actors_lane_and_does_no_work(self):
        with mock.patch.multiple(convert_actors, REPOSITORY_ROOT=self.project_root, require_actors_lane_store_output=mock.DEFAULT,
                                 require_reference_client=mock.DEFAULT, require_batch_preflight=mock.DEFAULT,
                                 run_at_below_normal_priority=mock.DEFAULT, lane_coverage_refreshed_at_exit=self.no_work,
                                 Converter=self.no_work, convert_npc=self.no_work):
            outcome = self.run_main_beside_a_held_lane(self.actors_work_root, convert_actors.main, ['--client', 'client', '--npc', '1'])
        self.assertEqual(outcome, (1, '', 'Actor conversion failed: '
                                   + lane_refusal_text('actors', ANOTHER_RUN_HOLDER, self.actors_work_root) + '\n'))

    def test_the_printed_batch_plan_of_convert_actors_takes_no_lane_lock(self):
        with mock.patch.multiple(convert_actors, REPOSITORY_ROOT=self.project_root, require_actors_lane_store_output=mock.DEFAULT,
                                 require_reference_client=mock.DEFAULT, print_batch_plan=mock.DEFAULT,
                                 lane_batch_lock=self.no_work) as replaced:
            outcome = self.run_main_beside_a_held_lane(self.actors_work_root, convert_actors.main, ['--client', 'client', '--print-batch-plan'])
        self.assertEqual((outcome, replaced['print_batch_plan'].call_count), ((0, '', ''), 1))

    def test_the_character_class_search_refuses_a_held_actors_lane_and_does_no_work(self):
        client_root = self.temporary_root / 'client'
        client_root.mkdir()
        with (mock.patch.multiple(character_class_sources, REPOSITORY_ROOT=self.project_root, require_reference_client=mock.DEFAULT,
                                  require_committed_destination=mock.DEFAULT, character_class_sources_document=self.no_work,
                                  write_committed_world_bytes=self.no_work),
              mock.patch('native_catalog.tables.decode_table', self.no_work)):
            outcome = self.run_main_beside_a_held_lane(self.actors_work_root, character_class_sources.main, ['--client', str(client_root)])
        self.assertEqual(outcome, (1, '', lane_refusal_text('actors', ANOTHER_RUN_HOLDER, self.actors_work_root) + '\n'))

    def test_the_character_class_search_builds_and_writes_its_document_under_the_actors_lane_lock(self):
        client_root = self.temporary_root / 'client'
        client_root.mkdir()
        refusals_under_the_lock = []

        def refused_second_batch(*arguments):
            with self.assertRaises(LaneInUseError) as refusal:
                with lane_batch_lock(self.actors_work_root):
                    self.fail('the lane was granted')
            refusals_under_the_lock.append(str(refusal.exception))
            return {'verdict': 'not-decided', 'rows': {}}

        with (mock.patch.multiple(character_class_sources, REPOSITORY_ROOT=self.project_root, require_reference_client=mock.DEFAULT,
                                  require_committed_destination=mock.DEFAULT, character_class_sources_document=refused_second_batch,
                                  write_committed_world_bytes=refused_second_batch),
              mock.patch('native_catalog.tables.decode_table'), contextlib.redirect_stdout(io.StringIO())):
            exit_code = character_class_sources.main(['--client', str(client_root)])
        self.assertEqual((exit_code, refusals_under_the_lock),
                         (0, [lane_refusal_text('actors', ANOTHER_RUN_HOLDER, self.actors_work_root)] * 2))
        with lane_sharing_lock(self.actors_work_root):
            pass


class SharingCommandLaneLockTests(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)
        self.twin_paths = [self.lanes.write_store_file(lane_name, 'models/twin.bin', TWIN) for lane_name in ('world', 'integration', 'actors')]

    def work_root(self, lane_name):
        return self.lanes.lane_folder(lane_name) / 'work'

    def test_plan_mode_takes_no_lock_makes_no_lock_file_and_names_the_lanes_of_the_constant_free(self):
        with (mock.patch.object(sharing_command, 'lane_sharing_lock', side_effect=AssertionError('plan mode took a lane lock')),
              mock.patch.object(sharing_command, 'share_identical_lane_files', wraps=sharing_command.share_identical_lane_files) as share):
            exit_code, _, error, _ = run_sharing_command(self.lanes.lane_stores_root, '--plan')
        self.assertEqual((exit_code, error), (0, ''))
        self.assertEqual(share.call_args_list, [mock.call(self.lanes.lane_stores_root, ['actors', 'integration', 'world'], True,
                                                          LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK)])
        self.assertEqual([path for path in self.lanes.lane_stores_root.rglob('*') if 'interprocess-locks' in path.parts], [])
        with lane_batch_lock(self.work_root('actors')):
            self.assertEqual(run_sharing_command(self.lanes.lane_stores_root, '--plan')[0], 0)

    def test_a_run_holds_every_lane_whole_in_sorted_order_before_it_shares_and_names_every_lane_free(self):
        events = []

        def refused_lanes_while_sharing(root, lane_names, plan_only, lanes_free_of_conversions):
            for lane_name in lane_names:
                with self.assertRaises(LaneInUseError):
                    hold_lane_in_use_part_until_process_end(self.work_root(lane_name))
            events.append(('share', lane_names, plan_only, lanes_free_of_conversions))
            return {}

        def recorded_lane_sharing_lock(work_root):
            events.append(('lock', work_root))
            return lane_sharing_lock(work_root)

        with (mock.patch.object(sharing_command, 'lane_sharing_lock', recorded_lane_sharing_lock),
              mock.patch.object(sharing_command, 'share_identical_lane_files', refused_lanes_while_sharing)):
            exit_code, output, error, _ = run_sharing_command(self.lanes.lane_stores_root)
        lane_names = ['actors', 'integration', 'world']
        self.assertEqual((exit_code, output, error), (0, '{}\n', ''))
        self.assertEqual(events, [*(('lock', self.work_root(lane_name)) for lane_name in lane_names),
                                  ('share', lane_names, False, lane_names)])
        for lane_name in lane_names:
            with lane_sharing_lock(self.work_root(lane_name)):
                pass

    def test_a_run_beside_a_batch_or_a_leftover_worker_of_any_lane_is_refused_and_shares_nothing(self):
        held_lock_files = []
        self.addCleanup(lambda: [lock_file.close() for lock_file in held_lock_files])
        with mock.patch.object(interprocess_lock_module, 'lane_lock_files_held_until_process_end', held_lock_files):
            hold_lane_in_use_part_until_process_end(self.work_root('world'))
        exit_code, output, error, _ = run_sharing_command(self.lanes.lane_stores_root)
        self.assertEqual((exit_code, output, error),
                         (1, '', lane_refusal_text('world', CONVERSION_PROCESS_HOLDER, self.work_root('world')) + '\n'))
        with lane_batch_lock(self.work_root('integration')):
            exit_code, output, error, _ = run_sharing_command(self.lanes.lane_stores_root)
        self.assertEqual((exit_code, output, error),
                         (1, '', lane_refusal_text('integration', ANOTHER_RUN_HOLDER, self.work_root('integration')) + '\n'))
        self.assertEqual([link_count(path) for path in self.twin_paths], [1, 1, 1])
        self.assertEqual([path for path in self.lanes.lane_stores_root.rglob('*') if 'identical-file-sharing' in path.parts], [])
        with lane_sharing_lock(self.work_root('actors')):
            pass


if __name__ == '__main__':
    unittest.main()
