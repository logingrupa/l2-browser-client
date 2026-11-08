import contextlib
import io
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
from convert_tables import (DECODE_TABLE_ALGORITHM_VERSION, LOCAL_DESCRIPTOR_ROUTE, convert_table_unit, descriptor_links,
                            native_table_manifest)
from native_catalog.tables import CRYPTO_SOURCE, SAFE_PACKAGE_TRAILER, SCHEMA_ROOT
from native_store.catalog_writer import TABLE_MANIFEST_PATH_PATTERN, validate_catalog_record
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root

NPCNAME_FILE = 'system/npcname-e.dat'
CP1252_UNDEFINED_BYTE = b'\x81'


def ascf(raw_text):
    raw = raw_text + b'\0' if raw_text else b''
    return bytes([len(raw)]) + raw


def synthetic_npcname_payload(rows):
    encoded_rows = b''.join(struct.pack('<I', identifier) + ascf(name) + ascf(b'') + bytes.fromhex('9ce8a9ff') for identifier, name in rows)
    return struct.pack('<I', len(rows)) + encoded_rows + SAFE_PACKAGE_TRAILER


@unittest.skipUnless(SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'pinned dat schema and open-l2encdec source unavailable in .assets/native-tools')
class ConvertTableUnitTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.project_root = base / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        client_root = base / 'conversion'
        (client_root / 'system').mkdir(parents=True)
        (client_root / NPCNAME_FILE).write_bytes(b'synthetic encrypted npcname table')
        lock_client_as_checked_conversion_root(self, client_root, base / 'importa', [NPCNAME_FILE])
        self.client_access = require_reference_client(client_root)
        self.output_root = lane_store_root(self.project_root, 'data-ui')
        self.catalog_path = self.output_root / 'catalog.json'
        self.links = descriptor_links()

    def new_ledger(self):
        return UnitLedger(lane_work_root(self.project_root, 'data-ui'), 'decode', DECODE_TABLE_ALGORITHM_VERSION)

    def convert_with_payload(self, payload):
        with patch('native_catalog.tables.decode413', return_value=('fixture', payload)):
            return convert_table_unit(self.project_root, self.client_access, 'npcname-e', self.output_root, self.new_ledger(), self.links)

    def tables_records(self):
        return json.loads(self.catalog_path.read_bytes())['tables']

    def test_decoded_table_is_written_cataloged_and_sealed(self):
        result = self.convert_with_payload(synthetic_npcname_payload([(17, b'Same NAME'), (99, b'Other')]))
        self.assertEqual(result['status'], 'decoded')
        [record] = self.tables_records()
        validate_catalog_record('tables', record)
        match = TABLE_MANIFEST_PATH_PATTERN.fullmatch(record['manifest'])
        self.assertIsNotNone(match)
        self.assertEqual((match['id'], match['sha256'], record['recordCount']), ('npcname-e', record['manifestSha256'], 2))
        manifest = json.loads((self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes())
        self.assertEqual((manifest['kind'], manifest['schemaVersion'], manifest['route'], manifest['sourcePath']),
                         ('native-table', 1, LOCAL_DESCRIPTOR_ROUTE, NPCNAME_FILE))
        self.assertEqual([row['id'] for row in manifest['records']['npc']], [17, 99])
        self.assertEqual(manifest['sourceSha256'], record['sourceSha256'])
        seal_path = lane_work_root(self.project_root, 'data-ui') / 'table__npcname-e' / 'decode' / 'complete.json'
        self.assertTrue(seal_path.is_file())

    def test_rerun_of_a_sealed_table_skips_and_leaves_the_catalog_byte_identical(self):
        payload = synthetic_npcname_payload([(17, b'Same NAME')])
        self.convert_with_payload(payload)
        catalog_bytes = self.catalog_path.read_bytes()
        with patch.object(convert_tables, 'decode_table', side_effect=AssertionError('a sealed table must not be decoded again')):
            self.assertEqual(self.convert_with_payload(payload)['status'], 'skipped-sealed')
        self.assertEqual(self.catalog_path.read_bytes(), catalog_bytes)

    def test_undefined_cp1252_byte_becomes_a_decode_failed_gap_row_without_a_manifest(self):
        result = self.convert_with_payload(synthetic_npcname_payload([(17, b'Bad' + CP1252_UNDEFINED_BYTE)]))
        self.assertEqual(result, {'unit': 'table:npcname-e', 'status': 'gap', 'reason': 'decode-failed:UnicodeDecodeError'})
        [gap_row] = read_gap_rows(self.project_root, 'data-ui')
        self.assertEqual((gap_row['key'], gap_row['part'], gap_row['step'], gap_row['status'], gap_row['reason']),
                         ('table:npcname-e', 'data', 'decode', 'gap', 'decode-failed:UnicodeDecodeError'))
        self.assertEqual(gap_row['sourceIdentity']['path'], NPCNAME_FILE)
        self.assertEqual(gap_row['evidence'], 'work/table__npcname-e/decode/receipt.json')
        self.assertFalse((self.output_root / 'tables').exists())
        self.assertFalse(self.catalog_path.exists())
        receipt = json.loads((self.project_root / 'artifacts/lane-store/data-ui' / gap_row['evidence']).read_bytes())
        self.assertEqual(receipt['gapRows'], [gap_row])
        self.assertEqual(self.convert_with_payload(b'')['status'], 'skipped-sealed')

    def test_format_error_becomes_a_decode_failed_gap_row(self):
        result = self.convert_with_payload(synthetic_npcname_payload([(17, b'Name')])[:-1])
        self.assertEqual(result['reason'], 'decode-failed:FormatError')

    def test_zero_record_table_keeps_record_count_zero(self):
        self.convert_with_payload(synthetic_npcname_payload([]))
        self.assertEqual([record['recordCount'] for record in self.tables_records()], [0])

    def test_manifest_records_are_the_decoded_data_unchanged_in_source_order(self):
        decoded_table = {'source': NPCNAME_FILE, 'sourceSha256': 'a' * 64, 'schema': {'descriptorSha256': 'b' * 64},
                         'data': {'data': 2, 'npc': [{'id': 99}, {'id': 17}]}}
        manifest = native_table_manifest('npcname-e', decoded_table, LOCAL_DESCRIPTOR_ROUTE)
        self.assertIs(manifest['records'], decoded_table['data'])
        self.assertEqual(manifest['recordCount'], 2)


class ConvertTablesOutputGuardTests(unittest.TestCase):
    def test_output_under_public_l2_is_refused_before_any_other_work(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_root = Path(temporary_directory).resolve()
            (project_root / 'artifacts').mkdir()
            (project_root / 'public' / 'l2').mkdir(parents=True)
            error_output = io.StringIO()
            with patch.object(convert_tables, 'REPOSITORY_ROOT', project_root), \
                    patch.object(convert_tables, 'require_reference_client', side_effect=AssertionError('client read before the guard')), \
                    contextlib.redirect_stderr(error_output):
                exit_code = convert_tables.main(['--client', 'E:/Lineage2-client', '--output', str(project_root / 'public' / 'l2'),
                                                 '--table', 'npcname-e'])
            self.assertEqual(exit_code, 1)
            self.assertIn('converter output must be a dedicated folder under', error_output.getvalue())
            self.assertEqual(sorted(path.name for path in project_root.rglob('*')), ['artifacts', 'l2', 'public'])


if __name__ == '__main__':
    unittest.main()
