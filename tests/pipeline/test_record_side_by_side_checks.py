from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.side_by_side_check_records import (current_reference_tree_lock_sha256, read_side_by_side_records, side_by_side_checks_path,
                                                     write_side_by_side_records)
from native_store.side_by_side_key_digest import key_content_sha256_by_key
from side_by_side.build_pair_queue import queue_file_path
from side_by_side.record_side_by_side_checks import main
from side_by_side_fixture import (FRESH_REVIEWER, coverage_row, native_half, write_audio_clip_receipt, write_queue_union,
                                  write_reference_client_lock, write_sandbox_receipt, write_union_coverage_report)

UI_PART = 'ui'
PASSING_WINDOW_KEY = 'window:StatusWnd'
FAILING_WINDOW_KEY = 'window:ChatTexture'
AUDIO_PART = 'audio'
AUDIO_KEY = 'npc:1001'
JUDGED_AT_RIGA = '2026-11-14T10:00:00+02:00'


def machine_schedule_outside_window(command, **options):
    schedule = {'host': 'DATABASE-PC', 'rigaTime': JUDGED_AT_RIGA, 'activeWindow': None}
    return subprocess.CompletedProcess(command, 0, stdout=json.dumps(schedule), stderr='')


class RecordSideBySideChecksTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root, self.catalog, self.catalog_sha256 = write_queue_union(
            self.project_root, census_gap_keys=('window:NewRadarWnd',), load_status_changes={FAILING_WINDOW_KEY: 'failed'})

    def run_command(self, *arguments):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = main([*arguments], project_root=self.project_root, run_command=machine_schedule_outside_window)
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

    def test_a_recaptured_sandbox_half_beside_a_native_half_keeps_the_npc_selection_unconfirmed(self):
        npc_key = 'npc:1001'
        write_sandbox_receipt(self.project_root, 'npcs', npc_key, self.key_content_sha256(npc_key), self.catalog_sha256)
        self.assertEqual(self.run_command('ingest-sandbox-halves', '--part', 'npcs', '--store-root', str(self.store_root))[0], 0)
        write_reference_client_lock(self.project_root)
        record = read_side_by_side_records(self.project_root, 'npcs')[0]
        lock_sha256 = current_reference_tree_lock_sha256(self.project_root)
        write_side_by_side_records(self.project_root, 'npcs', [
            {**record, 'reason': 'native-selection-unconfirmed', 'nativeHalf': native_half('npcs', npc_key, lock_sha256)}])
        write_sandbox_receipt(self.project_root, 'npcs', npc_key, self.key_content_sha256(npc_key), self.catalog_sha256,
                              png_bytes=b'a recaptured sandbox png')
        exit_code, _, stderr = self.run_command('ingest-sandbox-halves', '--part', 'npcs', '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 0, stderr)
        recaptured = read_side_by_side_records(self.project_root, 'npcs')[0]
        self.assertEqual((recaptured['reason'], len(recaptured['sandboxHalfHistory'])), ('native-selection-unconfirmed', 1))

    def test_a_recaptured_window_half_beside_a_native_half_is_review_pending(self):
        self.ingest_window_record()
        self.add_native_half()
        write_sandbox_receipt(self.project_root, UI_PART, PASSING_WINDOW_KEY, self.key_content_sha256(PASSING_WINDOW_KEY), self.catalog_sha256,
                              png_bytes=b'a recaptured window png')
        exit_code, _, stderr = self.run_command('ingest-sandbox-halves', '--part', UI_PART, '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(read_side_by_side_records(self.project_root, UI_PART)[0]['reason'], 'review-pending')

    def test_queue_refuses_a_coverage_report_of_another_catalog(self):
        write_union_coverage_report(self.store_root, 'f' * 64, [coverage_row(PASSING_WINDOW_KEY, UI_PART)])
        exit_code, _, stderr = self.run_command('queue', '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 1)
        self.assertIn('build_coverage_report.py --store-root artifacts/lane-store/integration/l2', stderr)

    def test_ingest_refuses_a_stale_capture_and_a_png_that_differs_from_its_receipt(self):
        write_sandbox_receipt(self.project_root, UI_PART, PASSING_WINDOW_KEY, 'a' * 64, self.catalog_sha256)
        exit_code, _, stderr = self.run_command('ingest-sandbox-halves', '--part', UI_PART, '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 1)
        self.assertIn('stale capture', stderr)
        _, receipt = write_sandbox_receipt(self.project_root, UI_PART, PASSING_WINDOW_KEY, self.key_content_sha256(PASSING_WINDOW_KEY),
                                           self.catalog_sha256)
        (self.project_root / receipt['pngPath']).write_bytes(b'a different image')
        exit_code, _, stderr = self.run_command('ingest-sandbox-halves', '--part', UI_PART, '--store-root', str(self.store_root))
        self.assertEqual(exit_code, 1)
        self.assertIn('differs from the receipt SHA-256', stderr)
        self.assertFalse(side_by_side_checks_path(self.project_root, UI_PART).exists())

    def ingest_window_record(self):
        write_sandbox_receipt(self.project_root, UI_PART, PASSING_WINDOW_KEY, self.key_content_sha256(PASSING_WINDOW_KEY), self.catalog_sha256)
        self.assertEqual(self.run_command('ingest-sandbox-halves', '--part', UI_PART, '--store-root', str(self.store_root))[0], 0)
        return side_by_side_checks_path(self.project_root, UI_PART)

    def add_native_half(self):
        write_reference_client_lock(self.project_root)
        record = read_side_by_side_records(self.project_root, UI_PART)[0]
        lock_sha256 = current_reference_tree_lock_sha256(self.project_root)
        write_side_by_side_records(self.project_root, UI_PART, [
            {**record, 'reason': 'review-pending', 'nativeHalf': native_half(UI_PART, PASSING_WINDOW_KEY, lock_sha256)}])

    def judge(self, *arguments, part=UI_PART, key=PASSING_WINDOW_KEY):
        return self.run_command('judge', '--part', part, '--key', key, *arguments)

    def test_judge_pass_without_a_native_half_is_refused_and_leaves_the_file_unchanged(self):
        records_path = self.ingest_window_record()
        stored_bytes = records_path.read_bytes()
        exit_code, _, stderr = self.judge('--verdict', 'pass', '--reviewer', FRESH_REVIEWER)
        self.assertEqual(exit_code, 1)
        self.assertIn('pass needs a nativeHalf', stderr)
        self.assertEqual(records_path.read_bytes(), stored_bytes)

    def test_judge_mismatch_needs_a_difference_and_a_suspected_step(self):
        records_path = self.ingest_window_record()
        self.add_native_half()
        stored_bytes = records_path.read_bytes()
        exit_code, _, stderr = self.judge('--verdict', 'mismatch', '--difference', 'The gauge frame is missing.', '--reviewer', FRESH_REVIEWER)
        self.assertEqual(exit_code, 1)
        self.assertIn('needs --difference and --suspected-step', stderr)
        self.assertEqual(records_path.read_bytes(), stored_bytes)
        exit_code, _, stderr = self.judge('--verdict', 'mismatch', '--difference', 'The gauge frame is missing.', '--suspected-step',
                                          'textures', '--reviewer', FRESH_REVIEWER)
        self.assertEqual(exit_code, 0, stderr)
        record = read_side_by_side_records(self.project_root, UI_PART)[0]
        self.assertEqual((record['verdict'], record['suspectedStep'], record['reviewer'], record['judgedAtRiga']),
                         ('mismatch', 'textures', FRESH_REVIEWER, JUDGED_AT_RIGA))

    def test_judge_reviewer_uncertain_is_accepted_from_an_independent_reviewer(self):
        self.ingest_window_record()
        self.add_native_half()
        exit_code, _, stderr = self.judge('--verdict', 'unverified', '--reason', 'reviewer-uncertain', '--reviewer', FRESH_REVIEWER)
        self.assertEqual(exit_code, 0, stderr)
        record = read_side_by_side_records(self.project_root, UI_PART)[0]
        self.assertEqual((record['verdict'], record['reason'], record['reviewer']), ('unverified', 'reviewer-uncertain', FRESH_REVIEWER))
        exit_code, _, stderr = self.judge('--verdict', 'pass', '--reviewer', 'reviewer:executor:03-07')
        self.assertEqual(exit_code, 1)
        self.assertIn('reviewer must differ from the capturer', stderr)

    def ingest_audio_clip(self, **receipt_changes):
        _, receipt = write_audio_clip_receipt(self.project_root, AUDIO_KEY, 'combat', self.key_content_sha256(AUDIO_KEY), self.catalog_sha256,
                                              **receipt_changes)
        return receipt, self.run_command('ingest-audio-clips', '--store-root', str(self.store_root))

    def test_ingest_audio_clips_writes_one_listen_needs_owner_record_per_identity(self):
        receipt, (exit_code, stdout, stderr) = self.ingest_audio_clip()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout)['written'], 1)
        records = read_side_by_side_records(self.project_root, AUDIO_PART)
        self.assertEqual([(record['key'], record['role'], record['sourceSha256'], record['verdict'], record['reason']) for record in records],
                         [(AUDIO_KEY, 'combat', receipt['sourceSha256'], 'unverified', 'listen-needs-owner')])
        self.assertEqual(records[0]['nativeSelection'], {'route': 'listen', 'role': 'combat'})

    def test_ingest_audio_clips_refuses_a_clip_that_differs_from_its_receipt(self):
        _, (exit_code, _, stderr) = self.ingest_audio_clip(clipSha256='9' * 64)
        self.assertEqual(exit_code, 1)
        self.assertIn('audio clip', stderr)
        self.assertFalse(side_by_side_checks_path(self.project_root, AUDIO_PART).exists())

    def test_judge_refuses_an_audio_pass_from_anyone_but_the_owner(self):
        receipt, _ = self.ingest_audio_clip()
        records_path = side_by_side_checks_path(self.project_root, AUDIO_PART)
        stored_bytes = records_path.read_bytes()
        audio_identity = ('--role', 'combat', '--source-sha256', receipt['sourceSha256'])
        exit_code, _, stderr = self.judge(*audio_identity, '--verdict', 'pass', '--reviewer', FRESH_REVIEWER, part=AUDIO_PART, key=AUDIO_KEY)
        self.assertEqual(exit_code, 1)
        self.assertIn('accepted only from reviewer owner', stderr)
        self.assertEqual(records_path.read_bytes(), stored_bytes)
        exit_code, _, stderr = self.judge(*audio_identity, '--verdict', 'pass', '--reviewer', 'owner', part=AUDIO_PART, key=AUDIO_KEY)
        self.assertEqual(exit_code, 0, stderr)


if __name__ == '__main__':
    unittest.main()
