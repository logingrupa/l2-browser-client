import json
from pathlib import Path

from native_assets import implementation_hash
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.minimap_join import (HUNTINGZONE_TABLE_ROLE, SCHEMA_FIELD_MEANING_LABEL, ZONE_NAME_PACKAGE_ROLE, ZONENAME_TABLE_ROLE,
                                join_tile_route_half)
from world.minimap_route_step import current_minimap_route, run_minimap_route_step
from world.minimap_sources import (MINIMAP_TABLE_PATHS, MINIMAP_TILE_PACKAGE_PATHS, MinimapSources, decoded_table_rows,
                                   lock_equal_minimap_source_paths, tile_frame_extent)
from world.minimap_textures import (convert_minimap_texture, converter_package_request, minimap_texture_converter, read_texture_package_index,
                                    store_converted_texture)
from world.raw_map_step import (PRODUCTS_FOLDER_NAME, RAW_STEP_NAME, read_tile_census_row, read_tile_map_lock_record, require_tile_id,
                                tile_map_path, tile_step_row, tile_unit_key)
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS, TILE_CENSUS_RELATIVE_PATH
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, ChunkPlanStepError, raw_unit_fingerprint, sealed_chunk_plan
from world.tile_json_resource import write_tile_json_resource
from world.tile_step_gap_rows import TileStepGapRows, tile_step_summary_row, upstream_failed_row

MINIMAP_STEP_ALGORITHM_VERSION = 2
MINIMAP_STEP_NAME = 'minimap'
MINIMAP_PRODUCT_NAME = 'minimap.json'
NATIVE_TILE_MINIMAP_KIND = 'native-tile-minimap'
NATIVE_TILE_MINIMAP_SCHEMA_VERSION = 2
MINIMAP_STORE_FOLDER = 'maps'
MINIMAP_MANIFEST_NAME = f'{NATIVE_TILE_MINIMAP_KIND}/manifest.json'


class MinimapStepError(ValueError):
    pass


def minimap_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MINIMAP_STEP_NAME, MINIMAP_STEP_ALGORITHM_VERSION)


def minimap_unit_config(raw_fingerprint, chunk_plan_fingerprint, route_fingerprint):
    return {'rawFingerprint': raw_fingerprint, 'chunkPlanFingerprint': chunk_plan_fingerprint, 'converterSha256': implementation_hash(),
            'routeFingerprint': route_fingerprint}


def minimap_input_records(tile_id):
    return locked_input_records(sorted({tile_map_path(tile_id), *lock_equal_minimap_source_paths()}))


def minimap_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / MINIMAP_PRODUCT_NAME


def tile_minimap_row(tile_id, source_identity, gap_rows, evidence):
    return tile_step_summary_row(tile_id, MINIMAP_STEP_NAME, source_identity, gap_rows, evidence)


def upstream_sealed_fingerprints(project_root, tile_id, lock_record):
    try:
        raw_fingerprint, _ = raw_unit_fingerprint(project_root, tile_id, lock_record)
    except ChunkPlanStepError:
        return RAW_STEP_NAME, None
    try:
        chunk_plan_fingerprint, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    except ChunkPlanStepError:
        return CHUNK_PLAN_STEP_NAME, None
    return None, (minimap_unit_config(raw_fingerprint, chunk_plan_fingerprint, current_minimap_route(project_root).fingerprint), chunk_plan)


def current_minimap_receipt(ledger, unit_key, config, inputs):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or receipt['algorithmVersion'] != MINIMAP_STEP_ALGORITHM_VERSION or receipt['config'] != config or receipt['inputs'] != inputs:
        return None
    return receipt


def sealed_minimap(project_root, tile_id, lock_record):
    failed_upstream, upstream = upstream_sealed_fingerprints(project_root, tile_id, lock_record)
    if failed_upstream is not None or current_minimap_route(project_root).product is None:
        return None, None
    ledger, unit_key = minimap_ledger(project_root), tile_unit_key(tile_id)
    receipt = current_minimap_receipt(ledger, unit_key, upstream[0], minimap_input_records(tile_id))
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(minimap_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def read_minimap_sources(client):
    lock_equal_paths = set(lock_equal_minimap_source_paths())
    packages = {role: read_texture_package_index(client, path) if path in lock_equal_paths else None for role, path in MINIMAP_TILE_PACKAGE_PATHS.items()}
    tables = {role: decoded_table_rows(client, role) if path in lock_equal_paths else None for role, path in MINIMAP_TABLE_PATHS.items()}
    return MinimapSources(packages, tables)


def route_pin(route_product):
    record = route_product['manifest']
    return {'manifest': record['resource'], 'manifestSha256': record['sha256'], 'manifestBytes': record['bytes']}


def overlapping_run_tile_ids(route_manifest_path):
    route_manifest = json.loads(route_manifest_path.read_text(encoding='utf-8'))
    return {run['tileId'] for run in route_manifest['zoneKeys']['overlappingRuns'] if run['tileId'] is not None}


def converted_zone_key_texture(project_root, client, store_root, sources, item, converter):
    if item is None:
        return None, [], []
    package = sources.packages[ZONE_NAME_PACKAGE_ROLE]
    conversion, failure_reason = convert_minimap_texture(converter or minimap_texture_converter(project_root, client), converter_package_request(package['path']),
                                                         item['object'])
    if conversion is None:
        return None, [], [{'reason': failure_reason, 'evidence': item['object']}]
    record, _, output = store_converted_texture(store_root, conversion, item)
    return {**record, 'source': item['source']}, [output], []


def minimap_manifest(tile_id, inputs, route_product, tile_half, zone_key_texture, gaps):
    return {'kind': NATIVE_TILE_MINIMAP_KIND, 'schemaVersion': NATIVE_TILE_MINIMAP_SCHEMA_VERSION, 'tileId': tile_id,
            'sourceInputs': [{'path': record['path'], 'sha256': record['sha256']} for record in inputs], 'route': route_pin(route_product),
            'zoneKeyTexture': zone_key_texture, 'huntingZones': tile_half['huntingZones'], 'radarTexture': None, 'projection': None, 'gaps': gaps,
            'labels': {'schemaFieldMeaning': SCHEMA_FIELD_MEANING_LABEL}}


def require_current_route(project_root, client_root, converter):
    route = current_minimap_route(project_root)
    if route.product is None:
        run_minimap_route_step(project_root, client_root, converter)
        route = current_minimap_route(project_root)
    if route.product is None:
        raise MinimapStepError('the minimap route unit did not seal')
    return route


def run_minimap_step(project_root, client_root, tile_id, sources=None, converter=None):
    require_tile_id(tile_id)
    census_row = read_tile_census_row(project_root, tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    if census_row['status'] == GAP_STATUS:
        return tile_step_row(tile_id, MINIMAP_STEP_NAME, GAP_STATUS, census_row['reason'], source_identity, TILE_CENSUS_RELATIVE_PATH)
    ledger, unit_key = minimap_ledger(project_root), tile_unit_key(tile_id)
    step_directory = ledger.unit_step_directory(unit_key)
    failed_upstream, upstream = upstream_sealed_fingerprints(project_root, tile_id, lock_record)
    if failed_upstream is not None:
        return upstream_failed_row(tile_id, MINIMAP_STEP_NAME, source_identity, failed_upstream, step_directory.relative_to(ledger.lane_folder).as_posix())
    config, chunk_plan = upstream
    inputs = minimap_input_records(tile_id)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if current_minimap_receipt(ledger, unit_key, config, inputs) is not None and current_minimap_route(project_root).product is not None:
        return tile_minimap_row(tile_id, source_identity, json.loads(minimap_product_path(ledger, unit_key).read_text(encoding='utf-8'))['gapRows'],
                                receipt_evidence)
    client = Path(client_root).resolve()
    route = require_current_route(project_root, client, converter)
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    sources = sources or read_minimap_sources(client)
    route_manifest_path = store_root / route.product['manifest']['resource'].removeprefix('/l2/')
    tile_half = join_tile_route_half(tile_id, tile_frame_extent(chunk_plan['frame']), sources.packages[ZONE_NAME_PACKAGE_ROLE],
                                     {ZONENAME_TABLE_ROLE: sources.tables[ZONENAME_TABLE_ROLE], HUNTINGZONE_TABLE_ROLE: sources.tables[HUNTINGZONE_TABLE_ROLE]},
                                     overlapping_run_tile_ids(route_manifest_path))
    zone_key_texture, texture_outputs, conversion_gaps = converted_zone_key_texture(project_root, client, store_root, sources, tile_half['zoneKeyTexture'],
                                                                                    converter)
    manifest = minimap_manifest(tile_id, inputs, route.product, tile_half, zone_key_texture, [*route.product['gaps'], *tile_half['gaps'], *conversion_gaps])
    gaps = TileStepGapRows(tile_id, MINIMAP_STEP_NAME, source_identity, receipt_evidence)
    for gap in manifest['gaps']:
        gaps.add(GAP_STATUS, gap['reason'], gap['evidence'])
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    manifest_record, manifest_output = write_tile_json_resource(store_root, MINIMAP_STORE_FOLDER, MINIMAP_MANIFEST_NAME, manifest)
    gap_rows = gaps.rows()
    product_payload = json_bytes({'tileId': tile_id, 'manifest': manifest_record, 'gapRows': gap_rows})
    product_path = products_directory / MINIMAP_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [*sorted([manifest_output, *texture_outputs], key=lambda record: record['path']),
               {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)}]
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_minimap_row(tile_id, source_identity, gap_rows, receipt_evidence)
