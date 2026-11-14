import hashlib
import json

from native_store.store_paths import lane_store_root
from world import minimap_route_step
from world.minimap_route_step import (MINIMAP_ROUTE_MANIFEST_NAME, MINIMAP_ROUTE_PRODUCT_NAME, MINIMAP_ROUTE_STORE_FOLDER, MINIMAP_ROUTE_UNIT_KEY,
                                      current_minimap_route, minimap_route_inputs, minimap_route_ledger)
from world.raw_map_step import PRODUCTS_FOLDER_NAME
from world.tile_census import WORLD_LANE_NAME
from world.tile_json_resource import write_tile_json_resource

SYNTHETIC_ROUTE_GAPS = [{'reason': 'minimap-join-unresolved:zone-title-source', 'evidence': 'synthetic zone title source'},
                        {'reason': 'minimap-join-unresolved:radar-anchor', 'evidence': 'synthetic radar anchor'}]


def seal_synthetic_minimap_route(project_root, overlapping_run_tile_ids=(), gaps=None):
    route_gaps = list(SYNTHETIC_ROUTE_GAPS if gaps is None else gaps)
    ledger, fingerprint = minimap_route_ledger(project_root), current_minimap_route(project_root).fingerprint
    manifest = {'kind': 'native-minimap-route', 'schemaVersion': 1, 'zoneKeys': {'overlappingRuns': [
        {'key': index, 'tileId': tile_id, 'rowIndices': [0, 1]} for index, tile_id in enumerate(overlapping_run_tile_ids)]}, 'gaps': route_gaps}
    products = ledger.begin(MINIMAP_ROUTE_UNIT_KEY, fingerprint) / PRODUCTS_FOLDER_NAME
    products.mkdir()
    record, output = write_tile_json_resource(lane_store_root(project_root, WORLD_LANE_NAME), MINIMAP_ROUTE_STORE_FOLDER, MINIMAP_ROUTE_MANIFEST_NAME, manifest)
    product_bytes = json.dumps({'manifest': record, 'gaps': route_gaps}).encode('utf-8')
    (products / MINIMAP_ROUTE_PRODUCT_NAME).write_bytes(product_bytes)
    product_output = {'path': (products / MINIMAP_ROUTE_PRODUCT_NAME).relative_to(ledger.lane_folder).as_posix(),
                      'sha256': hashlib.sha256(product_bytes).hexdigest(), 'bytes': len(product_bytes)}
    ledger.seal(MINIMAP_ROUTE_UNIT_KEY, fingerprint, {'config': minimap_route_step.minimap_route_config(), 'inputs': minimap_route_inputs(),
                                                      'outputs': [output, product_output], 'gapRows': []})
    return record
