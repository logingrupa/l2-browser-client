from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.static_placement import gltf_placement, resolved_static_values, static_matrix
from world.terrain_coordinates import coords_point
from world.tile_census import GAP_STATUS

STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
PLACEMENT_OUTSIDE_CHUNK_GRID_REASON = 'placement-outside-chunk-grid'
FAILED_STATUS = 'failed'


class ChunkRectangle(NamedTuple):
    chunk_id: str
    minimum: tuple
    maximum: tuple


class UnplacedStaticActor(NamedTuple):
    placement: dict
    status: str
    reason: str


class StaticPlacementPlan(NamedTuple):
    placements_by_chunk: dict
    unplaced: list


def heightmap_point_xy(native, column, row):
    to_world = native['toWorld']
    world = coords_point(to_world, [column, row, to_world['origin'][2]])
    return world[0], world[1]


def chunk_rectangles(chunk_plan, native):
    sectors_by_offset = {tuple(sector['offset']): sector for sector in native['sectors']}
    rectangles = []
    for chunk in chunk_plan['chunks']:
        first_column, first_row = chunk['sectorRectangle']['minOffset']
        last_offset = tuple(chunk['sectorRectangle']['maxOffset'])
        last_sector = sectors_by_offset.get(last_offset)
        if last_sector is None or (first_column, first_row) not in sectors_by_offset:
            raise FormatError(f'Chunk {chunk["chunkId"]} sector rectangle names no native sector origin')
        minimum = heightmap_point_xy(native, first_column, first_row)
        maximum = heightmap_point_xy(native, last_offset[0] + last_sector['quads'][0], last_offset[1] + last_sector['quads'][1])
        if not (minimum[0] < maximum[0] and minimum[1] < maximum[1]):
            raise FormatError(f'Chunk {chunk["chunkId"]} native rectangle is empty or reversed: {minimum} {maximum}')
        rectangles.append(ChunkRectangle(chunk['chunkId'], minimum, maximum))
    return rectangles


def chunk_for_origin(rectangles, origin_x, origin_y):
    for rectangle in rectangles:
        if rectangle.minimum[0] <= origin_x < rectangle.maximum[0] and rectangle.minimum[1] <= origin_y < rectangle.maximum[1]:
            return rectangle.chunk_id
    return None


def has_static_mesh_reference(actor):
    reference = actor.get('staticMesh')
    return isinstance(reference, dict) and bool(reference.get('object'))


def static_mesh_actors(actors):
    return sorted((actor for actor in actors if actor['classObject'] == STATIC_MESH_ACTOR_CLASS and has_static_mesh_reference(actor)),
                  key=lambda actor: actor['exportIndex'])


def placement_identity(actor):
    return {'id': actor['id'], 'sourceActor': actor['object'], 'exportIndex': actor['exportIndex'], 'sourceMesh': actor['staticMesh']['object'],
            'matrix': None, 'materialOverrides': actor['materialOverrides'], 'collision': actor['collision']}


def plan_static_placements(actors, rectangles, class_evidence):
    placements_by_chunk = {rectangle.chunk_id: [] for rectangle in rectangles}
    unplaced = []
    for actor in static_mesh_actors(actors):
        placement = placement_identity(actor)
        try:
            values = resolved_static_values(actor, class_evidence)
            placement['matrix'] = gltf_placement(static_matrix(values))
        except FormatError as error:
            unplaced.append(UnplacedStaticActor(placement, FAILED_STATUS, f'decode-failed:{type(error).__name__}:{error}'))
            continue
        location = values['Location']['value']
        chunk_id = chunk_for_origin(rectangles, location['X'], location['Y'])
        if chunk_id is None:
            unplaced.append(UnplacedStaticActor(placement, GAP_STATUS, PLACEMENT_OUTSIDE_CHUNK_GRID_REASON))
            continue
        placements_by_chunk[chunk_id].append(placement)
    return StaticPlacementPlan(placements_by_chunk, unplaced)
