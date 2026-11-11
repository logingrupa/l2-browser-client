from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json
import struct

from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes
from world.eligible_tile_selection import read_tile_census, select_eligible_tiles
from world.native_terrain_sectors import native_terrain, read_height_samples
from world.raw_map_step import read_tile_map_lock_record
from world.terrain_coordinates import calculated_coords, coords_point, xyz
from world.tile_census import reference_tree_lock_sha256
from world.tile_chunk_plan import (TERRAIN_HEIGHT_PACKAGE_MISSING_REASON, ChunkPlanStepError, raw_unit_fingerprint, read_locked_map_package,
                                   read_raw_terrain_record, serialized_location)

TERRAIN_SEAM_FACTS_SCHEMA_VERSION = 1
TERRAIN_SEAM_FACTS_RELATIVE_PATH = 'docs/parts/world/terrain-seam-facts.json'
RAW_STEP_PENDING_REASON = 'step-pending:raw'
TERRAIN_LOCATION_UNRESOLVED_REASON = 'actor-default-unresolved:Location'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'
SEAM_AXIS_INDEX = {'x': 0, 'y': 1}
TILE_STEP_OFFSETS = {'x': (1, 0), 'y': (0, 1)}
SEAM_FACTS_METHOD = ('Each terrain point is the heightmap index mapped through the source-backed CalcCoords of the TerrainInfo Location, '
                     'TerrainScale and heightmap size (scripts/world/terrain_coordinates.py, checked equal to the serialized native ToWorld). '
                     'A seam pair is the lower tile (owner) and the next tile in X or Y (neighbour); the strip width is the neighbour '
                     'first point minus the owner last point on the seam axis; the facing edges are the owner last column or row and the '
                     'neighbour first column or row, compared as source-unit heights.')


class TerrainSeamFactsError(ValueError):
    pass


def terrain_seam_frame(tile_id, location, terrain_scale, width, height, samples, heightmap_sha256):
    if len(samples) != width * height:
        raise FormatError(f'{tile_id} height sample count {len(samples)} disagrees with heightmap size {width} x {height}')
    coords = calculated_coords(location, terrain_scale, width, height)
    first_point = coords_point(coords, [0, 0, samples[0]])
    last_point = coords_point(coords, [width - 1, height - 1, samples[-1]])
    return {'tileId': tile_id, 'location': list(location), 'terrainScale': list(terrain_scale), 'heightmapSize': [width, height],
            'heightmapSha256': heightmap_sha256, 'coveredExtent': {'min': first_point[:2], 'max': last_point[:2]},
            'coords': coords, 'samples': samples}


def facing_edge_indices(frame, axis, is_owner):
    width, height = frame['heightmapSize']
    if axis == 'x':
        column = width - 1 if is_owner else 0
        return [(column, row) for row in range(height)]
    row = height - 1 if is_owner else 0
    return [(column, row) for column in range(width)]


def facing_edge(frame, axis, is_owner):
    width = frame['heightmapSize'][0]
    samples = [frame['samples'][row * width + column] for column, row in facing_edge_indices(frame, axis, is_owner)]
    points = [coords_point(frame['coords'], [column, row, sample])
              for (column, row), sample in zip(facing_edge_indices(frame, axis, is_owner), samples)]
    return samples, points


def edge_samples_sha256(samples):
    return hashlib.sha256(struct.pack(f'<{len(samples)}H', *samples)).hexdigest()


def seam_pair_facts(owner, neighbour, axis):
    owner_samples, owner_points = facing_edge(owner, axis, True)
    neighbour_samples, neighbour_points = facing_edge(neighbour, axis, False)
    if len(owner_points) != len(neighbour_points):
        raise TerrainSeamFactsError(f'{owner["tileId"]} and {neighbour["tileId"]} facing edges have different sample counts '
                                    f'{len(owner_points)} and {len(neighbour_points)}')
    seam_axis = SEAM_AXIS_INDEX[axis]
    across_axis = 1 - seam_axis
    differences = [abs(neighbour_point[2] - owner_point[2]) for owner_point, neighbour_point in zip(owner_points, neighbour_points)]
    return {'tiles': [owner['tileId'], neighbour['tileId']], 'axis': axis, 'measured': True, 'unmeasuredTerrains': [],
            'stripWidth': neighbour['coveredExtent']['min'][seam_axis] - owner['coveredExtent']['max'][seam_axis],
            'acrossAxisOffset': neighbour_points[0][across_axis] - owner_points[0][across_axis],
            'facingEdge': {'sampleCount': len(differences), 'equalCount': sum(difference == 0 for difference in differences),
                           'largestDifference': max(differences), 'ownerEdgeSha256': edge_samples_sha256(owner_samples),
                           'neighbourEdgeSha256': edge_samples_sha256(neighbour_samples)}}


def unmeasured_pair_facts(owner_id, neighbour_id, axis, unmeasured_terrains):
    return {'tiles': [owner_id, neighbour_id], 'axis': axis, 'measured': False, 'unmeasuredTerrains': unmeasured_terrains,
            'stripWidth': None, 'acrossAxisOffset': None, 'facingEdge': None}


def tile_grid_position(tile_id):
    column, row = tile_id.split('_')
    return int(column), int(row)


def adjacent_tile_pairs(tile_ids):
    tile_by_position = {tile_grid_position(tile_id): tile_id for tile_id in tile_ids}
    pairs = []
    for axis, (column_step, row_step) in TILE_STEP_OFFSETS.items():
        for (column, row), tile_id in sorted(tile_by_position.items()):
            neighbour_id = tile_by_position.get((column + column_step, row + row_step))
            if neighbour_id is not None:
                pairs.append((tile_id, neighbour_id, axis))
    return pairs


def public_terrain_facts(frame, reason):
    if frame is None:
        return {'measured': False, 'reason': reason}
    return {'measured': True, **{name: frame[name] for name in ('location', 'terrainScale', 'heightmapSize', 'heightmapSha256', 'coveredExtent')}}


def terrain_seam_facts_document(lock_sha256, tile_ids, terrain_frames):
    pairs = []
    for owner_id, neighbour_id, axis in adjacent_tile_pairs(tile_ids):
        unmeasured = [{'tileId': tile_id, 'reason': terrain_frames[tile_id][1]} for tile_id in (owner_id, neighbour_id)
                      if terrain_frames[tile_id][0] is None]
        if unmeasured:
            pairs.append(unmeasured_pair_facts(owner_id, neighbour_id, axis, unmeasured))
        else:
            pairs.append(seam_pair_facts(terrain_frames[owner_id][0], terrain_frames[neighbour_id][0], axis))
    measured = [pair for pair in pairs if pair['measured']]
    every_edge_equal = all(pair['facingEdge']['equalCount'] == pair['facingEdge']['sampleCount'] for pair in measured) if measured else None
    summary = {'eligibleTiles': len(tile_ids), 'measuredTerrains': sum(frame is not None for frame, _ in terrain_frames.values()),
               'adjacentPairs': len(pairs), 'measuredPairs': len(measured), 'notMeasuredPairs': len(pairs) - len(measured),
               'stripWidthCounts': {str(width): count for width, count in sorted(Counter(pair['stripWidth'] for pair in measured).items())},
               'pairsWithEveryFacingSampleEqual': sum(pair['facingEdge']['equalCount'] == pair['facingEdge']['sampleCount'] for pair in measured),
               'everyMeasuredFacingEdgeEqual': every_edge_equal,
               'notMeasuredReasons': dict(sorted(Counter(row['reason'] for pair in pairs for row in pair['unmeasuredTerrains']).items()))}
    return {'schemaVersion': TERRAIN_SEAM_FACTS_SCHEMA_VERSION, 'referenceTreeLockSha256': lock_sha256, 'method': SEAM_FACTS_METHOD,
            'summary': summary, 'terrains': {tile_id: public_terrain_facts(*terrain_frames[tile_id]) for tile_id in sorted(tile_ids)},
            'pairs': pairs}


def sealed_tile_seam_frame(project_root, client, tile_id):
    lock_record = read_tile_map_lock_record(tile_id)
    try:
        _, raw_products = raw_unit_fingerprint(project_root, tile_id, lock_record)
    except ChunkPlanStepError:
        return None, RAW_STEP_PENDING_REASON
    terrain = read_raw_terrain_record(raw_products)
    if terrain is None:
        return None, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON
    actors = json.loads((raw_products / 'actors.json').read_text(encoding='utf-8'))
    location = serialized_location(next(actor for actor in actors if actor['id'] == terrain['id']))
    if location is None:
        return None, TERRAIN_LOCATION_UNRESOLVED_REASON
    try:
        native = native_terrain(read_locked_map_package(client, tile_id, lock_record))
        terrain_scale = xyz(terrain['terrainScale'])
        if calculated_coords(location, terrain_scale, native['width'], native['height']) != native['toWorld']:
            raise FormatError('Native ToWorld differs from source-backed CalcCoords')
        samples = read_height_samples(raw_products, terrain)
        frame = terrain_seam_frame(tile_id, location, terrain_scale, native['width'], native['height'], samples,
                                   terrain['height']['mips'][0]['sha256'])
    except FormatError as error:
        return None, f'{DECODE_FAILED_REASON_PREFIX}{error}'
    return frame, None


def build_terrain_seam_facts(project_root, client_access):
    tile_ids = select_eligible_tiles(read_tile_census(project_root))
    terrain_frames = {tile_id: sealed_tile_seam_frame(project_root, client_access.root, tile_id) for tile_id in tile_ids}
    return terrain_seam_facts_document(reference_tree_lock_sha256(client_access.lock.document), tile_ids, terrain_frames)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Measure how adjacent eligible tile terrains meet, from their sealed raw steps, into a tracked doc.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', default=TERRAIN_SEAM_FACTS_RELATIVE_PATH, help='repository-relative destination of the facts file')
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        run_at_below_normal_priority()
        require_committed_destination(arguments.output)
        payload = canonical_json_bytes(build_terrain_seam_facts(REPOSITORY_ROOT, client_access))
        write_committed_world_bytes(arguments.output, payload)
    except (OSError, ValueError) as error:
        print(f'Terrain seam facts failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': arguments.output, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
