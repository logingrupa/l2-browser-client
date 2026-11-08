from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
import tempfile

from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path

KNOWN_CATALOG_SLICES = ('models', 'textures', 'sections', 'movers', 'npcProfiles', 'playerProfiles',
                        'animationAudio', 'combatAudio', 'worldAudio', 'effectComponents')
NATIVE_RESOURCE_PATH_PATTERN = re.compile(r'^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$')
MAXIMUM_CATALOG_BYTES = 32 * 1024 * 1024
STORE_CATALOG_NAME = 'catalog.json'


class CatalogWriteError(ValueError):
    pass


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


def merge_catalog_slice(catalog, slice_name, record, capacity):
    if slice_name not in KNOWN_CATALOG_SLICES:
        raise CatalogWriteError(f'unknown catalog slice {slice_name}; slices: {", ".join(KNOWN_CATALOG_SLICES)}')
    if not (isinstance(record, dict) and isinstance(record.get('id'), str) and record['id']):
        raise CatalogWriteError(f'catalog {slice_name} record needs a string id')
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
