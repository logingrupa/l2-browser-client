from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError
from world.actor_field_values import AUTHORED_PROVENANCE, UNRESOLVED_PROVENANCE, ActorField
from world.level_actors import level_actor_exports, level_info_export
from world.level_zones import read_level_zones, sky_zone_indices
from world.sky_zone_selection import select_shared_sky_zone

SKY_CLASS = 'Engine.SkyZoneInfo'
CLASS_PARENTS = {'Engine.SkyZoneInfo': ('Engine.SkyZoneInfo', 'Engine.ZoneInfo'), 'Engine.ZoneInfo': ('Engine.ZoneInfo',),
                 'Map.CustomSkyZone': ('Map.CustomSkyZone', 'Engine.SkyZoneInfo', 'Engine.ZoneInfo'),
                 'Engine.LevelInfo': ('Engine.LevelInfo', 'Engine.ZoneInfo'), 'Engine.Light': ('Engine.Light',)}


class SyntheticClassChains:
    def chain(self, class_name):
        return CLASS_PARENTS.get(class_name)

    def is_subclass(self, class_name, base_class):
        return base_class in CLASS_PARENTS[class_name]


def actor(name, class_name, **fields):
    return {'object': f'Map.{name}', 'classObject': class_name, 'fields': fields}


def level_of(exports, references=None):
    actor_references = references if references is not None else [index + 1 for index in range(len(exports))]
    return SimpleNamespace(binding={'actorArrays': [{'nativeField': '0x48', 'references': []}, {'nativeField': '0x38', 'references': actor_references}]})


def resolved_field(field, serialized, object_class, class_defaults):
    if field in serialized:
        value = serialized[field]
        return ActorField(field, value, UNRESOLVED_PROVENANCE if value == 'unresolved' else AUTHORED_PROVENANCE, object_class)
    return ActorField(field, False if field.startswith('b') else None, 'class-default', object_class)


def model_zone(actor_reference):
    return (actor_reference, 0, 0, 0)


def level_with_model_zones(exports, model_zones):
    return SimpleNamespace(model=SimpleNamespace(zones=model_zones), binding=level_of(exports).binding)


def zones_of(exports, model_zones):
    with mock.patch('world.level_zones.serialized_actor_values', lambda package, export: export['fields']), \
            mock.patch('world.level_zones.resolved_actor_field', resolved_field):
        return read_level_zones(SimpleNamespace(exports=exports), level_with_model_zones(exports, model_zones), None, SyntheticClassChains())


class SharedSkyZoneSelectionTests(unittest.TestCase):
    def select(self, exports, model_zones):
        return select_shared_sky_zone(SimpleNamespace(exports=exports), zones_of(exports, model_zones), SyntheticClassChains())

    def test_the_zones_are_walked_from_the_last_down_and_the_first_sky_zone_actor_wins(self):
        exports = [actor('LevelInfo0', 'Engine.LevelInfo'), actor('SkyZoneInfo0', SKY_CLASS), actor('ZoneInfo0', 'Engine.ZoneInfo'),
                   actor('SkyZoneInfo1', SKY_CLASS)]
        selection = self.select(exports, [model_zone(0), model_zone(4), model_zone(2), model_zone(3)])
        self.assertEqual((selection.zone_index, selection.actor['object'], selection.gap_reason), (2, 'Map.SkyZoneInfo0', None))

    def test_a_subclass_of_sky_zone_info_casts_to_a_sky_zone(self):
        exports = [actor('CustomSky0', 'Map.CustomSkyZone')]
        self.assertEqual(self.select(exports, [model_zone(0), model_zone(1)])[0], 1)

    def test_an_unknown_zone_actor_class_above_the_sky_zone_stops_the_walk_with_a_gap(self):
        exports = [actor('SkyZoneInfo0', SKY_CLASS), actor('Mystery0', 'Game.Mystery')]
        self.assertEqual(self.select(exports, [model_zone(0), model_zone(1), model_zone(2)]),
                         (None, None, 'sky-zone-class-unresolved:Game.Mystery'))

    def test_a_level_without_a_sky_zone_selects_nothing_and_names_no_gap(self):
        exports = [actor('LevelInfo0', 'Engine.LevelInfo'), actor('ZoneInfo0', 'Engine.ZoneInfo')]
        self.assertEqual(self.select(exports, [model_zone(0), model_zone(2)]), (None, None, None))

    def test_a_level_needs_exactly_one_actors_array_at_0x38(self):
        with self.assertRaisesRegex(FormatError, 'names 0 Actors arrays at 0x38'):
            level_actor_exports(SimpleNamespace(exports=[]), SimpleNamespace(binding={'actorArrays': []}))


class SkyZoneRuleAgreementTests(unittest.TestCase):
    def test_the_selected_shared_sky_zone_is_a_sky_zone_of_the_level(self):
        exports = [actor('LevelInfo0', 'Engine.LevelInfo'), actor('CustomSky0', 'Map.CustomSkyZone'), actor('ZoneInfo0', 'Engine.ZoneInfo')]
        zones = zones_of(exports, [model_zone(0), model_zone(2), model_zone(3)])
        selection = select_shared_sky_zone(SimpleNamespace(exports=exports), zones, SyntheticClassChains())
        self.assertEqual((selection.zone_index, selection.gap_reason), (1, None))
        self.assertEqual(sky_zone_indices(zones), frozenset({selection.zone_index}))

    def test_a_zone_actor_of_an_unknown_class_is_an_unresolved_zone_and_not_a_sky_zone(self):
        exports = [actor('Mystery0', 'Game.Mystery', bSunAffect=True)]
        zones = zones_of(exports, [model_zone(0), model_zone(1)])
        self.assertEqual([(zone.sky, zone.unresolved) for zone in zones], [(False, True), (False, True)])


class LevelInfoExportTests(unittest.TestCase):
    def level_info(self, exports, references=None):
        return level_info_export(SimpleNamespace(exports=exports), level_of(exports, references), SyntheticClassChains())

    def test_actors_zero_is_the_level_info_only_when_its_class_is_a_level_info(self):
        self.assertEqual(self.level_info([actor('LevelInfo0', 'Engine.LevelInfo')])['object'], 'Map.LevelInfo0')
        self.assertIsNone(self.level_info([actor('ZoneInfo0', 'Engine.ZoneInfo')]))
        self.assertIsNone(self.level_info([actor('Mystery0', 'Game.Mystery')]))
        self.assertIsNone(self.level_info([actor('LevelInfo0', 'Engine.LevelInfo')], references=[0, 1]))


if __name__ == '__main__':
    unittest.main()
