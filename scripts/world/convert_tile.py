from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from native_store.gap_rows import read_gap_rows, write_gap_rows
from native_store.interprocess_lock import LaneInUseError, lane_batch_lock
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import REPOSITORY_ROOT, lane_work_root, require_converter_output
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.eligible_tile_selection import failed_step_row, locked_tile_source_identity, own_step_row, seal_derived_step_row, unit_step_evidence
from world.raw_map_step import RAW_STEP_NAME, TILE_ID_PATTERN
from world.tile_census import WORLD_LANE_NAME
from world.tile_step_registry import DEFAULT_TILE_STORE_OUTPUT, TILE_STEP_NAMES, run_tile_step

FAILED_ROW_STATUS = 'failed'


def record_tile_step_gap_row(project_root, row):
    rows = [existing_row for existing_row in read_gap_rows(project_root, WORLD_LANE_NAME)
            if existing_row['step'] == row['step'] and existing_row['key'] != row['key']]
    return write_gap_rows(project_root, WORLD_LANE_NAME, row['step'], [*rows, row])


def converted_step_row(project_root, step, client, map_name, store_root):
    source_identity = locked_tile_source_identity(map_name) if TILE_ID_PATTERN.fullmatch(map_name) else None
    try:
        rows = run_tile_step(project_root, step, client, map_name, store_root)
    except (OSError, ValueError) as error:
        if source_identity is not None:
            record_tile_step_gap_row(project_root, failed_step_row(map_name, step, source_identity, error, unit_step_evidence(project_root, map_name, step)))
        raise
    return seal_derived_step_row(project_root, own_step_row(step, rows))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run one world conversion step for one map tile, or the raw step for one non-tile census map, of the locked reference client.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--map', required=True, help='a tile id XX_YY, or for --step raw a non-tile map name of the tile census')
    parser.add_argument('--step', choices=sorted(TILE_STEP_NAMES), required=True)
    parser.add_argument('--output', type=Path, default=DEFAULT_TILE_STORE_OUTPUT,
                        help='world lane store for --step manifest; a relative path is taken from the repository root')
    arguments = parser.parse_args(argv)
    if arguments.step != RAW_STEP_NAME and not TILE_ID_PATTERN.fullmatch(arguments.map):
        parser.error(f'--step {arguments.step} converts tile maps only and needs a tile id XX_YY; '
                     f'a non-tile census map runs --step {RAW_STEP_NAME} alone: {arguments.map!r}')
    try:
        require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        with lane_batch_lock(lane_work_root(REPOSITORY_ROOT, WORLD_LANE_NAME)), lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, WORLD_LANE_NAME):
            store_root = require_converter_output(REPOSITORY_ROOT, REPOSITORY_ROOT / arguments.output)
            row = converted_step_row(REPOSITORY_ROOT, arguments.step, arguments.client, arguments.map, store_root)
            record_tile_step_gap_row(REPOSITORY_ROOT, row)
    except (OSError, ValueError, LaneInUseError) as error:
        print(f'Tile conversion failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps([row], indent=1))
    return 1 if row['status'] == FAILED_ROW_STATUS else 0


if __name__ == '__main__':
    raise SystemExit(main())
