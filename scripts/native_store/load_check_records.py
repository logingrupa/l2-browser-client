from __future__ import annotations

from datetime import datetime
import json
import re

from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number
from native_store.gap_rows import CATALOG_KEY_PATTERNS
from native_store.store_paths import lane_load_check_path

LOAD_CHECK_FILE_SCHEMA_VERSION = 1
LOAD_CHECK_FILE_FIELDS = frozenset({'schemaVersion', 'lane', 'catalogSha256', 'records'})
LOAD_CHECK_RECORD_FIELDS = frozenset({'key', 'status', 'reason', 'atRiga', 'assetManifestSchemaVersion'})
LOAD_CHECK_ASSET_MANIFEST_SCHEMA_VERSIONS = (1, 2)
LOAD_CHECK_FILE_MAXIMUM_BYTES = 32 * 1024 * 1024
RIGA_TIMESTAMP_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$')


class LoadCheckRecordError(ValueError):
    pass


def is_catalog_key(key):
    return isinstance(key, str) and any(pattern.fullmatch(key) for pattern in CATALOG_KEY_PATTERNS.values())


def is_riga_timestamp(value):
    if not (isinstance(value, str) and RIGA_TIMESTAMP_PATTERN.fullmatch(value)):
        return False
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate_load_check_record(record, path):
    if not (isinstance(record, dict) and set(record) == LOAD_CHECK_RECORD_FIELDS):
        raise LoadCheckRecordError(f'load-check record must hold exactly {", ".join(sorted(LOAD_CHECK_RECORD_FIELDS))}: {path}')
    key = record['key']
    if not is_catalog_key(key):
        raise LoadCheckRecordError(f'load-check record key is not a catalog key ({", ".join(CATALOG_KEY_PATTERNS)}): {key!r} in {path}')
    if record['status'] == 'pass':
        if record['reason'] is not None:
            raise LoadCheckRecordError(f'load-check record {key} passes and must have no reason: {path}')
    elif record['status'] == 'failed':
        if not (isinstance(record['reason'], str) and record['reason'].strip()):
            raise LoadCheckRecordError(f'load-check record {key} failed and needs a non-empty reason: {path}')
    else:
        raise LoadCheckRecordError(f'load-check record {key} status must be pass or failed: {record["status"]!r} in {path}')
    if not is_riga_timestamp(record['atRiga']):
        raise LoadCheckRecordError(f'load-check record {key} atRiga must be ISO 8601 with the Riga offset: {record["atRiga"]!r}')
    schema_version = record['assetManifestSchemaVersion']
    if not (schema_version is None or (type(schema_version) is int and schema_version in LOAD_CHECK_ASSET_MANIFEST_SCHEMA_VERSIONS)):
        raise LoadCheckRecordError(f'load-check record {key} assetManifestSchemaVersion must be 1, 2 or null: {schema_version!r}')
    return record


def decode_load_check_file(path):
    with open(path, 'rb') as stream:
        payload = stream.read(LOAD_CHECK_FILE_MAXIMUM_BYTES + 1)
    if len(payload) > LOAD_CHECK_FILE_MAXIMUM_BYTES:
        raise LoadCheckRecordError(f'load-check file exceeds {LOAD_CHECK_FILE_MAXIMUM_BYTES} bytes: {path}')
    try:
        return json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise LoadCheckRecordError(f'load-check file is not strict JSON: {path}: {error}') from error


def read_load_check_records(project_root, lane_name, catalog_sha256):
    path = lane_load_check_path(project_root, lane_name, catalog_sha256)
    if not path.is_file():
        return {}
    document = decode_load_check_file(path)
    if not (isinstance(document, dict) and set(document) == LOAD_CHECK_FILE_FIELDS):
        raise LoadCheckRecordError(f'load-check file must hold exactly {", ".join(sorted(LOAD_CHECK_FILE_FIELDS))}: {path}')
    if document['schemaVersion'] != LOAD_CHECK_FILE_SCHEMA_VERSION:
        raise LoadCheckRecordError(f'load-check file schemaVersion must be {LOAD_CHECK_FILE_SCHEMA_VERSION}: {path}')
    if document['lane'] != lane_name:
        raise LoadCheckRecordError(f'load-check file lane {document["lane"]!r} differs from its path lane {lane_name}: {path}')
    if document['catalogSha256'] != catalog_sha256:
        raise LoadCheckRecordError(f'load-check file catalogSha256 {document["catalogSha256"]!r} differs from its path: {path}')
    if not isinstance(document['records'], list):
        raise LoadCheckRecordError(f'load-check file records must be a list: {path}')
    records_by_key = {}
    for record in document['records']:
        validate_load_check_record(record, path)
        if record['key'] in records_by_key:
            raise LoadCheckRecordError(f'load-check file repeats key {record["key"]}: {path}')
        records_by_key[record['key']] = record
    if list(records_by_key) != sorted(records_by_key):
        raise LoadCheckRecordError(f'load-check file records must be sorted by key: {path}')
    return records_by_key
