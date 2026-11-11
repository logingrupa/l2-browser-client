from typing import NamedTuple

from native_store.store_paths import lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_inputs
from world.raw_map_step import read_tile_map_lock_record, require_tile_id, tile_unit_key
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import ChunkPlanStepError
from world.tile_music import pinned_music_encoder
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_ledger, world_audio_unit_config

CURRENT_SEAL_STATE = 'current'
STALE_SEAL_STATE = 'stale'
PENDING_SEAL_STATE = 'pending'
UNSEALED_STATE = 'unsealed'
SEAL_INSPECTION_ALGORITHM_VERSION = 1


class TileStepSealError(ValueError):
    pass


class TileStepSealCheck(NamedTuple):
    step_ledger: object
    is_receipt_current: object
    pending_upstream_errors: tuple


class UnitStepSeal(NamedTuple):
    state: str
    receipt: dict | None
    evidence: str


def tile_id_of_unit_key(unit_key):
    tile_id = unit_key.partition(':')[2]
    if tile_unit_key(tile_id) != unit_key:
        raise TileStepSealError(f'a tile step seal needs a tile unit key: {unit_key!r}')
    return require_tile_id(tile_id)


def world_audio_seal_is_current(project_root, unit_key, ledger):
    tile_id = tile_id_of_unit_key(unit_key)
    config = world_audio_unit_config(project_root, tile_id, read_tile_map_lock_record(tile_id), pinned_music_encoder())
    return receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config) is not None


TILE_STEP_SEAL_CHECKS = {WORLD_AUDIO_STEP_NAME: TileStepSealCheck(world_audio_ledger, world_audio_seal_is_current, (ChunkPlanStepError,))}


def seal_inspection_ledger(project_root, step):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), step, SEAL_INSPECTION_ALGORITHM_VERSION)


def any_seal_is_current(project_root, unit_key, ledger):
    return True


def tile_step_seal_check(step, step_seal_checks):
    if step in step_seal_checks:
        return step_seal_checks[step]
    return TileStepSealCheck(lambda project_root: seal_inspection_ledger(project_root, step), any_seal_is_current, ())


def unit_step_directory_evidence(project_root, unit_key, step, step_seal_checks):
    ledger = tile_step_seal_check(step, step_seal_checks).step_ledger(project_root)
    return ledger.unit_step_directory(unit_key).relative_to(ledger.lane_folder).as_posix()


def unit_step_seal(project_root, unit_key, step, step_seal_checks):
    check = tile_step_seal_check(step, step_seal_checks)
    ledger = check.step_ledger(project_root)
    evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None:
        return UnitStepSeal(UNSEALED_STATE, None, evidence)
    try:
        is_current = check.is_receipt_current(project_root, unit_key, ledger)
    except check.pending_upstream_errors:
        return UnitStepSeal(PENDING_SEAL_STATE, None, evidence)
    return UnitStepSeal(CURRENT_SEAL_STATE, receipt, evidence) if is_current else UnitStepSeal(STALE_SEAL_STATE, None, evidence)
