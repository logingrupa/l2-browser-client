import hashlib
import io
from pathlib import Path
import random
import struct
import sys
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from PIL import Image

from native_assets_lib.png_rgba_codec import (IMAGE_DATA_CHUNK, IMAGE_END_CHUNK, IMAGE_HEADER_CHUNK, PNG_SIGNATURE, paeth_predictor, png_chunk,
                                             png_chunks, png_has_alpha_channel, rgba_png_of_rgb_png_and_alpha)
from native_assets_lib.texture_block_alpha import bc1_block_alpha, bc2_block_alpha, bc3_block_alpha, native_mip0_alpha
from native_assets_lib.texture_mips import build_texture_source
from native_assets_lib.texture_png_alpha import native_alpha_limitations, texture_png_keeping_native_alpha, texture_source_or_unsupported
from native_assets_lib.texture_source_reader import REA_TEXTURE_NATIVE_DECODE
from native_catalog.ue2 import FormatError
from test_texture_mips import fixture

REFERENCE_CLIENT = Path('E:/Lineage2-client')
REA_TEXTURE_NATIVE_DECODE_PATH = Path(REA_TEXTURE_NATIVE_DECODE['root']) / REA_TEXTURE_NATIVE_DECODE['file']
BLOCK_TEXELS = 16


def rgb_png(width, height, rgb):
    buffer = io.BytesIO()
    Image.frombytes('RGB', (width, height), rgb).save(buffer, format='PNG')
    return buffer.getvalue()


def rgba_png(width, height, rgba):
    buffer = io.BytesIO()
    Image.frombytes('RGBA', (width, height), rgba).save(buffer, format='PNG')
    return buffer.getvalue()


def decoded_rgba(png):
    image = Image.open(io.BytesIO(png))
    image.load()
    return image.mode, image.size, image.tobytes()


def filtered_row(filter_type, row, previous, bytes_per_pixel):
    output = bytearray()
    for index, value in enumerate(row):
        left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        above = previous[index]
        upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        prediction = [0, left, above, (left + above) // 2, paeth_predictor(left, above, upper_left)][filter_type]
        output.append((value - prediction) & 0xFF)
    return bytes([filter_type]) + bytes(output)


def rgb_png_with_every_row_filter(width, rgb_rows):
    previous, filtered = bytes(width * 3), b''
    for row_index, row in enumerate(rgb_rows):
        filtered += filtered_row(row_index % 5, row, previous, 3)
        previous = row
    header = struct.pack('>IIBBBBB', width, len(rgb_rows), 8, 2, 0, 0, 0)
    return (PNG_SIGNATURE + png_chunk(IMAGE_HEADER_CHUNK, header) + png_chunk(IMAGE_DATA_CHUNK, zlib.compress(filtered))
            + png_chunk(IMAGE_END_CHUNK, b''))


def bc3_block(alpha0, alpha1, codes):
    indices = sum(code << (3 * texel) for texel, code in enumerate(codes))
    return bytes([alpha0, alpha1]) + indices.to_bytes(6, 'little') + bytes(8)


def bgra_payload(texels):
    return b''.join(bytes([blue, green, red, alpha]) for red, green, blue, alpha in texels)


class BlockAlphaTests(unittest.TestCase):
    def test_bc1_three_color_mode_makes_index_three_transparent(self):
        for color0, color1 in ((0x0000, 0xFFFF), (0x1234, 0x1234)):
            block = struct.pack('<HHI', color0, color1, 0b11)
            self.assertEqual(bc1_block_alpha(block), [0] + [255] * (BLOCK_TEXELS - 1))

    def test_bc1_four_color_mode_is_opaque_at_every_index(self):
        block = struct.pack('<HHI', 0xFFFF, 0x0000, 0xFFFFFFFF)
        self.assertEqual(bc1_block_alpha(block), [255] * BLOCK_TEXELS)

    def test_bc2_expands_each_four_bit_alpha_by_bit_replication(self):
        block = bytes([0xF0, 0x08, 0, 0, 0, 0, 0, 0x3C]) + bytes(8)
        self.assertEqual(bc2_block_alpha(block), [0, 255, 136, 0] + [0] * 10 + [0xC * 17, 0x3 * 17])

    def test_bc3_six_value_mode_adds_zero_and_full_alpha(self):
        self.assertEqual(bc3_block_alpha(bc3_block(0, 255, list(range(8)) * 2)), [0, 255, 51, 102, 153, 204, 0, 255] * 2)

    def test_bc3_eight_value_mode_interpolates_between_its_endpoints(self):
        self.assertEqual(bc3_block_alpha(bc3_block(255, 0, list(range(8)) * 2)), [255, 0, 218, 182, 145, 109, 72, 36] * 2)


class NativeMipZeroAlphaTests(unittest.TestCase):
    def test_rgba8_reads_the_fourth_byte_of_each_blue_green_red_alpha_texel(self):
        texels = [(0x12, 0x34, 0x56, 0x00), (0xFF, 0x00, 0x80, 0x40), (0x01, 0x02, 0x03, 0xFF), (0xAA, 0xBB, 0xCC, 0x7F)]
        package, item, _, _ = fixture(fmt=5, dimensions=(2, 2), levels=[(2, 2, bgra_payload(texels)), (1, 1, bgra_payload(texels[:1]))])
        metadata, files = build_texture_source(package, item)
        self.assertEqual((metadata['format']['name'], [mip['sourceBytes'] for mip in metadata['mips']]), ('RGBA8', [16, 4]))
        self.assertEqual(metadata['layout']['evidence']['rgba8']['pixelOrder']['order'], ['B', 'G', 'R', 'A'])
        self.assertEqual(native_mip0_alpha(metadata, files), bytes([0x00, 0x40, 0xFF, 0x7F]))

    def test_dxt3_mips_are_sixteen_byte_blocks_down_to_one_by_one(self):
        alpha_block = bytes([0xF0, 0x08, 0, 0, 0, 0, 0, 0]) + bytes(8)
        package, item, _, _ = fixture(fmt=7, dimensions=(8, 4), levels=[(8, 4, alpha_block * 2), (4, 2, alpha_block), (2, 1, alpha_block),
                                                                        (1, 1, alpha_block)])
        metadata, files = build_texture_source(package, item)
        self.assertEqual((metadata['format']['name'], [mip['sourceBytes'] for mip in metadata['mips']]), ('DXT3', [32, 16, 16, 16]))
        self.assertEqual(metadata['layout']['evidence']['dxt3']['formatEnum']['name'], 'TEXF_DXT3')
        self.assertEqual(native_mip0_alpha(metadata, files)[:8], bytes([0, 255, 136, 0, 0, 255, 136, 0]))

    def test_dxt3_rejects_a_dxt1_sized_payload(self):
        package, item, _, _ = fixture(fmt=7, dimensions=(4, 4), levels=[(4, 4, bytes(8))])
        with self.assertRaisesRegex(FormatError, 'byte count differs from texture format'):
            build_texture_source(package, item)

    def test_p8_has_no_reviewed_alpha_rule(self):
        package, item, _, _ = fixture(fmt=0, palette=True)
        self.assertIsNone(native_mip0_alpha(*build_texture_source(package, item)))


class PngRgbaCodecTests(unittest.TestCase):
    def test_every_png_row_filter_decodes_before_alpha_is_added(self):
        generator = random.Random(5)
        width, height = 7, 10
        rows = [bytes(generator.randrange(256) for _ in range(width * 3)) for _ in range(height)]
        alpha = bytes(generator.randrange(256) for _ in range(width * height))
        rgb = b''.join(rows)
        expected = b''.join(rgb[texel * 3:texel * 3 + 3] + bytes([alpha[texel]]) for texel in range(width * height))
        png = rgba_png_of_rgb_png_and_alpha(png_chunks(rgb_png_with_every_row_filter(width, rows)), width, height, alpha)
        self.assertTrue(png_has_alpha_channel(png_chunks(png)))
        self.assertEqual(decoded_rgba(png), ('RGBA', (width, height), expected))

    def test_a_png_of_other_dimensions_than_mip_zero_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'native mip 0 is 4 x 4'):
            rgba_png_of_rgb_png_and_alpha(png_chunks(rgb_png(2, 2, bytes(12))), 4, 4, bytes(16))

    def test_a_png_without_alpha_that_is_not_eight_bit_rgb_is_refused(self):
        buffer = io.BytesIO()
        Image.new('L', (4, 4)).save(buffer, format='PNG')
        with self.assertRaisesRegex(FormatError, 'must be 8-bit non-interlaced RGB'):
            rgba_png_of_rgb_png_and_alpha(png_chunks(buffer.getvalue()), 4, 4, bytes(16))

    def test_a_corrupted_chunk_is_refused(self):
        png = bytearray(rgb_png(2, 2, bytes(12)))
        png[-5] ^= 1
        with self.assertRaisesRegex(FormatError, 'CRC differs'):
            png_chunks(bytes(png))


class TexturePngKeepingNativeAlphaTests(unittest.TestCase):
    def rgba8_texture(self, alpha_values, version=(123, 28)):
        texels = [(0x10 * index, 0x20, 0x30, alpha) for index, alpha in enumerate(alpha_values)]
        return texture_source_or_unsupported(*fixture(fmt=5, version=version, dimensions=(2, 2), levels=[(2, 2, bgra_payload(texels))])[:2])

    def test_an_rgb_png_of_a_zero_alpha_source_becomes_rgba_with_the_native_alpha(self):
        png, native_alpha = texture_png_keeping_native_alpha(rgb_png(2, 2, bytes(range(12))), self.rgba8_texture([0, 0, 0, 0]))
        self.assertEqual(decoded_rgba(png), ('RGBA', (2, 2), b''.join(bytes(range(index * 3, index * 3 + 3)) + bytes(1) for index in range(4))))
        self.assertEqual(native_alpha, {'status': 'restored'})
        self.assertEqual(len(native_alpha_limitations(native_alpha)), 1)

    def test_an_rgb_png_of_an_opaque_source_is_kept_byte_for_byte(self):
        png = rgb_png(2, 2, bytes(range(12)))
        kept, native_alpha = texture_png_keeping_native_alpha(png, self.rgba8_texture([255, 255, 255, 255]))
        self.assertIs(kept, png)
        self.assertEqual((native_alpha, native_alpha_limitations(native_alpha)), ({'status': 'native-opaque'}, []))

    def test_a_png_that_already_carries_alpha_is_kept_byte_for_byte(self):
        png = rgba_png(2, 2, bytes(16))
        kept, native_alpha = texture_png_keeping_native_alpha(png, self.rgba8_texture([0, 64, 128, 255]))
        self.assertIs(kept, png)
        self.assertEqual((native_alpha, native_alpha_limitations(native_alpha)), ({'status': 'exporter-alpha'}, []))

    def test_an_rgb_png_of_an_unreviewed_layout_keeps_the_exporter_png_and_lists_the_unverified_alpha(self):
        for version in ((123, 12), (123, 31)):
            png = rgb_png(2, 2, bytes(12))
            with self.subTest(version=version):
                kept, native_alpha = texture_png_keeping_native_alpha(png, self.rgba8_texture([0, 0, 0, 0], version))
                self.assertIs(kept, png)
                self.assertEqual(native_alpha, {'status': 'unverified',
                                                'gapReason': f'texture-alpha-unverified:texture-licensee-unsupported:{version[0]}/{version[1]}'})
                self.assertIn(native_alpha['gapReason'], native_alpha_limitations(native_alpha)[0])

    def test_an_rgb_png_of_a_p8_source_lists_the_unverified_alpha(self):
        png = rgb_png(2, 2, bytes(12))
        kept, native_alpha = texture_png_keeping_native_alpha(png, texture_source_or_unsupported(*fixture(fmt=0, palette=True)[:2]))
        self.assertIs(kept, png)
        self.assertEqual(native_alpha, {'status': 'unverified', 'gapReason': 'texture-alpha-unverified:P8'})


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class ReferenceClientTexturePngAlphaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from world.map_sources import MapSources
        package = MapSources(REFERENCE_CLIENT.resolve()).get('textures/FX_E_T.utx')
        cls.package, cls.exports = package, {item['object']: item for item in package.exports}

    def test_theme_transparency_wall_t00_gives_a_32_by_32_rgba_png_with_alpha_zero(self):
        item = self.exports['FX_E_T.theme_park_effect.theme_transparency_wall_t00']
        metadata, files = build_texture_source(self.package, item)
        self.assertEqual((metadata['format']['name'], metadata['mips'][0]['width'], metadata['mips'][0]['height']), ('RGBA8', 32, 32))
        self.assertEqual(files[metadata['mips'][0]['file']], bytes.fromhex('ffffff00') * 1024)
        png, native_alpha = texture_png_keeping_native_alpha(rgb_png(32, 32, bytes.fromhex('ff') * 32 * 32 * 3), (metadata, files))
        self.assertEqual((decoded_rgba(png), native_alpha), (('RGBA', (32, 32), bytes.fromhex('ffffff00') * 1024), {'status': 'restored'}))

    def test_o_fx_fire06_dxt5_alpha_is_zero_at_every_texel(self):
        item = self.exports['FX_E_T.particles_etc.o_fx_fire06']
        metadata, files = build_texture_source(self.package, item)
        self.assertEqual((metadata['format']['name'], metadata['mips'][0]['width'], metadata['mips'][0]['height']), ('DXT5', 128, 64))
        self.assertEqual(native_mip0_alpha(metadata, files), bytes(128 * 64))

    def test_the_dxt3_and_rgba8_mips_equal_the_rea_decode(self):
        expected = {'FX_E_T.WaterSurfaceSet.Water02': ('DXT3', [(256, 256, 65536), (128, 128, 16384), (64, 64, 4096), (32, 32, 1024), (16, 16, 256),
                                                              (8, 8, 64), (4, 4, 16), (2, 2, 16), (1, 1, 16)]),
                    'FX_E_T.Flameset_a.FX_E_fire_ani3_001': ('RGBA8', [(256, 128, 131072), (128, 64, 32768), (64, 32, 8192), (32, 16, 2048),
                                                                      (16, 8, 512), (8, 4, 128), (4, 2, 32), (2, 1, 8), (1, 1, 4)])}
        for name, (format_name, mips) in expected.items():
            metadata, _ = build_texture_source(self.package, self.exports[name])
            with self.subTest(name=name):
                self.assertEqual((metadata['format']['name'], [(mip['width'], mip['height'], mip['sourceBytes']) for mip in metadata['mips']]),
                                 (format_name, mips))


@unittest.skipUnless(REA_TEXTURE_NATIVE_DECODE_PATH.is_file(), 'the REA independent decode is absent on this host')
class ReaTextureNativeDecodePinTests(unittest.TestCase):
    def test_the_named_root_and_file_hold_the_pinned_rea_decode(self):
        self.assertEqual(hashlib.sha256(REA_TEXTURE_NATIVE_DECODE_PATH.read_bytes()).hexdigest(), REA_TEXTURE_NATIVE_DECODE['sha256'])


if __name__ == '__main__':
    unittest.main()
