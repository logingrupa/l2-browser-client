from __future__ import annotations

import contextlib
import copy
from datetime import datetime
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

import convert_tables
from coverage_census_fixture import DECODE_FAILED_REASON, DECODE_PENDING_REASON, write_table_decode_rows, write_window_layout_rows
from native_assets_lib.gltf import json_bytes
from native_catalog.tables import CRYPTO_SOURCE, SAFE_PACKAGE_TRAILER, SCHEMA_ROOT
from native_store.build_coverage_report import write_coverage_report
from native_store.catalog_writer import read_store_catalog, sha256_of_file, write_store
from native_store.gap_census_denominators import load_census_denominators
from native_store.gap_rows import write_gap_rows
from native_store.store_paths import lane_store_root
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from world import tile_census
from world.tile_census import CENSUS_STEP
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH

MACHINE_SCHEDULE_PATCH_TARGET = 'native_store.build_coverage_report.read_machine_schedule'
NPCNAME_FILE = 'system/npcname-e.dat'
ZONENAME_FILE = 'system/zonename-e.dat'
DECODED_NPCNAME_PAYLOAD = struct.pack('<I', 1) + struct.pack('<I', 17) + bytes([5]) + b'Name\0' + bytes([0]) + bytes.fromhex('9ce8a9ff') + SAFE_PACKAGE_TRAILER
UNDECODABLE_ZONENAME_PAYLOAD = struct.pack('<I', 1) + SAFE_PACKAGE_TRAILER
DECODE_FORMAT_ERROR_REASON = 'decode-failed:FormatError'
COMMITTED_TILE_CENSUS = json.loads((ROOT / TILE_CENSUS_RELATIVE_PATH).read_bytes())


def machine_schedule_answering(exit_code, active_window):
    def answer(run_command):
        schedule = {'host': 'TEST-HOST', 'rigaTime': datetime.now().astimezone().isoformat(timespec='seconds'), 'activeWindow': active_window}
        return exit_code, schedule, 'relay window' if active_window else ''
    return answer


@unittest.skipUnless(SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'pinned dat schema and open-l2encdec source unavailable in .assets/native-tools')
class TableDriverCoverageRefreshTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.project_root = base / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.client_root = base / 'conversion'
        (self.client_root / 'system').mkdir(parents=True)
        (self.client_root / NPCNAME_FILE).write_bytes(b'synthetic encrypted npcname table')
        (self.client_root / ZONENAME_FILE).write_bytes(b'synthetic encrypted zonename table')
        lock_client_as_checked_conversion_root(self, self.client_root, base / 'importa', [NPCNAME_FILE, ZONENAME_FILE])
        self.store_root = lane_store_root(self.project_root, 'data-ui')
        self.payloads = {b'synthetic encrypted npcname table': DECODED_NPCNAME_PAYLOAD,
                         b'synthetic encrypted zonename table': UNDECODABLE_ZONENAME_PAYLOAD}

    def seed_lane_with_a_coverage_report(self, failed_table_keys=()):
        write_table_decode_rows(self.project_root, failed_table_keys=failed_table_keys, unlisted_table_keys=())
        write_window_layout_rows(self.project_root)
        _, before = read_store_catalog(self.store_root)
        write_store(self.store_root, {}, before, json_bytes({'schemaVersion': 1, 'models': []}))
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None)):
            write_coverage_report(self.project_root, self.store_root, ('data-ui',))

    def run_driver(self, arguments, machine_schedule=None):
        error_output = io.StringIO()
        with (patch.object(convert_tables, 'REPOSITORY_ROOT', self.project_root),
              patch.object(convert_tables, 'require_batch_preflight'), patch.object(convert_tables, 'run_at_below_normal_priority'),
              patch('native_catalog.tables.decode413', side_effect=lambda raw, *_: ('fixture', self.payloads[raw])),
              patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule or machine_schedule_answering(0, None)),
              contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(error_output)):
            exit_code = convert_tables.main(['--client', str(self.client_root), *arguments])
        return exit_code, error_output.getvalue()

    def coverage_report(self):
        return json.loads((self.store_root / 'coverage.json').read_bytes())

    def coverage_row(self, key):
        [row] = [row for row in self.coverage_report()['rows'] if row['key'] == key]
        return row

    def test_a_gap_only_unit_leaves_the_coverage_report_with_its_new_gap_row(self):
        self.seed_lane_with_a_coverage_report()
        catalog_sha256 = sha256_of_file(self.store_root / 'catalog.json')
        self.assertEqual(self.coverage_row('table:zonename-e')['reason'], DECODE_PENDING_REASON)
        self.assertEqual(self.run_driver(['--table', 'zonename-e']), (0, ''))
        self.assertEqual(sha256_of_file(self.store_root / 'catalog.json'), catalog_sha256)
        self.assertEqual(self.coverage_report()['catalogSha256'], catalog_sha256)
        self.assertEqual(self.coverage_row('table:zonename-e'), {
            'key': 'table:zonename-e', 'part': 'data', 'status': 'gap', 'reason': DECODE_FORMAT_ERROR_REASON, 'converted': False,
            'loads': 'unverified', 'steps': [{'step': 'decode', 'status': 'gap', 'reason': DECODE_FORMAT_ERROR_REASON}]})

    def test_a_key_that_turns_from_gap_to_converted_keeps_no_stale_gap_step(self):
        self.seed_lane_with_a_coverage_report(failed_table_keys=('table:npcname-e',))
        self.assertEqual(self.coverage_row('table:npcname-e')['steps'], [{'step': 'decode', 'status': 'gap', 'reason': DECODE_FAILED_REASON}])
        self.assertEqual(self.run_driver(['--table', 'npcname-e']), (0, ''))
        self.assertEqual(self.coverage_report()['catalogSha256'], sha256_of_file(self.store_root / 'catalog.json'))
        self.assertEqual(self.coverage_row('table:npcname-e'), {'key': 'table:npcname-e', 'part': 'data', 'status': 'pass', 'reason': None,
                                                                'converted': True, 'loads': 'unverified', 'steps': []})

    def test_a_run_that_converts_a_unit_and_stops_early_leaves_the_coverage_pinned_and_current(self):
        self.seed_lane_with_a_coverage_report()
        exit_code, error_text = self.run_driver(['--table', 'npcname-e', '--table', 'nosuchtable'])
        self.assertEqual(exit_code, 1)
        self.assertIn('nosuchtable.dat has no Interlude descriptor layout', error_text)
        self.assertEqual(self.coverage_report()['catalogSha256'], sha256_of_file(self.store_root / 'catalog.json'))
        self.assertEqual(self.coverage_row('table:npcname-e')['status'], 'pass')

    def test_a_batch_stopped_at_its_limit_leaves_the_coverage_pinned_and_current(self):
        self.seed_lane_with_a_coverage_report()
        self.assertEqual(self.run_driver(['--batch', 'tables', '--limit', '1']), (0, ''))
        self.assertEqual(self.coverage_report()['catalogSha256'], sha256_of_file(self.store_root / 'catalog.json'))
        self.assertEqual((self.coverage_row('table:npcname-e')['status'], self.coverage_row('table:zonename-e')['status']), ('pass', 'pending'))

    def test_a_refresh_refused_inside_a_machine_window_fails_the_run_naming_the_first_step(self):
        self.seed_lane_with_a_coverage_report()
        first_report = self.coverage_report()
        exit_code, error_text = self.run_driver(['--table', 'npcname-e'], machine_schedule_answering(2, 'thursday-relay'))
        self.assertEqual(exit_code, 1)
        self.assertIn('coverage report refused inside a machine window on TEST-HOST: relay window', error_text)
        self.assertIn(f'run pnpm report:coverage --store-root {self.store_root.as_posix()} --lane data-ui', error_text)
        self.assertEqual(self.coverage_report(), first_report)

    def test_a_lane_without_a_coverage_report_gets_none_from_a_driver_run(self):
        self.assertEqual(self.run_driver(['--table', 'npcname-e'], machine_schedule_answering(2, 'thursday-relay')), (0, ''))
        self.assertTrue((self.store_root / 'catalog.json').is_file())
        self.assertFalse((self.store_root / 'coverage.json').exists())


class WorldCensusDriverCoverageRefreshTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.store_root = lane_store_root(self.project_root, 'world')
        write_gap_rows(self.project_root, 'world', CENSUS_STEP, [
            {'key': key, 'part': 'world', 'step': CENSUS_STEP, 'status': 'gap', 'reason': 'census-pending',
             'sourceIdentity': {'path': 'maps/synthetic.unr', 'sha256': 'b' * 64}, 'evidence': 'docs/parts/world/EVIDENCE.md'}
            for key in load_census_denominators(['world'])['world']['keys']])
        write_store(self.store_root, {}, None, json_bytes({'schemaVersion': 1, 'models': []}))
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None)):
            write_coverage_report(self.project_root, self.store_root, ('world',))

    def run_census(self):
        client_access = SimpleNamespace(lock=read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH))
        with (patch.object(tile_census, 'REPOSITORY_ROOT', self.project_root),
              patch.object(tile_census, 'require_reference_client', return_value=client_access),
              patch.object(tile_census, 'run_at_below_normal_priority'), patch.object(tile_census, 'require_committed_destination'),
              patch.object(tile_census, 'build_tile_census', return_value=copy.deepcopy(COMMITTED_TILE_CENSUS)),
              patch.object(tile_census, 'write_committed_world_bytes') as committed_write,
              patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None)),
              contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO())):
            exit_code = tile_census.main(['--client', str(self.project_root / 'conversion')])
        return exit_code, committed_write

    def test_a_census_run_refreshes_the_world_lane_coverage_with_the_census_rows(self):
        exit_code, committed_write = self.run_census()
        self.assertEqual(exit_code, 0)
        committed_write.assert_called_once()
        self.assertEqual(committed_write.call_args.args[0], TILE_CENSUS_RELATIVE_PATH)
        report = json.loads((self.store_root / 'coverage.json').read_bytes())
        self.assertEqual(report['catalogSha256'], sha256_of_file(self.store_root / 'catalog.json'))
        expected_statuses = {row['key']: ('pending', 'step-pending:raw') if row['status'] == 'eligible' else ('gap', row['reason'])
                             for row in COMMITTED_TILE_CENSUS['maps']}
        self.assertEqual({row['key']: (row['status'], row['reason']) for row in report['rows'] if row['part'] == 'world'}, expected_statuses)


if __name__ == '__main__':
    unittest.main()
