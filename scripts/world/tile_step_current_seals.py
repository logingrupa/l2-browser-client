from typing import NamedTuple

from native_store.unit_ledger import RECEIPT_RECORD_NAME
from world.bsp_step import BSP_STEP_NAME, bsp_ledger, sealed_bsp_unit_config
from world.bsp_visibility_step import BSP_VISIBILITY_STEP_NAME, bsp_visibility_ledger, bsp_visibility_unit
from world.collision_step import COLLISION_STEP_NAME, collision_ledger, collision_unit
from world.lighting_step import LIGHTING_STEP_NAME, lighting_ledger, lighting_unit
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_inputs
from world.map_emitter_step import MAP_EMITTER_STEP_NAME, map_emitter_ledger, map_emitter_unit
from world.minimap_route_step import current_minimap_route
from world.minimap_step import MINIMAP_STEP_NAME, current_minimap_receipt, minimap_input_records, minimap_ledger, upstream_sealed_fingerprints
from world.mover_step import MOVER_STEP_NAME, mover_ledger, sealed_mover_unit_config
from world.raw_map_step import (RAW_STEP_NAME, raw_map_ledger, raw_map_unit, raw_map_unit_fingerprint, read_map_lock_record, read_tile_map_lock_record,
                                require_tile_id, tile_unit_key)
from world.sky_step import SKY_STEP_NAME, sky_ledger, sky_unit_config
from world.static_mesh_step import STATIC_MESH_STEP_NAME, static_mesh_ledger, static_mesh_unit
from world.terrain_chunk_step import TERRAIN_STEP_NAME, TerrainChunkStepError, sealed_terrain_chunks, terrain_step_ledger, terrain_unit
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, ChunkPlanStepError, chunk_plan_ledger, chunk_plan_unit
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME, tile_manifest_ledger, tile_manifest_unit
from world.tile_music import pinned_music_encoder
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_ledger, world_audio_unit_config

CURRENT_SEAL_STATE = 'current'
STALE_SEAL_STATE = 'stale'
PENDING_SEAL_STATE = 'pending'
UNSEALED_STATE = 'unsealed'


class TileStepSealError(ValueError):
    pass


class UpstreamUnitPendingError(ValueError):
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


def receipt_matches_unit_fingerprint(step_unit, project_root, unit_key, ledger):
    tile_id = tile_id_of_unit_key(unit_key)
    return ledger.is_sealed(unit_key, step_unit(project_root, tile_id, read_tile_map_lock_record(tile_id)).fingerprint)


def receipt_matches_locked_input_config(step_config, project_root, unit_key, ledger):
    tile_id = tile_id_of_unit_key(unit_key)
    config = step_config(project_root, tile_id, read_tile_map_lock_record(tile_id))
    return receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config) is not None


def raw_seal_is_current(project_root, unit_key, ledger):
    unit = raw_map_unit(project_root, unit_key.partition(':')[2])
    if unit.key != unit_key:
        raise TileStepSealError(f'raw unit key {unit_key!r} names census unit {unit.key!r}')
    return ledger.is_sealed(unit_key, raw_map_unit_fingerprint(project_root, unit.map_path, read_map_lock_record(unit.map_path)))


def chunk_plan_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(chunk_plan_unit, project_root, unit_key, ledger)


def terrain_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(terrain_unit, project_root, unit_key, ledger)


def static_mesh_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(static_mesh_unit, project_root, unit_key, ledger)


def collision_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(collision_unit, project_root, unit_key, ledger)


def map_emitter_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(map_emitter_unit, project_root, unit_key, ledger)


def bsp_visibility_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(bsp_visibility_unit, project_root, unit_key, ledger)


def lighting_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_unit_fingerprint(lighting_unit, project_root, unit_key, ledger)


def bsp_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_locked_input_config(sealed_bsp_unit_config, project_root, unit_key, ledger)


def sky_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_locked_input_config(sky_unit_config, project_root, unit_key, ledger)


def current_world_audio_unit_config(project_root, tile_id, lock_record):
    return world_audio_unit_config(project_root, tile_id, lock_record, pinned_music_encoder())


def world_audio_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_locked_input_config(current_world_audio_unit_config, project_root, unit_key, ledger)


def pending_unless_mover_class_receipt_sealed(project_root, tile_id, lock_record):
    config = sealed_mover_unit_config(project_root, tile_id, lock_record)
    if config is None:
        raise UpstreamUnitPendingError(f'mover class defaults receipt is not sealed for {tile_unit_key(tile_id)}')
    return config


def mover_seal_is_current(project_root, unit_key, ledger):
    return receipt_matches_locked_input_config(pending_unless_mover_class_receipt_sealed, project_root, unit_key, ledger)


def minimap_seal_is_current(project_root, unit_key, ledger):
    tile_id = tile_id_of_unit_key(unit_key)
    pending_upstream_step, upstream = upstream_sealed_fingerprints(project_root, tile_id, read_tile_map_lock_record(tile_id))
    if pending_upstream_step is not None:
        raise UpstreamUnitPendingError(f'minimap of {unit_key} waits for its {pending_upstream_step} unit')
    config, _ = upstream
    return current_minimap_route(project_root).product is not None and current_minimap_receipt(ledger, unit_key, config, minimap_input_records(tile_id)) is not None


def tile_manifest_seal_is_current(project_root, unit_key, ledger):
    tile_id = tile_id_of_unit_key(unit_key)
    lock_record = read_tile_map_lock_record(tile_id)
    current_terrain_unit, _, _ = sealed_terrain_chunks(project_root, tile_id, lock_record)
    return ledger.is_sealed(unit_key, tile_manifest_unit(project_root, tile_id, lock_record, current_terrain_unit).fingerprint)


TILE_STEP_SEAL_CHECKS = {
    RAW_STEP_NAME: TileStepSealCheck(raw_map_ledger, raw_seal_is_current, ()),
    CHUNK_PLAN_STEP_NAME: TileStepSealCheck(chunk_plan_ledger, chunk_plan_seal_is_current, (ChunkPlanStepError,)),
    TERRAIN_STEP_NAME: TileStepSealCheck(terrain_step_ledger, terrain_seal_is_current, (ChunkPlanStepError,)),
    STATIC_MESH_STEP_NAME: TileStepSealCheck(static_mesh_ledger, static_mesh_seal_is_current, (ChunkPlanStepError,)),
    BSP_STEP_NAME: TileStepSealCheck(bsp_ledger, bsp_seal_is_current, (ChunkPlanStepError,)),
    MOVER_STEP_NAME: TileStepSealCheck(mover_ledger, mover_seal_is_current, (ChunkPlanStepError, UpstreamUnitPendingError)),
    COLLISION_STEP_NAME: TileStepSealCheck(collision_ledger, collision_seal_is_current, (ChunkPlanStepError,)),
    MAP_EMITTER_STEP_NAME: TileStepSealCheck(map_emitter_ledger, map_emitter_seal_is_current, (ChunkPlanStepError,)),
    BSP_VISIBILITY_STEP_NAME: TileStepSealCheck(bsp_visibility_ledger, bsp_visibility_seal_is_current, (ChunkPlanStepError,)),
    SKY_STEP_NAME: TileStepSealCheck(sky_ledger, sky_seal_is_current, (ChunkPlanStepError,)),
    WORLD_AUDIO_STEP_NAME: TileStepSealCheck(world_audio_ledger, world_audio_seal_is_current, (ChunkPlanStepError,)),
    LIGHTING_STEP_NAME: TileStepSealCheck(lighting_ledger, lighting_seal_is_current, (ChunkPlanStepError,)),
    MINIMAP_STEP_NAME: TileStepSealCheck(minimap_ledger, minimap_seal_is_current, (UpstreamUnitPendingError,)),
    TILE_MANIFEST_STEP_NAME: TileStepSealCheck(tile_manifest_ledger, tile_manifest_seal_is_current, (ChunkPlanStepError, TerrainChunkStepError)),
}


def unit_step_directory_evidence(project_root, unit_key, step, step_seal_checks):
    ledger = step_seal_checks[step].step_ledger(project_root)
    return ledger.unit_step_directory(unit_key).relative_to(ledger.lane_folder).as_posix()


def unit_step_seal(project_root, unit_key, step, step_seal_checks):
    check = step_seal_checks[step]
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
