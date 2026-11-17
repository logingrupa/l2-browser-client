from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError
from world.actor_field_values import AUTHORED_PROVENANCE, UNRESOLVED_PROVENANCE, ActorField
from world.bsp_node_sun_affect import NOT_SUN_AFFECTED, SUN_AFFECT_UNRESOLVED, SUN_AFFECTED, level_info_sun_affect
from world.level_actors import level_actor_exports
from world.sky_zone_selection import SKY_ZONE_DETAIL_MODE_UNRESOLVED_REASON, select_sky_zone

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


def zone(index, actor_name):
    return SimpleNamespace(zone_index=index, actor=None if actor_name is None else f'Map.{actor_name}')


class SkyZoneSelectionTests(unittest.TestCase):
    def select(self, exports, zones, references=None):
        package = SimpleNamespace(exports=exports)
        with mock.patch('world.sky_zone_selection.serialized_actor_values', lambda package, export: export['fields']), \
                mock.patch('world.sky_zone_selection.resolved_actor_field', resolved_field):
            return select_sky_zone(package, level_of(exports, references), zones, None, SyntheticClassChains())

    def test_the_last_sky_in_level_actor_order_wins_and_its_zone_is_used(self):
        exports = [actor('LevelInfo0', 'Engine.LevelInfo'), actor('SkyZoneInfo0', SKY_CLASS), actor('Light0', 'Engine.Light'), actor('SkyZoneInfo1', SKY_CLASS)]
        selection = self.select(exports, [zone(0, None), zone(1, 'SkyZoneInfo1'), zone(2, 'SkyZoneInfo0')], references=[1, 0, 4, 3, 2])
        self.assertEqual((selection.zone_index, selection.actor['object'], selection.gap_reason), (2, 'Map.SkyZoneInfo0', None))

    def test_a_subclass_of_sky_zone_info_is_a_sky_candidate(self):
        exports = [actor('SkyZoneInfo0', SKY_CLASS), actor('CustomSky0', 'Map.CustomSkyZone')]
        selection = self.select(exports, [zone(0, 'SkyZoneInfo0'), zone(1, 'CustomSky0')])
        self.assertEqual((selection.zone_index, selection.gap_reason), (1, None))

    def test_when_no_sky_is_eligible_in_some_detail_mode_the_last_sky_stays_linked(self):
        exports = [actor('SkyZoneInfo0', SKY_CLASS, bHighDetail=True), actor('SkyZoneInfo1', SKY_CLASS, bSuperHighDetail=True)]
        selection = self.select(exports, [zone(0, 'SkyZoneInfo0'), zone(1, 'SkyZoneInfo1')])
        self.assertEqual((selection.zone_index, selection.gap_reason), (None, SKY_ZONE_DETAIL_MODE_UNRESOLVED_REASON))
        only_high = self.select([actor('SkyZoneInfo0', SKY_CLASS, bSuperHighDetail=True)], [zone(0, 'SkyZoneInfo0')])
        self.assertEqual((only_high.zone_index, only_high.gap_reason), (0, None))

    def test_detail_flags_that_change_the_choice_between_detail_modes_are_a_gap(self):
        exports = [actor('SkyZoneInfo0', SKY_CLASS), actor('SkyZoneInfo1', SKY_CLASS, bHighDetail=True)]
        selection = self.select(exports, [zone(0, 'SkyZoneInfo0'), zone(1, 'SkyZoneInfo1')])
        self.assertEqual((selection.zone_index, selection.gap_reason), (None, SKY_ZONE_DETAIL_MODE_UNRESOLVED_REASON))

    def test_detail_flags_that_every_detail_mode_agrees_on_select_one_sky(self):
        exports = [actor('SkyZoneInfo0', SKY_CLASS, bSuperHighDetail=True), actor('SkyZoneInfo1', SKY_CLASS)]
        selection = self.select(exports, [zone(0, 'SkyZoneInfo0'), zone(1, 'SkyZoneInfo1')])
        self.assertEqual((selection.zone_index, selection.gap_reason), (1, None))

    def test_a_sky_without_a_zone_slot_an_unread_detail_flag_or_an_unknown_actor_class_is_a_gap(self):
        self.assertEqual(self.select([actor('SkyZoneInfo0', SKY_CLASS)], [zone(0, None)]).gap_reason, 'sky-zone-actor-zone-count:0')
        self.assertEqual(self.select([actor('SkyZoneInfo0', SKY_CLASS)], [zone(0, 'SkyZoneInfo0'), zone(1, 'SkyZoneInfo0')]).gap_reason,
                         'sky-zone-actor-zone-count:2')
        self.assertEqual(self.select([actor('SkyZoneInfo0', SKY_CLASS, bHighDetail='unresolved')], [zone(0, 'SkyZoneInfo0')]).gap_reason,
                         'sky-zone-detail-field-unresolved:Map.SkyZoneInfo0.bHighDetail')
        self.assertEqual(self.select([actor('Mystery0', 'Game.Mystery')], [zone(0, None)]).gap_reason, 'sky-zone-class-unresolved:Game.Mystery')

    def test_a_level_without_a_sky_selects_nothing_and_names_no_gap(self):
        self.assertEqual(self.select([actor('LevelInfo0', 'Engine.LevelInfo')], [zone(0, None)]), (None, None, None))

    def test_a_level_needs_exactly_one_actors_array_at_0x38(self):
        with self.assertRaisesRegex(FormatError, 'names 0 Actors arrays at 0x38'):
            level_actor_exports(SimpleNamespace(exports=[]), SimpleNamespace(binding={'actorArrays': []}))


class LevelInfoSunAffectTests(unittest.TestCase):
    def sun_affect(self, exports, references=None):
        package = SimpleNamespace(exports=exports)
        with mock.patch('world.bsp_node_sun_affect.serialized_actor_values', lambda package, export: export['fields']), \
                mock.patch('world.bsp_node_sun_affect.resolved_actor_field', resolved_field):
            return level_info_sun_affect(package, level_of(exports, references), None, SyntheticClassChains())

    def test_actors_zero_must_be_a_level_info_whose_bsunaffect_decides(self):
        self.assertEqual(self.sun_affect([actor('LevelInfo0', 'Engine.LevelInfo', bSunAffect=True)]), SUN_AFFECTED)
        self.assertEqual(self.sun_affect([actor('LevelInfo0', 'Engine.LevelInfo')]), NOT_SUN_AFFECTED)
        self.assertEqual(self.sun_affect([actor('LevelInfo0', 'Engine.LevelInfo', bSunAffect='unresolved')]), SUN_AFFECT_UNRESOLVED)
        self.assertEqual(self.sun_affect([actor('ZoneInfo0', 'Engine.ZoneInfo', bSunAffect=True)]), SUN_AFFECT_UNRESOLVED)
        self.assertEqual(self.sun_affect([actor('LevelInfo0', 'Engine.LevelInfo', bSunAffect=True)], references=[0, 1]), SUN_AFFECT_UNRESOLVED)


if __name__ == '__main__':
    unittest.main()
