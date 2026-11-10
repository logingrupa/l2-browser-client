from typing import NamedTuple

from native_assets_lib.class_defaults import ClassDefaultError
from native_effect_bundle import object_values
from world.map_actor_properties import actor_properties
from world.static_placement import placement_provenance

OUTDOOR_ZONE_INDEX = 0
SUN_AFFECT_FIELD = 'bSunAffect'
AMBIENT_FIELDS = ('AmbientVector', 'AmbientBrightness', 'AmbientHue', 'AmbientSaturation')
DISTANCE_FOG_FIELDS = ('bDistanceFog', 'DistanceFogColor', 'DistanceFogStart', 'DistanceFogEnd')
AUTHORED_PROVENANCE = 'authored'
UNRESOLVED_PROVENANCE = 'unresolved'
COLOR_STRUCT_NAME = 'Color'
SERIALIZED_COLOR_CHANNEL_ORDER = ('R', 'G', 'B', 'A')
SKY_ZONE_CLASS = 'Engine.SkyZoneInfo'
ZONE_CLASS_OUTDOOR_BIT = 1
ZONE_CLASS_SKY_BIT = 2
ZONE_CLASS_UNRESOLVED_BIT = 4


class ZoneField(NamedTuple):
    field: str
    value: object
    provenance: str
    declaring_class: str | None

    def to_record(self):
        return {'field': self.field, 'value': self.value, 'provenance': self.provenance, 'declaringClass': self.declaring_class}


class LevelZone(NamedTuple):
    zone_index: int
    actor: str | None
    actor_class: str | None
    connectivity: int
    visibility: int
    sun_affect: ZoneField
    ambient: tuple
    distance_fog: tuple
    outdoor: bool
    sky: bool
    unresolved: bool

    @property
    def class_bits(self):
        return ((ZONE_CLASS_OUTDOOR_BIT if self.outdoor else 0) | (ZONE_CLASS_SKY_BIT if self.sky else 0)
                | (ZONE_CLASS_UNRESOLVED_BIT if self.unresolved else 0))

    def to_record(self):
        return {'zoneIndex': self.zone_index, 'actor': self.actor, 'actorClass': self.actor_class, 'connectivity': self.connectivity,
                'visibility': self.visibility, 'sunAffect': self.sun_affect.to_record(),
                'ambient': [field.to_record() for field in self.ambient], 'distanceFog': [field.to_record() for field in self.distance_fog],
                'outdoor': self.outdoor, 'sky': self.sky, 'unresolved': self.unresolved}


def zone_actor_export(package, zone_actor_reference):
    if zone_actor_reference <= 0 or zone_actor_reference > len(package.exports):
        return None
    return package.exports[zone_actor_reference - 1]


def decoded_serialized_value(value):
    if isinstance(value, dict) and value.get('struct') == COLOR_STRUCT_NAME and len(value.get('unparsedHex', '')) == 2 * len(SERIALIZED_COLOR_CHANNEL_ORDER):
        return dict(zip(SERIALIZED_COLOR_CHANNEL_ORDER, bytes.fromhex(value['unparsedHex'])))
    return value


def serialized_actor_values(package, export):
    tags, _, _, _ = actor_properties(package, export)
    return object_values(package, tags)


def resolved_zone_field(field, serialized_values, actor_class, class_defaults):
    if field in serialized_values:
        return ZoneField(field, decoded_serialized_value(serialized_values[field]), AUTHORED_PROVENANCE, actor_class)
    try:
        default = class_defaults.values(actor_class, [field])[field]
    except ClassDefaultError:
        return ZoneField(field, None, UNRESOLVED_PROVENANCE, None)
    return ZoneField(field, default.value, placement_provenance(default), default.declaring_class)


def unresolved_zone_field(field):
    return ZoneField(field, None, UNRESOLVED_PROVENANCE, None)


def read_level_zone(package, zone_index, zone, class_defaults):
    actor_reference, connectivity, visibility, _ = zone
    export = zone_actor_export(package, actor_reference)
    if export is None:
        fields = [unresolved_zone_field(field) for field in (SUN_AFFECT_FIELD, *AMBIENT_FIELDS, *DISTANCE_FOG_FIELDS)]
        actor, actor_class = None, None
    else:
        serialized_values, actor, actor_class = serialized_actor_values(package, export), export['object'], export['classObject']
        fields = [resolved_zone_field(field, serialized_values, actor_class, class_defaults)
                  for field in (SUN_AFFECT_FIELD, *AMBIENT_FIELDS, *DISTANCE_FOG_FIELDS)]
    sun_affect, ambient, distance_fog = fields[0], tuple(fields[1:1 + len(AMBIENT_FIELDS)]), tuple(fields[1 + len(AMBIENT_FIELDS):])
    return LevelZone(zone_index, actor, actor_class, connectivity, visibility, sun_affect, ambient, distance_fog,
                     zone_index == OUTDOOR_ZONE_INDEX or sun_affect.value is True, actor_class == SKY_ZONE_CLASS,
                     sun_affect.provenance == UNRESOLVED_PROVENANCE)


def read_level_zones(package, model, class_defaults):
    return tuple(read_level_zone(package, zone_index, zone, class_defaults) for zone_index, zone in enumerate(model.zones))


def outdoor_zone_indices(zones):
    return frozenset(zone.zone_index for zone in zones if zone.outdoor)


def sky_zone_indices(zones):
    return frozenset(zone.zone_index for zone in zones if zone.sky)
