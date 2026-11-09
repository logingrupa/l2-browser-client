import hashlib
import json
from pathlib import Path
import re

import reference_client_guard
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from world.raw_map_extraction import build_map
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.map_sources import safe_path
from world.tile_census import WORLD_LANE_NAME, WORLD_PART_NAME
from world.tile_census_validation import ELIGIBLE_STATUS, GAP_STATUS, TILE_CENSUS_RELATIVE_PATH

RAW_MAP_STEP_ALGORITHM_VERSION = 2
RAW_STEP_NAME = 'raw'
RAW_MAP_RECIPE_SCHEMA_VERSION = 1
RAW_MAP_RECIPE_KIND = 'native-map-raw'
TILE_ID_PATTERN = re.compile(r'^\d{2}_\d{2}$')
PRODUCTS_FOLDER_NAME = 'products'
SOURCE_DEPENDENCIES_PRODUCT_NAME = 'source-dependencies.json'
LOCK_EQUAL_CLASS = 'equal'


class RawMapStepError(ValueError):
    pass


def require_tile_id(tile_id):
    if not (isinstance(tile_id, str) and TILE_ID_PATTERN.fullmatch(tile_id)):
        raise RawMapStepError(f'tile id must match {TILE_ID_PATTERN.pattern}: {tile_id!r}')
    return tile_id


def tile_unit_key(tile_id):
    return f'tile:{tile_id}'


def tile_map_path(tile_id):
    return f'maps/{tile_id}.unr'


def read_tile_census_row(project_root, tile_id):
    census_path = Path(project_root) / TILE_CENSUS_RELATIVE_PATH
    census = json.loads(census_path.read_text(encoding='utf-8'))
    rows = census.get('maps') if isinstance(census, dict) else None
    if not isinstance(rows, list):
        raise RawMapStepError(f'tile census has no maps list: {census_path}')
    matching_rows = [row for row in rows if isinstance(row, dict) and row.get('key') == tile_unit_key(tile_id)]
    if len(matching_rows) != 1:
        raise RawMapStepError(f'tile census must hold exactly one row for {tile_unit_key(tile_id)}, found {len(matching_rows)}')
    row = matching_rows[0]
    if row.get('status') not in (ELIGIBLE_STATUS, GAP_STATUS) or row.get('map') != tile_map_path(tile_id):
        raise RawMapStepError(f'tile census row {row["key"]} has an unexpected status or map: {row.get("status")!r} {row.get("map")!r}')
    return row


def read_tile_map_lock_record(tile_id):
    lock = reference_client_guard.read_reference_client_lock(reference_client_guard.REFERENCE_CLIENT_LOCK_PATH)
    record = lock.record(tile_map_path(tile_id))
    if record is None:
        raise RawMapStepError(f'reference client lock has no record for {tile_map_path(tile_id)}')
    return record


def raw_map_recipe(tile_id, lock_record):
    return {'schemaVersion': RAW_MAP_RECIPE_SCHEMA_VERSION, 'kind': RAW_MAP_RECIPE_KIND, 'map': tile_map_path(tile_id),
            'sourceSha256': lock_record['eSha256']}


def tile_step_row(tile_id, step, status, reason, source_identity, evidence):
    return {'key': tile_unit_key(tile_id), 'part': WORLD_PART_NAME, 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': source_identity, 'evidence': evidence}


def unsupported_object_gap_rows(tile_id, source_identity, unsupported_objects, evidence):
    return [tile_step_row(tile_id, RAW_STEP_NAME, GAP_STATUS, f'decode-failed:{entry["error"]}', {**source_identity, 'object': entry['object']}, evidence)
            for entry in unsupported_objects]


def source_dependency_records(dependencies):
    return [{'path': path, 'sha256': record['sha256'], 'bytes': record['bytes']} for path, record in sorted(dependencies.items())]


def run_raw_map_step(project_root, client, tile_id):
    require_tile_id(tile_id)
    census_row = read_tile_census_row(project_root, tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    if census_row['status'] == GAP_STATUS:
        return tile_step_row(tile_id, RAW_STEP_NAME, GAP_STATUS, census_row['reason'], source_identity, TILE_CENSUS_RELATIVE_PATH)
    if lock_record['class'] != LOCK_EQUAL_CLASS:
        raise RawMapStepError(f'{tile_map_path(tile_id)} has lock class {lock_record["class"]}, not {LOCK_EQUAL_CLASS}')
    recipe = raw_map_recipe(tile_id, lock_record)
    ledger = UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), RAW_STEP_NAME, RAW_MAP_STEP_ALGORITHM_VERSION)
    unit_key = tile_unit_key(tile_id)
    fingerprint = ledger.unit_fingerprint([lock_record['eSha256']], recipe)
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if ledger.is_sealed(unit_key, fingerprint):
        return tile_step_row(tile_id, RAW_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    outputs = []

    def write_product(relative_path, payload):
        product_path = safe_path(products_directory, relative_path)
        product_path.parent.mkdir(parents=True, exist_ok=True)
        product_path.write_bytes(payload)
        outputs.append({'path': product_path.relative_to(ledger.lane_folder).as_posix(),
                        'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})

    try:
        manifest, dependencies = build_map(Path(client).resolve(), recipe, write_product)
    except FormatError as error:
        return tile_step_row(tile_id, RAW_STEP_NAME, 'failed', f'decode-failed:{error}', source_identity,
                            step_directory.relative_to(ledger.lane_folder).as_posix())
    if dependencies[tile_map_path(tile_id)]['sha256'] != lock_record['eSha256']:
        raise RawMapStepError(f'{tile_map_path(tile_id)} read bytes differ from its lock eSha256')
    write_product(SOURCE_DEPENDENCIES_PRODUCT_NAME, json_bytes(source_dependency_records(dependencies)))
    ledger.seal(unit_key, fingerprint, {
        'config': recipe, 'inputs': [source_identity], 'outputs': outputs,
        'gapRows': unsupported_object_gap_rows(tile_id, source_identity, manifest['unsupported'], receipt_evidence)})
    return tile_step_row(tile_id, RAW_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
