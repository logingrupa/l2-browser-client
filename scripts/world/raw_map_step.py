import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import NamedTuple

import reference_client_guard
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from world.raw_map_extraction import build_map
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.map_sources import safe_path
from world.tile_census import WORLD_LANE_NAME, WORLD_PART_NAME
from world.tile_census_validation import ELIGIBLE_STATUS, GAP_STATUS, NON_TILE_KIND, TILE_CENSUS_RELATIVE_PATH

RAW_MAP_STEP_ALGORITHM_VERSION = 2
RAW_STEP_NAME = 'raw'
RAW_MAP_RECIPE_SCHEMA_VERSION = 1
RAW_MAP_RECIPE_KIND = 'native-map-raw'
TILE_ID_PATTERN = re.compile(r'^\d{2}_\d{2}$')
PRODUCTS_FOLDER_NAME = 'products'
SOURCE_DEPENDENCIES_PRODUCT_NAME = 'source-dependencies.json'
LOCK_EQUAL_CLASS = 'equal'
NON_TILE_KEY_PREFIX = 'map:'
MAP_FOLDER_NAME = 'maps'


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


class RawMapUnit(NamedTuple):
    key: str
    map_path: str
    census_row: dict


def read_census_rows(project_root):
    census_path = Path(project_root) / TILE_CENSUS_RELATIVE_PATH
    census = json.loads(census_path.read_text(encoding='utf-8'))
    rows = census.get('maps') if isinstance(census, dict) else None
    if not isinstance(rows, list):
        raise RawMapStepError(f'tile census has no maps list: {census_path}')
    return rows


def read_census_row(project_root, unit_key):
    matching_rows = [row for row in read_census_rows(project_root) if isinstance(row, dict) and row.get('key') == unit_key]
    if len(matching_rows) != 1:
        raise RawMapStepError(f'tile census must hold exactly one row for {unit_key}, found {len(matching_rows)}')
    row = matching_rows[0]
    if row.get('status') not in (ELIGIBLE_STATUS, GAP_STATUS):
        raise RawMapStepError(f'tile census row {unit_key} has an unexpected status: {row.get("status")!r}')
    return row


def read_tile_census_row(project_root, tile_id):
    row = read_census_row(project_root, tile_unit_key(tile_id))
    if row.get('map') != tile_map_path(tile_id):
        raise RawMapStepError(f'tile census row {row["key"]} names another map: {row.get("map")!r}')
    return row


def is_non_tile_census_row_of(row, map_name):
    if not (isinstance(row, dict) and row.get('kind') == NON_TILE_KIND and row.get('key') == f'{NON_TILE_KEY_PREFIX}{map_name}'):
        return False
    map_path = PurePosixPath(row.get('map', ''))
    return map_path.parent.as_posix() == MAP_FOLDER_NAME and map_path.stem == map_name


def raw_map_unit(project_root, map_name):
    if isinstance(map_name, str) and TILE_ID_PATTERN.fullmatch(map_name):
        return RawMapUnit(tile_unit_key(map_name), tile_map_path(map_name), read_tile_census_row(project_root, map_name))
    if not isinstance(map_name, str) or not any(is_non_tile_census_row_of(row, map_name) for row in read_census_rows(project_root)):
        raise RawMapStepError(f'map must be a tile id matching {TILE_ID_PATTERN.pattern} or a non-tile map of the tile census: {map_name!r}')
    row = read_census_row(project_root, f'{NON_TILE_KEY_PREFIX}{map_name}')
    return RawMapUnit(row['key'], row['map'], row)


def raw_map_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), RAW_STEP_NAME, RAW_MAP_STEP_ALGORITHM_VERSION)


def raw_map_unit_fingerprint(project_root, map_path, lock_record):
    return raw_map_ledger(project_root).unit_fingerprint([lock_record['eSha256']], map_raw_recipe(map_path, lock_record))


def read_map_lock_record(map_path):
    lock = reference_client_guard.read_reference_client_lock(reference_client_guard.REFERENCE_CLIENT_LOCK_PATH)
    record = lock.record(map_path)
    if record is None:
        raise RawMapStepError(f'reference client lock has no record for {map_path}')
    return record


def read_tile_map_lock_record(tile_id):
    return read_map_lock_record(tile_map_path(tile_id))


def map_raw_recipe(map_path, lock_record):
    return {'schemaVersion': RAW_MAP_RECIPE_SCHEMA_VERSION, 'kind': RAW_MAP_RECIPE_KIND, 'map': map_path, 'sourceSha256': lock_record['eSha256']}


def raw_map_recipe(tile_id, lock_record):
    return map_raw_recipe(tile_map_path(tile_id), lock_record)


def unit_step_row(unit_key, step, status, reason, source_identity, evidence):
    return {'key': unit_key, 'part': WORLD_PART_NAME, 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': source_identity, 'evidence': evidence}


def tile_step_row(tile_id, step, status, reason, source_identity, evidence):
    return unit_step_row(tile_unit_key(tile_id), step, status, reason, source_identity, evidence)


def unsupported_object_gap_rows(unit_key, source_identity, unsupported_objects, evidence):
    return [unit_step_row(unit_key, RAW_STEP_NAME, GAP_STATUS, f'decode-failed:{entry["error"]}', {**source_identity, 'object': entry['object']},
                          evidence)
            for entry in unsupported_objects]


def source_dependency_records(dependencies):
    return [{'path': path, 'sha256': record['sha256'], 'bytes': record['bytes']} for path, record in sorted(dependencies.items())]


def run_raw_map_step(project_root, client, map_name):
    unit = raw_map_unit(project_root, map_name)
    unit_key = unit.key
    lock_record = read_map_lock_record(unit.map_path)
    source_identity = {'path': unit.map_path, 'sha256': lock_record['eSha256']}
    if unit.census_row['status'] == GAP_STATUS:
        return unit_step_row(unit_key, RAW_STEP_NAME, GAP_STATUS, unit.census_row['reason'], source_identity, TILE_CENSUS_RELATIVE_PATH)
    if lock_record['class'] != LOCK_EQUAL_CLASS:
        raise RawMapStepError(f'{unit.map_path} has lock class {lock_record["class"]}, not {LOCK_EQUAL_CLASS}')
    recipe = map_raw_recipe(unit.map_path, lock_record)
    ledger = raw_map_ledger(project_root)
    fingerprint = raw_map_unit_fingerprint(project_root, unit.map_path, lock_record)
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if ledger.is_sealed(unit_key, fingerprint):
        return unit_step_row(unit_key, RAW_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
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
        return unit_step_row(unit_key, RAW_STEP_NAME, 'failed', f'decode-failed:{error}', source_identity,
                             step_directory.relative_to(ledger.lane_folder).as_posix())
    if dependencies[unit.map_path]['sha256'] != lock_record['eSha256']:
        raise RawMapStepError(f'{unit.map_path} read bytes differ from its lock eSha256')
    write_product(SOURCE_DEPENDENCIES_PRODUCT_NAME, json_bytes(source_dependency_records(dependencies)))
    ledger.seal(unit_key, fingerprint, {
        'config': recipe, 'inputs': [source_identity], 'outputs': outputs,
        'gapRows': unsupported_object_gap_rows(unit_key, source_identity, manifest['unsupported'], receipt_evidence)})
    return unit_step_row(unit_key, RAW_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
