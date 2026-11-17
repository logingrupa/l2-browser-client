import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import class_default_inheritance
from native_catalog.ue2 import FormatError


class ClassDefaultInheritanceTests(unittest.TestCase):
    def test_raw_struct_overlay_does_not_claim_inherited_decoded_components(self):
        inherited = {'Material': {'MipZero': {'R': 64, 'G': 128, 'B': 64, 'A': 0},
            'DetailScale': 1.0}, 'Vector': {'X': 1, 'Y': 2}}
        raw = {'unparsedHex': '808080ff', 'type': 10, 'struct': 'Color'}
        authored = {'Material': {'MipZero': raw}, 'Vector': {'X': 9}}
        originals = copy.deepcopy((inherited, authored))
        merged = class_default_inheritance.merge_typed_defaults_replacing_raw_values_whole(inherited, authored)
        self.assertEqual(merged, {'Material': {'MipZero': raw, 'DetailScale': 1.0},
            'Vector': {'X': 9, 'Y': 2}})
        self.assertEqual((inherited, authored), originals)
        merged['Material']['MipZero']['unparsedHex'] = 'changed'
        self.assertEqual(authored['Material']['MipZero']['unparsedHex'], '808080ff')

    def test_typed_overlay_replaces_opaque_base_without_retaining_its_bytes(self):
        inherited = {'Color': {'unparsedHex': '808080ff', 'type': 10, 'struct': 'Color'}}
        self.assertEqual(class_default_inheritance.merge_typed_defaults_replacing_raw_values_whole(inherited, {'Color': {'R': 128}}),
            {'Color': {'R': 128}})

    def test_superclass_comes_from_export_table_and_merges_struct_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class Package:
                data = b'native'
                def object_name(self, index):
                    return 'Custom.Parent' if index else None
            class Packages:
                def resolve(self, reference, expected):
                    return {'object': reference}, Package(), {'superIndex': int(reference != 'Custom.Parent'), 'offset': 0, 'size': 6}
            def read_defaults(client, reference, work, **kwargs):
                work.mkdir(parents=True)
                (work / 'class.uc').write_text('native decompiler source', encoding='utf-8')
                parent = reference == 'Custom.Parent'
                return {'object': reference, 'superClass': None if parent else 'Parent',
                    'properties': {'Vector': {'X': 1, 'Y': 2}, 'DrawStyle': 6} if parent else {'Vector': {'X': 9}},
                    'sourceScript': 'class.uc'}
            with patch.object(class_default_inheritance, 'read_class_defaults', side_effect=read_defaults):
                reader = class_default_inheritance.DefaultReader(root, Packages(), root / 'work', lambda name, data: name)
                result = reader.get('Custom.Child')
            self.assertEqual(result['nativeSuperClass'], 'Custom.Parent')
            self.assertEqual(result['effectiveProperties'], {'Vector': {'X': 9, 'Y': 2}, 'DrawStyle': 6})
            self.assertEqual(result['properties'], {'Vector': {'X': 9}})

    def test_inheritance_cycle_is_rejected_before_unbounded_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class Package:
                data = b'x'
                def object_name(self, index):
                    return 'Custom.A'
            class Packages:
                def resolve(self, reference, expected):
                    return {'object': reference}, Package(), {'superIndex': 1, 'offset': 0, 'size': 1}
            definition = {'object': 'Custom.A', 'superClass': 'A', 'properties': {}, 'sourceScript': 'unused.uc'}
            with patch.object(class_default_inheritance, 'read_class_defaults', return_value=definition):
                with self.assertRaisesRegex(FormatError, 'Cyclic'):
                    class_default_inheritance.DefaultReader(root, Packages(), root / 'work', lambda name, data: name).get('Custom.A')


if __name__ == '__main__':
    unittest.main()
