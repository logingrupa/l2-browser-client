from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from native_store.gap_rows import read_gap_rows, write_gap_rows
from native_store.store_paths import REPOSITORY_ROOT
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.raw_map_step import RAW_STEP_NAME, TILE_ID_PATTERN, run_raw_map_step
from world.tile_census import WORLD_LANE_NAME

TILE_STEPS = {RAW_STEP_NAME: run_raw_map_step}
FAILED_ROW_STATUS = 'failed'


def tile_id_argument(value):
    if not TILE_ID_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError(f'map must be a tile id XX_YY: {value!r}')
    return value


def record_tile_step_gap_row(project_root, row):
    rows = [existing_row for existing_row in read_gap_rows(project_root, WORLD_LANE_NAME)
            if existing_row['step'] == row['step'] and existing_row['key'] != row['key']]
    return write_gap_rows(project_root, WORLD_LANE_NAME, row['step'], [*rows, row])


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run one world conversion step for one map tile of the locked reference client.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--map', type=tile_id_argument, required=True)
    parser.add_argument('--step', choices=sorted(TILE_STEPS), required=True)
    arguments = parser.parse_args(argv)
    try:
        require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        row = TILE_STEPS[arguments.step](REPOSITORY_ROOT, arguments.client, arguments.map)
        record_tile_step_gap_row(REPOSITORY_ROOT, row)
    except (OSError, ValueError) as error:
        print(f'Tile conversion failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(row, indent=1))
    return 1 if row['status'] == FAILED_ROW_STATUS else 0


if __name__ == '__main__':
    raise SystemExit(main())
