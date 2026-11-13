import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock
from world.struct_property_tag_rules import (STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH, StructPropertyTagRulesError, load_struct_property_tag_rules,
                                             read_struct_property_tag_rules)

RECIPE_PATH = ROOT / STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH
VERIFIED_FACTS_SHA256 = '5910698900707c74dbd95372bc72d49c6a1c84d0398242bccda0c386db924144'
CORE_DLL_SHA256 = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
CORE_DLL_BYTES = 1372180
CORE_DLL_IMAGE_BASE = '0x10100000'


def recipe_document():
    return json.loads(RECIPE_PATH.read_text(encoding='utf-8'))


class RecipeTests(unittest.TestCase):
    def write_recipe(self, text):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / 'rules.json'
        path.write_text(text, encoding='utf-8')
        return path

    def assert_refused(self, document_text, message):
        with self.assertRaisesRegex(StructPropertyTagRulesError, message):
            load_struct_property_tag_rules(self.write_recipe(document_text))

    def test_the_committed_recipe_pins_the_lock_equal_core_dll_and_the_verified_facts(self):
        rules = read_struct_property_tag_rules()
        lock_record = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH).record('system/core.dll')
        self.assertEqual(rules.path, STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH)
        self.assertEqual(rules.document['coreDll'], {'path': 'system/Core.dll', 'bytes': CORE_DLL_BYTES, 'sha256': CORE_DLL_SHA256,
                                                     'imageBase': CORE_DLL_IMAGE_BASE})
        self.assertEqual((lock_record['class'], lock_record['eSha256'], lock_record['importaSha256'], lock_record['eBytes']),
                         ('equal', CORE_DLL_SHA256, CORE_DLL_SHA256, CORE_DLL_BYTES))
        self.assertEqual(rules.document['verification']['verifiedFactsSha256'], VERIFIED_FACTS_SHA256)
        self.assertEqual(rules.document['verification']['decisionRows'], ['P1153'])
        self.assertNotIn('struct-property-tags.json', RECIPE_PATH.read_text(encoding='utf-8'))

    def test_the_dispatch_names_its_vtable_slots_and_the_binary_structs_their_fname_ids_and_member_orders(self):
        rules = read_struct_property_tag_rules()
        dispatch = rules.document['rules']['structDispatch']
        self.assertEqual((dispatch['tagged']['address'], dispatch['binary']['address'], rules.minimum_tagged_package_version), ('0x88', '0x84', 118))
        self.assertEqual({entry['fnameId']: entry['name'] for entry in dispatch['binary']['structs']}, {'0x57': 'Vector', '0x58': 'Rotator', '0x5a': 'Color'})
        self.assertEqual(rules.binary_struct_layout('color').members, (('B', 'B'), ('G', 'B'), ('R', 'B'), ('A', 'B')))
        self.assertEqual((rules.binary_struct_layout('Rotator').members, rules.binary_struct_layout('Vector').byte_count),
                         ((('Pitch', 'i'), ('Yaw', 'i'), ('Roll', 'i')), 12))
        self.assertIsNone(rules.binary_struct_layout('Range'))

    def test_duplicate_keys_and_non_finite_numbers_are_refused(self):
        text = RECIPE_PATH.read_text(encoding='utf-8')
        self.assert_refused(text.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,', 1), 'repeats a JSON key')
        self.assert_refused(text.replace('"minimumPackageVersion": 118', '"minimumPackageVersion": NaN', 1), 'non-finite number')

    def test_a_core_dll_pin_that_differs_from_the_lock_entry_is_refused(self):
        for field, value in (('sha256', '0' * 64), ('bytes', CORE_DLL_BYTES + 1)):
            document = recipe_document()
            document['coreDll'][field] = value
            with self.subTest(field=field):
                self.assert_refused(json.dumps(document), 'differs from the system/core.dll entry of the reference client lock')

    def test_a_rule_without_its_address_fname_id_or_condition_is_refused(self):
        cases = ((('structDispatch', 'binary'), 'address', 'struct dispatch binary needs'), (('structDispatch', 'tagged'), 'condition', 'struct dispatch tagged needs'),
                 (('tag',), 'condition', 'rule tag needs a condition'), (('dynamicArray',), 'condition', 'rule dynamicArray needs a condition'))
        for path, field, message in cases:
            document = recipe_document()
            rule = document['rules']
            for key in path:
                rule = rule[key]
            del rule[field]
            with self.subTest(path=path, field=field):
                self.assert_refused(json.dumps(document), message)
        document = recipe_document()
        del document['rules']['structDispatch']['binary']['structs'][2]['fnameId']
        self.assert_refused(json.dumps(document), 'a binary struct needs fnameId, name and members')


if __name__ == '__main__':
    unittest.main()
