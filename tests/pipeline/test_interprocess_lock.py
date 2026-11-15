import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import interprocess_lock as interprocess_lock_module
from native_store.interprocess_lock import (INTERPROCESS_LOCK_FOLDER_NAME, LOCK_FILE_SUFFIX, InterprocessLockError, convert_under_request_lock,
                                            interprocess_lock, lane_lock_folder, lock_file_path)
from support.interprocess_lock_programs import event_marker_path, recorded_events
from support.item_unit_worker_runs import wait_until_path_exists

LOCK_PROGRAM = '\n'.join([
    'import sys',
    'sys.path[:0] = sys.argv[1:3]',
    'from support.interprocess_lock_programs import run_lock_program',
    'run_lock_program(sys.argv[3:])',
])
LOCK_PROGRAM_TIMEOUT_SECONDS = 60
SECOND_PROCESS_STILL_WAITING_SECONDS = 1
SHARED_KEY = 'unit:shared'
OTHER_KEY = 'unit:other'
MODEL_REQUEST = {'kind': 'model', 'package': 'staticmeshes/Rock.usx', 'object': 'Rock.Rock_S'}
OTHER_MODEL_REQUEST = {'kind': 'model', 'package': 'staticmeshes/Rock.usx', 'object': 'Rock.Rock_L'}
CONVERSION_RESULT = {'file': 'asset.l2asset', 'sha256': 'a' * 64}


def lock_program_command(*arguments):
    return [sys.executable, '-B', '-c', LOCK_PROGRAM, str(ROOT / 'scripts'), str(ROOT / 'tests' / 'pipeline'), *(str(argument) for argument in arguments)]


class LockRecordingConverter:
    def __init__(self, output, error=None):
        self.output, self.error, self.held_lock_file_paths, self.requests = output, error, [], []

    def convert(self, request):
        self.requests.append(request)
        self.held_lock_file_paths.append(interprocess_lock_module.held_lock_file_path)
        if self.error is not None:
            raise self.error
        return CONVERSION_RESULT


class InterprocessLockTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.lock_folder = self.temporary_root / 'work' / INTERPROCESS_LOCK_FOLDER_NAME
        self.events_folder = self.temporary_root / 'events'
        self.events_folder.mkdir()
        self.release_path = self.temporary_root / 'release'

    def start_lock_program(self, *arguments):
        process = subprocess.Popen(lock_program_command(*arguments), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.end_lock_program, process)
        return process

    def end_lock_program(self, process):
        if process.poll() is None:
            process.kill()
        process.communicate()

    def require_exit_code_zero(self, process):
        _, error_output = process.communicate(timeout=LOCK_PROGRAM_TIMEOUT_SECONDS)
        self.assertEqual(process.returncode, 0, error_output)

    def run_lock_program(self, *arguments):
        completed = subprocess.run(lock_program_command(*arguments), capture_output=True, text=True, check=False,
                                   timeout=LOCK_PROGRAM_TIMEOUT_SECONDS)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def start_first_process_holding(self, key):
        first = self.start_lock_program('hold-until-released', self.lock_folder, key, self.events_folder, 'first', self.release_path)
        wait_until_path_exists(event_marker_path(self.events_folder, 'first entered'))
        return first

    def test_a_second_process_enters_the_same_key_only_after_the_first_leaves(self):
        first = self.start_first_process_holding(SHARED_KEY)
        second = self.start_lock_program('announce-then-enter', self.lock_folder, SHARED_KEY, self.events_folder, 'second')
        wait_until_path_exists(event_marker_path(self.events_folder, 'second waiting'))
        with self.assertRaises(subprocess.TimeoutExpired):
            second.wait(timeout=SECOND_PROCESS_STILL_WAITING_SECONDS)
        self.assertEqual(recorded_events(self.events_folder), ['first entered', 'second waiting'])
        self.release_path.write_bytes(b'')
        self.require_exit_code_zero(first)
        self.require_exit_code_zero(second)
        self.assertEqual(recorded_events(self.events_folder), ['first entered', 'second waiting', 'first leaving', 'second entered'])

    def test_two_processes_with_different_keys_do_not_wait_for_each_other(self):
        first = self.start_first_process_holding(SHARED_KEY)
        self.run_lock_program('announce-then-enter', self.lock_folder, OTHER_KEY, self.events_folder, 'second')
        self.assertEqual(recorded_events(self.events_folder), ['first entered', 'second waiting', 'second entered'])
        self.release_path.write_bytes(b'')
        self.require_exit_code_zero(first)

    def test_a_process_that_exits_while_holding_the_lock_frees_it(self):
        self.run_lock_program('exit-while-holding', self.lock_folder, SHARED_KEY, self.events_folder, 'first')
        self.run_lock_program('announce-then-enter', self.lock_folder, SHARED_KEY, self.events_folder, 'second')
        self.assertEqual(recorded_events(self.events_folder), ['first entered', 'second waiting', 'second entered'])

    def test_a_process_that_holds_a_lock_is_refused_a_second_lock(self):
        with interprocess_lock(self.lock_folder, SHARED_KEY):
            with self.assertRaises(InterprocessLockError) as refusal:
                with interprocess_lock(self.lock_folder, OTHER_KEY):
                    self.fail('a second lock was granted')
            self.assertEqual(interprocess_lock_module.held_lock_file_path, lock_file_path(self.lock_folder, SHARED_KEY))
        self.assertIn(str(lock_file_path(self.lock_folder, SHARED_KEY)), str(refusal.exception))
        self.assertIn(str(lock_file_path(self.lock_folder, OTHER_KEY)), str(refusal.exception))
        self.assertNotIsInstance(refusal.exception, ValueError)
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)
        self.run_lock_program('announce-then-enter', self.lock_folder, SHARED_KEY, self.events_folder, 'second')
        with interprocess_lock(self.lock_folder, OTHER_KEY):
            self.assertEqual(interprocess_lock_module.held_lock_file_path, lock_file_path(self.lock_folder, OTHER_KEY))

    def test_the_lock_file_is_named_by_the_sha256_of_its_key_and_stays_after_release(self):
        expected_path = self.lock_folder / (hashlib.sha256(SHARED_KEY.encode('utf-8')).hexdigest() + LOCK_FILE_SUFFIX)
        self.assertEqual(lock_file_path(self.lock_folder, SHARED_KEY), expected_path)
        self.assertFalse(expected_path.exists())
        with interprocess_lock(self.lock_folder, SHARED_KEY):
            self.assertTrue(expected_path.is_file())
        self.assertEqual(sorted(self.lock_folder.iterdir()), [expected_path])
        self.assertEqual(lane_lock_folder(self.temporary_root / 'work'), self.lock_folder)

    def test_a_conversion_runs_under_the_lock_of_its_converter_folder_and_request(self):
        converter = LockRecordingConverter(self.temporary_root / 'work' / 'static-mesh-converter')
        other_folder_converter = LockRecordingConverter(self.temporary_root / 'work' / 'sound-converter')
        self.assertEqual(convert_under_request_lock(converter, MODEL_REQUEST), CONVERSION_RESULT)
        convert_under_request_lock(converter, dict(reversed(MODEL_REQUEST.items())))
        convert_under_request_lock(converter, OTHER_MODEL_REQUEST)
        convert_under_request_lock(other_folder_converter, MODEL_REQUEST)
        same_request_path, other_key_order_path, other_request_path = converter.held_lock_file_paths
        other_folder_path, = other_folder_converter.held_lock_file_paths
        self.assertEqual(converter.requests[0], MODEL_REQUEST)
        self.assertEqual(same_request_path.parent, self.lock_folder)
        self.assertTrue(same_request_path.is_file())
        self.assertEqual(other_key_order_path, same_request_path)
        self.assertEqual(len({same_request_path, other_request_path, other_folder_path}), 3)
        self.assertEqual({path.parent for path in (other_request_path, other_folder_path)}, {self.lock_folder})
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)
        refusal = ValueError('UModel failed or reported an error')
        raising_converter = LockRecordingConverter(converter.output, refusal)
        with self.assertRaises(ValueError) as caught:
            convert_under_request_lock(raising_converter, MODEL_REQUEST)
        self.assertIs(caught.exception, refusal)
        self.assertEqual(raising_converter.held_lock_file_paths, [same_request_path])
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)
        self.assertEqual(convert_under_request_lock(converter, MODEL_REQUEST), CONVERSION_RESULT)


if __name__ == '__main__':
    unittest.main()
