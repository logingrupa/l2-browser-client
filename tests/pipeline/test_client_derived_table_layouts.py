import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
import convert_tables
from convert_tables import DECODE_TABLE_ALGORITHM_VERSION, convert_table_unit
from native_catalog import tables
from native_catalog.table_layout_pins import CLIENT_DERIVED_LAYOUTS, SCHEMA_HASHES, TABLES
from native_catalog.tables import CRYPTO_SOURCE, SAFE_PACKAGE_TRAILER, SCHEMA_ROOT, checked_bytes, decode_table, interlude_descriptor_links
from native_catalog.ue2 import FormatError
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH, read_reference_client_lock, require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root

COMMITTED_REFERENCE_CLIENT_LOCK_PATH = ROOT / 'recipes' / 'reference-client-tree.lock.json'
EULA_FILE = 'system/eula-e.dat'
EULA_LAYOUT_FILE = 'recipes/data/table-layouts/eula.xml'


def ansi_unreal_string(text):
    raw = text.encode('ascii') + b'\0'
    return bytes([len(raw)]) + raw


def wide_unreal_string(text):
    raw = (text + '\0').encode('utf-16le')
    return bytes([0x80 | len(raw) // 2]) + raw


def synthetic_eula_payload(*unreal_strings):
    return b''.join(unreal_strings) + SAFE_PACKAGE_TRAILER


class ClientDerivedLayoutPinTests(unittest.TestCase):
    def test_every_client_derived_layout_file_matches_its_pin_byte_for_byte(self):
        for name, client_derived_layout in CLIENT_DERIVED_LAYOUTS.items():
            with self.subTest(layout=name):
                checked_bytes(ROOT / client_derived_layout['file'], client_derived_layout['sha256'])
                self.assertNotIn(b'\r\n', (ROOT / client_derived_layout['file']).read_bytes())
                self.assertNotIn(f'dats/{name}.xml', SCHEMA_HASHES)
                self.assertIn(name, TABLES)

    def test_every_client_derived_layout_names_the_locked_engine_library(self):
        engine_record = read_reference_client_lock(COMMITTED_REFERENCE_CLIENT_LOCK_PATH).record(ENGINE_LIBRARY_RELATIVE_PATH)
        for name, client_derived_layout in CLIENT_DERIVED_LAYOUTS.items():
            with self.subTest(layout=name):
                self.assertEqual(client_derived_layout['evidence']['binary'].casefold(), ENGINE_LIBRARY_RELATIVE_PATH.casefold())
                self.assertEqual((engine_record['class'], client_derived_layout['evidence']['binarySha256']), ('equal', engine_record['eSha256']))


@unittest.skipUnless(SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'pinned dat schema and open-l2encdec source unavailable in .assets/native-tools')
class ClientDerivedEulaLayoutTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.project_root = base / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.client_root = base / 'conversion'
        (self.client_root / 'system').mkdir(parents=True)
        (self.client_root / EULA_FILE).write_bytes(b'synthetic encrypted eula table')
        lock_client_as_checked_conversion_root(self, self.client_root, base / 'importa', [EULA_FILE])

    def decode_with_payload(self, payload):
        with patch('native_catalog.tables.decode413', return_value=('fixture', payload)):
            return decode_table(self.client_root, 'eula')

    def test_eula_layout_reads_the_three_fl2eula_strings_and_ends_at_the_safe_package_trailer(self):
        payload = synthetic_eula_payload(wide_unreal_string('Agreement “terms”\r\n'), ansi_unreal_string('\r\n'),
                                         ansi_unreal_string('\r\n'))
        decoded_table = self.decode_with_payload(payload)
        self.assertEqual(decoded_table['data'], {'eula': [{'eula': 'Agreement “terms”\r\n', 'eulatestserver': '\r\n',
                                                           'eulachinaspecialmessage': '\r\n'}]})
        self.assertEqual(decoded_table['consumedBytes'], len(payload) - len(SAFE_PACKAGE_TRAILER))
        self.assertEqual((decoded_table['schema']['file'], decoded_table['schema']['sha256']),
                         (EULA_LAYOUT_FILE, CLIENT_DERIVED_LAYOUTS['eula']['sha256']))
        self.assertEqual(decoded_table['schema']['clientLayoutEvidence'], CLIENT_DERIVED_LAYOUTS['eula']['evidence'])
        self.assertEqual(decoded_table['formatDefinitionPins'][EULA_LAYOUT_FILE], CLIENT_DERIVED_LAYOUTS['eula']['sha256'])

    def test_a_fourth_string_before_the_trailer_is_refused(self):
        payload = synthetic_eula_payload(*(ansi_unreal_string('\r\n') for _ in range(4)))
        with self.assertRaisesRegex(FormatError, 'Unexpected safe-package trailer: eula: 03'):
            self.decode_with_payload(payload)

    def test_a_tampered_client_derived_layout_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary_root:
            tampered_layout = Path(temporary_root) / EULA_LAYOUT_FILE
            tampered_layout.parent.mkdir(parents=True)
            tampered_layout.write_bytes((ROOT / EULA_LAYOUT_FILE).read_bytes().replace(b'eulatestserver', b'eulaRGB_TESTserver'))
            with patch.object(tables, 'REPOSITORY_ROOT', Path(temporary_root)):
                with self.assertRaisesRegex(FormatError, 'External format definition hash mismatch'):
                    self.decode_with_payload(synthetic_eula_payload(*(ansi_unreal_string('\r\n') for _ in range(3))))

    def test_the_eula_unit_is_decoded_with_the_client_derived_layout_hash_in_its_fingerprint(self):
        payload = synthetic_eula_payload(wide_unreal_string('Agreement\r\n'), ansi_unreal_string('\r\n'), ansi_unreal_string('\r\n'))
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), 'decode', DECODE_TABLE_ALGORITHM_VERSION)
        links = interlude_descriptor_links()
        _, config = convert_tables.table_unit_plan('eula-e', links)
        self.assertEqual(config['layoutSha256'], CLIENT_DERIVED_LAYOUTS['eula']['sha256'])
        with patch('native_catalog.tables.decode413', return_value=('fixture', payload)):
            result = convert_table_unit(self.project_root, require_reference_client(self.client_root), 'eula-e',
                                        lane_store_root(self.project_root, 'data-ui'), ledger, links)
        self.assertEqual((result['status'], result['recordCount']), ('decoded', 1))
        catalog = json.loads((lane_store_root(self.project_root, 'data-ui') / 'catalog.json').read_bytes())
        self.assertEqual([record['id'] for record in catalog['tables']], ['eula-e'])


if __name__ == '__main__':
    unittest.main()
