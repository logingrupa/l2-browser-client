from __future__ import annotations

import json
import re
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_capture_transcript_fixture import (FOREIGN_CLIENT_PROCESS, LEVELUP_BOT_PROCESS, NPC_SEARCH_TEXT, SYNTHETIC_LAN_PROFILE_SHA256,
                                               NativeCaptureProjectTestCase, NativeCaptureTranscript, RemoteProgramFailure,
                                               capture_transcript, clear_preflight_transcript, decoded_remote_program,
                                               prepare_folder_transcript, task_removal_transcript)
from native_store.side_by_side_check_records import write_side_by_side_records
from side_by_side.native_capture_driver import (NativeCaptureBatch, NativeCaptureKey, local_batch_folder, native_batch_id,
                                                run_native_capture, select_native_batch)
from side_by_side.native_capture_remote_programs import BATCH_SCRIPT, CAPTURE_PROGRAM
from side_by_side.native_capture_transcripts import (CONTROL_DOCUMENT_SHA256, CONTROLLER_SHA256, NATIVE_CAPTURE_RECEIPT_FIELDS,
                                                     NativeCaptureError)
from side_by_side_fixture import SYNTHETIC_DEBUG_PROFILE_SHA256, unverified_record

SKILL_BATCH_KEYS = ['skill:1011:1', 'skill:1011:2']
CAPTURED_BY = 'executor:03-17'


class NativeCaptureBatchTest(NativeCaptureProjectTestCase):
    def test_batch_holds_only_native_session_records_of_its_viewer_in_record_order(self):
        self.assertEqual([capture_key.key for capture_key in select_native_batch(self.project_root, 'nv').keys], ['npc:1001', 'npc:1002'])
        self.assertEqual([capture_key.key for capture_key in select_native_batch(self.project_root, 'pv').keys], ['item:57'])
        self.assertEqual([capture_key.key for capture_key in select_native_batch(self.project_root, 'offline-debug-startup').keys],
                         ['tile:20_20'])
        skill_batch = select_native_batch(self.project_root, 'sv')
        self.assertEqual([(capture_key.key, capture_key.command, capture_key.skill_id) for capture_key in skill_batch.keys],
                         [('skill:1011:1', 'sv', 1011), ('skill:1011:2', 'sv', 1011)])

    def test_batch_id_is_the_viewer_and_the_first_12_hex_of_the_sorted_key_list_digest(self):
        batch = select_native_batch(self.project_root, 'nv')
        self.assertEqual(batch.batch_id, native_batch_id('nv', ['npc:1002', 'npc:1001']))
        self.assertRegex(batch.batch_id, r'^nv-[0-9a-f]{12}$')

    def test_search_texts_come_from_the_records(self):
        self.assertEqual([capture_key.search_text for capture_key in select_native_batch(self.project_root, 'nv').keys],
                         [NPC_SEARCH_TEXT, "Kasha's Eye"])
        self.assertEqual([capture_key.search_text for capture_key in select_native_batch(self.project_root, 'pv').keys], ['57'])

    def test_batch_refuses_a_search_text_with_a_send_keys_control_character(self):
        write_side_by_side_records(self.project_root, 'npcs', [unverified_record('npcs', 'npc:1004', {
            'viewer': 'nv', 'searchText': 'Orc {ENTER}', 'expectedMeshText': 'LineageMonsters.orc', 'expectedTextureTexts': []})])
        with self.assertRaisesRegex(NativeCaptureError, 'search text of npc:1004'):
            select_native_batch(self.project_root, 'nv')

    def test_dry_run_prints_the_batch_and_every_step_without_calling_the_runner(self):
        transcript = NativeCaptureTranscript()
        exit_code, stdout, stderr = self.run_driver(transcript, 'batch', '--batch', 'nv', '--dry-run')
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(transcript.calls, [])
        summary = json.loads(stdout)
        self.assertEqual([key['key'] for key in summary['keys']], ['npc:1001', 'npc:1002'])
        self.assertEqual([step['step'] for step in summary['steps']],
                         ['preflight', 'prepare-capture-folder', 'copy-batch-script', 'copy-batch-input', 'capture', 'task-removal'])
        capture_folder = f'C:/Lineage2-client-support/debug-control/captures/{summary["batchId"]}'
        self.assertEqual(summary['steps'][2]['command'][-1], f'fleet-importa-pc:{capture_folder}/batch-script.ps1')
        _, capture_input = decoded_remote_program(summary['steps'][4]['command'])
        self.assertEqual(capture_input['taskName'], f'L2b-NativeCapture-{summary["batchId"]}')
        self.assertEqual((capture_input['batchScriptPath'], capture_input['batchInputPath'], capture_input['completionMarkerPath']),
                         (f'{capture_folder}/batch-script.ps1', f'{capture_folder}/batch-input.json', f'{capture_folder}/batch-complete.json'))

    def test_dry_run_of_an_empty_batch_prints_an_empty_key_list(self):
        exit_code, stdout, stderr = self.run_driver(NativeCaptureTranscript(), 'batch', '--batch', 'sv', '--dry-run',
                                                    project_root=self.empty_project_root())
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout)['keys'], [])

    def test_remote_programs_carry_data_only_as_base64_json_through_the_encoded_command(self):
        exit_code, stdout, _ = self.run_driver(NativeCaptureTranscript(), 'batch', '--batch', 'nv', '--dry-run')
        self.assertEqual(exit_code, 0)
        for step in json.loads(stdout)['steps']:
            command = step['command']
            if command[0] != 'ssh':
                continue
            self.assertEqual(command[:4], ['ssh', '-o', 'BatchMode=yes', '-o'])
            self.assertEqual(command[-2], '-EncodedCommand')
            program_text, input_document = decoded_remote_program(command)
            self.assertEqual(input_document['program'], step['step'])
            for value in (NPC_SEARCH_TEXT, 'npc:1001', 'captures/', 'Control-L2.ps1'):
                self.assertNotIn(value, program_text)


class NativeCapturePreflightTest(NativeCaptureProjectTestCase):
    def run_preflight(self, **transcript_changes):
        transcript = NativeCaptureTranscript({'preflight': clear_preflight_transcript(**transcript_changes)})
        return self.run_driver(transcript, 'preflight')

    def assert_preflight_refused(self, expected_message, **transcript_changes):
        exit_code, stdout, stderr = self.run_preflight(**transcript_changes)
        self.assertEqual(exit_code, 1)
        self.assertEqual(stdout, '')
        self.assertIn(expected_message, stderr)

    def test_clear_preflight_prints_the_l2_ini_hash(self):
        exit_code, stdout, stderr = self.run_preflight()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(json.loads(stdout), {'preflight': 'clear', 'host': 'IMPORTA-PC', 'l2IniSha256': SYNTHETIC_DEBUG_PROFILE_SHA256})

    def test_preflight_refuses_controller_drift(self):
        self.assert_preflight_refused(f'Control-L2.ps1 SHA-256 {"0" * 64} differs from the pinned {CONTROLLER_SHA256}',
                                      controllerSha256='0' * 64)

    def test_preflight_refuses_control_document_drift(self):
        self.assert_preflight_refused(f'CONTROL.md SHA-256 {"1" * 64} differs from the pinned {CONTROL_DOCUMENT_SHA256}',
                                      controlDocumentSha256='1' * 64)

    def test_preflight_refuses_an_engine_library_outside_the_lock(self):
        self.assert_preflight_refused('system/Engine.dll SHA-256 ' + '2' * 64 + ' differs from the reference client lock',
                                      engineDllSha256='2' * 64)

    def test_preflight_refuses_a_foreign_lineage_client(self):
        self.assert_preflight_refused('a Lineage II client outside C:/Lineage2-client runs: process 4200 C:\\Games\\Reborn',
                                      clientProcesses=[FOREIGN_CLIENT_PROCESS])

    def test_preflight_refuses_a_client_process_without_a_readable_path(self):
        self.assert_preflight_refused('a Lineage II client outside C:/Lineage2-client runs: process 4200 None',
                                      clientProcesses=[{**FOREIGN_CLIENT_PROCESS, 'path': None}])

    def test_preflight_refuses_the_levelup_bot(self):
        self.assert_preflight_refused('the levelup bot runs: process 4300 python.exe', botProcesses=[LEVELUP_BOT_PROCESS])

    def test_preflight_refuses_an_inactive_session_one(self):
        self.assert_preflight_refused('session 1 is not active: Disc', sessionState='Disc')
        self.assert_preflight_refused('session 1 is not active: None', sessionState=None)

    def test_preflight_refuses_an_l2_ini_that_is_not_the_debug_profile(self):
        self.assert_preflight_refused(f'system/l2.ini SHA-256 {SYNTHETIC_LAN_PROFILE_SHA256} is not the Debug profile '
                                      f'{SYNTHETIC_DEBUG_PROFILE_SHA256}', l2IniSha256=SYNTHETIC_LAN_PROFILE_SHA256)

    def test_preflight_refuses_a_transcript_with_an_unknown_field(self):
        exit_code, _, stderr = self.run_preflight(unexpected=True)
        self.assertEqual(exit_code, 1)
        self.assertIn('preflight transcript must hold exactly', stderr)


class NativeCaptureRunTest(NativeCaptureProjectTestCase):
    def setUp(self):
        super().setUp()
        self.batch = select_native_batch(self.project_root, 'sv')
        self.batch_keys = [(capture_key.key, capture_key.part, capture_key.viewer) for capture_key in self.batch.keys]

    def run_capture(self, capture=None, task_gone_after_removal=True):
        transcript = NativeCaptureTranscript({
            'preflight': clear_preflight_transcript(), 'prepare-capture-folder': prepare_folder_transcript,
            'capture': capture_transcript(self.batch.batch_id, self.batch_keys) if capture is None else capture,
            'task-removal': task_removal_transcript(self.batch.batch_id, task_gone_after_removal)})
        exit_code, stdout, stderr = self.run_driver(transcript, 'capture', '--batch', 'sv', '--captured-by', CAPTURED_BY)
        return transcript, exit_code, stdout, stderr

    def assert_batch_failed(self, expected_message, **run_changes):
        transcript, exit_code, stdout, stderr = self.run_capture(**run_changes)
        self.assertEqual(exit_code, 1)
        self.assertIn(expected_message, stderr)
        self.assertEqual(transcript.program_calls()[-1], 'task-removal')
        return json.loads(stdout)

    def test_capture_registers_one_task_named_for_the_batch_and_removes_it(self):
        transcript, exit_code, stdout, stderr = self.run_capture()
        self.assertEqual(exit_code, 0, stderr)
        self.assertEqual(transcript.program_calls(), ['preflight', 'prepare-capture-folder', 'capture', 'task-removal'])
        capture_command = next(command for command in transcript.calls
                               if command[0] == 'ssh' and decoded_remote_program(command)[1]['program'] == 'capture')
        self.assertEqual(decoded_remote_program(capture_command)[1]['taskName'], f'L2b-NativeCapture-{self.batch.batch_id}')
        self.assertEqual(len(re.findall(r'(?<!Un)Register-ScheduledTask', CAPTURE_PROGRAM)), 1)
        self.assertLess(CAPTURE_PROGRAM.index('}finally{'), CAPTURE_PROGRAM.index('Unregister-ScheduledTask'))
        result = json.loads(stdout)
        self.assertEqual((result['status'], result['receipts'], result['taskGone']), ('captured', 2, True))
        self.assertEqual(result['importCommand'], f'python -B scripts/side_by_side/import_native_captures.py --batch {self.batch.batch_id}')

    def test_the_batch_script_and_its_input_are_copied_into_the_batch_folder(self):
        transcript, exit_code, _, stderr = self.run_capture()
        self.assertEqual(exit_code, 0, stderr)
        capture_folder = f'C:/Lineage2-client-support/debug-control/captures/{self.batch.batch_id}'
        self.assertEqual([command[-1] for command in transcript.calls if command[0] == 'scp'],
                         [f'fleet-importa-pc:{capture_folder}/batch-script.ps1', f'fleet-importa-pc:{capture_folder}/batch-input.json'])
        batch_input = json.loads((local_batch_folder(self.project_root, self.batch.batch_id) / 'batch-input.json').read_text(encoding='utf-8'))
        self.assertEqual(batch_input['capturedBy'], CAPTURED_BY)
        self.assertEqual([(entry['key'], entry['command'], entry['skillId']) for entry in batch_input['keys']],
                         [(key, 'sv', 1011) for key in SKILL_BATCH_KEYS])
        self.assertTrue(all(entry['pngPath'].startswith(capture_folder + '/') and entry['receiptPath'].startswith(capture_folder + '/')
                            for entry in batch_input['keys']))

    def test_the_task_is_removed_when_the_capture_step_fails(self):
        self.assert_batch_failed('remote capture program exited 1: Register-ScheduledTask : Access is denied',
                                 capture=RemoteProgramFailure(1, 'Register-ScheduledTask : Access is denied'))

    def test_a_task_still_present_after_unregistering_fails_the_run(self):
        message = f'temporary task L2b-NativeCapture-{self.batch.batch_id} is still registered after unregistering'
        self.assert_batch_failed(message, task_gone_after_removal=False)
        self.assert_batch_failed(message, capture=capture_transcript(self.batch.batch_id, self.batch_keys, taskGone=False))

    def test_a_capture_path_outside_the_batch_folder_is_refused_before_any_remote_call(self):
        transcript = NativeCaptureTranscript()
        escaping_key = NativeCaptureKey('npc:../escape', 'npcs', 'nv', 'nv', None, 'Orc')
        for batch in (NativeCaptureBatch('nv', 'nv-' + '0' * 12, (escaping_key,)),
                      NativeCaptureBatch('sv', '../captures', self.batch.keys)):
            with self.assertRaisesRegex(NativeCaptureError, 'outside|native batch id'):
                run_native_capture(self.project_root, batch, CAPTURED_BY, transcript)
        self.assertEqual(transcript.calls, [])

    def test_an_empty_batch_and_an_unknown_capturer_are_refused_before_any_remote_call(self):
        transcript = NativeCaptureTranscript()
        with self.assertRaisesRegex(NativeCaptureError, 'has no keys'):
            run_native_capture(self.project_root, NativeCaptureBatch('sv', native_batch_id('sv', []), ()), CAPTURED_BY, transcript)
        with self.assertRaisesRegex(NativeCaptureError, '--captured-by must be'):
            run_native_capture(self.project_root, self.batch, 'agent', transcript)
        self.assertEqual(transcript.calls, [])

    def test_the_batch_script_writes_every_receipt_field_with_the_window_size_from_state(self):
        for field in NATIVE_CAPTURE_RECEIPT_FIELDS:
            self.assertIn(f'{field}=', BATCH_SCRIPT)
        self.assertIn("Action='State'", BATCH_SCRIPT)
        self.assertIn('width=[int]$state.window.width', BATCH_SCRIPT)
        self.assertIn('pngSha256=(Read-Sha256 $entry.pngPath)', BATCH_SCRIPT)

    def test_a_receipt_without_a_field_or_with_a_foreign_engine_library_fails_the_batch(self):
        receipts = capture_transcript(self.batch.batch_id, self.batch_keys)['receipts']
        del receipts[0]['pngSha256']
        receipts[1]['engineDllSha256'] = '9' * 64
        self.assert_batch_failed('receipt of skill:1011:1 must hold exactly',
                                 capture=capture_transcript(self.batch.batch_id, self.batch_keys, receipts=receipts))
        self.assert_batch_failed('receipt of skill:1011:2 engineDllSha256 ' + '9' * 64,
                                 capture=capture_transcript(self.batch.batch_id, self.batch_keys, receipts=receipts))

    def test_a_missing_receipt_or_an_incomplete_batch_fails_it(self):
        receipts = capture_transcript(self.batch.batch_id, self.batch_keys)['receipts'][:1]
        self.assert_batch_failed('no receipt for skill:1011:2',
                                 capture=capture_transcript(self.batch.batch_id, self.batch_keys, receipts=receipts))
        failed_completion = {'batchId': self.batch.batch_id, 'status': 'failed', 'error': 'controller action PlaySkill failed', 'receiptCount': 0}
        self.assert_batch_failed('the batch script did not complete: controller action PlaySkill failed',
                                 capture=capture_transcript(self.batch.batch_id, self.batch_keys, completion=failed_completion))
        self.assert_batch_failed(f'the batch wrote no completion marker within {self.batch.time_limit_seconds()} seconds',
                                 capture=capture_transcript(self.batch.batch_id, self.batch_keys, completed=False, completion=None))

    def test_an_l2_ini_change_during_the_batch_fails_it_and_prints_both_hashes(self):
        result = self.assert_batch_failed('system/l2.ini changed during the batch',
                                          capture=capture_transcript(self.batch.batch_id, self.batch_keys,
                                                                     l2IniSha256After=SYNTHETIC_LAN_PROFILE_SHA256))
        self.assertEqual((result['status'], result['l2IniSha256Before'], result['l2IniSha256After']),
                         ('failed', SYNTHETIC_DEBUG_PROFILE_SHA256, SYNTHETIC_LAN_PROFILE_SHA256))
        self.assertIsNone(result['importCommand'])


if __name__ == '__main__':
    unittest.main()
