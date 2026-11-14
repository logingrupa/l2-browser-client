from __future__ import annotations

import os
from pathlib import Path
import shutil
from typing import NamedTuple

from actors.skill_bundle_step_names import SKILL_DISPATCH_CLASS_STEP, SKILL_EFFECT_ROOT_STEP, SOURCE_BUNDLE_FOLDER
from native_store.interprocess_lock import LANE_WORK_FOLDER_NAME
from native_store.lane_sharing_candidates import UNIT_FOLDER_NAME_SEPARATOR, directory_entries, lane_converter_folders
from native_store.store_paths import is_reparse_entry
from native_store.unit_ledger import RUNNING_MARKER_NAME, SEAL_RECORD_NAME

CONVERTER_SCRATCH_FOLDER_NAME = '.work'
REMOVING_SCRATCH_FOLDER_SUFFIX = '.removing'
BUNDLE_SCRATCH_FOLDER_NAMES = (CONVERTER_SCRATCH_FOLDER_NAME, CONVERTER_SCRATCH_FOLDER_NAME + REMOVING_SCRATCH_FOLDER_SUFFIX)
STEPS_WHOSE_SEALED_UNITS_NEVER_READ_THEIR_BUNDLE_SCRATCH = (SKILL_DISPATCH_CLASS_STEP, SKILL_EFFECT_ROOT_STEP)


class LaneScratchRemoval(NamedTuple):
    scratch_folders_removed: int
    scratch_folders_not_removed: int
    bytes_removed: int
    bytes_left: int


def child_folders(folder):
    return [Path(entry.path) for entry in directory_entries(folder) if entry.is_dir(follow_symlinks=False)]


def converter_scratch_job_folders(lane_folder):
    return [job_folder for converter_folder in lane_converter_folders(lane_folder)
            for scratch_folder in child_folders(converter_folder) if scratch_folder.name == CONVERTER_SCRATCH_FOLDER_NAME
            for job_folder in child_folders(scratch_folder)]


def is_folder_and_no_reparse_point(folder):
    return folder.is_dir() and not is_reparse_entry(folder)


def unit_step_is_sealed(step_folder):
    return (step_folder / SEAL_RECORD_NAME).is_file() and not os.path.lexists(step_folder / RUNNING_MARKER_NAME)


def bundle_scratch_folders_of_sealed_step(step_folder):
    bundle_folder = step_folder / SOURCE_BUNDLE_FOLDER
    if not (unit_step_is_sealed(step_folder) and is_folder_and_no_reparse_point(step_folder) and is_folder_and_no_reparse_point(bundle_folder)):
        return []
    return [scratch_folder for scratch_folder in child_folders(bundle_folder) if scratch_folder.name in BUNDLE_SCRATCH_FOLDER_NAMES]


def sealed_skill_bundle_scratch_folders(lane_folder):
    return [scratch_folder for unit_folder in child_folders(Path(lane_folder) / LANE_WORK_FOLDER_NAME)
            if UNIT_FOLDER_NAME_SEPARATOR in unit_folder.name
            for step_name in STEPS_WHOSE_SEALED_UNITS_NEVER_READ_THEIR_BUNDLE_SCRATCH
            for scratch_folder in bundle_scratch_folders_of_sealed_step(unit_folder / step_name)]


def lane_scratch_folders(lane_folder):
    return [*converter_scratch_job_folders(lane_folder), *sealed_skill_bundle_scratch_folders(lane_folder)]


def folder_file_bytes(folder):
    return sum(folder_file_bytes(entry.path) if entry.is_dir(follow_symlinks=False) else entry.stat(follow_symlinks=False).st_size
               for entry in directory_entries(folder))


def scratch_folder_bytes(scratch_folders):
    return sum(folder_file_bytes(scratch_folder) for scratch_folder in scratch_folders)


def folder_under_its_removing_name(scratch_folder):
    return scratch_folder if scratch_folder.name.endswith(REMOVING_SCRATCH_FOLDER_SUFFIX) else scratch_folder.with_name(
        scratch_folder.name + REMOVING_SCRATCH_FOLDER_SUFFIX)


def remove_scratch_folder(scratch_folder):
    removing_folder = folder_under_its_removing_name(scratch_folder)
    try:
        if removing_folder != scratch_folder:
            os.rename(scratch_folder, removing_folder)
        shutil.rmtree(removing_folder)
    except OSError:
        return False
    return True


def lane_scratch_removal(lane_folder, lane_scratch_is_removed, plan_only):
    scratch_folders = lane_scratch_folders(lane_folder)
    scratch_bytes = scratch_folder_bytes(scratch_folders)
    if not lane_scratch_is_removed:
        return LaneScratchRemoval(0, 0, 0, scratch_bytes)
    if plan_only:
        return LaneScratchRemoval(len(scratch_folders), 0, scratch_bytes, 0)
    folders_not_removed = [scratch_folder for scratch_folder in scratch_folders if not remove_scratch_folder(scratch_folder)]
    scratch_bytes_left = scratch_folder_bytes({folder for scratch_folder in folders_not_removed
                                               for folder in (scratch_folder, folder_under_its_removing_name(scratch_folder))})
    return LaneScratchRemoval(len(scratch_folders) - len(folders_not_removed), len(folders_not_removed), scratch_bytes - scratch_bytes_left,
                              scratch_bytes_left)
