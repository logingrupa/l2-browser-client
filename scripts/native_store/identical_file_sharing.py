from __future__ import annotations

from collections import defaultdict
import ctypes
from ctypes import wintypes
import hashlib
import msvcrt
import os
from pathlib import Path
from typing import NamedTuple
import uuid

from native_store.file_identity import file_identity
from native_store.interprocess_lock import LANE_STORE_FOLDER_NAME
from native_store.lane_sharing_candidates import CHANGED_DURING_THE_RUN_RULE, SharingCandidate

MAXIMUM_NAMES_PER_SHARED_FILE = 1000
IN_USE_BY_ANOTHER_PROCESS_RULE = 'in-use-by-another-process'
HAS_A_NAME_OUTSIDE_THIS_RUN_RULE = 'has-a-name-outside-this-run'
GENERIC_READ = 0x80000000
READ_WRITE_AND_DELETE_SHARING = 0x7
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
EXTENDED_LENGTH_PATH_PREFIX = '\\\\?\\'
NETWORK_PATH_PREFIX = '\\\\'
DEVICE_POSITION, SIZE_POSITION = 0, 2


class IdenticalFileSharingError(ValueError):
    pass


class FileHashOutcome(NamedTuple):
    sha256: str | None
    skip_rule: str | None


class PlannedLink(NamedTuple):
    duplicate: SharingCandidate
    kept: SharingCandidate


def extended_length_path(path):
    absolute_path = os.path.abspath(path)
    return absolute_path if absolute_path.startswith(NETWORK_PATH_PREFIX) else EXTENDED_LENGTH_PATH_PREFIX + absolute_path


def open_for_reading_beside_every_other_use(path):
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
                                     wintypes.HANDLE)
    kernel32.CreateFileW.restype = wintypes.HANDLE
    handle = kernel32.CreateFileW(extended_length_path(path), GENERIC_READ, READ_WRITE_AND_DELETE_SHARING, None, OPEN_EXISTING,
                                  FILE_ATTRIBUTE_NORMAL, None)
    if handle in (None, INVALID_HANDLE_VALUE):
        raise ctypes.WinError(ctypes.get_last_error())
    return os.fdopen(msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY), 'rb')


def identity_of_open_file(stream):
    status = os.fstat(stream.fileno())
    return status.st_dev, status.st_ino, status.st_size, status.st_mtime_ns


def sha256_of_file_with_identity(path, surveyed_identity):
    try:
        with open_for_reading_beside_every_other_use(path) as stream:
            if identity_of_open_file(stream) != surveyed_identity:
                return FileHashOutcome(None, CHANGED_DURING_THE_RUN_RULE)
            sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
            if identity_of_open_file(stream) != surveyed_identity:
                return FileHashOutcome(None, CHANGED_DURING_THE_RUN_RULE)
    except FileNotFoundError:
        return FileHashOutcome(None, CHANGED_DURING_THE_RUN_RULE)
    except PermissionError:
        return FileHashOutcome(None, IN_USE_BY_ANOTHER_PROCESS_RULE)
    return FileHashOutcome(sha256, None)


def is_store_folder_name(candidate):
    return candidate.relative.split('/', 2)[1] == LANE_STORE_FOLDER_NAME


def best_name_order(candidate):
    return not is_store_folder_name(candidate), candidate.relative


def names_by_identity_best_name_first(candidates):
    names_by_identity = defaultdict(list)
    for candidate in sorted(candidates, key=best_name_order):
        names_by_identity[candidate.identity].append(candidate)
    return names_by_identity


def names_on_disk(names):
    return max(candidate.link_count for candidate in names)


def hash_unhashed_files(candidates, sha256_by_identity):
    names_by_identity = names_by_identity_best_name_first(candidates)
    skip_rule_by_identity = {identity: HAS_A_NAME_OUTSIDE_THIS_RUN_RULE for identity, names in names_by_identity.items()
                             if identity not in sha256_by_identity and names_on_disk(names) > len(names)}
    identities_by_device_and_size = defaultdict(list)
    for identity in names_by_identity:
        if identity not in skip_rule_by_identity:
            identities_by_device_and_size[(identity[DEVICE_POSITION], identity[SIZE_POSITION])].append(identity)
    for identities_of_one_size in identities_by_device_and_size.values():
        if len(identities_of_one_size) < 2:
            continue
        for identity in identities_of_one_size:
            if identity in sha256_by_identity:
                continue
            first_name = min(names_by_identity[identity], key=lambda candidate: candidate.relative)
            outcome = sha256_of_file_with_identity(first_name.path, identity)
            if outcome.skip_rule is None:
                sha256_by_identity[identity] = outcome.sha256
            else:
                skip_rule_by_identity[identity] = outcome.skip_rule
    return skip_rule_by_identity


def planned_links(candidates, sha256_by_identity):
    names_by_identity = names_by_identity_best_name_first(candidates)
    identities_by_device_size_and_sha256 = defaultdict(list)
    for identity in names_by_identity:
        if identity in sha256_by_identity:
            identities_by_device_size_and_sha256[(identity[DEVICE_POSITION], identity[SIZE_POSITION], sha256_by_identity[identity])].append(identity)
    links = []
    for identical_files in identities_by_device_size_and_sha256.values():
        kept_names = names_by_identity[identical_files[0]]
        kept_name_count = names_on_disk(kept_names)
        for identity in identical_files[1:]:
            names = names_by_identity[identity]
            if kept_name_count + len(names) > MAXIMUM_NAMES_PER_SHARED_FILE:
                kept_names, kept_name_count = names, names_on_disk(names)
                continue
            kept_name_count += len(names)
            links.extend(PlannedLink(duplicate, kept_names[0]) for duplicate in names)
    return links


def replace_name_by_hard_link(planned_link, temporary_links_folder):
    duplicate, kept = planned_link
    if file_identity(kept.path) != kept.identity or file_identity(duplicate.path) != duplicate.identity:
        return CHANGED_DURING_THE_RUN_RULE
    temporary_links_folder.mkdir(parents=True, exist_ok=True)
    temporary_link = Path(temporary_links_folder) / uuid.uuid4().hex
    try:
        os.link(kept.path, temporary_link)
        if file_identity(temporary_link) != kept.identity or file_identity(duplicate.path) != duplicate.identity:
            return CHANGED_DURING_THE_RUN_RULE
        try:
            os.replace(temporary_link, duplicate.path)
        except PermissionError:
            return IN_USE_BY_ANOTHER_PROCESS_RULE
    except FileNotFoundError:
        return CHANGED_DURING_THE_RUN_RULE
    finally:
        temporary_link.unlink(missing_ok=True)
    if file_identity(duplicate.path) != kept.identity:
        raise IdenticalFileSharingError(f'{duplicate.path} does not name the file of {kept.path} after its replacement by a hard link')
    return None
