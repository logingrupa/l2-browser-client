import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from data.pinned_elbera_module import ELBERA_ROOT
from native_catalog.ue2 import FormatError, Reader
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client
from support.lightmap_tail_fixture import compact_index_bytes, lightmap_node, render_section_bytes
from world.bsp_lightmaps import model_tail_bounds, read_bsp_lightmaps, read_render_sections, render_vertex_bytes
from world.bsp_model_licensee_rules import (BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH, BspModelLicenseeRulesError, load_bsp_model_licensee_rules,
                                            read_bsp_model_licensee_rules)
from world.bsp_reader_binding import PackageAdapter, reviewed_reader
from world.level_model import read_level_model, read_model_body
from world.level_model_reference import read_level_model_reference
from world.map_sources import MapSources
from world.reader_licensee_layouts import LEVEL_MODEL_READER, READER_LICENSEE_LAYOUTS
from world.tile_census import WORLD_LANE_NAME

RECIPE_PATH = ROOT / BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH
VERIFIED_FACTS_SHA256 = '79d11661af9e67ea4f4090185012ec6220d562380b6322a14df272edf23d7ae5'
ENGINE_SHA256 = '4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08'
PACKAGE_VERSION = 123
LEVEL_EXPORT_REFERENCE = 1
MODEL_EXPORT_REFERENCE = 2
LEVEL_CLASS_IMPORT = -1
MODEL_CLASS_IMPORT = -2
TEXTURE_CLASS_IMPORT = -3
NAMES = ('None', 'SyntheticProperty')
EMPTY_PROPERTY_NAME_INDEX = 0
PROPERTY_NAME_INDEX = 1
OBJECT_NAMES = {LEVEL_CLASS_IMPORT: 'Engine.Level', MODEL_CLASS_IMPORT: 'Engine.Model', TEXTURE_CLASS_IMPORT: 'Engine.Texture',
                LEVEL_EXPORT_REFERENCE: 'Synthetic.MyLevel', MODEL_EXPORT_REFERENCE: 'Synthetic.Model0'}
MODEL_EXPORT_BYTES = 8
LEVEL_TAIL_BYTES = bytes(6)
URL_STRING_COUNT = 4
FIRST_ARRAY_REFERENCES = (0, LEVEL_EXPORT_REFERENCE)
SECOND_ARRAY_REFERENCES = (MODEL_EXPORT_REFERENCE,)
SQUARE_UVS = ((0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25))
REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
BLOCKED_TILE_IDS = ('17_18', '17_19', '18_15', '18_18', '23_10', '26_12', '26_11', '24_26', '20_16', '23_25', '24_14', '24_20', '25_20')
VENDORED_BINDING_MINIMUM_LICENSEE = 23
UNWALKED_LIGHTMAP_TAILS = {'18_15': 163885}
REVISION_AHEAD_LICENSEE = 31


def recipe_document():
    return json.loads(RECIPE_PATH.read_text(encoding='utf-8'))


def reference_array_bytes(references, duplicate_count=None):
    count = len(references)
    return struct.pack('<ii', count, count if duplicate_count is None else duplicate_count) + b''.join(compact_index_bytes(value) for value in references)


def synthetic_level_bytes(arrays, property_name_index=EMPTY_PROPERTY_NAME_INDEX, model_reference=MODEL_EXPORT_REFERENCE):
    url = compact_index_bytes(0) * URL_STRING_COUNT + compact_index_bytes(0) + struct.pack('<ii', 0, 0)
    return compact_index_bytes(property_name_index) + b''.join(arrays) + url + compact_index_bytes(model_reference) + LEVEL_TAIL_BYTES


class SyntheticLevelPackage:
    def __init__(self, licensee_version, level_bytes, level_flags=0, model_class=MODEL_CLASS_IMPORT):
        self.file_version, self.licensee_version, self.path = PACKAGE_VERSION, licensee_version, 'Synthetic.unr'
        self.data = level_bytes + bytes(MODEL_EXPORT_BYTES)
        self.exports = [SimpleNamespace(index=0, class_index=LEVEL_CLASS_IMPORT, package_index=0, object_flags=level_flags, serial_offset=0,
                                        serial_size=len(level_bytes)),
                        SimpleNamespace(index=1, class_index=model_class, package_index=0, object_flags=0, serial_offset=len(level_bytes),
                                        serial_size=MODEL_EXPORT_BYTES)]
        self.source = SimpleNamespace(object_name=lambda reference: OBJECT_NAMES[reference])

    def name(self, index):
        return NAMES[index]

    def resolve_ref(self, reference):
        self.source.object_name(reference)
        return self.exports[reference - 1] if reference > 0 else None


def level_rules():
    return read_bsp_model_licensee_rules()['document']['rules']


def read_synthetic_prefix(package):
    return read_level_model_reference(package, reviewed_reader(), level_rules())


class RecipeTests(unittest.TestCase):
    def write_recipe(self, text):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / 'rules.json'
        path.write_text(text, encoding='utf-8')
        return path

    def assert_refused(self, document_text, message):
        with self.assertRaisesRegex(BspModelLicenseeRulesError, message):
            load_bsp_model_licensee_rules(self.write_recipe(document_text))

    def test_the_committed_recipe_pins_the_lock_equal_engine_and_the_verified_facts(self):
        recipe = read_bsp_model_licensee_rules()
        document = recipe['document']
        lock_record = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH).record('system/engine.dll')
        self.assertEqual(recipe['path'], BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH)
        self.assertEqual(document['engine'], {'path': 'system/Engine.dll', 'sha256': ENGINE_SHA256, 'imageBase': '0x10300000'})
        self.assertEqual((lock_record['class'], lock_record['eSha256'], lock_record['importaSha256']), ('equal', ENGINE_SHA256, ENGINE_SHA256))
        self.assertEqual(document['verification']['verifiedFactsSha256'], VERIFIED_FACTS_SHA256)
        self.assertEqual(document['verification']['decisionRows'], ['P1152', 'P1153'])
        self.assertEqual({name: rule['address'] for name, rule in document['rules'].items()},
                         {'levelBaseReferenceArrays': '0x105cf110', 'levelModelReference': '0x105d07f0', 'surfaceTrailingInteger': '0x105ea020'})
        self.assertEqual((document['rules']['levelBaseReferenceArrays']['minimumLicensee'], document['rules']['surfaceTrailingInteger']['minimumLicensee']),
                         (23, 21))
        self.assertNotIn('bsp-model-licensees.json', RECIPE_PATH.read_text(encoding='utf-8'))

    def test_duplicate_keys_and_non_finite_numbers_are_refused(self):
        text = RECIPE_PATH.read_text(encoding='utf-8')
        self.assert_refused(text.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,', 1), 'repeats a JSON key')
        self.assert_refused(text.replace('"memberBytes": 4', '"memberBytes": NaN', 1), 'non-finite number')

    def test_an_engine_pin_that_differs_from_the_lock_entry_is_refused(self):
        document = recipe_document()
        document['engine']['sha256'] = '0' * 64
        self.assert_refused(json.dumps(document), 'differs from the system/engine.dll entry of the reference client lock')

    def test_a_rule_without_an_address_or_a_condition_is_refused(self):
        for field in ('address', 'condition'):
            document = recipe_document()
            del document['rules']['surfaceTrailingInteger'][field]
            with self.subTest(field=field):
                self.assert_refused(json.dumps(document), 'rule surfaceTrailingInteger needs')


class LevelPrefixReaderTests(unittest.TestCase):
    def test_licensee_18_reads_only_the_0x38_array_then_the_url_then_the_model_reference(self):
        package = SyntheticLevelPackage(18, synthetic_level_bytes([reference_array_bytes(SECOND_ARRAY_REFERENCES)]))
        model, evidence = read_synthetic_prefix(package)
        self.assertIs(model, package.exports[1])
        self.assertEqual([array['nativeField'] for array in evidence['actorArrays']], ['0x38'])
        self.assertEqual(evidence['actorArrays'][0]['references'], list(SECOND_ARRAY_REFERENCES))
        self.assertEqual(sorted(evidence['spans']), ['array0x38', 'modelReference', 'properties', 'url'])
        self.assertEqual((evidence['model'], evidence['remainingTailBytes']),
                         ({'reference': MODEL_EXPORT_REFERENCE, 'qualified': 'Synthetic.Model0'}, len(LEVEL_TAIL_BYTES)))

    def test_licensee_23_reads_0x48_then_0x38_and_equals_the_vendored_binding(self):
        package = SyntheticLevelPackage(23, synthetic_level_bytes([reference_array_bytes(FIRST_ARRAY_REFERENCES),
                                                                   reference_array_bytes(SECOND_ARRAY_REFERENCES)]))
        model, evidence = read_synthetic_prefix(package)
        self.assertEqual([array['nativeField'] for array in evidence['actorArrays']], ['0x48', '0x38'])
        self.assertEqual(reviewed_reader().level_model_binding(package), (model, evidence))

    def test_the_prefix_guards_refuse_malformed_levels(self):
        one_array = [reference_array_bytes(SECOND_ARRAY_REFERENCES)]
        cases = {
            'unsupported nonempty Level property stream': SyntheticLevelPackage(18, synthetic_level_bytes(one_array, PROPERTY_NAME_INDEX)),
            'noncanonical Level actor-array counts': SyntheticLevelPackage(18, synthetic_level_bytes([reference_array_bytes(SECOND_ARRAY_REFERENCES, 2)])),
            'state-frame prefix': SyntheticLevelPackage(18, synthetic_level_bytes(one_array), level_flags=reviewed_reader().RF_HAS_STACK),
            'does not reference a serialized Engine.Model': SyntheticLevelPackage(18, synthetic_level_bytes(one_array), model_class=TEXTURE_CLASS_IMPORT),
        }
        for message, package in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(FormatError, message):
                read_synthetic_prefix(package)


class SurfaceRuleTests(unittest.TestCase):
    def test_the_surface_trailing_integer_is_read_from_licensee_21(self):
        for licensee, reads_trailing_integer in ((18, False), (20, False), (21, True), (31, True)):
            captured = []
            reader_module = SimpleNamespace(_read_model=lambda adapter, export, extra_field: captured.append(extra_field))
            with self.subTest(licensee=licensee):
                read_model_body(SimpleNamespace(licensee_version=licensee), reader_module, object())
                self.assertEqual(captured, [reads_trailing_integer])


class RenderSectionRuleTests(unittest.TestCase):
    def read_one_section(self, section_bytes, nodes):
        data = compact_index_bytes(1) + section_bytes
        return read_render_sections(Reader(data, 0, len(data)), nodes, PACKAGE_VERSION)

    def two_square_nodes(self, second_vertices=4):
        return [lightmap_node(-1, 0, 0, 4), lightmap_node(-1, 0, 4, second_vertices), lightmap_node(-1, 0, 0, 0), lightmap_node(-1, 1, 0, 4)]

    def test_the_render_vertex_is_ten_members_from_package_version_109(self):
        self.assertEqual((render_vertex_bytes(PACKAGE_VERSION), render_vertex_bytes(108)), (40, 28))

    def test_a_revision_one_above_the_node_count_reads(self):
        sections = self.read_one_section(render_section_bytes(SQUARE_UVS * 2, 2, 0, revision=3), self.two_square_nodes())
        self.assertEqual((sections[0].vertex_count, sections[0].revision, sections[0].node_count), (8, 3, 2))

    def test_a_vertex_count_other_than_the_assigned_node_vertices_is_refused_with_both_numbers(self):
        with self.assertRaisesRegex(FormatError, 'render section 0 holds 8 vertices, but its assigned nodes hold 7'):
            self.read_one_section(render_section_bytes(SQUARE_UVS * 2, 2, 0), self.two_square_nodes(second_vertices=3))

    def test_a_node_count_other_than_the_assigned_nodes_with_vertices_is_refused_with_both_numbers(self):
        with self.assertRaisesRegex(FormatError, 'render section 0 declares 3 nodes, but 2 nodes with vertices are assigned to it'):
            self.read_one_section(render_section_bytes(SQUARE_UVS * 2, 3, 0), self.two_square_nodes())


def read_real_map(tile_id):
    relative_path = f'maps/{tile_id}.unr'
    require_reference_client(REAL_CLIENT_ROOT).require_equal_file_with_sha256(relative_path)
    return MapSources(REAL_CLIENT_ROOT.resolve()).get(relative_path)


def real_client_skip_reason():
    if not REAL_CLIENT_ROOT.is_dir():
        return 'the conversion client E:/Lineage2-client is absent on this host'
    if not REFERENCE_CLIENT_LOCK_PATH.is_file():
        return 'the reference client lock is absent'
    if not ELBERA_ROOT.is_dir():
        return 'the pinned Elbera checkout is absent on this host'
    return None


@unittest.skipIf(real_client_skip_reason() is not None, real_client_skip_reason() or '')
class RealMapLicenseeRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            require_batch_preflight(ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        except BatchPreflightRefusedError as error:
            raise unittest.SkipTest(f'the real-map licensee rule checks wait for the batch preflight: {error}')
        run_at_below_normal_priority()

    def assert_sections_end_before_the_tail_end(self, package, model, lightmaps):
        start, end = model_tail_bounds(model)
        vertex_bytes = render_vertex_bytes(package.summary['version'])
        vertex_ends = [section.vertex_offset + vertex_bytes * section.vertex_count for section in lightmaps.sections]
        self.assertTrue(all(start < section.vertex_offset for section in lightmaps.sections))
        self.assertTrue(all(vertex_end < following.vertex_offset for vertex_end, following in zip(vertex_ends, lightmaps.sections[1:])))
        self.assertLess(vertex_ends[-1], end)

    def test_each_of_the_13_maps_reads_by_the_recipe_rules_and_walks_its_lightmap_tail(self):
        map_licensees = read_bsp_model_licensee_rules()['document']['mapLicensees']
        self.assertEqual(sorted(map_licensees), sorted(BLOCKED_TILE_IDS))
        for tile_id in BLOCKED_TILE_IDS:
            with self.subTest(tile=tile_id):
                package = read_real_map(tile_id)
                licensee = package.summary['licenseeVersion']
                self.assertEqual((package.summary['version'], licensee), (PACKAGE_VERSION, map_licensees[tile_id]))
                level = read_level_model(package)
                arrays = [array['nativeField'] for array in level.binding['actorArrays']]
                self.assertEqual(arrays, ['0x38'] if licensee < VENDORED_BINDING_MINIMUM_LICENSEE else ['0x48', '0x38'])
                lightmaps = read_bsp_lightmaps(package, level.model)
                self.assert_sections_end_before_the_tail_end(package, level.model, lightmaps)
                if tile_id in UNWALKED_LIGHTMAP_TAILS:
                    self.assertEqual((len(lightmaps.records), lightmaps.unwalked_tail_bytes), (0, UNWALKED_LIGHTMAP_TAILS[tile_id]))
                else:
                    self.assertGreater(len(lightmaps.records), 0)
                    self.assertEqual(lightmaps.unwalked_tail_bytes, 0)
                if licensee == REVISION_AHEAD_LICENSEE:
                    self.assertTrue(any(section.revision != section.node_count for section in lightmaps.sections))

    def test_the_prefix_reader_equals_the_vendored_binding_on_the_five_reviewed_cross_check_tiles(self):
        rules = read_bsp_model_licensee_rules()['document']['rules']
        cross_check_tiles = {licensee: record['crossCheck']['tile'] for (_, licensee), record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items()
                             if licensee >= VENDORED_BINDING_MINIMUM_LICENSEE}
        self.assertEqual(sorted(cross_check_tiles.values()), ['15_20', '17_20', '17_22', '19_23', '20_21'])
        for licensee, tile_id in cross_check_tiles.items():
            with self.subTest(tile=tile_id):
                package = read_real_map(tile_id)
                self.assertEqual((package.summary['version'], package.summary['licenseeVersion']), (PACKAGE_VERSION, licensee))
                adapter, reader_module = PackageAdapter(package), reviewed_reader()
                self.assertEqual(read_level_model_reference(adapter, reader_module, rules), reader_module.level_model_binding(adapter))


if __name__ == '__main__':
    unittest.main()
