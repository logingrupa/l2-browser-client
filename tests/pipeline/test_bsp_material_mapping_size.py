from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from material_graph_fixture import build_synthetic_material_package
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from support.mapping_size_class_defaults import SYNTHETIC_DEFAULT_MATERIAL, synthetic_class_default_values, use_synthetic_mapping_class_defaults
from world.bsp_material_mapping_size import (MAPPING_SIZE_ZERO_REASON, MaterialMappingSize, default_material_identity, mapping_size_outcome,
                                             reference_client_class_default_value)
from world.bsp_surface_materials import surface_material_identities

CLASS_RULE_FIXTURE = 'mapping-size-classes.json'
WATER_FIXTURE = 'db3-water-shader.json'
DEFAULT_TEXTURE_FIXTURE = 'synthetic-default-texture.json'


def synthetic_map_sources(*packages):
    paths = {package.package_name.casefold(): [f'textures/{package.filename}'] for package in packages}
    by_path = {f'textures/{package.filename}': package for package in packages}
    return SimpleNamespace(paths=paths, get=by_path.__getitem__, dependencies={})


class MappingSizeRuleTests(unittest.TestCase):
    def setUp(self):
        use_synthetic_mapping_class_defaults(self)
        self.map_sources = synthetic_map_sources(build_synthetic_material_package(CLASS_RULE_FIXTURE))

    def outcome(self, name):
        return mapping_size_outcome(f'SyntheticMapping.{name}', self.map_sources, reference_client_class_default_value(None, None))

    def test_a_bitmap_shifts_usize_and_vsize_left_by_loss_detail_masked_to_five_bits_as_a_signed_32_bit_value(self):
        self.assertEqual(self.outcome('WideTexture'), (MaterialMappingSize(128, 64), []))
        self.assertEqual(self.outcome('TallTexture'), (MaterialMappingSize(16, 128), []))
        self.assertEqual(self.outcome('MaskedShiftTexture'), (MaterialMappingSize(16, 8), []))
        self.assertEqual(self.outcome('OverflowTexture'), (MaterialMappingSize(-2147483648, 2), []))

    def test_a_shift_that_wraps_to_zero_and_an_unset_vsize_are_zero_mapping_size_gaps(self):
        self.assertEqual(self.outcome('WrapTexture'), (None, [MAPPING_SIZE_ZERO_REASON]))
        self.assertEqual(self.outcome('SizelessTexture'), (None, [MAPPING_SIZE_ZERO_REASON]))

    def test_a_combiner_takes_the_signed_maximum_of_material1_and_material2_per_axis_and_ignores_the_mask(self):
        self.assertEqual(self.outcome('PairCombiner'), (MaterialMappingSize(128, 128), []))
        self.assertEqual(self.outcome('NegativeCombiner'), (None, [MAPPING_SIZE_ZERO_REASON]))

    def test_a_shader_follows_a_non_null_diffuse_even_when_it_resolves_to_zero_else_self_illumination(self):
        self.assertEqual(self.outcome('DiffuseShader'), (MaterialMappingSize(16, 128), []))
        self.assertEqual(self.outcome('SelfIlluminatedShader'), (MaterialMappingSize(128, 64), []))
        self.assertEqual(self.outcome('ZeroDiffuseShader'), (None, [MAPPING_SIZE_ZERO_REASON]))
        self.assertEqual(self.outcome('EmptyShader'), (None, [MAPPING_SIZE_ZERO_REASON]))

    def test_a_bump_shader_follows_diffuse_and_every_modifier_follows_material(self):
        self.assertEqual(self.outcome('BumpedShader'), (MaterialMappingSize(128, 64), []))
        self.assertEqual(self.outcome('ShadedBlend'), (MaterialMappingSize(16, 128), []))
        self.assertEqual(self.outcome('TintedWide'), (MaterialMappingSize(128, 64), []))
        self.assertEqual(self.outcome('EmptyPanner'), (None, [MAPPING_SIZE_ZERO_REASON]))

    def test_constant_and_fade_colours_are_zero_mapping_size_gaps(self):
        for name in ('SolidColor', 'FadingColor'):
            self.assertEqual(self.outcome(name), (None, [MAPPING_SIZE_ZERO_REASON]))

    def test_a_class_without_a_rule_and_a_reference_cycle_stay_visible_gaps(self):
        self.assertEqual(self.outcome('UnruledPalette'), (None, ['material-mapping-size-class-unported:Engine.Palette']))
        self.assertEqual(self.outcome('CyclePanner'),
                         (None, ['decode-failed:FormatError:material mapping size reference cycle through SyntheticMapping.CyclePanner']))

    def test_an_unresolvable_material_is_a_decode_failure(self):
        self.assertEqual(mapping_size_outcome('Missing.Material', self.map_sources, reference_client_class_default_value(None, None)),
                         (None, ['decode-failed:FormatError:material package missing or ambiguous']))


class Db3WaterFixtureTests(unittest.TestCase):
    def test_water_shader01_and_reflection_map_at_256_by_256(self):
        use_synthetic_mapping_class_defaults(self)
        map_sources = synthetic_map_sources(build_synthetic_material_package(WATER_FIXTURE))
        class_default_value = reference_client_class_default_value(None, None)
        sizes = {name: mapping_size_outcome(f'FX_E_T.{name}', map_sources, class_default_value)
                 for name in ('ocean011', 'TexOscillator0', 'ocn_rot', 'ocean-s', 'ocn_s', 'base1', 'com', 'reflection', 'WaterShader01')}
        self.assertEqual({name: outcome[0] for name, outcome in sizes.items()},
                         {**{name: MaterialMappingSize(256, 256) for name in sizes}, 'base1': MaterialMappingSize(8, 8)})


class NullSurfaceMaterialTests(unittest.TestCase):
    def setUp(self):
        use_synthetic_mapping_class_defaults(self)

    def test_a_null_surface_material_takes_the_material_class_default_and_maps_at_its_size(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10), material=0), synthetic_polygon(square_points(20, 0, 10))])
        package = SimpleNamespace(object_name={0: None, 1: 'SyntheticMapping.WideTexture'}.get)
        identities = surface_material_identities(package, model, None, None)
        self.assertEqual(identities, [SYNTHETIC_DEFAULT_MATERIAL, 'SyntheticMapping.WideTexture'])
        map_sources = synthetic_map_sources(build_synthetic_material_package(DEFAULT_TEXTURE_FIXTURE))
        self.assertEqual(mapping_size_outcome(identities[0], map_sources, reference_client_class_default_value(None, None)),
                         (MaterialMappingSize(64, 32), []))

    def test_surfaces_with_materials_read_no_class_default(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10))])
        package = SimpleNamespace(object_name={1: 'SyntheticMapping.WideTexture'}.get)
        self.assertEqual(surface_material_identities(package, model, None, None), ['SyntheticMapping.WideTexture'])

    def test_a_material_class_default_that_names_no_material_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'Engine.Material.DefaultMaterial names no material'):
            default_material_identity(lambda class_object, field: None)
        self.assertEqual(default_material_identity(lambda class_object, field: synthetic_class_default_values(class_object, [field], None, None)[0].value),
                         SYNTHETIC_DEFAULT_MATERIAL)


if __name__ == '__main__':
    unittest.main()
