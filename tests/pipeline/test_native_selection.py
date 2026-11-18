from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from native_assets import Converter


class NativeSelectionTests(unittest.TestCase):
    def setUp(self):
        self.texture = {'object': 'Engine.DefaultTexture', 'name': 'DefaultTexture', 'className': 'Texture'}
        self.prop = {'object': 'Engine.LevelInfo.DefaultTexture', 'name': 'DefaultTexture', 'className': 'ObjectProperty'}
        self.package = SimpleNamespace(package_name='Engine', exports=[self.texture, self.prop])
        self.converter = Converter.__new__(Converter)

    def test_exact_identity_wins_but_bare_leaf_remains_ambiguous(self):
        self.assertEqual(self.converter.select(self.package, 'Engine.DefaultTexture'), self.texture)
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous'):
            self.converter.select(self.package, 'DefaultTexture')

    def test_texture_sharing_its_leaf_name_with_a_grouped_texture_is_selected_by_its_full_path(self):
        grouped_texture = {**self.texture, 'object': 'Engine.Group.DefaultTexture'}
        self.package.exports.append(grouped_texture)
        self.assertEqual(self.converter.select(self.package, 'Engine.DefaultTexture', 'Texture'), self.texture)
        self.assertEqual(self.converter.select(self.package, 'Engine.Group.DefaultTexture', 'Texture'), grouped_texture)

    def test_static_mesh_sharing_its_leaf_name_stays_refused_because_the_umodel_dump_names_no_group(self):
        static_mesh = {'object': 'Rock_S.Boulder', 'name': 'Boulder', 'className': 'StaticMesh'}
        self.package.package_name = 'Rock_S'
        self.package.exports = [static_mesh, {**static_mesh, 'object': 'Rock_S.Group.Boulder'}]
        with self.assertRaisesRegex(ValueError, 'duplicate leaf'):
            self.converter.select(self.package, 'Rock_S.Boulder', 'StaticMesh')

    def test_group_omitting_dat_binding_still_resolves_uniquely(self):
        self.package.exports = [{**self.texture, 'object': 'Engine.Group.DefaultTexture'}]
        self.assertEqual(self.converter.select(self.package, 'Engine.DefaultTexture'), self.package.exports[0])


class ExportedPayloadPathTests(unittest.TestCase):
    def setUp(self):
        self.converter = Converter.__new__(Converter)
        self.directory = tempfile.TemporaryDirectory()
        self.work = Path(self.directory.name)
        self.root_payload = self.work / 'export' / 'oren_hed_t2' / 'hed_danwall01.png'
        self.grouped_payload = self.work / 'export' / 'oren_hed_t2' / 'Enter' / 'hed_danwall01.png'
        for payload in (self.root_payload, self.grouped_payload):
            payload.parent.mkdir(parents=True, exist_ok=True)
            payload.write_bytes(payload.as_posix().encode())

    def tearDown(self):
        self.directory.cleanup()

    def texture_item(self, object_path):
        return {'object': object_path, 'name': 'hed_danwall01', 'className': 'Texture'}

    def test_each_full_object_path_picks_the_payload_in_its_own_group_folder(self):
        self.assertEqual(self.converter.exported(self.work, self.texture_item('oren_hed_t2.hed_danwall01'), ('.png',)), self.root_payload)
        self.assertEqual(self.converter.exported(self.work, self.texture_item('oren_hed_t2.Enter.hed_danwall01'), ('.png',)), self.grouped_payload)

    def test_a_payload_missing_from_the_group_folder_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'Expected exactly one exported payload for oren_hed_t2.Other.hed_danwall01'):
            self.converter.exported(self.work, self.texture_item('oren_hed_t2.Other.hed_danwall01'), ('.png',))


if __name__ == '__main__':
    unittest.main()
