from __future__ import annotations

from functools import partial
import json

from build_dat_table_inventory import DEFAULT_INVENTORY_OUTPUT_PATH
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number
from native_store.coverage_denominators import (COVERAGE_PART_ORDER, NO_COMMITTED_DENOMINATOR_SOURCE, TILE_CENSUS_PATH, CoverageReportError,
                                                inventory_table_count_denominator, read_dat_table_inventory, repository_relative_text,
                                                require_catalog_key, table_denominator, unknown_denominator, world_denominator)
from native_store.data_ui_table_manifest import DATA_UI_LANE_NAME, DataUiTableManifestError, data_ui_table_manifest
from native_store.gap_census_derived_parts import derived_tile_denominator
from native_store.gap_census import ETCITEM_TABLE_NAME, ITEMNAME_TABLE_NAME, ITEMS_PART, GapCensusIncompleteError, item_census_rows
from native_store.store_paths import REPOSITORY_ROOT, read_lane_parts_by_name
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

ACTOR_UNIT_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'npcs' / 'actor-unit-census.json'
INTERFACE_WINDOW_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'ui' / 'interface-window-census.json'
DECODED_ITEM_ID_FIELDS = {ITEMNAME_TABLE_NAME: ('item_name', 'id'), ETCITEM_TABLE_NAME: ('item', 'object_id')}
WINDOW_CENSUS_SCHEMA_VERSION = 1


def measured_part_names(lane_names):
    parts_by_lane_name = read_lane_parts_by_name()
    lane_parts = {part for lane_name in lane_names for part in parts_by_lane_name[lane_name]}
    return tuple(part for part in COVERAGE_PART_ORDER if part in lane_parts)


def read_committed_json(path, label):
    try:
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=refuse_duplicate_json_keys,
                          parse_constant=refuse_non_finite_json_number)
    except (OSError, CatalogWriteError, ValueError) as error:
        raise CoverageReportError(f'{label} is unreadable: {repository_relative_text(path)}: {error}') from error


def inventory_table_key_denominator():
    return table_denominator(read_dat_table_inventory(DEFAULT_INVENTORY_OUTPUT_PATH), DEFAULT_INVENTORY_OUTPUT_PATH)


def inventory_record_count_denominator(table_name):
    return inventory_table_count_denominator(read_dat_table_inventory(DEFAULT_INVENTORY_OUTPUT_PATH), DEFAULT_INVENTORY_OUTPUT_PATH,
                                             table_name)


def actor_census_table_denominator(table_name):
    actor_census = read_committed_json(ACTOR_UNIT_CENSUS_PATH, 'actor unit census')
    tables = actor_census.get('tables') if isinstance(actor_census, dict) else None
    rows = [row for row in tables if isinstance(row, dict) and row.get('table') == table_name] if isinstance(tables, list) else []
    if len(rows) != 1 or not (type(rows[0].get('rowCount')) is int and rows[0]['rowCount'] >= 0):
        raise CoverageReportError(f'actor unit census needs one {table_name} table row with a rowCount: '
                                  f'{repository_relative_text(ACTOR_UNIT_CENSUS_PATH)}')
    return {'count': rows[0]['rowCount'], 'keys': None,
            'source': f'{repository_relative_text(ACTOR_UNIT_CENSUS_PATH)} {table_name} rowCount ({rows[0].get("path")})'}


def committed_window_denominator():
    window_census = read_committed_json(INTERFACE_WINDOW_CENSUS_PATH, 'window census')
    windows = window_census.get('windows') if isinstance(window_census, dict) else None
    if not (isinstance(windows, list) and window_census.get('schemaVersion') == WINDOW_CENSUS_SCHEMA_VERSION
            and type(window_census.get('rootWindowCount')) is int and all(isinstance(window, dict) for window in windows)):
        raise CoverageReportError(f'window census needs schemaVersion {WINDOW_CENSUS_SCHEMA_VERSION}, a rootWindowCount and window objects: '
                                  f'{repository_relative_text(INTERFACE_WINDOW_CENSUS_PATH)}')
    keys = [require_catalog_key(f'window:{window.get("windowId")}', 'window', 'window census windowId') for window in windows]
    if len(set(keys)) != len(keys):
        raise CoverageReportError(f'window census repeats a windowId: {repository_relative_text(INTERFACE_WINDOW_CENSUS_PATH)}')
    return {'count': window_census['rootWindowCount'], 'keys': tuple(sorted(keys)),
            'source': f'{repository_relative_text(INTERFACE_WINDOW_CENSUS_PATH)} rootWindowCount and windows[].windowId'}


PART_DENOMINATOR_LOADERS = {
    'data': inventory_table_key_denominator,
    'world': partial(world_denominator, REFERENCE_CLIENT_LOCK_PATH, TILE_CENSUS_PATH),
    'player-characters': partial(actor_census_table_denominator, 'chargrp'),
    'ui': committed_window_denominator,
    'npcs': partial(actor_census_table_denominator, 'npcgrp'),
    'items': partial(inventory_record_count_denominator, ITEMNAME_TABLE_NAME),
    'skills-effects': partial(inventory_record_count_denominator, 'skillgrp'),
    'minimap': partial(derived_tile_denominator, 'minimap'),
}


def load_census_denominators(lane_names):
    return {part: PART_DENOMINATOR_LOADERS[part]() if part in PART_DENOMINATOR_LOADERS else unknown_denominator(NO_COMMITTED_DENOMINATOR_SOURCE)
            for part in measured_part_names(lane_names)}


def census_item_table_manifest(project_root, table_name):
    try:
        manifest = data_ui_table_manifest(project_root, table_name)
    except DataUiTableManifestError as error:
        raise GapCensusIncompleteError(f'part {ITEMS_PART}: {error}') from error
    if manifest is None:
        raise GapCensusIncompleteError(f'part {ITEMS_PART}: the {DATA_UI_LANE_NAME} lane catalog needs one decoded {table_name} table record')
    return manifest


def decoded_item_ids(manifest, table_name):
    list_field, id_field = DECODED_ITEM_ID_FIELDS[table_name]
    records = manifest['records'].get(list_field)
    if not (isinstance(records, list) and all(isinstance(record, dict) and id_field in record for record in records)):
        raise GapCensusIncompleteError(f'part {ITEMS_PART}: decoded {table_name} records.{list_field} must list objects with {id_field}')
    return [record[id_field] for record in records]


def census_item_join_rows(project_root, weapon_and_armor_rows):
    manifests = {table_name: census_item_table_manifest(project_root, table_name) for table_name in DECODED_ITEM_ID_FIELDS}
    sources = {table_name: {'path': manifest['sourcePath'], 'sha256': manifest['sourceSha256']} for table_name, manifest in manifests.items()}
    return item_census_rows(decoded_item_ids(manifests[ITEMNAME_TABLE_NAME], ITEMNAME_TABLE_NAME), weapon_and_armor_rows,
                            decoded_item_ids(manifests[ETCITEM_TABLE_NAME], ETCITEM_TABLE_NAME), sources)
