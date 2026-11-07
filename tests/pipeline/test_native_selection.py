"""Exact native identities must survive DAT leaf-name compatibility handling."""
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

    def test_qualified_name_does_not_bypass_exporter_same_class_collision(self):
        self.package.exports.append({**self.texture, 'object': 'Engine.Group.DefaultTexture'})
        with self.assertRaisesRegex(ValueError, 'duplicate leaf'):
            self.converter.select(self.package, 'Engine.DefaultTexture', 'Texture')

    def test_group_omitting_dat_binding_still_resolves_uniquely(self):
        self.package.exports = [{**self.texture, 'object': 'Engine.Group.DefaultTexture'}]
        self.assertEqual(self.converter.select(self.package, 'Engine.DefaultTexture'), self.package.exports[0])


if __name__ == '__main__':
    unittest.main()
