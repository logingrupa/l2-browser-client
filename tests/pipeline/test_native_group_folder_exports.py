from pathlib import Path
import tempfile
import unittest

from native_assets import UMODEL, Converter
from native_assets_lib.png_rgba_codec import png_chunks, png_image_header

REFERENCE_CLIENT_COPY = Path('E:/Lineage2-client')


@unittest.skipUnless((REFERENCE_CLIENT_COPY / 'textures' / 'oren_hed_t2.utx').is_file() and UMODEL.is_file(),
                     'Read-only reference client copy on E: or the pinned UModel is unavailable')
class GroupFolderTextureExportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.converter = Converter(REFERENCE_CLIENT_COPY, self.root / 'artifacts' / 'output', UMODEL, project_root=self.root)

    def tearDown(self):
        self.directory.cleanup()

    def exported_texture(self, package_name, object_path):
        package_path, package = self.converter.package(package_name)
        item = self.converter.select(package, object_path, 'Texture')
        work = self.root / object_path
        work.mkdir()
        self.converter.run(work, package_path, item)
        return package, item, self.converter.exported(work, item, ('.png',)).relative_to(work).as_posix()

    def test_both_hed_danwall01_textures_resolve_to_their_own_group_folder_payloads(self):
        _, _, root_payload = self.exported_texture('oren_hed_t2', 'oren_hed_t2.hed_danwall01')
        _, _, grouped_payload = self.exported_texture('oren_hed_t2', 'oren_hed_t2.Enter.hed_danwall01')
        self.assertEqual(root_payload, 'export/oren_hed_t2/hed_danwall01.png')
        self.assertEqual(grouped_payload, 'export/oren_hed_t2/Enter/hed_danwall01.png')
        self.assertNotEqual((self.root / 'oren_hed_t2.hed_danwall01' / root_payload).read_bytes(),
                            (self.root / 'oren_hed_t2.Enter.hed_danwall01' / grouped_payload).read_bytes())

    def test_each_leaf15_payload_has_the_native_size_of_its_own_object(self):
        for object_path in ('dion_tree_t.leaf15', 'dion_tree_t.swamp_t.leaf15'):
            package, item, payload = self.exported_texture('dion_tree_t', object_path)
            properties, _ = package.properties(item)
            native_size = {entry['name']: entry.get('value') for entry in properties}
            header = png_image_header(png_chunks((self.root / object_path / payload).read_bytes()))
            self.assertEqual((header['width'], header['height']), (native_size['USize'], native_size['VSize']), object_path)


if __name__ == '__main__':
    unittest.main()
