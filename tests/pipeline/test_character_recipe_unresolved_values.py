import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row

HAIR_LAYOUT_UNDECODED_REASON = 'hair-layout-undecoded'
HAIR_TEXTURE_GROUP_MARKER = '.Hair.'
STALE_LIMITATION_WORDS = 'explicit recipe appearance choice'
UNRESOLVED_LIMITATION_WORDS = ('hair texture and colour are unresolved', 'hairgrp/helmetgrp (DATA-02)', 'generated chargrp assemblies (ACT-01)')
FROZEN_NON_HAIR_PARTS = {
    'mfighter': [('Fighter', 'MFighter_m001_u', ['0=MFighter.MFighter_m001_t02_u']),
                 ('Fighter', 'MFighter_m001_l', ['0=MFighter.MFighter_m001_t02_l']),
                 ('Fighter', 'MFighter_m001_g', ['0=MFighter.MFighter_m001_t02_g']),
                 ('Fighter', 'MFighter_m001_b', ['0=MFighter.MFighter_m001_t02_b']),
                 ('Fighter', 'MFighter_m000_f', ['0=MFighter.MFighter_m000_t00_f'])],
    'mmagic': [('Magic', 'MMagic_m005_u', ['0=MMagic.MMagic_m005_t02_u']),
               ('Magic', 'MMagic_m003_l', ['0=MMagic.MMagic_m003_t02_l']),
               ('Magic', 'MMagic_m005_g', ['0=MMagic.MMagic_m005_t02_g']),
               ('Magic', 'MMagic_m003_b', ['0=MMagic.MMagic_m003_t02_b']),
               ('Magic', 'MMagic_m000_f', ['0=MMagic.MMagic_m000_t00_f'])],
    'fmagic': [('Magic', 'FMagic_m003_u', ['0=FMagic.FMagic_m003_t02_u']),
               ('Magic', 'FMagic_m002_l', ['0=FMagic.FMagic_m002_t02_l']),
               ('Magic', 'FMagic_m003_g', ['0=FMagic.FMagic_m003_t02_g']),
               ('Magic', 'FMagic_m002_b', ['0=FMagic.FMagic_m002_t02_b']),
               ('Magic', 'FMagic_m000_f', ['0=FMagic.FMagic_m000_t00_f'])],
    'ffighter': [('Fighter', 'FFighter_m001_u', ['0=FFighter.FFighter_m001_t02_u']),
                 ('Fighter', 'FFighter_m001_l', ['0=FFighter.FFighter_m001_t02_l']),
                 ('Fighter', 'FFighter_m001_g', ['0=FFighter.FFighter_m001_t02_g']),
                 ('Fighter', 'FFighter_m001_b', ['0=FFighter.FFighter_m001_t02_b']),
                 ('Fighter', 'FFighter_m000_f', ['0=FFighter.FFighter_m000_t00_f'])],
}
FROZEN_HAIR_PARTS = {
    'mfighter': [('Fighter', 'MFighter_m000_m00_ah'), ('Fighter', 'MFighter_m000_m00_bh')],
    'mmagic': [('Magic', 'magic.MMagic_m000_m00_ah'), ('Magic', 'MMagic_m000_m00_bh')],
    'fmagic': [('Magic', 'magic.FMagic_m000_m00_ah'), ('Magic', 'magic.FMagic_M000_M00_bh')],
    'ffighter': [('Fighter', 'FFighter_m000_m00_ah'), ('Fighter', 'FFighter_m000_m00_bh')],
}
PIPELINE_TWIN_RECIPES = {'ffighter': 'recipes/native-ffighter.json', 'fmagic': 'recipes/native-fmagic.json', 'mmagic': 'recipes/native-mmagic.json'}
FEMALE_FIGHTER_STAGE_PATH = ROOT / 'recipes' / 'native-player-ffighter-stage.json'
FEMALE_FIGHTER_PROFILE_ID = 'human-female-fighter'
FEMALE_FIGHTER_UNRESOLVED_COLLISION = {
    'collisionRadius': {'reason': 'actor-default-unresolved:CollisionRadius', 'previousValue': 8},
    'collisionHeight': {'reason': 'actor-default-unresolved:CollisionHeight', 'previousValue': 23.5},
}


def read_json(path):
    return json.loads(Path(path).read_bytes())


def human_recipe_request(name):
    requests = read_json(ROOT / 'recipes' / f'native-{name}.json')
    if len(requests) != 1:
        raise AssertionError(f'recipes/native-{name}.json must hold one request')
    return requests[0]


def is_hair_override(material):
    return HAIR_TEXTURE_GROUP_MARKER in material


def gap_row_with_reason(reason):
    return {'key': 'character:0', 'part': 'player-characters', 'step': 'characters', 'status': 'gap', 'reason': reason,
            'sourceIdentity': {'path': 'system/chargrp.dat', 'sha256': '0' * 64}, 'evidence': 'docs/parts/player-characters/EVIDENCE.md'}


class HumanRecipeHairMarkerTests(unittest.TestCase):
    def setUp(self):
        self.reason_patterns = load_gap_reason_patterns()

    def test_each_human_recipe_marks_exactly_its_two_hair_parts_unresolved_with_the_removed_override(self):
        for name, hair_parts in FROZEN_HAIR_PARTS.items():
            with self.subTest(recipe=name):
                parts = human_recipe_request(name)['parts']
                marked = [part for part in parts if 'unresolved' in part]
                self.assertEqual([(part['package'], part['object']) for part in marked], hair_parts)
                for part in marked:
                    self.assertEqual(part['materials'], [])
                    self.assertEqual(set(part['unresolved']), {'materials'})
                    marker = part['unresolved']['materials']
                    self.assertEqual(set(marker), {'reason', 'previousValue'})
                    self.assertEqual(marker['reason'], HAIR_LAYOUT_UNDECODED_REASON)
                    validate_gap_row(gap_row_with_reason(marker['reason']), self.reason_patterns)
                    self.assertEqual(len(marker['previousValue']), 1)
                    self.assertTrue(is_hair_override(marker['previousValue'][0]))
                    self.assertNotIn('sourceBinding', part)

    def test_no_human_recipe_part_binds_the_hair_texture_group_any_more(self):
        for name in FROZEN_HAIR_PARTS:
            with self.subTest(recipe=name):
                for part in human_recipe_request(name)['parts']:
                    self.assertFalse(any(is_hair_override(material) for material in part.get('materials', [])), part['object'])

    def test_every_non_hair_part_keeps_its_package_object_and_materials(self):
        for name, frozen_parts in FROZEN_NON_HAIR_PARTS.items():
            with self.subTest(recipe=name):
                parts = human_recipe_request(name)['parts']
                self.assertEqual(len(parts), len(frozen_parts) + len(FROZEN_HAIR_PARTS[name]))
                kept = [(part['package'], part['object'], part['materials']) for part in parts if 'unresolved' not in part]
                self.assertEqual(kept, frozen_parts)

    def test_limitations_drop_the_appearance_choice_and_state_the_hair_is_unresolved(self):
        for name in FROZEN_HAIR_PARTS:
            with self.subTest(recipe=name):
                limitations = ' '.join(human_recipe_request(name)['limitations'])
                self.assertNotIn(STALE_LIMITATION_WORDS, limitations)
                for words in UNRESOLVED_LIMITATION_WORDS:
                    self.assertIn(words, limitations)

    def test_pipeline_twins_point_only_at_the_marked_recipes_and_hold_no_materials(self):
        for name, recipe_path in PIPELINE_TWIN_RECIPES.items():
            with self.subTest(twin=name):
                twin = read_json(ROOT / 'recipes' / f'native-pipeline-{name}.json')
                self.assertEqual([job['recipe'] for job in twin['jobs']], [recipe_path])
                self.assertNotIn('materials', json.dumps(twin))
                marked_parts = [part for part in read_json(ROOT / recipe_path)[0]['parts'] if 'unresolved' in part]
                self.assertEqual(len(marked_parts), 2)


class FemaleFighterCollisionMarkerTests(unittest.TestCase):
    def female_fighter_profile(self):
        profiles = [profile for profile in read_json(FEMALE_FIGHTER_STAGE_PATH)['profiles'] if profile['id'] == FEMALE_FIGHTER_PROFILE_ID]
        self.assertEqual(len(profiles), 1)
        return profiles[0]

    def test_collision_dimensions_are_null_with_recorded_reasons_and_the_old_numbers_kept_for_audit(self):
        profile = self.female_fighter_profile()
        self.assertIsNone(profile['collisionRadius'])
        self.assertIsNone(profile['collisionHeight'])
        self.assertEqual(profile['unresolved'], FEMALE_FIGHTER_UNRESOLVED_COLLISION)
        reason_patterns = load_gap_reason_patterns()
        for marker in profile['unresolved'].values():
            validate_gap_row(gap_row_with_reason(marker['reason']), reason_patterns)

    def test_source_evidence_no_longer_claims_exact_dimensions(self):
        class_evidence = self.female_fighter_profile()['sourceEvidence']['class']
        self.assertNotIn('exact collision dimensions', class_evidence)
        self.assertIn('actor-default-unresolved', class_evidence)


if __name__ == '__main__':
    unittest.main()
