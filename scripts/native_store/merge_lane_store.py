from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import NamedTuple
import zipfile

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets import verify_archive
from native_assets_lib.asset_manifest import require_supported_asset_manifest
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import (KNOWN_CATALOG_SLICES, decode_store_catalog, merge_catalog_slice_records, pinned_store_files,
                                         read_current_catalog_bytes, sha256_hex, validate_catalog_record, verify_store_destinations, write_store)
from native_store.store_paths import SHA256_PATTERN, confined_child_path, refuse_reparse_points

LANE_STORE_MERGE_DESCRIPTION = ('Merge one verified lane store into the main checkout public/l2 store: every check runs before the first '
                                'write and catalog.json is written last. Run only by the integration thread in the main checkout.')
LANE_CATALOG_TOP_LEVEL_FIELDS = ('schemaVersion', 'sourceCatalogSha256')
LANE_ARCHIVE_SUFFIX = '.l2asset'
LANE_ARCHIVE_SCHEMA_VERSION = 2
ASSET_MANIFEST_NAME = 'asset.json'
MAIN_CHECKOUT_STORE_PARTS = ('public', 'l2')
MAIN_CHECKOUT_ONLY_MESSAGE = 'merge_lane_store runs only in the main checkout (integration thread); this is a linked worktree'


class LaneStoreMergeRefusedError(ValueError):
    pass


class GitCheckoutPaths(NamedTuple):
    git_directory: Path
    common_directory: Path
    top_level: Path


def read_git_checkout_paths(directory):
    completed = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
                               cwd=directory, capture_output=True, text=True, check=False)
    lines = completed.stdout.splitlines()
    if completed.returncode != 0 or len(lines) != 3:
        raise LaneStoreMergeRefusedError(f'not a git checkout: {directory}')
    return GitCheckoutPaths(*(Path(os.path.realpath(line)) for line in lines))


def main_checkout_root(directory):
    return read_git_checkout_paths(directory).common_directory.parent


def require_main_checkout(current_directory):
    checkout_paths = read_git_checkout_paths(current_directory)
    if checkout_paths.git_directory != checkout_paths.common_directory:
        raise LaneStoreMergeRefusedError(MAIN_CHECKOUT_ONLY_MESSAGE)
    if checkout_paths.top_level != Path(os.path.realpath(current_directory)):
        raise LaneStoreMergeRefusedError(f'run merge_lane_store from the main checkout root {checkout_paths.top_level}, not {current_directory}')
    return checkout_paths.top_level


def require_main_checkout_store_target(main_checkout, target):
    expected_target = Path(os.path.realpath(main_checkout.joinpath(*MAIN_CHECKOUT_STORE_PARTS)))
    if Path(os.path.realpath(target)) != expected_target:
        raise LaneStoreMergeRefusedError(f'--target must be {"/".join(MAIN_CHECKOUT_STORE_PARTS)} of the main checkout '
                                         f'({expected_target}): {target}')
    return target


def require_sha256(value, label):
    if not (isinstance(value, str) and SHA256_PATTERN.fullmatch(value)):
        raise LaneStoreMergeRefusedError(f'{label} must be 64 lowercase hex characters: {value!r}')
    return value


def read_required_catalog_bytes(store_root, label):
    payload = read_current_catalog_bytes(store_root)
    if payload is None:
        raise LaneStoreMergeRefusedError(f'{label} has no catalog.json: {store_root}')
    return payload


def require_one_base_catalog(target_catalog_sha256, lane_catalog, expected_base_catalog_sha256):
    if expected_base_catalog_sha256 != target_catalog_sha256:
        raise LaneStoreMergeRefusedError(f'expected base catalog sha256 {expected_base_catalog_sha256} differs from the target catalog '
                                         f'sha256 {target_catalog_sha256}; the lane was built on another base or was already merged')
    lane_base_sha256 = lane_catalog.get('sourceCatalogSha256')
    if lane_base_sha256 != target_catalog_sha256:
        raise LaneStoreMergeRefusedError(f'lane catalog sourceCatalogSha256 {lane_base_sha256} differs from the target catalog '
                                         f'sha256 {target_catalog_sha256}')


def lane_records_by_slice(lane_catalog):
    unknown_fields = sorted(set(lane_catalog) - set(KNOWN_CATALOG_SLICES) - set(LANE_CATALOG_TOP_LEVEL_FIELDS))
    if unknown_fields:
        raise LaneStoreMergeRefusedError(f'lane catalog holds fields the merge does not know: {", ".join(unknown_fields)}')
    records_by_slice = {}
    for slice_name in KNOWN_CATALOG_SLICES:
        records = lane_catalog.get(slice_name, [])
        if not isinstance(records, list):
            raise LaneStoreMergeRefusedError(f'lane catalog {slice_name} is not a list')
        record_ids = [validate_catalog_record(slice_name, record)['id'] for record in records]
        if len(set(record_ids)) != len(record_ids):
            raise LaneStoreMergeRefusedError(f'lane catalog {slice_name} lists one record id twice')
        if records:
            records_by_slice[slice_name] = records
    if not records_by_slice:
        raise LaneStoreMergeRefusedError('lane catalog has no records to merge')
    return records_by_slice


def merged_target_catalog(target_catalog, records_by_slice):
    merged = target_catalog
    for slice_name, records in records_by_slice.items():
        target_records = target_catalog.get(slice_name, [])
        target_ids = {record.get('id') for record in target_records if isinstance(record, dict)}
        for record in records:
            if record['id'] in target_ids:
                raise LaneStoreMergeRefusedError(f'lane record id {record["id"]} is already in the target {slice_name} slice')
        merged = merge_catalog_slice_records(merged, slice_name, records, len(target_records) + len(records))
    return merged


def require_version_two_lane_archives(lane_store_root, files):
    for relative, payload in files.values():
        if not relative.endswith(LANE_ARCHIVE_SUFFIX):
            continue
        if verify_archive(confined_child_path(lane_store_root, relative))['sha256'] != sha256_hex(payload):
            raise LaneStoreMergeRefusedError(f'lane archive changed while it was read: {relative}')
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            asset_manifest = require_supported_asset_manifest(json.loads(archive.read(ASSET_MANIFEST_NAME)))
        if asset_manifest['schemaVersion'] != LANE_ARCHIVE_SCHEMA_VERSION:
            raise LaneStoreMergeRefusedError(f'lane archive asset.json schemaVersion is {asset_manifest["schemaVersion"]}, '
                                             f'only {LANE_ARCHIVE_SCHEMA_VERSION} merges: {relative}')


def added_record_counts(records_by_slice):
    return {slice_name: len(records) for slice_name, records in records_by_slice.items()}


def lane_union_catalog(lane_catalog_bytes, target_catalog_bytes, expected_base_catalog_sha256):
    lane_catalog = decode_store_catalog(lane_catalog_bytes)
    target_catalog = decode_store_catalog(target_catalog_bytes)
    require_one_base_catalog(sha256_hex(target_catalog_bytes), lane_catalog, expected_base_catalog_sha256)
    records_by_slice = lane_records_by_slice(lane_catalog)
    return records_by_slice, json_bytes(merged_target_catalog(target_catalog, records_by_slice))


def merge_verified_lane_store(lane_store_root, target_root, expected_base_catalog_sha256):
    require_sha256(expected_base_catalog_sha256, 'expected base catalog sha256')
    lane_root, target = refuse_reparse_points(lane_store_root), refuse_reparse_points(target_root)
    before = read_required_catalog_bytes(target, 'target store')
    records_by_slice, after = lane_union_catalog(read_required_catalog_bytes(lane_root, 'lane store'), before, expected_base_catalog_sha256)
    files = pinned_store_files(lane_root, records_by_slice)
    require_version_two_lane_archives(lane_root, files)
    copied_files = sorted(verify_store_destinations(target, files))
    unchanged_files = sorted(relative for relative, _ in files.values() if relative not in copied_files)
    write_store(target, files, before, after)
    return {'beforeCatalogSha256': sha256_hex(before), 'afterCatalogSha256': sha256_hex(after), 'copiedFiles': copied_files,
            'unchangedFiles': unchanged_files, 'addedRecordsBySlice': added_record_counts(records_by_slice)}


def merge_lane_store(lane_store_root, target_root, expected_base_catalog_sha256):
    try:
        return merge_verified_lane_store(lane_store_root, target_root, expected_base_catalog_sha256)
    except LaneStoreMergeRefusedError:
        raise
    except ValueError as error:
        raise LaneStoreMergeRefusedError(str(error)) from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=LANE_STORE_MERGE_DESCRIPTION)
    parser.add_argument('--lane-store', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--expected-base-catalog-sha256', required=True)
    arguments = parser.parse_args(argv)
    try:
        require_sha256(arguments.expected_base_catalog_sha256, '--expected-base-catalog-sha256')
        main_checkout = require_main_checkout(Path.cwd())
        target = require_main_checkout_store_target(main_checkout, arguments.target)
        result = merge_lane_store(arguments.lane_store, target, arguments.expected_base_catalog_sha256)
    except (ValueError, OSError) as error:
        print(f'Lane store merge refused: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
