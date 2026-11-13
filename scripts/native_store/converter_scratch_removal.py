from __future__ import annotations

import os
from pathlib import Path
import shutil
from typing import NamedTuple

from native_store.lane_sharing_candidates import directory_entries, lane_converter_folders

CONVERTER_SCRATCH_FOLDER_NAME = '.work'
REMOVING_JOB_FOLDER_SUFFIX = '.removing'


class LaneScratchRemoval(NamedTuple):
    job_folders_removed: int
    job_folders_not_removed: int
    bytes_removed: int
    bytes_left: int


def child_folders(folder):
    return [Path(entry.path) for entry in directory_entries(folder) if entry.is_dir(follow_symlinks=False)]


def scratch_job_folders(lane_folder):
    return [job_folder for converter_folder in lane_converter_folders(lane_folder)
            for scratch_folder in child_folders(converter_folder) if scratch_folder.name == CONVERTER_SCRATCH_FOLDER_NAME
            for job_folder in child_folders(scratch_folder)]


def folder_file_bytes(folder):
    return sum(folder_file_bytes(entry.path) if entry.is_dir(follow_symlinks=False) else entry.stat(follow_symlinks=False).st_size
               for entry in directory_entries(folder))


def job_folder_bytes(job_folders):
    return sum(folder_file_bytes(job_folder) for job_folder in job_folders)


def remove_scratch_job_folder(job_folder):
    removing_folder = job_folder if job_folder.name.endswith(REMOVING_JOB_FOLDER_SUFFIX) else job_folder.with_name(
        job_folder.name + REMOVING_JOB_FOLDER_SUFFIX)
    try:
        if removing_folder != job_folder:
            os.rename(job_folder, removing_folder)
        shutil.rmtree(removing_folder)
    except OSError:
        return False
    return True


def lane_scratch_removal(lane_folder, lane_scratch_is_removed, plan_only):
    job_folders = scratch_job_folders(lane_folder)
    scratch_bytes = job_folder_bytes(job_folders)
    if not lane_scratch_is_removed:
        return LaneScratchRemoval(0, 0, 0, scratch_bytes)
    if plan_only:
        return LaneScratchRemoval(len(job_folders), 0, scratch_bytes, 0)
    removed_job_folder_count = sum(remove_scratch_job_folder(job_folder) for job_folder in job_folders)
    scratch_bytes_left = job_folder_bytes(scratch_job_folders(lane_folder))
    return LaneScratchRemoval(removed_job_folder_count, len(job_folders) - removed_job_folder_count, scratch_bytes - scratch_bytes_left,
                              scratch_bytes_left)
