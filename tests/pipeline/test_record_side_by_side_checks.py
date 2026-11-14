from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from catalog_store_fixture import write_store_catalog
from native_store.side_by_side_check_records import read_side_by_side_records
from native_store.side_by_side_key_digest import key_content_sha256_by_key
from side_by_side.build_pair_queue import queue_file_path
from side_by_side.record_side_by_side_checks import main
from side_by_side_fixture import (coverage_row, union_store_root, window_record, write_sandbox_receipt, write_union_coverage_report,
                                  write_union_load_checks)

UI_PART = 'ui'
PASSING_WINDOW_KEY = 'window:StatusWnd'
FAILING_WINDOW_KEY = 'window:TargetStatusWnd'


class RecordSideBySideChecksTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = union_store_root(self.project_root)
        self.catalog = {'schemaVersion': 1, 'models': [], 'windows': [window_record('StatusWnd'), window_record('TargetStatusWnd')]}
        self.catalog_sha256 = write_store_catalog(self.store_root, self.catalog)
        write_union_load_checks(self.project_root, self.catalog_sha256, {PASSING_WINDOW_KEY: 'pass', FAILING_WINDOW_KEY: 'failed'})
        write_union_coverage_report(self.store_root, self.catalog_sha256, [coverage_row(PASSING_WINDOW_KEY, UI_PART),
                                                                           coverage_row(FAILING_WINDOW_KEY, UI_PART)])

    def run_command(self, *arguments):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = main([*arguments], project_root=self.project_root)
        return exit_code, stdout.getvalue(), stderr.getvalue()

    def key_content_sha256(self, key):
        return key_content_sha256_by_key(self.store_root, self.catalog)[key]

    def test_queue_holds_only_the_window_with_a_union_load_pass(self):
        exit_code, stdout, stderr = self.run_command('queue', '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 0, stderr)
        summary = json.loads(stdout)
        self.assertEqual(summary['catalogSha256'], self.catalog_sha256)
        queue = json.loads(queue_file_path(self.project_root, self.catalog_sha256).read_text(encoding='utf-8'))
        window_entries = [entry for entry in queue['entries'] if entry['part'] == UI_PART]
        self.assertEqual([entry['key'] for entry in window_entries], [PASSING_WINDOW_KEY])
        self.assertEqual(window_entries[0]['sessionKind'], 'server')
        self.assertEqual(window_entries[0]['nativeSelection'], {'route': 'server-world', 'window': 'StatusWnd'})
        self.assertEqual(window_entries[0]['keyContentSha256'], self.key_content_sha256(PASSING_WINDOW_KEY))

    def test_ingest_writes_one_unverified_native_needs_server_record(self):
        write_sandbox_receipt(self.project_root, UI_PART, PASSING_WINDOW_KEY, self.key_content_sha256(PASSING_WINDOW_KEY), self.catalog_sha256)
        exit_code, stdout, stderr = self.run_command('ingest-sandbox-halves', '--part', UI_PART, '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout)['written'], 1)
        records = read_side_by_side_records(self.project_root, UI_PART)
        self.assertEqual([(record['key'], record['verdict'], record['reason']) for record in records],
                         [(PASSING_WINDOW_KEY, 'unverified', 'native-needs-server')])
        self.assertEqual(records[0]['nativeSelection'], {'route': 'server-world', 'window': 'StatusWnd'})

    def test_queue_refuses_a_coverage_report_of_another_catalog(self):
        write_union_coverage_report(self.store_root, 'f' * 64, [coverage_row(PASSING_WINDOW_KEY, UI_PART)])
        exit_code, _, stderr = self.run_command('queue', '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 1)
        self.assertIn('build_coverage_report.py --store-root artifacts/lane-store/integration/l2', stderr)


if __name__ == '__main__':
    unittest.main()
