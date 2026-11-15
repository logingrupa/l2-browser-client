from types import SimpleNamespace

from native_assets_lib.class_defaults import ClassDefaultError
from support.actor_class_defaults import ACTOR_DEFAULTS, SYNTHETIC_ACTOR_CLASS_DEFAULTS, SyntheticActorClassDefaults
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from world.light_actors import ClassChains
from world.static_collision_sources import load_collision_rules

SYNTHETIC_TILE_ID = '00_00'
SYNTHETIC_CHUNK_ID = 'chunk-0-0'
WATER_VOLUME_CLASS = 'Gameplay.WaterVolume'
PHYSICS_VOLUME_CLASS = 'Engine.PhysicsVolume'
BLOCKING_VOLUME_CLASS = 'Engine.BlockingVolume'
MUSIC_VOLUME_CLASS = 'Engine.MusicVolume'
STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
UNREADABLE_CLASS = 'Synthetic.UnreadableClass'
SYNTHETIC_GRAVITY = {'X': 0.0, 'Y': 0.0, 'Z': -321.0}
SYNTHETIC_TERMINAL_VELOCITY = 654.0
PHYSICS_VOLUME_DECLARATIONS = [{'name': 'bL2WaterVolume', 'type': 'bool'}, {'name': 'Priority', 'type': 'int'}, {'name': 'Gravity', 'type': 'Vector'},
                               {'name': 'TerminalVelocity', 'type': 'float'}]
VOLUME_CHAIN_TAIL = ('Engine.Volume', 'Engine.Brush', 'Engine.Actor')
SYNTHETIC_CLASS_CHAINS = {
    WATER_VOLUME_CLASS: ('GamePlay.WaterVolume', PHYSICS_VOLUME_CLASS, *VOLUME_CHAIN_TAIL),
    PHYSICS_VOLUME_CLASS: (PHYSICS_VOLUME_CLASS, *VOLUME_CHAIN_TAIL),
    BLOCKING_VOLUME_CLASS: (BLOCKING_VOLUME_CLASS, *VOLUME_CHAIN_TAIL),
    MUSIC_VOLUME_CLASS: (MUSIC_VOLUME_CLASS, *VOLUME_CHAIN_TAIL),
    STATIC_MESH_ACTOR_CLASS: (STATIC_MESH_ACTOR_CLASS, 'Engine.Actor'),
    'Engine.MovableStaticMeshActor': ('Engine.MovableStaticMeshActor', STATIC_MESH_ACTOR_CLASS, 'Engine.Actor'),
}
PHYSICS_FIELD_DEFAULTS = {'bL2WaterVolume': (None, 'ue-zero', PHYSICS_VOLUME_CLASS), 'Priority': (None, 'ue-zero', PHYSICS_VOLUME_CLASS),
                          'Gravity': (SYNTHETIC_GRAVITY, 'class-default', PHYSICS_VOLUME_CLASS),
                          'TerminalVelocity': (SYNTHETIC_TERMINAL_VELOCITY, 'class-default', PHYSICS_VOLUME_CLASS)}
VOLUME_ACTOR_DEFAULTS = {**ACTOR_DEFAULTS, 'bCollideActors': (True, 'class-default', 'Engine.Volume')}
WATER_VOLUME_CLASS_DEFAULTS = {
    **SYNTHETIC_ACTOR_CLASS_DEFAULTS,
    PHYSICS_VOLUME_CLASS: {**VOLUME_ACTOR_DEFAULTS, **PHYSICS_FIELD_DEFAULTS},
    WATER_VOLUME_CLASS: {**VOLUME_ACTOR_DEFAULTS, **PHYSICS_FIELD_DEFAULTS, 'bL2WaterVolume': (True, 'class-default', 'GamePlay.WaterVolume')},
    MUSIC_VOLUME_CLASS: VOLUME_ACTOR_DEFAULTS,
}
OMITTED = {'status': 'omitted-class-default-unresolved'}


def read_synthetic_volume_chain(class_name):
    if class_name not in SYNTHETIC_CLASS_CHAINS:
        raise ClassDefaultError(f'no class script for {class_name}')
    return [{'identity': {'object': name}, 'declaredFields': PHYSICS_VOLUME_DECLARATIONS if name == PHYSICS_VOLUME_CLASS else []}
            for name in SYNTHETIC_CLASS_CHAINS[class_name]]


def synthetic_volume_actor(class_object, export_index, properties=()):
    return {'id': f'interlude:{SYNTHETIC_TILE_ID}.Actor{export_index}', 'object': f'{SYNTHETIC_TILE_ID}.Actor{export_index}', 'exportIndex': export_index,
            'classObject': class_object, 'collision': {},
            'properties': [{'name': 'Brush', 'status': 'decoded', 'value': {'index': 1, 'object': 'Fixture.Model1'}},
                           *({'name': name, 'status': 'decoded', 'value': value} for name, value in properties)],
            'sourceTransform': {name: OMITTED for name in ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')}}


def synthetic_volume_context():
    class_evidence = SyntheticActorClassDefaults(WATER_VOLUME_CLASS_DEFAULTS)
    return {'rules': load_collision_rules(), 'classEvidence': class_evidence, 'classChains': ClassChains(class_evidence, read_synthetic_volume_chain)}


def synthetic_volume_map():
    brush = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64))], root_outside=1)
    reader = SimpleNamespace(_read_model=lambda adapter, export, layout: brush, validate_graph=lambda nodes: len(nodes))
    package = SimpleNamespace(exports=[{'classObject': 'Engine.Model', 'object': 'Fixture.Model1'}])
    level = SimpleNamespace(adapter=SimpleNamespace(exports=[object()], licensee_version=28), reader=reader)
    rectangles = [SimpleNamespace(minimum=(-4096.0, -4096.0), maximum=(4096.0, 4096.0), chunk_id=SYNTHETIC_CHUNK_ID)]
    return package, level, rectangles
