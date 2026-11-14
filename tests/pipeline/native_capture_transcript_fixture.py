from __future__ import annotations

import base64
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from native_store.side_by_side_check_records import write_side_by_side_records
from side_by_side.native_capture_driver import main
from side_by_side.native_capture_transcripts import CONTROL_DOCUMENT_SHA256, CONTROLLER_SHA256
from side_by_side_fixture import SYNTHETIC_DEBUG_PROFILE_SHA256, SYNTHETIC_ENGINE_LIBRARY_SHA256, unverified_record, write_reference_client_lock

SYNTHETIC_LAN_PROFILE_SHA256 = hashlib.sha256(b'synthetic lan profile').hexdigest()
SYNTHETIC_HOST = 'IMPORTA-PC'
REFERENCE_CLIENT_PROCESS = {'processId': 4100, 'name': 'l2.bin', 'path': 'C:\\Lineage2-client\\system\\l2.bin'}
FOREIGN_CLIENT_PROCESS = {'processId': 4200, 'name': 'l2.exe', 'path': 'C:\\Games\\Reborn\\Legacy\\system\\l2.exe'}
LEVELUP_BOT_PROCESS = {'processId': 4300, 'name': 'python.exe', 'path': 'C:\\Tools\\l2-levelup-assistant\\python.exe'}
NPC_SEARCH_TEXT = 'Greater Musveren'
NATIVE_CAPTURED_AT_RIGA = '2026-11-14T12:00:00+02:00'
ENCODED_INPUT_PATTERN = re.compile(r"FromBase64String\('([A-Za-z0-9+/=]+)'\)")


class RemoteProgramFailure:
    def __init__(self, returncode, stderr):
        self.returncode = returncode
        self.stderr = stderr


def decoded_remote_program(command):
    program_text = base64.b64decode(command[command.index('-EncodedCommand') + 1]).decode('utf-16le')
    input_match = ENCODED_INPUT_PATTERN.search(program_text)
    return program_text, json.loads(base64.b64decode(input_match.group(1)).decode('utf-8'))


class NativeCaptureTranscript:
    def __init__(self, documents_by_program=None, scp_download=None):
        self.documents_by_program = documents_by_program or {}
        self.scp_download = scp_download
        self.calls = []

    def program_calls(self):
        return [decoded_remote_program(command)[1]['program'] for command in self.calls if command[0] == 'ssh']

    def __call__(self, command, **options):
        self.calls.append(list(command))
        if command[0] == 'scp':
            if self.scp_download is not None and '-r' in command:
                self.scp_download(command)
            return subprocess.CompletedProcess(command, 0, stdout='', stderr='')
        _, input_document = decoded_remote_program(command)
        document = self.documents_by_program[input_document['program']]
        if callable(document):
            document = document(input_document)
        if isinstance(document, RemoteProgramFailure):
            return subprocess.CompletedProcess(command, document.returncode, stdout='', stderr=document.stderr)
        return subprocess.CompletedProcess(command, 0, stdout='\ufeff' + json.dumps(document), stderr='')


def clear_preflight_transcript(**changes):
    return {'program': 'preflight', 'host': SYNTHETIC_HOST, 'controllerSha256': CONTROLLER_SHA256,
            'controlDocumentSha256': CONTROL_DOCUMENT_SHA256, 'engineDllSha256': SYNTHETIC_ENGINE_LIBRARY_SHA256,
            'l2IniSha256': SYNTHETIC_DEBUG_PROFILE_SHA256, 'clientProcesses': [dict(REFERENCE_CLIENT_PROCESS)], 'botProcesses': [],
            'sessionId': 1, 'sessionState': 'Active', **changes}


def npc_native_selection(npc_id, search_text=NPC_SEARCH_TEXT):
    return {'viewer': 'nv', 'searchText': search_text, 'expectedMeshText': f'LineageMonsters.npc_{npc_id}_m00',
            'expectedTextureTexts': [f'LineageMonstersTex.npc_{npc_id}_t00']}


def native_batch_records():
    return {
        'world': [unverified_record('world', 'tile:20_20', {'route': 'offline-debug-startup', 'map': '20_20'}),
                  unverified_record('world', 'tile:20_21', {'route': 'server-world', 'map': '20_21'}, reason='native-needs-server')],
        'npcs': [unverified_record('npcs', 'npc:1001', npc_native_selection(1001)),
                 unverified_record('npcs', 'npc:1002', npc_native_selection(1002, "Kasha's Eye")),
                 unverified_record('npcs', 'npc:1003', npc_native_selection(1003), reason='framing-not-comparable')],
        'items': [unverified_record('items', 'item:57', {'viewer': 'pv', 'itemId': 57, 'expectedMeshTexts': ['LineageWeapons.blade_m00_wp']}),
                  unverified_record('items', 'item:58', {'viewer': 'server-world', 'itemId': 58, 'expectedMeshTexts': ['DarkElf.m001_u']},
                                    reason='native-needs-server')],
        'skills-effects': [unverified_record('skills-effects', 'skill:1011:1', {'viewer': 'sv', 'skillId': 1011, 'level': 1}),
                           unverified_record('skills-effects', 'skill:1011:2', {'viewer': 'sv', 'skillId': 1011, 'level': 2})],
    }


def native_capture_receipt(batch_id, key, part, viewer, png_sha256, **changes):
    stem = key.replace(':', '_')
    return {'key': key, 'part': part, 'viewer': viewer, 'batchId': batch_id, 'capturedBy': 'executor:03-17',
            'controllerSha256': CONTROLLER_SHA256, 'controlDocumentSha256': CONTROL_DOCUMENT_SHA256,
            'engineDllSha256': SYNTHETIC_ENGINE_LIBRARY_SHA256, 'l2IniSha256Before': SYNTHETIC_DEBUG_PROFILE_SHA256,
            'l2IniSha256After': SYNTHETIC_DEBUG_PROFILE_SHA256, 'windowSize': {'width': 1440, 'height': 900},
            'clientSize': {'width': 1424, 'height': 861}, 'actionStatuses': ['inputSent'], 'captureMethod': 'PrintWindow',
            'pngPath': f'C:/Lineage2-client-support/debug-control/captures/{batch_id}/{stem}.png', 'pngSha256': png_sha256,
            'capturedAtRiga': NATIVE_CAPTURED_AT_RIGA, **changes}


def synthetic_native_png_bytes(key):
    return f'synthetic native png of {key}'.encode()


def capture_transcript(batch_id, keys, **changes):
    receipts = [native_capture_receipt(batch_id, key, part, viewer, hashlib.sha256(synthetic_native_png_bytes(key)).hexdigest())
                for key, part, viewer in keys]
    return {'program': 'capture', 'taskName': f'L2b-NativeCapture-{batch_id}', 'registered': True, 'completed': True, 'taskGone': True,
            'completion': {'batchId': batch_id, 'status': 'complete', 'error': None, 'receiptCount': len(receipts)},
            'l2IniSha256After': SYNTHETIC_DEBUG_PROFILE_SHA256, 'receipts': receipts, **copy.deepcopy(changes)}


def task_removal_transcript(batch_id, task_gone=True):
    return {'program': 'task-removal', 'taskName': f'L2b-NativeCapture-{batch_id}', 'taskGone': task_gone}


def prepare_folder_transcript(input_document):
    return {'program': 'prepare-capture-folder', 'captureFolder': input_document['captureFolder']}


class NativeCaptureProjectTestCase(unittest.TestCase):
    def setUp(self):
        self.project_root = self.empty_project_root()
        for part, records in native_batch_records().items():
            write_side_by_side_records(self.project_root, part, records)

    def empty_project_root(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        project_root = Path(temporary_directory.name).resolve()
        write_reference_client_lock(project_root)
        return project_root

    def run_entry_point(self, entry_point, transcript, arguments, project_root):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = entry_point(list(arguments), project_root=project_root or self.project_root, run_command=transcript)
        return exit_code, stdout.getvalue(), stderr.getvalue()

    def run_driver(self, transcript, *arguments, project_root=None):
        return self.run_entry_point(main, transcript, arguments, project_root)
