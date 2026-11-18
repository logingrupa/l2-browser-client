import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from data.pinned_elbera_module import ELBERA_ROOT
from native_catalog.ue2 import FormatError
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, require_batch_preflight, run_at_below_normal_priority
from test_world_reader_licensees import layout_completeness_problems
from world import bsp_step
from world.bsp_model_licensee_rules import BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH, read_bsp_model_licensee_rules
from world.bsp_step import RAW_MANIFEST_PRODUCT_NAME, bsp_unit_config, tile_level_model_layout
from world.elbera_reader_cross_check import ElberaCrossCheckError, elbera_level_model_projection
from world.bsp_reader_binding import reviewed_reader
from world.level_model import LevelModelLayoutError, read_level_model
from world.level_model_reference import read_level_tail
from world.reader_cross_check_rows import level_model_reader_fixture, read_cross_check_rows
from world.reader_licensee_layouts import (LEVEL_MODEL_READER, MAP_ACTOR_CROSS_CHECK_TILES, READER_LICENSEE_LAYOUTS, REVIEWED_PACKAGE_VERSION,
                                           require_reviewed_reader_layout)
from world.shared_sky_visibility_rules import level_tail_rules, read_shared_sky_visibility_rules
from world.world_lane_names import WORLD_LANE_NAME

ELIGIBLE_MAP_LICENSEES = (28, 23, 25, 30, 18, 31, 20, 19)
SHARED_SKY_PAIR = (118, 0)
REVIEWED_LEVEL_MODEL_PAIRS = sorted([*((REVIEWED_PACKAGE_VERSION, licensee) for licensee in ELIGIBLE_MAP_LICENSEES), SHARED_SKY_PAIR])
LEVEL_MODEL_SOURCE = ROOT / 'scripts/world/level_model.py'
VENDORED_EVIDENCE_SOURCE = 'Elbera vendored BSP reader'
REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
SHARED_SKY_VISIBILITY_FIXTURES = ROOT / 'tests/fixtures/environment/shared-sky-visibility-fixtures.json'


def level_model_rows(rows):
    return {(row['version'], row['licensee']): row for row in rows if row['reader'] == LEVEL_MODEL_READER}


def tile_level_model_layouts():
    return {pair: record for pair, record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items() if pair[0] == REVIEWED_PACKAGE_VERSION}


def level_model_fixture_problems(layouts, rows):
    problems = []
    rows_by_pair = level_model_rows(rows)
    for (version, licensee), record in layouts[LEVEL_MODEL_READER].items():
        fixture_path = ROOT / record['fixture']
        row = rows_by_pair.get((version, licensee))
        if not fixture_path.is_file() or row is None:
            problems.append(f'{version}/{licensee}: fixture or cross-check row missing')
            continue
        fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
        if (fixture['tile'], fixture['package'], fixture['lockSha256']) != (record['crossCheck']['tile'], row['package'], row['lockSha256']):
            problems.append(f'{version}/{licensee}: fixture names another tile or package than its record and row')
        if not fixture['countsSha256'] == row['ourDecodeSha256'] == row['crossCheckDecodeSha256']:
            problems.append(f'{version}/{licensee}: fixture counts differ from the cross-check row')
        if row['refusalReason'] is not None:
            problems.append(f'{version}/{licensee}: a reviewed pair holds a refusal')
    return problems


class LevelModelReaderGateTests(unittest.TestCase):
    def test_licensee_24_is_refused_and_the_baseline_28_is_reviewed(self):
        self.assertIs(require_reviewed_reader_layout(LEVEL_MODEL_READER, {'version': 123, 'licenseeVersion': 28}),
                      READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][(123, 28)])
        with self.assertRaisesRegex(FormatError, '^map-licensee-unsupported:123/24$'):
            require_reviewed_reader_layout(LEVEL_MODEL_READER, {'version': 123, 'licenseeVersion': 24})

    def test_read_level_model_turns_the_gate_refusal_into_the_layout_error_the_bsp_step_maps(self):
        for summary, reason in (({'version': 111, 'licenseeVersion': 28}, 'map-version-unsupported:111'),
                                ({'version': 118, 'licenseeVersion': 28}, 'map-licensee-unsupported:118/28'),
                                ({'version': 123, 'licenseeVersion': 24}, 'map-licensee-unsupported:123/24')):
            with self.subTest(reason=reason), self.assertRaises(LevelModelLayoutError) as caught:
                read_level_model(SimpleNamespace(summary=summary, filename='00_00.unr'))
            self.assertEqual(caught.exception.reason, reason)

    def test_the_level_model_reader_keeps_no_licensee_constant_of_its_own(self):
        source = LEVEL_MODEL_SOURCE.read_text(encoding='utf-8')
        self.assertNotIn('REVIEWED_LEVEL_MODEL', source)
        self.assertIn('require_reviewed_reader_layout(LEVEL_MODEL_READER', source)

    def test_each_level_model_cross_check_tile_is_the_map_actor_cross_check_tile_of_its_licensee(self):
        for (_, licensee), record in tile_level_model_layouts().items():
            with self.subTest(licensee=licensee):
                self.assertEqual(record['crossCheck']['tile'], MAP_ACTOR_CROSS_CHECK_TILES[licensee])

    def test_every_level_model_layout_cites_the_rm22_level_tail_rules_and_none_keeps_an_unverified_tail(self):
        recipe = read_shared_sky_visibility_rules()
        self.assertEqual(READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][SHARED_SKY_PAIR]['crossCheck'], {'tile': 'skylevel'})
        for pair, record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items():
            with self.subTest(pair=pair):
                self.assertNotIn('unverifiedLevelTail', record)
                self.assertIn(recipe['sha256'], [entry['sha256'] for entry in record['evidence']])


def synthetic_tail_adapter(version, tail_bytes):
    data = bytes(TAIL_LEVEL_OFFSET) + tail_bytes
    return SimpleNamespace(file_version=version, data=data, path='synthetic.unr', resolve_ref=lambda reference: None)


def synthetic_tail_binding(tail_bytes):
    return {'levelSerialOffset': 0, 'decodedPrefixBytes': TAIL_LEVEL_OFFSET, 'levelSerialSize': TAIL_LEVEL_OFFSET + len(tail_bytes)}


TAIL_LEVEL_OFFSET = 7
NULL_COMPACT = b'\x00'


def synthetic_tail_bytes(legacy_time, string_map_bytes=NULL_COMPACT):
    return struct.pack('<f', legacy_time) + NULL_COMPACT * (1 + level_tail_rules()['objectReferenceCount']) + string_map_bytes


class LevelTailDecodeTests(unittest.TestCase):
    def test_a_version_123_tail_decodes_its_time_first_deleted_object_references_and_string_map(self):
        tail_bytes = synthetic_tail_bytes(1.5, b'\x01\x03ab\x00\x02c\x00')
        tail = read_level_tail(synthetic_tail_adapter(123, tail_bytes), reviewed_reader(), synthetic_tail_binding(tail_bytes), level_tail_rules())
        self.assertEqual((tail['legacyTime'], tail['firstDeleted'], tail['stringMap'], tail['bytes']), (1.5, 0, [['ab', 'c']], len(tail_bytes)))
        self.assertEqual(tail['objectReferences'], [0] * level_tail_rules()['objectReferenceCount'])
        self.assertEqual(tail['unprovenNames'], level_tail_rules()['unprovenNames'])

    def test_a_tail_with_undecoded_bytes_is_refused(self):
        tail_bytes = synthetic_tail_bytes(1.5) + b'\x00'
        with self.assertRaisesRegex(FormatError, 'leaves 1 of its'):
            read_level_tail(synthetic_tail_adapter(123, tail_bytes), reviewed_reader(), synthetic_tail_binding(tail_bytes), level_tail_rules())

    def test_a_version_below_the_obsolete_array_gate_is_refused_as_unresolved(self):
        tail_bytes = synthetic_tail_bytes(1.5)
        version = level_tail_rules()['obsoleteArrayBelowVersion'] - 1
        with self.assertRaisesRegex(FormatError, level_tail_rules()['olderVersionsUnresolved']):
            read_level_tail(synthetic_tail_adapter(version, tail_bytes), reviewed_reader(), synthetic_tail_binding(tail_bytes), level_tail_rules())

    def test_the_rules_recipe_states_the_rm22_ulevel_serialize_gates(self):
        rules = level_tail_rules()
        self.assertEqual((rules['function'], rules['address']), ('ULevel::Serialize', '0x105d07f0'))
        self.assertLess(rules['stringMapFromVersion'], rules['obsoleteArrayBelowVersion'])


@unittest.skipUnless((REAL_CLIENT_ROOT / 'maps/skylevel.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
class RealLevelTailTests(unittest.TestCase):
    def test_the_skylevel_tail_decodes_to_the_rm22_claim_and_every_reviewed_fixture_names_its_decoded_tail(self):
        claim = json.loads(SHARED_SKY_VISIBILITY_FIXTURES.read_text(encoding='utf-8'))['levelTail']['claim']
        for (version, licensee), record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items():
            fixture = json.loads((ROOT / record['fixture']).read_text(encoding='utf-8'))
            with self.subTest(pair=(version, licensee)):
                self.assertNotIn('remainingTailBytes', fixture['levelBinding'])
                self.assertEqual(fixture['levelBinding']['tail']['stringMap'], [])
                if (version, licensee) == SHARED_SKY_PAIR:
                    self.assertIn(f'float32 time{fixture["levelBinding"]["tail"]["legacyTime"]!r}', claim)
                    self.assertIn(f'with{fixture["levelBinding"]["tail"]["bytes"]} fully decoded bytes', claim)


class LevelModelRecordTests(unittest.TestCase):
    def test_every_level_model_record_has_evidence_a_matching_fixture_and_an_equal_cross_check_row(self):
        rows = read_cross_check_rows(ROOT)
        layouts = {LEVEL_MODEL_READER: READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER]}
        self.assertEqual(layout_completeness_problems(layouts, rows), [])
        self.assertEqual(level_model_fixture_problems(layouts, rows), [])

    def test_a_level_model_record_without_its_fixture_or_its_cross_check_row_is_detected(self):
        rows = read_cross_check_rows(ROOT)
        for pair in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER]:
            without_fixture = {LEVEL_MODEL_READER: copy.deepcopy(READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER])}
            without_fixture[LEVEL_MODEL_READER][pair]['fixture'] = 'tests/fixtures/world-readers/absent.json'
            without_row = [row for row in rows if (row['reader'], row['version'], row['licensee']) != (LEVEL_MODEL_READER, *pair)]
            layouts = {LEVEL_MODEL_READER: READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER]}
            with self.subTest(pair=pair):
                self.assertNotEqual(level_model_fixture_problems(without_fixture, rows), [])
                self.assertNotEqual(level_model_fixture_problems(layouts, without_row), [])
                self.assertNotEqual(layout_completeness_problems(layouts, without_row), [])

    def test_the_vendored_reader_evidence_matches_the_vendored_file(self):
        for record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].values():
            vendored = [entry for entry in record['evidence'] if entry['source'] == VENDORED_EVIDENCE_SOURCE]
            self.assertEqual(len(vendored), 1)
            self.assertEqual(hashlib.sha256((ROOT / vendored[0]['file']).read_bytes()).hexdigest(), vendored[0]['sha256'])

    def test_every_eligible_map_licensee_and_the_shared_sky_pair_have_a_level_model_verdict_row(self):
        self.assertEqual(sorted(level_model_rows(read_cross_check_rows(ROOT))), REVIEWED_LEVEL_MODEL_PAIRS)

    def test_every_reviewed_level_model_pair_is_reviewed_by_an_equal_row_without_a_refusal(self):
        rows = level_model_rows(read_cross_check_rows(ROOT))
        self.assertEqual(sorted(READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER]), REVIEWED_LEVEL_MODEL_PAIRS)
        for pair, row in rows.items():
            with self.subTest(pair=pair):
                self.assertEqual(row['tile'], READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][pair]['crossCheck']['tile'])
                self.assertTrue(row['equal'])
                self.assertIsNone(row['refusalReason'])

    def test_licensees_below_a_rule_minimum_name_each_rule_and_cite_the_recipe(self):
        for licensee in (18, 19, 20):
            record = READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][(123, licensee)]
            with self.subTest(licensee=licensee):
                self.assertEqual(len(record['differencesFrom123_28']), 2)
                self.assertIn('levelBaseReferenceArrays at ULevelBase::Serialize 0x105cf110 applies from LicenseeVer 23', record['differencesFrom123_28'][0])
                self.assertIn('surfaceTrailingInteger at FBspSurf serializer 0x105ea020 applies from LicenseeVer 21', record['differencesFrom123_28'][1])
                recipe_entries = [entry for entry in record['evidence'] if entry['file'] == BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH]
                self.assertEqual(len(recipe_entries), 1)
                self.assertEqual((recipe_entries[0]['source'], recipe_entries[0]['commit']), ('Engine.dll level model rules', '4dd2f63c'))
                self.assertEqual(recipe_entries[0]['sha256'], hashlib.sha256((ROOT / BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH).read_bytes()).hexdigest())
        for licensee in (23, 25, 28, 30, 31):
            with self.subTest(licensee=licensee):
                self.assertEqual(READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][(123, licensee)]['differencesFrom123_28'], [])


class BspUnitConfigTests(unittest.TestCase):
    def raw_products(self, licensee):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        products = Path(temporary.name)
        manifest = {'nativePackage': {'version': REVIEWED_PACKAGE_VERSION, 'licenseeVersion': licensee}}
        (products / RAW_MANIFEST_PRODUCT_NAME).write_text(json.dumps(manifest), encoding='utf-8')
        return products

    def test_the_bsp_unit_config_carries_the_reviewed_level_model_record_of_the_tile_pair(self):
        products = self.raw_products(23)
        record = READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][(123, 23)]
        self.assertIs(tile_level_model_layout(products), record)
        self.assertEqual(bsp_unit_config('chunks', tile_level_model_layout(products))['levelModelLayout'], record)
        self.assertIsNone(tile_level_model_layout(self.raw_products(24)))

    def test_adding_the_123_23_record_changes_the_bsp_unit_config_of_a_123_23_tile(self):
        products = self.raw_products(23)
        with_record = bsp_unit_config('chunks', tile_level_model_layout(products))
        without = {pair: record for pair, record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items() if pair != (123, 23)}
        with patch.dict(READER_LICENSEE_LAYOUTS, {LEVEL_MODEL_READER: without}):
            without_record = bsp_unit_config('chunks', tile_level_model_layout(products))
        self.assertIsNone(without_record['levelModelLayout'])
        self.assertNotEqual(with_record, without_record)

    def test_the_bsp_unit_config_of_a_123_28_tile_carries_the_level_model_rules_recipe_sha256(self):
        products = self.raw_products(28)
        recipe = read_bsp_model_licensee_rules()
        config = bsp_unit_config('chunks', tile_level_model_layout(products))
        self.assertEqual(config['levelModelRulesSha256'], recipe['sha256'])
        with patch.object(bsp_step, 'read_bsp_model_licensee_rules', lambda: {**recipe, 'sha256': 'c' * 64}):
            self.assertNotEqual(bsp_unit_config('chunks', tile_level_model_layout(products)), config)


class ElberaLevelModelGuardTests(unittest.TestCase):
    def test_the_elbera_level_model_reading_refuses_anything_but_a_guard_access(self):
        with self.assertRaisesRegex(ElberaCrossCheckError, 'only through a reference client guard access'):
            elbera_level_model_projection(REAL_CLIENT_ROOT, 'maps/17_20.unr')


@unittest.skipUnless((REAL_CLIENT_ROOT / 'maps/20_21.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
@unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
class RealClientLevelModelFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            require_batch_preflight(ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        except BatchPreflightRefusedError as error:
            raise unittest.SkipTest(f'real-client level-model fixtures wait for the batch preflight: {error}')
        run_at_below_normal_priority()

    def test_every_level_model_fixture_reproduces_exactly_from_its_cross_check_tile(self):
        for (version, licensee), record in READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER].items():
            with self.subTest(version=version, licensee=licensee):
                fixture = json.loads((ROOT / record['fixture']).read_text(encoding='utf-8'))
                self.assertEqual(level_model_reader_fixture(REAL_CLIENT_ROOT, version, licensee, record['crossCheck']['tile']), fixture)


if __name__ == '__main__':
    unittest.main()
