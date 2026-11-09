from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from native_store.gap_rows import read_gap_rows, write_gap_rows
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import REPOSITORY_ROOT, require_converter_output
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.raw_map_step import RAW_STEP_NAME, TILE_ID_PATTERN, run_raw_map_step
from world.static_mesh_step import STATIC_MESH_STEP_NAME, run_static_mesh_step
from world.terrain_chunk_step import TERRAIN_STEP_NAME, run_terrain_chunk_step
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, run_chunk_plan_step
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME, run_tile_manifest_step

SOURCE_TILE_STEPS = {RAW_STEP_NAME: run_raw_map_step, CHUNK_PLAN_STEP_NAME: run_chunk_plan_step, TERRAIN_STEP_NAME: run_terrain_chunk_step,
                     STATIC_MESH_STEP_NAME: run_static_mesh_step}
TILE_STEP_NAMES = (*SOURCE_TILE_STEPS, TILE_MANIFEST_STEP_NAME)
DEFAULT_TILE_STORE_OUTPUT = Path('artifacts') / 'lane-store' / WORLD_LANE_NAME / 'l2'
FAILED_ROW_STATUS = 'failed'


def tile_id_argument(value):
    if not TILE_ID_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError(f'map must be a tile id XX_YY: {value!r}')
    return value


def record_tile_step_gap_row(project_root, row):
    rows = [existing_row for existing_row in read_gap_rows(project_root, WORLD_LANE_NAME)
            if existing_row['step'] == row['step'] and existing_row['key'] != row['key']]
    return write_gap_rows(project_root, WORLD_LANE_NAME, row['step'], [*rows, row])


def run_tile_step(step, client, tile_id, output):
    if step == TILE_MANIFEST_STEP_NAME:
        return run_tile_manifest_step(REPOSITORY_ROOT, tile_id, require_converter_output(REPOSITORY_ROOT, REPOSITORY_ROOT / output))
    return [SOURCE_TILE_STEPS[step](REPOSITORY_ROOT, client, tile_id)]


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run one world conversion step for one map tile of the locked reference client.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--map', type=tile_id_argument, required=True)
    parser.add_argument('--step', choices=sorted(TILE_STEP_NAMES), required=True)
    parser.add_argument('--output', type=Path, default=DEFAULT_TILE_STORE_OUTPUT,
                        help='world lane store for --step manifest; a relative path is taken from the repository root')
    arguments = parser.parse_args(argv)
    try:
        require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        with lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, WORLD_LANE_NAME):
            rows = run_tile_step(arguments.step, arguments.client, arguments.map, arguments.output)
            for row in rows:
                record_tile_step_gap_row(REPOSITORY_ROOT, row)
    except (OSError, ValueError) as error:
        print(f'Tile conversion failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(rows, indent=1))
    return 1 if any(row['status'] == FAILED_ROW_STATUS for row in rows) else 0


if __name__ == '__main__':
    raise SystemExit(main())
