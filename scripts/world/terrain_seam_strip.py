import json
import math
from pathlib import Path
from typing import NamedTuple

import reference_client_guard
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from world.eligible_tiles import read_tile_census, select_eligible_tiles
from world.native_terrain_sectors import vertex_normal
from world.raw_map_step import raw_map_ledger, raw_map_unit_fingerprint, tile_map_path, tile_unit_key
from world.terrain_coordinates import coords_point
from world.terrain_seam_facts import RAW_STEP_PENDING_REASON, facing_edge, sealed_tile_seam_frame, tile_grid_position
from world.tile_census_validation import GAP_STATUS
from world.tile_step_gap_rows import PENDING_STATUS

TERRAIN_SEAM_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes/world/terrain-seam-rules.json'
SEAM_RULE_ROW_FIELDS = {'id', 'value', 'provenance', 'status', 'interludeEvidence', 'runtimeDefault'}
SEAM_RULE_STATUSES = ('ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown')
UNKNOWN_RULE_STATUS = 'unknown'
PORTED_SEAM_RULE_VALUES = {'terrain.seam.render-grid': 'heightmap-plus-one', 'terrain.seam.far-vertex-height': 'neighbour-facing-vertex-z',
                           'terrain.seam.far-vertex-normal': 'own-edge-vertex-normal', 'terrain.seam.strip-quad-visibility': True,
                           'terrain.seam.strip-collision': False}
NEIGHBOUR_MAP_INDEX_RULE_ID = 'terrain.seam.neighbour-map-index'
MAP_INDEX_ORIGIN_OFFSETS = (360448.0, 294912.0)
MAP_INDEX_SCALE = 1 / 32768
MAP_INDEX_BIAS = 9.0
PORTED_MAP_INDEX_RULE_VALUE = {'x': 'trunc((Location.X + 360448) / 32768 + 9)', 'y': 'trunc((Location.Y + 294912) / 32768 + 9)'}
SEAM_ROLE_TILE_STEPS = {'column': (1, 0), 'row': (0, 1), 'corner': (1, 1)}
SEAM_NEIGHBOUR_UNAVAILABLE_REASON_PREFIX = 'terrain-seam-neighbour-unavailable:'
CONVERTED_STATE = 'converted'
ABSENT_STATE = 'absent'
PENDING_STATE = 'pending'
UNAVAILABLE_STATE = 'unavailable'


class TerrainSeamRuleError(ValueError):
    pass


class SeamNeighbour(NamedTuple):
    role: str
    tile_id: str
    state: str
    frame: dict | None


class TerrainSeamStrip(NamedTuple):
    far_heights: dict
    neighbours: tuple


def read_terrain_seam_rules(path=TERRAIN_SEAM_RULES_PATH):
    document = json.loads(Path(path).read_text(encoding='utf-8'))
    rows = document.get('rows') if isinstance(document, dict) and document.get('schemaVersion') == 1 else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) and set(row) == SEAM_RULE_ROW_FIELDS for row in rows):
        raise TerrainSeamRuleError(f'{path} must hold schemaVersion 1 and rows of {sorted(SEAM_RULE_ROW_FIELDS)}')
    rows_by_id = {row['id']: row for row in rows}
    ported_values = {**PORTED_SEAM_RULE_VALUES, NEIGHBOUR_MAP_INDEX_RULE_ID: PORTED_MAP_INDEX_RULE_VALUE}
    if len(rows_by_id) != len(rows) or set(rows_by_id) != set(ported_values):
        raise TerrainSeamRuleError(f'{path} rows must be exactly {sorted(ported_values)}: {sorted(rows_by_id)}')
    for rule_id, value in ported_values.items():
        row = rows_by_id[rule_id]
        if row['status'] not in SEAM_RULE_STATUSES or row['status'] == UNKNOWN_RULE_STATUS:
            raise TerrainSeamRuleError(f'{path} row {rule_id} status {row["status"]!r} does not decide the seam the terrain step ports')
        if row['value'] != value or row['runtimeDefault'] != value:
            raise TerrainSeamRuleError(f'{path} row {rule_id} value {row["value"]!r} is not the ported {value!r}')
    return rows_by_id


def terrain_seam_rules_sha256(path=TERRAIN_SEAM_RULES_PATH):
    read_terrain_seam_rules(path)
    return sha256_hex(canonical_json_bytes(json.loads(Path(path).read_text(encoding='utf-8'))))


def terrain_map_index(location):
    return tuple(math.trunc((location[axis] + MAP_INDEX_ORIGIN_OFFSETS[axis]) * MAP_INDEX_SCALE + MAP_INDEX_BIAS) for axis in (0, 1))


def neighbour_tile_id(tile_id, role):
    column, row = tile_grid_position(tile_id)
    column_step, row_step = SEAM_ROLE_TILE_STEPS[role]
    return f'{column + column_step:02d}_{row + row_step:02d}'


def seam_neighbour_inputs(project_root, tile_id):
    eligible = set(select_eligible_tiles(read_tile_census(project_root)))
    lock = reference_client_guard.read_reference_client_lock(reference_client_guard.REFERENCE_CLIENT_LOCK_PATH)
    ledger = raw_map_ledger(project_root)
    inputs = []
    for role in SEAM_ROLE_TILE_STEPS:
        neighbour_id = neighbour_tile_id(tile_id, role)
        lock_record = lock.record(tile_map_path(neighbour_id))
        raw_fingerprint = None
        if lock_record is not None:
            fingerprint = raw_map_unit_fingerprint(project_root, tile_map_path(neighbour_id), lock_record)
            raw_fingerprint = fingerprint if ledger.is_sealed(tile_unit_key(neighbour_id), fingerprint) else None
        inputs.append({'role': role, 'tileId': neighbour_id, 'mapSha256': None if lock_record is None else lock_record['eSha256'],
                       'eligible': neighbour_id in eligible, 'rawFingerprint': raw_fingerprint})
    return inputs


def seam_neighbour(read_neighbour_frame, owner_index_matches, heightmap_size, neighbour_input):
    role, neighbour_id = neighbour_input['role'], neighbour_input['tileId']
    if neighbour_input['mapSha256'] is None:
        return SeamNeighbour(role, neighbour_id, ABSENT_STATE, None)
    if not owner_index_matches or not neighbour_input['eligible']:
        return SeamNeighbour(role, neighbour_id, UNAVAILABLE_STATE, None)
    frame, reason = read_neighbour_frame(neighbour_id)
    if frame is None:
        return SeamNeighbour(role, neighbour_id, PENDING_STATE if reason == RAW_STEP_PENDING_REASON else UNAVAILABLE_STATE, None)
    if terrain_map_index(frame['location']) != tile_grid_position(neighbour_id) or frame['heightmapSize'] != heightmap_size:
        return SeamNeighbour(role, neighbour_id, UNAVAILABLE_STATE, None)
    return SeamNeighbour(role, neighbour_id, CONVERTED_STATE, frame)


def own_clamped_heights(native, points, role):
    width, height = native['width'], native['height']
    if role == 'column':
        return [points[row * width + width - 1][2] for row in range(height)]
    if role == 'row':
        return [points[(height - 1) * width + column][2] for column in range(width)]
    return [points[-1][2]]


def neighbour_facing_heights(neighbour):
    frame = neighbour.frame
    if neighbour.role == 'corner':
        return [coords_point(frame['coords'], [0, 0, frame['samples'][0]])[2]]
    _, facing_points = facing_edge(frame, 'x' if neighbour.role == 'column' else 'y', False)
    return [point[2] for point in facing_points]


def far_heights_of_neighbour(native, points, neighbour):
    if neighbour.state == CONVERTED_STATE:
        return neighbour_facing_heights(neighbour)
    if neighbour.state == ABSENT_STATE:
        return own_clamped_heights(native, points, neighbour.role)
    return None


def build_terrain_seam_strip(read_neighbour_frame, tile_id, native, points, owner_location, neighbour_inputs):
    owner_index_matches = terrain_map_index(owner_location) == tile_grid_position(tile_id)
    heightmap_size = [native['width'], native['height']]
    neighbours = tuple(seam_neighbour(read_neighbour_frame, owner_index_matches, heightmap_size, neighbour_input)
                       for neighbour_input in neighbour_inputs)
    return TerrainSeamStrip({neighbour.role: far_heights_of_neighbour(native, points, neighbour) for neighbour in neighbours}, neighbours)


def terrain_seam_strip(project_root, client, tile_id, native, points, owner_location, neighbour_inputs):
    return build_terrain_seam_strip(lambda neighbour_id: sealed_tile_seam_frame(project_root, client, neighbour_id), tile_id, native, points,
                                    owner_location, neighbour_inputs)


def seam_gap_statuses(strip):
    statuses = {}
    for neighbour in strip.neighbours:
        if neighbour.state == PENDING_STATE:
            statuses[(PENDING_STATUS, RAW_STEP_PENDING_REASON)] = None
        elif neighbour.state == UNAVAILABLE_STATE:
            statuses[(GAP_STATUS, f'{SEAM_NEIGHBOUR_UNAVAILABLE_REASON_PREFIX}{neighbour.tile_id}')] = None
    return list(statuses)


def seam_strip_summary(strip):
    return {neighbour.role: {'tileId': neighbour.tile_id, 'state': neighbour.state} for neighbour in strip.neighbours}


def far_vertex_point(native, x, y, height):
    planar = coords_point(native['toWorld'], [x, y, 0])
    return [planar[0], planar[1], height]


def strip_vertices(native, far_heights, region):
    width, height = native['width'], native['height']
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    reaches_last_column, reaches_last_row = origin_x + quads_x == width - 1, origin_y + quads_y == height - 1
    vertices = {}
    if reaches_last_column and far_heights['column'] is not None:
        for y in range(origin_y, origin_y + quads_y + 1):
            vertices[(width, y)] = far_vertex_point(native, width, y, far_heights['column'][y])
    if reaches_last_row and far_heights['row'] is not None:
        for x in range(origin_x, origin_x + quads_x + 1):
            vertices[(x, height)] = far_vertex_point(native, x, height, far_heights['row'][x])
    if reaches_last_column and reaches_last_row and all(far_heights[role] is not None for role in SEAM_ROLE_TILE_STEPS):
        vertices[(width, height)] = far_vertex_point(native, width, height, far_heights['corner'][0])
    return vertices


def strip_quads(native, region, vertices):
    width, height = native['width'], native['height']
    origin_x, origin_y = region['offset']
    quads_x, quads_y = region['quads']
    candidates = [(width - 1, y) for y in range(origin_y, origin_y + quads_y)]
    candidates += [(x, height - 1) for x in range(origin_x, origin_x + quads_x)]
    candidates.append((width - 1, height - 1))

    def has_vertex(x, y):
        return (x, y) in vertices or (x < width and y < height)

    return [(x, y) for x, y in candidates if all(has_vertex(x + dx, y + dy) for dx in (0, 1) for dy in (0, 1)) and (x + 1, y + 1) in vertices]


def edge_vertex_normal(points, edge_turn_words, width, height, x, y):
    return vertex_normal(points, edge_turn_words, width, height, min(x, width - 1), min(y, height - 1))
