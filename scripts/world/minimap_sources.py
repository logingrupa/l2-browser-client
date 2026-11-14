import re
from typing import NamedTuple

from native_catalog.tables import decode_table
from native_store.unit_ledger import process_reference_client_lock
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from world.minimap_join import HUNTINGZONE_TABLE_ROLE, ZONE_NAME_PACKAGE_ROLE, ZONENAME_TABLE_ROLE
from world.terrain_coordinates import calculated_coords, coords_point

MINIMAP_TILE_PACKAGE_PATHS = {ZONE_NAME_PACKAGE_ROLE: 'systextures/l2zonename.utx'}
MINIMAP_TABLE_PATHS = {ZONENAME_TABLE_ROLE: 'system/zonename-e.dat', HUNTINGZONE_TABLE_ROLE: 'system/huntingzone-e.dat'}
MINIMAP_TABLE_LAYOUTS = {ZONENAME_TABLE_ROLE: 'zonename', HUNTINGZONE_TABLE_ROLE: 'huntingzone'}
LOCKED_TILE_MAP_PATTERN = re.compile(r'^maps/(?P<tile_id>\d{2}_\d{2})\.unr$')
LOCK_EQUAL_CLASS = 'equal'


class MinimapSourceError(ValueError):
    pass


class MinimapSources(NamedTuple):
    packages: dict
    tables: dict


def lock_equal_minimap_source_paths(lock_path=REFERENCE_CLIENT_LOCK_PATH):
    lock = process_reference_client_lock(lock_path)
    paths = [*MINIMAP_TILE_PACKAGE_PATHS.values(), *MINIMAP_TABLE_PATHS.values()]
    return sorted(path for path in paths if (record := lock.record(path)) is not None and record['class'] == LOCK_EQUAL_CLASS)


def locked_tile_ids(lock_path=REFERENCE_CLIENT_LOCK_PATH):
    lock = process_reference_client_lock(lock_path)
    return sorted(match['tile_id'] for path in lock.records_by_path if (match := LOCKED_TILE_MAP_PATTERN.fullmatch(path)))


def decoded_table_rows(client, role):
    decoded = decode_table(client, MINIMAP_TABLE_LAYOUTS[role])
    if decoded['source'] != MINIMAP_TABLE_PATHS[role]:
        raise MinimapSourceError(f'{role} layout decoded {decoded["source"]}, not {MINIMAP_TABLE_PATHS[role]}')
    record_lists = [value for value in decoded['data'].values() if isinstance(value, list)]
    if len(record_lists) != 1:
        raise MinimapSourceError(f'decoded {decoded["source"]} has {len(record_lists)} record lists, expected 1')
    return {'table': MINIMAP_TABLE_LAYOUTS[role], 'path': decoded['source'], 'sha256': decoded['sourceSha256'], 'rows': record_lists[0]}


def tile_frame_extent(chunk_plan_frame):
    width, height = chunk_plan_frame['heightmapDimensions']
    coordinates = calculated_coords(chunk_plan_frame['location'], chunk_plan_frame['terrainScale'], width, height)
    first_corner = coords_point(coordinates, [0, 0, coordinates['origin'][2]])
    last_corner = coords_point(coordinates, [width - 1, height - 1, coordinates['origin'][2]])
    return {'frameMinimumNative': [min(first_corner[axis], last_corner[axis]) for axis in (0, 1)],
            'frameMaximumNative': [max(first_corner[axis], last_corner[axis]) for axis in (0, 1)]}
