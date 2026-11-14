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
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from catalog_store_fixture import write_store_catalog
from coverage_census_fixture import (load_check_record, stage_a_counts, table_record, write_load_check_file, write_table_decode_rows,
                                     write_window_layout_rows)
from reference_client_lock_fixture import use_reference_client_lock
from side_by_side_fixture import (FRESH_REVIEWER, JUDGED_AT_RIGA, SYNTHETIC_IMPORTA_HOST, audio_record, native_half, tile_record,
                                  unverified_record, window_record, write_reference_client_lock)
from native_assets_lib.asset_manifest import reference_client_build
from native_store.build_coverage_report import build_coverage_report, coverage_markdown, main, validate_coverage_report
from native_store.side_by_side_check_records import current_reference_tree_lock_sha256, write_side_by_side_records
from native_store.stage_a_exit_counts import (StageAExitCountsError, StageAExitInputs, reference_client_block, stage_a_markdown,
                                              stage_a_part_counts, validate_stage_a_counts)
from reference_client_guard import read_reference_client_lock

GENERATED_AT_RIGA = '2026-11-14T08:30:00+02:00'
WINDOW_IDS = ('AbnormalStatusWnd', 'AssistIcon', 'BenchMarkMenuWnd', 'BoardWnd', 'BottomBar', 'CalculatorWnd', 'NewRadarWnd', 'StatusWnd')
TABLE_IDS = ('chargrp', 'itemname-e', 'npcname-e', 'skillname-e')
OTHER_KEY_CONTENT_SHA256 = '9' * 64


def window_selection(window_id):
    return {'route': 'server-world', 'window': window_id}


def displayed_tables(*table_ids):
    return [{'tableKey': f'table:{table_id}', 'rowIds': [1]} for table_id in table_ids]


def capture_failure(key, key_content_sha256):
    return {'key': key, 'catalogSha256': 'c' * 64, 'keyContentSha256': key_content_sha256, 'error': 'synthetic capture timeout',
            'atRiga': GENERATED_AT_RIGA}


class StageAExitProjectTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / 'l2'
        write_table_decode_rows(self.project_root, unlisted_table_keys=())
        write_window_layout_rows(self.project_root)
        self.lock_path = write_reference_client_lock(self.project_root)
        use_reference_client_lock(self, self.lock_path)
        self.windows = {window_id: window_record(window_id) for window_id in WINDOW_IDS}
        self.catalog_sha256 = write_store_catalog(self.store_root, {
            'schemaVersion': 1, 'models': [], 'tables': [table_record(table_id) for table_id in TABLE_IDS],
            'windows': list(self.windows.values())})
        write_load_check_file(self.project_root, 'data-ui', self.catalog_sha256, [
            load_check_record(key, 'failed', 'synthetic load failure') if key == 'window:CalculatorWnd' else load_check_record(key)
            for key in sorted([*(f'table:{table_id}' for table_id in TABLE_IDS), *(f'window:{window_id}' for window_id in WINDOW_IDS)])
            if key != 'window:AbnormalStatusWnd'])
        write_side_by_side_records(self.project_root, 'ui', [
            self.judged_window_record('StatusWnd', 'pass', displayed_tables('itemname-e', 'skillname-e')),
            self.judged_window_record('NewRadarWnd', 'mismatch', displayed_tables('skillname-e')),
            self.unverified_window_record('AssistIcon', self.digest('AssistIcon'), displayed_tables('npcname-e')),
            self.unverified_window_record('BoardWnd', OTHER_KEY_CONTENT_SHA256, displayed_tables('npcname-e'))])
        self.write_capture_failure('BottomBar', self.digest('BottomBar'))

    def digest(self, window_id):
        return self.windows[window_id]['manifestSha256']

    def unverified_window_record(self, window_id, key_content_sha256, table_rows):
        record = unverified_record('ui', f'window:{window_id}', window_selection(window_id), reason='native-needs-server',
                                   key_content_sha256=key_content_sha256)
        return {**record, 'displayedTableRows': table_rows}

    def judged_window_record(self, window_id, verdict, table_rows):
        key = f'window:{window_id}'
        record = {**self.unverified_window_record(window_id, self.digest(window_id), table_rows), 'verdict': verdict, 'reason': None,
                  'nativeHalf': native_half('ui', key, current_reference_tree_lock_sha256(self.project_root)), 'reviewer': FRESH_REVIEWER,
                  'judgedAtRiga': JUDGED_AT_RIGA}
        if verdict == 'mismatch':
            record.update({'difference': 'The sandbox window frame is missing its title bar.', 'suspectedStep': 'layout'})
        return record

    def write_capture_failure(self, window_id, key_content_sha256):
        path = self.project_root / 'artifacts' / 'side-by-side' / 'ui' / 'failures' / f'window_{window_id}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(capture_failure(f'window:{window_id}', key_content_sha256)), encoding='utf-8')

    def build_report(self):
        return build_coverage_report(self.project_root, self.store_root, ('data-ui',), GENERATED_AT_RIGA)


class StageAReasonTests(StageAExitProjectTestCase):
    def test_every_computed_reason_and_both_judged_verdicts_have_their_case(self):
        self.assertEqual(self.build_report()['parts']['ui']['stageA'], stage_a_counts(8, 6, {
            'loads-failed': 1, 'loads-unrecorded': 1, 'native-needs-server': 1, 'not-yet-queued': 1, 'sandbox-capture-failed': 1,
            'stale-after-fix': 1}, passed=1, mismatched=1))

    def test_a_capture_failure_on_an_older_digest_falls_through_to_the_load_record(self):
        self.write_capture_failure('BottomBar', OTHER_KEY_CONTENT_SHA256)
        reasons = self.build_report()['parts']['ui']['stageA']['unverifiedByReason']
        self.assertNotIn('sandbox-capture-failed', reasons)
        self.assertEqual(reasons['not-yet-queued'], 2)

    def test_a_capture_failure_file_for_another_key_is_refused(self):
        path = self.project_root / 'artifacts' / 'side-by-side' / 'ui' / 'failures' / 'window_BottomBar.json'
        path.write_text(json.dumps(capture_failure('window:StatusWnd', self.digest('BottomBar'))), encoding='utf-8')
        with self.assertRaisesRegex(StageAExitCountsError, 'capture failure file must name key window:BottomBar'):
            self.build_report()


class StageATableRuleTests(StageAExitProjectTestCase):
    def test_a_table_takes_the_verdict_of_the_records_that_display_it(self):
        self.assertEqual(self.build_report()['parts']['data']['stageA'], stage_a_counts(4, 4, {
            'native-needs-server': 1, 'no-pair-shows-table': 1}, passed=1, mismatched=1))

    def test_a_table_shown_only_by_unverified_records_takes_the_first_record_reason_in_key_order(self):
        write_side_by_side_records(self.project_root, 'ui', [
            self.unverified_window_record('AssistIcon', OTHER_KEY_CONTENT_SHA256, displayed_tables('npcname-e'))])
        reasons = self.build_report()['parts']['data']['stageA']['unverifiedByReason']
        self.assertEqual(reasons, {'no-pair-shows-table': 1, 'stale-after-fix': 1})


class StageAReferenceTests(StageAExitProjectTestCase):
    def test_the_reference_is_the_lock_build_and_the_importa_host_counts(self):
        expected = {**reference_client_build(read_reference_client_lock(self.lock_path)),
                    'importaFileCount': SYNTHETIC_IMPORTA_HOST['fileCount'], 'importaTotalBytes': SYNTHETIC_IMPORTA_HOST['totalBytes']}
        report = self.build_report()
        self.assertEqual(report['reference'], expected)
        self.assertIn(f'Reference client: tree lock `{expected["referenceTreeLockSha256"]}`, Engine.dll `{expected["engineDllSha256"]}`, '
                      f'IMPORTA-PC 1 files and 24 bytes.\n\n| Part | Converted | Loads pass | Checked |', coverage_markdown(report))

    def test_a_report_carrying_the_raw_lock_file_hash_is_refused(self):
        report = self.build_report()
        report['reference']['referenceTreeLockSha256'] = hashlib.sha256(self.lock_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(StageAExitCountsError, 'differs from reference_client_build of the lock'):
            validate_coverage_report(report)

    def test_a_lock_without_the_importa_host_gives_no_reference(self):
        lock = json.loads(self.lock_path.read_text(encoding='utf-8'))
        del lock['hosts']
        self.lock_path.write_text(json.dumps(lock), encoding='utf-8')
        with self.assertRaisesRegex(StageAExitCountsError, 'needs hosts.importa with fileCount and totalBytes'):
            reference_client_block()


class StageAPartsWithoutDenominatorTests(StageAExitProjectTestCase):
    def test_audio_and_minimap_records_are_counted_while_their_denominator_stays_unknown(self):
        tile = tile_record('20_20')
        catalog = {'schemaVersion': 1, 'models': [], 'tiles': [tile]}
        write_side_by_side_records(self.project_root, 'audio', [
            {**audio_record('tile:20_20', 'ambience'), 'sandboxHalf': {**audio_record('tile:20_20', 'ambience')['sandboxHalf'],
                                                                     'keyContentSha256': tile['manifestSha256']}}])
        write_side_by_side_records(self.project_root, 'minimap', [unverified_record(
            'minimap', 'tile:20_20', {'route': 'server-world', 'window': 'MinimapWnd', 'map': '20_20'}, reason='native-needs-server',
            key_content_sha256=tile['manifestSha256'])])
        exit_inputs = StageAExitInputs(self.project_root, self.store_root, catalog, {})
        audio_counts, minimap_counts = (stage_a_part_counts(exit_inputs, [], part) for part in ('audio', 'minimap'))
        self.assertEqual(audio_counts, stage_a_counts('unknown', 'unknown', {'listen-needs-owner': 1}, records_without_denominator=1))
        self.assertEqual(minimap_counts, stage_a_counts('unknown', 'unknown', {'native-needs-server': 1}, records_without_denominator=1))
        validate_stage_a_counts('minimap', minimap_counts, [])
        with self.assertRaisesRegex(StageAExitCountsError, 'stage A counts of minimap do not balance converted'):
            validate_stage_a_counts('minimap', {**minimap_counts, 'converted': 1}, [])
        markdown = stage_a_markdown({'reference': reference_client_block(), 'parts': {'minimap': {'stageA': minimap_counts, 'gap': 0,
                                                                                                    'pending': 153}}})
        self.assertIn('| minimap | unknown | unknown | 0 | 0 | 0 | 1 | `native-needs-server` 1 | 0 | 153 |\n', markdown)
        self.assertIn('- minimap: converted unknown because the minimap census counts minimap:<XX_YY> keys while its check records are '
                      'keyed by the world tile key; 1 check records counted.\n', markdown)

    def test_the_sandbox_part_keeps_an_unknown_stage_a_denominator_with_its_reason(self):
        sandbox = self.build_report()['parts']['sandbox']['stageA']
        self.assertEqual(sandbox, stage_a_counts('unknown', 'unknown', {}))
        self.assertIn('- sandbox: converted unknown because the sandbox is the checking tool', coverage_markdown(self.build_report()))


class StageARerunTests(StageAExitProjectTestCase):
    def schedule_runner(self):
        schedule = {'host': 'TEST-HOST', 'rigaTime': datetime.now().astimezone().isoformat(timespec='seconds'), 'activeWindow': None}
        return lambda command, **options: subprocess.CompletedProcess(command, 0, json.dumps(schedule), '')

    def test_a_rerun_on_unchanged_inputs_writes_byte_identical_report_and_markdown(self):
        arguments = ['--store-root', str(self.store_root), '--lane', 'data-ui', '--markdown', 'docs/coverage.md']
        output_path, markdown_path = self.store_root / 'coverage.json', self.project_root / 'docs' / 'coverage.md'
        self.assertEqual(main(arguments, project_root=self.project_root, run_command=self.schedule_runner()), 0)
        first_bytes = (output_path.read_bytes(), markdown_path.read_bytes())
        self.assertEqual(main(arguments, project_root=self.project_root, run_command=self.schedule_runner()), 0)
        self.assertEqual((output_path.read_bytes(), markdown_path.read_bytes()), first_bytes)
        self.assertIn(b'## Stage A exit\n', first_bytes[1])


if __name__ == '__main__':
    unittest.main()
