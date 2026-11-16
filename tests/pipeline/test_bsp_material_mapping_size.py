from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from material_graph_fixture import build_synthetic_material_package
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from support.mapping_size_class_defaults import SYNTHETIC_DEFAULT_MATERIAL, synthetic_class_default_values, use_synthetic_mapping_class_defaults
from support.synthetic_map_sources import SyntheticMapSources
from world import bsp_material_mapping_size
from world.bsp_material_mapping_size import (MAPPING_SIZE_ZERO_REASON, MaterialMappingSize, default_material_identity, mapping_size_outcome,
                                             reference_client_class_default_value, surface_material_identities)

CLASS_RULE_FIXTURE = 'mapping-size-classes.json'
WATER_CHAIN_FIXTURE = 'synthetic-water-chain.json'
DEFAULT_TEXTURE_FIXTURE = 'synthetic-default-texture.json'
REFERENCE_CLIENT = Path('E:/Lineage2-client')
REFERENCE_WATER_SHADER_SET = 'FX_E_T.WaterSurfaceShaderSet'
REFERENCE_WATER_TEXTURE_SET = 'FX_E_T.WaterSurfaceSet'


class MappingSizeRuleTests(unittest.TestCase):
    def setUp(self):
        use_synthetic_mapping_class_defaults(self)
        self.map_sources = SyntheticMapSources(build_synthetic_material_package(CLASS_RULE_FIXTURE))

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

    def test_an_authored_none_reference_is_a_null_child(self):
        self.assertEqual(self.outcome('NullDiffuseShader'), (MaterialMappingSize(128, 64), []))
        self.assertEqual(self.outcome('NullMaterialCombiner'), (MaterialMappingSize(16, 128), []))
        for name in ('NullMaterialPanner', 'NullDiffuseBumpShader'):
            self.assertEqual(self.outcome(name), (None, [MAPPING_SIZE_ZERO_REASON]))

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


class SyntheticWaterChainTests(unittest.TestCase):
    def test_a_shader_over_nested_combiners_takes_the_largest_texture_of_the_chain(self):
        use_synthetic_mapping_class_defaults(self)
        map_sources = SyntheticMapSources(build_synthetic_material_package(WATER_CHAIN_FIXTURE))
        class_default_value = reference_client_class_default_value(None, None)
        sizes = {name: mapping_size_outcome(f'SyntheticWater.{name}', map_sources, class_default_value)
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
        map_sources = SyntheticMapSources(build_synthetic_material_package(DEFAULT_TEXTURE_FIXTURE))
        self.assertEqual(mapping_size_outcome(identities[0], map_sources, reference_client_class_default_value(None, None)),
                         (MaterialMappingSize(64, 32), []))

    def test_surfaces_with_materials_read_no_class_default(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10))])
        package = SimpleNamespace(object_name={1: 'SyntheticMapping.WideTexture'}.get)
        with patch.object(bsp_material_mapping_size, 'kept_class_default_values', side_effect=AssertionError('read a class default')) as kept:
            self.assertEqual(surface_material_identities(package, model, None, None), ['SyntheticMapping.WideTexture'])
        self.assertEqual(kept.call_count, 0)

    def test_a_material_class_default_that_names_no_material_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'Engine.Material.DefaultMaterial names no material'):
            default_material_identity(lambda class_object, field: None)
        self.assertEqual(default_material_identity(lambda class_object, field: synthetic_class_default_values(class_object, [field], None, None)[0].value),
                         SYNTHETIC_DEFAULT_MATERIAL)


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class ReferenceClientMappingSizeTests(unittest.TestCase):
    def test_the_locked_fx_e_t_water_chain_and_engine_default_texture_decode_to_their_db3_sizes(self):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from native_store.store_paths import REPOSITORY_ROOT, lane_work_root
        from world.map_sources import MapSources
        client = REFERENCE_CLIENT.resolve()
        map_sources = MapSources(client)
        class_default_value = reference_client_class_default_value(lane_work_root(REPOSITORY_ROOT, 'world'), ReferenceClientClassScripts(client))
        identities = [f'{REFERENCE_WATER_SHADER_SET}.{name}' for name in ('WaterShader01', 'reflection', 'com', 'ocn_s', 'ocean-s', 'ocn_rot',
                                                                          'TexOscillator0')]
        identities += [f'{REFERENCE_WATER_TEXTURE_SET}.ocean011', f'{REFERENCE_WATER_TEXTURE_SET}.base1', 'Engine.DefaultTexture']
        sizes = {identity: mapping_size_outcome(identity, map_sources, class_default_value) for identity in identities}
        self.assertEqual(sizes, {**{identity: (MaterialMappingSize(256, 256), []) for identity in identities},
                                 f'{REFERENCE_WATER_TEXTURE_SET}.base1': (MaterialMappingSize(8, 8), []),
                                 'Engine.DefaultTexture': (MaterialMappingSize(16, 16), [])})
        self.assertEqual(sorted(map_sources.dependencies), ['system/Engine.u', 'textures/FX_E_T.utx'])


if __name__ == '__main__':
    unittest.main()
