import json
from pathlib import Path

from world.raw_map_step import TILE_ID_PATTERN, tile_map_path
from world.tile_census_validation import ELIGIBLE_STATUS, TILE_CENSUS_RELATIVE_PATH, TILE_KIND, TileCensusError, validate_tile_census

TILE_KEY_PREFIX = 'tile:'


def read_tile_census(project_root):
    return json.loads((Path(project_root) / TILE_CENSUS_RELATIVE_PATH).read_text(encoding='utf-8'))


def select_eligible_tiles(census):
    validate_tile_census(census)
    tile_ids = []
    for row in census['maps']:
        if row['kind'] != TILE_KIND or row['status'] != ELIGIBLE_STATUS:
            continue
        tile_id = row['key'].removeprefix(TILE_KEY_PREFIX)
        if not (row['key'].startswith(TILE_KEY_PREFIX) and TILE_ID_PATTERN.fullmatch(tile_id) and row['map'] == tile_map_path(tile_id)):
            raise TileCensusError(f'eligible tile census row {row["key"]} does not name its own map {row["map"]!r}')
        tile_ids.append(tile_id)
    return tile_ids
