import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_assets_lib.material_program import MaterialProgramError, derive_material_program
from native_assets_lib.material_texture_mip_chain import native_mip_chain_of_texture_source
from native_assets_lib.texture_source_reader import UnsupportedTextureSource
from native_store.store_paths import lane_store_root
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import TEXTURE_NODE, synthetic_png_bytes, textured_graph
from world import material_texture_images, surface_material_programs
from world.material_texture_images import MaterialTexturePng, material_texture_image_pins, write_material_texture_images
from world.surface_material_programs import material_texture_pngs

NATIVE_MIP_CHAIN_FIXTURES_PATH = ROOT / 'tests' / 'fixtures' / 'material-textures' / 'native-mip-chains.json'
STAGED_WHITE_CHIP_MIP0_SHA256 = '1eee1acaf47c'


def native_mip_chain_fixtures():
    return {texture['object']: texture for texture in json.loads(NATIVE_MIP_CHAIN_FIXTURES_PATH.read_bytes())['textures']}


def fixture_level_payload(level):
    return base64.b64decode(level['base64'])


def texture_source_of_fixture(texture):
    mips = [{'level': level['level'], 'width': level['width'], 'height': level['height'], 'file': f'native/mip{level["level"]:02d}.bin'}
            for level in texture['mips']]
    files = {mip['file']: fixture_level_payload(level) for mip, level in zip(mips, texture['mips'])}
    return {'format': {'name': texture['format']}, 'mips': mips}, files


def fixture_texture_png(texture_object):
    return MaterialTexturePng(synthetic_png_bytes(), native_mip_chain_of_texture_source(texture_source_of_fixture(native_mip_chain_fixtures()[texture_object])))


def expected_level_pin(level):
    return {'width': level['width'], 'height': level['height'], 'bytes': level['bytes'], 'sha256': level['sha256'],
            'path': f'/l2/native-materials/texture-mips/{level["sha256"]}/level.bin'}


class NativeMipChainFixtureTests(unittest.TestCase):
    def test_the_fixture_levels_hash_to_their_recorded_sha256(self):
        for texture in native_mip_chain_fixtures().values():
            for level in texture['mips']:
                self.assertEqual(hashlib.sha256(fixture_level_payload(level)).hexdigest(), level['sha256'])
                self.assertEqual(len(fixture_level_payload(level)), level['bytes'])

    def test_the_white_chip_level_equals_the_staged_sky_bundle_mip0(self):
        self.assertTrue(native_mip_chain_fixtures()['l2_skies.Textures.WhiteChip']['mips'][0]['sha256'].startswith(STAGED_WHITE_CHIP_MIP0_SHA256))


class MaterialTextureMipChainPinTests(unittest.TestCase):
    maxDiff = None

    def test_a_dxt3_texture_pins_every_original_level_in_source_order(self):
        texture = native_mip_chain_fixtures()['l2_skies.FlareSet.Sun01']
        pin = material_texture_image_pins({TEXTURE_NODE: fixture_texture_png('l2_skies.FlareSet.Sun01')})[TEXTURE_NODE]
        self.assertEqual(pin['mips'], {'format': 'DXT3', 'levels': [expected_level_pin(level) for level in texture['mips']]})

    def test_a_single_level_dxt1_texture_pins_its_one_original_level(self):
        texture = native_mip_chain_fixtures()['l2_skies.Textures.WhiteChip']
        pin = material_texture_image_pins({TEXTURE_NODE: fixture_texture_png('l2_skies.Textures.WhiteChip')})[TEXTURE_NODE]
        self.assertEqual(pin['mips'], {'format': 'DXT1', 'levels': [expected_level_pin(texture['mips'][0])]})

    def test_an_rgba8_texture_pins_its_native_uncompressed_levels(self):
        pin = material_texture_image_pins({TEXTURE_NODE: fixture_texture_png('l2_skies.Textures.mongebg')})[TEXTURE_NODE]
        self.assertEqual(pin['mips']['format'], 'RGBA8')
        self.assertEqual([(level['width'], level['height'], level['bytes']) for level in pin['mips']['levels']],
                         [(64, 64, 16384), (32, 32, 4096), (16, 16, 1024), (8, 8, 256), (4, 4, 64), (2, 2, 16), (1, 1, 4)])

    def test_a_p8_or_unsupported_source_stays_a_single_png_without_a_chain(self):
        p8_source = ({'format': {'name': 'P8'}, 'mips': [{'width': 2, 'height': 2, 'file': 'native/mip00.bin'}]}, {'native/mip00.bin': b'\x00' * 4})
        for source in (p8_source, UnsupportedTextureSource('texture-format-unsupported:9', 'unreviewed format')):
            pin = material_texture_image_pins({TEXTURE_NODE: MaterialTexturePng(synthetic_png_bytes(), native_mip_chain_of_texture_source(source))})
            self.assertEqual(sorted(pin[TEXTURE_NODE]), ['bytes', 'path', 'sha256'])

    def test_the_written_records_hold_the_png_and_every_level_byte_for_byte(self):
        store_root = lane_store_root(scratch_work_root(self, 'material-texture-mips-'), 'world')
        texture = native_mip_chain_fixtures()['l2_skies.FlareSet.Flare01']
        records = write_material_texture_images(store_root, {TEXTURE_NODE: fixture_texture_png('l2_skies.FlareSet.Flare01')})
        level_paths = {f'native-materials/texture-mips/{level["sha256"]}/level.bin' for level in texture['mips']}
        self.assertTrue(level_paths <= {record['path'] for record in records})
        for level in texture['mips']:
            stored = (store_root / f'native-materials/texture-mips/{level["sha256"]}/level.bin').read_bytes()
            self.assertEqual(stored, fixture_level_payload(level))


class LibraryMaterialTexturePngTests(unittest.TestCase):
    def test_a_library_texture_carries_the_original_levels_of_its_own_export(self):
        material_texture_images.stored_texture_images_by_store_root.clear()
        self.addCleanup(material_texture_images.stored_texture_images_by_store_root.clear)
        texture = native_mip_chain_fixtures()['l2_skies.FlareSet.Sun01']
        graph = {'nodes': [{'object': texture['object'], 'classObject': 'Engine.Texture', 'status': 'reviewed', 'exportIndex': 2}]}
        package = SimpleNamespace(exports=[{'object': 'l2_skies.FlareSet.Flare01'}, {'object': texture['object']}])
        converter = SimpleNamespace(output=scratch_work_root(self, 'library-texture-converter-'),
                                    texture=lambda work, reference: (synthetic_png_bytes(), {}, reference))
        store_root = scratch_work_root(self, 'library-texture-store-') / 'l2'
        sources_by_export = {texture['object']: texture_source_of_fixture(texture)}
        with patch.object(surface_material_programs, 'texture_source_or_unsupported', side_effect=lambda _, item: sources_by_export[item['object']]):
            pngs_by_node, gap_reasons = material_texture_pngs(package, graph, converter, store_root)
        chain = pngs_by_node[texture['object']].native_mip_chain
        self.assertEqual(gap_reasons, [])
        self.assertEqual(chain.format_name, 'DXT3')
        self.assertEqual([level.payload for level in chain.levels], [fixture_level_payload(level) for level in texture['mips']])


class MaterialProgramMipChainCheckTests(unittest.TestCase):
    def program_with_pin(self, pin):
        return derive_material_program(textured_graph(), SYNTHETIC_CLASS_DEFAULTS, texture_images={TEXTURE_NODE: pin})

    def sun_pin(self):
        return material_texture_image_pins({TEXTURE_NODE: fixture_texture_png('l2_skies.FlareSet.Sun01')})[TEXTURE_NODE]

    def test_the_program_keeps_a_valid_mip_chain_pin(self):
        pin = self.sun_pin()
        image = next(node['image'] for node in self.program_with_pin(pin)['nodes'] if node['id'] == TEXTURE_NODE)
        self.assertEqual(image, pin)

    def assert_refused(self, pin, message_part):
        with self.assertRaisesRegex(MaterialProgramError, message_part):
            self.program_with_pin(pin)

    def test_a_level_whose_bytes_differ_from_its_format_is_refused(self):
        pin = self.sun_pin()
        pin['mips']['levels'][1]['bytes'] = 4097
        self.assert_refused(pin, 'bytes')

    def test_a_level_that_does_not_halve_the_previous_one_is_refused(self):
        pin = self.sun_pin()
        pin['mips']['levels'][1], pin['mips']['levels'][2] = pin['mips']['levels'][2], pin['mips']['levels'][1]
        self.assert_refused(pin, 'halve')

    def test_an_unpublished_format_is_refused(self):
        pin = self.sun_pin()
        pin['mips']['format'] = 'P8'
        self.assert_refused(pin, 'format')

    def test_a_level_path_that_is_not_its_sha256_store_path_is_refused(self):
        pin = self.sun_pin()
        pin['mips']['levels'][0]['path'] = pin['path']
        self.assert_refused(pin, 'path')

    def test_an_extra_level_member_is_refused(self):
        pin = copy.deepcopy(self.sun_pin())
        pin['mips']['levels'][0]['format'] = 'DXT3'
        self.assert_refused(pin, 'members')

    def test_an_empty_chain_is_refused(self):
        pin = self.sun_pin()
        pin['mips']['levels'] = []
        self.assert_refused(pin, 'levels')


if __name__ == '__main__':
    unittest.main()
