import struct

from native_catalog.ue2 import Package
from support.actor_class_defaults import SyntheticActorClassDefaults
from ue2_package_fixture import compact, package_bytes, tag

FLOAT_PROPERTY_TYPE = 4
LIGHT_CLASS = 'Engine.Light'
FOG_INFO_CLASS = 'Engine.L2FogInfo'
LEVEL_INFO_CLASS = 'Engine.LevelInfo'
STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
ACTOR_CLASS = 'Engine.Actor'
LIGHTING_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Light'), ('Core', 'Class', -1, 'L2FogInfo'),
                    ('Core', 'Class', -1, 'LevelInfo'), ('Core', 'Class', -1, 'StaticMeshInstance'), ('Core', 'Class', -1, 'TerrainSector')]
LIGHT_CLASS_IMPORT, FOG_INFO_CLASS_IMPORT, LEVEL_INFO_CLASS_IMPORT, INSTANCE_CLASS_IMPORT, SECTOR_CLASS_IMPORT = -2, -3, -4, -5, -6
PROPERTY_NAMES = ['LightBrightness']
SCENE_LIGHTS = ((1, b'\x05', 0), (2, b'\x0a\x01', 1))
ENVIRONMENT_LIGHTS = ((1, b'\xff', 1),)
SECTOR_LIGHTS = ((1, b'\x03\x00'),)
SECTOR_SHADOW_MAPS = (bytes(range(17)) * 17, bytes(range(17, 34)) * 17)
SECTOR_TEXTURE_INFO_WORDS = 3
SYNTHETIC_CHAINS = {
    LIGHT_CLASS: [{'identity': {'object': LIGHT_CLASS}, 'declaredFields': [{'name': 'LightType'}, {'name': 'LightEffect'}, {'name': 'LightBrightness'}]},
                  {'identity': {'object': ACTOR_CLASS}, 'declaredFields': [{'name': 'Location'}, {'name': 'Rotation'}]}],
    FOG_INFO_CLASS: [{'identity': {'object': FOG_INFO_CLASS}, 'declaredFields': [{'name': 'AffectRange'}, {'name': 'FogRange1'}]},
                     {'identity': {'object': ACTOR_CLASS}, 'declaredFields': [{'name': 'Location'}]}],
    LEVEL_INFO_CLASS: [{'identity': {'object': LEVEL_INFO_CLASS}, 'declaredFields': [{'name': 'Brightness'}]}],
}
ACTOR_LIGHT_DEFAULTS = {'Location': (None, 'ue-zero', ACTOR_CLASS), 'Rotation': (None, 'ue-zero', ACTOR_CLASS),
                        'bDynamicLight': (None, 'ue-zero', ACTOR_CLASS), 'bDirectional': (None, 'ue-zero', ACTOR_CLASS)}
LIGHTING_CLASS_DEFAULTS = SyntheticActorClassDefaults({
    LIGHT_CLASS: {**ACTOR_LIGHT_DEFAULTS, 'LightType': (1, 'class-default', LIGHT_CLASS), 'LightEffect': (None, 'ue-zero', LIGHT_CLASS),
                  'LightBrightness': (64.0, 'class-default', LIGHT_CLASS)},
    FOG_INFO_CLASS: {'Location': (None, 'ue-zero', ACTOR_CLASS), 'AffectRange': (None, 'ue-zero', FOG_INFO_CLASS),
                     'FogRange1': (None, 'ue-zero', FOG_INFO_CLASS)},
    LEVEL_INFO_CLASS: {'Brightness': (1.0, 'class-default', LEVEL_INFO_CLASS)},
})


def read_synthetic_chain(class_name):
    return SYNTHETIC_CHAINS.get(class_name, [{'identity': {'object': class_name}, 'declaredFields': []}])


def light_entry_bytes(entries):
    return compact(len(entries)) + b''.join(compact(reference) + compact(len(bits)) + bits + struct.pack('<i', applied) for reference, bits, applied in entries)


def static_mesh_instance_body(offset, names):
    return (compact(names['None']) + compact(2) + bytes(8) + struct.pack('<i', 0) + light_entry_bytes(SCENE_LIGHTS)
            + light_entry_bytes(ENVIRONMENT_LIGHTS) + compact(0) + compact(0))


def terrain_sector_body(offset, names):
    head = compact(names['None']) + compact(0) + struct.pack('<4i', 16, 16, 0, 0) + struct.pack('<6f', 0, 0, 0, 1, 1, 1) + bytes([1])
    lights = compact(len(SECTOR_LIGHTS)) + b''.join(compact(reference) + compact(len(bits)) + bits for reference, bits in SECTOR_LIGHTS)
    shadow_maps = struct.pack('<ii', 1, len(SECTOR_SHADOW_MAPS)) + b''.join(compact(len(shadow_map)) + shadow_map for shadow_map in SECTOR_SHADOW_MAPS)
    return head + lights + shadow_maps + bytes(64) + compact(SECTOR_TEXTURE_INFO_WORDS) + bytes(2 * SECTOR_TEXTURE_INFO_WORDS)


def synthetic_lighting_package():
    exports = [{'name': 'Light0', 'class': LIGHT_CLASS_IMPORT,
                'body': lambda offset, names: tag(names, 'LightBrightness', FLOAT_PROPERTY_TYPE, struct.pack('<f', 56.0)) + compact(names['None'])},
               {'name': 'L2FogInfo0', 'class': FOG_INFO_CLASS_IMPORT, 'body': lambda offset, names: compact(names['None'])},
               {'name': 'LevelInfo0', 'class': LEVEL_INFO_CLASS_IMPORT, 'body': lambda offset, names: compact(names['None'])},
               {'name': 'StaticMeshInstance0', 'class': INSTANCE_CLASS_IMPORT, 'body': static_mesh_instance_body},
               {'name': 'TerrainSector0', 'class': SECTOR_CLASS_IMPORT, 'body': terrain_sector_body}]
    return Package(package_bytes(PROPERTY_NAMES, LIGHTING_IMPORTS, exports), '00_00.unr')


def synthetic_actor_rows():
    return [{'exportIndex': 1, 'object': '00_00.Light0', 'classObject': LIGHT_CLASS, 'properties': []},
            {'exportIndex': 2, 'object': '00_00.L2FogInfo0', 'classObject': FOG_INFO_CLASS, 'properties': []},
            {'exportIndex': 3, 'object': '00_00.LevelInfo0', 'classObject': LEVEL_INFO_CLASS, 'properties': []},
            {'exportIndex': 9, 'object': '00_00.StaticMeshActor0', 'classObject': STATIC_MESH_ACTOR_CLASS,
             'properties': [{'name': 'StaticMeshInstance', 'value': {'index': 4, 'object': '00_00.StaticMeshInstance0'}}]}]
