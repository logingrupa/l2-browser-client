import copy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.object_property_values import object_values
from native_catalog.ue2 import FormatError


class ObjectPropertyValuesTests(unittest.TestCase):
    def test_fixed_property_array_preserves_implicit_zero_and_explicit_later_index(self):
        tags = [dict(name='Sequence', type=2, arrayIndex=None, value=7, status='decoded'),
            dict(name='Sequence', type=2, arrayIndex=2, value=9, status='decoded'),
            dict(name='DrawStyle', type=2, arrayIndex=None, value=6, status='decoded')]
        original = copy.deepcopy(tags)
        self.assertEqual(object_values(None, tags), {'Sequence': [7, None, 9], 'DrawStyle': 6})
        self.assertEqual(tags, original)

    def test_ambiguous_duplicate_property_is_not_silently_overwritten(self):
        tag = dict(name='DrawStyle', type=2, arrayIndex=None, value=6, status='decoded')
        with self.assertRaisesRegex(FormatError, 'Duplicate native property path'):
            object_values(None, [tag, dict(tag, value=2)])


if __name__ == '__main__':
    unittest.main()
