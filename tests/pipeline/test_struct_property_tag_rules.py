import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import CLASS_DEFAULT_CACHE_FOLDER_NAME, DECOMPILE_WORK_FOLDER_NAME, ReferenceClientClassScripts
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client
from world.declared_property_types import PropertyScope, declared_property_types
from world.map_actor_properties import actor_properties
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement import ClassDefaults
from world.struct_property_tag_rules import (STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH, StructPropertyTagRulesError, load_struct_property_tag_rules,
                                             read_struct_property_tag_rules)
from world.struct_property_values import decode_property_tags
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import read_locked_map_package

RECIPE_PATH = ROOT / STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH
VERIFIED_FACTS_SHA256 = '5910698900707c74dbd95372bc72d49c6a1c84d0398242bccda0c386db924144'
CORE_DLL_SHA256 = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
CORE_DLL_BYTES = 1372180
CORE_DLL_IMAGE_BASE = '0x10100000'
REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
DECOMPILED_CLASS_SCRIPTS = ROOT / 'artifacts' / 'lane-store' / WORLD_LANE_NAME / 'work' / CLASS_DEFAULT_CACHE_FOLDER_NAME / DECOMPILE_WORK_FOLDER_NAME
ORACLE_CLASS_SCRIPTS = ('Core.Object', 'Engine.Actor', 'Engine.Info', 'Engine.L2FogInfo', 'Engine.ParticleEmitter', 'Engine.SpriteEmitter')
PE_HEADER_OFFSET_FIELD = 0x3c
PE_SIGNATURE = b'PE\0\0'
COFF_HEADER_BYTES = 20
PE32_MAGIC = 0x10b
PE32_IMAGE_BASE_OFFSET = 28
PE_HEADER_READ_BYTES = 4096


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


def real_client_skip_reason():
    if not REAL_CLIENT_ROOT.is_dir():
        return 'the conversion client E:/Lineage2-client is absent on this host'
    if not REFERENCE_CLIENT_LOCK_PATH.is_file():
        return 'the reference client lock is absent'
    missing = [name for name in ORACLE_CLASS_SCRIPTS if not (DECOMPILED_CLASS_SCRIPTS / name / 'defaults.json').is_file()]
    if missing:
        return f'the decompiled class scripts of the world lane are absent: {missing}'
    return None


def pe32_image_base(header):
    pe_offset = struct.unpack_from('<I', header, PE_HEADER_OFFSET_FIELD)[0]
    if header[pe_offset:pe_offset + len(PE_SIGNATURE)] != PE_SIGNATURE:
        raise AssertionError('system/Core.dll has no PE signature at its header offset')
    optional_header = pe_offset + len(PE_SIGNATURE) + COFF_HEADER_BYTES
    if struct.unpack_from('<H', header, optional_header)[0] != PE32_MAGIC:
        raise AssertionError('system/Core.dll is not a PE32 image')
    return struct.unpack_from('<I', header, optional_header + PE32_IMAGE_BASE_OFFSET)[0]


def value_at_path(values, dotted_path):
    for member in dotted_path.split('.'):
        values = values[member]
    return values


@unittest.skipIf(real_client_skip_reason() is not None, real_client_skip_reason() or '')
class RealMapOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            require_batch_preflight(ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        except BatchPreflightRefusedError as error:
            raise unittest.SkipTest(f'the real-map struct oracle checks wait for the batch preflight: {error}')
        run_at_below_normal_priority()
        cls.rules = read_struct_property_tag_rules()
        cls.oracles = cls.rules.document['oracles']
        cls.tile_id = Path(cls.oracles['map']).stem
        cls.package = read_locked_map_package(REAL_CLIENT_ROOT, cls.tile_id, read_tile_map_lock_record(cls.tile_id))
        cls.class_scripts = ReferenceClientClassScripts(REAL_CLIENT_ROOT)
        cls.declared_types = declared_property_types(ClassDefaults(lane_work_root(ROOT, WORLD_LANE_NAME), cls.class_scripts))

    def oracle_export(self, object_name):
        oracle = next(entry for entry in self.oracles['exports'] if entry['object'] == object_name)
        export = self.package.exports[oracle['exportIndex'] - 1]
        self.assertEqual(export['object'], f'{self.tile_id}.{oracle["object"]}')
        return oracle, export

    def assert_oracle_values(self, oracle, values):
        for expected in oracle['values']:
            value = value_at_path(values, expected['path'])
            with self.subTest(path=expected['path']):
                if 'streamValues' in expected:
                    self.assertEqual(list(value.values()), expected['streamValues'])
                if 'members' in expected:
                    self.assertEqual(value, expected['members'])
                if 'elementCount' in expected:
                    self.assertEqual(len(value), expected['elementCount'])

    def test_core_dll_equals_the_recipe_pin_and_its_pe_header_names_the_recipe_image_base(self):
        core_dll = self.rules.document['coreDll']
        path, sha256 = require_reference_client(REAL_CLIENT_ROOT).require_equal_file_with_sha256(core_dll['path'])
        with path.open('rb') as handle:
            header = handle.read(PE_HEADER_READ_BYTES)
        self.assertEqual((sha256, path.stat().st_size), (core_dll['sha256'], core_dll['bytes']))
        self.assertEqual(pe32_image_base(header), int(core_dll['imageBase'], 16))

    def test_the_fog_actor_class_and_its_super_chain_come_from_the_export_tables(self):
        oracle, export = self.oracle_export('L2FogInfo46')
        actor_class, = self.rules.document['actorClasses']
        self.assertEqual((export['classObject'], oracle['class']), (actor_class['class'], actor_class['class']))
        chain, class_object = [], actor_class['class']
        for _ in actor_class['superChain']:
            class_object = self.class_scripts.class_identity(class_object)['superClass']
            chain.append(class_object)
        self.assertEqual(chain, actor_class['superChain'])

    def test_l2_fog_info_46_decodes_to_the_oracle_with_no_unparsed_value_and_its_stream_ends_at_the_export_end(self):
        oracle, export = self.oracle_export('L2FogInfo46')
        tags, tail, _, _ = actor_properties(self.package, export)
        self.assertEqual((tail.position, tail.end), (export['offset'] + export['size'],) * 2)
        values = decode_property_tags(self.package, tags, export['classObject'], self.declared_types, self.rules)
        self.assert_oracle_values(oracle, values)
        colors = next(entry for entry in oracle['values'] if 'elementStruct' in entry)
        self.assertEqual(self.declared_types.property_type(PropertyScope(export['classObject'], None), colors['path']), f'array<{colors["elementStruct"]}>')
        self.assertNotIn('unparsedHex', json.dumps(values))

    def test_sprite_emitter_0_decodes_to_the_oracle_and_its_stream_ends_at_the_export_end(self):
        oracle, export = self.oracle_export('SpriteEmitter0')
        tags, reader = self.package.properties(export)
        self.assertEqual((reader.position, reader.end), (export['offset'] + export['size'],) * 2)
        self.assert_oracle_values(oracle, decode_property_tags(self.package, tags, export['classObject'], self.declared_types, self.rules))


if __name__ == '__main__':
    unittest.main()
