import json
from pathlib import Path

from native_assets import implementation_hash
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_inputs
from world.native_material_listings import publish_native_material_listing, terrain_materials_listing, unique_native_material_files
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.surface_material_programs import (material_outcome_gap_rows, material_package_paths, material_program_outcome, program_root_is_ported,
                                             world_material_sources)
from world.terrain_chunk_step import sealed_terrain_chunks
from world.world_lane_names import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS

TERRAIN_MATERIAL_STEP_ALGORITHM_VERSION = 1
TERRAIN_MATERIAL_STEP_NAME = 'terrain-material'
TERRAIN_MATERIAL_PRODUCT_NAME = 'terrain-materials.json'


class TerrainMaterialStepError(ValueError):
    pass


def terrain_material_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), TERRAIN_MATERIAL_STEP_NAME, TERRAIN_MATERIAL_STEP_ALGORITHM_VERSION)


def terrain_material_unit_config(project_root, tile_id, lock_record):
    terrain_unit, _, _ = sealed_terrain_chunks(project_root, tile_id, lock_record)
    return {'terrainFingerprint': terrain_unit.fingerprint, 'converterSha256': implementation_hash()}


def terrain_material_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / TERRAIN_MATERIAL_PRODUCT_NAME


def sealed_terrain_material(project_root, tile_id, lock_record):
    ledger, unit_key = terrain_material_ledger(project_root), tile_unit_key(tile_id)
    config = terrain_material_unit_config(project_root, tile_id, lock_record)
    receipt = receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config)
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(terrain_material_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_terrain_material_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, TERRAIN_MATERIAL_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, TERRAIN_MATERIAL_STEP_NAME, 'pass', None, source_identity, evidence)


def drawn_terrain_layers(terrain_chunks):
    layer_lists = [chunk['layers'] for chunk in terrain_chunks]
    if any(layers != layer_lists[0] for layers in layer_lists[1:]):
        raise TerrainMaterialStepError('terrain chunks of one tile list different layers')
    return [layer for layer in (layer_lists[0] if layer_lists else []) if not layer['emptySlot']]


def terrain_layer_identities(layers):
    identities = {}
    for layer in layers:
        for identity in (layer['texture'], layer['alphaMap']):
            identities.setdefault(identity.casefold(), identity)
    return sorted(identities.values(), key=lambda identity: (identity.casefold(), identity))


def listed_terrain_layer(layer, outcomes_by_identity):
    texture, alpha_map = (outcomes_by_identity[layer[field].casefold()] for field in ('texture', 'alphaMap'))
    ported = all(outcome.program is not None and program_root_is_ported(outcome.program) for outcome in (texture, alpha_map))
    return {'index': layer['index'], 'texture': layer['texture'], 'textureProgram': texture.program_record, 'alphaMap': layer['alphaMap'],
            'alphaMapProgram': alpha_map.program_record, 'useAlpha': layer['useAlpha'], 'rootsPorted': ported,
            'gapReasons': sorted({*texture.gap_reasons, *alpha_map.gap_reasons})}


def run_terrain_material_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    ledger, unit_key = terrain_material_ledger(project_root), tile_unit_key(tile_id)
    receipt_evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    config = terrain_material_unit_config(project_root, tile_id, lock_record)
    if receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config) is not None:
        product = json.loads(terrain_material_product_path(ledger, unit_key).read_text(encoding='utf-8'))
        return tile_terrain_material_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    _, terrain_chunks, _ = sealed_terrain_chunks(project_root, tile_id, lock_record)
    layers = drawn_terrain_layers(terrain_chunks)
    if not layers:
        raise FormatError(f'terrain-material of {unit_key} has no drawn terrain layer')
    identities = terrain_layer_identities(layers)
    sources = world_material_sources(Path(client_root).resolve(), project_root)
    outcomes = {identity: material_program_outcome(identity, *sources) for identity in identities}
    outcomes_by_identity = {identity.casefold(): outcome for identity, outcome in outcomes.items()}
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *material_package_paths(sources.map_sources, identities)}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    gap_rows = material_outcome_gap_rows(tile_id, TERRAIN_MATERIAL_STEP_NAME, source_identity, receipt_evidence, outcomes)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    material_files = unique_native_material_files(tile_id, [outcome.store_outputs for outcome in outcomes.values()])
    relative_path, payload = terrain_materials_listing(tile_id, [listed_terrain_layer(layer, outcomes_by_identity) for layer in layers], material_files)
    listing, store_records = publish_native_material_listing(store_root, relative_path, payload, material_files)
    product = {'tileId': tile_id, 'listing': listing, 'layerCount': len(layers), 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / TERRAIN_MATERIAL_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [{**record, 'path': (store_root / record['path']).relative_to(store_root.parent).as_posix()} for record in store_records]
    outputs.append({'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_terrain_material_row(tile_id, source_identity, gap_rows, receipt_evidence)
