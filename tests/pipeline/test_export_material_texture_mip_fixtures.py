import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from reference_client_guard import ReferenceClientLockError
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_material_texture_mip_fixtures import FIXTURE_TEXTURES, native_mip_chain_fixtures_document, texture_export_named

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'material-textures' / 'native-mip-chains.json'
REFERENCE_CLIENT_TREE_LOCK = ROOT / 'recipes' / 'reference-client-tree.lock.json'


def locked_package_sha256(relative_path):
    lock = json.loads(REFERENCE_CLIENT_TREE_LOCK.read_bytes())
    return lock['files'][relative_path][lock['fileFields'].index('eSha256')]


class CommittedNativeMipChainFixturesTests(unittest.TestCase):
    def test_every_committed_texture_was_read_from_its_lock_equal_package(self):
        document = json.loads(FIXTURES_FILE.read_bytes())
        self.assertEqual([(texture['package'], texture['object']) for texture in document['textures']], list(FIXTURE_TEXTURES))
        for texture in document['textures']:
            self.assertEqual(texture['packageSha256'], locked_package_sha256(texture['package']))

    def test_the_committed_set_holds_the_rm25_wall_and_mesh_diffuse_textures(self):
        objects = {texture['object']: texture for texture in json.loads(FIXTURES_FILE.read_bytes())['textures']}
        self.assertEqual(len(objects['dion_curumadungeon_t.cm_dg_etc']['mips']), 7)
        self.assertEqual([objects['cruma_tr_t.Cm_o_wall008']['mips'][index][key] for index in (0, -1) for key in ('width', 'height')], [512, 256, 2, 1])

    def test_a_texture_the_package_does_not_hold_once_is_refused(self):
        package = SimpleNamespace(filename='l2_skies.utx', exports=[{'className': 'Texture', 'object': 'l2_skies.Textures.WhiteChip'}])
        with self.assertRaisesRegex(DayNightFixtureError, 'holds 0 Texture exports'):
            texture_export_named(package, 'l2_skies.FlareSet.Sun01')

    def test_a_client_root_without_the_lock_equal_engine_library_is_refused_before_a_package_is_read(self):
        with tempfile.TemporaryDirectory() as client_root:
            with self.assertRaisesRegex(ReferenceClientLockError, 'has no system/Engine.dll'):
                native_mip_chain_fixtures_document(client_root)


if __name__ == '__main__':
    unittest.main()
