from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_capture_transcript_fixture import (FOREIGN_CLIENT_PROCESS, LEVELUP_BOT_PROCESS, NPC_SEARCH_TEXT, SYNTHETIC_LAN_PROFILE_SHA256,
                                               NativeCaptureProjectTestCase, NativeCaptureTranscript, clear_preflight_transcript,
                                               decoded_remote_program)
from native_store.side_by_side_check_records import write_side_by_side_records
from side_by_side.native_capture_driver import (CONTROL_DOCUMENT_SHA256, CONTROLLER_SHA256, NativeCaptureError, native_batch_id,
                                                select_native_batch)
from side_by_side_fixture import SYNTHETIC_DEBUG_PROFILE_SHA256, unverified_record


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
        self.assertTrue(all(path.startswith(capture_folder + '/') for path in capture_input['receiptPaths']))

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


if __name__ == '__main__':
    unittest.main()
