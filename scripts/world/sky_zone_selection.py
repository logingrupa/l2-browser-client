from typing import NamedTuple

from world.actor_field_values import UNRESOLVED_PROVENANCE, resolved_actor_field, serialized_actor_values
from world.level_actors import level_actor_exports

SKY_ZONE_BASE_CLASS = 'Engine.SkyZoneInfo'
HIGH_DETAIL_FIELD = 'bHighDetail'
SUPER_HIGH_DETAIL_FIELD = 'bSuperHighDetail'
ROTATION_FIELD = 'Rotation'
DETAIL_MODES = (0, 1, 2)
SKY_ZONE_CLASS_UNRESOLVED_PREFIX = 'sky-zone-class-unresolved:'
SKY_ZONE_DETAIL_FIELD_UNRESOLVED_PREFIX = 'sky-zone-detail-field-unresolved:'
SKY_ZONE_DETAIL_MODE_UNRESOLVED_REASON = 'sky-zone-detail-mode-unresolved'
SKY_ZONE_ACTOR_WITHOUT_ZONE_PREFIX = 'sky-zone-actor-without-zone:'
SKY_SELECTION_RULE = ('ZoneInfo.LinkToSkybox (DB-14 sky-zone-rendering.json 13dbd105): every SkyZoneInfo of Level.Actors (+0x38) in ascending order, '
                      'the last one wins, then the last one eligible for Level.DetailMode wins when one is (0: neither bHighDetail nor '
                      'bSuperHighDetail, 1: not bSuperHighDetail, 2: any)')


class SkyZoneCandidate(NamedTuple):
    export: dict
    high_detail: bool
    super_high_detail: bool


class SkyZoneSelection(NamedTuple):
    zone_index: int | None
    actor: dict | None
    gap_reason: str | None
    candidate_actors: tuple


def detail_eligible(candidate, detail_mode):
    if detail_mode == 0:
        return not candidate.high_detail and not candidate.super_high_detail
    if detail_mode == 1:
        return not candidate.super_high_detail
    return True


def linked_sky_candidate(candidates, detail_mode):
    eligible = [candidate for candidate in candidates if detail_eligible(candidate, detail_mode)]
    return (eligible or candidates)[-1]


def sky_zone_candidate(package, export, class_defaults):
    serialized = serialized_actor_values(package, export)
    fields = [resolved_actor_field(field, serialized, export['classObject'], class_defaults) for field in (HIGH_DETAIL_FIELD, SUPER_HIGH_DETAIL_FIELD)]
    unresolved = [field.field for field in fields if field.provenance == UNRESOLVED_PROVENANCE]
    if unresolved:
        return f'{SKY_ZONE_DETAIL_FIELD_UNRESOLVED_PREFIX}{export["object"]}.{unresolved[0]}'
    return SkyZoneCandidate(export, fields[0].value is True, fields[1].value is True)


def sky_zone_exports(package, level, class_chains):
    exports, unresolved_classes = [], set()
    for export in level_actor_exports(package, level):
        if class_chains.chain(export['classObject']) is None:
            unresolved_classes.add(export['classObject'])
        elif class_chains.is_subclass(export['classObject'], SKY_ZONE_BASE_CLASS):
            exports.append(export)
    return exports, sorted(unresolved_classes)


def select_sky_zone(package, level, zones, class_defaults, class_chains):
    exports, unresolved_classes = sky_zone_exports(package, level, class_chains)
    if unresolved_classes:
        return SkyZoneSelection(None, None, f'{SKY_ZONE_CLASS_UNRESOLVED_PREFIX}{unresolved_classes[0]}', ())
    candidates = []
    for export in exports:
        candidate = sky_zone_candidate(package, export, class_defaults)
        if isinstance(candidate, str):
            return SkyZoneSelection(None, None, candidate, tuple(item.export['object'] for item in candidates))
        candidates.append(candidate)
    names = tuple(candidate.export['object'] for candidate in candidates)
    if not candidates:
        return SkyZoneSelection(None, None, None, names)
    linked = {linked_sky_candidate(candidates, detail_mode).export['object'] for detail_mode in DETAIL_MODES}
    if len(linked) != 1:
        return SkyZoneSelection(None, None, SKY_ZONE_DETAIL_MODE_UNRESOLVED_REASON, names)
    actor = linked_sky_candidate(candidates, DETAIL_MODES[0]).export
    zone_indices = [zone.zone_index for zone in zones if zone.actor == actor['object']]
    if len(zone_indices) != 1:
        return SkyZoneSelection(None, actor, f'{SKY_ZONE_ACTOR_WITHOUT_ZONE_PREFIX}{actor["object"]}', names)
    return SkyZoneSelection(zone_indices[0], actor, None, names)


def sky_actor_rotation(package, actor, class_defaults):
    return resolved_actor_field(ROTATION_FIELD, serialized_actor_values(package, actor), actor['classObject'], class_defaults)
