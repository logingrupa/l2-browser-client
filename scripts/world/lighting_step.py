import json
from pathlib import Path
from typing import NamedTuple

from native_assets import MAX_PAYLOAD
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.bsp_lightmaps import read_bsp_lightmaps
from world.bsp_step import sealed_bsp_chunks
from world.bsp_visibility_step import tile_node_ranges
from world.level_model import LevelModelLayoutError, read_level_model
from world.lighting_payload import bsp_lightmap_arrays, typed_payload_byte_count
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import conversion_failure_reason
from world.static_placement_plan import FAILED_STATUS
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan
from world.typed_payload import write_tile_typed_payload_resource

LIGHTING_STEP_ALGORITHM_VERSION = 1
LIGHTING_STEP_NAME = 'lighting'
LIGHTING_PRODUCT_NAME = 'lighting.json'
TILE_LIGHTING_FOLDER = 'native-tile-lighting'
LIGHTING_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'lighting-rules.json'
APPLIED_LIGHTING_RULES = ('lightmap-render-section-texture', 'lightmap-record-layout', 'lightmap-page-layout', 'lightmap-render-vertex-uv',
                          'bsp-lightmap-slot')
LIGHTING_PAYLOAD_TOO_LARGE_REASON = 'lighting-payload-too-large'


class LightingUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    chunk_plan: dict
    bsp: dict


def load_lighting_rules():
    document = json.loads(LIGHTING_RULES_PATH.read_text(encoding='utf-8'))
    rules = {row['id']: row for row in document['rows']}
    missing = [rule for rule in APPLIED_LIGHTING_RULES if rule not in rules]
    if missing:
        raise FormatError(f'recipes/world/lighting-rules.json has no row for the applied rules {missing}')
    return document


def lighting_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), LIGHTING_STEP_NAME, LIGHTING_STEP_ALGORITHM_VERSION)


def lighting_converter_version():
    return f'{Path(__file__).name}:{LIGHTING_STEP_ALGORITHM_VERSION}'


def lighting_unit(project_root, tile_id, lock_record):
    _, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    bsp_fingerprint, bsp = sealed_bsp_chunks(project_root, tile_id, lock_record)
    config = {'bspFingerprint': bsp_fingerprint, 'rulesSha256': sha256_hex(canonical_json_bytes(load_lighting_rules()))}
    inputs = locked_input_records([tile_map_path(tile_id)])
    ledger = lighting_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return LightingUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, chunk_plan, bsp)


def lighting_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / LIGHTING_PRODUCT_NAME


def sealed_lighting(project_root, tile_id, lock_record):
    unit = lighting_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(lighting_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))


def tile_lighting_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, LIGHTING_STEP_NAME, 'pass', None, source_identity, evidence)


def lighting_gap_rows(tile_id, source_identity, evidence, reasons):
    return [tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, reason, source_identity, evidence) for reason in reasons]


def run_lighting_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = lighting_unit(project_root, tile_id, lock_record)
    step_directory = unit.ledger.unit_step_directory(unit.unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    step_evidence = step_directory.relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        product = json.loads(lighting_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))
        return tile_lighting_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    if unit.bsp is None:
        raise FormatError(f'lighting of {unit.unit_key} needs a sealed bsp unit; run --step bsp first')
    package = read_locked_map_package(Path(client_root).resolve(), tile_id, lock_record)
    try:
        model = read_level_model(package).model
        lightmaps = read_bsp_lightmaps(package, model)
        arrays, reasons, counts = bsp_lightmap_arrays(package, lightmaps, model, tile_node_ranges(unit.bsp, unit.chunk_plan))
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except FormatError as error:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity, step_evidence)
    payload_bytes = typed_payload_byte_count(arrays)
    if payload_bytes > MAX_PAYLOAD:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, FAILED_STATUS, LIGHTING_PAYLOAD_TOO_LARGE_REASON, source_identity, step_evidence)
    metadata = {'sourceSha256': lock_record['eSha256'], 'converterVersion': lighting_converter_version()}
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    resource, outputs = write_tile_typed_payload_resource(lane_store_root(project_root, WORLD_LANE_NAME), TILE_LIGHTING_FOLDER, arrays, metadata)
    gap_rows = lighting_gap_rows(tile_id, source_identity, receipt_evidence, reasons)
    product = {'tileId': tile_id, 'resource': resource, 'payloadBytes': payload_bytes, 'bspLightmaps': counts, 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / LIGHTING_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_lighting_row(tile_id, source_identity, gap_rows, receipt_evidence)
