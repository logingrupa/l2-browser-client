import hashlib
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_resources import write_material_program_record
from native_assets_lib.texture_package_118 import PACKAGE_118_LICENSEE, PACKAGE_118_VERSION, UnrealPackage118, read_unreal_package
from native_catalog.ue2 import FormatError, Package
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from ue2_package_fixture import compact, package_bytes, tag
from world import pinned_image_decoder, sky_materials, sky_step
from world.sky_materials import SkyTextureUnsupported, native_texture_source, sky_material_program, sky_texture_pngs_by_node, \
    sky_texture_products_by_node

SKY_PACKAGE_FILENAME = 'Sky_T.utx'
PACKAGE_VERSION_OFFSET = 4
TEXTURE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Texture')]
TEXTURE_CLASS_REFERENCE = -2
TEXTURE_PROPERTY_NAMES = ['Format', 'USize', 'VSize']
BYTE_PROPERTY_KIND = 1
INTEGER_PROPERTY_KIND = 2
DXT1_FORMAT = 3
UNREVIEWED_FORMAT = 5
DXT1_BLOCK = bytes(range(8))
COMPLETE_MIPS = ((2, 2, (1, 1)), (1, 1, (0, 0)))


def texture_properties(names, format_id, width, height):
    return (tag(names, 'Format', BYTE_PROPERTY_KIND, bytes([format_id])) + tag(names, 'USize', INTEGER_PROPERTY_KIND, struct.pack('<i', width))
            + tag(names, 'VSize', INTEGER_PROPERTY_KIND, struct.pack('<i', height)) + compact(names['None']))


def texture_package_bytes(package_version, licensee, texture_body):
    data = bytearray(package_bytes(TEXTURE_PROPERTY_NAMES, TEXTURE_IMPORTS,
                                   [{'name': 'Haze', 'class': TEXTURE_CLASS_REFERENCE, 'body': texture_body}]))
    struct.pack_into('<HH', data, PACKAGE_VERSION_OFFSET, package_version, licensee)
    return bytes(data)


def properties_only_texture_body(format_id):
    return lambda offset, names: texture_properties(names, format_id, 2, 2)


def texture_118_body(mips, format_id=DXT1_FORMAT, dimensions=(2, 2), lazy_array_end_shift=0, trailing=b''):
    def body(offset, names):
        record = texture_properties(names, format_id, *dimensions) + compact(len(mips))
        for width, height, bits in mips:
            payload, size = DXT1_BLOCK, compact(len(DXT1_BLOCK))
            payload_end = offset + len(record) + 4 + len(size) + len(payload)
            record += struct.pack('<i', payload_end + lazy_array_end_shift) + size + payload + struct.pack('<ii', width, height) + bytes(bits)
        return record + trailing
    return body


def package_118_bytes(**texture_options):
    return texture_package_bytes(PACKAGE_118_VERSION, PACKAGE_118_LICENSEE, texture_118_body(COMPLETE_MIPS, **texture_options))


def texture_118_source(data):
    package = read_unreal_package(data, SKY_PACKAGE_FILENAME)
    return native_texture_source(package, package.exports[0])


class TableLayoutTextureRefusalTests(unittest.TestCase):
    def refusal_reason(self, licensee, format_id):
        package = Package(texture_package_bytes(123, licensee, properties_only_texture_body(format_id)), SKY_PACKAGE_FILENAME)
        with self.assertRaises(SkyTextureUnsupported) as caught:
            native_texture_source(package, package.exports[0])
        return caught.exception.reason

    def test_an_unreviewed_texture_package_licensee_is_a_licensee_gap_not_a_format_gap(self):
        reason = self.refusal_reason(31, DXT1_FORMAT)
        self.assertEqual(reason, 'texture-licensee-unsupported:123/31')
        self.assertTrue(is_listed_reason(reason, load_gap_reason_patterns(ROOT)))

    def test_an_unreviewed_format_in_a_reviewed_package_is_a_format_gap(self):
        self.assertEqual(self.refusal_reason(28, UNREVIEWED_FORMAT), f'sky-texture-format-unsupported:{UNREVIEWED_FORMAT}')


class SkyTexture118Tests(unittest.TestCase):
    def test_a_complete_dxt1_record_keeps_every_mip_payload_and_its_metadata(self):
        data = package_118_bytes()
        package = read_unreal_package(data, SKY_PACKAGE_FILENAME)
        self.assertIsInstance(package, UnrealPackage118)
        self.assertEqual(package.exports[0]['object'], 'Sky_T.Haze')
        metadata, files = native_texture_source(package, package.exports[0])
        self.assertEqual(metadata['format'], {'id': DXT1_FORMAT, 'name': 'DXT1', 'propertyStatus': 'authored'})
        self.assertEqual((metadata['layout']['packageVersion'], metadata['layout']['licenseeVersion']), (PACKAGE_118_VERSION, PACKAGE_118_LICENSEE))
        self.assertEqual([(mip['width'], mip['height'], mip['sourceBytes']) for mip in metadata['mips']], [(2, 2, 8), (1, 1, 8)])
        self.assertTrue(metadata['completeTo1x1'])
        self.assertEqual((files['native/mip00.bin'], files['native/mip01.bin']), (DXT1_BLOCK, DXT1_BLOCK))
        export = package.exports[0]
        self.assertEqual(files['native/texture-export.bin'], data[export['offset']:export['offset'] + export['size']])

    def test_a_layout_other_than_118_0_is_refused(self):
        data = bytearray(package_118_bytes())
        struct.pack_into('<HH', data, PACKAGE_VERSION_OFFSET, PACKAGE_118_VERSION, 11)
        with self.assertRaisesRegex(FormatError, 'is not the reviewed package layout 118/0'):
            read_unreal_package(bytes(data), SKY_PACKAGE_FILENAME)

    def test_an_export_past_the_package_end_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'export 1 lies outside the package'):
            UnrealPackage118(package_118_bytes()[:-1], SKY_PACKAGE_FILENAME)

    def test_a_mip_whose_lazy_array_end_differs_from_its_payload_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'lazy-array end differs from payload range'):
            texture_118_source(package_118_bytes(lazy_array_end_shift=1))

    def test_mip_bits_that_disagree_with_the_mip_size_are_refused(self):
        data = texture_package_bytes(PACKAGE_118_VERSION, PACKAGE_118_LICENSEE, texture_118_body(((2, 2, (1, 0)),)))
        with self.assertRaisesRegex(FormatError, 'dimensions disagree with bits'):
            texture_118_source(data)

    def test_a_first_mip_that_disagrees_with_usize_and_vsize_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'mip0 dimensions differ from texture properties'):
            texture_118_source(package_118_bytes(dimensions=(4, 4)))

    def test_bytes_after_the_last_mip_are_refused(self):
        with self.assertRaisesRegex(FormatError, 'Unconsumed native texture bytes'):
            texture_118_source(package_118_bytes(trailing=b'\0'))

    def test_a_format_without_a_dds_block_wrapper_is_a_format_gap(self):
        with self.assertRaises(SkyTextureUnsupported) as caught:
            texture_118_source(package_118_bytes(format_id=UNREVIEWED_FORMAT))
        self.assertEqual(caught.exception.reason, f'sky-texture-format-unsupported:{UNREVIEWED_FORMAT}')


class SharedPinnedImageDecoderTests(unittest.TestCase):
    def test_sky_textures_decode_through_the_shared_pinned_image_decoder(self):
        self.assertIs(sky_materials.require_pinned_image_decoder, pinned_image_decoder.require_pinned_image_decoder)
        pinned_image_decoder.require_pinned_image_decoder()

    def test_another_pillow_version_is_refused(self):
        with patch.object(pinned_image_decoder.PIL, '__version__', '0.0.0'), self.assertRaisesRegex(FormatError, 'pinned Pillow 12.3.0, found 0.0.0'):
            pinned_image_decoder.require_pinned_image_decoder()

    def test_a_changed_png_plugin_is_refused(self):
        with patch.object(pinned_image_decoder, 'PNG_PLUGIN_SHA256', '0' * 64), self.assertRaisesRegex(FormatError, 'Pinned input changed'):
            pinned_image_decoder.require_pinned_image_decoder()


class SkyProgramTextureImageTests(unittest.TestCase):
    texture_declarations = {'Engine.Texture': [{'field': 'USize', 'declaredType': 'int', 'declaringClass': 'Engine.Texture', 'enumMembers': None,
                                                'classDefault': {'field': 'USize', 'value': None, 'provenance': 'ue-zero',
                                                                 'declaringClass': 'Engine.Texture'}}]}

    def texture_root_program(self, data):
        package = read_unreal_package(data, SKY_PACKAGE_FILENAME)
        graph = read_material_graph(package, package.exports[0])
        products, gap_reasons = sky_texture_products_by_node(package, graph)
        with patch.object(sky_materials, 'kept_material_class_defaults', return_value=self.texture_declarations):
            program = sky_material_program(graph, None, None, sky_texture_pngs_by_node(products))
        return program, products, gap_reasons

    def test_the_sky_program_pins_the_png_of_the_sky_texture_the_step_converts(self):
        program, products, gap_reasons = self.texture_root_program(package_118_bytes())
        receipt, files = products['Sky_T.Haze']
        png = files[receipt['png']['file']]
        png_sha256 = hashlib.sha256(png).hexdigest()
        self.assertEqual(gap_reasons, [])
        self.assertEqual([node['image'] for node in program['nodes']],
                         [{'path': f'/l2/native-materials/textures/{png_sha256}/texture.png', 'sha256': png_sha256, 'bytes': len(png)}])

    def test_a_sky_texture_the_library_refuses_keeps_a_null_image_and_its_gap_reason(self):
        program, products, gap_reasons = self.texture_root_program(package_118_bytes(format_id=UNREVIEWED_FORMAT))
        self.assertEqual((products, gap_reasons), ({}, [f'sky-texture-format-unsupported:{UNREVIEWED_FORMAT}']))
        self.assertEqual([node['image'] for node in program['nodes']], [None])

    def test_the_sky_step_writes_its_programs_through_the_one_program_record_writer(self):
        self.assertFalse(hasattr(sky_materials, 'write_sky_material_program'))
        self.assertIs(sky_step.write_material_program_record, write_material_program_record)


if __name__ == '__main__':
    unittest.main()
