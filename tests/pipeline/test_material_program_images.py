from __future__ import annotations

import hashlib
import os
from pathlib import Path
import struct
import sys
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.material_program import MAXIMUM_TEXTURE_IMAGE_BYTES, MaterialProgramError, derive_material_program
from native_store.canonical_json import canonical_json_bytes
from test_material_graph import MAIN_FIXTURE, SYNTHETIC_CLASS_DEFAULTS, graph_of

TEXTURED_PROGRAM_FIXTURE_PATH = ROOT / 'tests' / 'fixtures' / 'material-programs' / 'textured-program.json'
TEXTURED_PROGRAM_FIXTURE_UPDATE_VARIABLE = 'MATERIAL_PROGRAM_FIXTURE_UPDATE'
TEXTURED_PROGRAM_ROOT_NAME = 'SkyPanner'
TEXTURE_NODE = 'SyntheticMaterials.SkyTexture'
PANNER_NODE = 'SyntheticMaterials.SkyPanner'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
SYNTHETIC_PNG_SIDE = 2
SYNTHETIC_PNG_RGBA = bytes((40, 80, 120, 255))
STORED_DEFLATE_LEVEL = 0


def png_chunk(chunk_type, data):
    return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data))


def synthetic_png_bytes():
    header = struct.pack('>IIBBBBB', SYNTHETIC_PNG_SIDE, SYNTHETIC_PNG_SIDE, 8, 6, 0, 0, 0)
    rows = b''.join(b'\x00' + SYNTHETIC_PNG_RGBA * SYNTHETIC_PNG_SIDE for _ in range(SYNTHETIC_PNG_SIDE))
    return (PNG_SIGNATURE + png_chunk(b'IHDR', header) + png_chunk(b'IDAT', zlib.compress(rows, STORED_DEFLATE_LEVEL))
            + png_chunk(b'IEND', b''))


def synthetic_texture_image():
    png = synthetic_png_bytes()
    sha256 = hashlib.sha256(png).hexdigest()
    return {'path': f'/l2/native-material-textures/{sha256}/texture.png', 'sha256': sha256, 'bytes': len(png)}


def textured_graph():
    _, graph = graph_of(MAIN_FIXTURE, TEXTURED_PROGRAM_ROOT_NAME)
    return graph


def textured_program(texture_images):
    return derive_material_program(textured_graph(), SYNTHETIC_CLASS_DEFAULTS, texture_images=texture_images)


def image_members_by_node(program):
    return {node['id']: node.get('image', 'no image member') for node in program['nodes']}


class TextureImagePinTests(unittest.TestCase):
    def test_a_pinned_texture_node_carries_its_image_and_no_other_node_does(self):
        image = synthetic_texture_image()
        program = textured_program({TEXTURE_NODE: image})
        self.assertEqual(image_members_by_node(program), {PANNER_NODE: 'no image member', TEXTURE_NODE: image})
        self.assertEqual(program['gapReasons'], [])

    def test_an_unpinned_texture_node_keeps_a_null_image(self):
        self.assertEqual(image_members_by_node(textured_program({})), {PANNER_NODE: 'no image member', TEXTURE_NODE: None})
        self.assertEqual(image_members_by_node(derive_material_program(textured_graph(), SYNTHETIC_CLASS_DEFAULTS)),
                         {PANNER_NODE: 'no image member', TEXTURE_NODE: None})

    def test_the_synthetic_png_is_a_two_by_two_rgba_image(self):
        png = synthetic_png_bytes()
        self.assertEqual(png[:8], PNG_SIGNATURE)
        self.assertEqual(struct.unpack('>II', png[16:24]), (SYNTHETIC_PNG_SIDE, SYNTHETIC_PNG_SIDE))

    def test_the_written_program_equals_the_committed_fixture(self):
        program_bytes = canonical_json_bytes(textured_program({TEXTURE_NODE: synthetic_texture_image()}))
        if os.environ.get(TEXTURED_PROGRAM_FIXTURE_UPDATE_VARIABLE) == '1':
            TEXTURED_PROGRAM_FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
            TEXTURED_PROGRAM_FIXTURE_PATH.write_bytes(program_bytes)
        self.assertEqual(TEXTURED_PROGRAM_FIXTURE_PATH.read_bytes(), program_bytes)


class TextureImagePinRefusalTests(unittest.TestCase):
    def assert_pin_refused(self, texture_images, message):
        with self.assertRaisesRegex(MaterialProgramError, message):
            textured_program(texture_images)

    def test_a_pin_for_a_node_that_is_not_a_texture_is_refused(self):
        self.assert_pin_refused({PANNER_NODE: synthetic_texture_image()}, 'Engine.TexPanner, not Engine.Texture')
        self.assert_pin_refused({'SyntheticMaterials.Missing': synthetic_texture_image()}, 'no node SyntheticMaterials.Missing')

    def test_a_path_outside_the_native_store_is_refused(self):
        for path in ('/public/texture.png', 'l2/texture.png', '/l2/../texture.png', '/l2/', '/l2/a b.png', '/l2/.hidden/texture.png'):
            with self.subTest(path=path):
                self.assert_pin_refused({TEXTURE_NODE: {**synthetic_texture_image(), 'path': path}}, 'not a native resource path')

    def test_a_malformed_sha256_is_refused(self):
        for sha256 in ('A' * 64, 'a' * 63, 'g' * 64, None):
            with self.subTest(sha256=sha256):
                self.assert_pin_refused({TEXTURE_NODE: {**synthetic_texture_image(), 'sha256': sha256}}, 'not a SHA-256')

    def test_a_size_outside_the_library_limit_is_refused(self):
        for size in (0, -1, MAXIMUM_TEXTURE_IMAGE_BYTES + 1, True, 1.5):
            with self.subTest(size=size):
                self.assert_pin_refused({TEXTURE_NODE: {**synthetic_texture_image(), 'bytes': size}}, 'positive size up to')
        at_limit = {**synthetic_texture_image(), 'bytes': MAXIMUM_TEXTURE_IMAGE_BYTES}
        self.assertEqual(image_members_by_node(textured_program({TEXTURE_NODE: at_limit}))[TEXTURE_NODE], at_limit)

    def test_a_pin_with_other_members_is_refused(self):
        self.assert_pin_refused({TEXTURE_NODE: {**synthetic_texture_image(), 'mime': 'image/png'}}, 'holds exactly bytes, path, sha256')
        self.assert_pin_refused({TEXTURE_NODE: 'texture.png'}, 'holds exactly bytes, path, sha256')


if __name__ == '__main__':
    unittest.main()
