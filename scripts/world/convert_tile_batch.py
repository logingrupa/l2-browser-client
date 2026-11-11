from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from typing import NamedTuple

from native_store.build_coverage_report import write_coverage_report
from native_store.gap_rows import read_gap_rows, sorted_gap_rows, write_gap_rows
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, require_converter_output
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, FreeDiskFloorRefusedError, MachineWindowRefusedError, require_batch_preflight,
                                      run_at_below_normal_priority)
from native_store.write_lane_catalog import write_lane_catalog
from reference_client_guard import require_reference_client
from world.eligible_tile_selection import (FAILED_STATUS, GAP_STATUS, PASS_STATUS, StepSealMissingError, failed_step_row, locked_tile_source_identity,
                                           own_step_row, read_tile_census, sealed_step_of_current_seal, sealed_tile_step, select_eligible_tiles,
                                           step_level_rows, unit_step_evidence, upstream_failed_row)
from world.raw_map_step import tile_unit_key
from world.tile_census import DEFAULT_CONVERSION_CLIENT_ROOT, WORLD_LANE_NAME
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME
from world.tile_step_current_seals import CURRENT_SEAL_STATE, STALE_SEAL_STATE, TILE_STEP_SEAL_CHECKS, UNSEALED_STATE, unit_step_seal
from world.tile_step_registry import DEFAULT_TILE_STORE_OUTPUT, TILE_STEP_NAMES, run_tile_step

BATCH_EXIT_DONE = 0
BATCH_EXIT_ERROR = 1
BATCH_EXIT_MACHINE_WINDOW = 2
BATCH_EXIT_DISK_FLOOR = 3
SETTLING_UNSEALED_STATUSES = (FAILED_STATUS, GAP_STATUS)
SEAL_INSPECTION_ERRORS = (OSError, ValueError)
NOTHING_TO_DO_MESSAGE = 'nothing to do: every eligible tile of the census has every registered step sealed'


class TileBatchUsageError(ValueError):
    pass


class TileBatchStop(NamedTuple):
    exit_code: int
    tile_id: str
    step: str
    message: str


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


class TileStepRun:
    def __init__(self, project_root, step_runner, preflight, step_names, step_seal_checks):
        self.project_root, self.step_runner, self.preflight, self.step_names = project_root, step_runner, preflight, step_names
        self.step_seal_checks = step_seal_checks
        self.preflights = []

    def checked_preflight(self, tile_id, step):
        try:
            self.preflights.append({'tile': tile_id, 'step': step, **self.preflight()})
        except MachineWindowRefusedError as error:
            return TileBatchStop(BATCH_EXIT_MACHINE_WINDOW, tile_id, step, str(error))
        except FreeDiskFloorRefusedError as error:
            return TileBatchStop(BATCH_EXIT_DISK_FLOOR, tile_id, step, str(error))
        return None

    def step_result(self, tile_id, step, source_identity):
        evidence = unit_step_evidence(self.project_root, tile_id, step, self.step_seal_checks)
        try:
            row = own_step_row(step, self.step_runner(step, tile_id))
            if row['status'] == FAILED_STATUS:
                return row
            if sealed_tile_step(self.project_root, tile_id, step, self.step_seal_checks) is not None:
                return None
            if row['status'] == PASS_STATUS:
                raise StepSealMissingError(f'step {step} of {tile_unit_key(tile_id)} reported pass without a ledger seal')
            return row
        except Exception as error:
            return failed_step_row(tile_id, step, source_identity, error, evidence)

    def run_tile(self, tile_id, source_identity):
        step_results, failed_step = {}, None
        for step in self.step_names:
            if failed_step is not None and step != TILE_MANIFEST_STEP_NAME:
                step_results[step] = upstream_failed_row(tile_id, step, source_identity, failed_step,
                                                         unit_step_evidence(self.project_root, tile_id, failed_step, self.step_seal_checks))
                continue
            stop = self.checked_preflight(tile_id, step)
            if stop is not None:
                return step_results, stop
            result = self.step_result(tile_id, step, source_identity)
            if result is None:
                continue
            step_results[step] = result
            if result['status'] == FAILED_STATUS and failed_step is None:
                failed_step = step
        return step_results, None


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


def run_tile_batch(project_root, limit, step_runner, preflight, step_seal_checks, step_names=TILE_STEP_NAMES,
                   tile_source_identity=locked_tile_source_identity):
    if not (type(limit) is int and limit >= 1):
        raise TileBatchUsageError(f'batch limit must be a whole number of at least 1: {limit!r}')
    tile_ids = select_eligible_tiles(read_tile_census(project_root))
    recorded_rows = {(row['key'], row['step']): row for row in read_gap_rows(project_root, WORLD_LANE_NAME)}
    source_identities = {tile_id: tile_source_identity(tile_id) for tile_id in tile_ids}
    tile_step_run = TileStepRun(project_root, step_runner, preflight, step_names, step_seal_checks)
    step_results_by_tile, attempted_tile_ids, stop = {}, [], None
    for tile_id in tile_ids:
        if len(attempted_tile_ids) >= limit:
            break
        if not tile_has_work(project_root, tile_id, step_names, recorded_rows, step_seal_checks):
            continue
        attempted_tile_ids.append(tile_id)
        step_results_by_tile[tile_id], stop = tile_step_run.run_tile(tile_id, source_identities[tile_id])
        if stop is not None:
            break
    rows = [row for tile_id in tile_ids
            for row in tile_rows(project_root, tile_id, source_identities[tile_id], step_names, step_results_by_tile.get(tile_id, {}),
                                 {} if tile_id in step_results_by_tile else recorded_rows, step_seal_checks)]
    write_tile_step_rows(project_root, step_names, tile_ids, rows)
    return TileBatchOutcome(BATCH_EXIT_DONE if stop is None else stop.exit_code, attempted_tile_ids, stop, tile_step_run.preflights, rows)


def world_batch_preflight(project_root):
    def preflight():
        result = require_batch_preflight(project_root, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        return {'rigaTime': result['rigaTime'], 'freeBytes': result['freeBytes']}
    return preflight


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
    return parser


def main(argv=None):
    try:
        arguments = batch_argument_parser().parse_args(argv)
        require_reference_client(arguments.client)
        store_root = require_converter_output(REPOSITORY_ROOT, REPOSITORY_ROOT / arguments.output)
        outcome = run_tile_batch(REPOSITORY_ROOT, arguments.limit,
                                 lambda step, tile_id: run_tile_step(REPOSITORY_ROOT, step, arguments.client, tile_id, store_root),
                                 world_batch_preflight(REPOSITORY_ROOT), TILE_STEP_SEAL_CHECKS, tile_source_identity=locked_tile_source_identity)
        lane_outputs = refresh_world_lane_outputs(REPOSITORY_ROOT) if outcome.exit_code == BATCH_EXIT_DONE else None
    except (OSError, ValueError) as error:
        print(f'Tile batch failed: {error}', file=sys.stderr)
        return BATCH_EXIT_ERROR
    if not outcome.attempted_tile_ids:
        print(NOTHING_TO_DO_MESSAGE)
    print(json.dumps(batch_summary(outcome, lane_outputs), indent=1))
    return outcome.exit_code


if __name__ == '__main__':
    raise SystemExit(main())
