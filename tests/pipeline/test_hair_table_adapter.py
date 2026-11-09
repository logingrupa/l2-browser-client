import ast
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
import convert_tables
from build_dat_table_inventory import (ELBERA_ADAPTER_COUNT_SOURCE, ELBERA_ADAPTER_DECODED_STATUS, ELBERA_PARSER_PRESENT_STATUS,
                                       count_elbera_route_table)
from convert_tables import DECODE_TABLE_ALGORITHM_VERSION, ELBERA_ADAPTER_ROUTE, convert_table_unit
from data.hair_table_adapter import (DDF_CROSS_CHECK_COMPARED_STATUS, DDF_CROSS_CHECK_UNRESOLVED_STATUS, ELBERA_HAIR_FIELD_PROOF,
                                     ELBERA_HAIR_SELECTION_SCRIPT_PATH, ELBERA_HAIR_SELECTION_SCRIPT_SHA256, FIRST_DISAGREEMENT_OFFSET_LIMIT,
                                     HAIR_LAYOUT_UNDECODED_REASON, HAIR_TABLE_PARSERS, HELMET_LAYOUT_UNDECODED_REASON, INTERLUDE_DDF_PATHS,
                                     NO_INTERLUDE_DDF_STATUS, HairTableAdapterError, HairTableUndecodedError, declared_layout_reader,
                                     decode_hair_table, hair_table_ddf_cross_check, hair_table_int32_versus_layout_cross_check,
                                     hairgrp_cross_checks, hairgrp_layout_xml_bytes)
from data.pinned_elbera_module import ELBERA_ROOT, load_pinned_elbera_module
from native_catalog.tables import SAFE_PACKAGE_TRAILER, SCHEMA_ROOT
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH, ReferenceClientLockError, require_reference_client
from reference_client_lock_fixture import (equal_lock_record, lock_client_as_checked_conversion_root, use_synthetic_reference_client_lock,
                                           write_synthetic_engine_library)

ADAPTER_SOURCE_PATH = ROOT / 'scripts' / 'data' / 'hair_table_adapter.py'
ELBERA_SCRIPT_AVAILABLE = (ELBERA_ROOT / ELBERA_HAIR_SELECTION_SCRIPT_PATH).is_file()
ELBERA_UNAVAILABLE_REASON = f'Elbera checkout with {ELBERA_HAIR_SELECTION_SCRIPT_PATH} unavailable at {ELBERA_ROOT.as_posix()}'
ELBERA_MODULE_PARAMETER_NAME = 'elbera_module'
ALLOWED_ELBERA_ATTRIBUTES = {'hair_pairs', 'keyed_hair_pairs'}
REFUSED_ELBERA_NAMES = ('verify', 'verify_material_native', 'audit_assets', 'main', '--check')
HAIRGRP_FILE = 'system/hairgrp.dat'
HELMETGRP_FILE = 'system/helmetgrp.dat'
HAIRACCESSARYGRP_FILE = 'system/hairaccessarygrp.dat'
NESTED_HAIRGRP_DDF_PATH = 'L2FileEdit-master/L2FileEdit-master/data/l2asm-disasm/DAT_defs/Interlude/hairgrp.ddf'
SYNTHETIC_DDF_TEXT = 'FS = "\\t";\r\nRECCNT = 2;\r\n\r\n{\r\n\t// synthetic field note\r\n\tCHAR m0_a0;\r\n\tCHAR m0_b0;\r\n}'
REAL_CLIENT_ROOT = Path(json.loads((ROOT / 'recipes' / 'reference-client-tree.lock.json').read_bytes())['conversionRoot'])
PAIR_TABLE_WORD_COUNT = 450
PAIR_TABLE_ROW_COUNT = 15
PAIR_TABLE_STYLE_COUNT = 15


def synthetic_pair_table_payload():
    return struct.pack(f'<{PAIR_TABLE_WORD_COUNT}i', *range(PAIR_TABLE_WORD_COUNT)) + SAFE_PACKAGE_TRAILER


class SyntheticHairClientTestCase(unittest.TestCase):
    hair_files = (HAIRGRP_FILE,)

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.project_root = base / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.client_root = base / 'conversion'
        (self.client_root / 'system').mkdir(parents=True)
        for relative_path in self.hair_files:
            (self.client_root / relative_path).write_bytes(f'synthetic encrypted {relative_path}'.encode())
        lock_client_as_checked_conversion_root(self, self.client_root, base / 'importa', list(self.hair_files))
        self.client_access = require_reference_client(self.client_root)
        self.output_root = lane_store_root(self.project_root, 'data-ui')

    def decode_with_payload(self, table, payload):
        with patch('data.hair_table_adapter.decode413', return_value=('fixture', payload)):
            return decode_hair_table(self.client_access, table)

    def convert_with_payload(self, table, payload):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), 'decode', DECODE_TABLE_ALGORITHM_VERSION)
        with patch('data.hair_table_adapter.decode413', return_value=('fixture', payload)):
            return convert_table_unit(self.project_root, self.client_access, table, self.output_root, ledger, [])

    def tables_records(self):
        return json.loads((self.output_root / 'catalog.json').read_bytes())['tables']

    def receipt(self, table):
        return json.loads((lane_work_root(self.project_root, 'data-ui') / f'table__{table}' / 'decode' / 'receipt.json').read_bytes())


@unittest.skipUnless(ELBERA_SCRIPT_AVAILABLE, ELBERA_UNAVAILABLE_REASON)
class PinnedElberaHairScriptTests(unittest.TestCase):
    def test_the_pinned_script_loads_and_defines_both_parsers(self):
        elbera_module = load_pinned_elbera_module(ELBERA_HAIR_SELECTION_SCRIPT_PATH, ELBERA_HAIR_SELECTION_SCRIPT_SHA256)
        self.assertTrue(callable(elbera_module.hair_pairs))
        self.assertTrue(callable(elbera_module.keyed_hair_pairs))


@unittest.skipUnless(ELBERA_SCRIPT_AVAILABLE, ELBERA_UNAVAILABLE_REASON)
class HairPairTableTests(SyntheticHairClientTestCase):
    def test_exact_pair_table_decodes_to_fifteen_rows_of_fifteen_pairs(self):
        decoded = self.decode_with_payload('hairgrp', synthetic_pair_table_payload())
        self.assertEqual((decoded['recordCount'], decoded['decodedBytes'], decoded['keyFamily'], decoded['sourcePath']),
                         (PAIR_TABLE_ROW_COUNT, PAIR_TABLE_WORD_COUNT * 4 + len(SAFE_PACKAGE_TRAILER), 'fixture', HAIRGRP_FILE))
        self.assertEqual([len(row) for row in decoded['records']], [PAIR_TABLE_STYLE_COUNT] * PAIR_TABLE_ROW_COUNT)
        self.assertEqual(decoded['records'][0][0], [0, 1])
        self.assertEqual(decoded['records'][14][14], [448, 449])
        self.assertEqual(decoded['sourceSha256'], self.client_access.lock.record(HAIRGRP_FILE)['eSha256'])

    def test_one_byte_short_is_hair_layout_undecoded(self):
        payload = synthetic_pair_table_payload()
        with self.assertRaises(HairTableUndecodedError) as raised:
            self.decode_with_payload('hairgrp', payload[:PAIR_TABLE_WORD_COUNT * 4 - 1] + SAFE_PACKAGE_TRAILER)
        self.assertEqual((raised.exception.table, raised.exception.reason), ('hairgrp', HAIR_LAYOUT_UNDECODED_REASON))

    def test_missing_trailer_is_hair_layout_undecoded(self):
        with self.assertRaises(HairTableUndecodedError) as raised:
            self.decode_with_payload('hairgrp', synthetic_pair_table_payload()[:-1] + b'\x01')
        self.assertEqual(raised.exception.reason, HAIR_LAYOUT_UNDECODED_REASON)

    def test_converted_hairgrp_is_an_elbera_adapter_manifest_with_the_proof_label_in_its_receipt(self):
        result = self.convert_with_payload('hairgrp', synthetic_pair_table_payload())
        self.assertEqual((result['status'], result['recordCount']), ('decoded', PAIR_TABLE_ROW_COUNT))
        [record] = self.tables_records()
        manifest = json.loads((self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes())
        self.assertEqual((manifest['kind'], manifest['route'], manifest['descriptorSha256'], manifest['sourcePath'], manifest['recordCount']),
                         ('native-table', ELBERA_ADAPTER_ROUTE, ELBERA_HAIR_SELECTION_SCRIPT_SHA256, HAIRGRP_FILE, PAIR_TABLE_ROW_COUNT))
        self.assertEqual(manifest['records'][0][1], [2, 3])
        config = self.receipt('hairgrp')['config']
        self.assertEqual((config['route'], config['fieldProof'], config['elberaScriptSha256']),
                         (ELBERA_ADAPTER_ROUTE, ELBERA_HAIR_FIELD_PROOF, ELBERA_HAIR_SELECTION_SCRIPT_SHA256))

    def test_converted_short_hairgrp_is_a_hair_layout_undecoded_gap_row_without_a_manifest(self):
        result = self.convert_with_payload('hairgrp', synthetic_pair_table_payload()[1:])
        self.assertEqual(result, {'unit': 'table:hairgrp', 'status': 'gap', 'reason': HAIR_LAYOUT_UNDECODED_REASON})
        [gap_row] = read_gap_rows(self.project_root, 'data-ui')
        self.assertEqual((gap_row['key'], gap_row['reason'], gap_row['sourceIdentity']['path']),
                         ('table:hairgrp', HAIR_LAYOUT_UNDECODED_REASON, HAIRGRP_FILE))
        self.assertFalse((self.output_root / 'tables').exists())
        self.assertEqual(self.receipt('hairgrp')['config']['fieldProof'], ELBERA_HAIR_FIELD_PROOF)


def synthetic_keyed_table_payload(keys, declared_count=None):
    count = len(keys) if declared_count is None else declared_count
    records = b''.join(struct.pack('<i', key) + struct.pack(f'<{PAIR_TABLE_WORD_COUNT}i', *([key] * PAIR_TABLE_WORD_COUNT)) for key in keys)
    return struct.pack('<I', count) + records + SAFE_PACKAGE_TRAILER


@unittest.skipUnless(ELBERA_SCRIPT_AVAILABLE, ELBERA_UNAVAILABLE_REASON)
class KeyedHairTableTests(SyntheticHairClientTestCase):
    hair_files = (HELMETGRP_FILE, HAIRACCESSARYGRP_FILE)

    def test_duplicate_keys_stay_two_records_in_file_order(self):
        decoded = self.decode_with_payload('helmetgrp', synthetic_keyed_table_payload([7, 7]))
        self.assertEqual([record['key'] for record in decoded['records']], [7, 7])
        self.assertEqual(decoded['recordCount'], 2)
        self.assertEqual([len(record['pairs']) for record in decoded['records']], [PAIR_TABLE_ROW_COUNT, PAIR_TABLE_ROW_COUNT])
        self.assertEqual(decoded['records'][1]['pairs'][14][14], [7, 7])

    def test_file_order_is_kept_for_distinct_keys(self):
        decoded = self.decode_with_payload('hairaccessarygrp', synthetic_keyed_table_payload([9, -1, 3]))
        self.assertEqual([record['key'] for record in decoded['records']], [9, -1, 3])
        self.assertEqual(decoded['records'][1]['pairs'][0][0], [-1, -1])

    def test_record_count_equals_the_count_header(self):
        for keys in ([], [5], [1, 2, 3, 4]):
            with self.subTest(keys=keys):
                payload = synthetic_keyed_table_payload(keys)
                self.assertEqual(struct.unpack_from('<I', payload)[0], len(keys))
                self.assertEqual(self.decode_with_payload('helmetgrp', payload)['recordCount'], len(keys))

    def test_a_size_that_disagrees_with_the_count_names_the_table_gap_reason(self):
        expectations = {'helmetgrp': HELMET_LAYOUT_UNDECODED_REASON, 'hairaccessarygrp': HAIR_LAYOUT_UNDECODED_REASON}
        for table, reason in expectations.items():
            for payload in (synthetic_keyed_table_payload([7, 7], declared_count=3), synthetic_keyed_table_payload([7], declared_count=0)):
                with self.subTest(table=table), self.assertRaises(HairTableUndecodedError) as raised:
                    self.decode_with_payload(table, payload)
                self.assertEqual((raised.exception.table, raised.exception.reason), (table, reason))

    def test_a_converted_keyed_table_with_a_bad_count_is_a_gap_row_with_its_reason(self):
        result = self.convert_with_payload('helmetgrp', synthetic_keyed_table_payload([7], declared_count=2))
        self.assertEqual(result, {'unit': 'table:helmetgrp', 'status': 'gap', 'reason': HELMET_LAYOUT_UNDECODED_REASON})
        [gap_row] = read_gap_rows(self.project_root, 'data-ui')
        self.assertEqual((gap_row['key'], gap_row['sourceIdentity']['path']), ('table:helmetgrp', HELMETGRP_FILE))

    def test_a_converted_keyed_table_keeps_duplicates_in_its_manifest(self):
        self.assertEqual(self.convert_with_payload('hairaccessarygrp', synthetic_keyed_table_payload([7, 7]))['recordCount'], 2)
        [record] = self.tables_records()
        manifest = json.loads((self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes())
        self.assertEqual(([entry['key'] for entry in manifest['records']], manifest['route']), ([7, 7], ELBERA_ADAPTER_ROUTE))


class HairTableNameTests(SyntheticHairClientTestCase):
    def test_a_table_without_an_elbera_parser_is_refused_before_any_read(self):
        with patch('data.hair_table_adapter.decode413', side_effect=AssertionError('decoded a table without a parser')):
            with self.assertRaisesRegex(HairTableAdapterError, 'chargrp has no Elbera hair table parser'):
                decode_hair_table(self.client_access, 'chargrp')

    def test_a_table_without_layout_or_parser_still_exits_naming_it(self):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), 'decode', DECODE_TABLE_ALGORITHM_VERSION)
        with self.assertRaisesRegex(convert_tables.ConvertTablesError, 'chargrp.dat has no Interlude descriptor layout and no Elbera'):
            convert_table_unit(self.project_root, self.client_access, 'chargrp', self.output_root, ledger, [])


class ElberaCallScanTests(unittest.TestCase):
    def setUp(self):
        self.source_text = ADAPTER_SOURCE_PATH.read_text(encoding='utf-8')
        self.tree = ast.parse(self.source_text)

    def test_the_elbera_module_is_used_only_through_the_two_pure_parsers(self):
        attributes = {node.attr for node in ast.walk(self.tree)
                      if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == ELBERA_MODULE_PARAMETER_NAME}
        self.assertEqual(attributes, ALLOWED_ELBERA_ATTRIBUTES)
        self.assertEqual(set(HAIR_TABLE_PARSERS.values()), ALLOWED_ELBERA_ATTRIBUTES)

    def test_the_elbera_module_never_escapes_into_another_call(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call):
                arguments = [*node.args, *(keyword.value for keyword in node.keywords)]
                passed_names = {argument.id for argument in arguments if isinstance(argument, ast.Name)}
                callee = node.func.id if isinstance(node.func, ast.Name) else None
                if ELBERA_MODULE_PARAMETER_NAME in passed_names:
                    self.assertEqual(callee, 'elbera_hair_table_parser')
        self.assertNotIn('getattr', {node.id for node in ast.walk(self.tree) if isinstance(node, ast.Name)})

    def test_no_engine_pinned_verifier_name_appears_in_the_adapter(self):
        names = {node.attr for node in ast.walk(self.tree) if isinstance(node, ast.Attribute)}
        constants = {node.value for node in ast.walk(self.tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        for refused_name in REFUSED_ELBERA_NAMES:
            self.assertNotIn(refused_name, names)
            self.assertNotIn(refused_name, constants)


def synthetic_layout_xml(*readers):
    nodes = ''.join(f'<node name="hairgrp_data{index}" reader="{reader}" />' for index, reader in enumerate(readers))
    return (f'<list><file pattern="Interlude" isSafePackage="true"><for name="hairgrp"><wrapper name="hairgrp">{nodes}'
            '</wrapper></for></file></list>').encode('utf-8')


class Int32VersusLayoutCrossCheckTests(unittest.TestCase):
    def test_one_agreeing_and_one_disagreeing_word_are_counted_with_the_disagreement_offset(self):
        payload = struct.pack('<II', 0x00000005, 0x00000105) + SAFE_PACKAGE_TRAILER
        layout_xml = synthetic_layout_xml('UCHAR', 'UCHAR')
        result = hair_table_int32_versus_layout_cross_check(payload, layout_xml)
        self.assertEqual(result, {'declaredReader': 'UCHAR', 'layoutSchema': 'dats/hairgrp.xml',
                                  'layoutSha256': hashlib.sha256(layout_xml).hexdigest(), 'wordCount': 2,
                                  'agreementCount': 1, 'disagreementCount': 1, 'firstDisagreementOffsets': [4]})

    def test_a_negative_word_disagrees_with_its_unsigned_byte(self):
        result = hair_table_int32_versus_layout_cross_check(struct.pack('<ii', -1, 0) + SAFE_PACKAGE_TRAILER, synthetic_layout_xml('UCHAR'))
        self.assertEqual((result['agreementCount'], result['firstDisagreementOffsets']), (1, [0]))

    def test_disagreement_offsets_stop_at_the_listing_limit(self):
        words = [0x100] * (FIRST_DISAGREEMENT_OFFSET_LIMIT + 3)
        result = hair_table_int32_versus_layout_cross_check(struct.pack(f'<{len(words)}I', *words) + SAFE_PACKAGE_TRAILER,
                                                            synthetic_layout_xml('UCHAR'))
        self.assertEqual(result['disagreementCount'], len(words))
        self.assertEqual(result['firstDisagreementOffsets'], [index * 4 for index in range(FIRST_DISAGREEMENT_OFFSET_LIMIT)])

    def test_a_layout_with_mixed_readers_or_bytes_without_whole_words_are_refused(self):
        with self.assertRaisesRegex(HairTableAdapterError, 'expected exactly one'):
            hair_table_int32_versus_layout_cross_check(struct.pack('<I', 5) + SAFE_PACKAGE_TRAILER, synthetic_layout_xml('UCHAR', 'INT'))
        with self.assertRaisesRegex(HairTableAdapterError, 'not whole int32 words'):
            hair_table_int32_versus_layout_cross_check(b'\x05\x00\x00' + SAFE_PACKAGE_TRAILER, synthetic_layout_xml('UCHAR'))
        with self.assertRaisesRegex(HairTableAdapterError, 'not whole int32 words'):
            hair_table_int32_versus_layout_cross_check(struct.pack('<I', 5), synthetic_layout_xml('UCHAR'))

    @unittest.skipUnless((SCHEMA_ROOT / 'dats' / 'hairgrp.xml').is_file(), 'pinned dat schema unavailable in .assets/native-tools')
    def test_the_pinned_local_layout_declares_one_uchar_reader(self):
        self.assertEqual(declared_layout_reader(hairgrp_layout_xml_bytes()), 'UCHAR')


class DdfCrossCheckTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.client_root = base / 'conversion'
        self.flat_ddf_path = self.client_root / INTERLUDE_DDF_PATHS['hairgrp']
        self.nested_ddf_path = self.client_root / NESTED_HAIRGRP_DDF_PATH
        for path in (self.flat_ddf_path, self.nested_ddf_path):
            path.parent.mkdir(parents=True)
            path.write_bytes(SYNTHETIC_DDF_TEXT.encode('ascii'))
        engine_library = write_synthetic_engine_library(self.client_root)
        nested_record = equal_lock_record(self.nested_ddf_path)
        use_synthetic_reference_client_lock(self, base / 'importa', {
            ENGINE_LIBRARY_RELATIVE_PATH: equal_lock_record(engine_library),
            INTERLUDE_DDF_PATHS['hairgrp']: equal_lock_record(self.flat_ddf_path),
            NESTED_HAIRGRP_DDF_PATH: ['e-only', None, None, *nested_record[3:]]})
        self.client_access = require_reference_client(self.client_root)

    def test_a_readable_flat_ddf_is_compared_with_the_elbera_pair_structure(self):
        result = hair_table_ddf_cross_check(self.client_access, 'hairgrp', [[[0, 1]], [[2, 3]]])
        self.assertEqual(result['status'], DDF_CROSS_CHECK_COMPARED_STATUS)
        self.assertEqual((result['ddfPath'], result['ddfRecordCount'], result['ddfFieldCount'], result['ddfFieldTypes']),
                         (INTERLUDE_DDF_PATHS['hairgrp'], 2, 2, ['CHAR']))
        self.assertEqual((result['elberaRowCount'], result['elberaInt32WordsPerRow'], result['recordCountAgrees'], result['fieldCountAgrees']),
                         (2, 2, True, True))
        self.assertEqual(result['ddfHeader'], {'FS': '"\\t"', 'RECCNT': '2'})
        self.assertEqual(result['ddfSha256'], hashlib.sha256(SYNTHETIC_DDF_TEXT.encode('ascii')).hexdigest())

    def test_an_unparseable_ddf_is_unresolved_with_no_layout(self):
        for ddf_text in ('RECCNT = 15;\n{\n\tCHAR m0_a0;\n\tif (x) CHAR m0_b0;\n}\n', 'RECCNT = many;\n{\n\tCHAR m0_a0;\n}\n',
                         'RECCNT = 15;\n{\n}\n', 'RECCNT = 15;\nCHAR m0_a0;\n', 'RECCNT = 15;\n{\n\tCHAR a;\n\tCHAR a;\n}\n'):
            with self.subTest(ddf_text=ddf_text):
                self.flat_ddf_path.write_bytes(ddf_text.encode('ascii'))
                use_synthetic_reference_client_lock(self, self.client_root.parent / 'importa', {
                    ENGINE_LIBRARY_RELATIVE_PATH: equal_lock_record(self.client_root / ENGINE_LIBRARY_RELATIVE_PATH),
                    INTERLUDE_DDF_PATHS['hairgrp']: equal_lock_record(self.flat_ddf_path)})
                result = hair_table_ddf_cross_check(require_reference_client(self.client_root), 'hairgrp', [[[0, 1]]])
                self.assertEqual(result['status'], DDF_CROSS_CHECK_UNRESOLVED_STATUS)
                self.assertEqual(sorted(result), ['ddfPath', 'ddfSha256', 'reason', 'status', 'table'])

    def test_the_nested_e_only_copy_is_refused_by_the_guard(self):
        self.assertFalse(INTERLUDE_DDF_PATHS['hairgrp'].startswith('L2FileEdit-master/L2FileEdit-master/'))
        with self.assertRaisesRegex(ReferenceClientLockError, 'lock class of .* is e-only, not equal'):
            self.client_access.require_equal_file(NESTED_HAIRGRP_DDF_PATH)

    def test_the_keyed_tables_have_no_interlude_ddf_and_say_so(self):
        for table in ('helmetgrp', 'hairaccessarygrp'):
            result = hair_table_ddf_cross_check(self.client_access, table, None)
            self.assertEqual((result['table'], result['status']), (table, NO_INTERLUDE_DDF_STATUS))


@unittest.skipUnless(ELBERA_SCRIPT_AVAILABLE and REAL_CLIENT_ROOT.is_dir() and (SCHEMA_ROOT / 'dats' / 'hairgrp.xml').is_file(),
                     'lock-equal conversion client, Elbera checkout or pinned dat schema unavailable')
class RealHairgrpCrossCheckTests(unittest.TestCase):
    def test_real_hairgrp_cross_checks_cover_every_word_and_the_flat_ddf(self):
        result = hairgrp_cross_checks(require_reference_client(REAL_CLIENT_ROOT))
        ddf = result['ddf']['hairgrp']
        self.assertEqual((result['fieldProof'], ddf['status'], ddf['ddfPath']),
                         (ELBERA_HAIR_FIELD_PROOF, DDF_CROSS_CHECK_COMPARED_STATUS, INTERLUDE_DDF_PATHS['hairgrp']))
        layout_check = result['int32VersusLayout']
        self.assertEqual(layout_check['wordCount'], ddf['elberaRowCount'] * ddf['elberaInt32WordsPerRow'])
        self.assertEqual(layout_check['agreementCount'] + layout_check['disagreementCount'], layout_check['wordCount'])
        self.assertEqual({result['ddf'][table]['status'] for table in ('helmetgrp', 'hairaccessarygrp')}, {NO_INTERLUDE_DDF_STATUS})


class InventoryElberaRouteCountTests(unittest.TestCase):
    row = {'table': 'hairgrp', 'file': 'hairgrp.dat', 'route': 'elbera'}
    source_sha256 = 'a' * 64
    statuses = {'hairgrp': ELBERA_PARSER_PRESENT_STATUS}

    def decoded_records(self, source_sha256):
        return {'hairgrp': {'id': 'hairgrp', 'recordCount': PAIR_TABLE_ROW_COUNT, 'sourceSha256': source_sha256}}

    def gap_rows(self, source_sha256):
        return {'table:hairgrp': {'key': 'table:hairgrp', 'reason': HAIR_LAYOUT_UNDECODED_REASON,
                                  'sourceIdentity': {'path': HAIRGRP_FILE, 'sha256': source_sha256}}}

    def test_a_sealed_record_of_the_locked_source_carries_its_count_and_the_proof_label(self):
        counted = count_elbera_route_table(self.row, self.statuses, self.source_sha256, self.decoded_records(self.source_sha256), {})
        self.assertEqual(counted, {'recordCount': PAIR_TABLE_ROW_COUNT, 'countSource': f'{ELBERA_ADAPTER_COUNT_SOURCE}system/hairgrp.dat',
                                   'status': ELBERA_ADAPTER_DECODED_STATUS})
        self.assertTrue(counted['status'].endswith(ELBERA_HAIR_FIELD_PROOF))
        self.assertEqual(ELBERA_ADAPTER_DECODED_STATUS, 'decoded by Elbera adapter, Elbera 07b24 proof, unverified on 4dd2')

    def test_an_undecoded_gap_of_the_locked_source_names_its_reason(self):
        counted = count_elbera_route_table(self.row, self.statuses, self.source_sha256, {}, self.gap_rows(self.source_sha256))
        self.assertEqual(counted, {'recordCount': 'unknown', 'countSource': None, 'status': HAIR_LAYOUT_UNDECODED_REASON})

    def test_a_record_or_gap_of_another_source_keeps_the_parser_presence_status(self):
        counted = count_elbera_route_table(self.row, self.statuses, self.source_sha256, self.decoded_records('b' * 64), self.gap_rows('b' * 64))
        self.assertEqual(counted['status'], ELBERA_PARSER_PRESENT_STATUS)
        not_equal = count_elbera_route_table(self.row, self.statuses, None, self.decoded_records(self.source_sha256), {})
        self.assertEqual(not_equal['recordCount'], 'unknown')


if __name__ == '__main__':
    unittest.main()
