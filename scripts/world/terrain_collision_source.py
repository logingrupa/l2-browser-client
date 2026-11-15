from native_catalog.ue2 import FormatError
from world.native_terrain_sectors import bit
from world.terrain_coordinates import xyz

QUAD_VISIBILITY_BITMAP = 'QuadVisibilityBitmap'
EDGE_TURN_BITMAP = 'EdgeTurnBitmap'


def chunk_vertex_rectangle(native, chunk):
    sectors_by_offset = {tuple(sector['offset']): sector for sector in native['sectors']}
    first_column, first_row = chunk['sectorRectangle']['minOffset']
    last_sector = sectors_by_offset.get(tuple(chunk['sectorRectangle']['maxOffset']))
    if last_sector is None or (first_column, first_row) not in sectors_by_offset:
        raise FormatError(f'Chunk {chunk["chunkId"]} sector rectangle names no native sector origin')
    last_column = last_sector['offset'][0] + last_sector['quads'][0]
    last_row = last_sector['offset'][1] + last_sector['quads'][1]
    return first_column, first_row, last_column - first_column + 1, last_row - first_row + 1


def read_terrain_collision(native, samples, words, terrain_record, terrain_actor, chunk):
    width = native['width']
    first_column, first_row, columns, rows = chunk_vertex_rectangle(native, chunk)
    heights = [samples[row * width + column] for row in range(first_row, first_row + rows) for column in range(first_column, first_column + columns)]
    quads = [(column, row) for row in range(first_row, first_row + rows - 1) for column in range(first_column, first_column + columns - 1)]
    return {'location': xyz(terrain_actor['sourceTransform']['Location']['value']), 'terrainScale': xyz(terrain_record['terrainScale']),
            'heightmapSize': [width, native['height']], 'vertexRectangle': [first_column, first_row, columns, rows], 'heights': heights,
            'quadVisibility': [bit(words[QUAD_VISIBILITY_BITMAP], width, column, row) for column, row in quads],
            'edgeTurn': [bit(words[EDGE_TURN_BITMAP], width, column, row) for column, row in quads]}
