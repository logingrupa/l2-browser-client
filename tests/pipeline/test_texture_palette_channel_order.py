from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.texture_mips import build_texture_source
from test_texture_mips import fixture

PALETTE_COLOR_COUNT = 256
FIRST_ENTRY_WIRE_BYTES = bytes.fromhex('12345678')
OTHER_ENTRY_WIRE_BYTES = bytes.fromhex('9abcdef0')


class PaletteChannelOrderTests(unittest.TestCase):
    def test_a_non_grayscale_palette_keeps_the_wire_red_green_blue_alpha_order(self):
        wire_colors = FIRST_ENTRY_WIRE_BYTES + OTHER_ENTRY_WIRE_BYTES * (PALETTE_COLOR_COUNT - 1)
        package, item, _, _ = fixture(fmt=0, palette=True, palette_colors=wire_colors)
        metadata, files = build_texture_source(package, item)
        self.assertEqual(files['native/palette.rgba'], wire_colors)
        self.assertEqual(metadata['palette']['channelOrder'], 'RGBA8')
        red, green, blue, alpha = files['native/palette.rgba'][:4]
        self.assertEqual((red, green, blue, alpha), (0x12, 0x34, 0x56, 0x78))
        self.assertEqual(metadata['palette']['entry0Alpha'], 0x78)


if __name__ == '__main__':
    unittest.main()
