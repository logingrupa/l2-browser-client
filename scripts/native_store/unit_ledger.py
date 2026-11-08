from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys

from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import load_gap_reason_patterns, sorted_gap_rows, validate_gap_row
from native_store.store_paths import (REPOSITORY_ROOT, SHA256_PATTERN, STEP_NAME_PATTERN, StorePathError, confined_child_path,
                                      lane_store_root, lane_work_root, refuse_reparse_points, require_known_lane_name,
                                      require_portable_relative_path)
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

BATCH_MINIMUM_FREE_BYTES = 4 * 1024 ** 3
BELOW_NORMAL_PRIORITY_CLASS = 0x4000
MACHINE_SCHEDULE_SCRIPT = 'scripts/check-machine-schedule.mjs'
MACHINE_SCHEDULE_EXIT_OUTSIDE_WINDOW = 0
MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW = 2
UNIT_KEY_PATTERN = re.compile(r'^[a-z][a-z-]*:[A-Za-z0-9_.#:-]+$')
MAXIMUM_UNIT_KEY_LENGTH = 160
LEDGER_OUTPUT_ROOT_FOLDERS = ('l2', 'work')
RECEIPT_CALLER_FIELDS = frozenset({'config', 'inputs', 'outputs', 'gapRows'})
OWNER_RECORD_NAME = 'owner.json'
RUNNING_MARKER_NAME = '.running.json'
RECEIPT_RECORD_NAME = 'receipt.json'
SEAL_RECORD_NAME = 'complete.json'


class UnitLedgerError(ValueError):
    pass


class BatchPreflightRefusedError(UnitLedgerError):
    pass


def sha256_of_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def sha256_of_file(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def current_riga_timestamp():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def write_new_record(path, payload):
    with open(path, 'xb') as stream:
        stream.write(payload)


def read_ledger_record(path):
    try:
        record = json.loads(path.read_bytes())
    except ValueError as error:
        raise UnitLedgerError(f'ledger record is not JSON: {path}') from error
    if not isinstance(record, dict):
        raise UnitLedgerError(f'ledger record is not an object: {path}')
    return record


def require_sha256(value, description):
    if not (isinstance(value, str) and SHA256_PATTERN.fullmatch(value)):
        raise UnitLedgerError(f'{description} must be 64 lowercase hex characters: {value!r}')
    return value


def unit_directory_name(unit_key):
    if not (isinstance(unit_key, str) and len(unit_key) <= MAXIMUM_UNIT_KEY_LENGTH and UNIT_KEY_PATTERN.fullmatch(unit_key)):
        raise UnitLedgerError(f'unit key must match {UNIT_KEY_PATTERN.pattern} within {MAXIMUM_UNIT_KEY_LENGTH} characters: {unit_key!r}')
    directory_name = unit_key.replace(':', '__')
    try:
        return require_portable_relative_path(directory_name)
    except StorePathError as error:
        raise UnitLedgerError(f'unit key does not give a portable folder name: {unit_key!r}') from error


def locked_input_records(relative_paths, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    lock = read_reference_client_lock(Path(lock_path))
    records = []
    for relative_path in relative_paths:
        record = lock.record(relative_path)
        if record is None:
            raise UnitLedgerError(f'reference client lock has no record for {relative_path}')
        if record['class'] != 'equal':
            raise UnitLedgerError(f'reference client file {relative_path} has lock class {record["class"]}, not equal')
        records.append({'path': relative_path, 'sha256': require_sha256(record['eSha256'], f'lock eSha256 of {relative_path}')})
    return sorted(records, key=lambda record: record['path'])


def run_at_below_normal_priority():
    if sys.platform != 'win32':
        raise UnitLedgerError('BelowNormal priority is implemented for Windows hosts only')
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.SetPriorityClass.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.SetPriorityClass.restype = wintypes.BOOL
    kernel32.GetPriorityClass.argtypes = (wintypes.HANDLE,)
    kernel32.GetPriorityClass.restype = wintypes.DWORD
    if not kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS):
        raise UnitLedgerError(f'SetPriorityClass failed with Windows error {ctypes.get_last_error()}')
    priority_class = kernel32.GetPriorityClass(kernel32.GetCurrentProcess())
    if priority_class != BELOW_NORMAL_PRIORITY_CLASS:
        raise UnitLedgerError(f'process priority class is {priority_class:#x}, not BelowNormal {BELOW_NORMAL_PRIORITY_CLASS:#x}')
    return priority_class


def read_machine_schedule(run_command=subprocess.run):
    completed = run_command(['node', str(REPOSITORY_ROOT / MACHINE_SCHEDULE_SCRIPT)], capture_output=True, text=True, check=False)
    if completed.returncode not in (MACHINE_SCHEDULE_EXIT_OUTSIDE_WINDOW, MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW):
        raise UnitLedgerError(f'machine schedule check failed with exit {completed.returncode}: {completed.stderr.strip()}')
    try:
        schedule = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise UnitLedgerError(f'machine schedule check printed no JSON line: {completed.stdout!r}') from error
    if not (isinstance(schedule, dict) and isinstance(schedule.get('host'), str) and isinstance(schedule.get('rigaTime'), str)
            and 'activeWindow' in schedule):
        raise UnitLedgerError(f'machine schedule check printed an unexpected document: {schedule!r}')
    if (schedule['activeWindow'] is None) != (completed.returncode == MACHINE_SCHEDULE_EXIT_OUTSIDE_WINDOW):
        raise UnitLedgerError(f'machine schedule exit {completed.returncode} disagrees with its window {schedule["activeWindow"]!r}')
    return completed.returncode, schedule, completed.stderr.strip()


def utc_offset_text(moment):
    if moment.utcoffset() is None:
        raise UnitLedgerError(f'time has no UTC offset: {moment.isoformat()}')
    return moment.isoformat(timespec='seconds')[19:]


def require_host_clock_on_riga_time(riga_time_text, local_time):
    try:
        riga_time = datetime.fromisoformat(riga_time_text)
    except ValueError as error:
        raise UnitLedgerError(f'machine schedule Riga time is not ISO 8601: {riga_time_text!r}') from error
    riga_offset, local_offset = utc_offset_text(riga_time), utc_offset_text(local_time)
    if riga_offset != local_offset:
        raise BatchPreflightRefusedError(f'host clock offset {local_offset} differs from Europe/Riga {riga_offset}')
    return riga_offset


def nearest_existing_ancestor(path):
    for candidate in (path, *path.parents):
        if candidate.exists():
            return candidate
    raise UnitLedgerError(f'no existing ancestor for {path}')


def require_batch_preflight(project_root, lane_name, minimum_free_bytes, *, run_command=subprocess.run,
                            disk_usage=shutil.disk_usage, local_now=None):
    exit_code, schedule, schedule_message = read_machine_schedule(run_command)
    if exit_code == MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW:
        raise BatchPreflightRefusedError(f'batch refused on {schedule["host"]}: {schedule_message}')
    require_host_clock_on_riga_time(schedule['rigaTime'], local_now() if local_now else datetime.now().astimezone())
    try:
        lane_root = lane_store_root(project_root, lane_name)
    except StorePathError as error:
        raise BatchPreflightRefusedError(f'batch refused for lane {lane_name}: {error}') from error
    free_bytes = disk_usage(nearest_existing_ancestor(lane_root)).free
    if free_bytes < minimum_free_bytes:
        raise BatchPreflightRefusedError(
            f'free disk {free_bytes} bytes is below the batch floor {minimum_free_bytes} bytes at {schedule["rigaTime"]}')
    return {'host': schedule['host'], 'rigaTime': schedule['rigaTime'], 'freeBytes': free_bytes, 'laneStoreRoot': lane_root}


def require_record_list(value, fields, description):
    if not (isinstance(value, list) and all(isinstance(record, dict) and set(record) == fields for record in value)):
        raise UnitLedgerError(f'receipt {description} must be a list of {{{", ".join(sorted(fields))}}} records')
    paths = [record['path'] for record in value]
    if len(set(paths)) != len(paths):
        raise UnitLedgerError(f'receipt {description} repeat a path')
    return sorted(value, key=lambda record: record['path'])


class UnitLedger:
    def __init__(self, work_root, step, algorithm_version, *, riga_clock=current_riga_timestamp, free_bytes=None, host=None):
        work_root = Path(work_root).absolute()
        if not (len(work_root.parts) > 4 and work_root.name == 'work' and work_root.parents[1].name == 'lane-store'
                and work_root.parents[2].name == 'artifacts'):
            raise UnitLedgerError(f'ledger work root must be <project>/artifacts/lane-store/<lane>/work: {work_root}')
        if not (isinstance(step, str) and STEP_NAME_PATTERN.fullmatch(step)):
            raise UnitLedgerError(f'step name must match {STEP_NAME_PATTERN.pattern}: {step!r}')
        if not (type(algorithm_version) is int and algorithm_version > 0):
            raise UnitLedgerError(f'algorithm version must be a positive integer: {algorithm_version!r}')
        self.lane_name = require_known_lane_name(work_root.parent.name)
        self.work_root = lane_work_root(work_root.parents[3], self.lane_name)
        self.lane_folder = self.work_root.parent
        self.step = step
        self.algorithm_version = algorithm_version
        self.riga_clock = riga_clock
        self.free_bytes = free_bytes or (lambda path: shutil.disk_usage(path).free)
        self.host = host or socket.gethostname().upper()
        self.begun_units_by_key = {}

    def unit_fingerprint(self, input_sha256s, config):
        if not isinstance(input_sha256s, (list, tuple)):
            raise UnitLedgerError(f'input SHA-256 values must be a list: {input_sha256s!r}')
        for value in input_sha256s:
            require_sha256(value, 'input SHA-256')
        try:
            payload = canonical_json_bytes({'algorithmVersion': self.algorithm_version, 'config': config,
                                            'inputSha256s': sorted(input_sha256s)})
        except (TypeError, ValueError) as error:
            raise UnitLedgerError(f'unit config must be finite JSON: {error}') from error
        return sha256_of_bytes(payload)

    def unit_step_directory(self, unit_key):
        return confined_child_path(self.work_root, f'{unit_directory_name(unit_key)}/{self.step}')

    def lane_output_path(self, relative_path):
        try:
            root_folder = require_portable_relative_path(relative_path).split('/', 1)[0]
        except StorePathError as error:
            raise UnitLedgerError(f'output path is not a portable lane-relative path: {relative_path!r}') from error
        if root_folder not in LEDGER_OUTPUT_ROOT_FOLDERS or '/' not in relative_path:
            raise UnitLedgerError(f'output path must sit under {" or ".join(LEDGER_OUTPUT_ROOT_FOLDERS)} of the lane folder: {relative_path}')
        return confined_child_path(self.lane_folder, relative_path)

    def is_sealed(self, unit_key, fingerprint):
        step_directory = self.unit_step_directory(unit_key)
        seal_path = step_directory / SEAL_RECORD_NAME
        if not seal_path.is_file():
            return False
        seal = read_ledger_record(seal_path)
        receipt_path = step_directory / RECEIPT_RECORD_NAME
        receipt_bytes = receipt_path.read_bytes() if receipt_path.is_file() else b''
        receipt = json.loads(receipt_bytes) if seal.get('receiptSha256') == sha256_of_bytes(receipt_bytes) else {}
        identity = {'unitKey': unit_key, 'step': self.step}
        if not (isinstance(receipt, dict) and receipt and all(seal.get(name) == value for name, value in identity.items())
                and all(receipt.get(name) == seal.get(name) for name in ('unitKey', 'step', 'fingerprint'))):
            raise UnitLedgerError(f'seal {seal_path} does not match its receipt')
        for output in receipt['outputs']:
            output_path = self.lane_output_path(output['path'])
            if not (output_path.is_file() and output_path.stat().st_size == output['bytes']):
                raise UnitLedgerError(f'sealed output {output["path"]} of {unit_key} is missing or changed; remove {step_directory} to redo it')
        return seal['fingerprint'] == fingerprint

    def begin(self, unit_key, fingerprint):
        require_sha256(fingerprint, 'unit fingerprint')
        if self.is_sealed(unit_key, fingerprint):
            raise UnitLedgerError(f'unit {unit_key} step {self.step} is already sealed with this fingerprint; check is_sealed first')
        step_directory = self.unit_step_directory(unit_key)
        if os.path.lexists(step_directory):
            if not refuse_reparse_points(step_directory).is_relative_to(self.work_root):
                raise UnitLedgerError(f'stale unit folder escapes the work root: {step_directory}')
            shutil.rmtree(step_directory)
        step_directory.mkdir(parents=True)
        started_at_riga = self.riga_clock()
        write_new_record(step_directory / OWNER_RECORD_NAME, canonical_json_bytes({
            'unitKey': unit_key, 'step': self.step, 'lane': self.lane_name, 'host': self.host, 'pid': os.getpid(),
            'startedAtRiga': started_at_riga}))
        write_new_record(step_directory / RUNNING_MARKER_NAME, canonical_json_bytes({
            'unitKey': unit_key, 'step': self.step, 'fingerprint': fingerprint, 'startedAtRiga': started_at_riga}))
        self.begun_units_by_key[unit_key] = {'fingerprint': fingerprint, 'freeBytesBefore': self.free_bytes(step_directory)}
        return step_directory

    def verified_outputs(self, outputs):
        for output in outputs:
            output_path = self.lane_output_path(output['path'])
            if not output_path.is_file():
                raise UnitLedgerError(f'output {output["path"]} does not exist')
            if output_path.stat().st_size != output['bytes'] or sha256_of_file(output_path) != output['sha256']:
                raise UnitLedgerError(f'output {output["path"]} differs from its receipt SHA-256 or byte length')
        return outputs

    def seal(self, unit_key, fingerprint, receipt):
        begun_unit = self.begun_units_by_key.get(unit_key)
        if begun_unit is None or begun_unit['fingerprint'] != fingerprint:
            raise UnitLedgerError(f'begin was not called for unit {unit_key} with this fingerprint in this ledger')
        if not (isinstance(receipt, dict) and set(receipt) == RECEIPT_CALLER_FIELDS):
            raise UnitLedgerError(f'receipt must hold exactly {", ".join(sorted(RECEIPT_CALLER_FIELDS))}')
        inputs = require_record_list(receipt['inputs'], {'path', 'sha256'}, 'inputs')
        if self.unit_fingerprint([record['sha256'] for record in inputs], receipt['config']) != fingerprint:
            raise UnitLedgerError(f'receipt inputs and config do not reproduce the fingerprint of {unit_key}')
        outputs = self.verified_outputs(require_record_list(receipt['outputs'], {'path', 'sha256', 'bytes'}, 'outputs'))
        if not isinstance(receipt['gapRows'], list):
            raise UnitLedgerError('receipt gapRows must be a list')
        reason_patterns = load_gap_reason_patterns()
        for row in receipt['gapRows']:
            validate_gap_row(row, reason_patterns)
        step_directory = self.unit_step_directory(unit_key)
        if not (step_directory / RUNNING_MARKER_NAME).is_file():
            raise UnitLedgerError(f'unit {unit_key} has no running marker in {step_directory}')
        full_receipt = {
            'unitKey': unit_key, 'step': self.step, 'fingerprint': fingerprint, 'algorithmVersion': self.algorithm_version,
            'config': receipt['config'], 'inputs': inputs, 'outputs': outputs,
            'gapRows': sorted_gap_rows(receipt['gapRows']),
            'freeBytesBefore': begun_unit['freeBytesBefore'], 'freeBytesAfter': self.free_bytes(step_directory),
            'host': self.host, 'finishedAtRiga': self.riga_clock()}
        receipt_bytes = canonical_json_bytes(full_receipt)
        write_new_record(step_directory / RECEIPT_RECORD_NAME, receipt_bytes)
        write_new_record(step_directory / SEAL_RECORD_NAME, canonical_json_bytes({
            'unitKey': unit_key, 'step': self.step, 'fingerprint': fingerprint, 'receiptSha256': sha256_of_bytes(receipt_bytes)}))
        (step_directory / RUNNING_MARKER_NAME).unlink()
        del self.begun_units_by_key[unit_key]
        return full_receipt
