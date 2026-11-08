from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.build_coverage_report import (CoverageReportError, build_coverage_report, coverage_markdown, coverage_output_path,
                                                coverage_report_bytes, main, validate_coverage_report)
from native_store.gap_rows import write_gap_rows
from native_store.load_check_records import LoadCheckRecordError, read_load_check_records
from native_store.store_paths import lane_load_check_path

GENERATED_AT_RIGA = '2026-11-08T22:30:00+02:00'
CHECKED_AT_RIGA = '2026-11-08T21:00:00+02:00'
TABLE_MANIFEST_SHA256 = 'a' * 64
SOURCE_SHA256 = 'b' * 64
DECODE_FAILED_REASON = 'decode-failed:cp1252 codec error'
ALL_LANE_NAMES = ('actors', 'data-ui', 'integration', 'world')
COVERAGE_MODULE_PATHS = (ROOT / 'scripts' / 'native_store' / 'build_coverage_report.py',
                         ROOT / 'scripts' / 'native_store' / 'coverage_denominators.py')


def table_record(table_name):
    return {'id': table_name, 'manifest': f'/l2/tables/{TABLE_MANIFEST_SHA256}/{table_name}.json',
            'manifestSha256': TABLE_MANIFEST_SHA256, 'manifestBytes': 10, 'recordCount': 1, 'sourceSha256': SOURCE_SHA256}


def write_store_catalog(store_root, catalog):
    store_root.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(catalog, sort_keys=True).encode()
    (store_root / 'catalog.json').write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def table_gap_row(key, step, status, reason):
    return {'key': key, 'part': 'data', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': 'system/npcgrp.dat', 'sha256': SOURCE_SHA256}, 'evidence': 'docs/parts/data/EVIDENCE.md'}


def load_check_record(key, status='pass', reason=None):
    return {'key': key, 'status': status, 'reason': reason, 'atRiga': CHECKED_AT_RIGA, 'assetManifestSchemaVersion': None}


def write_load_check_file(project_root, lane_name, catalog_sha256, records, document_changes=None):
    path = lane_load_check_path(project_root, lane_name, catalog_sha256)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {'schemaVersion': 1, 'lane': lane_name, 'catalogSha256': catalog_sha256, 'records': records, **(document_changes or {})}
    path.write_text(json.dumps(document), encoding='utf-8')
    return path


def rows_by_key(report):
    return {row['key']: row for row in report['rows']}


class CoverageProjectTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / 'l2'
        self.catalog_sha256 = write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'tables': [table_record('itemname-e')]})

    def build_report(self, lane_names=ALL_LANE_NAMES):
        return build_coverage_report(self.project_root, self.store_root, lane_names, GENERATED_AT_RIGA)


class CoverageReportTablesTests(CoverageProjectTestCase):
    def setUp(self):
        super().setUp()
        write_gap_rows(self.project_root, 'data-ui', 'decode', [table_gap_row('table:npcgrp', 'decode', 'gap', DECODE_FAILED_REASON)])
        write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, [load_check_record('table:itemname-e')])

    def test_the_data_part_counts_inventory_catalog_gap_rows_and_load_checks(self):
        report = self.build_report()
        self.assertEqual(report['parts']['data'], {'denominator': 40, 'converted': 1, 'loads': {'pass': 1, 'failed': 0, 'unverified': 0},
                                                   'gap': 39, 'pending': 0})
        self.assertEqual(report['denominators']['data']['count'], 40)
        self.assertIn('docs/parts/data/dat-table-inventory.json', report['denominators']['data']['source'])
        self.assertEqual(report['catalogSha256'], self.catalog_sha256)
        self.assertEqual(report['storeRoot'], 'artifacts/lane-store/data-ui/l2')
        self.assertEqual(len([row for row in report['rows'] if row['part'] == 'data']), 40)
        self.assertEqual(validate_coverage_report(report), report)

    def test_table_rows_carry_their_status_reason_loads_and_steps(self):
        report_rows = rows_by_key(self.build_report())
        self.assertEqual(report_rows['table:itemname-e'], {'key': 'table:itemname-e', 'part': 'data', 'status': 'pass', 'reason': None,
                                                           'converted': True, 'loads': 'pass', 'steps': []})
        self.assertEqual(report_rows['table:npcgrp'], {
            'key': 'table:npcgrp', 'part': 'data', 'status': 'gap', 'reason': DECODE_FAILED_REASON, 'converted': False,
            'loads': 'unverified', 'steps': [{'step': 'decode', 'status': 'gap', 'reason': DECODE_FAILED_REASON}]})
        self.assertEqual((report_rows['table:chargrp']['status'], report_rows['table:chargrp']['reason']), ('gap', 'census-pending'))

    def test_loads_come_only_from_records_pinned_to_the_measured_catalog(self):
        lane_load_check_path(self.project_root, 'data-ui', self.catalog_sha256).unlink()
        write_load_check_file(self.project_root, 'data-ui', 'c' * 64, [load_check_record('table:itemname-e')])
        report = self.build_report()
        self.assertEqual(rows_by_key(report)['table:itemname-e']['loads'], 'unverified')
        self.assertEqual(report['parts']['data']['loads'], {'pass': 0, 'failed': 0, 'unverified': 1})

    def test_a_failed_record_in_any_lane_wins_over_a_pass_in_another(self):
        write_load_check_file(self.project_root, 'world', self.catalog_sha256,
                              [load_check_record('table:itemname-e', 'failed', 'manifest fetch answered 404')])
        report = self.build_report()
        self.assertEqual(rows_by_key(report)['table:itemname-e']['loads'], 'failed')
        self.assertEqual(report['parts']['data']['loads'], {'pass': 0, 'failed': 1, 'unverified': 0})
        self.assertEqual(rows_by_key(self.build_report(['data-ui']))['table:itemname-e']['loads'], 'pass')

    def test_two_runs_with_the_same_clock_write_identical_bytes(self):
        first_report, second_report = self.build_report(), self.build_report()
        self.assertEqual(coverage_report_bytes(first_report), coverage_report_bytes(second_report))
        self.assertEqual(coverage_markdown(first_report), coverage_markdown(second_report))
        markdown = coverage_markdown(first_report)
        self.assertTrue(markdown.startswith('# Coverage\n'))
        self.assertIn('| data | 40 | 1 | 1 | 0 | 0 | 39 | 0 |', markdown)
        self.assertIn('Loads counts only recorded load checks; everything else is unverified.', markdown)

    def test_a_report_with_counts_that_differ_from_its_rows_is_refused(self):
        report = self.build_report()
        report['parts']['data']['converted'] = 2
        with self.assertRaisesRegex(CoverageReportError, 'part counts'):
            validate_coverage_report(report)


class LoadCheckRecordReaderTests(CoverageProjectTestCase):
    def test_an_absent_file_gives_no_records(self):
        self.assertEqual(read_load_check_records(self.project_root, 'data-ui', self.catalog_sha256), {})

    def test_records_are_returned_by_key(self):
        records = [load_check_record('table:itemname-e'), load_check_record('table:npcgrp', 'failed', 'decode error')]
        write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, records)
        self.assertEqual(read_load_check_records(self.project_root, 'data-ui', self.catalog_sha256),
                         {'table:itemname-e': records[0], 'table:npcgrp': records[1]})

    def test_files_that_disagree_with_their_path_or_hold_bad_records_are_refused(self):
        refused_files = {
            'differs from its path lane': {'lane': 'world'},
            'catalogSha256': {'catalogSha256': 'd' * 64},
            'passes and must have no reason': {'records': [load_check_record('table:itemname-e', 'pass', 'seen')]},
            'needs a non-empty reason': {'records': [load_check_record('table:itemname-e', 'failed', ' ')]},
            'repeats key': {'records': [load_check_record('table:itemname-e'), load_check_record('table:itemname-e')]},
            'not a catalog key': {'records': [load_check_record('model:x')]},
            'sorted by key': {'records': [load_check_record('table:npcgrp'), load_check_record('table:itemname-e')]},
            'schemaVersion': {'schemaVersion': 2},
        }
        for message, changes in refused_files.items():
            with self.subTest(message):
                write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, [load_check_record('table:itemname-e')], changes)
                with self.assertRaisesRegex(LoadCheckRecordError, message):
                    read_load_check_records(self.project_root, 'data-ui', self.catalog_sha256)


class CoverageOutputTests(CoverageProjectTestCase):
    def test_the_default_output_is_coverage_json_in_the_store_root(self):
        self.assertEqual(coverage_output_path(self.project_root, self.store_root, None), self.store_root / 'coverage.json')

    def test_an_output_under_the_shared_store_is_refused(self):
        shared_store_root = self.project_root / 'public' / 'l2'
        shared_store_root.mkdir(parents=True)
        for output in (None, shared_store_root / 'coverage.json'):
            with self.subTest(output=output), self.assertRaisesRegex(CoverageReportError, 'coverage output refused'):
                coverage_output_path(self.project_root, shared_store_root, output)

    def schedule_runner(self, exit_code, active_window):
        schedule = {'host': 'TEST-HOST', 'rigaTime': datetime.now().astimezone().isoformat(timespec='seconds'), 'activeWindow': active_window}
        return lambda command, **options: subprocess.CompletedProcess(command, exit_code, json.dumps(schedule), 'relay window')

    def test_main_writes_the_report_and_the_markdown_outside_a_machine_window(self):
        exit_code = main(['--store-root', str(self.store_root), '--markdown', 'docs/coverage.md'], project_root=self.project_root,
                         run_command=self.schedule_runner(0, None))
        self.assertEqual(exit_code, 0)
        report = json.loads((self.store_root / 'coverage.json').read_text(encoding='utf-8'))
        self.assertEqual(report['parts']['data']['converted'], 1)
        self.assertTrue((self.project_root / 'docs' / 'coverage.md').read_text(encoding='utf-8').startswith('# Coverage\n'))

    def test_main_refuses_inside_a_machine_window(self):
        exit_code = main(['--store-root', str(self.store_root)], project_root=self.project_root,
                         run_command=self.schedule_runner(2, 'thursday-relay'))
        self.assertEqual(exit_code, 1)
        self.assertFalse((self.store_root / 'coverage.json').exists())

    def test_main_refuses_a_markdown_path_under_the_shared_store(self):
        (self.project_root / 'public' / 'l2').mkdir(parents=True)
        exit_code = main(['--store-root', str(self.store_root), '--markdown', 'public/l2/coverage.md'], project_root=self.project_root,
                         run_command=self.schedule_runner(0, None))
        self.assertEqual(exit_code, 1)
        self.assertFalse((self.project_root / 'public' / 'l2' / 'coverage.md').exists())


class CoverageDenominatorSourceTests(unittest.TestCase):
    def test_no_coverage_module_reads_port_scope_estimates(self):
        for module_path in COVERAGE_MODULE_PATHS:
            with self.subTest(module_path.name):
                self.assertNotIn('PORT_SCOPE', module_path.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
