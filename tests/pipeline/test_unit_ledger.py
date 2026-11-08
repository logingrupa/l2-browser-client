from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.store_paths import StorePathError
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, BELOW_NORMAL_PRIORITY_CLASS, BatchPreflightRefusedError,
                                      UnitLedger, UnitLedgerError, canonical_json_bytes, locked_input_records,
                                      require_batch_preflight, unit_directory_name)
from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
except (ImportError, AttributeError):
    JUNCTION_FACTORY = None

TEN_GIBIBYTES = 10 * 1024 ** 3
RIGA_WINTER_OFFSET = timezone(timedelta(hours=2))
RIGA_SUMMER_OFFSET = timezone(timedelta(hours=3))


def machine_schedule_command_at(host_name, instant_text=None):
    def run_machine_schedule(argument_list, **options):
        extra_arguments = ['--host', host_name] + (['--at', instant_text] if instant_text else [])
        return subprocess.run([*argument_list, *extra_arguments], **options)
    return run_machine_schedule


def disk_usage_reporting(free_bytes, measured_paths):
    def disk_usage(path):
        measured_paths.append(Path(path))
        return types.SimpleNamespace(total=free_bytes * 2, used=free_bytes, free=free_bytes)
    return disk_usage


class BatchPreflightTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.measured_paths = []

    def preflight(self, host_name, instant_text, *, free_bytes=TEN_GIBIBYTES, local_now=None, lane_name='world'):
        return require_batch_preflight(
            self.project, lane_name, BATCH_MINIMUM_FREE_BYTES,
            run_command=machine_schedule_command_at(host_name, instant_text),
            disk_usage=disk_usage_reporting(free_bytes, self.measured_paths),
            local_now=local_now or (lambda: datetime(2026, 11, 10, 14, 0, tzinfo=RIGA_WINTER_OFFSET)))

    def test_refuses_inside_the_prominence_backup_window_through_a_real_node_process(self):
        with self.assertRaises(BatchPreflightRefusedError) as refusal:
            self.preflight('PROMINENCE-PC', '2026-11-10T21:15:00Z')
        self.assertIn('inside nightly backup window', str(refusal.exception))
        self.assertIn('2026-11-10T23:15:00+02:00', str(refusal.exception))
        self.assertEqual(self.measured_paths, [])

    def test_returns_host_time_free_bytes_and_lane_root_outside_a_window(self):
        result = self.preflight('PROMINENCE-PC', '2026-11-10T12:00:00Z')
        lane_root = self.project / 'artifacts' / 'lane-store' / 'world' / 'l2'
        self.assertEqual(result, {'host': 'PROMINENCE-PC', 'rigaTime': '2026-11-10T14:00:00+02:00',
                                  'freeBytes': TEN_GIBIBYTES, 'laneStoreRoot': lane_root})
        self.assertEqual(self.measured_paths, [self.project / 'artifacts'])
        self.assertFalse((self.project / 'artifacts' / 'lane-store').exists())

    def test_database_pc_with_the_real_host_clock_passes(self):
        result = require_batch_preflight(self.project, 'actors', BATCH_MINIMUM_FREE_BYTES,
                                         run_command=machine_schedule_command_at('DATABASE-PC'),
                                         disk_usage=disk_usage_reporting(TEN_GIBIBYTES, self.measured_paths))
        self.assertEqual(result['host'], 'DATABASE-PC')
        self.assertRegex(result['rigaTime'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[23]:00$')

    def test_refuses_free_disk_below_the_floor_with_value_and_riga_time(self):
        with self.assertRaises(BatchPreflightRefusedError) as refusal:
            self.preflight('PROMINENCE-PC', '2026-11-10T12:00:00Z', free_bytes=BATCH_MINIMUM_FREE_BYTES - 1)
        self.assertEqual(str(refusal.exception), f'free disk {BATCH_MINIMUM_FREE_BYTES - 1} bytes is below the batch floor '
                                                 f'{BATCH_MINIMUM_FREE_BYTES} bytes at 2026-11-10T14:00:00+02:00')

    def test_refuses_a_host_clock_offset_that_differs_from_riga(self):
        with self.assertRaises(BatchPreflightRefusedError) as refusal:
            self.preflight('PROMINENCE-PC', '2026-11-10T12:00:00Z',
                           local_now=lambda: datetime(2026, 11, 10, 15, 0, tzinfo=RIGA_SUMMER_OFFSET))
        self.assertEqual(str(refusal.exception), 'host clock offset +03:00 differs from Europe/Riga +02:00')

    def test_reports_a_failing_schedule_check_as_an_error(self):
        with self.assertRaises(UnitLedgerError) as failure:
            self.preflight('PROMINENCE-PC', 'not-a-date')
        self.assertNotIsInstance(failure.exception, BatchPreflightRefusedError)
        self.assertIn('machine schedule check failed with exit 1', str(failure.exception))

    def test_refuses_an_unknown_lane(self):
        with self.assertRaises(BatchPreflightRefusedError) as refusal:
            self.preflight('PROMINENCE-PC', '2026-11-10T12:00:00Z', lane_name='nowhere')
        self.assertIn('unknown lane nowhere', str(refusal.exception))

    @unittest.skipIf(JUNCTION_FACTORY is None, 'NTFS junctions unavailable')
    def test_refuses_a_lane_root_that_resolves_into_the_shared_store(self):
        shared_store = self.project / 'public' / 'l2'
        shared_store.mkdir(parents=True)
        (self.project / 'artifacts' / 'lane-store').mkdir()
        JUNCTION_FACTORY(str(shared_store), str(self.project / 'artifacts' / 'lane-store' / 'world'))
        with self.assertRaises(BatchPreflightRefusedError) as refusal:
            self.preflight('PROMINENCE-PC', '2026-11-10T12:00:00Z')
        self.assertIn('Symlink/junction/reparse boundary refused', str(refusal.exception))
        self.assertEqual(list(shared_store.iterdir()), [])


RIGA_START_TIME = '2026-11-08T15:05:00+02:00'
RIGA_FINISH_TIME = '2026-11-08T15:06:00+02:00'
FIRST_INPUT_SHA256 = 'a' * 64
SECOND_INPUT_SHA256 = 'b' * 64
TILE_CONFIG = {'chunkSize': 4, 'layers': ['height', 'alpha']}


def sha256_of_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in root.rglob('*') if path.is_file()}


def read_json_file(path):
    return json.loads(path.read_text(encoding='utf-8'))


class UnitLedgerLifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.lane_folder = self.project / 'artifacts' / 'lane-store' / 'world'
        self.work_root = self.lane_folder / 'work'
        self.riga_times = []
        self.free_byte_values = []

    def ledger(self, step='raw', algorithm_version=1):
        def riga_clock():
            self.riga_times.append(RIGA_FINISH_TIME if self.riga_times else RIGA_START_TIME)
            return self.riga_times[-1]

        def free_bytes(path):
            self.free_byte_values.append(Path(path))
            return 9000 - 1000 * len(self.free_byte_values)
        return UnitLedger(self.work_root, step, algorithm_version, riga_clock=riga_clock, free_bytes=free_bytes, host='DATABASE-PC')

    def write_lane_output(self, relative_path, payload):
        path = self.lane_folder / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return {'path': relative_path, 'sha256': sha256_of_bytes(payload), 'bytes': len(payload)}

    def caller_receipt(self, outputs, config=None, input_sha256s=(SECOND_INPUT_SHA256, FIRST_INPUT_SHA256)):
        inputs = [{'path': f'maps/input_{index}.unr', 'sha256': value} for index, value in enumerate(input_sha256s)]
        return {'config': TILE_CONFIG if config is None else config, 'inputs': inputs, 'outputs': outputs, 'gapRows': []}

    def sealed_unit(self, ledger, unit_key='tile:20_21'):
        fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], TILE_CONFIG)
        ledger.begin(unit_key, fingerprint)
        output = self.write_lane_output('l2/tiles/tile.json', b'{"tile":"20_21"}\n')
        ledger.seal(unit_key, fingerprint, self.caller_receipt([output]))
        return fingerprint, ledger.unit_step_directory(unit_key)

    def test_unit_directory_names_replace_colons_and_refuse_unsafe_keys(self):
        self.assertEqual(unit_directory_name('tile:20_21'), 'tile__20_21')
        self.assertEqual(unit_directory_name('skill:3:1'), 'skill__3__1')
        self.assertEqual(unit_directory_name('mesh:LineageMonsters.gremlin_m00'), 'mesh__LineageMonsters.gremlin_m00')
        for unit_key in ('', 'tile', 'tile:../x', 'tile:a/b', 'tile:' + 'x' * 156):
            with self.subTest(unit_key=unit_key), self.assertRaises(UnitLedgerError):
                unit_directory_name(unit_key)

    def test_refuses_a_foreign_work_root_an_invalid_step_and_an_invalid_algorithm_version(self):
        with self.assertRaises(UnitLedgerError):
            UnitLedger(self.project / 'artifacts' / 'other' / 'world' / 'work', 'raw', 1)
        with self.assertRaises(UnitLedgerError):
            UnitLedger(self.lane_folder / 'l2', 'raw', 1)
        with self.assertRaises(StorePathError):
            UnitLedger(self.project / 'artifacts' / 'lane-store' / 'nowhere' / 'work', 'raw', 1)
        for step in ('Raw', '', '1raw', 'raw_step', 'r' * 65):
            with self.subTest(step=step), self.assertRaises(UnitLedgerError):
                UnitLedger(self.work_root, step, 1)
        for algorithm_version in (0, -1, '1', True, 1.0):
            with self.subTest(algorithm_version=algorithm_version), self.assertRaises(UnitLedgerError):
                UnitLedger(self.work_root, 'raw', algorithm_version)

    def test_fingerprint_sorts_inputs_and_covers_algorithm_version_and_config(self):
        ledger = self.ledger()
        fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], TILE_CONFIG)
        self.assertEqual(fingerprint, ledger.unit_fingerprint([SECOND_INPUT_SHA256, FIRST_INPUT_SHA256], TILE_CONFIG))
        self.assertEqual(fingerprint, sha256_of_bytes(canonical_json_bytes(
            {'algorithmVersion': 1, 'config': TILE_CONFIG, 'inputSha256s': [FIRST_INPUT_SHA256, SECOND_INPUT_SHA256]})))
        self.assertNotEqual(fingerprint, self.ledger(algorithm_version=2).unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], TILE_CONFIG))
        self.assertNotEqual(fingerprint, ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], {**TILE_CONFIG, 'chunkSize': 8}))
        for input_sha256s in (['A' * 64], ['a' * 63], [64], 'a' * 64):
            with self.subTest(input_sha256s=input_sha256s), self.assertRaises(UnitLedgerError):
                ledger.unit_fingerprint(input_sha256s, TILE_CONFIG)
        with self.assertRaises(UnitLedgerError):
            ledger.unit_fingerprint([FIRST_INPUT_SHA256], {'scale': float('nan')})

    def test_begin_then_seal_writes_owner_receipt_and_seal_and_removes_the_running_marker(self):
        ledger = self.ledger()
        fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], TILE_CONFIG)
        step_directory = ledger.begin('tile:20_21', fingerprint)
        self.assertEqual(step_directory, self.work_root / 'tile__20_21' / 'raw')
        self.assertEqual(read_json_file(step_directory / '.running.json'),
                         {'unitKey': 'tile:20_21', 'step': 'raw', 'fingerprint': fingerprint, 'startedAtRiga': RIGA_START_TIME})
        self.assertFalse(ledger.is_sealed('tile:20_21', fingerprint))
        second_output = self.write_lane_output('work/tile__20_21/raw/heights.bin', b'\x00\x01\x02')
        first_output = self.write_lane_output('l2/tiles/tile.json', b'{"tile":"20_21"}\n')
        receipt = ledger.seal('tile:20_21', fingerprint, self.caller_receipt([second_output, first_output]))
        self.assertEqual(read_json_file(step_directory / 'owner.json'),
                         {'unitKey': 'tile:20_21', 'step': 'raw', 'lane': 'world', 'host': 'DATABASE-PC',
                          'pid': os.getpid(), 'startedAtRiga': RIGA_START_TIME})
        self.assertEqual(read_json_file(step_directory / 'receipt.json'), receipt)
        self.assertEqual(receipt, {
            'unitKey': 'tile:20_21', 'step': 'raw', 'fingerprint': fingerprint, 'algorithmVersion': 1, 'config': TILE_CONFIG,
            'inputs': [{'path': 'maps/input_0.unr', 'sha256': SECOND_INPUT_SHA256}, {'path': 'maps/input_1.unr', 'sha256': FIRST_INPUT_SHA256}],
            'outputs': [first_output, second_output], 'gapRows': [], 'freeBytesBefore': 8000, 'freeBytesAfter': 7000,
            'host': 'DATABASE-PC', 'finishedAtRiga': RIGA_FINISH_TIME})
        self.assertEqual(read_json_file(step_directory / 'complete.json'),
                         {'unitKey': 'tile:20_21', 'step': 'raw', 'fingerprint': fingerprint,
                          'receiptSha256': sha256_of_bytes((step_directory / 'receipt.json').read_bytes())})
        self.assertEqual((step_directory / 'receipt.json').read_bytes(), canonical_json_bytes(receipt))
        self.assertFalse((step_directory / '.running.json').exists())
        self.assertTrue(ledger.is_sealed('tile:20_21', fingerprint))

    def test_a_sealed_rerun_skips_the_unit_without_writing(self):
        fingerprint, _ = self.sealed_unit(self.ledger())
        before = snapshot_tree(self.lane_folder)
        rerun_ledger = self.ledger()
        self.assertTrue(rerun_ledger.is_sealed('tile:20_21', fingerprint))
        with self.assertRaises(UnitLedgerError):
            rerun_ledger.begin('tile:20_21', fingerprint)
        self.assertEqual(snapshot_tree(self.lane_folder), before)

    def test_an_interrupted_unit_is_cleared_and_redone(self):
        ledger = self.ledger()
        fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256], TILE_CONFIG)
        step_directory = ledger.begin('tile:20_21', fingerprint)
        (step_directory / 'partial.bin').write_bytes(b'interrupted')
        self.assertTrue((step_directory / '.running.json').is_file())
        rerun_ledger = self.ledger()
        self.assertFalse(rerun_ledger.is_sealed('tile:20_21', fingerprint))
        self.assertEqual(rerun_ledger.begin('tile:20_21', fingerprint), step_directory)
        self.assertEqual(sorted(path.name for path in step_directory.iterdir()), ['.running.json', 'owner.json'])

    def test_a_changed_fingerprint_is_not_sealed_and_redoes_the_unit(self):
        ledger = self.ledger()
        fingerprint, step_directory = self.sealed_unit(ledger)
        changed_fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], {**TILE_CONFIG, 'chunkSize': 8})
        self.assertFalse(ledger.is_sealed('tile:20_21', changed_fingerprint))
        ledger.begin('tile:20_21', changed_fingerprint)
        self.assertEqual(sorted(path.name for path in step_directory.iterdir()), ['.running.json', 'owner.json'])
        self.assertFalse(ledger.is_sealed('tile:20_21', fingerprint))

    def test_an_edited_receipt_or_a_changed_output_makes_is_sealed_raise(self):
        ledger = self.ledger()
        fingerprint, step_directory = self.sealed_unit(ledger)
        receipt_path = step_directory / 'receipt.json'
        original_receipt = receipt_path.read_bytes()
        receipt_path.write_bytes(original_receipt.replace(b'DATABASE-PC', b'DATABASE-PD'))
        with self.assertRaisesRegex(UnitLedgerError, 'seal .* does not match its receipt'):
            ledger.is_sealed('tile:20_21', fingerprint)
        receipt_path.write_bytes(original_receipt)
        output_path = self.lane_folder / 'l2' / 'tiles' / 'tile.json'
        output_path.write_bytes(b'{"tile":"20_21","longer":true}\n')
        with self.assertRaisesRegex(UnitLedgerError, 'sealed output l2/tiles/tile.json'):
            ledger.is_sealed('tile:20_21', fingerprint)
        output_path.unlink()
        with self.assertRaisesRegex(UnitLedgerError, 'sealed output l2/tiles/tile.json'):
            ledger.is_sealed('tile:20_21', fingerprint)

    def test_seal_refuses_receipts_that_do_not_match_the_unit(self):
        ledger = self.ledger()
        fingerprint = ledger.unit_fingerprint([FIRST_INPUT_SHA256, SECOND_INPUT_SHA256], TILE_CONFIG)
        output = self.write_lane_output('l2/tiles/tile.json', b'{"tile":"20_21"}\n')
        with self.assertRaisesRegex(UnitLedgerError, 'begin was not called'):
            ledger.seal('tile:20_21', fingerprint, self.caller_receipt([output]))
        step_directory = ledger.begin('tile:20_21', fingerprint)
        refused_receipts = {
            'fingerprint': self.caller_receipt([output], config={**TILE_CONFIG, 'chunkSize': 8}),
            'sha256': self.caller_receipt([{**output, 'sha256': 'c' * 64}]),
            'bytes': self.caller_receipt([{**output, 'bytes': output['bytes'] + 1}]),
            'escape': self.caller_receipt([{**output, 'path': '../outside.json'}]),
            'root': self.caller_receipt([{**output, 'path': 'gap-rows/raw.json'}]),
            'fields': {**self.caller_receipt([output]), 'status': 'converted'},
        }
        for case, receipt in refused_receipts.items():
            with self.subTest(case=case), self.assertRaises((UnitLedgerError, StorePathError)):
                ledger.seal('tile:20_21', fingerprint, receipt)
        self.assertEqual(sorted(path.name for path in step_directory.iterdir()), ['.running.json', 'owner.json'])
        with self.assertRaisesRegex(UnitLedgerError, 'begin was not called'):
            self.ledger().seal('tile:20_21', fingerprint, self.caller_receipt([output]))

    def test_an_edited_copy_of_the_ledger_module_gives_the_same_fingerprint(self):
        module_copy = self.project / 'unit_ledger_edited_copy.py'
        module_copy.write_text((ROOT / 'scripts' / 'native_store' / 'unit_ledger.py').read_text(encoding='utf-8') + '\n\n',
                               encoding='utf-8')
        specification = importlib.util.spec_from_file_location('unit_ledger_edited_copy', module_copy)
        edited_module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(edited_module)
        edited_ledger = edited_module.UnitLedger(self.work_root, 'raw', 1)
        self.assertEqual(edited_ledger.unit_fingerprint([FIRST_INPUT_SHA256], TILE_CONFIG),
                         self.ledger().unit_fingerprint([FIRST_INPUT_SHA256], TILE_CONFIG))

    def test_locked_input_records_take_the_lock_e_sha256_of_equal_files_only(self):
        lock_path = self.project / 'reference-client-tree.lock.json'
        lock_path.write_text(json.dumps({
            'schemaVersion': 1, 'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client',
            'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
            'files': {'maps/20_21.unr': ['equal', 10, 'c' * 64, 10, 'c' * 64, 1],
                      'maps/20_22.unr': ['equal', 11, 'd' * 64, 11, 'd' * 64, 1],
                      'system/l2.ini': ['differing', 5, 'e' * 64, 6, 'f' * 64, 1]}}), encoding='utf-8')
        self.assertEqual(locked_input_records(['maps/20_22.unr', 'Maps/20_21.unr'], lock_path),
                         [{'path': 'Maps/20_21.unr', 'sha256': 'c' * 64}, {'path': 'maps/20_22.unr', 'sha256': 'd' * 64}])
        with self.assertRaisesRegex(UnitLedgerError, 'class differing'):
            locked_input_records(['system/l2.ini'], lock_path)
        with self.assertRaisesRegex(UnitLedgerError, 'no record'):
            locked_input_records(['maps/missing.unr'], lock_path)

    @unittest.skipUnless(sys.platform == 'win32', 'BelowNormal priority is implemented for Windows hosts only')
    def test_below_normal_priority_is_set_and_verified_in_a_child_process(self):
        child_program = '\n'.join([
            'import ctypes, sys',
            'from ctypes import wintypes',
            f'sys.path.insert(0, {str(ROOT / "scripts")!r})',
            'from native_store.unit_ledger import run_at_below_normal_priority',
            'run_at_below_normal_priority()',
            'kernel32 = ctypes.WinDLL("kernel32")',
            'kernel32.GetCurrentProcess.restype = wintypes.HANDLE',
            'kernel32.GetPriorityClass.argtypes = (wintypes.HANDLE,)',
            'kernel32.GetPriorityClass.restype = wintypes.DWORD',
            'print(kernel32.GetPriorityClass(kernel32.GetCurrentProcess()))',
        ])
        completed = subprocess.run([sys.executable, '-B', '-c', child_program], capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(int(completed.stdout.strip()), BELOW_NORMAL_PRIORITY_CLASS)
        self.assertEqual(BELOW_NORMAL_PRIORITY_CLASS, 0x4000)


if __name__ == '__main__':
    unittest.main()
