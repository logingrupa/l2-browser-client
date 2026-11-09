from __future__ import annotations

import json
from pathlib import Path
import re

from build_dat_table_inventory import validate_dat_table_inventory
from native_store.gap_rows import CATALOG_KEY_PATTERNS
from native_store.store_paths import REPOSITORY_ROOT
from reference_client_guard import ReferenceClientLockError, read_reference_client_lock
from world.tile_census_validation import NON_TILE_KIND, TILE_CENSUS_RELATIVE_PATH, TILE_KIND, TileCensusError, validate_tile_census

COVERAGE_PART_ORDER = ('data', 'sandbox', 'world', 'player-characters', 'ui', 'npcs', 'items', 'skills-effects', 'audio', 'minimap',
                       'movement-geodata')
UNKNOWN_DENOMINATOR = 'unknown'
NO_COMMITTED_DENOMINATOR_SOURCE = 'no committed denominator yet'
WORLD_MAP_PATH_PATTERN = re.compile(r'^maps/(?P<name>[^/]+)\.unr$')
TILE_MAP_NAME_PATTERN = re.compile(r'^\d{2}_\d{2}$')
TILE_CENSUS_PATH = REPOSITORY_ROOT / TILE_CENSUS_RELATIVE_PATH


class CoverageReportError(ValueError):
    pass


def repository_relative_text(path):
    path = Path(path).absolute()
    return path.relative_to(REPOSITORY_ROOT).as_posix() if path.is_relative_to(REPOSITORY_ROOT) else path.as_posix()


def read_dat_table_inventory(inventory_path):
    try:
        inventory = json.loads(Path(inventory_path).read_text(encoding='utf-8'))
        return validate_dat_table_inventory(inventory)
    except (KeyError, TypeError, ValueError) as error:
        raise CoverageReportError(f'dat table inventory is not a valid inventory: {inventory_path}: {error}') from error


def require_catalog_key(key, kind, source):
    if not CATALOG_KEY_PATTERNS[kind].fullmatch(key):
        raise CoverageReportError(f'{source} gives {key!r}, which is not a {kind} catalog key')
    return key


def table_denominator(inventory, inventory_path):
    keys = tuple(sorted(require_catalog_key(f'table:{row["table"]}', 'table', 'inventory table name') for row in inventory['rows']))
    return {'count': len(keys), 'keys': keys,
            'source': f'{repository_relative_text(inventory_path)} rows (descriptorSha256 {inventory["descriptorSha256"]})'}


def read_tile_census(tile_census_path):
    try:
        return validate_tile_census(json.loads(Path(tile_census_path).read_text(encoding='utf-8')))
    except (TileCensusError, ValueError) as error:
        raise CoverageReportError(f'tile census is not a valid committed census: {tile_census_path}: {error}') from error


def locked_tile_keys(lock_path):
    try:
        lock = read_reference_client_lock(Path(lock_path))
    except (ReferenceClientLockError, ValueError) as error:
        raise CoverageReportError(f'reference client lock is unreadable: {lock_path}: {error}') from error
    tile_keys = []
    for path in lock.records_by_path:
        match = WORLD_MAP_PATH_PATTERN.fullmatch(path)
        if match is not None and TILE_MAP_NAME_PATTERN.fullmatch(match['name']):
            tile_keys.append(require_catalog_key(f'tile:{match["name"]}', 'tile', path))
    return sorted(tile_keys)


def world_denominator(lock_path, tile_census_path):
    tile_keys = locked_tile_keys(lock_path)
    census_rows = read_tile_census(tile_census_path)['maps']
    if sorted(row['key'] for row in census_rows if row['kind'] == TILE_KIND) != tile_keys:
        raise CoverageReportError(f'tile census {repository_relative_text(tile_census_path)} lists other tiles than the lock '
                                  f'{repository_relative_text(lock_path)}')
    map_keys = [require_catalog_key(row['key'], 'map', repository_relative_text(tile_census_path))
                for row in census_rows if row['kind'] == NON_TILE_KIND]
    keys = tuple(sorted(tile_keys + map_keys))
    return {'count': len(keys), 'keys': keys,
            'source': (f'{repository_relative_text(lock_path)} maps/XX_YY.unr ({len(tile_keys)} tiles) and '
                       f'{repository_relative_text(tile_census_path)} non-tile rows ({len(map_keys)} maps)')}


def inventory_table_count_denominator(inventory, inventory_path, table_name):
    row = next((row for row in inventory['rows'] if row['table'] == table_name), None)
    if row is None:
        raise CoverageReportError(f'dat table inventory has no {table_name} row: {inventory_path}')
    source = f'{repository_relative_text(inventory_path)} {table_name} recordCount'
    if row['countSource'] is not None:
        source += f' (countSource: {row["countSource"]})'
    return {'count': row['recordCount'], 'keys': None, 'source': source}


def unknown_denominator(source):
    return {'count': UNKNOWN_DENOMINATOR, 'keys': None, 'source': source}
