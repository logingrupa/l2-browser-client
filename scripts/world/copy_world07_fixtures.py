import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reference_client_guard import sha256_of_file

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORLD07_FIXTURE_DESTINATION = REPOSITORY_ROOT / 'tests' / 'fixtures' / 'world-07'
WORLD07_FIXTURE_INDEX_NAME = 'fixtures.json'
WORLD07_FIXTURE_SCHEMA_VERSION = 1
PACKET_RELATIVE_ROOT = 'post-migration-visibility-20261106'
PACKET_MANIFEST_NAME = 'SHA256_MANIFEST.json'
PACKET_FILES_OUTSIDE_MANIFEST = frozenset({PACKET_MANIFEST_NAME, 'DELIVERY_VERIFICATION.json'})
WORLD07_FIXTURE_SOURCES = {
    'composition-submission/DISCRIMINATING_CASES.json': 'discriminating-cases.json',
}
JSON_FIXTURE_TRANSFORM = 'canonical-json-absolute-path-fields-reduced-to-basename'
MARKDOWN_FIXTURE_TRANSFORM = 'verbatim-markdown'
BASENAME_FIELD_SUFFIX = 'Basename'
LONG_BINARY_RUN_LIMIT = 128
SHA256_HEX_PATTERN = re.compile(r'^[0-9a-f]{64}$')
WINDOWS_DRIVE_PATH_VALUE_PATTERN = re.compile(r'^[A-Za-z]:[\\/]')
ABSOLUTE_PATH_TEXT_PATTERN = re.compile(r'(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\.codex-proxy')
PRIVATE_SCRATCH_MARKER = '.codex-proxy'
LONG_BINARY_RUN_PATTERN = re.compile(r'[A-Za-z0-9+/=]{%d,}' % (LONG_BINARY_RUN_LIMIT + 1))
PATH_SEGMENT_SEPARATOR_PATTERN = re.compile(r'[\\/]')


class World07PacketManifestError(ValueError):
    pass


class World07FixtureCopyError(ValueError):
    pass


def require_packet_relative_path(row_path):
    if not isinstance(row_path, str) or not row_path:
        raise World07PacketManifestError(f'manifest row path must be a non-empty string: {row_path!r}')
    if '\\' in row_path or ':' in row_path or PurePosixPath(row_path).is_absolute():
        raise World07PacketManifestError(f'manifest row path must be relative with forward slashes: {row_path!r}')
    if any(part in ('', '.', '..') for part in row_path.split('/')):
        raise World07PacketManifestError(f'manifest row path escapes the packet: {row_path!r}')
    return row_path


def read_packet_manifest_rows(manifest_path):
    if not manifest_path.is_file():
        raise World07PacketManifestError(f'packet manifest missing: {PACKET_MANIFEST_NAME}')
    manifest = json.loads(manifest_path.read_bytes().decode('utf-8'))
    rows = manifest.get('files') if isinstance(manifest, dict) else None
    if not isinstance(rows, list) or not rows:
        raise World07PacketManifestError(f'packet manifest has no rows: {PACKET_MANIFEST_NAME}')
    return rows


def verify_packet_manifest_row(packet_root, row):
    if not isinstance(row, dict):
        raise World07PacketManifestError(f'manifest row must be an object: {row!r}')
    row_path = require_packet_relative_path(row.get('path'))
    expected_bytes, expected_sha256 = row.get('bytes'), row.get('sha256')
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes < 0:
        raise World07PacketManifestError(f'manifest row bytes must be a non-negative integer: {row_path}')
    if not isinstance(expected_sha256, str) or not SHA256_HEX_PATTERN.match(expected_sha256):
        raise World07PacketManifestError(f'manifest row sha256 must be 64 lowercase hex characters: {row_path}')
    file_path = packet_root / row_path
    if not file_path.is_file():
        raise World07PacketManifestError(f'manifest row file missing: {row_path}')
    actual_bytes = file_path.stat().st_size
    if actual_bytes != expected_bytes:
        raise World07PacketManifestError(f'manifest row byte count mismatch: {row_path} has {actual_bytes}, manifest says {expected_bytes}')
    actual_sha256 = sha256_of_file(file_path)
    if actual_sha256 != expected_sha256:
        raise World07PacketManifestError(f'manifest row sha256 mismatch: {row_path} has {actual_sha256}, manifest says {expected_sha256}')
    return row_path


def list_packet_files(packet_root):
    return sorted(Path(directory, file_name).relative_to(packet_root).as_posix()
                  for directory, _, file_names in os.walk(packet_root) for file_name in file_names)


def verify_world07_packet_manifest(packet_root):
    packet_root = Path(packet_root)
    manifest_path = packet_root / PACKET_MANIFEST_NAME
    rows = read_packet_manifest_rows(manifest_path)
    listed_paths = set()
    for row in rows:
        row_path = verify_packet_manifest_row(packet_root, row)
        if row_path in listed_paths:
            raise World07PacketManifestError(f'manifest row listed twice: {row_path}')
        listed_paths.add(row_path)
    packet_files = list_packet_files(packet_root)
    unlisted_files = [path for path in packet_files if path not in listed_paths and path not in PACKET_FILES_OUTSIDE_MANIFEST]
    if unlisted_files:
        raise World07PacketManifestError(f'packet file not listed in the manifest: {unlisted_files[0]}')
    return {'manifestSha256': sha256_of_file(manifest_path), 'rowCount': len(rows),
            'matchedRows': len(listed_paths), 'packetFileCount': len(packet_files)}


def is_absolute_path_value(value):
    return isinstance(value, str) and (WINDOWS_DRIVE_PATH_VALUE_PATTERN.match(value) is not None or PRIVATE_SCRATCH_MARKER in value)


def json_pointer_token(key):
    return str(key).replace('~', '~0').replace('/', '~1')


def final_path_segment(path_value):
    return PATH_SEGMENT_SEPARATOR_PATTERN.split(path_value)[-1]


def drop_absolute_path_fields_at(value, pointer, dropped_pointers):
    if isinstance(value, list):
        return [drop_absolute_path_fields_at(item, f'{pointer}/{index}', dropped_pointers) for index, item in enumerate(value)]
    if not isinstance(value, dict):
        return value
    kept_fields = {}
    for key, field_value in value.items():
        field_pointer = f'{pointer}/{json_pointer_token(key)}'
        if not is_absolute_path_value(field_value):
            kept_fields[key] = drop_absolute_path_fields_at(field_value, field_pointer, dropped_pointers)
            continue
        basename_key = key + BASENAME_FIELD_SUFFIX
        if basename_key in value:
            raise World07FixtureCopyError(f'basename field already present beside a dropped path field: {field_pointer}')
        kept_fields[basename_key] = final_path_segment(field_value)
        dropped_pointers.append(field_pointer)
    return kept_fields


def drop_absolute_path_fields(value):
    dropped_pointers = []
    return drop_absolute_path_fields_at(value, '', dropped_pointers), dropped_pointers


def find_long_binary_runs(text):
    return LONG_BINARY_RUN_PATTERN.findall(text)


def find_absolute_path_text(text):
    return ABSOLUTE_PATH_TEXT_PATTERN.findall(text)


def canonical_json_text(value):
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + '\n'


def require_committable_fixture_text(fixture_name, text):
    if find_long_binary_runs(text):
        raise World07FixtureCopyError(f'fixture holds a base64 or hex run longer than {LONG_BINARY_RUN_LIMIT} characters: {fixture_name}')
    if find_absolute_path_text(text):
        raise World07FixtureCopyError(f'fixture still holds an absolute or private path: {fixture_name}')
    return text


def transform_packet_source(source_bytes, source_path):
    source_text = source_bytes.decode('utf-8')
    if source_path.endswith('.json'):
        fixture_value, dropped_pointers = drop_absolute_path_fields(json.loads(source_text))
        return canonical_json_text(fixture_value), JSON_FIXTURE_TRANSFORM, dropped_pointers
    if source_path.endswith('.md'):
        return source_text, MARKDOWN_FIXTURE_TRANSFORM, []
    raise World07FixtureCopyError(f'fixture source must be JSON or Markdown: {source_path}')


def require_world07_fixture_destination(destination):
    absolute_destination = Path(os.path.abspath(destination))
    if absolute_destination.resolve() != absolute_destination:
        raise World07FixtureCopyError(f'fixture destination must not pass through a link: {absolute_destination}')
    if absolute_destination != WORLD07_FIXTURE_DESTINATION:
        raise World07FixtureCopyError(f'fixture destination must be {WORLD07_FIXTURE_DESTINATION}: {absolute_destination}')
    return absolute_destination


def write_fixture_text(path, text):
    path.write_bytes(text.encode('utf-8'))


def write_fixtures_into(staging_directory, packet_root, manifest_rows_by_path, packet_manifest_sha256):
    index_rows = []
    for source_path in sorted(WORLD07_FIXTURE_SOURCES):
        fixture_name = WORLD07_FIXTURE_SOURCES[source_path]
        manifest_row = manifest_rows_by_path.get(source_path)
        if manifest_row is None:
            raise World07FixtureCopyError(f'fixture source is not a manifest row: {source_path}')
        fixture_text, transform, dropped_pointers = transform_packet_source((packet_root / source_path).read_bytes(), source_path)
        write_fixture_text(staging_directory / fixture_name, require_committable_fixture_text(fixture_name, fixture_text))
        index_rows.append({'fixture': fixture_name, 'sourcePath': source_path, 'sourceSha256': manifest_row['sha256'],
                           'sourceBytes': manifest_row['bytes'], 'transform': transform, 'droppedPointers': dropped_pointers})
    fixture_index = {'schemaVersion': WORLD07_FIXTURE_SCHEMA_VERSION, 'packetManifestSha256': packet_manifest_sha256,
                     'packetRelativeRoot': PACKET_RELATIVE_ROOT, 'fixtures': index_rows}
    write_fixture_text(staging_directory / WORLD07_FIXTURE_INDEX_NAME, canonical_json_text(fixture_index))


def replace_directory(staging_directory, destination):
    if not destination.exists():
        os.rename(staging_directory, destination)
        return
    previous_directory = destination.with_name(f'.{destination.name}-previous-{secrets.token_hex(8)}')
    os.rename(destination, previous_directory)
    try:
        os.rename(staging_directory, destination)
    except OSError:
        os.rename(previous_directory, destination)
        raise
    shutil.rmtree(previous_directory)


def copy_world07_fixtures(packet_root, destination):
    packet_root = Path(packet_root)
    destination = require_world07_fixture_destination(destination)
    verification = verify_world07_packet_manifest(packet_root)
    manifest_rows = read_packet_manifest_rows(packet_root / PACKET_MANIFEST_NAME)
    manifest_rows_by_path = {row['path']: row for row in manifest_rows}
    staging_directory = Path(tempfile.mkdtemp(prefix=f'.{destination.name}-staging-', dir=destination.parent))
    try:
        write_fixtures_into(staging_directory, packet_root, manifest_rows_by_path, verification['manifestSha256'])
        replace_directory(staging_directory, destination)
    except BaseException:
        shutil.rmtree(staging_directory, ignore_errors=True)
        raise
    return verification


def main():
    parser = argparse.ArgumentParser(description='Verify the WORLD-07 packet manifest and copy its path-free fixtures')
    parser.add_argument('--packet', type=Path, required=True)
    arguments = parser.parse_args()
    try:
        verification = copy_world07_fixtures(arguments.packet, WORLD07_FIXTURE_DESTINATION)
    except ValueError as error:
        parser.exit(1, f'{type(error).__name__}: {error}\n')
    print(json.dumps(verification, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
