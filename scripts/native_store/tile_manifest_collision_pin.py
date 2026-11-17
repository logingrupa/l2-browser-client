from __future__ import annotations

from native_store.catalog_index_keys import store_root_candidates
from native_store.coverage_denominators import CoverageReportError
from native_store.gap_census_derived_parts import pinned_tile_manifest
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary

NATIVE_TILE_COLLISION_RESOURCE_KIND = 'native-tile-collision'
TILES_CATALOG_SLICE = 'tiles'


class TileCollisionPinError(ValueError):
    pass


def require_tile_manifests_pin_collision(store_root, catalog):
    tile_records = catalog.get(TILES_CATALOG_SLICE, [])
    vocabulary = load_tile_manifest_vocabulary() if tile_records else None
    store_roots = store_root_candidates(store_root, None)
    for record in tile_records:
        try:
            manifest = pinned_tile_manifest(record, store_roots, vocabulary)
        except CoverageReportError as error:
            raise TileCollisionPinError(str(error)) from error
        if not any(resource['kind'] == NATIVE_TILE_COLLISION_RESOURCE_KIND for resource in manifest['resources']):
            raise TileCollisionPinError(f'catalog tiles record {record["id"]} manifest pins no {NATIVE_TILE_COLLISION_RESOURCE_KIND} '
                                        'resource; the client refuses to load it')
