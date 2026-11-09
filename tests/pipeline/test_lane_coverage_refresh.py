from __future__ import annotations

import ast
import contextlib
from datetime import datetime, timedelta
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from coverage_census_fixture import write_table_decode_rows, write_window_layout_rows
from native_assets_lib.gltf import json_bytes
from native_store.build_coverage_report import write_coverage_report
from native_store.catalog_writer import read_store_catalog, write_store
from native_store.lane_coverage_refresh import LaneCoverageNotRefreshedError, lane_coverage_refreshed_at_exit
from native_store.store_paths import lane_store_root
from native_store import write_lane_catalog as lane_catalog_module
from native_store.write_lane_catalog import write_lane_catalog

GOLDEN_CATALOG_BYTES = (ROOT / 'tests' / 'fixtures' / 'golden' / 'l2' / 'catalog.json').read_bytes()
MACHINE_SCHEDULE_PATCH_TARGET = 'native_store.build_coverage_report.read_machine_schedule'
LANE_DRIVER_LANE_CONSTANTS = {'scripts/data/convert_tables.py': 'LANE_NAME', 'scripts/data/convert_ui.py': 'LANE_NAME',
                              'scripts/data/table_name_indexes.py': 'LANE_NAME', 'scripts/actors/convert_actors.py': 'LANE_NAME',
                              'scripts/actors/actor_census.py': 'ACTORS_LANE_NAME', 'scripts/world/convert_tile.py': 'WORLD_LANE_NAME',
                              'scripts/world/tile_census.py': 'WORLD_LANE_NAME'}


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def riga_time_text(minutes_from_now=0):
    return (datetime.now().astimezone() + timedelta(minutes=minutes_from_now)).isoformat(timespec='seconds')


def machine_schedule_answering(exit_code, active_window, *riga_times):
    pending_riga_times = list(riga_times)

    def answer(run_command):
        schedule = {'host': 'TEST-HOST', 'rigaTime': pending_riga_times.pop(0), 'activeWindow': active_window}
        return exit_code, schedule, 'relay window' if active_window else ''
    return answer


def refuse_machine_schedule(run_command):
    raise AssertionError('the coverage report was rebuilt for a run that must not rebuild it')


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*') if path.is_file()}


class LaneCoverageRefreshTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.shared_store_root = self.project_root / 'public' / 'l2'
        self.shared_store_root.mkdir(parents=True)
        (self.shared_store_root / 'catalog.json').write_bytes(GOLDEN_CATALOG_BYTES)
        self.store_root = lane_store_root(self.project_root, 'data-ui')
        write_table_decode_rows(self.project_root, failed_table_keys=(), unlisted_table_keys=())
        write_window_layout_rows(self.project_root)
        self.write_lane_store_catalog({'schemaVersion': 1, 'models': []})

    def write_lane_store_catalog(self, catalog):
        _, before = read_store_catalog(self.store_root)
        write_store(self.store_root, {}, before, json_bytes(catalog))

    def write_first_coverage_report(self):
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            write_coverage_report(self.project_root, self.store_root, ('data-ui',))
        return self.coverage_bytes()

    def coverage_bytes(self):
        return (self.store_root / 'coverage.json').read_bytes()

    def coverage_report(self):
        return json.loads(self.coverage_bytes())

    def catalog_sha256(self):
        return sha256_hex((self.store_root / 'catalog.json').read_bytes())

    def run_lane_catalog_main(self, arguments):
        output, errors = io.StringIO(), io.StringIO()
        with (patch.object(lane_catalog_module, 'REPOSITORY_ROOT', self.project_root),
              contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors)):
            exit_code = lane_catalog_module.main(arguments)
        return exit_code, output.getvalue(), errors.getvalue()


class LaneCatalogCoverageRefreshTests(LaneCoverageRefreshTestCase):
    def setUp(self):
        super().setUp()
        self.first_coverage_bytes = self.write_first_coverage_report()

    def test_writing_the_lane_catalog_pins_the_coverage_report_to_the_new_catalog(self):
        first_catalog_sha256 = self.coverage_report()['catalogSha256']
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            summary = write_lane_catalog(self.project_root, 'data-ui')
        self.assertNotEqual(summary['catalogSha256'], first_catalog_sha256)
        self.assertEqual(self.catalog_sha256(), summary['catalogSha256'])
        self.assertEqual(self.coverage_report()['catalogSha256'], summary['catalogSha256'])

    def test_a_second_write_with_no_change_keeps_the_coverage_bytes_and_their_generation_time(self):
        first_riga_time = riga_time_text()
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, first_riga_time, riga_time_text(1))):
            write_lane_catalog(self.project_root, 'data-ui')
            written_coverage_bytes = self.coverage_bytes()
            second = write_lane_catalog(self.project_root, 'data-ui')
        self.assertEqual(second['filesWritten'], 0)
        self.assertEqual(self.coverage_bytes(), written_coverage_bytes)
        self.assertEqual(self.coverage_report()['generatedAtRiga'], first_riga_time)

    def test_a_failed_coverage_build_fails_the_command_and_keeps_the_written_catalog(self):
        write_table_decode_rows(self.project_root, failed_table_keys=(), unlisted_table_keys=('table:chargrp',))
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            with self.assertRaises(LaneCoverageNotRefreshedError) as refusal:
                write_lane_catalog(self.project_root, 'data-ui')
        message = str(refusal.exception)
        self.assertIn(f'lane data-ui coverage report {self.store_root / "coverage.json"} was not refreshed for its catalog '
                      f'{self.catalog_sha256()}: part data:', message)
        self.assertIn('table:chargrp', message)
        self.assertIn(f'run pnpm report:coverage --store-root {self.store_root.as_posix()} --lane data-ui', message)
        self.assertEqual(json.loads((self.store_root / 'catalog.json').read_bytes())['sourceCatalogSha256'], sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(self.coverage_bytes(), self.first_coverage_bytes)

    def test_the_command_names_the_unrefreshed_coverage_and_exits_one(self):
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(2, 'thursday-relay', riga_time_text())):
            exit_code, output, errors = self.run_lane_catalog_main(['--lane', 'data-ui'])
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn(f'was not refreshed for its catalog {self.catalog_sha256()}: coverage report refused inside a machine window on '
                      'TEST-HOST: relay window', errors)
        self.assertEqual(self.coverage_bytes(), self.first_coverage_bytes)

    def test_plan_writes_nothing_and_builds_no_coverage_report(self):
        subprocess.run(['git', 'init', '--quiet', str(self.project_root)], check=True, capture_output=True)
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            write_lane_catalog(self.project_root, 'data-ui')
        snapshot = snapshot_tree(self.project_root)
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, refuse_machine_schedule):
            exit_code, output, errors = self.run_lane_catalog_main(['--lane', 'data-ui', '--plan'])
        self.assertEqual((exit_code, errors), (0, ''))
        self.assertIn('merge_lane_store.py --lane-store', output)
        self.assertEqual(snapshot_tree(self.project_root), snapshot)


class LaneRunCoverageRefreshTests(LaneCoverageRefreshTestCase):
    def setUp(self):
        super().setUp()
        self.first_coverage_bytes = self.write_first_coverage_report()

    def test_a_lane_run_ending_in_an_error_still_pins_the_coverage_and_raises_the_error(self):
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            with self.assertRaisesRegex(OSError, 'the run stopped after its first write'):
                with lane_coverage_refreshed_at_exit(self.project_root, 'data-ui'):
                    self.write_lane_store_catalog({'schemaVersion': 1, 'models': [], 'tables': []})
                    raise OSError('the run stopped after its first write')
        self.assertEqual(self.coverage_report()['catalogSha256'], self.catalog_sha256())

    def test_a_failed_refresh_after_a_failed_run_names_both_reasons(self):
        write_table_decode_rows(self.project_root, failed_table_keys=(), unlisted_table_keys=('table:chargrp',))
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, machine_schedule_answering(0, None, riga_time_text())):
            with self.assertRaises(LaneCoverageNotRefreshedError) as refusal:
                with lane_coverage_refreshed_at_exit(self.project_root, 'data-ui'):
                    raise OSError('the run stopped at its disk floor')
        self.assertTrue(str(refusal.exception).startswith('the run stopped at its disk floor; lane data-ui coverage report'))
        self.assertIsInstance(refusal.exception.__cause__, OSError)
        self.assertEqual(self.coverage_bytes(), self.first_coverage_bytes)


class StoresWithoutLaneCoverageTests(LaneCoverageRefreshTestCase):
    def test_a_lane_store_without_a_coverage_report_gets_none(self):
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, refuse_machine_schedule):
            with lane_coverage_refreshed_at_exit(self.project_root, 'data-ui'):
                self.write_lane_store_catalog({'schemaVersion': 1, 'models': [], 'tables': []})
            write_lane_catalog(self.project_root, 'data-ui')
        self.assertFalse((self.store_root / 'coverage.json').exists())

    def test_a_store_write_alone_leaves_the_coverage_report_for_the_end_of_the_run(self):
        first_coverage_bytes = self.write_first_coverage_report()
        with patch(MACHINE_SCHEDULE_PATCH_TARGET, refuse_machine_schedule):
            self.write_lane_store_catalog({'schemaVersion': 1, 'models': [], 'tables': []})
        self.assertEqual(self.coverage_bytes(), first_coverage_bytes)


class LaneDriverRefreshScopeTests(unittest.TestCase):
    def test_every_lane_driver_main_runs_its_lane_work_inside_the_coverage_refresh(self):
        for relative_path, lane_constant in LANE_DRIVER_LANE_CONSTANTS.items():
            with self.subTest(relative_path):
                tree = ast.parse((ROOT / relative_path).read_text(encoding='utf-8'))
                [main] = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main']
                refresh_lanes = [item.context_expr.args[1].id for node in ast.walk(main) if isinstance(node, ast.With) for item in node.items
                                 if isinstance(item.context_expr, ast.Call) and getattr(item.context_expr.func, 'id', None)
                                 == 'lane_coverage_refreshed_at_exit']
                self.assertEqual(refresh_lanes, [lane_constant])


if __name__ == '__main__':
    unittest.main()
