from __future__ import annotations

from collections import deque
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
from typing import NamedTuple

from native_store.native_material_program_pins import (MATERIAL_PROGRAM_FILE_NAME, glb_native_material_program_sha256s,
                                                       native_material_program_directory)
from native_store.store_paths import (SHA256_PATTERN, StorePathError, confined_child_path, refuse_reparse_points,
                                      require_portable_relative_path)

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
TABLE_NAME_INDEX_ID_SUFFIX = '_names'
WINDOW_ID_PATTERN = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$')
WINDOW_MANIFEST_PATH_PATTERN = re.compile(r'^/l2/windows/(?P<sha256>[a-f0-9]{64})/window\.json$')
WINDOW_MANIFEST_MAXIMUM_BYTES = 8_000_000
PINNED_MANIFEST_RECORD_FIELDS = ('id', 'manifest', 'manifestSha256', 'manifestBytes')
TABLE_RECORD_FIELDS = (*PINNED_MANIFEST_RECORD_FIELDS, 'recordCount', 'sourceSha256')
NATIVE_RESOURCE_PREFIX = '/l2/'
PINNED_FILE_REFERENCE_FIELDS = (('manifest', 'manifestSha256', 'manifestBytes'), ('archive', 'archiveSha256', None),
                                ('model', 'modelSha256', None), ('image', 'imageSha256', 'imageBytes'), ('resource', 'sha256', None))
BUNDLE_MEMBER_PATH_FIELD = 'file'
BUNDLE_MEMBER_SHA256_FIELD = 'sha256'
BUNDLE_MEMBER_BYTES_FIELD = 'bytes'
BUNDLE_MEMBER_MAP_FIELD = 'files'
BUNDLE_MEMBER_MAP_PIN_FIELDS = frozenset({BUNDLE_MEMBER_SHA256_FIELD, BUNDLE_MEMBER_BYTES_FIELD})
PINNED_GLB_SUFFIX = '.glb'
DRIVE_LETTER_PATTERN = re.compile(r'^[A-Za-z]:')
STORE_ROOT_BUNDLE_FOLDER = ''
PINNED_MANIFEST_SUFFIX = '.json'


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


def store_file_key(relative):
    require_portable_relative_path(relative)
    if not NATIVE_RESOURCE_PATH_PATTERN.fullmatch('/l2/' + relative):
        raise CatalogWriteError('Store file path is not a bounded /l2 resource path: ' + relative)
    key = relative.casefold()
    if key == STORE_CATALOG_NAME:
        raise CatalogWriteError('The store catalog is written only by write_store: ' + relative)
    return key


def add_store_file(files, relative, payload):
    key = store_file_key(relative)
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


def is_table_name_index_id(record_id):
    return TABLE_ID_PATTERN.fullmatch(record_id) is not None and record_id.endswith(TABLE_NAME_INDEX_ID_SUFFIX)


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


def merge_catalog_slice_records(catalog, slice_name, incoming_records, capacity):
    for record in incoming_records:
        validate_catalog_record(slice_name, record)
    if type(capacity) is not int or capacity < 1:
        raise CatalogWriteError(f'catalog {slice_name} capacity must be a positive integer: {capacity!r}')
    merged = copy.deepcopy(catalog)
    records = merged.setdefault(slice_name, [])
    if not isinstance(records, list):
        raise CatalogWriteError(f'catalog {slice_name} is not a list')
    records_by_id = {}
    for existing in records:
        if isinstance(existing, dict):
            records_by_id.setdefault(existing.get('id'), []).append(existing)
    for record in incoming_records:
        matching = records_by_id.get(record['id'], [])
        if matching:
            if any(existing != record for existing in matching):
                raise CatalogWriteError(f'catalog {slice_name} record {record["id"]} differs; preserved')
            continue
        if len(records) >= capacity:
            raise CatalogWriteError(f'catalog {slice_name} capacity {capacity} exceeded')
        appended = copy.deepcopy(record)
        records.append(appended)
        records_by_id[record['id']] = [appended]
    return merged


def merge_catalog_slice(catalog, slice_name, record, capacity):
    return merge_catalog_slice_records(catalog, slice_name, [record], capacity)


class PinnedFileReference(NamedTuple):
    relative: str
    sha256: str
    byte_length: int | None
    bundle_folder: str | None


def is_file_pin(value, path_field, sha256_field):
    if path_field not in value:
        return False
    return sha256_field in value or isinstance(value[path_field], str) and value[path_field].startswith(NATIVE_RESOURCE_PREFIX)


def require_file_pin(value, path_field, sha256_field, bytes_field, label):
    path, sha256 = value[path_field], value.get(sha256_field)
    if not (isinstance(path, str) and path.startswith(NATIVE_RESOURCE_PREFIX) and isinstance(sha256, str) and SHA256_PATTERN.fullmatch(sha256)):
        raise CatalogWriteError(f'{label} has no /l2 {path_field} with {sha256_field}')
    return PinnedFileReference(path[len(NATIVE_RESOURCE_PREFIX):], sha256, value.get(bytes_field) if bytes_field else None, None)


def is_bundle_member_pin(value):
    return BUNDLE_MEMBER_PATH_FIELD in value and BUNDLE_MEMBER_SHA256_FIELD in value


def require_bundle_member_path(member, label):
    if not (isinstance(member, str) and member):
        raise CatalogWriteError(f'{label} bundle file path must be a non-empty string: {member!r}')
    if member.startswith('/'):
        raise CatalogWriteError(f'{label} bundle file path is absolute: {member!r}')
    if DRIVE_LETTER_PATTERN.match(member):
        raise CatalogWriteError(f'{label} bundle file path names a drive: {member!r}')
    if '\\' in member:
        raise CatalogWriteError(f'{label} bundle file path holds a backslash: {member!r}')
    if '..' in member.split('/'):
        raise CatalogWriteError(f'{label} bundle file path steps out of its bundle folder with ..: {member!r}')
    try:
        return require_portable_relative_path(member)
    except StorePathError as error:
        raise CatalogWriteError(f'{label} bundle file path is not a portable relative path: {member!r}') from error


def require_bundle_member_pin(value, label, bundle_folder):
    member = value[BUNDLE_MEMBER_PATH_FIELD]
    if bundle_folder is None:
        raise CatalogWriteError(f'{label} pins {member!r} by a relative path; only a pinned store manifest names files inside its bundle folder')
    require_bundle_member_path(member, label)
    sha256 = value[BUNDLE_MEMBER_SHA256_FIELD]
    if not (isinstance(sha256, str) and SHA256_PATTERN.fullmatch(sha256)):
        raise CatalogWriteError(f'{label} bundle file {member} SHA-256 must be 64 lowercase hex characters: {sha256!r}')
    byte_length = value.get(BUNDLE_MEMBER_BYTES_FIELD)
    if BUNDLE_MEMBER_BYTES_FIELD in value and not is_safe_integer(byte_length, 0):
        raise CatalogWriteError(f'{label} bundle file {member} byte length must be a safe integer of at least 0: {byte_length!r}')
    relative = f'{bundle_folder}/{member}' if bundle_folder != STORE_ROOT_BUNDLE_FOLDER else member
    return PinnedFileReference(relative, sha256, byte_length, bundle_folder)


def is_bundle_member_map(value):
    members = value.get(BUNDLE_MEMBER_MAP_FIELD)
    return isinstance(members, dict) and any(isinstance(pin, dict) and BUNDLE_MEMBER_SHA256_FIELD in pin for pin in members.values())


def bundle_member_map_references(members, label, bundle_folder):
    references = []
    for member, pin in members.items():
        if not (isinstance(pin, dict) and BUNDLE_MEMBER_SHA256_FIELD in pin and set(pin) <= BUNDLE_MEMBER_MAP_PIN_FIELDS):
            raise CatalogWriteError(f'{label} bundle file map entry {member!r} must hold only sha256 and bytes: {pin!r}')
        references.append(require_bundle_member_pin({BUNDLE_MEMBER_PATH_FIELD: member, **pin}, label, bundle_folder))
    return references


def pinned_file_references(value, label, bundle_folder):
    if isinstance(value, list):
        return [reference for item in value for reference in pinned_file_references(item, label, bundle_folder)]
    if not isinstance(value, dict):
        return []
    references = [require_file_pin(value, path_field, sha256_field, bytes_field, label)
                  for path_field, sha256_field, bytes_field in PINNED_FILE_REFERENCE_FIELDS if is_file_pin(value, path_field, sha256_field)]
    if is_bundle_member_pin(value):
        references.append(require_bundle_member_pin(value, label, bundle_folder))
    if is_bundle_member_map(value):
        references.extend(bundle_member_map_references(value[BUNDLE_MEMBER_MAP_FIELD], label, bundle_folder))
    return references + [reference for item in value.values() for reference in pinned_file_references(item, label, bundle_folder)]


def glb_material_program_references(glb, label):
    references = []
    for program_sha256 in glb_native_material_program_sha256s(glb, label):
        directory = native_material_program_directory(program_sha256)
        references.append(PinnedFileReference(f'{directory}/{MATERIAL_PROGRAM_FILE_NAME}', program_sha256, None, directory))
    return references


def catalog_pinned_file_references(catalog):
    return [reference for slice_name in KNOWN_CATALOG_SLICES for record in catalog.get(slice_name, [])
            for reference in pinned_file_references(record, f'catalog {slice_name} record {record.get("id")}', None)]


def bundle_folder_of(relative):
    parent = PurePosixPath(relative).parent.as_posix()
    return STORE_ROOT_BUNDLE_FOLDER if parent == '.' else parent


def require_inside_bundle_folder(store_root, reference):
    bundle_folder = Path(os.path.realpath(Path(store_root) / reference.bundle_folder))
    resolved = Path(os.path.realpath(Path(store_root) / reference.relative))
    if not (resolved.is_relative_to(bundle_folder) and resolved != bundle_folder):
        raise CatalogWriteError(f'bundle file resolves outside its bundle folder {reference.bundle_folder or "."}: {reference.relative}')


def read_pinned_file(store_root, reference):
    if reference.bundle_folder is not None:
        require_inside_bundle_folder(store_root, reference)
    path = confined_child_path(store_root, reference.relative)
    if not path.is_file():
        raise CatalogWriteError(f'pinned store file is missing from {store_root}: {reference.relative}')
    payload = path.read_bytes()
    if sha256_hex(payload) != reference.sha256:
        raise CatalogWriteError(f'pinned store file SHA-256 differs from its pin {reference.sha256}: {reference.relative}')
    if reference.byte_length is not None and len(payload) != reference.byte_length:
        raise CatalogWriteError(f'pinned store file byte length differs from its pin {reference.byte_length}: {reference.relative}')
    return payload


def require_one_sha256_per_store_file(verified_sha256, reference):
    if verified_sha256 != reference.sha256:
        raise CatalogWriteError(f'store file {reference.relative} is pinned with two different SHA-256 values')


def pinned_file_child_references(reference, payload):
    child_references = []
    if reference.bundle_folder is None and reference.relative.endswith(PINNED_MANIFEST_SUFFIX):
        manifest = json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
        child_references.extend(pinned_file_references(manifest, f'store file {reference.relative}', bundle_folder_of(reference.relative)))
    if reference.relative.casefold().endswith(PINNED_GLB_SUFFIX):
        child_references.extend(glb_material_program_references(payload, f'store file {reference.relative}'))
    return child_references


def pinned_store_files(store_root, catalog):
    files, verified_sha256_by_store_file_key, pending = {}, {}, deque(catalog_pinned_file_references(catalog))
    while pending:
        reference = pending.popleft()
        key = reference.relative.casefold()
        if key in verified_sha256_by_store_file_key:
            require_one_sha256_per_store_file(verified_sha256_by_store_file_key[key], reference)
            continue
        payload = read_pinned_file(store_root, reference)
        add_store_file(files, reference.relative, payload)
        verified_sha256_by_store_file_key[key] = reference.sha256
        pending.extend(pinned_file_child_references(reference, payload))
    return files


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
