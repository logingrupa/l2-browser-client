from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import KNOWN_CATALOG_SLICES, read_store_catalog, sha256_of_file, write_store
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, lane_store_root, read_lane_parts_by_name

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


def write_lane_catalog(project_root, lane_name):
    store_root = lane_store_root(project_root, lane_name)
    base_sha256 = base_catalog_sha256(project_root)
    catalog, before = read_store_catalog(store_root)
    verify_lane_catalog_references(store_root, catalog)
    catalog['sourceCatalogSha256'] = base_sha256
    written = write_store(store_root, {}, before, json_bytes(catalog))
    return {'lane': lane_name, 'laneStoreRoot': store_root.as_posix(), 'catalogSha256': written['catalogSha256'],
            'sourceCatalogSha256': base_sha256, 'recordsBySlice': records_by_slice(catalog),
            'filesWritten': written['filesWritten']}


def main(argv=None):
    lane_names = sorted(read_lane_parts_by_name())
    parser = argparse.ArgumentParser(description='Pin a lane store catalog to the SHA-256 of the shared public/l2 catalog it was built on.')
    parser.add_argument('--lane', required=True, choices=lane_names)
    arguments = parser.parse_args(argv)
    try:
        summary = write_lane_catalog(REPOSITORY_ROOT, arguments.lane)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
