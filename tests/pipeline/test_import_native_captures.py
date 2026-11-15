from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_capture_transcript_fixture import (SYNTHETIC_LAN_PROFILE_SHA256, NativeCaptureProjectTestCase, NativeCaptureTranscript,
                                               scp_download_of, synthetic_native_png_bytes)
from native_store.side_by_side_check_records import (current_reference_tree_lock_sha256, read_side_by_side_records, side_by_side_checks_path,
                                                     write_side_by_side_records)
from side_by_side.import_native_captures import main
from side_by_side.native_capture_driver import select_native_batch
from side_by_side_fixture import FRESH_REVIEWER, JUDGED_AT_RIGA

NPC_KEYS = ['npc:1001', 'npc:1002']


class ImportNativeCapturesTest(NativeCaptureProjectTestCase):
    def setUp(self):
        super().setUp()
        self.batch_by_viewer = {viewer: select_native_batch(self.project_root, viewer) for viewer in ('nv', 'sv')}

    def import_batch(self, viewer='nv', **folder_changes):
        batch = self.batch_by_viewer[viewer]
        transcript = NativeCaptureTranscript(scp_download=scp_download_of(batch, **folder_changes))
        exit_code, stdout, stderr = self.run_entry_point(main, transcript, ['--batch', batch.batch_id], None)
        return batch, transcript, exit_code, stdout, stderr

    def records_bytes(self, part):
        return side_by_side_checks_path(self.project_root, part).read_bytes()

    def assert_import_refused(self, expected_message, part='npcs', **folder_changes):
        stored_bytes = self.records_bytes(part)
        _, _, exit_code, stdout, stderr = self.import_batch(**folder_changes)
        self.assertEqual(exit_code, 1)
        self.assertEqual(stdout, '')
        self.assertIn(expected_message, stderr)
        self.assertEqual(self.records_bytes(part), stored_bytes)
        self.assertFalse((self.project_root / 'artifacts/side-by-side/npcs/native').exists())

    def test_import_copies_the_batch_with_scp_into_the_temporary_import_folder(self):
        batch, transcript, exit_code, _, stderr = self.import_batch()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(transcript.calls, [['scp', '-q', '-r', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                                             f'fleet-importa-pc:C:/Lineage2-client-support/debug-control/captures/{batch.batch_id}',
                                             str(self.project_root / 'artifacts/side-by-side/native-import')]])
        self.assertFalse((self.project_root / 'artifacts/side-by-side/native-import' / batch.batch_id).exists())

    def test_import_moves_the_pngs_and_writes_native_halves_that_stay_unverified(self):
        _, _, exit_code, stdout, stderr = self.import_batch()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout)['written'], {'npcs': 2})
        records = {record['key']: record for record in read_side_by_side_records(self.project_root, 'npcs')}
        lock_sha256 = current_reference_tree_lock_sha256(self.project_root)
        for key in NPC_KEYS:
            record = records[key]
            self.assertEqual((record['verdict'], record['reason'], record['reviewer']), ('unverified', 'native-selection-unconfirmed', None))
            native_half = record['nativeHalf']
            self.assertEqual(native_half['referenceTreeLockSha256'], lock_sha256)
            stem = key.replace(':', '_')
            self.assertEqual(native_half['receiptPath'], f'artifacts/side-by-side/npcs/native/{stem}.json')
            png_path = self.project_root / f'artifacts/side-by-side/npcs/native/{stem}.png'
            self.assertEqual(hashlib.sha256(png_path.read_bytes()).hexdigest(), native_half['pngSha256'])
            receipt_path = self.project_root / native_half['receiptPath']
            self.assertEqual(hashlib.sha256(receipt_path.read_bytes()).hexdigest(), native_half['receiptSha256'])
            self.assertEqual((native_half['capturedBy'], native_half['windowSize']), ('executor:03-17', {'width': 1440, 'height': 900}))
        self.assertEqual(records['npc:1003']['nativeHalf'], None)

    def test_a_skill_batch_leaves_its_records_review_pending(self):
        _, _, exit_code, _, stderr = self.import_batch('sv')
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual([record['reason'] for record in read_side_by_side_records(self.project_root, 'skills-effects')],
                         ['review-pending', 'review-pending'])

    def test_a_png_that_differs_from_its_importa_hash_refuses_the_whole_batch(self):
        self.assert_import_refused('the PNG of npc:1002 is missing or differs from the SHA-256 computed on IMPORTA-PC',
                                   png_bytes_by_key={'npc:1002': b'a borrowed png'})

    def test_a_receipt_with_a_foreign_engine_library_is_refused(self):
        self.assert_import_refused('native receipt npc_1001.json engineDllSha256 ' + '9' * 64 + ' must be the reference client lock',
                                   receipt_changes_by_key={'npc:1001': {'engineDllSha256': '9' * 64}})

    def test_a_receipt_whose_l2_ini_changed_or_an_incomplete_batch_is_refused(self):
        self.assert_import_refused('system/l2.ini changed during the capture',
                                   receipt_changes_by_key={'npc:1001': {'l2IniSha256After': SYNTHETIC_LAN_PROFILE_SHA256}})
        self.assert_import_refused('did not complete: failed', completion_status='failed')

    def test_importing_the_same_batch_twice_leaves_the_records_byte_identical(self):
        self.assertEqual(self.import_batch()[2], 0)
        first_bytes = self.records_bytes('npcs')
        _, _, exit_code, stdout, stderr = self.import_batch()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout)['unchanged'], 2)
        self.assertEqual(self.records_bytes('npcs'), first_bytes)
        png_path = self.project_root / 'artifacts/side-by-side/npcs/native/npc_1001.png'
        self.assertEqual(png_path.read_bytes(), synthetic_native_png_bytes('npc:1001'))

    def test_a_judged_record_is_not_replaced_by_another_native_half(self):
        self.assertEqual(self.import_batch()[2], 0)
        record = next(record for record in read_side_by_side_records(self.project_root, 'npcs') if record['key'] == 'npc:1001')
        write_side_by_side_records(self.project_root, 'npcs', [{**record, 'verdict': 'pass', 'reason': None, 'reviewer': FRESH_REVIEWER,
                                                                'judgedAtRiga': JUDGED_AT_RIGA}])
        stored_bytes = self.records_bytes('npcs')
        _, _, exit_code, _, stderr = self.import_batch(receipt_changes_by_key={'npc:1001': {'capturedAtRiga': '2026-11-14T13:00:00+02:00'}})
        self.assertEqual(exit_code, 1)
        self.assertIn('record npc:1001 is judged pass', stderr)
        self.assertEqual(self.records_bytes('npcs'), stored_bytes)


if __name__ == '__main__':
    unittest.main()
