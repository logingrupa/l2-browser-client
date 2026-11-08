from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, UnitLedgerError,
                                      require_batch_preflight)

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


if __name__ == '__main__':
    unittest.main()
