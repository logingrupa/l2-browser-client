import json
from pathlib import Path
from typing import NamedTuple

from native_store.store_paths import lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.raw_map_step import TILE_ID_PATTERN, tile_map_path, tile_step_row, tile_unit_key
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import (ELIGIBLE_STATUS, TILE_CENSUS_RELATIVE_PATH, TILE_KIND, TileCensusError,
                                          validate_tile_census)

TILE_KEY_PREFIX = 'tile:'
PASS_STATUS = 'pass'
GAP_STATUS = 'gap'
FAILED_STATUS = 'failed'
PENDING_STATUS = 'pending'
BATCH_PENDING_REASON = 'batch-pending'
OBJECT_GAPS_REASON_PREFIX = 'object-gaps:'
UPSTREAM_STEP_FAILED_REASON_PREFIX = 'upstream-step-failed:'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'
SEAL_INSPECTION_ALGORITHM_VERSION = 1


class SealedTileStep(NamedTuple):
    gap_rows: list
    evidence: str


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


def seal_inspection_ledger(project_root, step):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), step, SEAL_INSPECTION_ALGORITHM_VERSION)


def sealed_tile_step(project_root, tile_id, step):
    ledger = seal_inspection_ledger(project_root, step)
    unit_key = tile_unit_key(tile_id)
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None:
        return None
    evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    return SealedTileStep(receipt['gapRows'], evidence)


def unit_step_evidence(project_root, tile_id, step):
    ledger = seal_inspection_ledger(project_root, step)
    return ledger.unit_step_directory(tile_unit_key(tile_id)).relative_to(ledger.lane_folder).as_posix()


def first_line_of_error(error):
    message_lines = str(error).strip().splitlines()
    return message_lines[0] if message_lines else 'no message'


def failed_step_row(tile_id, step, source_identity, error, evidence):
    reason = f'{DECODE_FAILED_REASON_PREFIX}{type(error).__name__}:{first_line_of_error(error)}'
    return tile_step_row(tile_id, step, FAILED_STATUS, reason, source_identity, evidence)


def upstream_failed_row(tile_id, step, source_identity, failed_step, evidence):
    return tile_step_row(tile_id, step, PENDING_STATUS, f'{UPSTREAM_STEP_FAILED_REASON_PREFIX}{failed_step}', source_identity, evidence)


def sealed_step_row(tile_id, step, source_identity, sealed_step):
    step_level_gap_rows = [row for row in sealed_step.gap_rows if 'object' not in row['sourceIdentity']]
    if step_level_gap_rows:
        first_row = step_level_gap_rows[0]
        return tile_step_row(tile_id, step, first_row['status'], first_row['reason'], source_identity, sealed_step.evidence)
    object_gap_count = len(sealed_step.gap_rows)
    if object_gap_count:
        return tile_step_row(tile_id, step, GAP_STATUS, f'{OBJECT_GAPS_REASON_PREFIX}{object_gap_count}', source_identity, sealed_step.evidence)
    return tile_step_row(tile_id, step, PASS_STATUS, None, source_identity, sealed_step.evidence)


def step_level_rows(tile_id, source_identity, step_names, step_results, sealed_steps):
    rows = []
    for step in step_names:
        if step in step_results:
            rows.append(step_results[step])
        elif step in sealed_steps:
            rows.append(sealed_step_row(tile_id, step, source_identity, sealed_steps[step]))
        else:
            rows.append(tile_step_row(tile_id, step, PENDING_STATUS, BATCH_PENDING_REASON, source_identity, TILE_CENSUS_RELATIVE_PATH))
    return rows


def seal_derived_step_row(project_root, row):
    tile_id = row['key'].removeprefix(TILE_KEY_PREFIX)
    if row['status'] == FAILED_STATUS:
        return row
    sealed_step = sealed_tile_step(project_root, tile_id, row['step'])
    return row if sealed_step is None else sealed_step_row(tile_id, row['step'], row['sourceIdentity'], sealed_step)
