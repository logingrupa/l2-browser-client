import json
from pathlib import Path
from typing import NamedTuple

from world.raw_map_step import TILE_ID_PATTERN, read_tile_map_lock_record, tile_map_path, tile_step_row, tile_unit_key, unit_step_row
from world.tile_census_validation import (ELIGIBLE_STATUS, TILE_CENSUS_RELATIVE_PATH, TILE_KIND, TileCensusError,
                                          validate_tile_census)
from world.tile_step_current_seals import CURRENT_SEAL_STATE, TILE_STEP_SEAL_CHECKS, unit_step_directory_evidence, unit_step_seal
from world.tile_step_gap_rows import PENDING_STATUS

TILE_KEY_PREFIX = 'tile:'
PASS_STATUS = 'pass'
GAP_STATUS = 'gap'
FAILED_STATUS = 'failed'
BATCH_PENDING_REASON = 'batch-pending'
OBJECT_GAPS_REASON_PREFIX = 'object-gaps:'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'


class StepSealMissingError(ValueError):
    pass


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


def locked_tile_source_identity(tile_id):
    return {'path': tile_map_path(tile_id), 'sha256': read_tile_map_lock_record(tile_id)['eSha256']}


def own_step_row(step, rows):
    matching_rows = [row for row in rows if row['step'] == step]
    if len(matching_rows) != 1:
        raise StepSealMissingError(f'step {step} returned {len(matching_rows)} rows of its own step')
    return matching_rows[0]


def sealed_step_of_current_seal(seal):
    return SealedTileStep(seal.receipt['gapRows'], seal.evidence) if seal.state == CURRENT_SEAL_STATE else None


def sealed_unit_step(project_root, unit_key, step, step_seal_checks):
    return sealed_step_of_current_seal(unit_step_seal(project_root, unit_key, step, step_seal_checks))


def sealed_tile_step(project_root, tile_id, step, step_seal_checks):
    return sealed_unit_step(project_root, tile_unit_key(tile_id), step, step_seal_checks)


def unit_step_evidence(project_root, tile_id, step, step_seal_checks=TILE_STEP_SEAL_CHECKS):
    return unit_step_directory_evidence(project_root, tile_unit_key(tile_id), step, step_seal_checks)


def first_line_of_error(error):
    message_lines = str(error).strip().splitlines()
    return message_lines[0] if message_lines else 'no message'


def failed_step_row(tile_id, step, source_identity, error, evidence):
    reason = f'{DECODE_FAILED_REASON_PREFIX}{type(error).__name__}:{first_line_of_error(error)}'
    return tile_step_row(tile_id, step, FAILED_STATUS, reason, source_identity, evidence)


def sealed_unit_step_row(unit_key, step, source_identity, sealed_step):
    step_level_gap_rows = [row for row in sealed_step.gap_rows if 'object' not in row['sourceIdentity']]
    if step_level_gap_rows:
        first_row = step_level_gap_rows[0]
        return unit_step_row(unit_key, step, first_row['status'], first_row['reason'], source_identity, sealed_step.evidence)
    object_gap_count = len(sealed_step.gap_rows)
    if object_gap_count:
        return unit_step_row(unit_key, step, GAP_STATUS, f'{OBJECT_GAPS_REASON_PREFIX}{object_gap_count}', source_identity, sealed_step.evidence)
    return unit_step_row(unit_key, step, PASS_STATUS, None, source_identity, sealed_step.evidence)


def step_level_rows(tile_id, source_identity, step_names, step_results, sealed_steps):
    rows = []
    for step in step_names:
        if step in step_results:
            rows.append(step_results[step])
        elif step in sealed_steps:
            rows.append(sealed_unit_step_row(tile_unit_key(tile_id), step, source_identity, sealed_steps[step]))
        else:
            rows.append(tile_step_row(tile_id, step, PENDING_STATUS, BATCH_PENDING_REASON, source_identity, TILE_CENSUS_RELATIVE_PATH))
    return rows


def seal_derived_step_row(project_root, row, step_seal_checks=TILE_STEP_SEAL_CHECKS):
    if row['status'] == FAILED_STATUS:
        return row
    sealed_step = sealed_unit_step(project_root, row['key'], row['step'], step_seal_checks)
    return row if sealed_step is None else sealed_unit_step_row(row['key'], row['step'], row['sourceIdentity'], sealed_step)
