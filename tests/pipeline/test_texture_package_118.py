from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.texture_mips import build_texture_source
from native_assets_lib.texture_package_118 import PACKAGE_118_LAYOUT_EVIDENCE, UnrealPackage118, read_texture_source_118, read_unreal_package
from native_catalog.ue2 import FormatError, Package
from ue2_package_fixture import compact, package_bytes, tag
from world.sky_materials import read_sky_material_package, sky_layout_texture_source

PACKAGE_FILENAME = 'Synthetic_T.utx'
PACKAGE_VERSION_OFFSET = 4
TEXTURE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Texture')]
TEXTURE_CLASS_REFERENCE = -2
TEXTURE_PROPERTY_NAMES = ['Format', 'USize', 'VSize']
BYTE_PROPERTY_KIND = 1
INTEGER_PROPERTY_KIND = 2
DXT1_FORMAT = 3
RESERVED_INT32_PREFIX = struct.pack('<i', -741)
THREE_DXT1_MIPS = ((4, 4, (2, 2)), (2, 2, (1, 1)), (1, 1, (0, 0)))


def dxt1_block(level):
    return bytes((level * 37 + index) % 256 for index in range(8))


def texture_body(mips, material_prefix=b'', lazy_array_end_shift=0):
    def body(offset, names):
        width, height = mips[0][0], mips[0][1]
        record = (tag(names, 'Format', BYTE_PROPERTY_KIND, bytes([DXT1_FORMAT])) + tag(names, 'USize', INTEGER_PROPERTY_KIND, struct.pack('<i', width))
                  + tag(names, 'VSize', INTEGER_PROPERTY_KIND, struct.pack('<i', height)) + compact(names['None']) + material_prefix + compact(len(mips)))
        for level, (mip_width, mip_height, bits) in enumerate(mips):
            payload, size = dxt1_block(level), compact(8)
            payload_end = offset + len(record) + 4 + len(size) + len(payload)
            record += struct.pack('<i', payload_end + lazy_array_end_shift) + size + payload + struct.pack('<ii', mip_width, mip_height) + bytes(bits)
        return record
    return body


def synthetic_package_bytes(package_version, licensee, body):
    data = bytearray(package_bytes(TEXTURE_PROPERTY_NAMES, TEXTURE_IMPORTS, [{'name': 'Glow', 'class': TEXTURE_CLASS_REFERENCE, 'body': body}]))
    struct.pack_into('<HH', data, PACKAGE_VERSION_OFFSET, package_version, licensee)
    return bytes(data)


def package_118_bytes(mips=THREE_DXT1_MIPS, lazy_array_end_shift=0):
    return synthetic_package_bytes(118, 0, texture_body(mips, lazy_array_end_shift=lazy_array_end_shift))


def mip_record_projection(mips):
    return [(mip['level'], mip['width'], mip['height'], mip['sourceOffset'], mip['sourceBytes'], mip['sha256']) for mip in mips]


class UnrealPackage118Tests(unittest.TestCase):
    def test_a_118_package_reads_its_tables_and_qualified_texture_name(self):
        package = read_unreal_package(package_118_bytes(), PACKAGE_FILENAME)
        self.assertIsInstance(package, UnrealPackage118)
        self.assertEqual(package.exports[0]['object'], 'Synthetic_T.Glow')
        self.assertEqual(package.exports[0]['classObject'], 'Engine.Texture')

    def test_a_123_package_keeps_the_table_package_reader(self):
        package = read_unreal_package(synthetic_package_bytes(123, 28, texture_body(THREE_DXT1_MIPS, RESERVED_INT32_PREFIX)), PACKAGE_FILENAME)
        self.assertIs(type(package), Package)

    def test_a_118_layout_with_another_licensee_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'layout 118/11 is not the reviewed package layout 118/0'):
            UnrealPackage118(synthetic_package_bytes(118, 11, texture_body(THREE_DXT1_MIPS)), PACKAGE_FILENAME)

    def test_an_export_past_the_package_end_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'export 1 lies outside the package'):
            UnrealPackage118(package_118_bytes()[:-1], PACKAGE_FILENAME)

    def test_oversized_package_tables_are_refused(self):
        data = bytearray(package_118_bytes())
        struct.pack_into('<I', data, 12, 1_000_001)
        with self.assertRaisesRegex(FormatError, 'package tables are oversized'):
            UnrealPackage118(bytes(data), PACKAGE_FILENAME)


class TextureSource118Tests(unittest.TestCase):
    def test_three_dxt1_mips_decode_to_the_mip_records_of_the_sky_reader(self):
        data = package_118_bytes()
        package = read_unreal_package(data, PACKAGE_FILENAME)
        metadata, files = read_texture_source_118(package, package.exports[0])
        sky_package = read_sky_material_package(data, PACKAGE_FILENAME)
        sky_metadata, sky_files = sky_layout_texture_source(sky_package, sky_package.exports[0])
        self.assertEqual(mip_record_projection(metadata['mips']), mip_record_projection(sky_metadata['mips']))
        self.assertEqual([files[mip['file']] for mip in metadata['mips']], [sky_files[mip['file']] for mip in sky_metadata['mips']])
        self.assertEqual(files['native/texture-export.bin'], sky_files['native/texture-export.bin'])
        self.assertEqual((metadata['format']['name'], metadata['mipCount'], metadata['completeTo1x1']), ('DXT1', 3, True))

    def test_a_mip_whose_lazy_array_end_differs_from_its_payload_is_refused(self):
        package = read_unreal_package(package_118_bytes(lazy_array_end_shift=1), PACKAGE_FILENAME)
        with self.assertRaisesRegex(FormatError, 'lazy-array end differs from payload range'):
            read_texture_source_118(package, package.exports[0])

    def test_mip_bits_that_disagree_with_the_mip_size_are_refused(self):
        package = read_unreal_package(package_118_bytes(mips=((4, 4, (2, 1)), (2, 2, (1, 1)), (1, 1, (0, 0)))), PACKAGE_FILENAME)
        with self.assertRaisesRegex(FormatError, 'dimensions disagree with bits'):
            read_texture_source_118(package, package.exports[0])

    def test_a_table_layout_package_is_not_read_as_118(self):
        package = read_unreal_package(synthetic_package_bytes(123, 28, texture_body(THREE_DXT1_MIPS, RESERVED_INT32_PREFIX)), PACKAGE_FILENAME)
        with self.assertRaisesRegex(FormatError, 'is not read by the reviewed 118/0 package reader'):
            read_texture_source_118(package, package.exports[0])


class BuildTextureSourceDispatchTests(unittest.TestCase):
    def test_a_118_package_reads_through_the_118_reader_without_a_material_prefix(self):
        package = read_unreal_package(package_118_bytes(), PACKAGE_FILENAME)
        metadata, _ = build_texture_source(package, package.exports[0])
        self.assertEqual((metadata['layout']['packageVersion'], metadata['layout']['licenseeVersion']), (118, 0))
        self.assertEqual(metadata['layout']['evidence'], PACKAGE_118_LAYOUT_EVIDENCE)
        self.assertNotIn('reservedInt32', metadata['nativePrefix'])
        self.assertEqual(metadata, read_texture_source_118(package, package.exports[0])[0])

    def test_a_123_package_reads_its_reserved_material_int32_before_the_same_mips(self):
        package_118 = read_unreal_package(package_118_bytes(), PACKAGE_FILENAME)
        package_123 = read_unreal_package(synthetic_package_bytes(123, 28, texture_body(THREE_DXT1_MIPS, RESERVED_INT32_PREFIX)), PACKAGE_FILENAME)
        metadata_118, files_118 = build_texture_source(package_118, package_118.exports[0])
        metadata_123, files_123 = build_texture_source(package_123, package_123.exports[0])
        self.assertEqual((metadata_123['layout']['packageVersion'], metadata_123['layout']['licenseeVersion']), (123, 28))
        self.assertEqual(metadata_123['nativePrefix']['reservedInt32'], -741)
        self.assertEqual([mip['sha256'] for mip in metadata_123['mips']], [mip['sha256'] for mip in metadata_118['mips']])
        self.assertEqual([files_123[mip['file']] for mip in metadata_123['mips']], [files_118[mip['file']] for mip in metadata_118['mips']])


if __name__ == '__main__':
    unittest.main()
