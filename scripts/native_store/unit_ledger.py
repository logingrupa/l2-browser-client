from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess

from native_store.store_paths import REPOSITORY_ROOT, StorePathError, lane_store_root

BATCH_MINIMUM_FREE_BYTES = 4 * 1024 ** 3
MACHINE_SCHEDULE_SCRIPT = 'scripts/check-machine-schedule.mjs'
MACHINE_SCHEDULE_EXIT_OUTSIDE_WINDOW = 0
MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW = 2


class UnitLedgerError(ValueError):
    pass


class BatchPreflightRefusedError(UnitLedgerError):
    pass


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
