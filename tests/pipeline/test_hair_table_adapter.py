import ast
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
from data.hair_table_adapter import (ELBERA_HAIR_FIELD_PROOF, ELBERA_HAIR_SELECTION_SCRIPT_PATH, ELBERA_HAIR_SELECTION_SCRIPT_SHA256,
                                     HAIR_LAYOUT_UNDECODED_REASON, HAIR_TABLE_PARSERS, HairTableAdapterError, HairTableUndecodedError,
                                     decode_hair_table)
from data.pinned_elbera_module import ELBERA_ROOT, load_pinned_elbera_module
from native_catalog.tables import SAFE_PACKAGE_TRAILER
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root

ADAPTER_SOURCE_PATH = ROOT / 'scripts' / 'data' / 'hair_table_adapter.py'
ELBERA_SCRIPT_AVAILABLE = (ELBERA_ROOT / ELBERA_HAIR_SELECTION_SCRIPT_PATH).is_file()
ELBERA_UNAVAILABLE_REASON = f'Elbera checkout with {ELBERA_HAIR_SELECTION_SCRIPT_PATH} unavailable at {ELBERA_ROOT.as_posix()}'
ELBERA_MODULE_PARAMETER_NAME = 'elbera_module'
ALLOWED_ELBERA_ATTRIBUTES = {'hair_pairs', 'keyed_hair_pairs'}
REFUSED_ELBERA_NAMES = ('verify', 'verify_material_native', 'audit_assets', 'main', '--check')
HAIRGRP_FILE = 'system/hairgrp.dat'
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
