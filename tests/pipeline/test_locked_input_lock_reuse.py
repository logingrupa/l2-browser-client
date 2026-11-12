import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store import unit_ledger
from native_store.unit_ledger import UnitLedgerError, locked_input_records
from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS, ReferenceClientLockError

FIRST_MAP_PATH, SECOND_MAP_PATH = 'maps/20_21.unr', 'maps/20_22.unr'
FIRST_MAP_SHA256, SECOND_MAP_SHA256 = 'c' * 64, 'd' * 64


def equal_lock_file_entry(sha256):
    return ['equal', 10, sha256, 10, sha256, 1]


class LockedInputLockReuseTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.lock_folder = Path(temporary_directory.name).resolve() / 'recipes'
        (self.lock_folder / 'sibling').mkdir(parents=True)
        self.lock_path = self.lock_folder / 'reference-client-tree.lock.json'
        self.lock_path_through_the_sibling_folder = self.lock_folder / 'sibling' / '..' / self.lock_path.name
        patcher = mock.patch.object(unit_ledger, 'read_reference_client_lock', wraps=unit_ledger.read_reference_client_lock)
        self.read_reference_client_lock = patcher.start()
        self.addCleanup(patcher.stop)

    def write_lock(self, files, schema_version=1):
        self.lock_path.write_text(json.dumps({'schemaVersion': schema_version, 'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client',
                                              'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS, 'files': files}), encoding='utf-8')

    def test_ten_calls_through_two_spellings_of_one_lock_path_parse_the_lock_once(self):
        self.write_lock({FIRST_MAP_PATH: equal_lock_file_entry(FIRST_MAP_SHA256)})
        self.assertNotEqual(str(self.lock_path_through_the_sibling_folder), str(self.lock_path))
        for call_index in range(10):
            lock_path = self.lock_path if call_index % 2 == 0 else self.lock_path_through_the_sibling_folder
            self.assertEqual(locked_input_records([FIRST_MAP_PATH], lock_path), [{'path': FIRST_MAP_PATH, 'sha256': FIRST_MAP_SHA256}])
        self.assertEqual(self.read_reference_client_lock.call_count, 1)

    def test_a_rewritten_lock_is_parsed_again_and_gives_its_new_record(self):
        self.write_lock({FIRST_MAP_PATH: equal_lock_file_entry(FIRST_MAP_SHA256)})
        with self.assertRaisesRegex(UnitLedgerError, 'no record'):
            locked_input_records([SECOND_MAP_PATH], self.lock_path)
        first_lock_bytes = self.lock_path.stat().st_size
        self.write_lock({FIRST_MAP_PATH: equal_lock_file_entry(FIRST_MAP_SHA256), SECOND_MAP_PATH: equal_lock_file_entry(SECOND_MAP_SHA256)})
        self.assertNotEqual(self.lock_path.stat().st_size, first_lock_bytes)
        self.assertEqual(locked_input_records([SECOND_MAP_PATH], self.lock_path), [{'path': SECOND_MAP_PATH, 'sha256': SECOND_MAP_SHA256}])
        locked_input_records([FIRST_MAP_PATH], self.lock_path)
        self.assertEqual(self.read_reference_client_lock.call_count, 2)

    def test_a_missing_lock_is_refused_on_every_call(self):
        for _ in range(2):
            with self.assertRaisesRegex(ReferenceClientLockError, '^reference client lock missing: '):
                locked_input_records([FIRST_MAP_PATH], self.lock_path)

    def test_a_refused_lock_names_the_path_as_given_and_is_parsed_again_on_the_next_call(self):
        self.write_lock({}, schema_version=2)
        for _ in range(2):
            with self.assertRaises(ReferenceClientLockError) as refusal:
                locked_input_records([FIRST_MAP_PATH], self.lock_path_through_the_sibling_folder)
            self.assertEqual(str(refusal.exception),
                             f'reference client lock schemaVersion must be 1: {self.lock_path_through_the_sibling_folder}')
        self.assertEqual(self.read_reference_client_lock.call_count, 2)


if __name__ == '__main__':
    unittest.main()
