from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError, cached_class_chain
from native_catalog.ue2 import FormatError
from world.actor_field_values import resolved_actor_field, serialized_actor_values
from world.bsp_leaf_membership import leaf_for_point

LIGHT_BASE_CLASS = 'Engine.Light'
FOG_INFO_BASE_CLASS = 'Engine.L2FogInfo'
LEVEL_INFO_CLASS = 'Engine.LevelInfo'
WATER_VOLUME_BASE_CLASS = 'Gameplay.WaterVolume'
STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
STATIC_MESH_INSTANCE_CLASS = 'Engine.StaticMeshInstance'
STATIC_MESH_INSTANCE_FIELD = 'StaticMeshInstance'
LEVEL_BRIGHTNESS_FIELD = 'Brightness'
LOCATION_FIELD = 'Location'
LIGHT_ACTOR_FIELDS = (LOCATION_FIELD, 'Rotation', 'bDynamicLight', 'bDirectional')
FOG_INFO_ACTOR_FIELDS = (LOCATION_FIELD,)
WATER_VOLUME_ACTOR_FIELDS = (LOCATION_FIELD, 'bWaterVolume', 'bDistanceFog', 'DistanceFogColor', 'DistanceFogStart', 'DistanceFogEnd')
LOCATION_AXES = ('X', 'Y', 'Z')
UE_ZERO_PROVENANCE = 'ue-zero'
UE_ZERO_LOCATION = (0.0, 0.0, 0.0)
MAXIMUM_INSTANCE_COLORS = 4_000_000
MAXIMUM_INSTANCE_LIGHTS = 65_536
MAXIMUM_VISIBILITY_BYTES = 1 << 20


class LightingActor(NamedTuple):
    export_index: int
    object: str
    actor_class: str
    base_class: str
    zone: int | None
    fields: tuple

    def to_record(self):
        return {'exportIndex': self.export_index, 'object': self.object, 'actorClass': self.actor_class, 'baseClass': self.base_class,
                'zone': self.zone, 'fields': [field.to_record() for field in self.fields]}


class LightingActors(NamedTuple):
    lights: tuple
    fog_infos: tuple
    level_infos: tuple
    water_volumes: tuple
    unresolved_classes: tuple


class StaticMeshLightEntry(NamedTuple):
    light_reference: int
    visibility_bits: bytes
    applied: int


class StaticMeshLightList(NamedTuple):
    actor_export_index: int
    instance_export_index: int
    scene_lights: tuple
    environment_lights: tuple
    color_count: int


class ClassChains:
    def __init__(self, class_defaults, read_chain):
        self.class_defaults, self.read_chain, self.chains = class_defaults, read_chain, {}

    def chain(self, class_name):
        if class_name not in self.chains:
            try:
                self.chains[class_name] = tuple(self.read_chain(class_name))
            except ClassDefaultError:
                self.chains[class_name] = None
        return self.chains[class_name]

    def casefolded_class_names(self, class_name):
        return tuple(definition['identity']['object'].casefold() for definition in self.chain(class_name))

    def is_subclass(self, class_name, base_class):
        return base_class.casefold() in self.casefolded_class_names(class_name)

    def declared_fields_down_to(self, class_name, base_class):
        names = self.casefolded_class_names(class_name)
        chain = self.chain(class_name)[:names.index(base_class.casefold()) + 1]
        fields, seen = [], set()
        for definition in reversed(chain):
            for declared in definition['declaredFields']:
                if declared['name'].casefold() not in seen:
                    seen.add(declared['name'].casefold())
                    fields.append(declared['name'])
        return fields


def reference_client_class_chains(class_defaults):
    return ClassChains(class_defaults, lambda class_name: cached_class_chain(class_name, class_defaults.work_root, class_defaults.class_scripts))


def location_point(location_field):
    if location_field.provenance == UE_ZERO_PROVENANCE:
        return UE_ZERO_LOCATION
    value = location_field.value
    if not isinstance(value, dict) or set(LOCATION_AXES) - set(value):
        return None
    return tuple(float(value[axis]) for axis in LOCATION_AXES)


def placement_zone(model, location_field):
    point = location_point(location_field)
    if point is None:
        return None
    return leaf_for_point(model, point).zone


def lighting_actor(package, model, actor, class_chains, base_class, extra_fields):
    export = package.exports[actor['exportIndex'] - 1]
    serialized = serialized_actor_values(package, export)
    names = class_chains.declared_fields_down_to(actor['classObject'], base_class)
    names += [field for field in extra_fields if field.casefold() not in {name.casefold() for name in names}]
    fields = tuple(resolved_actor_field(name, serialized, actor['classObject'], class_chains.class_defaults) for name in names)
    location = next((field for field in fields if field.field == LOCATION_FIELD), None)
    zone = placement_zone(model, location) if location is not None else None
    return LightingActor(actor['exportIndex'], actor['object'], actor['classObject'], base_class, zone, fields)


def read_lighting_actors(package, model, actors, class_chains):
    lights, fog_infos, level_infos, water_volumes, unresolved_classes = [], [], [], [], set()
    for actor in actors:
        if actor['classObject'] == LEVEL_INFO_CLASS:
            export = package.exports[actor['exportIndex'] - 1]
            brightness = resolved_actor_field(LEVEL_BRIGHTNESS_FIELD, serialized_actor_values(package, export), actor['classObject'],
                                              class_chains.class_defaults)
            level_infos.append(LightingActor(actor['exportIndex'], actor['object'], actor['classObject'], LEVEL_INFO_CLASS, None, (brightness,)))
        elif class_chains.chain(actor['classObject']) is None:
            unresolved_classes.add(actor['classObject'])
        elif class_chains.is_subclass(actor['classObject'], LIGHT_BASE_CLASS):
            lights.append(lighting_actor(package, model, actor, class_chains, LIGHT_BASE_CLASS, LIGHT_ACTOR_FIELDS))
        elif class_chains.is_subclass(actor['classObject'], FOG_INFO_BASE_CLASS):
            fog_infos.append(lighting_actor(package, model, actor, class_chains, FOG_INFO_BASE_CLASS, FOG_INFO_ACTOR_FIELDS))
        elif class_chains.is_subclass(actor['classObject'], WATER_VOLUME_BASE_CLASS):
            water_volumes.append(lighting_actor(package, model, actor, class_chains, WATER_VOLUME_BASE_CLASS, WATER_VOLUME_ACTOR_FIELDS))
    return LightingActors(tuple(lights), tuple(fog_infos), tuple(level_infos), tuple(water_volumes), tuple(sorted(unresolved_classes)))


def instance_reference(actor):
    references = [prop['value'] for prop in actor['properties'] if prop['name'] == STATIC_MESH_INSTANCE_FIELD]
    if len(references) != 1 or not isinstance(references[0], dict) or type(references[0].get('index')) is not int:
        return None
    return references[0]['index']


def read_light_entries(reader, label):
    count = reader.compact()
    if not 0 <= count <= MAXIMUM_INSTANCE_LIGHTS:
        raise FormatError(f'{label} declares {count} lights')
    entries = []
    for _ in range(count):
        light_reference, byte_count = reader.compact(), reader.compact()
        if not 0 <= byte_count <= MAXIMUM_VISIBILITY_BYTES:
            raise FormatError(f'{label} declares {byte_count} visibility bytes')
        entries.append(StaticMeshLightEntry(light_reference, bytes(reader.take(byte_count)), reader.number('i')))
    return tuple(entries)


def read_static_mesh_light_list(package, actor_export_index, instance_export_index):
    if not 1 <= instance_export_index <= len(package.exports):
        raise FormatError(f'static mesh actor {actor_export_index} names instance {instance_export_index} outside the export table')
    instance = package.exports[instance_export_index - 1]
    if instance['classObject'] != STATIC_MESH_INSTANCE_CLASS:
        raise FormatError(f'static mesh actor {actor_export_index} names a {instance["classObject"]} as its instance')
    _, reader = package.properties(instance)
    color_count = reader.compact()
    if not 0 <= color_count <= MAXIMUM_INSTANCE_COLORS:
        raise FormatError(f'static mesh instance {instance_export_index} declares {color_count} colours')
    reader.take(4 * color_count)
    reader.number('i')
    label = f'static mesh instance {instance_export_index}'
    scene_lights, environment_lights = read_light_entries(reader, label), read_light_entries(reader, label)
    reader.compact()
    reader.compact()
    if reader.position != reader.end:
        raise FormatError(f'{label} holds {reader.end - reader.position} bytes after its light lists')
    return StaticMeshLightList(actor_export_index, instance_export_index, scene_lights, environment_lights, color_count)


def read_static_mesh_light_lists(package, actors):
    lists = []
    for actor in actors:
        if actor['classObject'] != STATIC_MESH_ACTOR_CLASS:
            continue
        reference = instance_reference(actor)
        if reference is not None:
            lists.append(read_static_mesh_light_list(package, actor['exportIndex'], reference))
    return tuple(lists)
