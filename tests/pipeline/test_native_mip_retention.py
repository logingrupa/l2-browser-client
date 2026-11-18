import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.material_texture_mip_chain import (NATIVE_TEXTURE_RETENTION_SETTINGS, MaterialTextureMipChainError, NativeMipRetention,
                                                          native_default_lod, native_first_mip_of_lod, native_mip_retention, native_retained_mip_count,
                                                          native_size_capped_first_mip, postload_max_lod, texture_min_lod)

TEXTURE_SAMPLERS_FIXTURES_PATH = ROOT / 'tests' / 'fixtures' / 'rm25' / 'texture-samplers-native.json'
LIGHTMAP_FIRST_MIP_FUNCTION = 'FStaticLightMapTexture.GetFirstMip'
CLIENT_CATEGORY_BIAS_FUNCTION = 'DefaultLOD with client category bias'


def texture_sampler_fixtures():
    return json.loads(TEXTURE_SAMPLERS_FIXTURES_PATH.read_bytes())


def mip_fixtures_of(function):
    return [fixture for fixture in texture_sampler_fixtures()['fixtures']['mips'] if fixture['function'] == function]


def complete_mip_dimensions(width, height, count):
    return [(max(1, width >> level), max(1, height >> level)) for level in range(count)]


class NativeLodFixtureTests(unittest.TestCase):
    def test_postload_default_lod_and_first_mip_reproduce_every_ordinary_lod_fixture(self):
        ordinary = [fixture for fixture in texture_sampler_fixtures()['fixtures']['mips'] if 'width' in fixture['input']]
        self.assertEqual(len(ordinary), 12)
        for fixture in ordinary:
            given = fixture['input']
            max_lod = postload_max_lod(complete_mip_dimensions(given['width'], given['height'], given['mipCount']))
            lod = native_default_lod(given['GL2TextureDetail'], bool(given['GL2KeepMinFrameRate']), given['MinLOD'], max_lod)
            first_mip = native_first_mip_of_lod(given['width'], given['height'], lod, given['MinLOD'])
            self.assertEqual({'MaxLOD': max_lod, 'DefaultLOD': lod, 'firstMip': first_mip}, fixture['output'], given)

    def test_the_default_lod_discards_the_client_category_bias(self):
        [fixture] = mip_fixtures_of(CLIENT_CATEGORY_BIAS_FUNCTION)
        given = fixture['input']
        lod = native_default_lod(given['GL2TextureDetail'], False, given['MinLOD'], given['MaxLOD'])
        self.assertEqual(lod, fixture['output']['DefaultLOD'])
        self.assertNotEqual(lod, fixture['output']['GetTextureLODBiasReturn'])

    def test_a_lightmap_keeps_its_first_level_while_the_category_bias_is_not_positive(self):
        fixtures = mip_fixtures_of(LIGHTMAP_FIRST_MIP_FUNCTION)
        self.assertEqual(len(fixtures), 3)
        for fixture in fixtures:
            self.assertEqual(fixture['output']['firstMip'] == 0, fixture['input']['clientLODSet7Bias'] <= 0)


class NativeMipMappingFixtureTests(unittest.TestCase):
    def test_the_retained_count_and_size_cap_reproduce_every_mapping_fixture(self):
        mappings = texture_sampler_fixtures()['fixtures']['mipMappings']
        self.assertEqual(len(mappings), 6)
        for fixture in mappings:
            given = fixture['input']
            effective = native_retained_mip_count(given['storedMipCount'], given['width'], given['height'])
            first_mip = native_size_capped_first_mip(given['sourceFirstMip'], effective, given['width'], given['height'],
                                                     given['maxTextureWidth'], given['maxTextureHeight'])
            self.assertEqual((effective, first_mip, effective - first_mip), (fixture['effectiveMipCount'], fixture['firstMip'], fixture['d3dLevelCount']))

    def test_a_size_cap_past_the_retained_levels_is_refused(self):
        with self.assertRaisesRegex(MaterialTextureMipChainError, 'alternate'):
            native_size_capped_first_mip(0, 3, 1024, 1024, 64, 64)


class NativeMipRetentionTests(unittest.TestCase):
    def test_the_retention_settings_equal_the_rm25_option_ini_and_live_globals(self):
        configuration = texture_sampler_fixtures()['configuration']
        self.assertEqual(NATIVE_TEXTURE_RETENTION_SETTINGS['textureDetail'], int(configuration['optionIni']['TextureDetail']))
        self.assertEqual(NATIVE_TEXTURE_RETENTION_SETTINGS['textureDetail'], configuration['runtimeGlobals']['GL2TextureDetail'])
        self.assertEqual(NATIVE_TEXTURE_RETENTION_SETTINGS['keepMinFrameRate'], bool(configuration['runtimeGlobals']['GL2KeepMinFrameRate']))

    def test_every_live_texture_of_the_lock_equal_packages_keeps_the_live_level_count(self):
        textures = texture_sampler_fixtures()['liveTextures']
        self.assertEqual(len(textures), 6)
        for texture in textures:
            width, height = texture['storedMipDimensions'][0]
            retention = native_mip_retention(width, height, [tuple(dimensions) for dimensions in texture['storedMipDimensions']], texture['minLod'])
            self.assertEqual((retention.first_mip, retention.level_count), (texture['live']['firstSourceMip'], texture['live']['levelCount']), texture['texture'])

    def test_a_512_by_128_chain_stops_at_its_smaller_dimension(self):
        retention = native_mip_retention(512, 128, complete_mip_dimensions(512, 128, 10), 0)
        self.assertEqual(retention, NativeMipRetention(first_mip=0, retained_count=8))
        self.assertEqual(retention.level_count, 8)

    def test_a_min_lod_of_2_starts_a_64_texture_at_its_third_level_at_texture_detail_0(self):
        retention = native_mip_retention(64, 64, complete_mip_dimensions(64, 64, 7), 2)
        self.assertEqual((retention.first_mip, retention.level_count), (2, 5))

    def test_a_first_mip_past_the_retained_levels_is_refused(self):
        with self.assertRaisesRegex(MaterialTextureMipChainError, 'retains'):
            native_mip_retention(64, 64, complete_mip_dimensions(64, 64, 2), 3)


class TextureMinLodTests(unittest.TestCase):
    def test_an_omitted_min_lod_is_the_class_default_zero(self):
        self.assertEqual(texture_min_lod({'propertyTags': []}), 0)

    def test_an_authored_min_lod_is_read_from_its_int_property(self):
        tags = [{'name': 'MinLOD', 'type': 2, 'status': 'decoded', 'value': 2}]
        self.assertEqual(texture_min_lod({'propertyTags': tags}), 2)


if __name__ == '__main__':
    unittest.main()
