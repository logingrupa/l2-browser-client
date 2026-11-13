from __future__ import annotations

from collections import Counter
import hashlib
import json
import os
from pathlib import Path
from typing import NamedTuple

from native_store.interprocess_lock import INTERPROCESS_LOCK_FOLDER_NAME, LANE_STORE_FOLDER_NAME, LANE_WORK_FOLDER_NAME
from native_store.store_paths import REPARSE_POINT_ATTRIBUTE, SHA256_PATTERN
from native_store.unit_ledger import OWNER_RECORD_NAME, RECEIPT_RECORD_NAME, RUNNING_MARKER_NAME, SEAL_RECORD_NAME

MINIMUM_SHARED_FILE_BYTES = 4096
LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK = ('actors', 'world')
CONVERTER_INDEX_FOLDER_NAME = 'index'
UNIT_FOLDER_NAME_SEPARATOR = '__'
TEMPORARY_NAME_SUFFIX = '.tmp'
NEVER_SHARED_FOLDER_NAMES = frozenset({'.work', CONVERTER_INDEX_FOLDER_NAME, INTERPROCESS_LOCK_FOLDER_NAME, 'class-defaults', 'bundle'})
CLASSES_FOLDER_NAME = 'classes'
DECODED_CLASS_FOLDER_NAME = 'decoded'
LEDGER_RECORD_NAMES = frozenset({OWNER_RECORD_NAME, RUNNING_MARKER_NAME, RECEIPT_RECORD_NAME, SEAL_RECORD_NAME})
TEMPORARY_NAME_RULE = 'temporary-name'
STORE_ROOT_FILE_RULE = 'store-root-file'
OUTSIDE_THE_SHARED_PLACES_RULE = 'outside-the-shared-places'
NEVER_SHARED_FOLDER_RULE = 'never-shared-folder'
LEDGER_RECORD_RULE = 'ledger-record'
UNIT_STEP_OF_A_LANE_IN_USE_RULE = 'unit-step-of-a-lane-in-use'
UNIT_STEP_NOT_SEALED_RULE = 'unit-step-not-sealed'
NOT_A_RECEIPT_OUTPUT_RULE = 'not-a-receipt-output'
BELOW_MINIMUM_BYTES_RULE = f'below-{MINIMUM_SHARED_FILE_BYTES}-bytes'
DIFFERS_FROM_ITS_RECEIPT_RULE = 'differs-from-its-receipt'
CHANGED_DURING_THE_RUN_RULE = 'changed-during-the-run'
STORE_FOLDER_PLACE = 'store-folder'
CONVERTER_CONTENT_FOLDER_PLACE = 'converter-content-folder'
UNIT_STEP_FOLDER_PLACE = 'unit-step-folder'
UNIT_STEP_FOLDER_PART_COUNT = 3


class SharingCandidate(NamedTuple):
    path: Path
    relative: str
    identity: tuple
    link_count: int


class LaneSurvey(NamedTuple):
    candidates: list
    skipped_file_count_by_rule: dict


def is_reparse_directory_entry(entry):
    return entry.is_symlink() or bool(entry.stat(follow_symlinks=False).st_file_attributes & REPARSE_POINT_ATTRIBUTE)


def directory_entries(folder):
    try:
        with os.scandir(folder) as entries:
            return sorted((entry for entry in entries if not is_reparse_directory_entry(entry)), key=lambda entry: entry.name)
    except FileNotFoundError:
        return []


def lane_converter_folders(lane_folder):
    lane_folder = Path(lane_folder)
    lane_children = [entry for entry in directory_entries(lane_folder) if entry.name not in (LANE_STORE_FOLDER_NAME, LANE_WORK_FOLDER_NAME)]
    work_children = [entry for entry in directory_entries(lane_folder / LANE_WORK_FOLDER_NAME) if UNIT_FOLDER_NAME_SEPARATOR not in entry.name]
    return [Path(entry.path) for entry in [*lane_children, *work_children]
            if entry.is_dir(follow_symlinks=False) and (Path(entry.path) / CONVERTER_INDEX_FOLDER_NAME).is_dir()]


def lane_is_held_free_of_conversions(lane_name, lane_is_named_free_of_conversions):
    return lane_is_named_free_of_conversions and lane_name in LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK


def lane_relative_file_paths(folder, lane_relative_parts):
    for entry in directory_entries(folder):
        if entry.is_dir(follow_symlinks=False):
            yield from lane_relative_file_paths(entry.path, (*lane_relative_parts, entry.name))
        else:
            yield (*lane_relative_parts, entry.name)


def shared_place_of(lane_relative_parts, converter_folder_parts):
    if lane_relative_parts[0] == LANE_STORE_FOLDER_NAME:
        return STORE_FOLDER_PLACE if len(lane_relative_parts) > 2 else STORE_ROOT_FILE_RULE
    for folder_parts in converter_folder_parts:
        content_folder_depth = len(folder_parts)
        if (lane_relative_parts[:content_folder_depth] == folder_parts and len(lane_relative_parts) > content_folder_depth + 1
                and SHA256_PATTERN.fullmatch(lane_relative_parts[content_folder_depth])):
            return CONVERTER_CONTENT_FOLDER_PLACE
    if (lane_relative_parts[0] == LANE_WORK_FOLDER_NAME and len(lane_relative_parts) > UNIT_STEP_FOLDER_PART_COUNT
            and UNIT_FOLDER_NAME_SEPARATOR in lane_relative_parts[1]):
        return UNIT_STEP_FOLDER_PLACE
    return OUTSIDE_THE_SHARED_PLACES_RULE


def sits_in_a_never_shared_folder(folder_parts):
    return any(part in NEVER_SHARED_FOLDER_NAMES or (part == DECODED_CLASS_FOLDER_NAME and position >= 2
                                                    and folder_parts[position - 2] == CLASSES_FOLDER_NAME)
               for position, part in enumerate(folder_parts))


def sealed_output_bytes_by_lane_relative_path(step_folder):
    if os.path.lexists(step_folder / RUNNING_MARKER_NAME):
        return None
    try:
        seal = json.loads((step_folder / SEAL_RECORD_NAME).read_bytes())
        receipt_bytes = (step_folder / RECEIPT_RECORD_NAME).read_bytes()
        receipt = json.loads(receipt_bytes)
    except (OSError, ValueError):
        return None
    if not (isinstance(seal, dict) and seal.get('receiptSha256') == hashlib.sha256(receipt_bytes).hexdigest() and isinstance(receipt, dict)):
        return None
    outputs = receipt.get('outputs')
    if not (isinstance(outputs, list) and all(isinstance(output, dict) and isinstance(output.get('path'), str)
                                              and type(output.get('bytes')) is int for output in outputs)):
        return None
    return {output['path']: output['bytes'] for output in outputs}


class LaneSurveyor:
    def __init__(self, lane_stores_root, lane_name, lane_is_free_of_conversions):
        self.lane_name = lane_name
        self.lane_folder = Path(lane_stores_root) / lane_name
        self.unit_steps_are_shared = lane_is_held_free_of_conversions(lane_name, lane_is_free_of_conversions)
        self.converter_folder_parts = [folder.relative_to(self.lane_folder).parts for folder in lane_converter_folders(self.lane_folder)]
        self.sealed_output_bytes_by_step_folder_parts = {}

    def sealed_output_bytes(self, step_folder_parts):
        if step_folder_parts not in self.sealed_output_bytes_by_step_folder_parts:
            self.sealed_output_bytes_by_step_folder_parts[step_folder_parts] = sealed_output_bytes_by_lane_relative_path(
                self.lane_folder.joinpath(*step_folder_parts))
        return self.sealed_output_bytes_by_step_folder_parts[step_folder_parts]

    def rule_before_the_file_is_read(self, lane_relative_parts):
        if lane_relative_parts[-1].endswith(TEMPORARY_NAME_SUFFIX):
            return TEMPORARY_NAME_RULE, None
        place = shared_place_of(lane_relative_parts, self.converter_folder_parts)
        if place in (STORE_ROOT_FILE_RULE, OUTSIDE_THE_SHARED_PLACES_RULE):
            return place, None
        if sits_in_a_never_shared_folder(lane_relative_parts[:-1]):
            return NEVER_SHARED_FOLDER_RULE, None
        if lane_relative_parts[-1] in LEDGER_RECORD_NAMES:
            return LEDGER_RECORD_RULE, None
        if place != UNIT_STEP_FOLDER_PLACE:
            return None, None
        if not self.unit_steps_are_shared:
            return UNIT_STEP_OF_A_LANE_IN_USE_RULE, None
        sealed_output_bytes = self.sealed_output_bytes(lane_relative_parts[:UNIT_STEP_FOLDER_PART_COUNT])
        if sealed_output_bytes is None:
            return UNIT_STEP_NOT_SEALED_RULE, None
        if '/'.join(lane_relative_parts) not in sealed_output_bytes:
            return NOT_A_RECEIPT_OUTPUT_RULE, None
        return None, sealed_output_bytes['/'.join(lane_relative_parts)]

    def candidate_or_rule(self, lane_relative_parts):
        rule, receipt_bytes = self.rule_before_the_file_is_read(lane_relative_parts)
        if rule is not None:
            return rule
        path = self.lane_folder.joinpath(*lane_relative_parts)
        try:
            status = os.stat(path)
        except FileNotFoundError:
            return CHANGED_DURING_THE_RUN_RULE
        if status.st_size < MINIMUM_SHARED_FILE_BYTES:
            return BELOW_MINIMUM_BYTES_RULE
        if receipt_bytes is not None and status.st_size != receipt_bytes:
            return DIFFERS_FROM_ITS_RECEIPT_RULE
        return SharingCandidate(path, '/'.join((self.lane_name, *lane_relative_parts)),
                                (status.st_dev, status.st_ino, status.st_size, status.st_mtime_ns), status.st_nlink)


def survey_lane(lane_stores_root, lane_name, lane_is_free_of_conversions):
    surveyor = LaneSurveyor(lane_stores_root, lane_name, lane_is_free_of_conversions)
    candidates, skipped_file_count_by_rule = [], Counter()
    for lane_relative_parts in lane_relative_file_paths(surveyor.lane_folder, ()):
        candidate_or_rule = surveyor.candidate_or_rule(lane_relative_parts)
        if isinstance(candidate_or_rule, SharingCandidate):
            candidates.append(candidate_or_rule)
        else:
            skipped_file_count_by_rule[candidate_or_rule] += 1
    return LaneSurvey(sorted(candidates, key=lambda candidate: candidate.relative), dict(skipped_file_count_by_rule))
