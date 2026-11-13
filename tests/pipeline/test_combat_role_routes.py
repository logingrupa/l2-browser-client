import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.combat_role_routes import (COMBAT_ROLE_ROUTE_PROOF, CombatRouteSourceConflict, bind_combat_role_routes, bound_route_records,
                                       combat_route_config_manifest, combat_route_table_manifest, descriptor_record_field_names,
                                       read_combat_role_route_proof)
from actors.combat_sound_route_recipe import read_combat_sound_route_recipe

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
SOUND_PACKAGE_STEMS = {'hitsound', 'monstersound', 'skillsound'}
SYNTHETIC_NATIVE = {
    'GetAttackItemSound 0x1': 'weapon +0x10/+0x14 item list; else NPC -> npc +0x20/+0x24, radius +0x40; else char rec+0x90/+0x94',
    'GetDefenseItemSound 0x2': 'armor +0x50/+0x54; NPC +0x28/+0x2c radius +0x40',
    'GetDamageSound 0x3': 'NPC: roll then +0x30/+0x34, radius +0x40',
    'GetAttackVoiceSound 0x4': 'char voice rec+0x98+fam*4',
    'FL2NpcData::Serialize 0x5': '+0x20/+0x24 snd1, +0x28/+0x2c snd2, +0x30/+0x34 snd3, +0x40 floats in DAT order',
    'Action_Attack 0x6': 'a3 miss -> return. a5 crit -> [EtcSound] CriticalSound/_Vol (0x7). a6 ss or attacker flag -> SoulShotSound (0x8). else defense',
    'char loader': '15 records, Serialize into this+0x10 in DAT order',
}
NO_RECIPE_ROUTES = {'path': 'recipes/actors/combat-sound-routes.json', 'sha256': 'e' * 64, 'document': {'routes': []}}
SKILL_SOUND_READERS = ['UINT', 'UINT'] + (['UNICODE'] * 3 + ['FLOAT'] * 6) * 3 + ['UNICODE'] * 30 + ['FLOAT', 'FLOAT']
SKILL_SOUND_LAYOUT = ET.fromstring(
    '<file pattern="Interlude"><node name="data" reader="UINT"/><for name="skillsound" size="#data" hidden="false">'
    + ''.join(f'<node name="column_{ordinal}" reader="{reader}"/>' for ordinal, reader in enumerate(SKILL_SOUND_READERS)) + '</for></file>')
EXPECTED_NPCGRP_BINDING = {
    'table': 'npcgrp',
    'routes': {
        'attackItem': {'table': 'npcgrp', 'descriptorSha256': DESCRIPTOR_SHA256, 'fieldOrdinal': 2, 'fieldName': 'first_field',
                       'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                                      'anchors': ['GetAttackItemSound 0x1', 'FL2NpcData::Serialize 0x5']}},
        'defense': {'table': 'npcgrp', 'descriptorSha256': DESCRIPTOR_SHA256, 'fieldOrdinal': 3, 'fieldName': 'second_field',
                    'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                                   'anchors': ['GetDefenseItemSound 0x2', 'FL2NpcData::Serialize 0x5']}},
        'damage': {'table': 'npcgrp', 'descriptorSha256': DESCRIPTOR_SHA256, 'fieldOrdinal': 4, 'fieldName': 'third_field',
                   'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                                  'anchors': ['GetDamageSound 0x3', 'FL2NpcData::Serialize 0x5']}}},
    'unresolved': {'attackVoice': {'reason': 'combat-role-route-unresolved:npcgrp/attackVoice',
                                   'detail': 'GetAttackVoiceSound 0x4 reads no sound member of FL2NpcData::Serialize 0x5'}}}


def is_synthetic_sound_reference(reference):
    return reference.split('.', 1)[0].casefold() in SOUND_PACKAGE_STEMS


def synthetic_manifest(rows=SYNTHETIC_ROWS):
    return combat_route_table_manifest('npcgrp', DESCRIPTOR_SHA256, SYNTHETIC_LAYOUT, rows, is_synthetic_sound_reference)


def synthetic_proof(native=None):
    native = SYNTHETIC_NATIVE if native is None else native
    return {'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'sha256': COMBAT_ROLE_ROUTE_PROOF['sha256'], 'native': native}


def skill_sound_row(skill_id, names):
    row = {f'column_{ordinal}': ('' if reader == 'UNICODE' else 0.0) for ordinal, reader in enumerate(SKILL_SOUND_READERS)}
    row.update(column_0=skill_id, column_1=1, **{f'column_{ordinal}': name for ordinal, name in names.items()})
    return row


def skill_sound_manifest():
    rows = [skill_sound_row(1, {2: 'SkillSound.a_cast', 3: 'SkillSound.a_shot'}), skill_sound_row(2, {11: 'SkillSound.b_cast', 21: 'SkillSound.b_shot'})]
    return combat_route_table_manifest('skillsoundgrp', DESCRIPTOR_SHA256, SKILL_SOUND_LAYOUT, rows, is_synthetic_sound_reference)


def committed_recipe():
    return read_combat_sound_route_recipe(ROOT)


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

    def test_the_manifest_records_each_field_ordinal_terms(self):
        self.assertEqual({field['name']: field['ordinalTerms'] for field in synthetic_manifest()['fields']}, {
            'npc_id': {'ordinalConstant': 0, 'ordinalCountTerms': 0}, 'skin': {'ordinalConstant': 2, 'ordinalCountTerms': 0},
            'first_field': {'ordinalConstant': 3, 'ordinalCountTerms': 1}, 'second_field': {'ordinalConstant': 4, 'ordinalCountTerms': 2},
            'third_field': {'ordinalConstant': 5, 'ordinalCountTerms': 3}, 'volume_like': {'ordinalConstant': 5, 'ordinalCountTerms': 4}})


class CombatRoleRouteBindingTests(unittest.TestCase):
    def test_getter_offsets_and_the_serialization_dat_order_bind_attack_defense_and_damage(self):
        self.assertEqual(bind_combat_role_routes(synthetic_manifest(), synthetic_proof(), NO_RECIPE_ROUTES), EXPECTED_NPCGRP_BINDING)

    def test_with_the_committed_recipe_the_npcgrp_binding_is_unchanged_key_for_key(self):
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof(), committed_recipe())
        self.assertEqual(json.dumps(result, sort_keys=True), json.dumps(EXPECTED_NPCGRP_BINDING, sort_keys=True))

    def test_a_proof_missing_one_getter_anchor_leaves_only_that_role_unresolved(self):
        native = {key: value for key, value in SYNTHETIC_NATIVE.items() if not key.startswith('GetDefenseItemSound')}
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof(native), NO_RECIPE_ROUTES)
        self.assertEqual(set(result['routes']), {'attackItem', 'damage'})
        self.assertEqual(result['unresolved']['defense'], {'reason': 'combat-role-route-unresolved:npcgrp/defense',
                                                           'detail': 'route proof has 0 GetDefenseItemSound anchors'})

    def test_a_proof_whose_hash_differs_from_the_pin_or_a_missing_proof_leaves_every_proof_role_unresolved(self):
        for label, proof, detail in (('hash differs', {**synthetic_proof(), 'sha256': 'e' * 64}, 'route proof hash differs from the pin'),
                                     ('missing', None, 'route proof is missing')):
            with self.subTest(label):
                result = bind_combat_role_routes(synthetic_manifest(), proof, NO_RECIPE_ROUTES)
                self.assertEqual(result['routes'], {})
                self.assertEqual(list(result['unresolved']), ['attackItem', 'attackVoice', 'defense', 'damage'])
                self.assertEqual({entry['detail'] for entry in result['unresolved'].values()}, {detail})

    def test_a_getter_offset_that_maps_to_zero_or_several_members_stays_unresolved(self):
        native = dict(SYNTHETIC_NATIVE)
        native['GetDamageSound 0x3'] = 'NPC: +0x20/+0x24 or +0x30/+0x34'
        native['GetDefenseItemSound 0x2'] = 'NPC +0x70/+0x74'
        result = bind_combat_role_routes(synthetic_manifest(), synthetic_proof(native), NO_RECIPE_ROUTES)
        self.assertEqual(result['unresolved']['damage']['detail'], 'GetDamageSound 0x3 reads 2 sound members of FL2NpcData::Serialize 0x5')
        self.assertEqual(result['unresolved']['defense']['detail'], 'GetDefenseItemSound 0x2 reads no sound member of FL2NpcData::Serialize 0x5')

    def test_a_sound_member_count_that_differs_from_the_descriptor_sound_fields_binds_nothing(self):
        rows = copy.deepcopy(SYNTHETIC_ROWS)
        for row in rows:
            row['first_field'] = [{'param': 'SkinTex.plain'}]
        result = bind_combat_role_routes(synthetic_manifest(rows), synthetic_proof(), NO_RECIPE_ROUTES)
        self.assertEqual(result['routes'], {})
        self.assertEqual(result['unresolved']['damage']['detail'],
                         'FL2NpcData::Serialize 0x5 names 3 sound members but the descriptor holds 2 sound-reference fields')

    def test_a_table_the_proof_names_no_serialization_anchor_for_and_the_recipe_does_not_list_stays_unresolved(self):
        armor = bind_combat_role_routes({**synthetic_manifest(), 'table': 'armorgrp'}, synthetic_proof(), NO_RECIPE_ROUTES)
        self.assertEqual(armor['unresolved'], {'defense': {'reason': 'combat-role-route-unresolved:armorgrp/defense',
                                                           'detail': 'route proof names no serialization anchor for armorgrp'}})

    def test_a_config_role_binds_only_to_a_decoded_key_the_branch_anchor_names_with_its_section(self):
        config = combat_route_config_manifest('f' * 64, ['CharSound.Random', 'EtcSound.CriticalSound', 'EtcSound.SoulShotSound'])
        result = bind_combat_role_routes(config, synthetic_proof(), NO_RECIPE_ROUTES)
        self.assertEqual(result['routes']['critical'], {
            'table': 'alaudio', 'descriptorSha256': 'f' * 64, 'fieldOrdinal': 1, 'fieldName': 'EtcSound.CriticalSound',
            'routeProof': {'proofPath': COMBAT_ROLE_ROUTE_PROOF['path'], 'proofSha256': COMBAT_ROLE_ROUTE_PROOF['sha256'],
                           'anchors': ['Action_Attack 0x6']}})
        undecoded = bind_combat_role_routes(combat_route_config_manifest('f' * 64, ['CharSound.Random']), synthetic_proof(), NO_RECIPE_ROUTES)
        self.assertEqual(undecoded['unresolved']['critical']['detail'], 'decoded ALAudio.int config holds 0 EtcSound.CriticalSound keys')

    def test_the_binder_types_no_column_label_and_never_reads_the_hand_recipe(self):
        for name in ('combat_role_routes.py', 'combat_sound_route_recipe.py', 'dat_field_ordinals.py'):
            source = (ROOT / 'scripts' / 'actors' / name).read_text(encoding='utf-8')
            for label in ('attack_sound', 'defense_sound', 'damage_sound', 'spelleffect_sound', 'shoteffect_sound', 'voice_snd', 'item_sound',
                          'previousValue', 'native-combat-audio.json'):
                with self.subTest(name=name, label=label):
                    self.assertNotIn(label, source)


class RecipeRouteBindingTests(unittest.TestCase):
    def test_skillsoundgrp_cast_and_shot_bind_to_the_ordered_member_fields_of_the_recipe(self):
        recipe = committed_recipe()
        result = bind_combat_role_routes(skill_sound_manifest(), None, recipe)
        self.assertEqual(result['unresolved'], {})
        self.assertEqual([(record['member'], record['fieldOrdinal'], record['fieldName']) for record in result['routes']['cast']],
                         [(0, 2, 'column_2'), (1, 11, 'column_11'), (2, 20, 'column_20')])
        self.assertEqual([record['fieldOrdinal'] for record in result['routes']['shot']], [3, 12, 21])
        self.assertEqual(result['routes']['cast'][0]['routeProof'], {
            'proofPath': 'recipes/actors/combat-sound-routes.json', 'proofSha256': recipe['sha256'],
            'anchors': ['FL2SkillSoundData::Serialize 0x1044ec30', 'GetSkillSoundData 0x10478280', 'APawn::PlaySkillSound 0x104ee5a0',
                        'APawn::SkillEffectInit 0x104fa6ad']})
        self.assertEqual(len(bound_route_records(result)), 6)

    def test_a_member_that_matches_zero_or_two_fields_stays_unresolved_with_the_match_count(self):
        recipe = copy.deepcopy(committed_recipe())
        cast = next(entry for entry in recipe['document']['routes'] if entry['role'] == 'cast')
        cast['members'][1] = {**cast['members'][1], 'ordinalConstant': 99}
        result = bind_combat_role_routes(skill_sound_manifest(), None, recipe)
        self.assertEqual(result['unresolved']['cast'], {'reason': 'combat-role-route-unresolved:skillsoundgrp/cast',
                                                        'detail': 'recipe member 1 at DAT field 11 matches 0 decoded skillsoundgrp fields'})
        manifest = skill_sound_manifest()
        manifest['fields'][4]['ordinalTerms'] = dict(manifest['fields'][3]['ordinalTerms'])
        doubled = bind_combat_role_routes(manifest, None, committed_recipe())
        self.assertEqual(doubled['unresolved']['shot']['detail'], 'recipe member 0 at DAT field 3 matches 2 decoded skillsoundgrp fields')

    def test_a_table_role_claimed_by_both_the_recipe_and_the_proof_is_refused(self):
        recipe = copy.deepcopy(committed_recipe())
        recipe['document']['routes'].append({**recipe['document']['routes'][0], 'table': 'npcgrp', 'role': 'damage'})
        with self.assertRaisesRegex(CombatRouteSourceConflict, "npcgrp roles \\['damage'\\] are claimed by both"):
            bind_combat_role_routes(synthetic_manifest(), synthetic_proof(), recipe)


HAND_RECIPE_COMPARISON = {
    'npcgrp': {'attackItem': 'agree', 'attackVoice': 'not-bound', 'defense': 'agree', 'damage': 'agree'},
    'alaudio': {'critical': 'agree', 'soulshot': 'not-bound'},
    'chargrp': {'attackItem': 'not-bound', 'attackVoice': 'not-bound', 'defense': 'not-bound', 'damage': 'not-bound'},
    'armorgrp': {'defense': 'not-bound'}, 'weapongrp': {'attackItem': 'not-bound'}, 'skillsoundgrp': {'cast': 'agree', 'shot': 'agree'},
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
    field_name = route['members'][0]['fieldName'] if 'members' in route else route['fieldName']
    return 'agree' if hand_columns == {field_name} else 'disagree'


class HandRecipeCrossCheckTests(unittest.TestCase):
    def test_every_committed_route_is_compared_with_the_hand_recipe_on_member_0_and_no_bound_route_disagrees(self):
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
