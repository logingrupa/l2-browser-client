import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from world.shared_sky_visibility_rules import read_shared_sky_visibility_rules
from world.sky_material_sorting import (SKY_EYE_ZONE_DIFFERS_REASON_PREFIX, SkyMaterialSortingMismatch, observed_material_route,
                                        program_requires_sorting, require_sorting_matches_observed_route, sky_eye_zone_gap)

STAGED_PROGRAMS_FOLDER = ROOT / 'tests' / 'fixtures' / 'environment' / 'skylevel-visibility'

RULES = read_shared_sky_visibility_rules()['document']['requiresSortingRules']
FORWARDING, SHADER, TEXTURE = RULES['forwarding'], RULES['shader'], RULES['texture']
ROOT_ID = 'Sky.Shaders.Root_Final'
INNER_ID = 'Sky.Shaders.Inner'
TEXTURE_ID = 'Sky.Textures.Chip'
UNSORTED_OUTPUT_BLENDING = next(value for value in range(8) if value not in SHADER['sortingOutputBlending'] and value != SHADER['opacityOutputBlending'])


def program_field(name, declaring_class, value, provenance='authored'):
    return {'field': name, 'declaringClass': declaring_class, 'provenance': provenance, 'value': value}


def modifier_root(material_value, provenance='authored'):
    return {'id': ROOT_ID, 'class': 'Engine.ColorModifier', 'fields': [program_field(FORWARDING['field'], FORWARDING['class'], material_value, provenance)]}


def shader_node(output_blending, opacity, output_provenance='authored'):
    blending_value = None if output_blending is None else {'name': f'OB_{output_blending}', 'ordinal': output_blending}
    return {'id': INNER_ID, 'class': SHADER['class'], 'fields': [
        program_field(SHADER['outputBlendingField'], SHADER['class'], blending_value, 'ue-zero' if output_blending is None else output_provenance),
        program_field(SHADER['opacityField'], SHADER['class'], None if opacity is None else {'node': opacity}, 'ue-zero' if opacity is None else 'authored')]}


def texture_node(flag_value, provenance='authored'):
    return {'id': TEXTURE_ID, 'class': TEXTURE['class'], 'fields': [program_field(TEXTURE['flagField'], TEXTURE['class'], flag_value, provenance)]}


def program_of(*nodes):
    return {'root': ROOT_ID, 'nodes': list(nodes)}


class VerifiedRequiresSortingRuleTests(unittest.TestCase):
    def test_the_recipe_rules_are_the_verified_rm24_class_rules(self):
        self.assertEqual((FORWARDING['class'], FORWARDING['field'], FORWARDING['address']), ('Engine.Modifier', 'Material', '0x10349520'))
        self.assertEqual((SHADER['class'], SHADER['address'], SHADER['outputBlendingField'], SHADER['opacityField']),
                         ('Engine.Shader', '0x105de510', 'OutputBlending', 'Opacity'))
        self.assertEqual((SHADER['sortingOutputBlending'], SHADER['opacityOutputBlending']), ([2, 3, 5, 6], 0))
        self.assertEqual((TEXTURE['class'], TEXTURE['address'], TEXTURE['flagField']), ('Engine.Texture', '0x10336040', 'bAlphaTexture'))

    def test_a_modifier_forwards_to_a_shader_that_sorts_through_opacity_or_its_output_blending(self):
        inner = {'node': INNER_ID}
        self.assertTrue(program_requires_sorting(program_of(modifier_root(inner), shader_node(None, TEXTURE_ID), texture_node(None, 'ue-zero'))))
        for output_blending in SHADER['sortingOutputBlending']:
            with self.subTest(output_blending=output_blending):
                self.assertTrue(program_requires_sorting(program_of(modifier_root(inner), shader_node(output_blending, None))))
        self.assertFalse(program_requires_sorting(program_of(modifier_root(inner), shader_node(None, None))))
        self.assertFalse(program_requires_sorting(program_of(modifier_root(inner), shader_node(UNSORTED_OUTPUT_BLENDING, TEXTURE_ID), texture_node(None, 'ue-zero'))))

    def test_a_modifier_over_a_texture_sorts_only_with_its_alpha_flag_and_a_null_material_does_not_sort(self):
        texture = {'node': TEXTURE_ID}
        self.assertFalse(program_requires_sorting(program_of(modifier_root(texture), texture_node(None, 'ue-zero'))))
        self.assertTrue(program_requires_sorting(program_of(modifier_root(texture), texture_node(True))))
        self.assertFalse(program_requires_sorting(program_of(modifier_root(None, 'ue-zero'))))

    def test_an_unresolved_field_or_a_class_without_a_verified_rule_stays_unresolved(self):
        self.assertIsNone(program_requires_sorting(program_of(modifier_root(None, 'unresolved'))))
        self.assertIsNone(program_requires_sorting(program_of(modifier_root({'node': INNER_ID}), shader_node(3, None, 'unresolved'))))
        final_blend = {'id': INNER_ID, 'class': 'Engine.FinalBlend', 'fields': []}
        self.assertIsNone(program_requires_sorting(program_of(modifier_root({'node': INNER_ID}), final_blend)))

    def test_a_derived_flag_that_disagrees_with_the_rm24_route_of_its_material_is_refused(self):
        require_sorting_matches_observed_route('L2_Skies.Shaders.StarField_Final01', True)
        require_sorting_matches_observed_route('L2_Skies.Shaders.Cloud_Final01_sh', False)
        with self.assertRaisesRegex(SkyMaterialSortingMismatch, 'SkybackgroundColor'):
            require_sorting_matches_observed_route('l2_skies.Shaders.SkybackgroundColor', True)


class StagedSkyProgramSortingTests(unittest.TestCase):
    def test_every_staged_skylevel_program_derives_the_route_the_rm24_frame_drew_it_with(self):
        listing = json.loads((STAGED_PROGRAMS_FOLDER / 'material-programs.json').read_bytes())['materials']
        derived = {row['root']: program_requires_sorting(json.loads((STAGED_PROGRAMS_FOLDER / 'material-programs' / row['program']).read_bytes()))
                   for row in listing}
        self.assertEqual(len(derived), 7)
        for root, requires_sorting in derived.items():
            with self.subTest(root=root):
                require_sorting_matches_observed_route(root, requires_sorting)
                self.assertEqual(requires_sorting, observed_material_route(root) if observed_material_route(root) is not None else True)
        self.assertIs(derived['l2_skies.Shaders.Cloud_Final01_sh'], True)
        self.assertIs(derived['l2_skies.Shaders.SkybackgroundColor'], False)


class SkyEyeZoneTests(unittest.TestCase):
    def test_the_sky_eye_zone_is_point_region_and_another_zone_than_the_sky_zone_is_a_named_gap(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64), zones=(2, 1))], zones=(synthetic_zone(), synthetic_zone(), synthetic_zone()))
        self.assertIsNone(sky_eye_zone_gap(model, [10.0, 10.0, 5.0], 1))
        self.assertEqual(sky_eye_zone_gap(model, [10.0, 10.0, -5.0], 1), f'{SKY_EYE_ZONE_DIFFERS_REASON_PREFIX}2')


if __name__ == '__main__':
    unittest.main()
