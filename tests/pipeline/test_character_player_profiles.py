import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.character_player_profiles import (CLIP_NAME_CASE_RULE, actor_scale, bound_family_clip, character_player_profile, clip_binding_reason,
                                              family_clip_binding)
from actors.character_requests import character_profile_fields
from actors.character_store_records import (CHARACTER_PLAYER_PROFILES_RECORD_ID, PLAYER_ALIAS_FIELDS, profile_shape, stored_player_profiles,
                                            write_player_profile_pack)
from test_character_requests import JOINED_CLASS, SYNTHETIC_HAND_VALUES, class_definitions, joined_actor_class, synthetic_animation_families

SOURCE_SHA256 = '8' * 64
CLIP_NAMES = ['Wait_Hand_SyntheticFighter', 'run_Hand_SyntheticFighter', 'Atk01_Hand_SyntheticFighter', 'Death_SyntheticFighter']
ACTOR_CHAIN = {JOINED_CLASS: {'properties': {'CollisionHeight': 23.0, 'CollisionRadius': 9.0}, 'nativeSuperClass': 'Engine.Actor'},
               'Engine.Actor': {'properties': {'DrawScale': 1.0, 'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}}, 'nativeSuperClass': None}}


def profile_fields(definitions=None, hand_values=None):
    definitions = definitions or ACTOR_CHAIN
    return character_profile_fields(joined_actor_class(definitions[JOINED_CLASS]['properties']), class_definitions(definitions),
                                    synthetic_animation_families(JOINED_CLASS, hand_values))


def model_record(row_index):
    return {'id': f'character-model:{row_index}', 'assetId': f'interlude:assembly:character-{row_index}',
            'source': {'object': 'Fighter.MFighter_m001_u', 'sha256': SOURCE_SHA256}}


def generated_profile(row_index, clip_names=CLIP_NAMES):
    fields = profile_fields()
    binding = family_clip_binding(fields['animationFamilies'], clip_names, f'character-model:{row_index}')
    receipt = {'unitKey': f'character:{row_index}', 'config': {'generated': {'profileFields': fields}}}
    return character_player_profile(receipt, {'path': f'work/character__{row_index}/characters/receipt.json', 'sha256': '1' * 64}, binding,
                                    model_record(row_index))


class BoundFamilyClipTests(unittest.TestCase):
    def test_an_exact_name_binds_as_exact_and_a_unique_ascii_case_variant_binds_as_case_only(self):
        self.assertEqual(bound_family_clip('run_Hand_SyntheticFighter', CLIP_NAMES), ('exact', 'run_Hand_SyntheticFighter', ['run_Hand_SyntheticFighter']))
        self.assertEqual(bound_family_clip('wait_Hand_SyntheticFighter', CLIP_NAMES),
                         ('case-only', 'Wait_Hand_SyntheticFighter', ['Wait_Hand_SyntheticFighter']))

    def test_two_case_variants_are_ambiguous_none_is_missing_and_a_none_name_has_no_family_value(self):
        self.assertEqual(bound_family_clip('run', ['Run', 'RUN'])[0:2], ('ambiguous', None))
        self.assertEqual(bound_family_clip('walk_Hand_SyntheticFighter', CLIP_NAMES), ('missing-clip', None, []))
        self.assertEqual(bound_family_clip(None, CLIP_NAMES), ('no-family-value', None, []))

    def test_only_ascii_letters_fold(self):
        self.assertEqual(bound_family_clip('straße', ['STRASSE'])[0], 'unsupported-syntax')
        self.assertEqual(bound_family_clip('Run', ['runİ'])[0], 'missing-clip')


class FamilyClipBindingTests(unittest.TestCase):
    def test_required_clips_bind_and_each_player_alias_gets_one_evidence_row(self):
        binding = family_clip_binding(profile_fields()['animationFamilies'], CLIP_NAMES, 'character-model:0')
        self.assertEqual(binding['clips'], {'idle': 'Wait_Hand_SyntheticFighter', 'run': 'run_Hand_SyntheticFighter',
                                            'attack': 'Atk01_Hand_SyntheticFighter', 'death': 'Death_SyntheticFighter'})
        self.assertEqual([row['alias'] for row in binding['rows']], [alias for alias, _ in PLAYER_ALIAS_FIELDS])
        rows = {row['alias']: row for row in binding['rows']}
        self.assertEqual(rows['run'], {'alias': 'run', 'key': 'RunAnimName[0]', 'status': 'exact', 'reference': 'run_Hand_SyntheticFighter',
                                       'line': 4, 'selectionPath': 'APawn::GetRunAnimName 0x10340001'})
        self.assertEqual(rows['idle']['status'], 'case-only')
        self.assertEqual((rows['damage']['status'], rows['damageFly']['status']), ('no-family-value', 'no-family-value'))
        self.assertIn('outside the 5 standard families', rows['damage']['reason'])
        self.assertIn('is FName None', rows['damageFly']['reason'])
        self.assertEqual(rows['social2']['key'], 'PcSocialAnimName[2]')
        self.assertIsNone(clip_binding_reason(binding))

    def test_a_missing_or_ambiguous_required_clip_names_the_first_missing_field(self):
        missing = family_clip_binding(profile_fields()['animationFamilies'], CLIP_NAMES[:1] + CLIP_NAMES[2:], 'character-model:0')
        self.assertEqual(clip_binding_reason(missing), 'character-clip-missing:RunAnimName')
        ambiguous = family_clip_binding(profile_fields()['animationFamilies'], CLIP_NAMES + ['DEATH_SyntheticFighter'], 'character-model:0')
        self.assertEqual(clip_binding_reason(ambiguous), 'character-clip-missing:DeathAnimName')
        self.assertEqual({row['alias']: row['status'] for row in ambiguous['rows']}['death'], 'ambiguous')


class CharacterPresentationTests(unittest.TestCase):
    def test_actor_scale_is_draw_scale_3d_in_x_z_y_order_times_draw_scale(self):
        definitions = {**ACTOR_CHAIN, 'Engine.Actor': {'properties': {'DrawScale': 2.0, 'DrawScale3D': {'X': 1.0, 'Y': 3.0, 'Z': 5.0}},
                                                       'nativeSuperClass': None}}
        fields = profile_fields(definitions)
        self.assertEqual(actor_scale(fields['presentation']), [2.0, 10.0, 6.0])
        self.assertEqual(fields['presentation']['drawScale3D']['class'], 'Engine.Actor')

    def test_an_authored_pivot_seals_character_pivot_unapplied_and_an_absent_one_is_a_limitation(self):
        pivoted = {**ACTOR_CHAIN, JOINED_CLASS: {**ACTOR_CHAIN[JOINED_CLASS],
                                                 'properties': {**ACTOR_CHAIN[JOINED_CLASS]['properties'], 'PrePivot': {'X': 0.0, 'Y': 0.0, 'Z': -4.0}}}}
        self.assertEqual(profile_fields(pivoted)['reason'], 'character-pivot-unapplied')
        self.assertEqual(profile_fields()['reason'], None)
        self.assertIn(f'PrePivot is absent through the checked ancestry {JOINED_CLASS} > Engine.Actor; no offset is applied.',
                      generated_profile(0)['limitations'])

    def test_a_missing_draw_scale_keeps_the_profile_a_gap(self):
        definitions = {**ACTOR_CHAIN, 'Engine.Actor': {'properties': {'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}}, 'nativeSuperClass': None}}
        self.assertEqual(profile_fields(definitions)['reason'], 'actor-default-unresolved:DrawScale')


class CharacterPlayerProfileTests(unittest.TestCase):
    def test_the_profile_carries_its_chargrp_index_model_identity_clips_and_facing(self):
        profile = generated_profile(3)
        profile_shape(profile)
        self.assertEqual({key: profile[key] for key in ('id', 'chargrpIndex', 'name', 'catalogId', 'assetId', 'sourceObject', 'forwardAxis',
                                                        'actorScale', 'collisionRadius', 'collisionHeight', 'upperItems', 'sourceUnitsPerMetre')},
                         {'id': 'character-3', 'chargrpIndex': 3, 'name': JOINED_CLASS, 'catalogId': 'character-model:3',
                          'assetId': 'interlude:assembly:character-3', 'sourceObject': 'Fighter.MFighter_m001_u', 'forwardAxis': [1, 0, 0],
                          'actorScale': [1.0, 1.0, 1.0], 'collisionRadius': 9.0, 'collisionHeight': 23.0, 'upperItems': [], 'sourceUnitsPerMetre': 100})
        self.assertEqual(profile['aliasEvidence']['family'], 'SyntheticFighter')
        self.assertIn(CLIP_NAME_CASE_RULE, profile['limitations'])

    def test_the_limitations_name_the_default_appearance_and_the_equipment_hair_mappings(self):
        limitations = generated_profile(0)['limitations']
        self.assertTrue(any('HairStyle 0, HairColor 0 and Face 0' in line and 'Phase 4' in line for line in limitations))
        self.assertTrue(any('helmetgrp and hairaccessarygrp' in line and '03-30' in line for line in limitations))
        self.assertFalse([line for line in limitations if 'undecoded' in line or 'unbound' in line])

    def test_the_shape_check_refuses_a_negative_chargrp_index(self):
        with self.assertRaisesRegex(ValueError, 'chargrpIndex'):
            profile_shape({**generated_profile(0), 'chargrpIndex': -1})

    def test_the_pack_is_sorted_by_chargrp_index_and_cataloged_as_character_player_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            store_root = Path(directory) / 'lane-store' / 'actors' / 'l2'
            store_root.mkdir(parents=True)
            record = write_player_profile_pack(store_root, CHARACTER_PLAYER_PROFILES_RECORD_ID, [generated_profile(2), generated_profile(0)])
            catalog = json.loads((store_root / 'catalog.json').read_bytes())
            self.assertEqual(catalog['playerProfiles'], [record])
            self.assertRegex(record['manifest'], r'^/l2/player-profiles/[a-f0-9]{64}/manifest\.json$')
            manifest = json.loads((store_root / record['manifest'][len('/l2/'):]).read_bytes())
            self.assertEqual((manifest['schemaVersion'], manifest['kind']), (1, 'native-player-profiles'))
            self.assertEqual([profile['chargrpIndex'] for profile in stored_player_profiles(store_root, CHARACTER_PLAYER_PROFILES_RECORD_ID)], [0, 2])
            self.assertIsNone(write_player_profile_pack(store_root, CHARACTER_PLAYER_PROFILES_RECORD_ID, []))
            self.assertEqual(json.loads((store_root / 'catalog.json').read_bytes()).get('playerProfiles'), [])


class PlayerAliasTableTests(unittest.TestCase):
    def test_the_python_alias_to_field_table_equals_the_browser_table(self):
        source = (ROOT / 'src' / 'assets' / 'native' / 'nativeAnimationAliases.ts').read_text(encoding='utf-8')
        listed = re.findall(r'\{ alias: "([A-Za-z0-9]+)", field: "([A-Za-z0-9]+)", group: "[a-z]+" \}', source)
        social = re.search(r'\.\.\.\[([0-9, ]+)\]\.map\(index => \(\{ alias: `social\$\{index\}`, field: "([A-Za-z]+)"', source)
        browser = listed + [(f'social{index.strip()}', social[2]) for index in social[1].split(',')]
        self.assertEqual(browser, list(PLAYER_ALIAS_FIELDS))
        required = re.search(r'requiredNativeAliases = \[([^\]]+)\]', source)[1]
        self.assertEqual([alias.strip().strip('"') for alias in required.split(',')], ['idle', 'run', 'attack', 'death'])

    def test_profile_fields_without_hand_values_keep_their_family_gap(self):
        self.assertEqual(profile_fields(hand_values={**SYNTHETIC_HAND_VALUES, 'RunAnimName': None})['reason'],
                         'actor-default-unresolved:RunAnimName')


if __name__ == '__main__':
    unittest.main()
