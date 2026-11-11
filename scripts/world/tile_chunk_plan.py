import hashlib
import json
from pathlib import Path
from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError, ReferenceClientClassScripts, read_class_defaults_with_provenance
from native_catalog.ue2 import FormatError, Package
from native_store.canonical_json import canonical_json_bytes
from native_store.store_paths import lane_work_root
from native_store.tile_manifest_validation import CHUNK_SECTOR_SPAN
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.map_actor_properties import property_value
from world.map_sources import require_lock_equal_client_path
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import (PRODUCTS_FOLDER_NAME, RawMapStepError, raw_map_ledger, raw_map_unit_fingerprint, read_tile_map_lock_record,
                                require_tile_id, tile_map_path, tile_step_row, tile_unit_key)
from world.terrain_coordinates import SOURCE_TO_GLTF, xyz
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS

CHUNK_PLAN_STEP_ALGORITHM_VERSION = 1
CHUNK_PLAN_STEP_NAME = 'chunks'
CHUNK_PLAN_PRODUCT_NAME = 'chunk-plan.json'
PLAYER_START_CLASS = 'Engine.PlayerStart'
PLAYER_START_ENABLED_FIELD = 'bEnabled'
PLAYER_START_ENABLED_UNRESOLVED_REASON = f'actor-default-unresolved:{PLAYER_START_ENABLED_FIELD}'
PLAYER_START_LOCATION_UNRESOLVED_REASON = 'actor-default-unresolved:Location'
PLAYER_START_MISSING_REASON = 'player-start-missing'
TERRAIN_HEIGHT_PACKAGE_MISSING_REASON = 'terrain-height-package-missing'


class ChunkPlanStepError(ValueError):
    pass


class ChunkPlanUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    raw_products: Path


def chunk_identifier(column, row):
    return f'chunk-{column}-{row}'


def player_start_enabled_tag(actor):
    return property_value(actor['properties'], PLAYER_START_ENABLED_FIELD)


def first_enabled_player_start(actors, class_defaults):
    player_starts = sorted((actor for actor in actors if actor['classObject'] == PLAYER_START_CLASS), key=lambda actor: actor['exportIndex'])
    for actor in player_starts:
        enabled = player_start_enabled_tag(actor)
        if enabled is None:
            if PLAYER_START_ENABLED_FIELD not in class_defaults:
                return None, PLAYER_START_ENABLED_UNRESOLVED_REASON
            enabled = class_defaults[PLAYER_START_ENABLED_FIELD]
        if type(enabled) is not bool:
            raise FormatError(f'{actor["object"]} {PLAYER_START_ENABLED_FIELD} is not a boolean: {enabled!r}')
        if enabled:
            return actor, None
    return None, PLAYER_START_MISSING_REASON


def native_sector_axes(native):
    columns = sorted({sector['offset'][0] for sector in native['sectors']})
    rows = sorted({sector['offset'][1] for sector in native['sectors']})
    if len(columns) * len(rows) != len(native['sectors']) or (len(columns), len(rows)) != (native['sectorsX'], native['sectorsY']):
        raise FormatError('Native terrain sectors do not form a complete sector grid')
    return columns, rows


def tile_chunk_records(native, columns, rows):
    sectors_by_offset = {tuple(sector['offset']): sector for sector in native['sectors']}
    chunks = []
    for column in range((len(columns) + CHUNK_SECTOR_SPAN - 1) // CHUNK_SECTOR_SPAN):
        for row in range((len(rows) + CHUNK_SECTOR_SPAN - 1) // CHUNK_SECTOR_SPAN):
            first_column, first_row = column * CHUNK_SECTOR_SPAN, row * CHUNK_SECTOR_SPAN
            last_column = min(first_column + CHUNK_SECTOR_SPAN, len(columns)) - 1
            last_row = min(first_row + CHUNK_SECTOR_SPAN, len(rows)) - 1
            sector_objects = [sectors_by_offset[(columns[x], rows[y])]['object']
                              for y in range(first_row, last_row + 1) for x in range(first_column, last_column + 1)]
            chunks.append({'chunkId': chunk_identifier(column, row), 'column': column, 'row': row,
                           'sectorRange': {'firstColumn': first_column, 'lastColumn': last_column, 'firstRow': first_row, 'lastRow': last_row},
                           'sectorRectangle': {'minOffset': [columns[first_column], rows[first_row]],
                                               'maxOffset': [columns[last_column], rows[last_row]]},
                           'sectorObjects': sector_objects})
    return sorted(chunks, key=lambda chunk: (chunk['column'], chunk['row']))


def serialized_location(actor):
    location = actor['sourceTransform']['Location']
    return xyz(location['value']) if location['status'] == 'serialized' else None


def tile_anchor(player_start_selection):
    player_start, gap_reason = player_start_selection
    if player_start is None:
        return None, {'reason': gap_reason}
    location = serialized_location(player_start)
    if location is None:
        return None, {'reason': PLAYER_START_LOCATION_UNRESOLVED_REASON}
    return {'playerStart': player_start['object'], 'location': location}, None


def plan_tile_chunks(tile_id, native, terrain_record, actors, player_start_selection):
    terrain_actor = next(actor for actor in actors if actor['id'] == terrain_record['id'])
    terrain_location = serialized_location(terrain_actor)
    if terrain_location is None or terrain_actor['object'] != native['object']:
        raise FormatError('TerrainInfo location or identity differs from the native terrain export')
    columns, rows = native_sector_axes(native)
    anchor, anchor_gap = tile_anchor(player_start_selection)
    return {'tileId': tile_id,
            'frame': {'terrainInfo': native['object'], 'location': terrain_location, 'terrainScale': xyz(terrain_record['terrainScale']),
                      'heightmapDimensions': [native['width'], native['height']], 'sectorGrid': [len(columns), len(rows)],
                      'sourceToGltf': SOURCE_TO_GLTF},
            'anchor': anchor, 'anchorGap': anchor_gap, 'chunks': tile_chunk_records(native, columns, rows)}


def raw_unit_fingerprint(project_root, tile_id, lock_record):
    raw_ledger = raw_map_ledger(project_root)
    fingerprint = raw_map_unit_fingerprint(project_root, tile_map_path(tile_id), lock_record)
    if not raw_ledger.is_sealed(tile_unit_key(tile_id), fingerprint):
        raise ChunkPlanStepError(f'raw unit of {tile_unit_key(tile_id)} is not sealed; run --step raw first')
    return fingerprint, raw_ledger.unit_step_directory(tile_unit_key(tile_id)) / PRODUCTS_FOLDER_NAME


def chunk_plan_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), CHUNK_PLAN_STEP_NAME, CHUNK_PLAN_STEP_ALGORITHM_VERSION)


def chunk_plan_unit_config(raw_fingerprint):
    return {'rawFingerprint': raw_fingerprint}


def chunk_plan_unit(project_root, tile_id, lock_record):
    raw_fingerprint, raw_products = raw_unit_fingerprint(project_root, tile_id, lock_record)
    ledger = chunk_plan_ledger(project_root)
    config = chunk_plan_unit_config(raw_fingerprint)
    return ChunkPlanUnit(ledger, tile_unit_key(tile_id), ledger.unit_fingerprint([lock_record['eSha256']], config), config, raw_products)


def sealed_chunk_plan(project_root, tile_id, lock_record):
    unit = chunk_plan_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        raise ChunkPlanStepError(f'chunk plan of {unit.unit_key} is not sealed; run --step chunks first')
    plan_path = unit.ledger.unit_step_directory(unit.unit_key) / PRODUCTS_FOLDER_NAME / CHUNK_PLAN_PRODUCT_NAME
    return unit.fingerprint, unit.raw_products, json.loads(plan_path.read_text(encoding='utf-8'))


def read_raw_terrain_record(raw_products):
    terrains = json.loads((raw_products / 'terrain.json').read_text(encoding='utf-8'))
    if not terrains or 'height' not in terrains[0]:
        return None
    return terrains[0]


def read_locked_map_package(client, tile_id, lock_record):
    path = require_lock_equal_client_path(Path(client).resolve(), tile_map_path(tile_id))
    package = Package(path.read_bytes(), path.name)
    if package.source_hash != lock_record['eSha256']:
        raise RawMapStepError(f'{tile_map_path(tile_id)} read bytes differ from its lock eSha256')
    return package


def player_start_class_defaults(client, project_root, actors):
    player_starts = [actor for actor in actors if actor['classObject'] == PLAYER_START_CLASS]
    if all(player_start_enabled_tag(actor) is not None for actor in player_starts):
        return {}
    try:
        values = read_class_defaults_with_provenance(PLAYER_START_CLASS, [PLAYER_START_ENABLED_FIELD], lane_work_root(project_root, WORLD_LANE_NAME),
                                                     ReferenceClientClassScripts(client))
    except (ClassDefaultError, FormatError):
        return {}
    enabled = values[0]
    return {PLAYER_START_ENABLED_FIELD: False if enabled.provenance == 'ue-zero' else enabled.value}


def run_chunk_plan_step(project_root, client, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = chunk_plan_unit(project_root, tile_id, lock_record)
    ledger, unit_key, config, fingerprint, raw_products = unit.ledger, unit.unit_key, unit.config, unit.fingerprint, unit.raw_products
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if ledger.is_sealed(unit_key, fingerprint):
        return tile_step_row(tile_id, CHUNK_PLAN_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
    terrain_record = read_raw_terrain_record(raw_products)
    if terrain_record is None:
        return tile_step_row(tile_id, CHUNK_PLAN_STEP_NAME, GAP_STATUS, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON, source_identity,
                             (raw_products / 'terrain.json').relative_to(ledger.lane_folder).as_posix())
    actors = json.loads((raw_products / 'actors.json').read_text(encoding='utf-8'))
    try:
        native = native_terrain(read_locked_map_package(client, tile_id, lock_record))
        player_start_selection = first_enabled_player_start(actors, player_start_class_defaults(client, project_root, actors))
        plan = plan_tile_chunks(tile_id, native, terrain_record, actors, player_start_selection)
    except FormatError as error:
        return tile_step_row(tile_id, CHUNK_PLAN_STEP_NAME, 'failed', f'decode-failed:{error}', source_identity,
                             step_directory.relative_to(ledger.lane_folder).as_posix())
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    payload = canonical_json_bytes(plan)
    plan_path = products_directory / CHUNK_PLAN_PRODUCT_NAME
    plan_path.write_bytes(payload)
    ledger.seal(unit_key, fingerprint, {
        'config': config, 'inputs': [source_identity], 'gapRows': [],
        'outputs': [{'path': plan_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': hashlib.sha256(payload).hexdigest(),
                     'bytes': len(payload)}]})
    return tile_step_row(tile_id, CHUNK_PLAN_STEP_NAME, 'pass', None, source_identity, receipt_evidence)
