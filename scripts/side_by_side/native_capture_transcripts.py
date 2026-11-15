from __future__ import annotations

from native_assets_lib.asset_manifest import reference_client_build
from native_store.load_check_records import is_catalog_key, is_riga_timestamp
from native_store.side_by_side_check_halves import (EXECUTOR_CAPTURE_PATTERN, OWNER_IDENTITY, is_non_empty_text, is_positive_integer,
                                                    is_sha256)
from side_by_side.build_pair_queue import ITEM_VIEWER, NPC_VIEWER, OFFLINE_DEBUG_STARTUP_ROUTE, PART_BY_KIND, SKILL_VIEWER

REFERENCE_CLIENT_ROOT = 'C:/Lineage2-client'
CONTROLLER_SHA256 = '542b89cc299dae3ac0d045d272d309f72936af8b39fab22ee1a57a6a24caeadc'
CONTROL_DOCUMENT_SHA256 = 'acd93f64580261369a4f209c81cee7d48694d0299160467d844ec9c6a3137262'
DEBUG_PROFILE_LOCK_PATH = 'connection-profiles/l2-Debug.ini'
INTERACTIVE_SESSION_ID = 1
ACTIVE_SESSION_STATE = 'Active'
NATIVE_BATCH_PART_BY_VIEWER = {OFFLINE_DEBUG_STARTUP_ROUTE: PART_BY_KIND['tile'], NPC_VIEWER: PART_BY_KIND['npc'],
                               ITEM_VIEWER: PART_BY_KIND['item'], SKILL_VIEWER: PART_BY_KIND['skill']}
NATIVE_BATCH_PARTS = tuple(NATIVE_BATCH_PART_BY_VIEWER.values())
PROCESS_FIELDS = frozenset({'processId', 'name', 'path'})
PREFLIGHT_TRANSCRIPT_FIELDS = frozenset({'program', 'host', 'controllerSha256', 'controlDocumentSha256', 'engineDllSha256', 'l2IniSha256',
                                         'clientProcesses', 'botProcesses', 'sessionId', 'sessionState'})
PREFLIGHT_SHA256_FIELDS = ('controllerSha256', 'controlDocumentSha256', 'engineDllSha256', 'l2IniSha256')
CAPTURE_TRANSCRIPT_FIELDS = frozenset({'program', 'taskName', 'registered', 'completed', 'taskGone', 'completion', 'l2IniSha256After',
                                       'receipts'})
TASK_REMOVAL_TRANSCRIPT_FIELDS = frozenset({'program', 'taskName', 'taskGone'})
COMPLETION_FIELDS = frozenset({'batchId', 'status', 'error', 'receiptCount'})
COMPLETE_STATUS = 'complete'
NATIVE_CAPTURE_RECEIPT_FIELDS = frozenset({'key', 'part', 'viewer', 'batchId', 'capturedBy', 'controllerSha256', 'controlDocumentSha256',
                                           'engineDllSha256', 'l2IniSha256Before', 'l2IniSha256After', 'windowSize', 'clientSize',
                                           'actionStatuses', 'captureMethod', 'pngPath', 'pngSha256', 'capturedAtRiga'})
RECEIPT_SHA256_FIELDS = ('controllerSha256', 'controlDocumentSha256', 'engineDllSha256', 'l2IniSha256Before', 'l2IniSha256After', 'pngSha256')
SIZE_FIELDS = frozenset({'width', 'height'})


class NativeCaptureError(ValueError):
    pass


class NativeCapturePreflightRefused(NativeCaptureError):
    def __init__(self, refusals):
        super().__init__('; '.join(refusals))
        self.refusals = refusals


def is_captured_by_identity(captured_by):
    return isinstance(captured_by, str) and (EXECUTOR_CAPTURE_PATTERN.fullmatch(captured_by) is not None or captured_by == OWNER_IDENTITY)


def require_exact_transcript_fields(transcript, fields, label):
    if not (isinstance(transcript, dict) and set(transcript) == fields):
        raise NativeCaptureError(f'{label} must hold exactly {", ".join(sorted(fields))}')
    return transcript


def is_process_entry(entry):
    return (isinstance(entry, dict) and set(entry) == PROCESS_FIELDS and type(entry['processId']) is int
            and isinstance(entry['name'], str) and (entry['path'] is None or isinstance(entry['path'], str)))


def validate_preflight_transcript(transcript):
    require_exact_transcript_fields(transcript, PREFLIGHT_TRANSCRIPT_FIELDS, 'preflight transcript')
    for field in PREFLIGHT_SHA256_FIELDS:
        if not is_sha256(transcript[field]):
            raise NativeCaptureError(f'preflight transcript {field} must be 64 lowercase hex characters, not {transcript[field]!r}')
    for field in ('clientProcesses', 'botProcesses'):
        if not (isinstance(transcript[field], list) and all(is_process_entry(entry) for entry in transcript[field])):
            raise NativeCaptureError(f'preflight transcript {field} must be a list of processes with processId, name and path')
    if not (transcript['sessionState'] is None or isinstance(transcript['sessionState'], str)):
        raise NativeCaptureError('preflight transcript sessionState must be text or null')
    return transcript


def debug_profile_sha256(lock):
    record = lock.record(DEBUG_PROFILE_LOCK_PATH)
    if record is None or not is_sha256(record['importaSha256']):
        raise NativeCaptureError(f'reference client lock records no IMPORTA SHA-256 of {DEBUG_PROFILE_LOCK_PATH}')
    return record['importaSha256']


def locked_engine_dll_sha256(lock):
    return reference_client_build(lock)['engineDllSha256']


def is_reference_client_process_path(path):
    reference_root = REFERENCE_CLIENT_ROOT.replace('/', '\\').casefold() + '\\'
    return isinstance(path, str) and path.replace('/', '\\').casefold().startswith(reference_root)


def preflight_refusals(transcript, lock):
    refusals = []
    for field, pinned_sha256, name in (('controllerSha256', CONTROLLER_SHA256, 'Control-L2.ps1'),
                                       ('controlDocumentSha256', CONTROL_DOCUMENT_SHA256, 'CONTROL.md')):
        if transcript[field] != pinned_sha256:
            refusals.append(f'{name} SHA-256 {transcript[field]} differs from the pinned {pinned_sha256}; re-pin it before a capture')
    engine_dll_sha256 = locked_engine_dll_sha256(lock)
    if transcript['engineDllSha256'] != engine_dll_sha256:
        refusals.append(f'system/Engine.dll SHA-256 {transcript["engineDllSha256"]} differs from the reference client lock {engine_dll_sha256}')
    for process in transcript['clientProcesses']:
        if not is_reference_client_process_path(process['path']):
            refusals.append(f'a Lineage II client outside {REFERENCE_CLIENT_ROOT} runs: process {process["processId"]} {process["path"]}')
    for process in transcript['botProcesses']:
        refusals.append(f'the levelup bot runs: process {process["processId"]} {process["name"]} {process["path"]}')
    if transcript['sessionState'] != ACTIVE_SESSION_STATE:
        refusals.append(f'session {INTERACTIVE_SESSION_ID} is not active: {transcript["sessionState"]}')
    debug_sha256 = debug_profile_sha256(lock)
    if transcript['l2IniSha256'] != debug_sha256:
        refusals.append(f'system/l2.ini SHA-256 {transcript["l2IniSha256"]} is not the Debug profile {debug_sha256} of {DEBUG_PROFILE_LOCK_PATH}')
    return refusals


def validate_task_removal_transcript(transcript):
    require_exact_transcript_fields(transcript, TASK_REMOVAL_TRANSCRIPT_FIELDS, 'task removal transcript')
    if type(transcript['taskGone']) is not bool:
        raise NativeCaptureError('task removal transcript taskGone must be true or false')
    return transcript


def validate_capture_transcript(transcript):
    require_exact_transcript_fields(transcript, CAPTURE_TRANSCRIPT_FIELDS, 'capture transcript')
    for field in ('registered', 'completed', 'taskGone'):
        if type(transcript[field]) is not bool:
            raise NativeCaptureError(f'capture transcript {field} must be true or false')
    if transcript['completion'] is not None:
        require_exact_transcript_fields(transcript['completion'], COMPLETION_FIELDS, 'capture transcript completion')
    if not is_sha256(transcript['l2IniSha256After']):
        raise NativeCaptureError('capture transcript l2IniSha256After must be 64 lowercase hex characters')
    if not (isinstance(transcript['receipts'], list) and all(isinstance(receipt, dict) for receipt in transcript['receipts'])):
        raise NativeCaptureError('capture transcript receipts must be a list of receipt objects')
    return transcript


def is_size(size):
    return isinstance(size, dict) and set(size) == SIZE_FIELDS and all(is_positive_integer(size[field]) for field in SIZE_FIELDS)


def native_capture_receipt_problems(receipt, batch_id, expected_png_path, lock):
    if not (isinstance(receipt, dict) and set(receipt) == NATIVE_CAPTURE_RECEIPT_FIELDS):
        return [f'must hold exactly {", ".join(sorted(NATIVE_CAPTURE_RECEIPT_FIELDS))}']
    problems = [f'{field} must be 64 lowercase hex characters' for field in RECEIPT_SHA256_FIELDS if not is_sha256(receipt[field])]
    viewer = batch_id.rsplit('-', 1)[0]
    checks = (
        (is_catalog_key(receipt['key']), 'key must be a catalog key'),
        (receipt['batchId'] == batch_id, f'batchId must be {batch_id}'),
        (receipt['viewer'] == viewer, f'viewer must be {viewer}, the viewer of its batch'),
        (receipt['part'] == NATIVE_BATCH_PART_BY_VIEWER.get(viewer), f'part must be {NATIVE_BATCH_PART_BY_VIEWER.get(viewer)}, the part of {viewer}'),
        (is_captured_by_identity(receipt['capturedBy']), f'capturedBy must match {EXECUTOR_CAPTURE_PATTERN.pattern} or {OWNER_IDENTITY}'),
        (is_size(receipt['windowSize']) and is_size(receipt['clientSize']), 'windowSize and clientSize must hold positive width and height'),
        (isinstance(receipt['actionStatuses'], list) and all(is_non_empty_text(status) for status in receipt['actionStatuses']),
         'actionStatuses must be a list of texts'),
        (is_non_empty_text(receipt['captureMethod']), 'captureMethod must be non-empty text'),
        (receipt['pngPath'] == expected_png_path, f'pngPath must be {expected_png_path}'),
        (is_riga_timestamp(receipt['capturedAtRiga']), 'capturedAtRiga must be ISO 8601 with the Riga offset'),
        (receipt['controllerSha256'] == CONTROLLER_SHA256, f'controllerSha256 must be the pinned {CONTROLLER_SHA256}'),
        (receipt['controlDocumentSha256'] == CONTROL_DOCUMENT_SHA256, f'controlDocumentSha256 must be the pinned {CONTROL_DOCUMENT_SHA256}'),
        (receipt['engineDllSha256'] == locked_engine_dll_sha256(lock),
         f'engineDllSha256 {receipt["engineDllSha256"]} must be the reference client lock {locked_engine_dll_sha256(lock)}'),
        (receipt['l2IniSha256Before'] == receipt['l2IniSha256After'],
         f'system/l2.ini changed during the capture: {receipt["l2IniSha256Before"]} before, {receipt["l2IniSha256After"]} after'),
        (receipt['l2IniSha256Before'] == debug_profile_sha256(lock), f'l2IniSha256Before must be the Debug profile {debug_profile_sha256(lock)}'),
    )
    return problems + [message for passed, message in checks if not passed]


def require_native_capture_receipt(receipt, batch_id, expected_png_path, lock, label):
    problems = native_capture_receipt_problems(receipt, batch_id, expected_png_path, lock)
    if problems:
        raise NativeCaptureError(f'{label} {problems[0]}')
    return receipt
