from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import itertools
import json
from typing import NamedTuple

from native_store.build_coverage_report import write_coverage_report
from native_store.gap_rows import read_gap_rows, sorted_gap_rows, write_gap_rows
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, require_converter_output
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from native_store.worker_count_argument import worker_count_argument
from native_store.write_lane_catalog import write_lane_catalog
from reference_client_guard import require_reference_client
from world.eligible_tile_selection import (FAILED_STATUS, GAP_STATUS, PASS_STATUS, failed_step_row, locked_tile_source_identity,
                                           sealed_step_of_current_seal, step_level_rows, unit_step_evidence)
from world.eligible_tiles import read_tile_census, select_eligible_tiles
from world.raw_map_step import RAW_STEP_NAME, tile_unit_key
from world.terrain_seam_strip import SEAM_ROLE_TILE_STEPS, neighbour_tile_id
from world.tile_census import DEFAULT_CONVERSION_CLIENT_ROOT, WORLD_LANE_NAME
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME
from world.tile_step_current_seals import CURRENT_SEAL_STATE, STALE_SEAL_STATE, TILE_STEP_SEAL_CHECKS, UNSEALED_STATE, unit_step_seal
from world.tile_step_registry import DEFAULT_TILE_STORE_OUTPUT, TILE_STEP_NAMES, run_tile_step
from world.tile_step_workers import BATCH_EXIT_DONE, BATCH_EXIT_ERROR, TileBatchStop, TileStepRun, TileStepsTask, TileStepWorkers

EXTRA_FREE_BYTES_PER_ADDED_WORKER = 1024 ** 3
SETTLING_UNSEALED_STATUSES = (FAILED_STATUS, GAP_STATUS)
SEAL_INSPECTION_ERRORS = (OSError, ValueError)
NOTHING_TO_DO_MESSAGE = 'nothing to do: every eligible tile of the census has every registered step sealed'


class TileBatchUsageError(ValueError):
    pass


class TileBatchOutcome(NamedTuple):
    exit_code: int
    attempted_tile_ids: list
    stop: TileBatchStop | None
    preflights: list
    rows: list


class BatchArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        raise TileBatchUsageError(f'{self.prog}: error: {message}')


def positive_limit_argument(value):
    try:
        limit = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f'--limit must be a whole number: {value!r}') from error
    if limit < 1:
        raise argparse.ArgumentTypeError(f'--limit must be at least 1: {limit}')
    return limit


def inspected_seal_state(project_root, tile_id, step, step_seal_checks):
    try:
        return unit_step_seal(project_root, tile_unit_key(tile_id), step, step_seal_checks).state
    except SEAL_INSPECTION_ERRORS:
        return UNSEALED_STATE


def tile_has_work(project_root, tile_id, step_names, recorded_rows, step_seal_checks):
    for step in step_names:
        seal_state = inspected_seal_state(project_root, tile_id, step, step_seal_checks)
        if seal_state == CURRENT_SEAL_STATE:
            continue
        if seal_state == STALE_SEAL_STATE:
            return True
        recorded_row = recorded_rows.get((tile_unit_key(tile_id), step))
        return recorded_row is None or recorded_row['status'] not in SETTLING_UNSEALED_STATUSES
    return False


def selected_tile_ids(project_root, tile_ids, limit, step_names, recorded_rows, step_seal_checks):
    tiles_with_work = (tile_id for tile_id in tile_ids if tile_has_work(project_root, tile_id, step_names, recorded_rows, step_seal_checks))
    return list(itertools.islice(tiles_with_work, limit))


def seam_input_tile_ids(project_root, tile_ids, selected, recorded_rows, step_seal_checks):
    seam_neighbours = {neighbour_tile_id(tile_id, role) for tile_id in selected for role in SEAM_ROLE_TILE_STEPS}
    return [tile_id for tile_id in tile_ids
            if tile_id in selected or (tile_id in seam_neighbours
                                       and tile_has_work(project_root, tile_id, (RAW_STEP_NAME,), recorded_rows, step_seal_checks))]


def inspected_tile_seals(project_root, tile_id, source_identity, step_names, step_seal_checks):
    sealed_steps, stale_steps, inspection_failures = {}, set(), {}
    for step in step_names:
        try:
            seal = unit_step_seal(project_root, tile_unit_key(tile_id), step, step_seal_checks)
        except SEAL_INSPECTION_ERRORS as error:
            inspection_failures[step] = failed_step_row(tile_id, step, source_identity, error,
                                                        unit_step_evidence(project_root, tile_id, step, step_seal_checks))
            continue
        if seal.state == CURRENT_SEAL_STATE:
            sealed_steps[step] = sealed_step_of_current_seal(seal)
        elif seal.state == STALE_SEAL_STATE:
            stale_steps.add(step)
    return sealed_steps, stale_steps, inspection_failures


def recorded_unsealed_step_rows(tile_id, step_names, steps_answered_by_seal, recorded_rows):
    recorded_step_rows = {step: recorded_rows.get((tile_unit_key(tile_id), step)) for step in step_names if step not in steps_answered_by_seal}
    return {step: row for step, row in recorded_step_rows.items() if row is not None and row['status'] != PASS_STATUS}


def tile_rows(project_root, tile_id, source_identity, step_names, step_results, recorded_rows, step_seal_checks):
    sealed_steps, stale_steps, inspection_failures = inspected_tile_seals(project_root, tile_id, source_identity, step_names, step_seal_checks)
    recorded_step_rows = recorded_unsealed_step_rows(tile_id, step_names, {*sealed_steps, *stale_steps}, recorded_rows)
    return step_level_rows(tile_id, source_identity, step_names, {**recorded_step_rows, **inspection_failures, **step_results}, sealed_steps)


def write_tile_step_rows(project_root, step_names, tile_ids, rows):
    replaced_keys = {tile_unit_key(tile_id) for tile_id in tile_ids}
    current_rows_by_step = {}
    for row in read_gap_rows(project_root, WORLD_LANE_NAME):
        current_rows_by_step.setdefault(row['step'], []).append(row)
    for step in step_names:
        current_rows = sorted_gap_rows(current_rows_by_step.get(step, []))
        kept_rows = [row for row in current_rows if row['key'] not in replaced_keys]
        desired_rows = sorted_gap_rows([*kept_rows, *(row for row in rows if row['step'] == step)])
        if desired_rows != current_rows:
            write_gap_rows(project_root, WORLD_LANE_NAME, step, desired_rows)


def seam_input_raw_results(workers, seam_inputs, selected, source_identities, preflights_by_tile):
    raw_results_by_tile, stop = {}, None
    tasks = [TileStepsTask(position, tile_id, source_identities[tile_id], (RAW_STEP_NAME,), None) for position, tile_id in enumerate(seam_inputs)]
    for task, outcome in zip(tasks, workers.outcomes(tasks), strict=True):
        preflights_by_tile[task.tile_id].extend(outcome.preflights)
        if stop is None:
            stop = outcome.stop
        if task.tile_id in selected:
            raw_results_by_tile[task.tile_id] = outcome.step_results
    return raw_results_by_tile, stop


def failed_raw_step(raw_results):
    return RAW_STEP_NAME if RAW_STEP_NAME in raw_results and raw_results[RAW_STEP_NAME]['status'] == FAILED_STATUS else None


def selected_tile_step_results(workers, selected, source_identities, step_names, raw_results_by_tile, preflights_by_tile):
    step_results_by_tile, stop = {}, None
    worker_step_names = tuple(step for step in step_names if step not in (RAW_STEP_NAME, TILE_MANIFEST_STEP_NAME))
    tasks = [TileStepsTask(position, tile_id, source_identities[tile_id], worker_step_names, failed_raw_step(raw_results_by_tile[tile_id]))
             for position, tile_id in enumerate(selected)]
    for task, outcome in zip(tasks, workers.outcomes(tasks), strict=True):
        if stop is None:
            stop = outcome.stop
        if not outcome.started:
            continue
        step_results_by_tile[task.tile_id] = {**raw_results_by_tile[task.tile_id], **outcome.step_results}
        preflights_by_tile[task.tile_id].extend(outcome.preflights)
        if stop is None and TILE_MANIFEST_STEP_NAME in step_names:
            manifest_outcome = workers.coordinator_outcome(task._replace(step_names=(TILE_MANIFEST_STEP_NAME,), failed_earlier_step=None))
            step_results_by_tile[task.tile_id].update(manifest_outcome.step_results)
            preflights_by_tile[task.tile_id].extend(manifest_outcome.preflights)
            stop = manifest_outcome.stop
    return step_results_by_tile, stop


def run_tile_batch(limit, worker_count, tile_step_run_factory, tile_step_run_arguments, step_names=TILE_STEP_NAMES,
                   tile_source_identity=locked_tile_source_identity):
    if not (type(limit) is int and limit >= 1):
        raise TileBatchUsageError(f'batch limit must be a whole number of at least 1: {limit!r}')
    coordinator_run = tile_step_run_factory(*tile_step_run_arguments)
    project_root, step_seal_checks = coordinator_run.project_root, coordinator_run.step_seal_checks
    tile_ids = select_eligible_tiles(read_tile_census(project_root))
    recorded_rows = {(row['key'], row['step']): row for row in read_gap_rows(project_root, WORLD_LANE_NAME)}
    source_identities = {tile_id: tile_source_identity(tile_id) for tile_id in tile_ids}
    selected = selected_tile_ids(project_root, tile_ids, limit, step_names, recorded_rows, step_seal_checks)
    seam_inputs = seam_input_tile_ids(project_root, tile_ids, selected, recorded_rows, step_seal_checks)
    step_results_by_tile, preflights_by_tile = {}, {tile_id: [] for tile_id in tile_ids}
    workers = TileStepWorkers(worker_count, coordinator_run, tile_step_run_factory, tile_step_run_arguments)
    try:
        raw_results_by_tile, stop = seam_input_raw_results(workers, seam_inputs, selected, source_identities, preflights_by_tile)
        if stop is None:
            step_results_by_tile, stop = selected_tile_step_results(workers, selected, source_identities, step_names, raw_results_by_tile,
                                                                    preflights_by_tile)
    finally:
        workers.close()
    rows = [row for tile_id in tile_ids
            for row in tile_rows(project_root, tile_id, source_identities[tile_id], step_names, step_results_by_tile.get(tile_id, {}),
                                 {} if tile_id in step_results_by_tile else recorded_rows, step_seal_checks)]
    write_tile_step_rows(project_root, step_names, tile_ids, rows)
    preflights = [record for tile_id in tile_ids for record in preflights_by_tile[tile_id]]
    return TileBatchOutcome(BATCH_EXIT_DONE if stop is None else stop.exit_code, list(step_results_by_tile), stop, preflights, rows)


def batch_free_disk_floor(worker_count):
    return BATCH_MINIMUM_FREE_BYTES + EXTRA_FREE_BYTES_PER_ADDED_WORKER * (worker_count - 1)


def world_batch_preflight(project_root, worker_count):
    def preflight():
        result = require_batch_preflight(project_root, WORLD_LANE_NAME, batch_free_disk_floor(worker_count))
        run_at_below_normal_priority()
        return {'rigaTime': result['rigaTime'], 'freeBytes': result['freeBytes']}
    return preflight


def world_tile_step_run(project_root, client, store_root, worker_count):
    def step_runner(step, tile_id):
        return run_tile_step(project_root, step, client, tile_id, store_root)
    return TileStepRun(project_root, step_runner, world_batch_preflight(project_root, worker_count), TILE_STEP_SEAL_CHECKS)


def refresh_world_lane_outputs(project_root):
    catalog_summary = write_lane_catalog(project_root, WORLD_LANE_NAME, [], plan_only=False)
    coverage_path, coverage = write_coverage_report(project_root, lane_store_root(project_root, WORLD_LANE_NAME), (WORLD_LANE_NAME,))
    return {'catalogSha256': catalog_summary['catalogSha256'], 'coverage': coverage_path.as_posix(), 'coverageCatalogSha256': coverage['catalogSha256']}


def row_status_counts(rows):
    counts = {}
    for row in rows:
        counts[row['status']] = counts.get(row['status'], 0) + 1
    return dict(sorted(counts.items()))


def batch_summary(outcome, lane_outputs):
    return {'exitCode': outcome.exit_code, 'attemptedTiles': outcome.attempted_tile_ids,
            'stop': None if outcome.stop is None else outcome.stop._asdict(), 'preflights': outcome.preflights,
            'rowStatusCounts': row_status_counts(outcome.rows), 'laneOutputs': lane_outputs}


def batch_argument_parser():
    parser = BatchArgumentParser(description='Run every registered world step on the next eligible tiles of the committed tile census.')
    parser.add_argument('--client', type=Path, default=DEFAULT_CONVERSION_CLIENT_ROOT)
    parser.add_argument('--output', type=Path, default=DEFAULT_TILE_STORE_OUTPUT,
                        help='world lane store for the manifest step; a relative path is taken from the repository root')
    parser.add_argument('--eligible', action='store_true', required=True, help='select the tiles from the committed census status eligible')
    parser.add_argument('--limit', type=positive_limit_argument, required=True)
    parser.add_argument('--workers', type=worker_count_argument, default=1, help='worker processes that run the steps of the selected tiles')
    return parser


def main(argv=None):
    try:
        arguments = batch_argument_parser().parse_args(argv)
        require_reference_client(arguments.client)
        store_root = require_converter_output(REPOSITORY_ROOT, REPOSITORY_ROOT / arguments.output)
        outcome = run_tile_batch(arguments.limit, arguments.workers, world_tile_step_run,
                                 (REPOSITORY_ROOT, arguments.client, store_root, arguments.workers),
                                 tile_source_identity=locked_tile_source_identity)
        lane_outputs = refresh_world_lane_outputs(REPOSITORY_ROOT) if outcome.exit_code == BATCH_EXIT_DONE else None
    except (OSError, ValueError) as error:
        print(f'Tile batch failed: {error}', file=sys.stderr)
        return BATCH_EXIT_ERROR
    if outcome.stop is None and not outcome.attempted_tile_ids:
        print(NOTHING_TO_DO_MESSAGE)
    print(json.dumps(batch_summary(outcome, lane_outputs), indent=1))
    return outcome.exit_code


if __name__ == '__main__':
    raise SystemExit(main())
