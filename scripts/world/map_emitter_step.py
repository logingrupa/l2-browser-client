import json
from pathlib import Path
from typing import NamedTuple

from actors.skill_effect_conversion import read_simulated_emitter_classes
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.map_emitter_records import MapEmitterGap, emitter_actor_exports, read_map_emitter_placement
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_placement import ClassDefaults
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan
from world.tile_json_resource import write_tile_json_resource

MAP_EMITTER_STEP_ALGORITHM_VERSION = 2
MAP_EMITTER_STEP_NAME = 'emitters'
MAP_EMITTERS_PRODUCT_NAME = 'map-emitters.json'
TILE_MAP_EMITTERS_KIND = 'native-tile-map-emitters'
TILE_MAP_EMITTERS_SCHEMA_VERSION = 1
TILE_MAP_EMITTERS_FOLDER = 'map-emitters'
TILE_MAP_EMITTERS_NAME = 'tile-emitters.json'
EMITTER_ACTOR_NOT_EXTRACTED_REASON = 'decode-failed:emitter-actor-not-extracted'


class MapEmitterUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    raw_products: Path


def map_emitter_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MAP_EMITTER_STEP_NAME, MAP_EMITTER_STEP_ALGORITHM_VERSION)


def map_emitter_unit(project_root, tile_id, lock_record):
    chunks_fingerprint, raw_products, _ = sealed_chunk_plan(project_root, tile_id, lock_record)
    inputs = locked_input_records([tile_map_path(tile_id)])
    config = {'chunksFingerprint': chunks_fingerprint, 'simulatedEmitterClasses': sorted(read_simulated_emitter_classes(project_root))}
    ledger = map_emitter_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return MapEmitterUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, raw_products)


def map_emitters_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / MAP_EMITTERS_PRODUCT_NAME


def sealed_map_emitters(project_root, tile_id, lock_record):
    unit = map_emitter_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(map_emitters_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))


def tile_map_emitter_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, MAP_EMITTER_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, MAP_EMITTER_STEP_NAME, 'pass', None, source_identity, evidence)


def map_emitter_gap_row(tile_id, source_identity, evidence, gap):
    return tile_step_row(tile_id, MAP_EMITTER_STEP_NAME, GAP_STATUS, gap.reason, {**source_identity, 'object': gap.object_name}, evidence)


def read_tile_map_emitters(package, actors_by_object, class_defaults, simulated_emitter_classes, tile_id, source_identity, evidence):
    placements, gap_rows = [], []
    for item in emitter_actor_exports(package):
        actor = actors_by_object.get(item['object'])
        if actor is None:
            gap_rows.append(map_emitter_gap_row(tile_id, source_identity, evidence, MapEmitterGap(item['object'], EMITTER_ACTOR_NOT_EXTRACTED_REASON)))
            continue
        placement, actor_gap = read_map_emitter_placement(package, item, actor, class_defaults, simulated_emitter_classes)
        if actor_gap is not None:
            gap_rows.append(map_emitter_gap_row(tile_id, source_identity, evidence, actor_gap))
            continue
        placements.append(placement)
        gap_rows.extend(map_emitter_gap_row(tile_id, source_identity, evidence, gap) for gap in placement.gaps)
    return placements, gap_rows


def tile_map_emitters_manifest(tile_id, lock_record, placements, gap_rows):
    return {'kind': TILE_MAP_EMITTERS_KIND, 'schemaVersion': TILE_MAP_EMITTERS_SCHEMA_VERSION, 'tileId': tile_id,
            'sourceMap': {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']},
            'placements': [placement.record for placement in placements], 'gaps': gap_rows}


def product_placement_entry(placement):
    return {'id': placement.record['id'], 'exportIndex': placement.record['exportIndex'], 'origin': list(placement.origin)}


def run_map_emitter_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = map_emitter_unit(project_root, tile_id, lock_record)
    receipt_evidence = (unit.ledger.unit_step_directory(unit.unit_key) / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        product = json.loads(map_emitters_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))
        return tile_map_emitter_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    class_defaults = ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client))
    actors_by_object = {actor['object']: actor for actor in json.loads((unit.raw_products / 'actors.json').read_text(encoding='utf-8'))}
    placements, gap_rows = read_tile_map_emitters(package, actors_by_object, class_defaults, frozenset(unit.config['simulatedEmitterClasses']), tile_id,
                                                  source_identity, receipt_evidence)
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    outputs, manifest_record = [], None
    if placements:
        manifest_record, manifest_output = write_tile_json_resource(lane_store_root(project_root, WORLD_LANE_NAME), TILE_MAP_EMITTERS_FOLDER,
                                                                    TILE_MAP_EMITTERS_NAME, tile_map_emitters_manifest(tile_id, lock_record, placements, gap_rows))
        outputs.append(manifest_output)
    product = {'tileId': tile_id, 'manifest': manifest_record, 'placements': [product_placement_entry(placement) for placement in placements],
               'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / MAP_EMITTERS_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_map_emitter_row(tile_id, source_identity, gap_rows, receipt_evidence)
