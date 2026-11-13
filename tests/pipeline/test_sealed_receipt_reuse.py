import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import NamedTuple
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
PIPELINE_TESTS_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store import unit_ledger
from native_store.unit_ledger import RECEIPT_RECORD_NAME, SEAL_RECORD_NAME, UnitLedger, UnitLedgerError

UNIT_KEY = 'tile:20_21'
OTHER_UNIT_KEY = 'tile:20_22'
DOUBLE_UNDERSCORE_UNIT_KEY = 'part:a__b'
COLON_UNIT_KEY = 'part:a:b'
RAW_STEP = 'raw'
TERRAIN_STEP = 'terrain'
INPUT_RECORD = {'path': 'maps/input.unr', 'sha256': 'a' * 64}
FIRST_CONFIG = {'chunkSize': 4}
SECOND_CONFIG = {'chunkSize': 8}
OUTPUT_PAYLOADS_BY_NAME = {'heights.bin': b'\x00\x01\x02', 'tile.json': b'{"tile":"synthetic"}\n'}
FIRST_RIGA_TIME = '2026-11-13T10:00:00+02:00'
LATER_RIGA_TIME = '2026-11-13T11:00:00+02:00'
FREE_BYTES = 8000
MISMATCH_ERROR_PATTERN = 'seal .* does not match its receipt'
CHILD_RESEAL_PROGRAM = '\n'.join([
    'import json, sys',
    'scripts_root, pipeline_tests_root, work_root, step, unit_key, config_json = sys.argv[1:]',
    'sys.path[:0] = [scripts_root, pipeline_tests_root]',
    'from native_store.unit_ledger import UnitLedger',
    'from test_sealed_receipt_reuse import seal_synthetic_unit',
    'print(json.dumps(seal_synthetic_unit(UnitLedger(work_root, step, 1), unit_key, json.loads(config_json))))',
])
CHILD_SEALED_RECEIPT_PROGRAM = '\n'.join([
    'import sys',
    'scripts_root, work_root, step, unit_key = sys.argv[1:]',
    'sys.path.insert(0, scripts_root)',
    'from native_store.unit_ledger import UnitLedger, UnitLedgerError',
    'try:',
    '    UnitLedger(work_root, step, 1).sealed_receipt(unit_key)',
    'except UnitLedgerError as error:',
    '    print(error)',
])


class CountedChecks(NamedTuple):
    verifications: object
    output_checks: object

    def counts(self):
        return self.verifications.call_count, self.output_checks.call_count


def seal_synthetic_unit(ledger, unit_key, config):
    fingerprint = ledger.unit_fingerprint([INPUT_RECORD['sha256']], config)
    step_directory = ledger.begin(unit_key, fingerprint)
    outputs = []
    for name, payload in OUTPUT_PAYLOADS_BY_NAME.items():
        (step_directory / name).write_bytes(payload)
        outputs.append({'path': (step_directory / name).relative_to(ledger.lane_folder).as_posix(),
                        'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
    return ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': [INPUT_RECORD], 'outputs': outputs, 'gapRows': []})


@contextlib.contextmanager
def counted_checks():
    real_lane_output_path = UnitLedger.lane_output_path
    with (mock.patch.object(unit_ledger, 'read_ledger_record', wraps=unit_ledger.read_ledger_record) as verifications,
          mock.patch.object(UnitLedger, 'lane_output_path', autospec=True, side_effect=real_lane_output_path) as output_checks):
        yield CountedChecks(verifications, output_checks)


def replace_record(path, payload):
    path.unlink()
    path.write_bytes(payload)


def run_child_program(program, *arguments):
    completed = subprocess.run([sys.executable, '-B', '-c', program, *(str(argument) for argument in arguments)],
                               capture_output=True, text=True, check=False, timeout=120)
    if completed.returncode != 0:
        raise AssertionError(f'child interpreter exited {completed.returncode}: {completed.stderr}')
    return completed.stdout


class SealedReceiptReuseTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.work_root = self.project / 'artifacts' / 'lane-store' / 'world' / 'work'

    def ledger(self, step=RAW_STEP, riga_time=FIRST_RIGA_TIME):
        return UnitLedger(self.work_root, step, 1, riga_clock=lambda: riga_time, free_bytes=lambda path: FREE_BYTES, host='DATABASE-PC')

    def kept_receipt_key(self, ledger, unit_key=UNIT_KEY):
        return str(ledger.unit_step_directory(unit_key)), unit_key

    def assert_nothing_kept(self, ledger, unit_key=UNIT_KEY):
        self.assertNotIn(self.kept_receipt_key(ledger, unit_key), unit_ledger.verified_receipts_by_step_directory_and_unit_key)

    def sealed_and_kept_unit(self, ledger, config=FIRST_CONFIG):
        receipt = seal_synthetic_unit(ledger, UNIT_KEY, config)
        self.assertEqual(ledger.sealed_receipt(UNIT_KEY), receipt)
        self.assertIn(self.kept_receipt_key(ledger), unit_ledger.verified_receipts_by_step_directory_and_unit_key)
        return receipt

    def test_many_calls_on_one_sealed_unit_read_the_seal_and_check_the_outputs_once(self):
        ledger = self.ledger()
        receipt = seal_synthetic_unit(ledger, UNIT_KEY, FIRST_CONFIG)
        with counted_checks() as checks:
            receipts = [ledger.sealed_receipt(UNIT_KEY) for _ in range(10)]
            sealed_answers = [ledger.is_sealed(UNIT_KEY, receipt['fingerprint']) for _ in range(10)]
        self.assertEqual(receipts, [receipt] * 10)
        self.assertEqual(sealed_answers, [True] * 10)
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_a_second_ledger_object_of_the_same_lane_and_step_shares_the_kept_answer(self):
        receipt = seal_synthetic_unit(self.ledger(), UNIT_KEY, FIRST_CONFIG)
        with counted_checks() as checks:
            self.assertEqual(self.ledger().sealed_receipt(UNIT_KEY), receipt)
            self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))
            self.assertEqual(self.ledger().sealed_receipt(UNIT_KEY), receipt)
            self.assertTrue(self.ledger(riga_time=LATER_RIGA_TIME).is_sealed(UNIT_KEY, receipt['fingerprint']))
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_a_unit_sealed_again_with_another_fingerprint_is_verified_again_and_gives_the_new_receipt(self):
        ledger = self.ledger()
        old_receipt = self.sealed_and_kept_unit(ledger)
        new_receipt = seal_synthetic_unit(ledger, UNIT_KEY, SECOND_CONFIG)
        self.assertNotEqual(new_receipt['fingerprint'], old_receipt['fingerprint'])
        with counted_checks() as checks:
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), new_receipt)
            self.assertTrue(ledger.is_sealed(UNIT_KEY, new_receipt['fingerprint']))
            self.assertFalse(ledger.is_sealed(UNIT_KEY, old_receipt['fingerprint']))
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_a_unit_sealed_again_with_the_same_fingerprint_is_verified_again_and_gives_the_new_receipt(self):
        ledger = self.ledger()
        old_receipt = self.sealed_and_kept_unit(ledger)
        shutil.rmtree(ledger.unit_step_directory(UNIT_KEY))
        self.assertIsNone(ledger.sealed_receipt(UNIT_KEY))
        self.assert_nothing_kept(ledger)
        new_receipt = seal_synthetic_unit(self.ledger(riga_time=LATER_RIGA_TIME), UNIT_KEY, FIRST_CONFIG)
        self.assertEqual(new_receipt, {**old_receipt, 'finishedAtRiga': LATER_RIGA_TIME})
        with counted_checks() as checks:
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), new_receipt)
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), new_receipt)
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_a_resealed_unit_whose_records_have_the_size_and_the_modification_time_of_the_old_ones_is_verified_again(self):
        ledger = self.ledger()
        old_receipt = self.sealed_and_kept_unit(ledger)
        record_paths = [ledger.unit_step_directory(UNIT_KEY) / name for name in (SEAL_RECORD_NAME, RECEIPT_RECORD_NAME)]
        old_statuses = [path.stat() for path in record_paths]
        new_receipt = seal_synthetic_unit(ledger, UNIT_KEY, SECOND_CONFIG)
        for path, old_status in zip(record_paths, old_statuses, strict=True):
            os.utime(path, ns=(old_status.st_atime_ns, old_status.st_mtime_ns))
            new_status = path.stat()
            self.assertEqual((new_status.st_dev, new_status.st_size, new_status.st_mtime_ns),
                             (old_status.st_dev, old_status.st_size, old_status.st_mtime_ns), path.name)
            self.assertNotEqual(new_status.st_ino, old_status.st_ino, path.name)
        with counted_checks() as checks:
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), new_receipt)
        self.assertNotEqual(new_receipt, old_receipt)
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def assert_a_replaced_record_raises_the_mismatch_error_until_its_bytes_are_back(self, record_name, replacement_of):
        ledger = self.ledger()
        receipt = self.sealed_and_kept_unit(ledger)
        record_path = ledger.unit_step_directory(UNIT_KEY) / record_name
        original_bytes = record_path.read_bytes()
        replace_record(record_path, replacement_of(original_bytes))
        with counted_checks() as checks:
            for _ in range(2):
                with self.assertRaisesRegex(UnitLedgerError, MISMATCH_ERROR_PATTERN):
                    ledger.sealed_receipt(UNIT_KEY)
                self.assert_nothing_kept(ledger)
            self.assertEqual(checks.verifications.call_count, 2)
            replace_record(record_path, original_bytes)
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), receipt)
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), receipt)
        self.assertEqual(checks.counts(), (3, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_a_replaced_seal_record_is_verified_again_and_raises_the_mismatch_error(self):
        def seal_naming_another_receipt(seal_bytes):
            return json.dumps({**json.loads(seal_bytes), 'receiptSha256': '0' * 64}).encode('utf-8')
        self.assert_a_replaced_record_raises_the_mismatch_error_until_its_bytes_are_back(SEAL_RECORD_NAME, seal_naming_another_receipt)

    def test_a_replaced_receipt_record_is_verified_again_and_raises_the_mismatch_error(self):
        def receipt_of_another_host(receipt_bytes):
            return receipt_bytes.replace(b'DATABASE-PC', b'DATABASE-PD')
        self.assert_a_replaced_record_raises_the_mismatch_error_until_its_bytes_are_back(RECEIPT_RECORD_NAME, receipt_of_another_host)

    def test_a_missing_seal_returns_none_on_every_call_and_keeps_nothing(self):
        ledger = self.ledger()
        with counted_checks() as checks:
            for _ in range(2):
                self.assertIsNone(ledger.sealed_receipt(UNIT_KEY))
                self.assert_nothing_kept(ledger)
        receipt = self.sealed_and_kept_unit(ledger)
        (ledger.unit_step_directory(UNIT_KEY) / SEAL_RECORD_NAME).unlink()
        with counted_checks() as checks_after_the_unlink:
            for _ in range(2):
                self.assertIsNone(ledger.sealed_receipt(UNIT_KEY))
                self.assertFalse(ledger.is_sealed(UNIT_KEY, receipt['fingerprint']))
                self.assert_nothing_kept(ledger)
        self.assertEqual((checks.counts(), checks_after_the_unlink.counts()), ((0, 0), (0, 0)))

    def test_a_caller_that_changes_the_returned_receipt_does_not_change_what_the_next_caller_gets(self):
        ledger = self.ledger()
        receipt = seal_synthetic_unit(ledger, UNIT_KEY, FIRST_CONFIG)
        for _ in range(2):
            returned_receipt = ledger.sealed_receipt(UNIT_KEY)
            self.assertEqual(returned_receipt, receipt)
            returned_receipt['fingerprint'] = 'changed by the caller'
            returned_receipt['outputs'].clear()
            returned_receipt['config']['chunkSize'] = 64
        self.assertEqual(ledger.sealed_receipt(UNIT_KEY), receipt)

    def test_two_step_directories_do_not_share_an_answer(self):
        receipts_by_step_and_unit_key = {
            (RAW_STEP, UNIT_KEY): seal_synthetic_unit(self.ledger(RAW_STEP), UNIT_KEY, FIRST_CONFIG),
            (RAW_STEP, OTHER_UNIT_KEY): seal_synthetic_unit(self.ledger(RAW_STEP), OTHER_UNIT_KEY, SECOND_CONFIG),
            (TERRAIN_STEP, UNIT_KEY): seal_synthetic_unit(self.ledger(TERRAIN_STEP), UNIT_KEY, SECOND_CONFIG)}
        self.assertEqual(len({json.dumps(receipt, sort_keys=True) for receipt in receipts_by_step_and_unit_key.values()}), 3)
        with counted_checks() as checks:
            for _ in range(2):
                for (step, unit_key), receipt in receipts_by_step_and_unit_key.items():
                    self.assertEqual(self.ledger(step).sealed_receipt(unit_key), receipt, (step, unit_key))
            self.assertIsNone(self.ledger(TERRAIN_STEP).sealed_receipt(OTHER_UNIT_KEY))
        self.assertEqual(checks.counts(), (3, 3 * len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_two_unit_keys_of_one_step_directory_do_not_share_an_answer(self):
        ledger = self.ledger()
        receipt = seal_synthetic_unit(ledger, DOUBLE_UNDERSCORE_UNIT_KEY, FIRST_CONFIG)
        self.assertEqual(ledger.unit_step_directory(COLON_UNIT_KEY), ledger.unit_step_directory(DOUBLE_UNDERSCORE_UNIT_KEY))
        self.assertEqual(ledger.sealed_receipt(DOUBLE_UNDERSCORE_UNIT_KEY), receipt)
        for _ in range(2):
            with self.assertRaisesRegex(UnitLedgerError, MISMATCH_ERROR_PATTERN):
                ledger.sealed_receipt(COLON_UNIT_KEY)
            self.assert_nothing_kept(ledger, COLON_UNIT_KEY)
        self.assertEqual(ledger.sealed_receipt(DOUBLE_UNDERSCORE_UNIT_KEY), receipt)

    def test_a_unit_resealed_by_another_process_gives_its_new_receipt_to_a_process_that_kept_the_old_one(self):
        ledger = self.ledger()
        old_receipt = self.sealed_and_kept_unit(ledger)
        child_receipt = json.loads(run_child_program(CHILD_RESEAL_PROGRAM, SCRIPTS_ROOT, PIPELINE_TESTS_ROOT, self.work_root, RAW_STEP, UNIT_KEY,
                                                     json.dumps(SECOND_CONFIG)))
        self.assertNotEqual(child_receipt['fingerprint'], old_receipt['fingerprint'])
        with counted_checks() as checks:
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), child_receipt)
            self.assertTrue(ledger.is_sealed(UNIT_KEY, child_receipt['fingerprint']))
        self.assertEqual(checks.counts(), (1, len(OUTPUT_PAYLOADS_BY_NAME)))

    def test_an_output_deleted_after_the_kept_check_is_reported_by_a_new_process_and_not_by_this_one(self):
        ledger = self.ledger()
        receipt = self.sealed_and_kept_unit(ledger)
        deleted_output = receipt['outputs'][0]['path']
        (ledger.lane_folder / deleted_output).unlink()
        with counted_checks() as checks:
            self.assertEqual(ledger.sealed_receipt(UNIT_KEY), receipt)
        self.assertEqual(checks.counts(), (0, 0))
        child_report = run_child_program(CHILD_SEALED_RECEIPT_PROGRAM, SCRIPTS_ROOT, self.work_root, RAW_STEP, UNIT_KEY)
        self.assertRegex(child_report, f'^sealed output {deleted_output} of {UNIT_KEY} is missing or changed; remove ')


if __name__ == '__main__':
    unittest.main()
