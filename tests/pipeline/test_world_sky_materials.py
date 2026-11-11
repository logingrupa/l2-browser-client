from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import Package
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


class TableLayoutTextureRefusalTests(unittest.TestCase):
    def refusal_reason(self, licensee, format_id):
        package = Package(texture_package_bytes(123, licensee, properties_only_texture_body(format_id)), SKY_PACKAGE_FILENAME)
        with self.assertRaises(SkyTextureUnsupported) as caught:
            native_texture_source(package, package.exports[0])
        return caught.exception.reason

    def test_an_unreviewed_texture_package_licensee_is_a_licensee_gap_not_a_format_gap(self):
        reason = self.refusal_reason(23, DXT1_FORMAT)
        self.assertEqual(reason, 'texture-licensee-unsupported:123/23')
        self.assertTrue(is_listed_reason(reason, load_gap_reason_patterns(ROOT)))

    def test_an_unreviewed_format_in_a_reviewed_package_is_a_format_gap(self):
        self.assertEqual(self.refusal_reason(28, UNREVIEWED_FORMAT), f'sky-texture-format-unsupported:{UNREVIEWED_FORMAT}')


if __name__ == '__main__':
    unittest.main()
