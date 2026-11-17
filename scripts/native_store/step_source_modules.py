from native_store.converter_source_closure import (ConverterSourceClosureError, process_converter_sources_sha256,
                                                   require_process_converter_sources_unchanged)

WORLD_STEP_SOURCE_MODULES = {
    'raw': ('world.raw_map_step',), 'chunks': ('world.tile_chunk_plan',), 'terrain': ('world.terrain_chunk_step',),
    'meshes': ('world.static_mesh_step',), 'static-mesh-materials': ('world.static_mesh_materials_step',),
    'terrain-material': ('world.terrain_material_step',), 'bsp': ('world.bsp_step',), 'movers': ('world.mover_step',),
    'collision': ('world.collision_step',), 'emitters': ('world.map_emitter_step',), 'bsp-visibility': ('world.bsp_visibility_step',),
    'sky': ('world.sky_step',), 'audio': ('world.world_audio_step',), 'lighting': ('world.lighting_step',),
    'minimap': ('world.minimap_step',), 'manifest': ('world.tile_manifest_step',), 'environment': ('world.environment_step',),
    'class-defaults': ('world.mover_class_defaults',), 'minimap-route': ('world.minimap_route_step',),
}
ACTORS_BATCH_SOURCE_MODULES = ('actors.convert_actors',)
ACTORS_STEP_NAMES = ('material-programs', 'actor-sound', 'actor-sounds', 'characters', 'npc-model', 'npc-profile', 'npc-profile-pack',
                     'items', 'skill-effect-root', 'skill-dispatch-class')
DATA_UI_STEP_SOURCE_MODULES = {
    'decode': ('data.convert_tables',), 'name-index': ('data.table_name_indexes',), 'textures': ('data.convert_ui',),
    'fonts': ('data.convert_ui',), 'controls': ('data.convert_ui',), 'layout': ('data.convert_ui',),
}
STEP_SOURCE_MODULES_BY_LANE = {
    'world': WORLD_STEP_SOURCE_MODULES,
    'actors': {step: ACTORS_BATCH_SOURCE_MODULES for step in ACTORS_STEP_NAMES},
    'data-ui': DATA_UI_STEP_SOURCE_MODULES,
}


class StepSourceModulesError(ValueError):
    pass


def step_source_modules(lane_name, step):
    source_modules = STEP_SOURCE_MODULES_BY_LANE.get(lane_name, {}).get(step)
    if source_modules is None:
        raise StepSourceModulesError(f'step {step} of lane {lane_name} names no converter source modules in '
                                     f'native_store/step_source_modules.py; add the modules whose code runs the step')
    return source_modules


def step_converter_sources_sha256(lane_name, step):
    try:
        return process_converter_sources_sha256(step_source_modules(lane_name, step))
    except ConverterSourceClosureError as error:
        raise StepSourceModulesError(f'step {step} of lane {lane_name}: {error}') from error


def require_step_converter_sources_unchanged(lane_name, step):
    try:
        require_process_converter_sources_unchanged(step_source_modules(lane_name, step))
    except ConverterSourceClosureError as error:
        raise StepSourceModulesError(f'step {step} of lane {lane_name}: {error}') from error
