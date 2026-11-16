import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.character_requests import CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, build_character_request
from test_character_requests import (CLASS_PACKAGE_SHA256, IDLE_FAMILIES_RECIPE_SHA256, JOINED_CLASS, character_sources, class_definitions,
                                     joined_actor_class, synthetic_chargrp_row, synthetic_idle_families)


class CharacterCollisionChainTests(unittest.TestCase):
    def profile(self, definitions, idle_families=None):
        from actors.character_requests import character_profile_fields
        return character_profile_fields(joined_actor_class(definitions[JOINED_CLASS]['properties']), class_definitions(definitions),
                                        idle_families or synthetic_idle_families())

    def test_the_idle_animations_come_from_the_recipe_by_weapon_type_and_the_run_family_is_the_next_unsourced_field(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 23.0, 'CollisionRadius': 9.0}, 'nativeSuperClass': None}},
                               synthetic_idle_families(JOINED_CLASS))
        self.assertEqual(profile['idleAnimations'], {'recipe': 'recipes/actors/character-idle-families.json', 'recipeSha256': IDLE_FAMILIES_RECIPE_SHA256,
                                                     'meshType': 0, 'byWeaponType': [{'weaponType': 'WT_HAND', 'value': 'wait_Hand_SyntheticFighter'},
                                                                                      {'weaponType': 'WT_THROW', 'value': None}]})
        self.assertEqual(profile['reason'], 'actor-default-unresolved:RunAnimName')

    def test_a_class_absent_from_the_recipe_keeps_the_wait_animation_gap(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 23.0, 'CollisionRadius': 9.0}, 'nativeSuperClass': None}})
        self.assertEqual((profile['idleAnimations'], profile['reason']), (None, 'actor-default-unresolved:WaitAnimName'))

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
