import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.combat_role_routes import (COMBAT_ROLE_ROUTE_PROOF, bind_combat_role_routes, combat_route_config_manifest,
                                       combat_route_table_manifest, descriptor_record_field_names, read_combat_role_route_proof)

DESCRIPTOR_SHA256 = 'd' * 64
SYNTHETIC_LAYOUT = ET.fromstring(
    '<file pattern="Interlude"><node name="data" reader="UINT"/><for name="npc" size="#data" hidden="false">'
    '<node name="npc_id" reader="UINT"/><node name="skin" reader="UINT"/><for name="skin" size="#skin"><node name="param_skin" reader="UNICODE"/></for>'
    '<node name="first_field" reader="UINT"/><for name="first_field" size="#first_field"><node name="param" reader="UNICODE"/></for>'
    '<node name="second_field" reader="UINT"/><for name="second_field" size="#second_field"><node name="param" reader="UNICODE"/></for>'
    '<node name="third_field" reader="UINT"/><for name="third_field" size="#third_field"><node name="param" reader="UNICODE"/></for>'
    '<node name="volume_like" reader="FLOAT"/></for></file>')
SYNTHETIC_ROWS = [
    {'npc_id': 1, 'skin': [{'param_skin': 'SkinTex.skin_t00'}], 'first_field': [{'param': ''}], 'second_field': [{'param': 'HitSound.Hit_1'}],
     'third_field': [{'param': 'MonsterSound.dmg_1'}, {'param': 'MonsterSound.dmg_2'}], 'volume_like': 1.0},
    {'npc_id': 2, 'skin': [{'param_skin': 'SkinTex.skin_t01'}], 'first_field': [{'param': 'MonsterSound.atk_1'}], 'second_field': [],
     'third_field': [{'param': 'MonsterSound.dmg_3'}], 'volume_like': 2.0},
]
SOUND_PACKAGE_STEMS = {'hitsound', 'monstersound'}
SYNTHETIC_NATIVE = {
    'GetAttackItemSound 0x1': 'weapon +0x10/+0x14 item list; else NPC -> npc +0x20/+0x24, radius +0x40; else char rec+0x90/+0x94',
    'GetDefenseItemSound 0x2': 'armor +0x50/+0x54; NPC +0x28/+0x2c radius +0x40',
    'GetDamageSound 0x3': 'NPC: roll then +0x30/+0x34, radius +0x40',
    'GetAttackVoiceSound 0x4': 'char voice rec+0x98+fam*4',
    'FL2NpcData::Serialize 0x5': '+0x20/+0x24 snd1, +0x28/+0x2c snd2, +0x30/+0x34 snd3, +0x40 floats in DAT order',
    'Action_Attack 0x6': 'a3 miss -> return. a5 crit -> [EtcSound] CriticalSound/_Vol (0x7). a6 ss or attacker flag -> SoulShotSound (0x8). else defense',
    'char loader': '15 records, Serialize into this+0x10 in DAT order',
}


def is_synthetic_sound_reference(reference):
    return reference.split('.', 1)[0].casefold() in SOUND_PACKAGE_STEMS


def synthetic_manifest(rows=SYNTHETIC_ROWS):
    return combat_route_table_manifest('npcgrp', DESCRIPTOR_SHA256, descriptor_record_field_names(SYNTHETIC_LAYOUT), rows,
                                       is_synthetic_sound_reference)


def synthetic_proof(native=None):
    native = SYNTHETIC_NATIVE if native is None else native
    return {'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'sha256': COMBAT_ROLE_ROUTE_PROOF['sha256'], 'native': native}


class DescriptorFieldOrderTests(unittest.TestCase):
    def test_record_fields_keep_descriptor_order_and_name_a_counted_list_once(self):
        self.assertEqual(descriptor_record_field_names(SYNTHETIC_LAYOUT),
                         ['npc_id', 'skin', 'first_field', 'second_field', 'third_field', 'volume_like'])

    def test_a_field_is_a_sound_reference_only_when_every_non_empty_string_names_a_sound_package(self):
        fields = synthetic_manifest()['fields']
        self.assertEqual([field['name'] for field in fields if field['soundReference']], ['first_field', 'second_field', 'third_field'])
        mixed_rows = copy.deepcopy(SYNTHETIC_ROWS)
        mixed_rows[1]['first_field'] = [{'param': 'SkinTex.not_a_sound'}]
        self.assertEqual([field['name'] for field in synthetic_manifest(mixed_rows)['fields'] if field['soundReference']],
                         ['second_field', 'third_field'])


class CombatRoleRouteBindingTests(unittest.TestCase):
    def test_getter_offsets_and_the_serialization_dat_order_bind_attack_defense_and_damage(self):
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof())
        self.assertEqual(list(result['routes']), ['attackItem', 'defense', 'damage'])
        self.assertEqual(result['routes']['attackItem'], {
            'table': 'npcgrp', 'descriptorSha256': DESCRIPTOR_SHA256, 'fieldOrdinal': 2, 'fieldName': 'first_field',
            'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                           'anchors': ['GetAttackItemSound 0x1', 'FL2NpcData::Serialize 0x5']}})
        self.assertEqual((result['routes']['defense']['fieldName'], result['routes']['defense']['fieldOrdinal']), ('second_field', 3))
        self.assertEqual((result['routes']['damage']['fieldName'], result['routes']['damage']['fieldOrdinal']), ('third_field', 4))
        self.assertEqual(result['unresolved'], {'attackVoice': {
            'reason': 'combat-role-route-unresolved:npcgrp/attackVoice',
            'detail': 'GetAttackVoiceSound 0x4 reads no sound member of FL2NpcData::Serialize 0x5'}})

    def test_a_proof_missing_one_getter_anchor_leaves_only_that_role_unresolved(self):
        native = {key: value for key, value in SYNTHETIC_NATIVE.items() if not key.startswith('GetDefenseItemSound')}
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof(native))
        self.assertEqual(set(result['routes']), {'attackItem', 'damage'})
        self.assertEqual(result['unresolved']['defense'], {'reason': 'combat-role-route-unresolved:npcgrp/defense',
                                                           'detail': 'route proof has 0 GetDefenseItemSound anchors'})

    def test_a_proof_whose_hash_differs_from_the_pin_or_a_missing_proof_leaves_every_role_unresolved(self):
        for label, proof, detail in (('hash differs', {**synthetic_proof(), 'sha256': 'e' * 64}, 'route proof hash differs from the pin'),
                                     ('missing', None, 'route proof is missing')):
            with self.subTest(label):
                result = bind_combat_role_routes(synthetic_manifest(), proof)
                self.assertEqual(result['routes'], {})
                self.assertEqual(list(result['unresolved']), ['attackItem', 'attackVoice', 'defense', 'damage'])
                self.assertEqual({entry['detail'] for entry in result['unresolved'].values()}, {detail})

    def test_a_getter_offset_that_maps_to_zero_or_several_members_stays_unresolved(self):
        native = dict(SYNTHETIC_NATIVE)
        native['GetDamageSound 0x3'] = 'NPC: +0x20/+0x24 or +0x30/+0x34'
        native['GetDefenseItemSound 0x2'] = 'NPC +0x70/+0x74'
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof(native))
        self.assertEqual(result['unresolved']['damage']['detail'], 'GetDamageSound 0x3 reads 2 sound members of FL2NpcData::Serialize 0x5')
        self.assertEqual(result['unresolved']['defense']['detail'], 'GetDefenseItemSound 0x2 reads no sound member of FL2NpcData::Serialize 0x5')

    def test_a_sound_member_count_that_differs_from_the_descriptor_sound_fields_binds_nothing(self):
        rows = copy.deepcopy(SYNTHETIC_ROWS)
        for row in rows:
            row['first_field'] = [{'param': 'SkinTex.plain'}]
        result = bind_combat_role_routes(synthetic_manifest(rows), synthetic_proof())
        self.assertEqual(result['routes'], {})
        self.assertEqual(result['unresolved']['damage']['detail'],
                         'FL2NpcData::Serialize 0x5 names 3 sound members but the descriptor holds 2 sound-reference fields')

    def test_a_table_whose_serialization_anchor_lists_no_sound_member_or_has_no_anchor_stays_unresolved(self):
        chargrp = {**synthetic_manifest(), 'table': 'chargrp'}
        result = bind_combat_role_routes(chargrp, synthetic_proof())
        self.assertEqual(result['routes'], {})
        self.assertEqual(result['unresolved']['attackItem'], {'reason': 'combat-role-route-unresolved:chargrp/attackItem',
                                                              'detail': 'char loader names no sound member in DAT order'})
        skills = bind_combat_role_routes({**synthetic_manifest(), 'table': 'skillsoundgrp'}, synthetic_proof())
        self.assertEqual(list(skills['unresolved']), ['cast', 'shot'])
        self.assertEqual(skills['unresolved']['cast']['detail'], 'route proof names no serialization anchor for skillsoundgrp')
        armor = bind_combat_role_routes({**synthetic_manifest(), 'table': 'armorgrp'}, synthetic_proof())
        self.assertEqual(list(armor['unresolved']), ['defense'])

    def test_a_config_role_binds_only_to_a_decoded_key_the_branch_anchor_names_with_its_section(self):
        config = combat_route_config_manifest('f' * 64, ['CharSound.Random', 'EtcSound.CriticalSound', 'EtcSound.SoulShotSound'])
        result = bind_combat_role_routes(config, synthetic_proof())
        self.assertEqual(result['routes']['critical'], {
            'table': 'alaudio', 'descriptorSha256': 'f' * 64, 'fieldOrdinal': 1, 'fieldName': 'EtcSound.CriticalSound',
            'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                           'anchors': ['Action_Attack 0x6']}})
        self.assertEqual(result['unresolved']['soulshot']['detail'], 'Action_Attack 0x6 branch ss names no [Section] key')
        undecoded = bind_combat_role_routes(combat_route_config_manifest('f' * 64, ['CharSound.Random']), synthetic_proof())
        self.assertEqual(undecoded['unresolved']['critical']['detail'], 'decoded ALAudio.int config holds 0 EtcSound.CriticalSound keys')

    def test_the_binder_types_no_column_label_and_never_reads_the_hand_recipe(self):
        source = (ROOT / 'scripts' / 'actors' / 'combat_role_routes.py').read_text(encoding='utf-8')
        for label in ('attack_sound', 'defense_sound', 'damage_sound', 'spelleffect_sound', 'voice_snd', 'item_sound', 'previousValue',
                      'native-combat-audio.json'):
            self.assertNotIn(label, source)


HAND_RECIPE_COMPARISON = {
    'npcgrp': {'attackItem': 'agree', 'attackVoice': 'not-bound', 'defense': 'agree', 'damage': 'agree'},
    'alaudio': {'critical': 'agree', 'soulshot': 'not-bound'},
    'chargrp': {'attackItem': 'not-bound', 'attackVoice': 'not-bound', 'defense': 'not-bound', 'damage': 'not-bound'},
    'armorgrp': {'defense': 'not-bound'}, 'weapongrp': {'attackItem': 'not-bound'}, 'skillsoundgrp': {'cast': 'not-bound', 'shot': 'not-bound'},
}


def hand_recipe_columns_by_table():
    recipe = json.loads((ROOT / 'recipes' / 'native-combat-audio.json').read_bytes())
    columns = {}
    for selection in recipe['selections']:
        for role, entry in selection['unresolved']['roles'].items():
            columns.setdefault(selection['table'], {}).setdefault(role, set()).add(entry['previousValue'])
    return columns


def hand_recipe_comparison(route, hand_columns):
    if route['status'] != 'bound':
        return 'not-bound'
    if hand_columns is None:
        return 'not-in-hand-recipe'
    return 'agree' if hand_columns == {route['fieldName']} else 'disagree'


class HandRecipeCrossCheckTests(unittest.TestCase):
    def test_every_committed_route_is_compared_with_the_hand_recipe_and_no_bound_route_disagrees(self):
        census = json.loads((ROOT / 'docs' / 'parts' / 'audio' / 'actor-sound-census.json').read_bytes())
        hand_columns = hand_recipe_columns_by_table()
        comparison = {table: {role: hand_recipe_comparison(route, hand_columns.get(table, {}).get(role)) for role, route in routes.items()}
                      for table, routes in census['routes'].items()}
        self.assertEqual(comparison, HAND_RECIPE_COMPARISON)
        self.assertNotIn('disagree', {value for routes in comparison.values() for value in routes.values()})


class CombatRoleRouteProofTests(unittest.TestCase):
    def test_the_pin_names_the_route_proof_path_its_main_checkout_default_and_hash(self):
        self.assertEqual(COMBAT_ROLE_ROUTE_PROOF['path'],
                         'artifacts/native-parity/research/native-sound-answers-20261107/evidence/q4-hit-sounds-verify/verify_anchors.json')
        self.assertEqual(COMBAT_ROLE_ROUTE_PROOF['sha256'], '03c3a03627d8c71527ef93c23f79cc574b34d27450b76a3b7a7d44810a4ab785')
        recipe = json.loads((ROOT / 'recipes' / 'native-combat-audio.json').read_bytes())
        self.assertIn({'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'bytes': 6715, 'sha256': COMBAT_ROLE_ROUTE_PROOF['sha256']},
                      recipe['supportingEvidence'])

    def test_reading_a_proof_reports_its_measured_hash_and_parses_only_a_pinned_document(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix='route-proof-') as temporary:
            root = Path(temporary)
            self.assertIsNone(read_combat_role_route_proof([root]))
            proof_path = root / COMBAT_ROLE_ROUTE_PROOF['path']
            proof_path.parent.mkdir(parents=True)
            payload = json.dumps({'native': SYNTHETIC_NATIVE}).encode()
            proof_path.write_bytes(payload)
            self.assertEqual(read_combat_role_route_proof([root]),
                             {'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'sha256': hashlib.sha256(payload).hexdigest(), 'native': None})


if __name__ == '__main__':
    unittest.main()
