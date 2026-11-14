from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import NamedTuple

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.side_by_side_check_halves import key_file_stem
from native_store.side_by_side_check_records import read_project_reference_client_lock, read_side_by_side_records
from native_store.store_paths import REPOSITORY_ROOT
from side_by_side.build_pair_queue import (ITEM_VIEWER, NPC_VIEWER, OFFLINE_DEBUG_SESSION_KIND, OFFLINE_DEBUG_STARTUP_ROUTE, SKILL_VIEWER,
                                           stored_reason_for_session_kind)
from side_by_side.native_capture_remote_programs import (BATCH_INPUT_FILE_NAME, BATCH_SCRIPT, BATCH_SCRIPT_FILE_NAME, CAPTURE_PROGRAM_NAME,
                                                         COMPLETION_MARKER_FILE_NAME, PREFLIGHT_PROGRAM_NAME, PREPARE_FOLDER_PROGRAM_NAME,
                                                         TASK_REMOVAL_PROGRAM_NAME, encoded_powershell_command)
from side_by_side.native_capture_transcripts import (COMPLETE_STATUS, INTERACTIVE_SESSION_ID, NATIVE_BATCH_PARTS, REFERENCE_CLIENT_ROOT,
                                                     NativeCaptureError, NativeCapturePreflightRefused, is_captured_by_identity,
                                                     native_capture_receipt_problems, preflight_refusals, validate_capture_transcript,
                                                     validate_preflight_transcript, validate_task_removal_transcript)

IMPORTA_SSH_ALIAS = 'fleet-importa-pc'
SSH_OPTIONS = ('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8')
REMOTE_SUPPORT_ROOT = 'C:/Lineage2-client-support/debug-control'
REMOTE_CONTROLLER_PATH = f'{REMOTE_SUPPORT_ROOT}/Control-L2.ps1'
REMOTE_CONTROL_DOCUMENT_PATH = f'{REMOTE_SUPPORT_ROOT}/CONTROL.md'
REMOTE_CAPTURE_ROOT = f'{REMOTE_SUPPORT_ROOT}/captures'
REMOTE_ENGINE_LIBRARY_PATH = f'{REFERENCE_CLIENT_ROOT}/system/Engine.dll'
REMOTE_L2_INI_PATH = f'{REFERENCE_CLIENT_ROOT}/system/l2.ini'
LINEAGE_CLIENT_PROCESS_NAMES = ('l2.exe', 'l2.bin')
LEVELUP_BOT_PROCESS_TEXT = 'l2-levelup-assistant'
TASK_USER_NAME = 'rolan'
TASK_NAME_PREFIX = 'L2b-NativeCapture-'
RIGA_TIME_ZONE_ID = 'FLE Standard Time'
BATCH_BASE_SECONDS = 120
BATCH_SECONDS_PER_KEY = 30
REMOTE_PROGRAM_TIMEOUT_SECONDS = 180
NATIVE_BATCH_VIEWERS = (OFFLINE_DEBUG_STARTUP_ROUTE, NPC_VIEWER, ITEM_VIEWER, SKILL_VIEWER)
VIEWER_COMMANDS = {OFFLINE_DEBUG_STARTUP_ROUTE: None, NPC_VIEWER: NPC_VIEWER, ITEM_VIEWER: ITEM_VIEWER, SKILL_VIEWER: SKILL_VIEWER}
NATIVE_SESSION_REASON = stored_reason_for_session_kind(OFFLINE_DEBUG_SESSION_KIND)
BATCH_ID_PATTERN = re.compile(r'^(?:offline-debug-startup|nv|pv|sv)-[0-9a-f]{12}$')
REMOTE_FILE_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_-]{0,119}\.(?:png|json|ps1)$')
SEND_KEYS_LITERAL_PATTERN = re.compile(r"^[A-Za-z0-9 '.,-]{1,64}$")
LOCAL_CAPTURE_FOLDER = Path('artifacts/side-by-side/native-capture')
UPLOAD_TIMEOUT_SECONDS = 120
IMPORT_COMMAND_TEXT = 'python -B scripts/side_by_side/import_native_captures.py --batch '


class NativeCaptureKey(NamedTuple):
    key: str
    part: str
    viewer: str
    command: str | None
    skill_id: int | None
    search_text: str | None


class NativeCaptureBatch(NamedTuple):
    viewer: str
    batch_id: str
    keys: tuple

    def time_limit_seconds(self):
        return BATCH_BASE_SECONDS + BATCH_SECONDS_PER_KEY * len(self.keys)

    def task_name(self):
        return TASK_NAME_PREFIX + self.batch_id


def native_selection_viewer(native_selection):
    return native_selection.get('route', native_selection.get('viewer'))


def capture_search_text(key, viewer, native_selection):
    if viewer == NPC_VIEWER:
        search_text = native_selection['searchText']
    elif viewer == ITEM_VIEWER:
        search_text = str(native_selection['itemId'])
    else:
        return None
    if not SEND_KEYS_LITERAL_PATTERN.fullmatch(search_text):
        raise NativeCaptureError(f'search text of {key} holds a character outside letters, digits, space and \' . , -: {search_text!r}')
    return search_text


def native_capture_key(record, part, viewer):
    native_selection = record['nativeSelection']
    return NativeCaptureKey(record['key'], part, viewer, VIEWER_COMMANDS[viewer],
                            native_selection['skillId'] if viewer == SKILL_VIEWER else None,
                            capture_search_text(record['key'], viewer, native_selection))


def native_batch_id(viewer, keys):
    return f'{viewer}-{hashlib.sha256(canonical_json_bytes(sorted(keys))).hexdigest()[:12]}'


def require_native_batch_viewer(viewer):
    if viewer not in NATIVE_BATCH_VIEWERS:
        raise NativeCaptureError(f'native batch must be one of {", ".join(NATIVE_BATCH_VIEWERS)}, not {viewer!r}')
    return viewer


def select_native_batch(project_root, viewer):
    require_native_batch_viewer(viewer)
    keys = tuple(native_capture_key(record, part, viewer) for part in NATIVE_BATCH_PARTS for record in read_side_by_side_records(project_root, part)
                 if record['reason'] == NATIVE_SESSION_REASON and native_selection_viewer(record['nativeSelection']) == viewer)
    return NativeCaptureBatch(viewer, native_batch_id(viewer, [capture_key.key for capture_key in keys]), keys)


def remote_capture_folder(batch_id):
    if not (isinstance(batch_id, str) and BATCH_ID_PATTERN.fullmatch(batch_id)):
        raise NativeCaptureError(f'native batch id must be a viewer and 12 hex characters, not {batch_id!r}')
    return f'{REMOTE_CAPTURE_ROOT}/{batch_id}'


def confined_remote_capture_path(batch_id, file_name):
    folder = remote_capture_folder(batch_id)
    if not (isinstance(file_name, str) and REMOTE_FILE_NAME_PATTERN.fullmatch(file_name)):
        raise NativeCaptureError(f'remote capture path {folder}/{file_name} is outside {folder}/')
    return f'{folder}/{file_name}'


def key_png_file_name(key):
    return key_file_stem(key) + '.png'


def key_receipt_file_name(key):
    return key_file_stem(key) + '.json'


def batch_input_document(batch, captured_by):
    return {'batchId': batch.batch_id, 'capturedBy': captured_by, 'controllerPath': REMOTE_CONTROLLER_PATH,
            'controlDocumentPath': REMOTE_CONTROL_DOCUMENT_PATH, 'engineLibraryPath': REMOTE_ENGINE_LIBRARY_PATH,
            'l2IniPath': REMOTE_L2_INI_PATH, 'rigaTimeZoneId': RIGA_TIME_ZONE_ID,
            'completionMarkerPath': confined_remote_capture_path(batch.batch_id, COMPLETION_MARKER_FILE_NAME),
            'keys': [{'key': capture_key.key, 'part': capture_key.part, 'viewer': capture_key.viewer, 'command': capture_key.command,
                      'skillId': capture_key.skill_id, 'searchText': capture_key.search_text,
                      'pngPath': confined_remote_capture_path(batch.batch_id, key_png_file_name(capture_key.key)),
                      'receiptPath': confined_remote_capture_path(batch.batch_id, key_receipt_file_name(capture_key.key))}
                     for capture_key in batch.keys]}


def preflight_input():
    return {'program': PREFLIGHT_PROGRAM_NAME, 'controllerPath': REMOTE_CONTROLLER_PATH, 'controlDocumentPath': REMOTE_CONTROL_DOCUMENT_PATH,
            'engineLibraryPath': REMOTE_ENGINE_LIBRARY_PATH, 'l2IniPath': REMOTE_L2_INI_PATH,
            'clientProcessNames': list(LINEAGE_CLIENT_PROCESS_NAMES), 'botProcessText': LEVELUP_BOT_PROCESS_TEXT,
            'sessionId': INTERACTIVE_SESSION_ID}


def prepare_folder_input(batch):
    return {'program': PREPARE_FOLDER_PROGRAM_NAME, 'captureRoot': REMOTE_CAPTURE_ROOT, 'captureFolder': remote_capture_folder(batch.batch_id),
            'completionMarkerPath': confined_remote_capture_path(batch.batch_id, COMPLETION_MARKER_FILE_NAME)}


def capture_input(batch):
    return {'program': CAPTURE_PROGRAM_NAME, 'taskName': batch.task_name(), 'userName': TASK_USER_NAME,
            'batchScriptPath': confined_remote_capture_path(batch.batch_id, BATCH_SCRIPT_FILE_NAME),
            'timeLimitSeconds': batch.time_limit_seconds(), 'l2IniPath': REMOTE_L2_INI_PATH,
            'completionMarkerPath': confined_remote_capture_path(batch.batch_id, COMPLETION_MARKER_FILE_NAME),
            'batchInputPath': confined_remote_capture_path(batch.batch_id, BATCH_INPUT_FILE_NAME)}


def task_removal_input(batch):
    return {'program': TASK_REMOVAL_PROGRAM_NAME, 'taskName': batch.task_name()}


def ssh_powershell_command(program_name, input_document):
    return ['ssh', *SSH_OPTIONS, IMPORTA_SSH_ALIAS, 'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand',
            encoded_powershell_command(program_name, input_document)]


def scp_upload_command(local_path, remote_path):
    return ['scp', '-q', *SSH_OPTIONS, str(local_path), f'{IMPORTA_SSH_ALIAS}:{remote_path}']


def local_batch_folder(project_root, batch_id):
    return Path(project_root) / LOCAL_CAPTURE_FOLDER / batch_id


def native_capture_steps(project_root, batch):
    local_folder = local_batch_folder(project_root, batch.batch_id)
    return [
        ('preflight', ssh_powershell_command(PREFLIGHT_PROGRAM_NAME, preflight_input())),
        ('prepare-capture-folder', ssh_powershell_command(PREPARE_FOLDER_PROGRAM_NAME, prepare_folder_input(batch))),
        ('copy-batch-script', scp_upload_command(local_folder / BATCH_SCRIPT_FILE_NAME,
                                                 confined_remote_capture_path(batch.batch_id, BATCH_SCRIPT_FILE_NAME))),
        ('copy-batch-input', scp_upload_command(local_folder / BATCH_INPUT_FILE_NAME,
                                                confined_remote_capture_path(batch.batch_id, BATCH_INPUT_FILE_NAME))),
        ('capture', ssh_powershell_command(CAPTURE_PROGRAM_NAME, capture_input(batch))),
        ('task-removal', ssh_powershell_command(TASK_REMOVAL_PROGRAM_NAME, task_removal_input(batch))),
    ]


def batch_summary(batch):
    return {'batchId': batch.batch_id, 'viewer': batch.viewer,
            'keys': [{'key': capture_key.key, 'part': capture_key.part, 'command': capture_key.command, 'skillId': capture_key.skill_id,
                      'searchText': capture_key.search_text} for capture_key in batch.keys]}


def first_line(text):
    return next((line.strip() for line in (text or '').splitlines() if line.strip()), '')


def run_remote_program(run_command, program_name, input_document, timeout_seconds=REMOTE_PROGRAM_TIMEOUT_SECONDS):
    completed = run_command(ssh_powershell_command(program_name, input_document), capture_output=True, text=True, timeout=timeout_seconds,
                            check=False)
    if completed.returncode != 0:
        raise NativeCaptureError(f'remote {program_name} program exited {completed.returncode}: {first_line(completed.stderr)}')
    try:
        transcript = json.loads(completed.stdout.lstrip('\ufeff'))
    except json.JSONDecodeError as error:
        raise NativeCaptureError(f'remote {program_name} program printed no JSON: {first_line(completed.stdout)!r}') from error
    if not (isinstance(transcript, dict) and transcript.get('program') == program_name):
        raise NativeCaptureError(f'remote {program_name} program printed a document of another program: {transcript!r}')
    return transcript


def run_preflight(project_root, run_command):
    transcript = validate_preflight_transcript(run_remote_program(run_command, PREFLIGHT_PROGRAM_NAME, preflight_input()))
    refusals = preflight_refusals(transcript, read_project_reference_client_lock(project_root))
    if refusals:
        raise NativeCapturePreflightRefused(refusals)
    return {'preflight': 'clear', 'host': transcript['host'], 'l2IniSha256': transcript['l2IniSha256']}


class NativeCaptureBatchFailed(NativeCaptureError):
    def __init__(self, result):
        super().__init__('; '.join(result['failures']))
        self.result = result


def write_local_batch_files(project_root, batch, captured_by):
    local_folder = local_batch_folder(project_root, batch.batch_id)
    replace_file(local_folder / BATCH_SCRIPT_FILE_NAME, BATCH_SCRIPT.encode('utf-8'))
    replace_file(local_folder / BATCH_INPUT_FILE_NAME, canonical_json_bytes(batch_input_document(batch, captured_by)))
    return local_folder


def run_upload(run_command, local_path, remote_path):
    completed = run_command(scp_upload_command(local_path, remote_path), capture_output=True, text=True, timeout=UPLOAD_TIMEOUT_SECONDS,
                            check=False)
    if completed.returncode != 0:
        raise NativeCaptureError(f'scp of {Path(local_path).name} to {remote_path} exited {completed.returncode}: {first_line(completed.stderr)}')


def still_registered_failure(batch):
    return f'temporary task {batch.task_name()} is still registered after unregistering'


def receipt_failures(project_root, batch, receipts):
    lock = read_project_reference_client_lock(project_root)
    batch_keys = [capture_key.key for capture_key in batch.keys]
    failures = []
    for receipt in receipts:
        key = receipt.get('key')
        if key not in batch_keys:
            failures.append(f'receipt of {key!r} is not a key of batch {batch.batch_id}')
            continue
        expected_png_path = confined_remote_capture_path(batch.batch_id, key_png_file_name(key))
        failures += [f'receipt of {key} {problem}' for problem in native_capture_receipt_problems(receipt, batch.batch_id, expected_png_path, lock)]
    received_keys = {receipt.get('key') for receipt in receipts}
    missing_keys = [key for key in batch_keys if key not in received_keys]
    if missing_keys:
        failures.append(f'no receipt for {", ".join(missing_keys)}')
    return failures


def capture_transcript_failures(project_root, batch, transcript, l2_ini_before):
    failures = [] if transcript['taskGone'] else [still_registered_failure(batch)]
    if transcript['l2IniSha256After'] != l2_ini_before:
        failures.append(f'system/l2.ini changed during the batch: {l2_ini_before} before, {transcript["l2IniSha256After"]} after')
    completion = transcript['completion']
    if not transcript['completed']:
        failures.append(f'the batch wrote no completion marker within {batch.time_limit_seconds()} seconds')
    elif completion is None or completion['status'] != COMPLETE_STATUS:
        failures.append(f'the batch script did not complete: {first_line((completion or {}).get("error"))}')
    return failures + receipt_failures(project_root, batch, transcript['receipts'])


def run_capture_step(run_command, batch):
    transcript = run_remote_program(run_command, CAPTURE_PROGRAM_NAME, capture_input(batch),
                                    batch.time_limit_seconds() + REMOTE_PROGRAM_TIMEOUT_SECONDS)
    return validate_capture_transcript(transcript)


def run_task_removal(run_command, batch):
    return validate_task_removal_transcript(run_remote_program(run_command, TASK_REMOVAL_PROGRAM_NAME, task_removal_input(batch)))


def require_capturable_batch(project_root, batch, captured_by):
    if not is_captured_by_identity(captured_by):
        raise NativeCaptureError(f'--captured-by must be executor:03-NN or owner, not {captured_by!r}')
    if not batch.keys:
        raise NativeCaptureError(f'native batch {batch.batch_id} has no keys; nothing to capture')
    native_capture_steps(project_root, batch)
    batch_input_document(batch, captured_by)


def run_native_capture(project_root, batch, captured_by, run_command):
    require_capturable_batch(project_root, batch, captured_by)
    preflight = run_preflight(project_root, run_command)
    run_remote_program(run_command, PREPARE_FOLDER_PROGRAM_NAME, prepare_folder_input(batch))
    local_folder = write_local_batch_files(project_root, batch, captured_by)
    for file_name in (BATCH_SCRIPT_FILE_NAME, BATCH_INPUT_FILE_NAME):
        run_upload(run_command, local_folder / file_name, confined_remote_capture_path(batch.batch_id, file_name))
    failures, transcript = [], None
    try:
        transcript = run_capture_step(run_command, batch)
    except (NativeCaptureError, subprocess.TimeoutExpired) as error:
        failures.append(str(error))
    finally:
        removal = run_task_removal(run_command, batch)
    if not removal['taskGone']:
        failures.append(still_registered_failure(batch))
    if transcript is not None:
        failures += capture_transcript_failures(project_root, batch, transcript, preflight['l2IniSha256'])
    failures = list(dict.fromkeys(failures))
    result = {'batchId': batch.batch_id, 'viewer': batch.viewer, 'status': 'failed' if failures else 'captured', 'failures': failures,
              'taskName': batch.task_name(), 'taskGone': removal['taskGone'], 'l2IniSha256Before': preflight['l2IniSha256'],
              'l2IniSha256After': None if transcript is None else transcript['l2IniSha256After'],
              'receipts': 0 if transcript is None else len(transcript['receipts']),
              'importCommand': None if failures else IMPORT_COMMAND_TEXT + batch.batch_id}
    if failures:
        raise NativeCaptureBatchFailed(result)
    return result


def run_batch_dry_run(project_root, arguments, run_command):
    batch = select_native_batch(project_root, arguments.batch)
    return {**batch_summary(batch), 'steps': [{'step': name, 'command': command} for name, command in native_capture_steps(project_root, batch)]}


def run_preflight_command(project_root, arguments, run_command):
    return run_preflight(project_root, run_command)


def run_capture_command(project_root, arguments, run_command):
    return run_native_capture(project_root, select_native_batch(project_root, arguments.batch), arguments.captured_by, run_command)


def command_parser():
    parser = argparse.ArgumentParser(description='Select, preflight and capture native halves on IMPORTA-PC through Control-L2.ps1.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    batch_parser = subparsers.add_parser('batch', help='print a native batch and every remote command of its capture run without ssh')
    batch_parser.add_argument('--batch', choices=NATIVE_BATCH_VIEWERS, required=True)
    batch_parser.add_argument('--dry-run', action='store_true', required=True)
    batch_parser.set_defaults(run=run_batch_dry_run)
    preflight_parser = subparsers.add_parser('preflight', help='check the controller pins, Engine.dll, session 1, foreign clients and l2.ini')
    preflight_parser.set_defaults(run=run_preflight_command)
    capture_parser = subparsers.add_parser('capture', help='run one native batch through one temporary interactive task in session 1')
    capture_parser.add_argument('--batch', choices=NATIVE_BATCH_VIEWERS, required=True)
    capture_parser.add_argument('--captured-by', required=True)
    capture_parser.set_defaults(run=run_capture_command)
    return parser


def main(argv=None, project_root=REPOSITORY_ROOT, run_command=subprocess.run):
    arguments = command_parser().parse_args(argv)
    try:
        result = arguments.run(project_root, arguments, run_command)
    except NativeCapturePreflightRefused as refusal:
        for line in refusal.refusals:
            print(f'Native capture preflight refused: {line}', file=sys.stderr)
        return 1
    except NativeCaptureBatchFailed as failure:
        print(json.dumps(failure.result, sort_keys=True))
        for line in failure.result['failures']:
            print(f'Native capture batch failed: {line}', file=sys.stderr)
        return 1
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'Native capture {arguments.command} failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
