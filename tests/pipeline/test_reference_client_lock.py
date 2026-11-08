import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_reference_client_lock import FILE_CLASSES, FILE_FIELDS, hashing_script_sha256
from reference_client_guard import (DATABASE_PC_CONVERSION_ROOT, REFERENCE_CLIENT_LOCK_PATH, ReferenceClientLockError,
    require_reference_client)

NATIVE_INPUTS_LOCK_PATH = ROOT / 'recipes' / 'native-inputs.lock.json'
MAXIMUM_LOCK_BYTES = 4 * 1024 * 1024
ENGINE_LIBRARY_PATH = 'system/Engine.dll'
VOLATILE_CLIENT_CONFIG_PATH = 'system/l2.ini'


def committed_reference_client_lock():
    return json.loads(REFERENCE_CLIENT_LOCK_PATH.read_bytes().decode('utf-8'))


def lock_record_by_casefolded_path(lock, relative_path):
    matches = [dict(zip(FILE_FIELDS, values)) for path, values in lock['files'].items()
               if path.casefold() == relative_path.casefold()]
    if len(matches) != 1:
        raise AssertionError(f'expected one lock record for {relative_path}, found {len(matches)}')
    return matches[0]


def native_inputs_engine_library_sha256():
    native_inputs = json.loads(NATIVE_INPUTS_LOCK_PATH.read_bytes().decode('utf-8'))
    return next(record['sha256'] for record in native_inputs['files'] if record['relativePath'] == ENGINE_LIBRARY_PATH)


class CommittedReferenceClientLockTests(unittest.TestCase):
    def setUp(self):
        self.lock = committed_reference_client_lock()

    def test_schema_version_and_size_cap(self):
        self.assertEqual(self.lock['schemaVersion'], 1)
        self.assertLess(REFERENCE_CLIENT_LOCK_PATH.stat().st_size, MAXIMUM_LOCK_BYTES)

    def test_class_counts_cover_every_file_record(self):
        self.assertEqual(sum(self.lock['classCounts'].values()), len(self.lock['files']))
        self.assertEqual(set(self.lock['classCounts']), set(FILE_CLASSES))

    def test_every_file_record_has_six_fields_and_a_known_class(self):
        self.assertEqual(self.lock['fileFields'], list(FILE_FIELDS))
        for path, values in self.lock['files'].items():
            self.assertEqual(len(values), len(FILE_FIELDS), path)
            self.assertIn(values[0], FILE_CLASSES, path)

    def test_engine_library_is_equal_and_matches_the_native_inputs_lock(self):
        record = lock_record_by_casefolded_path(self.lock, ENGINE_LIBRARY_PATH)
        self.assertEqual(record['class'], 'equal')
        self.assertEqual(record['importaSha256'], native_inputs_engine_library_sha256())
        self.assertEqual(record['eSha256'], record['importaSha256'])

    def test_client_config_is_volatile(self):
        self.assertEqual(lock_record_by_casefolded_path(self.lock, VOLATILE_CLIENT_CONFIG_PATH)['class'], 'volatile-config')

    def test_lock_records_the_current_tracked_hashing_script(self):
        self.assertEqual(self.lock['hashingScriptSha256'], hashing_script_sha256())


@unittest.skipUnless(DATABASE_PC_CONVERSION_ROOT.is_dir(), 'E:/Lineage2-client is not present on this machine')
class RealConversionTreeGuardTests(unittest.TestCase):
    def test_guard_accepts_the_equal_engine_library(self):
        path = require_reference_client(DATABASE_PC_CONVERSION_ROOT).require_equal_file(ENGINE_LIBRARY_PATH)
        self.assertTrue(path.is_file())

    def test_guard_refuses_the_volatile_client_config(self):
        with self.assertRaisesRegex(ReferenceClientLockError, 'volatile-config'):
            require_reference_client(DATABASE_PC_CONVERSION_ROOT).require_equal_file(VOLATILE_CLIENT_CONFIG_PATH)


if __name__ == '__main__':
    unittest.main()
