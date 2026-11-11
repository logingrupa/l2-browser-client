from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from catalog_store_fixture import write_store_catalog
from coverage_census_fixture import (DECODE_FAILED_REASON, DECODE_PENDING_REASON, SOURCE_SHA256, write_table_decode_rows,
                                     write_window_layout_rows)
from native_store.build_coverage_report import (CoverageReportError, build_coverage_report, coverage_markdown, coverage_output_path,
                                                coverage_report_bytes, main, validate_coverage_report)
from native_store.coverage_denominators import COVERAGE_PART_ORDER
from native_store.gap_census import GapCensusIncompleteError
from native_store.gap_census_denominators import load_census_denominators
from native_store.gap_rows import stage_a_part_names, write_gap_rows
from native_store.load_check_records import LoadCheckRecordError, read_load_check_records
from native_store.store_paths import lane_load_check_path, read_lane_parts_by_name

GENERATED_AT_RIGA = '2026-11-08T22:30:00+02:00'
CHECKED_AT_RIGA = '2026-11-08T21:00:00+02:00'
TABLE_MANIFEST_SHA256 = 'a' * 64
NON_TILE_MAP_NAMES = ('Auto0', 'Auto1', 'Auto2', 'Auto3', 'Auto4', 'Auto5', 'Lobby', 'entry', 'ship_position', 'skylevel')
ACTOR_DENOMINATORS = (('npcs', 'docs/parts/npcs/actor-unit-census.json npcgrp rowCount', 6519),
                      ('items', 'docs/parts/data/dat-table-inventory.json itemname-e recordCount', 9238),
                      ('skills-effects', 'docs/parts/data/dat-table-inventory.json skillgrp recordCount', 29812),
                      ('player-characters', 'docs/parts/npcs/actor-unit-census.json chargrp rowCount', 15))
COVERAGE_MODULE_PATHS = (ROOT / 'scripts' / 'native_store' / 'build_coverage_report.py',
                         ROOT / 'scripts' / 'native_store' / 'coverage_denominators.py',
                         ROOT / 'scripts' / 'native_store' / 'gap_census.py',
                         ROOT / 'scripts' / 'native_store' / 'gap_census_denominators.py')


def table_record(table_name):
    return {'id': table_name, 'manifest': f'/l2/tables/{TABLE_MANIFEST_SHA256}/{table_name}.json',
            'manifestSha256': TABLE_MANIFEST_SHA256, 'manifestBytes': 10, 'recordCount': 1, 'sourceSha256': SOURCE_SHA256}


def world_gap_row(key, step, status, reason):
    return {'key': key, 'part': 'world', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': f'maps/{key.split(":", 1)[1]}.unr', 'sha256': SOURCE_SHA256},
            'evidence': 'docs/parts/world/EVIDENCE.md'}


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

    def build_report(self, lane_names=('data-ui',)):
        return build_coverage_report(self.project_root, self.store_root, lane_names, GENERATED_AT_RIGA)


class CoverageReportTablesTests(CoverageProjectTestCase):
    def setUp(self):
        super().setUp()
        write_table_decode_rows(self.project_root)
        write_window_layout_rows(self.project_root)
        write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, [load_check_record('table:itemname-e')])

    def test_the_data_part_counts_census_rows_and_load_checks(self):
        report = self.build_report()
        self.assertEqual(report['parts']['data'], {'denominator': 40, 'converted': 1, 'loads': {'pass': 1, 'failed': 0, 'unverified': 0},
                                                   'gap': 1, 'pending': 38})
        self.assertEqual(tuple(report['parts']), ('data', 'sandbox', 'ui'))
        self.assertEqual(report['denominators']['data']['count'], 40)
        self.assertIn('docs/parts/data/dat-table-inventory.json', report['denominators']['data']['source'])
        self.assertEqual(report['catalogSha256'], self.catalog_sha256)
        self.assertEqual(report['storeRoot'], 'artifacts/lane-store/data-ui/l2')
        self.assertEqual(len([row for row in report['rows'] if row['part'] == 'data']), 40)
        self.assertEqual(validate_coverage_report(report), report)

    def test_table_rows_carry_their_census_status_reason_loads_and_steps(self):
        report_rows = rows_by_key(self.build_report())
        self.assertEqual(report_rows['table:itemname-e'], {'key': 'table:itemname-e', 'part': 'data', 'status': 'pass', 'reason': None,
                                                           'converted': True, 'loads': 'pass', 'steps': []})
        self.assertEqual(report_rows['table:npcgrp'], {
            'key': 'table:npcgrp', 'part': 'data', 'status': 'gap', 'reason': DECODE_FAILED_REASON, 'converted': False,
            'loads': 'unverified', 'steps': [{'step': 'decode', 'status': 'gap', 'reason': DECODE_FAILED_REASON}]})
        self.assertEqual((report_rows['table:chargrp']['status'], report_rows['table:chargrp']['reason']), ('pending', DECODE_PENDING_REASON))

    def test_a_table_with_no_row_and_no_catalog_entry_fails_the_census(self):
        write_table_decode_rows(self.project_root, unlisted_table_keys=('table:itemname-e', 'table:chargrp'))
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part data: .*table:chargrp'):
            self.build_report()

    def test_loads_come_only_from_records_pinned_to_the_measured_catalog(self):
        lane_load_check_path(self.project_root, 'data-ui', self.catalog_sha256).unlink()
        write_load_check_file(self.project_root, 'data-ui', 'c' * 64, [load_check_record('table:itemname-e')])
        report = self.build_report()
        self.assertEqual(rows_by_key(report)['table:itemname-e']['loads'], 'unverified')
        self.assertEqual(report['parts']['data']['loads'], {'pass': 0, 'failed': 0, 'unverified': 1})

    def test_a_failed_record_in_any_lane_wins_over_a_pass_in_another(self):
        write_load_check_file(self.project_root, 'integration', self.catalog_sha256,
                              [load_check_record('table:itemname-e', 'failed', 'manifest fetch answered 404')])
        report = self.build_report(('data-ui', 'integration'))
        self.assertEqual(rows_by_key(report)['table:itemname-e']['loads'], 'failed')
        self.assertEqual(report['parts']['data']['loads'], {'pass': 0, 'failed': 1, 'unverified': 0})
        self.assertEqual(rows_by_key(self.build_report())['table:itemname-e']['loads'], 'pass')

    def test_two_runs_with_the_same_clock_write_identical_bytes(self):
        first_report, second_report = self.build_report(), self.build_report()
        self.assertEqual(coverage_report_bytes(first_report), coverage_report_bytes(second_report))
        self.assertEqual(coverage_markdown(first_report), coverage_markdown(second_report))
        markdown = coverage_markdown(first_report)
        self.assertTrue(markdown.startswith('# Coverage\n'))
        self.assertIn('| data | 40 | 1 | 1 | 0 | 0 | 1 | 38 |', markdown)
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
        write_table_decode_rows(self.project_root)
        write_window_layout_rows(self.project_root)
        exit_code = main(['--store-root', str(self.store_root), '--lane', 'data-ui', '--markdown', 'docs/coverage.md'],
                         project_root=self.project_root, run_command=self.schedule_runner(0, None))
        self.assertEqual(exit_code, 0)
        report = json.loads((self.store_root / 'coverage.json').read_text(encoding='utf-8'))
        self.assertEqual(report['parts']['data']['converted'], 1)
        self.assertTrue((self.project_root / 'docs' / 'coverage.md').read_text(encoding='utf-8').startswith('# Coverage\n'))

    def test_a_rerun_over_unchanged_inputs_keeps_the_report_and_markdown_bytes(self):
        write_table_decode_rows(self.project_root)
        write_window_layout_rows(self.project_root)
        arguments = ['--store-root', str(self.store_root), '--lane', 'data-ui', '--markdown', 'docs/coverage.md']
        output_path, markdown_path = self.store_root / 'coverage.json', self.project_root / 'docs' / 'coverage.md'
        self.assertEqual(main(arguments, project_root=self.project_root, run_command=self.schedule_runner(0, None)), 0)
        first_report = json.loads(output_path.read_text(encoding='utf-8'))
        output_path.write_bytes(coverage_report_bytes({**first_report, 'generatedAtRiga': GENERATED_AT_RIGA}))
        self.assertEqual(main(arguments, project_root=self.project_root, run_command=self.schedule_runner(0, None)), 0)
        self.assertEqual(json.loads(output_path.read_text(encoding='utf-8'))['generatedAtRiga'], GENERATED_AT_RIGA)
        self.assertIn(f'generated at {GENERATED_AT_RIGA}', markdown_path.read_text(encoding='utf-8'))
        write_table_decode_rows(self.project_root, failed_table_keys=('table:npcgrp', 'table:chargrp'))
        self.assertEqual(main(arguments, project_root=self.project_root, run_command=self.schedule_runner(0, None)), 0)
        self.assertNotEqual(json.loads(output_path.read_text(encoding='utf-8'))['generatedAtRiga'], GENERATED_AT_RIGA)

    def test_main_refuses_an_incomplete_census(self):
        exit_code = main(['--store-root', str(self.store_root), '--lane', 'data-ui'], project_root=self.project_root,
                         run_command=self.schedule_runner(0, None))
        self.assertEqual(exit_code, 1)
        self.assertFalse((self.store_root / 'coverage.json').exists())

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


class CoverageReportWorldTests(CoverageProjectTestCase):
    def setUp(self):
        super().setUp()
        world_keys = load_census_denominators(['world'])['world']['keys']
        write_gap_rows(self.project_root, 'world', 'census', [
            world_gap_row(key, 'census', 'pending', 'step-pending:raw') if key in ('tile:20_20', 'tile:20_21')
            else world_gap_row(key, 'census', 'gap', 'census-pending') for key in world_keys])

    def test_denominators_come_from_the_reference_lock_the_tile_census_and_the_inventory(self):
        denominators = load_census_denominators(sorted(read_lane_parts_by_name()))
        self.assertEqual(tuple(denominators), COVERAGE_PART_ORDER)
        self.assertEqual(set(COVERAGE_PART_ORDER), stage_a_part_names())
        world_keys = denominators['world']['keys']
        self.assertEqual((denominators['world']['count'], len(world_keys)), (163, 163))
        self.assertEqual(len([key for key in world_keys if key.startswith('tile:')]), 153)
        self.assertEqual(sorted(key for key in world_keys if key.startswith('map:')), sorted(f'map:{name}' for name in NON_TILE_MAP_NAMES))
        self.assertIn('recipes/reference-client-tree.lock.json', denominators['world']['source'])
        self.assertIn('docs/parts/world/tile-census.json', denominators['world']['source'])
        for part, source, count in ACTOR_DENOMINATORS:
            with self.subTest(part):
                self.assertEqual((denominators[part]['count'], denominators[part]['keys']), (count, None))
                self.assertIn(source, denominators[part]['source'])
        self.assertEqual(denominators['ui']['count'], 248)
        for part in ('minimap', 'movement-geodata'):
            with self.subTest(part):
                self.assertEqual((denominators[part]['count'], len(denominators[part]['keys'])), (153, 153))
                self.assertIn('recipes/reference-client-tree.lock.json', denominators[part]['source'])
        self.assertEqual(denominators['audio']['count'], len(denominators['audio']['keys']))
        self.assertEqual((denominators['sandbox']['count'], denominators['sandbox']['keys']), ('unknown', None))
        self.assertIn('the sandbox is the checking tool', denominators['sandbox']['source'])

    def test_a_world_lane_report_gives_every_world_key_one_status_with_its_steps(self):
        write_gap_rows(self.project_root, 'world', 'raw', [world_gap_row('tile:20_21', 'raw', 'pass', None)])
        write_gap_rows(self.project_root, 'world', 'terrain', [world_gap_row('tile:20_21', 'terrain', 'pending', 'step-pending:terrain')])
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'sections': [{'id': 'map-20-20-section'}]})
        report = self.build_report(('world',))
        report_rows = rows_by_key(report)
        self.assertEqual(tuple(report['parts']), ('world', 'minimap', 'movement-geodata'))
        self.assertEqual(len([row for row in report['rows'] if row['part'] == 'world']), 163)
        self.assertEqual(report_rows['tile:20_21']['steps'], [{'step': 'census', 'status': 'pending', 'reason': 'step-pending:raw'},
                                                              {'step': 'raw', 'status': 'pass', 'reason': None},
                                                              {'step': 'terrain', 'status': 'pending', 'reason': 'step-pending:terrain'}])
        self.assertEqual((report_rows['tile:20_21']['status'], report_rows['tile:20_21']['reason']), ('pending', 'step-pending:terrain'))
        self.assertEqual((report_rows['tile:20_20']['status'], report_rows['tile:20_20']['converted']), ('pass', True))
        self.assertEqual((report_rows['map:Lobby']['status'], report_rows['map:Lobby']['reason']), ('gap', 'census-pending'))
        self.assertEqual(report['parts']['world'], {'denominator': 163, 'converted': 1, 'loads': {'pass': 0, 'failed': 0, 'unverified': 1},
                                                    'gap': 161, 'pending': 1})
        self.assertEqual((report['parts']['minimap']['denominator'], report['parts']['minimap']['pending']), (153, 153))
        self.assertIn('Lobby (`map:Lobby`) has the census status gap `census-pending`.', coverage_markdown(report))

    def test_a_converted_tile_whose_collision_step_failed_is_a_failed_row_that_counts_only_as_gap(self):
        write_gap_rows(self.project_root, 'world', 'collision', [world_gap_row('tile:20_20', 'collision', 'failed', 'decode-failed:FormatError')])
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'sections': [{'id': 'map-20-20-section'}]})
        report = self.build_report(('world',))
        tile_row = rows_by_key(report)['tile:20_20']
        self.assertEqual((tile_row['status'], tile_row['reason'], tile_row['converted']), ('failed', 'decode-failed:FormatError', True))
        self.assertEqual(report['parts']['world'], {'denominator': 163, 'converted': 0, 'loads': {'pass': 0, 'failed': 0, 'unverified': 1},
                                                    'gap': 162, 'pending': 1})
        self.assertEqual(validate_coverage_report(report), report)

    def test_a_pass_row_that_is_not_converted_is_refused(self):
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'sections': [{'id': 'map-20-20-section'}]})
        report = self.build_report(('world',))
        rows_by_key(report)['tile:20_20']['converted'] = False
        with self.assertRaisesRegex(CoverageReportError, 'tile:20_20 needs converted on a pass status'):
            validate_coverage_report(report)

    def test_a_converted_key_outside_an_enumerated_denominator_is_refused(self):
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'sections': [{'id': 'map-99-99-section'}]})
        with self.assertRaisesRegex(GapCensusIncompleteError, 'tile:99_99'):
            self.build_report(('world',))


class CoverageReportCensusLaneTests(CoverageProjectTestCase):
    def setUp(self):
        super().setUp()
        write_table_decode_rows(self.project_root, unlisted_table_keys=())
        write_window_layout_rows(self.project_root)
        self.measured_store_root = self.project_root / 'artifacts' / 'shared-store-copy' / 'l2'
        self.measured_catalog_sha256 = write_store_catalog(self.measured_store_root, {'schemaVersion': 1, 'models': []})

    def test_census_lanes_add_their_converted_keys_and_their_pinned_load_checks(self):
        write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, [load_check_record('table:itemname-e')])
        report = build_coverage_report(self.project_root, self.measured_store_root, ('data-ui',), GENERATED_AT_RIGA, ('data-ui',))
        self.assertEqual(report['catalogSha256'], self.measured_catalog_sha256)
        self.assertEqual(rows_by_key(report)['table:itemname-e'], {'key': 'table:itemname-e', 'part': 'data', 'status': 'pass', 'reason': None,
                                                                   'converted': True, 'loads': 'pass',
                                                                   'steps': [{'step': 'decode', 'status': 'pending',
                                                                              'reason': DECODE_PENDING_REASON}]})

    def test_without_census_lanes_the_lane_catalog_is_not_read(self):
        report = build_coverage_report(self.project_root, self.measured_store_root, ('data-ui',), GENERATED_AT_RIGA)
        self.assertEqual((rows_by_key(report)['table:itemname-e']['status'], report['parts']['data']['converted']), ('pending', 0))

    def test_the_census_lanes_flag_reads_every_named_lane(self):
        exit_code = main(['--store-root', str(self.measured_store_root), '--output', str(self.project_root / 'artifacts' / 'out' / 'c.json'),
                          '--census-lanes', 'data-ui'], project_root=self.project_root,
                         run_command=CoverageOutputTests.schedule_runner(self, 0, None))
        self.assertEqual(exit_code, 0)
        report = json.loads((self.project_root / 'artifacts' / 'out' / 'c.json').read_text(encoding='utf-8'))
        self.assertEqual((tuple(report['parts']), report['parts']['data']['converted']), (('data', 'sandbox', 'ui'), 1))
        self.assertIn('also come from the census lane stores `artifacts/lane-store/data-ui/l2`.', coverage_markdown(report, ['data-ui']))
        self.assertNotIn('census lane stores', coverage_markdown(report))


class CoverageReportTableNameIndexTests(CoverageProjectTestCase):
    def test_table_name_index_records_are_derived_and_outside_the_data_denominator(self):
        write_table_decode_rows(self.project_root)
        write_window_layout_rows(self.project_root)
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'tables': [table_record('itemname-e'),
                                                                                             table_record('itemname_e_names')]})
        report = self.build_report()
        self.assertEqual((report['parts']['data']['denominator'], report['parts']['data']['converted']), (40, 1))
        self.assertNotIn('table:itemname_e_names', rows_by_key(report))


class CoverageDenominatorSourceTests(unittest.TestCase):
    def test_no_coverage_module_reads_port_scope_estimates(self):
        for module_path in COVERAGE_MODULE_PATHS:
            with self.subTest(module_path.name):
                self.assertNotIn('PORT_SCOPE', module_path.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
