from __future__ import annotations

import json
from pathlib import Path

from build_dat_table_inventory import DEFAULT_INVENTORY_OUTPUT_PATH, validate_dat_table_inventory
from native_store.gap_rows import CATALOG_KEY_PATTERNS
from native_store.store_paths import REPOSITORY_ROOT

COVERAGE_PART_ORDER = ('data', 'sandbox', 'world', 'player-characters', 'ui', 'npcs', 'items', 'skills-effects', 'audio', 'minimap',
                       'movement-geodata')
UNKNOWN_DENOMINATOR = 'unknown'
NO_COMMITTED_DENOMINATOR_SOURCE = 'no committed denominator yet'


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


def table_denominator(inventory, inventory_path):
    keys = tuple(sorted(f'table:{row["table"]}' for row in inventory['rows']))
    for key in keys:
        if not CATALOG_KEY_PATTERNS['table'].fullmatch(key):
            raise CoverageReportError(f'inventory table name does not give a table key: {key}')
    return {'count': len(keys), 'keys': keys,
            'source': f'{repository_relative_text(inventory_path)} rows (descriptorSha256 {inventory["descriptorSha256"]})'}


def unknown_denominator(source):
    return {'count': UNKNOWN_DENOMINATOR, 'keys': None, 'source': source}


def coverage_denominators(inventory_path=DEFAULT_INVENTORY_OUTPUT_PATH):
    inventory = read_dat_table_inventory(inventory_path)
    denominators = {part: unknown_denominator(NO_COMMITTED_DENOMINATOR_SOURCE) for part in COVERAGE_PART_ORDER}
    denominators['data'] = table_denominator(inventory, inventory_path)
    return denominators
