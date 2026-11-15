import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row

RECIPE_PATH = ROOT / 'recipes' / 'native-combat-audio.json'
BUNDLING_SCRIPT = ROOT / 'scripts' / 'bundle-native-combat-audio.py'
HAND_TYPED_ROLE_COLUMNS = {
    'human-male-fighter': {'attackItem': 'attack_sound', 'attackVoice': 'voice_snd_hand', 'defense': 'defense_sound', 'damage': 'damage_sound'},
    'human-female-fighter': {'attackItem': 'attack_sound', 'attackVoice': 'voice_snd_hand', 'defense': 'defense_sound', 'damage': 'damage_sound'},
    'human-male-mystic': {'attackItem': 'attack_sound', 'attackVoice': 'voice_snd_hand', 'defense': 'defense_sound', 'damage': 'damage_sound'},
    'human-female-mystic': {'attackItem': 'attack_sound', 'attackVoice': 'voice_snd_hand', 'defense': 'defense_sound', 'damage': 'damage_sound'},
    'greater-musveren': {'attackItem': 'attack_sound1', 'defense': 'defense_sound1', 'damage': 'damage_sound'},
    'armor-22-leather-shirt': {'defense': 'item_sound'},
    'weapon-1-short-sword': {'attackItem': 'item_sound'},
    'skill-3-level-1-power-strike': {'cast': 'spelleffect_sound_1', 'shot': 'spelleffect_sound_2'},
    'alaudio-combat-config': {'critical': 'EtcSound.CriticalSound', 'soulshot': 'EtcSound.SoulShotSound'},
}
UNCHANGED_SELECTION_FIELDS = ('id', 'kind', 'table', 'match', 'join', 'numericFields', 'nativeNumeric', 'label', 'catalogId', 'sourceObject',
                              'itemId', 'skillId', 'level')
EXPECTED_COVERAGE = {'selections': 9, 'slots': 85, 'admittedSlots': 84, 'slotStatuses': {'empty': 1, 'unique-package-leaf-candidate': 84},
                     'candidateProductStatuses': {'verified-export': 84}, 'dependencies': 59, 'wavFiles': 59}
EXPECTED_SELECTION_TABLES = {'human-male-fighter': 'chargrp', 'human-female-fighter': 'chargrp', 'human-male-mystic': 'chargrp',
                             'human-female-mystic': 'chargrp', 'greater-musveren': 'npcgrp', 'armor-22-leather-shirt': 'armorgrp',
                             'weapon-1-short-sword': 'weapongrp', 'skill-3-level-1-power-strike': 'skillsoundgrp',
                             'alaudio-combat-config': 'alaudio'}


def read_recipe():
    return json.loads(RECIPE_PATH.read_bytes())


def unresolved_route_gap_row(reason):
    return {'key': 'npc:1', 'part': 'audio', 'step': 'actor-sounds', 'status': 'gap', 'reason': reason,
            'sourceIdentity': {'path': 'recipes/native-combat-audio.json', 'sha256': '0' * 64}, 'evidence': 'recipes/native-combat-audio.json'}


class HandTypedCombatRoleRoutingTests(unittest.TestCase):
    def test_every_selection_holds_no_usable_role_map_and_records_each_former_role_unresolved(self):
        selections = read_recipe()['selections']
        self.assertEqual([selection['id'] for selection in selections], list(HAND_TYPED_ROLE_COLUMNS))
        reason_patterns = load_gap_reason_patterns()
        for selection in selections:
            with self.subTest(selection['id']):
                self.assertIsNone(selection['roles'])
                expected = {role: {'reason': f'combat-role-route-unresolved:{selection["table"]}/{role}', 'previousValue': column}
                            for role, column in HAND_TYPED_ROLE_COLUMNS[selection['id']].items()}
                self.assertEqual(selection['unresolved']['roles'], expected)
                self.assertEqual(list(selection['unresolved']['roles']), list(HAND_TYPED_ROLE_COLUMNS[selection['id']]))
                for entry in selection['unresolved']['roles'].values():
                    validate_gap_row(unresolved_route_gap_row(entry['reason']), reason_patterns)

    def test_selection_identity_rows_and_numbers_are_unchanged(self):
        recipe = read_recipe()
        self.assertEqual(len(recipe['selections']), 9)
        self.assertEqual({selection['id']: selection['table'] for selection in recipe['selections']}, EXPECTED_SELECTION_TABLES)
        self.assertEqual(recipe['expectedCoverage'], EXPECTED_COVERAGE)
        musveren = next(selection for selection in recipe['selections'] if selection['id'] == 'greater-musveren')
        self.assertEqual(musveren['nativeNumeric'], {'soundRadius': 'sound_vol', 'soundVolume': 'sound_radius', 'soundRandom': 'sound_random'})
        self.assertEqual(musveren['match'], [{'pointer': '/npc_id', 'value': 21622}])
        self.assertEqual(musveren['join'], [{'pointer': '/mesh_name', 'value': 'LineageMonsters.field_stalker_m00'}])
        for selection in recipe['selections']:
            self.assertLessEqual(set(selection), set(UNCHANGED_SELECTION_FIELDS) | {'roles', 'unresolved'})

    def test_the_description_says_the_routing_is_unresolved_until_bound_from_decoded_columns(self):
        description = read_recipe()['description']
        self.assertIn('role-to-column routing is unresolved until it is bound from decoded npcgrp/skillsoundgrp columns with exact source '
                      'identities (ACT-05)', description)
        self.assertNotIn('name-match presentation candidates', description)

    def test_the_bundling_script_refuses_the_recipe_naming_every_selection_role_and_reason(self):
        with tempfile.TemporaryDirectory(prefix='combat-routing-') as temporary:
            completed = subprocess.run([sys.executable, '-B', str(BUNDLING_SCRIPT), '--recipe', str(RECIPE_PATH), '--output',
                                        str(Path(temporary) / 'bundle'), '--plan'], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 1, completed.stdout)
        self.assertIn('unresolved', completed.stderr)
        for selection_id, columns in HAND_TYPED_ROLE_COLUMNS.items():
            table = EXPECTED_SELECTION_TABLES[selection_id]
            for role in columns:
                with self.subTest(selection=selection_id, role=role):
                    self.assertIn(f'{selection_id}/{role} combat-role-route-unresolved:{table}/{role}', completed.stderr)


if __name__ == '__main__':
    unittest.main()
