from __future__ import annotations

import argparse
from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import MAXIMUM_CATALOG_BYTES, STORE_CATALOG_NAME, sha256_hex
from native_store.merge_lane_store import lane_union_catalog, read_required_catalog_bytes
from native_store.store_paths import refuse_reparse_points

LANE_UNION_CATALOG_DESCRIPTION = ('Print {laneCatalogSha256, unionCatalogText}: the catalog a restage of one lane store would write, '
                                  'the shared store catalog with the lane records merged by the merge_lane_store rule. Refused when the '
                                  'lane catalog was built on another shared catalog. The NATIVE_STORE_ROOT dev switch serves its text.')


class LaneUnionCatalogRefusedError(ValueError):
    pass


def read_shared_catalog_bytes(shared_store_root):
    catalog_path = Path(shared_store_root) / STORE_CATALOG_NAME
    if not catalog_path.is_file():
        raise LaneUnionCatalogRefusedError(f'shared store has no catalog.json: {catalog_path}')
    with open(catalog_path, 'rb') as stream:
        payload = stream.read(MAXIMUM_CATALOG_BYTES + 1)
    if len(payload) > MAXIMUM_CATALOG_BYTES:
        raise LaneUnionCatalogRefusedError(f'shared store catalog exceeds {MAXIMUM_CATALOG_BYTES} bytes: {catalog_path}')
    return payload


def lane_union_catalog_document(lane_store_root, shared_store_root):
    lane_catalog_bytes = read_required_catalog_bytes(refuse_reparse_points(lane_store_root), 'lane store')
    shared_catalog_bytes = read_shared_catalog_bytes(shared_store_root)
    _, union_catalog_bytes = lane_union_catalog(lane_catalog_bytes, shared_catalog_bytes, sha256_hex(shared_catalog_bytes))
    return {'laneCatalogSha256': sha256_hex(lane_catalog_bytes), 'unionCatalogText': union_catalog_bytes.decode('utf-8')}


def main(argv=None):
    parser = argparse.ArgumentParser(description=LANE_UNION_CATALOG_DESCRIPTION)
    parser.add_argument('--lane-store', type=Path, required=True)
    parser.add_argument('--shared-store', type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        document = lane_union_catalog_document(arguments.lane_store, arguments.shared_store)
    except (ValueError, OSError) as error:
        print(f'Lane union catalog refused: {error}', file=sys.stderr)
        return 1
    sys.stdout.buffer.write(json_bytes(document))
    return 0


if __name__ == '__main__':
    sys.exit(main())
