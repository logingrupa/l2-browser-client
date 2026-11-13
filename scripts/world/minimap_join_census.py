from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json

from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes
from world.minimap_join import (HUNTINGZONE_TABLE_ROLE, RADAR_PACKAGE_ROLE, TEXTURE_SOURCE_READABLE_STATUS, TOWN_MAP_PACKAGE_ROLE, ZONE_NAME_PACKAGE_ROLE,
                                ZONENAME_TABLE_ROLE, join_minimap_sources, locked_tile_grid)
from world.minimap_sources import MINIMAP_PACKAGE_PATHS, MINIMAP_TABLE_PATHS, MinimapSources, decoded_table_rows, locked_tile_ids, tile_frame_extent
from world.minimap_textures import read_texture_package_index
from world.raw_map_step import read_tile_map_lock_record
from world.tile_census import reference_tree_lock_sha256
from world.tile_chunk_plan import ChunkPlanStepError, sealed_chunk_plan

MINIMAP_JOIN_CENSUS_SCHEMA_VERSION = 1
MINIMAP_JOIN_CENSUS_RELATIVE_PATH = 'docs/parts/minimap/minimap-join-census.json'
WORLD_MAP_PIECES_PACKAGE_PATH = 'systextures/L2Font-e.utx'
WORLD_MAP_PIECE_NAMES = tuple(f'int_worldmap{number}' for number in range(1, 7))
ELBERA_MINIMAP_CITATION = 'Elbera tools/maps/build_minimap.py at 12c9656'
MINIMAP_CONTROL_TYPE = 'MinimapCtrl'
DATA_SCRIPTS_ROOT = SCRIPTS_ROOT / 'data'
UNAVAILABLE_PREFIX = 'unavailable: '


def read_minimap_sources(client_access):
    packages = {role: read_texture_package_index(client_access.root, path) if client_access.is_in_read_scope(path) else None
                for role, path in MINIMAP_PACKAGE_PATHS.items()}
    tables = {role: decoded_table_rows(client_access.root, role) if client_access.is_in_read_scope(path) else None for role, path in MINIMAP_TABLE_PATHS.items()}
    return MinimapSources(packages, tables)


def extracted_tile_frames(project_root, tile_ids):
    frames = {}
    for tile_id in tile_ids:
        try:
            _, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, read_tile_map_lock_record(tile_id))
        except ChunkPlanStepError:
            continue
        frames[tile_id] = tile_frame_extent(chunk_plan['frame'])
    return frames


def texture_source_label(export):
    texture_source = export['textureSource']
    return texture_source['format'] if texture_source['status'] == TEXTURE_SOURCE_READABLE_STATUS else texture_source['reason']


def package_rows(packages):
    rows = []
    for role, path in MINIMAP_PACKAGE_PATHS.items():
        package = packages[role]
        if package is None:
            rows.append({'role': role, 'path': path, 'lockEqual': False})
            continue
        rows.append({'role': role, 'path': path, 'lockEqual': True, 'sha256': package['sha256'], 'packageVersion': package['packageVersion'],
                     'licensee': package['licensee'], 'textureExportCount': len(package['exports']),
                     'textureSourceCounts': dict(sorted(Counter(texture_source_label(export) for export in package['exports']).items())),
                     'textureExports': [{'object': export['object'], 'textureSource': export['textureSource']} for export in package['exports']]})
    return rows


def table_rows(tables):
    return [{'table': role, 'path': path, 'lockEqual': tables[role] is not None,
             **({} if tables[role] is None else {'sha256': tables[role]['sha256'], 'rowCount': len(tables[role]['rows'])})}
            for role, path in MINIMAP_TABLE_PATHS.items()]


def world_map_pieces(world_map_package):
    if world_map_package is None:
        return {'path': WORLD_MAP_PIECES_PACKAGE_PATH, 'lockEqual': False, 'citation': ELBERA_MINIMAP_CITATION, 'pieces': []}
    names = {export['name'].casefold(): export['object'] for export in world_map_package['exports']}
    return {'path': WORLD_MAP_PIECES_PACKAGE_PATH, 'lockEqual': True, 'sha256': world_map_package['sha256'], 'citation': ELBERA_MINIMAP_CITATION,
            'usedByJoin': False, 'pieces': [names[name.casefold()] for name in WORLD_MAP_PIECE_NAMES if name.casefold() in names]}


def census_tile_row(tile):
    radar_texture = tile['radarTexture']
    return {'tileId': tile['tileId'], 'status': tile['status'], 'reason': tile['gaps'][0]['reason'] if tile['gaps'] else None,
            'gapReasons': [gap['reason'] for gap in tile['gaps']],
            'radarTexture': None if radar_texture is None else {'object': radar_texture['object'], 'rule': radar_texture['rule']},
            'zoneIds': [zone['id'] for zone in tile['zones']], 'huntingZoneIds': [zone['id'] for zone in tile['huntingZones']],
            'zoneNameTextures': [item['object'] for item in tile['zoneNameTextures']], 'townMapTextures': [item['object'] for item in tile['townMapTextures']],
            'projection': None if tile['projection'] is None else {'rule': tile['projection']['rule'], 'status': tile['projection']['status']}}


def minimap_join_census(lock_sha256, sources, tile_ids, tile_frames, world_map_pieces_row, minimap_controls):
    joined = join_minimap_sources(tile_ids, tile_frames, sources.packages[RADAR_PACKAGE_ROLE], sources.packages[TOWN_MAP_PACKAGE_ROLE],
                                  sources.packages[ZONE_NAME_PACKAGE_ROLE], sources.tables[ZONENAME_TABLE_ROLE], sources.tables[HUNTINGZONE_TABLE_ROLE],
                                  locked_tile_grid(tile_ids))
    tiles = [census_tile_row(tile) for tile in joined['tiles']]
    return {'schemaVersion': MINIMAP_JOIN_CENSUS_SCHEMA_VERSION, 'referenceTreeLockSha256': lock_sha256, 'algorithmVersion': joined['algorithmVersion'],
            'lockedGrid': joined['lockedGrid'], 'zoneRowsOutsideGrid': joined['zoneRowsOutsideGrid'], 'packages': package_rows(sources.packages),
            'tables': table_rows(sources.tables), 'ruleMatchCounts': joined['ruleMatchCounts'],
            'statusCounts': dict(sorted(Counter(tile['status'] for tile in tiles).items())),
            'gapReasonCounts': dict(sorted(Counter(reason for tile in tiles for reason in tile['gapReasons']).items())),
            'tilesWithFrame': len(tile_frames), 'worldMapPieces': world_map_pieces_row, 'minimapControls': minimap_controls, 'tiles': tiles}


def minimap_join_census_bytes(census):
    return (json.dumps(census, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')


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


def build_minimap_join_census(client_access):
    tile_ids = locked_tile_ids()
    lock_equal = client_access.is_in_read_scope(WORLD_MAP_PIECES_PACKAGE_PATH)
    world_map_package = read_texture_package_index(client_access.root, WORLD_MAP_PIECES_PACKAGE_PATH) if lock_equal else None
    return minimap_join_census(reference_tree_lock_sha256(client_access.lock.document), read_minimap_sources(client_access), tile_ids,
                               extracted_tile_frames(REPOSITORY_ROOT, tile_ids), world_map_pieces(world_map_package), decoded_minimap_controls(client_access))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Census the exact-name minimap join of every locked tile into a tracked doc.')
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
