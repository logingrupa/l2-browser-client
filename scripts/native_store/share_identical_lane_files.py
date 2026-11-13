from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import contextlib
import json
import os
from pathlib import Path, PurePosixPath
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.converter_scratch_removal import lane_scratch_removal
from native_store.examined_file_record import identical_file_sharing_folder, read_examined_file_record, write_examined_file_record
from native_store.file_identity import file_identity
from native_store.identical_file_sharing import (SIZE_POSITION, IdenticalFileSharingError, best_name_order, hash_unhashed_files,
                                                 planned_links, replace_name_by_hard_link)
from native_store.interprocess_lock import (ARTIFACTS_FOLDER_NAME, LANE_STORES_FOLDER_NAME, LANE_WORK_FOLDER_NAME, InterprocessLockError,
                                            lane_sharing_lock)
from native_store.lane_sharing_candidates import LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK, lane_is_held_free_of_conversions, survey_lane
from native_store.store_paths import refuse_reparse_points
from native_store.unit_ledger import run_at_below_normal_priority

IDENTICAL_FILE_SHARING_DESCRIPTION = ('Turn identical large files of every lane under an artifacts/lane-store folder into hard links of one '
                                      'file without changing a path or a byte, and remove the converter scratch job folders of the actors '
                                      'and world lanes, under the lock of every lane; --plan takes no lock and reports what a run would do.')
TEMPORARY_LINKS_FOLDER_NAME = 'temporary-links'
REPORTED_PLACE_PART_COUNT = 2
FILE_TYPE_WITHOUT_SUFFIX = 'no-suffix'


def temporary_links_folder(lane_folder):
    return identical_file_sharing_folder(lane_folder) / TEMPORARY_LINKS_FOLDER_NAME


def require_lane_stores_root(lane_stores_root):
    root = Path(lane_stores_root).absolute()
    if not (root.name == LANE_STORES_FOLDER_NAME and root.parent.name == ARTIFACTS_FOLDER_NAME):
        raise IdenticalFileSharingError(f'lane store root must be <project>/{ARTIFACTS_FOLDER_NAME}/{LANE_STORES_FOLDER_NAME}: {root}')
    return refuse_reparse_points(root)


def lane_name_of(candidate):
    return candidate.relative.split('/', 1)[0]


def leftover_temporary_links(root, lane_names, plan_only):
    removed_link_count, kept_relative_paths = 0, []
    for lane_name in lane_names:
        links_folder = temporary_links_folder(root / lane_name)
        if not links_folder.is_dir():
            continue
        for link in sorted(links_folder.iterdir()):
            if os.stat(link).st_nlink < 2:
                kept_relative_paths.append(link.relative_to(root).as_posix())
                continue
            removed_link_count += 1
            if not plan_only:
                link.unlink()
    return removed_link_count, kept_relative_paths


def write_examined_file_records(root, lane_names, candidates, sha256_by_identity):
    hashed_names_by_identity = defaultdict(list)
    for candidate in candidates:
        if candidate.identity in sha256_by_identity:
            hashed_names_by_identity[candidate.identity].append(candidate)
    record_by_lane_name = {lane_name: {} for lane_name in lane_names}
    for identity, names in hashed_names_by_identity.items():
        names_of_the_file_now = [candidate for candidate in names if file_identity(candidate.path) == identity]
        if names_of_the_file_now:
            record_by_lane_name[lane_name_of(min(names_of_the_file_now, key=best_name_order))][identity] = sha256_by_identity[identity]
    for lane_name, record in record_by_lane_name.items():
        write_examined_file_record(root / lane_name, record)


def first_names_of_files_without_a_name_left(replaced_names):
    replaced_names_by_identity = defaultdict(list)
    for candidate in replaced_names:
        replaced_names_by_identity[candidate.identity].append(candidate)
    return [names[0] for names in replaced_names_by_identity.values() if len(names) == max(candidate.link_count for candidate in names)]


def shared_bytes_by(group_of, freed_file_names):
    shared_bytes = Counter()
    for candidate in freed_file_names:
        shared_bytes[group_of(candidate)] += candidate.identity[SIZE_POSITION]
    return dict(sorted(shared_bytes.items()))


def two_folder_place_of(candidate):
    return '/'.join(candidate.relative.split('/')[:REPORTED_PLACE_PART_COUNT])


def file_type_of(candidate):
    return PurePosixPath(candidate.relative).suffix.lower() or FILE_TYPE_WITHOUT_SUFFIX


def share_identical_lane_files(lane_stores_root, lane_names, plan_only, lanes_free_of_conversions):
    root = require_lane_stores_root(lane_stores_root)
    lane_names = sorted(lane_names)
    for lane_name in lane_names:
        refuse_reparse_points(root / lane_name)
    scratch_removal_by_lane_name = {
        lane_name: lane_scratch_removal(root / lane_name, lane_is_held_free_of_conversions(lane_name, lane_name in lanes_free_of_conversions),
                                        plan_only)
        for lane_name in lane_names}
    leftover_links_removed, leftover_links_kept = leftover_temporary_links(root, lane_names, plan_only)
    candidates, skipped_file_count_by_rule = [], Counter()
    for lane_name in lane_names:
        survey = survey_lane(root, lane_name, lane_name in lanes_free_of_conversions)
        candidates.extend(survey.candidates)
        skipped_file_count_by_rule.update(survey.skipped_file_count_by_rule)
    files_examined = len(candidates) + sum(skipped_file_count_by_rule.values())
    surveyed_identities = {candidate.identity for candidate in candidates}
    sha256_by_identity = {identity: sha256 for lane_name in lane_names
                          for identity, sha256 in read_examined_file_record(root / lane_name).items() if identity in surveyed_identities}
    recorded_file_count = len(sha256_by_identity)
    replaced_names = []
    try:
        skip_rule_by_identity = hash_unhashed_files(candidates, sha256_by_identity)
        skipped_file_count_by_rule.update(skip_rule_by_identity[candidate.identity] for candidate in candidates
                                          if candidate.identity in skip_rule_by_identity)
        for planned_link in planned_links(candidates, sha256_by_identity):
            skip_rule = None if plan_only else replace_name_by_hard_link(
                planned_link, temporary_links_folder(root / lane_name_of(planned_link.duplicate)))
            if skip_rule is None:
                replaced_names.append(planned_link.duplicate)
            else:
                skipped_file_count_by_rule[skip_rule] += 1
    finally:
        if not plan_only:
            write_examined_file_records(root, lane_names, candidates, sha256_by_identity)
    freed_file_names = first_names_of_files_without_a_name_left(replaced_names)
    return {'planOnly': plan_only, 'lanes': lane_names, 'filesExamined': files_examined,
            'filesSkippedByRule': dict(sorted(skipped_file_count_by_rule.items())),
            'filesHashed': len(sha256_by_identity) - recorded_file_count, 'sharedNames': len(replaced_names),
            'sharedBytes': sum(candidate.identity[SIZE_POSITION] for candidate in freed_file_names),
            'sharedBytesByPlace': shared_bytes_by(two_folder_place_of, freed_file_names),
            'sharedBytesByFileType': shared_bytes_by(file_type_of, freed_file_names),
            'leftoverLinksRemoved': leftover_links_removed, 'leftoverLinksKept': leftover_links_kept,
            'scratchJobFoldersRemoved': sum(removal.job_folders_removed for removal in scratch_removal_by_lane_name.values()),
            'scratchJobFoldersNotRemoved': sum(removal.job_folders_not_removed for removal in scratch_removal_by_lane_name.values()),
            'scratchBytesRemoved': sum(removal.bytes_removed for removal in scratch_removal_by_lane_name.values()),
            'scratchBytesLeftByLane': {lane_name: removal.bytes_left for lane_name, removal in scratch_removal_by_lane_name.items()}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=IDENTICAL_FILE_SHARING_DESCRIPTION)
    parser.add_argument('lane_stores_root', type=Path)
    parser.add_argument('--plan', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        run_at_below_normal_priority()
        root = require_lane_stores_root(arguments.lane_stores_root)
        lane_names = sorted(entry.name for entry in os.scandir(root) if entry.is_dir())
        with contextlib.ExitStack() as lane_locks:
            if not arguments.plan:
                for lane_name in lane_names:
                    lane_locks.enter_context(lane_sharing_lock(refuse_reparse_points(root / lane_name) / LANE_WORK_FOLDER_NAME))
            report = share_identical_lane_files(root, lane_names, arguments.plan,
                                                LANES_WHOSE_CONVERSIONS_HOLD_THE_LANE_LOCK if arguments.plan else lane_names)
    except (ValueError, OSError, InterprocessLockError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
