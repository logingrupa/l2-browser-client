import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.character_requests import CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, build_character_request
from test_character_requests import (ANIMATION_FAMILIES_RECIPE_PATH, ANIMATION_FAMILIES_RECIPE_SHA256, CLASS_PACKAGE_SHA256, JOINED_CLASS,
                                     SYNTHETIC_FAMILY_SOURCE, SYNTHETIC_GETTERS, SYNTHETIC_HAND_VALUES, character_sources, class_definitions,
                                     joined_actor_class, synthetic_animation_families, synthetic_chargrp_row)

RESOLVED_COLLISION_CLASS = {JOINED_CLASS: {'properties': {'CollisionHeight': 23.0, 'CollisionRadius': 9.0}, 'nativeSuperClass': None}}


class CharacterCollisionChainTests(unittest.TestCase):
    def profile(self, definitions, animation_families=None):
        from actors.character_requests import character_profile_fields
        return character_profile_fields(joined_actor_class(definitions[JOINED_CLASS]['properties']), class_definitions(definitions),
                                        animation_families or synthetic_animation_families())

    def test_the_families_come_from_the_recipe_by_weapon_slot_and_the_profile_resolves_with_collision_and_the_required_families(self):
        profile = self.profile(RESOLVED_COLLISION_CLASS, synthetic_animation_families(JOINED_CLASS))
        families = profile['animationFamilies']
        self.assertEqual({key: families[key] for key in ('recipe', 'recipeSha256', 'familySource', 'meshType', 'section', 'getters')},
                         {'recipe': ANIMATION_FAMILIES_RECIPE_PATH, 'recipeSha256': ANIMATION_FAMILIES_RECIPE_SHA256,
                          'familySource': SYNTHETIC_FAMILY_SOURCE, 'meshType': 0, 'section': 'SyntheticFighter', 'getters': SYNTHETIC_GETTERS})
        self.assertEqual([slot['weaponType'] for slot in families['byWeaponType']], ['WT_HAND', 'WT_THROW'])
        self.assertEqual(families['byWeaponType'][0]['values'], SYNTHETIC_HAND_VALUES)
        self.assertEqual((profile['status'], profile['reason']), ('resolved', None))

    def test_a_missing_hand_value_of_a_required_family_names_that_family(self):
        hand_values = {**SYNTHETIC_HAND_VALUES, 'Atk01AnimName': None}
        profile = self.profile(RESOLVED_COLLISION_CLASS, synthetic_animation_families(JOINED_CLASS, hand_values))
        self.assertEqual((profile['status'], profile['reason']), ('gap', 'actor-default-unresolved:Atk01AnimName'))

    def test_a_class_absent_from_the_recipe_keeps_the_wait_animation_gap(self):
        profile = self.profile(RESOLVED_COLLISION_CLASS)
        self.assertEqual((profile['animationFamilies'], profile['reason']), (None, 'actor-default-unresolved:WaitAnimName'))

    def test_declared_values_are_copied_exactly_and_an_omitted_value_comes_from_the_declared_parent(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 23.0001}, 'nativeSuperClass': 'LineageWarrior.LineagePawn'},
                                'LineageWarrior.LineagePawn': {'properties': {'CollisionRadius': 9.999}, 'nativeSuperClass': None}})
        self.assertEqual(profile['collision'], {'collisionRadius': {'value': 9.999, 'class': 'LineageWarrior.LineagePawn'},
                                                'collisionHeight': {'value': 23.0001, 'class': JOINED_CLASS}})
        self.assertEqual(profile['reason'], 'actor-default-unresolved:WaitAnimName')
        self.assertEqual(profile['actorClassDefaults'], {'class': JOINED_CLASS, 'classPackageSha256': CLASS_PACKAGE_SHA256,
                                                         'HeadBone': None, 'RightHandBone': None})

    def test_a_value_absent_through_the_whole_ancestry_stays_actor_default_unresolved(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 22.5}, 'nativeSuperClass': 'Engine.Pawn'},
                                'Engine.Pawn': {'properties': {}, 'nativeSuperClass': None}})
        self.assertEqual(profile['reason'], 'actor-default-unresolved:CollisionRadius')
        self.assertEqual(profile['collision']['collisionRadius']['classChain'], [JOINED_CLASS, 'Engine.Pawn'])

    def test_the_female_fighter_row_is_compared_with_the_audit_values_and_never_adjusted(self):
        stage = json.loads((ROOT / 'recipes' / 'native-player-ffighter-stage.json').read_bytes())
        audit_values = {field: entry['previousValue'] for field, entry in stage['profiles'][0]['unresolved'].items()}
        row = synthetic_chargrp_row()
        generated = build_character_request(row, 1, None, character_sources([row, row]))
        self.assertEqual((generated['profileFields']['reason'], generated['profileFields']['collision']), (CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, None))
        self.assertEqual(audit_values, {'collisionRadius': 8, 'collisionHeight': 23.5})
        for module in ('character_requests.py', 'character_conversion.py', 'character_census.py', 'convert_actors.py'):
            self.assertNotIn('previousValue', (ROOT / 'scripts' / 'actors' / module).read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
