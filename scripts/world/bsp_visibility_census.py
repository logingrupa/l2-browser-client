from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from native_store.store_paths import REPOSITORY_ROOT
from world.bsp_visibility_step import sealed_bsp_visibility
from world.raw_map_step import read_tile_map_lock_record, require_tile_id

BSP_VISIBILITY_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'world' / 'bsp-visibility-census.json'
BSP_VISIBILITY_CENSUS_SCHEMA_VERSION = 1
MEMBER_KIND_FIELDS = (('static-mesh', 'staticMeshMembers'), ('map-emitter', 'emitterPlacements'))


def tile_census_row(tile_id, product):
    counts = product['counts']
    kinds = {field: sum(1 for member in product['members'] if member['kind'] == kind) for kind, field in MEMBER_KIND_FIELDS}
    return {'tileId': tile_id, 'resourceSha256': product['resource']['sha256'], 'nodes': counts['nodes'], 'leaves': counts['leaves'],
            'zones': counts['zones'], 'portals': counts['portals'], **kinds, 'solidityDisagreements': len(product['solidity']['disagreements']),
            'gapReasons': sorted({row['reason'] for row in product['gapRows']})}


def build_bsp_visibility_census(products_by_tile):
    sample_grids = {tuple(product['solidity']['cellsPerAxis']) for product in products_by_tile.values()}
    if len(sample_grids) != 1:
        raise ValueError(f'bsp-visibility products disagree on the census sample grid: {sorted(sample_grids)}')
    return {'schemaVersion': BSP_VISIBILITY_CENSUS_SCHEMA_VERSION, 'sampleCellsPerAxis': list(sample_grids.pop()),
            'tiles': [tile_census_row(tile_id, products_by_tile[tile_id]) for tile_id in sorted(products_by_tile)]}


def sealed_products(tile_ids):
    products = {}
    for tile_id in tile_ids:
        require_tile_id(tile_id)
        _, product = sealed_bsp_visibility(REPOSITORY_ROOT, tile_id, read_tile_map_lock_record(tile_id))
        if product is None:
            raise ValueError(f'tile {tile_id} has no sealed bsp-visibility unit; run convert_tile.py --map {tile_id} --step bsp-visibility')
        products[tile_id] = product
    return products


def main(argv=None):
    parser = argparse.ArgumentParser(description='Write the committed BSP visibility census from sealed bsp-visibility units of the world lane.')
    parser.add_argument('--map', action='append', required=True, dest='tile_ids')
    arguments = parser.parse_args(argv)
    census = build_bsp_visibility_census(sealed_products(arguments.tile_ids))
    BSP_VISIBILITY_CENSUS_PATH.write_text(json.dumps(census, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(census['tiles'], indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
