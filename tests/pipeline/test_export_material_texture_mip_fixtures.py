import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_material_texture_mip_fixtures import FIXTURE_TEXTURE_OBJECTS, SKY_TEXTURE_PACKAGE, texture_export_named

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'material-textures' / 'native-mip-chains.json'
REFERENCE_CLIENT_TREE_LOCK = ROOT / 'recipes' / 'reference-client-tree.lock.json'


def locked_package_sha256(relative_path):
    lock = json.loads(REFERENCE_CLIENT_TREE_LOCK.read_bytes())
    return lock['files'][relative_path][lock['fileFields'].index('eSha256')]


class CommittedNativeMipChainFixturesTests(unittest.TestCase):
    def test_the_committed_file_was_read_from_the_lock_equal_sky_package(self):
        document = json.loads(FIXTURES_FILE.read_bytes())
        self.assertEqual(document['source']['package'], SKY_TEXTURE_PACKAGE)
        self.assertEqual(document['source']['packageSha256'], locked_package_sha256(SKY_TEXTURE_PACKAGE))
        self.assertEqual([texture['object'] for texture in document['textures']], list(FIXTURE_TEXTURE_OBJECTS))

    def test_a_texture_the_package_does_not_hold_once_is_refused(self):
        package = SimpleNamespace(exports=[{'className': 'Texture', 'object': 'l2_skies.Textures.WhiteChip'}])
        with self.assertRaisesRegex(DayNightFixtureError, 'holds 0 Texture exports'):
            texture_export_named(package, 'l2_skies.FlareSet.Sun01')


if __name__ == '__main__':
    unittest.main()
