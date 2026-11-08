from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import (KNOWN_CATALOG_SLICES, add_store_file, merge_catalog_slice, read_store_catalog, sha256_hex,
                                         sha256_of_file, verify_store_destinations, write_store)
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, lane_store_root, read_lane_parts_by_name

LANE_CATALOG_DESCRIPTION = ('Pin a lane store catalog to the SHA-256 of the shared public/l2 catalog it was built on, '
                            'union other lane stores into it, or print the restage line with --plan.')
UNION_EXCLUDED_STORE_FILES = ('catalog.json', 'coverage.json')
RECORD_REFERENCE_FIELDS = (('manifest', 'manifestSha256', 'manifestBytes'), ('archive', 'archiveSha256', None),
                           ('model', 'modelSha256', None), ('image', 'imageSha256', 'imageBytes'))
NATIVE_RESOURCE_PREFIX = '/l2/'


class LaneCatalogError(ValueError):
    pass


def base_catalog_sha256(project_root):
    base_catalog_path = Path(project_root) / 'public' / 'l2' / 'catalog.json'
    if not base_catalog_path.is_file():
        raise LaneCatalogError(f'base catalog is missing: {base_catalog_path}')
    return sha256_of_file(base_catalog_path)


def catalog_record_references(catalog):
    references = []
    for slice_name in KNOWN_CATALOG_SLICES:
        for record in catalog.get(slice_name, []):
            for path_field, sha256_field, bytes_field in RECORD_REFERENCE_FIELDS:
                if path_field not in record:
                    continue
                path, sha256 = record[path_field], record.get(sha256_field)
                if not (isinstance(path, str) and path.startswith(NATIVE_RESOURCE_PREFIX) and isinstance(sha256, str)):
                    raise LaneCatalogError(f'catalog {slice_name} record {record.get("id")} has no /l2 {path_field} with {sha256_field}')
                references.append((path[len(NATIVE_RESOURCE_PREFIX):], sha256, record.get(bytes_field) if bytes_field else None))
    return references


def verify_lane_catalog_references(store_root, catalog):
    for relative, sha256, byte_length in catalog_record_references(catalog):
        path = confined_child_path(store_root, relative)
        if not path.is_file():
            raise LaneCatalogError(f'lane catalog record file is missing from the lane store: {relative}')
        if sha256_of_file(path) != sha256:
            raise LaneCatalogError(f'lane catalog record file SHA-256 differs: {relative}')
        if byte_length is not None and path.stat().st_size != byte_length:
            raise LaneCatalogError(f'lane catalog record file byte length differs: {relative}')


def records_by_slice(catalog):
    return {slice_name: len(catalog[slice_name]) for slice_name in KNOWN_CATALOG_SLICES if slice_name in catalog}


def union_lane_store_relative_paths(union_store_root):
    if not union_store_root.is_dir():
        return []
    relative_paths = (path.relative_to(union_store_root).as_posix() for path in union_store_root.rglob('*') if path.is_file())
    return sorted(relative for relative in relative_paths if relative not in UNION_EXCLUDED_STORE_FILES)


def merge_union_lane(project_root, union_lane_name, base_sha256, catalog, files):
    union_store_root = lane_store_root(project_root, union_lane_name)
    union_catalog, union_catalog_bytes = read_store_catalog(union_store_root)
    if union_catalog_bytes is None:
        raise LaneCatalogError(f'union lane {union_lane_name} has no catalog: {union_store_root / "catalog.json"}')
    union_base_sha256 = union_catalog.get('sourceCatalogSha256')
    if union_base_sha256 != base_sha256:
        raise LaneCatalogError(f'union lane {union_lane_name} was built on base catalog sha256 {union_base_sha256}; '
                               f'the current base catalog sha256 is {base_sha256}')
    verify_lane_catalog_references(union_store_root, union_catalog)
    for relative in union_lane_store_relative_paths(union_store_root):
        add_store_file(files, relative, confined_child_path(union_store_root, relative).read_bytes())
    for slice_name in KNOWN_CATALOG_SLICES:
        incoming_records = union_catalog.get(slice_name, [])
        capacity = len(catalog.get(slice_name, [])) + len(incoming_records)
        for record in incoming_records:
            catalog = merge_catalog_slice(catalog, slice_name, record, capacity)
    return catalog


def require_distinct_union_lanes(lane_name, union_lane_names):
    if lane_name in union_lane_names:
        raise LaneCatalogError(f'target lane {lane_name} cannot also be a union lane')
    for union_lane_name in union_lane_names:
        if union_lane_names.count(union_lane_name) > 1:
            raise LaneCatalogError(f'union lane {union_lane_name} is listed twice')


def restage_instruction(project_root, lane_name, lane_catalog_sha256, base_sha256):
    main_checkout_root = Path(os.path.realpath(Path(project_root) / 'public' / 'l2')).parent.parent
    return (f'restage {lane_store_root(project_root, lane_name).as_posix()} into {(main_checkout_root / "public" / "l2").as_posix()} '
            f'from the main checkout with the lane store merge tool of plan 02-24 '
            f'(expected base catalog sha256 {base_sha256}, lane catalog sha256 {lane_catalog_sha256})')


def write_lane_catalog(project_root, lane_name, union_lane_names=(), plan_only=False):
    union_lane_names = list(union_lane_names)
    require_distinct_union_lanes(lane_name, union_lane_names)
    store_root = lane_store_root(project_root, lane_name)
    base_sha256 = base_catalog_sha256(project_root)
    catalog, before = read_store_catalog(store_root)
    if plan_only and before is None:
        raise LaneCatalogError(f'lane {lane_name} has no catalog: {store_root / "catalog.json"}')
    verify_lane_catalog_references(store_root, catalog)
    files = {}
    for union_lane_name in union_lane_names:
        catalog = merge_union_lane(project_root, union_lane_name, base_sha256, catalog, files)
    catalog['sourceCatalogSha256'] = base_sha256
    after = json_bytes(catalog)
    summary = {'lane': lane_name, 'laneStoreRoot': store_root.as_posix(), 'catalogSha256': sha256_hex(after),
               'sourceCatalogSha256': base_sha256, 'recordsBySlice': records_by_slice(catalog)}
    if plan_only:
        if verify_store_destinations(store_root, files) or after != before:
            raise LaneCatalogError(f'lane {lane_name} is not written yet; run write_lane_catalog.py without --plan first')
        return {**summary, 'filesWritten': 0,
                'restageInstruction': restage_instruction(project_root, lane_name, summary['catalogSha256'], base_sha256)}
    return {**summary, 'filesWritten': write_store(store_root, files, before, after)['filesWritten']}


def main(argv=None):
    lane_names = sorted(read_lane_parts_by_name())
    parser = argparse.ArgumentParser(description=LANE_CATALOG_DESCRIPTION)
    parser.add_argument('--lane', required=True, choices=lane_names)
    parser.add_argument('--union', action='append', default=[], choices=lane_names)
    parser.add_argument('--plan', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        summary = write_lane_catalog(REPOSITORY_ROOT, arguments.lane, arguments.union, plan_only=arguments.plan)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(summary['restageInstruction'] if arguments.plan else json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
