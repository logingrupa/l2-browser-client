from native_assets_lib.class_defaults import ClassDefaultError, ClassDefaultValue

ACTOR_CLASS = 'Engine.Actor'
UNIT_VECTOR = {'X': 1.0, 'Y': 1.0, 'Z': 1.0}
ACTOR_DEFAULTS = {
    'Location': (None, 'ue-zero', ACTOR_CLASS), 'Rotation': (None, 'ue-zero', ACTOR_CLASS), 'PrePivot': (None, 'ue-zero', ACTOR_CLASS),
    'DrawScale': (1.0, 'class-default', ACTOR_CLASS), 'DrawScale3D': (UNIT_VECTOR, 'class-default', ACTOR_CLASS),
    'bCollideActors': (None, 'ue-zero', ACTOR_CLASS), 'bBlockActors': (None, 'ue-zero', ACTOR_CLASS),
    'bBlockPlayers': (None, 'ue-zero', ACTOR_CLASS), 'bBlockNonZeroExtentTraces': (True, 'class-default', ACTOR_CLASS),
    'bStatic': (None, 'ue-zero', ACTOR_CLASS), 'Brush': (None, 'ue-zero', 'Engine.Brush')}
BLOCKING_DEFAULTS = {'bStatic': True, 'bCollideActors': True, 'bBlockActors': True, 'bBlockPlayers': True}
SYNTHETIC_ACTOR_CLASS_DEFAULTS = {
    'Engine.StaticMeshActor': {**ACTOR_DEFAULTS, **{field: (value, 'class-default', 'Engine.StaticMeshActor') for field, value in BLOCKING_DEFAULTS.items()}},
    'Engine.BlockingVolume': {**ACTOR_DEFAULTS, **{field: (value, 'class-default', 'Engine.BlockingVolume') for field, value in BLOCKING_DEFAULTS.items()}},
    'Engine.PhysicsVolume': {**ACTOR_DEFAULTS, 'bCollideActors': (True, 'class-default', 'Engine.Volume')},
    'Engine.TerrainInfo': {**ACTOR_DEFAULTS, 'Inverted': (None, 'ue-zero', 'Engine.TerrainInfo')},
}


class SyntheticActorClassDefaults:
    def __init__(self, defaults_by_class=None):
        self.defaults_by_class = SYNTHETIC_ACTOR_CLASS_DEFAULTS if defaults_by_class is None else defaults_by_class

    def values(self, class_name, fields):
        defaults = self.defaults_by_class[class_name]
        missing = [field for field in fields if field not in defaults]
        if missing:
            raise ClassDefaultError(f'{missing[0]} is not declared by the class chain of {class_name}')
        return {field: ClassDefaultValue(field, *defaults[field]) for field in fields}
