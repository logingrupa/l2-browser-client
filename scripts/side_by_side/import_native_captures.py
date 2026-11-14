from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import NamedTuple

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.catalog_writer import sha256_of_file
from native_store.load_check_records import is_catalog_key
from native_store.side_by_side_check_records import (current_reference_tree_lock_sha256, read_project_reference_client_lock,
                                                     read_side_by_side_records, write_side_by_side_records)
from native_store.store_paths import REPOSITORY_ROOT
from side_by_side.build_pair_queue import reason_with_native_half
from side_by_side.native_capture_driver import (IMPORTA_SSH_ALIAS, SSH_OPTIONS, confined_remote_capture_path, first_line, key_png_file_name,
                                                key_receipt_file_name, remote_capture_folder)
from side_by_side.native_capture_remote_programs import BATCH_INPUT_FILE_NAME, COMPLETION_MARKER_FILE_NAME
from side_by_side.native_capture_transcripts import (COMPLETE_STATUS, COMPLETION_FIELDS, NativeCaptureError, require_exact_transcript_fields,
                                                     require_native_capture_receipt)
from side_by_side.pair_queue_union import read_strict_json_file

NATIVE_IMPORT_FOLDER = Path('artifacts/side-by-side/native-import')
SIDE_BY_SIDE_ARTIFACTS_FOLDER = Path('artifacts/side-by-side')
NATIVE_FOLDER_NAME = 'native'
DOWNLOAD_TIMEOUT_SECONDS = 600
JUDGED_VERDICTS = ('pass', 'mismatch')


class VerifiedCapture(NamedTuple):
    receipt: dict
    receipt_path: Path
    png_path: Path


def scp_download_command(batch_id, import_parent):
    return ['scp', '-q', '-r', *SSH_OPTIONS, f'{IMPORTA_SSH_ALIAS}:{remote_capture_folder(batch_id)}', str(import_parent)]


def download_batch_folder(project_root, batch_id, run_command):
    import_parent = Path(project_root) / NATIVE_IMPORT_FOLDER
    batch_folder = import_parent / batch_id
    command = scp_download_command(batch_id, import_parent)
    if batch_folder.exists():
        shutil.rmtree(batch_folder)
    import_parent.mkdir(parents=True, exist_ok=True)
    completed = run_command(command, capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT_SECONDS, check=False)
    if completed.returncode != 0:
        raise NativeCaptureError(f'scp of batch {batch_id} from IMPORTA-PC exited {completed.returncode}: {first_line(completed.stderr)}')
    if not batch_folder.is_dir():
        raise NativeCaptureError(f'scp of batch {batch_id} left no folder at {batch_folder}')
    return batch_folder


def completed_batch_keys(batch_folder, batch_id):
    completion = read_strict_json_file(batch_folder / COMPLETION_MARKER_FILE_NAME, 'batch completion marker')
    require_exact_transcript_fields(completion, COMPLETION_FIELDS, 'batch completion marker')
    if completion['batchId'] != batch_id or completion['status'] != COMPLETE_STATUS:
        raise NativeCaptureError(f'batch {batch_id} did not complete: {completion["status"]} {first_line(completion["error"])}')
    batch_input = read_strict_json_file(batch_folder / BATCH_INPUT_FILE_NAME, 'batch input')
    if not (isinstance(batch_input, dict) and batch_input.get('batchId') == batch_id and isinstance(batch_input.get('keys'), list)
            and all(isinstance(entry, dict) and is_catalog_key(entry.get('key')) for entry in batch_input['keys'])):
        raise NativeCaptureError(f'batch input of {batch_id} must name its batch and list catalog keys')
    return [entry['key'] for entry in batch_input['keys']]


def verified_captures(project_root, batch_folder, batch_id, keys):
    lock = read_project_reference_client_lock(project_root)
    captures, differing_keys = [], []
    for key in keys:
        receipt_path = batch_folder / key_receipt_file_name(key)
        receipt = require_native_capture_receipt(read_strict_json_file(receipt_path, 'native receipt'), batch_id,
                                                 confined_remote_capture_path(batch_id, key_png_file_name(key)), lock,
                                                 f'native receipt {receipt_path.name}')
        if receipt['key'] != key:
            raise NativeCaptureError(f'native receipt {receipt_path.name} names key {receipt["key"]}, not {key}')
        png_path = batch_folder / key_png_file_name(key)
        if not (png_path.is_file() and sha256_of_file(png_path) == receipt['pngSha256']):
            differing_keys.append(key)
        captures.append(VerifiedCapture(receipt, receipt_path, png_path))
    if differing_keys:
        raise NativeCaptureError(f'batch {batch_id} refused: the PNG of {", ".join(differing_keys)} is missing or differs from the SHA-256 '
                                 'computed on IMPORTA-PC')
    return captures


def native_folder(project_root, part):
    return Path(project_root) / SIDE_BY_SIDE_ARTIFACTS_FOLDER / part / NATIVE_FOLDER_NAME


def native_half_of(capture, reference_tree_lock_sha256):
    receipt = capture.receipt
    receipt_relative = (SIDE_BY_SIDE_ARTIFACTS_FOLDER / receipt['part'] / NATIVE_FOLDER_NAME / capture.receipt_path.name).as_posix()
    return {'referenceTreeLockSha256': reference_tree_lock_sha256, 'receiptPath': receipt_relative,
            'receiptSha256': sha256_of_file(capture.receipt_path), 'pngSha256': receipt['pngSha256'], 'windowSize': receipt['windowSize'],
            'l2IniSha256Before': receipt['l2IniSha256Before'], 'l2IniSha256After': receipt['l2IniSha256After'],
            'controllerSha256': receipt['controllerSha256'], 'controlDocumentSha256': receipt['controlDocumentSha256'],
            'capturedBy': receipt['capturedBy'], 'capturedAtRiga': receipt['capturedAtRiga']}


def record_with_native_half(stored_record, native_half):
    if stored_record['nativeHalf'] == native_half:
        return None
    if stored_record['verdict'] in JUDGED_VERDICTS:
        raise NativeCaptureError(f'record {stored_record["key"]} is judged {stored_record["verdict"]}; a new native half needs the reviewer '
                                 'to judge the pair again, so it is not replaced by an import')
    return {**stored_record, 'verdict': 'unverified', 'reason': reason_with_native_half(stored_record['nativeSelection']),
            'nativeHalf': native_half, 'difference': None, 'suspectedStep': None, 'reviewer': None, 'judgedAtRiga': None}


def records_with_native_halves(project_root, captures):
    reference_tree_lock_sha256 = current_reference_tree_lock_sha256(project_root)
    stored_records_by_part = {}
    records_by_part = {}
    for capture in captures:
        part = capture.receipt['part']
        if part not in stored_records_by_part:
            stored_records_by_part[part] = {record['key']: record for record in read_side_by_side_records(project_root, part)}
        stored_record = stored_records_by_part[part].get(capture.receipt['key'])
        if stored_record is None:
            raise NativeCaptureError(f'part {part} has no check record {capture.receipt["key"]}; ingest its sandbox half first')
        record = record_with_native_half(stored_record, native_half_of(capture, reference_tree_lock_sha256))
        if record is not None:
            records_by_part.setdefault(part, []).append(record)
    return records_by_part


def move_into_native_folders(project_root, captures):
    for capture in captures:
        folder = native_folder(project_root, capture.receipt['part'])
        folder.mkdir(parents=True, exist_ok=True)
        os.replace(capture.png_path, folder / capture.png_path.name)
        os.replace(capture.receipt_path, folder / capture.receipt_path.name)


def import_native_batch(project_root, batch_id, run_command):
    batch_folder = download_batch_folder(project_root, batch_id, run_command)
    keys = completed_batch_keys(batch_folder, batch_id)
    captures = verified_captures(project_root, batch_folder, batch_id, keys)
    records_by_part = records_with_native_halves(project_root, captures)
    move_into_native_folders(project_root, captures)
    for part, records in records_by_part.items():
        write_side_by_side_records(project_root, part, records)
    shutil.rmtree(batch_folder)
    return {'batchId': batch_id, 'imported': len(captures), 'written': {part: len(records) for part, records in sorted(records_by_part.items())},
            'unchanged': len(captures) - sum(len(records) for records in records_by_part.values())}


def command_parser():
    parser = argparse.ArgumentParser(description='Copy a captured native batch back from IMPORTA-PC, re-hash it and write its native halves.')
    parser.add_argument('--batch', required=True)
    return parser


def main(argv=None, project_root=REPOSITORY_ROOT, run_command=subprocess.run):
    arguments = command_parser().parse_args(argv)
    try:
        result = import_native_batch(project_root, arguments.batch, run_command)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'Native capture import of {arguments.batch} failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
