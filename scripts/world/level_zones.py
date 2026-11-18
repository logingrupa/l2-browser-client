from typing import NamedTuple

from world.actor_field_values import UNRESOLVED_PROVENANCE, ActorField, resolved_actor_field, serialized_actor_values, unresolved_actor_field
from world.level_actors import level_info_export

OUTDOOR_ZONE_INDEX = 0
NO_ZONE_ACTOR_REFERENCE = 0
SUN_AFFECT_FIELD = 'bSunAffect'
AMBIENT_FIELDS = ('AmbientVector', 'AmbientBrightness', 'AmbientHue', 'AmbientSaturation')
ZONE_FOG_FIELDS = ('bDistanceFog', 'bTerrainZone', 'DistanceFogColor', 'DistanceFogStart', 'DistanceFogEnd', 'DistanceFogBlendTime')
SKY_ZONE_CLASS = 'Engine.SkyZoneInfo'
ZONE_CLASS_OUTDOOR_BIT = 1
ZONE_CLASS_UNRESOLVED_BIT = 4


class LevelZone(NamedTuple):
    zone_index: int
    actor: str | None
    actor_class: str | None
    connectivity: int
    visibility: int
    sun_affect: ActorField
    ambient: tuple
    distance_fog: tuple
    outdoor: bool
    sky: bool
    unresolved: bool
    level_info_fallback: bool

    @property
    def class_bits(self):
        return (ZONE_CLASS_OUTDOOR_BIT if self.outdoor else 0) | (ZONE_CLASS_UNRESOLVED_BIT if self.unresolved else 0)

    def to_record(self):
        return {'zoneIndex': self.zone_index, 'actor': self.actor, 'actorClass': self.actor_class, 'connectivity': self.connectivity,
                'visibility': self.visibility, 'sunAffect': self.sun_affect.to_record(),
                'ambient': [field.to_record() for field in self.ambient], 'distanceFog': [field.to_record() for field in self.distance_fog],
                'outdoor': self.outdoor, 'sky': self.sky, 'unresolved': self.unresolved, 'levelInfoFallback': self.level_info_fallback}


def zone_actor_export(package, zone_actor_reference):
    if zone_actor_reference <= 0 or zone_actor_reference > len(package.exports):
        return None
    return package.exports[zone_actor_reference - 1]


def is_sky_zone_class(class_chains, class_name):
    return class_chains.is_subclass(class_name, SKY_ZONE_CLASS)


def read_level_zone(package, zone_index, zone, class_defaults, class_chains, level_info):
    actor_reference, connectivity, visibility, _ = zone
    level_info_fallback = actor_reference == NO_ZONE_ACTOR_REFERENCE and level_info is not None
    export = level_info if level_info_fallback else zone_actor_export(package, actor_reference)
    if export is None:
        fields = [unresolved_actor_field(field) for field in (SUN_AFFECT_FIELD, *AMBIENT_FIELDS, *ZONE_FOG_FIELDS)]
        actor, actor_class, class_resolved = None, None, False
    else:
        serialized_values, actor, actor_class = serialized_actor_values(package, export), export['object'], export['classObject']
        fields = [resolved_actor_field(field, serialized_values, actor_class, class_defaults)
                  for field in (SUN_AFFECT_FIELD, *AMBIENT_FIELDS, *ZONE_FOG_FIELDS)]
        class_resolved = class_chains.chain(actor_class) is not None
    sun_affect, ambient, distance_fog = fields[0], tuple(fields[1:1 + len(AMBIENT_FIELDS)]), tuple(fields[1 + len(AMBIENT_FIELDS):])
    return LevelZone(zone_index, actor, actor_class, connectivity, visibility, sun_affect, ambient, distance_fog,
                     zone_index == OUTDOOR_ZONE_INDEX or sun_affect.value is True, class_resolved and is_sky_zone_class(class_chains, actor_class),
                     sun_affect.provenance == UNRESOLVED_PROVENANCE or (export is not None and not class_resolved), level_info_fallback)


def read_level_zones(package, level, class_defaults, class_chains):
    level_info = level_info_export(package, level, class_chains)
    return tuple(read_level_zone(package, zone_index, zone, class_defaults, class_chains, level_info)
                 for zone_index, zone in enumerate(level.model.zones))


def outdoor_zone_indices(zones):
    return frozenset(zone.zone_index for zone in zones if zone.outdoor)


def sky_zone_indices(zones):
    return frozenset(zone.zone_index for zone in zones if zone.sky)
