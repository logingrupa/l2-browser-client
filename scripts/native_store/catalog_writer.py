from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
import tempfile
from typing import NamedTuple

from native_store.store_paths import SHA256_PATTERN, confined_child_path, refuse_reparse_points, require_portable_relative_path

KNOWN_CATALOG_SLICES = ('models', 'textures', 'sections', 'movers', 'npcProfiles', 'playerProfiles',
                        'animationAudio', 'combatAudio', 'worldAudio', 'effectComponents', 'tiles', 'tables', 'windows')
NATIVE_RESOURCE_PATH_PATTERN = re.compile(r'^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$')
MAXIMUM_CATALOG_BYTES = 32 * 1024 * 1024
MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1
STORE_CATALOG_NAME = 'catalog.json'
TILE_ID_PATTERN = re.compile(r'^\d{2}_\d{2}$')
TILE_MANIFEST_PATH_PATTERN = re.compile(r'^/l2/tiles/(?P<sha256>[a-f0-9]{64})/tile\.json$')
TILE_MANIFEST_MAXIMUM_BYTES = 8_000_000
TABLE_ID_PATTERN = re.compile(r'^[a-z][a-z0-9_]*(?:-[a-z])?$')
TABLE_MANIFEST_PATH_PATTERN = re.compile(r'^/l2/tables/(?P<sha256>[a-f0-9]{64})/(?P<id>[a-z][a-z0-9_]*(?:-[a-z])?)\.json$')
TABLE_MANIFEST_MAXIMUM_BYTES = 32 * 1024 * 1024
WINDOW_ID_PATTERN = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$')
WINDOW_MANIFEST_PATH_PATTERN = re.compile(r'^/l2/windows/(?P<sha256>[a-f0-9]{64})/window\.json$')
WINDOW_MANIFEST_MAXIMUM_BYTES = 8_000_000
PINNED_MANIFEST_RECORD_FIELDS = ('id', 'manifest', 'manifestSha256', 'manifestBytes')
TABLE_RECORD_FIELDS = (*PINNED_MANIFEST_RECORD_FIELDS, 'recordCount', 'sourceSha256')


class CatalogWriteError(ValueError):
    pass


class PinnedManifestRecordShape(NamedTuple):
    fields: tuple
    id_pattern: re.Pattern
    manifest_path_pattern: re.Pattern
    maximum_manifest_bytes: int


PINNED_MANIFEST_RECORD_SHAPES = {
    'tiles': PinnedManifestRecordShape(PINNED_MANIFEST_RECORD_FIELDS, TILE_ID_PATTERN, TILE_MANIFEST_PATH_PATTERN,
                                       TILE_MANIFEST_MAXIMUM_BYTES),
    'tables': PinnedManifestRecordShape(TABLE_RECORD_FIELDS, TABLE_ID_PATTERN, TABLE_MANIFEST_PATH_PATTERN, TABLE_MANIFEST_MAXIMUM_BYTES),
    'windows': PinnedManifestRecordShape(PINNED_MANIFEST_RECORD_FIELDS, WINDOW_ID_PATTERN, WINDOW_MANIFEST_PATH_PATTERN,
                                         WINDOW_MANIFEST_MAXIMUM_BYTES),
}


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def sha256_of_file(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def replace_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_of_file(path) != sha256_hex(payload):
        raise CatalogWriteError('Runtime copy hash differs: ' + str(path))


def immutable_write(path, payload):
    if path.exists():
        if sha256_of_file(path) != sha256_hex(payload):
            raise CatalogWriteError('Existing immutable runtime asset is corrupt; preserved: ' + str(path))
        return
    replace_file(path, payload)


def add_store_file(files, relative, payload):
    require_portable_relative_path(relative)
    if not NATIVE_RESOURCE_PATH_PATTERN.fullmatch('/l2/' + relative):
        raise CatalogWriteError('Store file path is not a bounded /l2 resource path: ' + relative)
    key = relative.casefold()
    if key == STORE_CATALOG_NAME:
        raise CatalogWriteError('The store catalog is written only by write_store: ' + relative)
    if key in files and files[key] != (relative, payload):
        raise CatalogWriteError('Conflicting store file paths: ' + relative)
    files[key] = (relative, payload)


def read_current_catalog_bytes(store_root):
    catalog_path = confined_child_path(store_root, STORE_CATALOG_NAME)
    if not catalog_path.exists():
        return None
    with open(catalog_path, 'rb') as handle:
        payload = handle.read(MAXIMUM_CATALOG_BYTES + 1)
    if len(payload) > MAXIMUM_CATALOG_BYTES:
        raise CatalogWriteError(f'Store catalog exceeds {MAXIMUM_CATALOG_BYTES} bytes: {catalog_path}')
    return payload


def refuse_duplicate_json_keys(pairs):
    decoded = {}
    for key, value in pairs:
        if key in decoded:
            raise CatalogWriteError('Duplicate JSON key: ' + key)
        decoded[key] = value
    return decoded


def refuse_non_finite_json_number(value):
    raise CatalogWriteError('Nonfinite JSON: ' + value)


def decode_store_catalog(payload):
    catalog = json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    if not (isinstance(catalog, dict) and catalog.get('schemaVersion') == 1 and isinstance(catalog.get('models'), list)):
        raise CatalogWriteError('Invalid native catalog: schemaVersion 1 and a models list are required')
    return catalog


def read_store_catalog(store_root):
    payload = read_current_catalog_bytes(store_root)
    if payload is None:
        return {'schemaVersion': 1, 'models': []}, None
    return decode_store_catalog(payload), payload


def is_safe_integer(value, minimum):
    return type(value) is int and minimum <= value <= MAXIMUM_SAFE_INTEGER


def require_pinned_path(path, sha256, path_pattern, error_type, label):
    if not (isinstance(sha256, str) and SHA256_PATTERN.fullmatch(sha256)):
        raise error_type(f'{label} SHA-256 must be 64 lowercase hex characters: {sha256!r}')
    match = path_pattern.fullmatch(path) if isinstance(path, str) else None
    if match is None or not NATIVE_RESOURCE_PATH_PATTERN.fullmatch(path):
        raise error_type(f'{label} path must match {path_pattern.pattern}: {path!r}')
    if match['sha256'] != sha256:
        raise error_type(f'{label} path SHA-256 differs from its pin {sha256}: {path}')
    return match


def require_byte_length(byte_length, maximum_bytes, error_type, label):
    if not (type(byte_length) is int and 0 < byte_length <= maximum_bytes):
        raise error_type(f'{label} byte length must be an integer from 1 to {maximum_bytes}: {byte_length!r}')
    return byte_length


def validate_pinned_manifest_record(slice_name, record, shape):
    label = f'catalog {slice_name} record {record["id"]}'
    if set(record) != set(shape.fields):
        raise CatalogWriteError(f'{label} must hold exactly {", ".join(shape.fields)}: {", ".join(sorted(record))}')
    if not shape.id_pattern.fullmatch(record['id']):
        raise CatalogWriteError(f'{label} id must match {shape.id_pattern.pattern}')
    manifest_path_match = require_pinned_path(record['manifest'], record['manifestSha256'], shape.manifest_path_pattern,
                                              CatalogWriteError, f'{label} manifest')
    if 'id' in shape.manifest_path_pattern.groupindex and manifest_path_match['id'] != record['id']:
        raise CatalogWriteError(f'{label} manifest file name must be the record id: {record["manifest"]}')
    require_byte_length(record['manifestBytes'], shape.maximum_manifest_bytes, CatalogWriteError, f'{label} manifest')


def validate_table_record_source(record):
    label = f'catalog tables record {record["id"]}'
    if not is_safe_integer(record['recordCount'], 0):
        raise CatalogWriteError(f'{label} recordCount must be a safe integer of at least 0: {record["recordCount"]!r}')
    if not (isinstance(record['sourceSha256'], str) and SHA256_PATTERN.fullmatch(record['sourceSha256'])):
        raise CatalogWriteError(f'{label} sourceSha256 must be 64 lowercase hex characters: {record["sourceSha256"]!r}')


def validate_catalog_record(slice_name, record):
    if slice_name not in KNOWN_CATALOG_SLICES:
        raise CatalogWriteError(f'unknown catalog slice {slice_name}; slices: {", ".join(KNOWN_CATALOG_SLICES)}')
    if not (isinstance(record, dict) and isinstance(record.get('id'), str) and record['id']):
        raise CatalogWriteError(f'catalog {slice_name} record needs a string id')
    if slice_name in PINNED_MANIFEST_RECORD_SHAPES:
        validate_pinned_manifest_record(slice_name, record, PINNED_MANIFEST_RECORD_SHAPES[slice_name])
    if slice_name == 'tables':
        validate_table_record_source(record)
    return record


def merge_catalog_slice(catalog, slice_name, record, capacity):
    validate_catalog_record(slice_name, record)
    if type(capacity) is not int or capacity < 1:
        raise CatalogWriteError(f'catalog {slice_name} capacity must be a positive integer: {capacity!r}')
    merged = copy.deepcopy(catalog)
    records = merged.setdefault(slice_name, [])
    if not isinstance(records, list):
        raise CatalogWriteError(f'catalog {slice_name} is not a list')
    matching = [existing for existing in records if isinstance(existing, dict) and existing.get('id') == record['id']]
    if matching:
        if any(existing != record for existing in matching):
            raise CatalogWriteError(f'catalog {slice_name} record {record["id"]} differs; preserved')
        return merged
    if len(records) >= capacity:
        raise CatalogWriteError(f'catalog {slice_name} capacity {capacity} exceeded')
    records.append(copy.deepcopy(record))
    return merged


def verify_store_destinations(store_root, files):
    missing_relative_paths = []
    for relative, payload in files.values():
        destination = confined_child_path(store_root, relative)
        if not destination.exists():
            missing_relative_paths.append(relative)
        elif sha256_of_file(destination) != sha256_hex(payload):
            raise CatalogWriteError('Existing immutable store file differs; preserved: ' + str(destination))
    return missing_relative_paths


def require_catalog_unchanged(store_root, before):
    if read_current_catalog_bytes(store_root) != before:
        raise CatalogWriteError('Catalog changed since it was read; preserved')


def write_store(store_root, files, before, after):
    root = refuse_reparse_points(store_root)
    missing_relative_paths = verify_store_destinations(root, files)
    require_catalog_unchanged(root, before)
    for relative, payload in files.values():
        immutable_write(confined_child_path(root, relative), payload)
    require_catalog_unchanged(root, before)
    catalog_replaced = after != before
    if catalog_replaced:
        replace_file(confined_child_path(root, STORE_CATALOG_NAME), after)
    return {'filesWritten': len(missing_relative_paths) + int(catalog_replaced), 'catalogSha256': sha256_hex(after)}
