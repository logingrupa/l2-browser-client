from pathlib import Path

from world.bsp_step import BSP_STEP_NAME, run_bsp_step
from world.bsp_visibility_step import BSP_VISIBILITY_STEP_NAME, run_bsp_visibility_step
from world.collision_step import COLLISION_STEP_NAME, run_collision_step
from world.lighting_step import LIGHTING_STEP_NAME, run_lighting_step
from world.map_emitter_step import MAP_EMITTER_STEP_NAME, run_map_emitter_step
from world.minimap_step import MINIMAP_STEP_NAME, run_minimap_step
from world.mover_step import MOVER_STEP_NAME, run_mover_step
from world.raw_map_step import RAW_STEP_NAME, run_raw_map_step
from world.sky_step import SKY_STEP_NAME, run_sky_step
from world.static_mesh_step import STATIC_MESH_STEP_NAME, run_static_mesh_step
from world.terrain_chunk_step import TERRAIN_STEP_NAME, run_terrain_chunk_step
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, run_chunk_plan_step
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME, run_tile_manifest_step
from world.tile_step_current_seals import TILE_STEP_SEAL_CHECKS
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, run_world_audio_step


def source_tile_step_runners():
    return {RAW_STEP_NAME: run_raw_map_step, CHUNK_PLAN_STEP_NAME: run_chunk_plan_step, TERRAIN_STEP_NAME: run_terrain_chunk_step,
            STATIC_MESH_STEP_NAME: run_static_mesh_step, BSP_STEP_NAME: run_bsp_step, MOVER_STEP_NAME: run_mover_step,
            COLLISION_STEP_NAME: run_collision_step, MAP_EMITTER_STEP_NAME: run_map_emitter_step,
            BSP_VISIBILITY_STEP_NAME: run_bsp_visibility_step, SKY_STEP_NAME: run_sky_step,
            WORLD_AUDIO_STEP_NAME: run_world_audio_step, LIGHTING_STEP_NAME: run_lighting_step,
            MINIMAP_STEP_NAME: run_minimap_step}


class TileStepRegistryError(ValueError):
    pass


def registered_tile_step_names(step_seal_checks):
    step_names = (*source_tile_step_runners(), TILE_MANIFEST_STEP_NAME)
    if set(step_names) != set(step_seal_checks):
        raise TileStepRegistryError(f'every registered tile step needs exactly one current-seal check: steps {sorted(step_names)}, '
                                    f'checks {sorted(step_seal_checks)}')
    return step_names


TILE_STEP_NAMES = registered_tile_step_names(TILE_STEP_SEAL_CHECKS)
DEFAULT_TILE_STORE_OUTPUT = Path('artifacts') / 'lane-store' / WORLD_LANE_NAME / 'l2'


def run_tile_step(project_root, step, client, tile_id, guarded_store_root):
    if step == TILE_MANIFEST_STEP_NAME:
        return run_tile_manifest_step(project_root, tile_id, guarded_store_root)
    return [source_tile_step_runners()[step](project_root, client, tile_id)]
