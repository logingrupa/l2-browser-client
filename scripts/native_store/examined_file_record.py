from __future__ import annotations

import json
from pathlib import Path
import re

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.interprocess_lock import LANE_WORK_FOLDER_NAME
from native_store.store_paths import SHA256_PATTERN

IDENTICAL_FILE_SHARING_FOLDER_NAME = 'identical-file-sharing'
EXAMINED_FILE_RECORD_NAME = 'examined-files.json'
FILE_IDENTITY_KEY_PATTERN = re.compile(r'^\d+:\d+:\d+:\d+$')
FILE_IDENTITY_KEY_SEPARATOR = ':'


class ExaminedFileRecordError(ValueError):
    pass


def identical_file_sharing_folder(lane_folder):
    return Path(lane_folder) / LANE_WORK_FOLDER_NAME / IDENTICAL_FILE_SHARING_FOLDER_NAME


def examined_file_record_path(lane_folder):
    return identical_file_sharing_folder(lane_folder) / EXAMINED_FILE_RECORD_NAME


def refused_record(record_path):
    return ExaminedFileRecordError(f'examined file record is not a map of file identities to SHA-256 values: {record_path}; '
                                   'delete it and the next run hashes every file again')


def read_examined_file_record(lane_folder):
    record_path = examined_file_record_path(lane_folder)
    if not record_path.is_file():
        return {}
    try:
        record = json.loads(record_path.read_bytes())
    except ValueError as error:
        raise refused_record(record_path) from error
    if not (isinstance(record, dict) and all(FILE_IDENTITY_KEY_PATTERN.fullmatch(key) and isinstance(sha256, str)
                                             and SHA256_PATTERN.fullmatch(sha256) for key, sha256 in record.items())):
        raise refused_record(record_path)
    return {tuple(int(number) for number in key.split(FILE_IDENTITY_KEY_SEPARATOR)): sha256 for key, sha256 in record.items()}


def write_examined_file_record(lane_folder, sha256_by_identity):
    record_path = examined_file_record_path(lane_folder)
    payload = canonical_json_bytes({FILE_IDENTITY_KEY_SEPARATOR.join(str(number) for number in identity): sha256
                                    for identity, sha256 in sha256_by_identity.items()})
    if record_path.is_file():
        if record_path.read_bytes() == payload:
            return
    elif not sha256_by_identity:
        return
    replace_file(record_path, payload)
