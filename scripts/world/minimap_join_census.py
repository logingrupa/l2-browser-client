from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json
from typing import NamedTuple

from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes
from world.minimap_join import (HUNTINGZONE_TABLE_ROLE, ZONE_NAME_PACKAGE_ROLE, ZONENAME_TABLE_ROLE, join_tile_route_half, join_unresolved_reason)
from world.minimap_radar_route_recipe import read_minimap_radar_route_recipe
from world.minimap_route_step import (EVERY_TILE_OPEN_IDS, RADAR_CASE_RULE, RADAR_DEFAULT_RULE, TEXTURE_ABSENT, WORLD_MAP_PACKAGE_PATH, WORLD_MAP_PIECE_RULE,
                                      route_texture_format, route_textures)
from world.minimap_sources import MINIMAP_TABLE_PATHS, MINIMAP_TILE_PACKAGE_PATHS, decoded_table_rows, locked_tile_ids, tile_frame_extent
from world.minimap_textures import export_named, read_texture_package, texture_package_index
from world.raw_map_step import read_tile_map_lock_record
from world.tile_census import reference_tree_lock_sha256
from world.tile_chunk_plan import ChunkPlanStepError, sealed_chunk_plan
from world.zone_name_keys import zone_key_table

MINIMAP_JOIN_CENSUS_SCHEMA_VERSION = 2
MINIMAP_JOIN_CENSUS_RELATIVE_PATH = 'docs/parts/minimap/minimap-join-census.json'
MINIMAP_CONTROL_TYPE = 'MinimapCtrl'
DATA_SCRIPTS_ROOT = SCRIPTS_ROOT / 'data'
UNAVAILABLE_PREFIX = 'unavailable: '
JOINED_STATUS = 'joined'
GAP_STATUS = 'gap'


class MinimapCensusSources(NamedTuple):
    packages: dict
    route_texture_statuses: dict
    zone_name_package: dict | None
    tables: dict


def package_summary(package_index):
    return {'path': package_index['path'], 'sha256': package_index['sha256'], 'packageVersion': package_index['packageVersion'],
            'licensee': package_index['licensee'], 'textureExportCount': len(package_index['exports'])}


def extracted_tile_frames(project_root, tile_ids):
    frames = {}
    for tile_id in tile_ids:
        try:
            _, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, read_tile_map_lock_record(tile_id))
        except ChunkPlanStepError:
            continue
        frames[tile_id] = tile_frame_extent(chunk_plan['frame'])
    return frames


def route_texture_status(statuses, object_name):
    return statuses.get(object_name, {'reason': join_unresolved_reason(TEXTURE_ABSENT)})


def zonename_rows_with_name(zonename_rows, zone_name):
    return sum(1 for row in zonename_rows if row['Name'].casefold() == zone_name.casefold())


def census_route(recipe, statuses, zonename_rows):
    textures = route_textures(recipe['radar'], recipe['worldMap'])
    cases = [{'zoneName': case['zoneName'], 'texture': object_name, **route_texture_status(statuses, object_name),
              'zonenameRowsWithName': zonename_rows_with_name(zonename_rows, case['zoneName'])}
             for case, (object_name, _) in zip(recipe['radar']['cases'], [texture for texture in textures if texture[1] == RADAR_CASE_RULE])]
    default_object = next(object_name for object_name, rule in textures if rule == RADAR_DEFAULT_RULE)
    pieces = [{'suffix': suffix, 'texture': object_name, **route_texture_status(statuses, object_name)}
              for suffix, (object_name, _) in zip(recipe['worldMap']['initializeMapDisplay']['suffixes'],
                                                  [texture for texture in textures if texture[1] == WORLD_MAP_PIECE_RULE])]
    return {'cases': cases, 'default': {'texture': default_object, **route_texture_status(statuses, default_object)}, 'worldMapPieces': pieces}


def route_gap_reasons(recipe, route):
    open_reasons = {item['id']: item['tileGap'] for item in recipe['open']}
    texture_rows = [*route['cases'], route['default'], *route['worldMapPieces']]
    texture_reasons = sorted({row['reason'] for row in texture_rows if 'reason' in row})
    return [*(open_reasons[open_id] for open_id in EVERY_TILE_OPEN_IDS), *texture_reasons]


def zone_key_summary(zone_keys, tile_ids):
    locked = set(tile_ids)
    return {'rows': len(zone_keys['rows']), 'keys': zone_keys['keyCount'], 'globalKeyRows': zone_keys['globalRowCount'],
            'rowsOutsideLockedTiles': sum(1 for row in zone_keys['rows'] if row['tileId'] is not None and row['tileId'] not in locked),
            'sharedKeys': zone_keys['sharedKeyCount'], 'rowsInSharedKeys': zone_keys['rowsInSharedKeys'], 'overlappingRuns': zone_keys['overlappingRuns']}


def zone_ids_by_key(zone_keys, tile_id):
    ids_by_key = {}
    for row in zone_keys['rows']:
        if row['tileId'] == tile_id:
            ids_by_key.setdefault(str(row['key']), []).append(row['id'])
    return ids_by_key


def census_tile_row_and_gap_reasons(tile_id, frame, sources, zone_keys, overlapping_run_tile_ids, route_reasons):
    tables = {ZONENAME_TABLE_ROLE: sources.tables[ZONENAME_TABLE_ROLE], HUNTINGZONE_TABLE_ROLE: sources.tables[HUNTINGZONE_TABLE_ROLE]}
    tile = join_tile_route_half(tile_id, frame, sources.zone_name_package, tables, overlapping_run_tile_ids)
    tile_reasons = [gap['reason'] for gap in tile['gaps']]
    row = {'tileId': tile_id, 'status': GAP_STATUS if route_reasons or tile_reasons else JOINED_STATUS,
           'zoneKeyTexture': None if tile['zoneKeyTexture'] is None else tile['zoneKeyTexture']['object'],
           'zoneIdsByKey': zone_ids_by_key(zone_keys, tile_id), 'huntingZoneIds': None if frame is None else [zone['id'] for zone in tile['huntingZones']]}
    return row, tile_reasons


def table_rows(tables):
    return [{'table': role, 'path': path, 'lockEqual': tables[role] is not None,
             **({} if tables[role] is None else {'sha256': tables[role]['sha256'], 'rowCount': len(tables[role]['rows'])})}
            for role, path in MINIMAP_TABLE_PATHS.items()]


def minimap_join_census(lock_sha256, recipe_record, sources, tile_ids, tile_frames, minimap_controls):
    recipe = recipe_record['document']
    zonename_rows = [] if sources.tables[ZONENAME_TABLE_ROLE] is None else sources.tables[ZONENAME_TABLE_ROLE]['rows']
    zone_keys = zone_key_table(zonename_rows)
    route = census_route(recipe, sources.route_texture_statuses, zonename_rows)
    route_reasons = route_gap_reasons(recipe, route)
    overlapping_run_tile_ids = {run['tileId'] for run in zone_keys['overlappingRuns'] if run['tileId'] is not None}
    tile_rows = [census_tile_row_and_gap_reasons(tile_id, tile_frames.get(tile_id), sources, zone_keys, overlapping_run_tile_ids, route_reasons)
                 for tile_id in sorted(tile_ids)]
    tiles = [row for row, _ in tile_rows]
    tile_gap_reasons = {row['tileId']: reasons for row, reasons in tile_rows if reasons}
    return {'schemaVersion': MINIMAP_JOIN_CENSUS_SCHEMA_VERSION, 'referenceTreeLockSha256': lock_sha256,
            'recipe': {'path': recipe_record['path'], 'sha256': recipe_record['sha256']}, 'route': route, 'routeGapReasons': route_reasons,
            'zoneKeys': zone_key_summary(zone_keys, tile_ids), 'packages': [sources.packages[path] for path in sorted(sources.packages)],
            'tables': table_rows(sources.tables), 'minimapControls': minimap_controls, 'tilesWithFrame': len(tile_frames),
            'statusCounts': dict(sorted(Counter(tile['status'] for tile in tiles).items())),
            'gapReasonCounts': dict(sorted(Counter(reason for tile in tiles for reason in (*route_reasons, *tile_gap_reasons.get(tile['tileId'], []))).items())),
            'tileGapReasons': tile_gap_reasons, 'tiles': tiles}


def compact_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def census_field_json(value):
    if isinstance(value, list) and value:
        return '[\n  ' + ',\n  '.join(compact_json(item) for item in value) + '\n ]'
    return compact_json(value)


def minimap_join_census_bytes(census):
    fields = ',\n'.join(f' {compact_json(key)}:{census_field_json(census[key])}' for key in sorted(census))
    return ('{\n' + fields + '\n}\n').encode('utf-8')


def decoded_minimap_controls(client_access):
    if str(DATA_SCRIPTS_ROOT) not in sys.path:
        sys.path.insert(0, str(DATA_SCRIPTS_ROOT))
    try:
        from interface_layout_adapter import ELBERA_PARSE_XDAT_PATH, ELBERA_PARSE_XDAT_SHA256, INTERFACE_XDAT_PATH, decode_interface_layout, tree_nodes, \
            window_identifiers
        from pinned_elbera_module import load_pinned_elbera_module
        parse_xdat_module = load_pinned_elbera_module(ELBERA_PARSE_XDAT_PATH, ELBERA_PARSE_XDAT_SHA256)
        layout = decode_interface_layout(client_access.require_equal_file(INTERFACE_XDAT_PATH).read_bytes(), parse_xdat_module)
    except (ImportError, OSError, ValueError) as error:
        return UNAVAILABLE_PREFIX + f'{type(error).__name__}: {error}'
    controls = []
    for window_id, root in zip(window_identifiers(layout.roots), layout.roots):
        names = [node['name'] for node in tree_nodes([root]) if node.get('type') == MINIMAP_CONTROL_TYPE]
        if names:
            controls.append({'windowId': window_id, 'controlNames': names})
    return controls


def client_route_texture_statuses(client, recipe):
    package_paths = {RADAR_CASE_RULE: recipe['radar']['texturePackage'], RADAR_DEFAULT_RULE: recipe['radar']['texturePackage'],
                     WORLD_MAP_PIECE_RULE: WORLD_MAP_PACKAGE_PATH}
    packages, statuses = {}, {}
    for object_name, rule in route_textures(recipe['radar'], recipe['worldMap']):
        relative_path = package_paths[rule]
        if relative_path not in packages:
            package = read_texture_package(client, relative_path)
            packages[relative_path] = (package, texture_package_index(package, relative_path))
        package, index = packages[relative_path]
        index_entry = export_named(index, object_name)
        if index_entry is None:
            continue
        texture_format, rule_or_reason = route_texture_format(package, package.exports[index_entry['exportIndex'] - 1], index_entry, recipe['textureFormat5'])
        statuses[object_name] ={'format': texture_format} if texture_format is not None else {'reason': rule_or_reason}
    return {path: package_summary(index) for path, (_, index) in packages.items()}, statuses


def read_census_sources(client_access, recipe):
    packages, statuses = client_route_texture_statuses(client_access.root, recipe)
    zone_name_path = MINIMAP_TILE_PACKAGE_PATHS[ZONE_NAME_PACKAGE_ROLE]
    zone_name_package = None
    if client_access.is_in_read_scope(zone_name_path):
        zone_name_package = texture_package_index(read_texture_package(client_access.root, zone_name_path), zone_name_path)
        packages[zone_name_path] = package_summary(zone_name_package)
    tables = {role: decoded_table_rows(client_access.root, role) if client_access.is_in_read_scope(path) else None for role, path in MINIMAP_TABLE_PATHS.items()}
    return MinimapCensusSources(packages, statuses, zone_name_package, tables)


def build_minimap_join_census(client_access):
    tile_ids = locked_tile_ids()
    recipe_record = read_minimap_radar_route_recipe()
    return minimap_join_census(reference_tree_lock_sha256(client_access.lock.document), recipe_record, read_census_sources(client_access, recipe_record['document']),
                               tile_ids, extracted_tile_frames(REPOSITORY_ROOT, tile_ids), decoded_minimap_controls(client_access))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Census the verified minimap route and the tile half of every locked tile into a tracked doc.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        run_at_below_normal_priority()
        require_committed_destination(MINIMAP_JOIN_CENSUS_RELATIVE_PATH)
        payload = minimap_join_census_bytes(build_minimap_join_census(client_access))
        write_committed_world_bytes(MINIMAP_JOIN_CENSUS_RELATIVE_PATH, payload)
    except (OSError, ValueError) as error:
        print(f'Minimap join census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': MINIMAP_JOIN_CENSUS_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
