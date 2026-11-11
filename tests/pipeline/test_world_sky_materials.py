from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.texture_package_118 import PACKAGE_118_LICENSEE, PACKAGE_118_VERSION, UnrealPackage118, read_unreal_package
from native_catalog.ue2 import FormatError, Package
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from ue2_package_fixture import compact, package_bytes, tag
from world.sky_materials import SkyTextureUnsupported, native_texture_source

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


if __name__ == '__main__':
    unittest.main()
