from typing import NamedTuple

from world.actor_field_values import resolved_actor_field, serialized_actor_values

ROTATION_FIELD = 'Rotation'
SKY_ZONE_CLASS_UNRESOLVED_PREFIX = 'sky-zone-class-unresolved:'
SHARED_SKY_ZONE_RULE = ('Engine.dll 0x10689fd0: walk the zones from NumZones-1 down to 0 and take the first zone whose actor casts to '
                        'SkyZoneInfo')


class SkyZoneSelection(NamedTuple):
    zone_index: int | None
    actor: dict | None
    gap_reason: str | None


def zone_actor_export(package, zone):
    return next(item for item in package.exports if item['object'] == zone.actor)


def select_shared_sky_zone(package, zones, class_chains):
    for zone in reversed(zones):
        if zone.actor_class is None:
            continue
        if class_chains.chain(zone.actor_class) is None:
            return SkyZoneSelection(None, None, f'{SKY_ZONE_CLASS_UNRESOLVED_PREFIX}{zone.actor_class}')
        if zone.sky:
            return SkyZoneSelection(zone.zone_index, zone_actor_export(package, zone), None)
    return SkyZoneSelection(None, None, None)


def sky_actor_rotation(package, actor, class_defaults):
    return resolved_actor_field(ROTATION_FIELD, serialized_actor_values(package, actor), actor['classObject'], class_defaults)
