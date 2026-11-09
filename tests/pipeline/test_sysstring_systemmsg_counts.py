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
from sysstring_systemmsg_counts import (COUNT_CONFIRMED_VERDICT, COUNT_FIXED_VERDICT, COUNT_UNRESOLVED_VERDICT, DECODED_FACT_FIELDS,
                                        STRICT_COUNT_REPORT_PATH, StrictCountReportError, count_verdict, elbera_count_evidence,
                                        identifier_set_comparison, layout_record_list, strict_table_count_report,
                                        table_count_report_and_identifiers, validate_strict_count_report)
from native_catalog.tables import CRYPTO_SOURCE, SAFE_PACKAGE_TRAILER, SCHEMA_ROOT
from native_catalog.ue2 import FormatError
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root

COMMITTED_INVENTORY_PATH = ROOT / 'docs' / 'parts' / 'data' / 'dat-table-inventory.json'
SYSSTRING_FILE = 'system/sysstring-e.dat'
LARGEST_UINT = 4294967295


def synthetic_sysstring_payload(identifiers):
    rows = b''.join(struct.pack('<I', identifier) + bytes([2]) + b'x\0' for identifier in identifiers)
    return struct.pack('<I', len(identifiers)) + rows + SAFE_PACKAGE_TRAILER


@unittest.skipUnless(SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'pinned dat schema and open-l2encdec source unavailable in .assets/native-tools')
class StrictTableCountReportTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        client_root = base / 'conversion'
        (client_root / 'system').mkdir(parents=True)
        (client_root / SYSSTRING_FILE).write_bytes(b'synthetic encrypted sysstring table')
        lock_client_as_checked_conversion_root(self, client_root, base / 'importa', [SYSSTRING_FILE])
        self.client_access = require_reference_client(client_root)

    def report_for_payload(self, payload, identifier_field='stringID'):
        with patch('native_catalog.tables.decode413', return_value=('fixture', payload)):
            return strict_table_count_report(self.client_access, 'sysstring-e', identifier_field)

    def test_identifier_fields_come_from_the_pinned_layouts(self):
        self.assertEqual(tuple(layout_record_list('sysstring')), ('data', 'string', 'stringID'))
        self.assertEqual(tuple(layout_record_list('systemmsg')), ('data', 'msg', 'id'))

    def test_duplicate_and_missing_identifiers_are_counted_exactly(self):
        payload = synthetic_sysstring_payload([1, 2, 4, 4])
        report = self.report_for_payload(payload)
        self.assertEqual({field: report[field] for field in ('declaredCount', 'decodedRecordCount', 'distinctIdCount', 'duplicateIdCount',
                                                             'minimumId', 'maximumId', 'missingIdCountInRange', 'exactEnd')},
                         {'declaredCount': 4, 'decodedRecordCount': 4, 'distinctIdCount': 3, 'duplicateIdCount': 1,
                          'minimumId': 1, 'maximumId': 4, 'missingIdCountInRange': 1, 'exactEnd': True})
        self.assertEqual(report['consumedBytes'] + len(SAFE_PACKAGE_TRAILER), report['decodedBytes'])
        self.assertEqual((report['sourcePath'], report['layout'], report['identifierField']), (SYSSTRING_FILE, 'sysstring', 'stringID'))

    def test_a_payload_one_byte_short_or_long_fails(self):
        payload = synthetic_sysstring_payload([1, 2, 4, 4])
        for malformed in (payload[:-1], payload + b'\0'):
            with self.subTest(length=len(malformed)), self.assertRaises(FormatError):
                self.report_for_payload(malformed)

    def test_the_largest_unsigned_identifier_is_reported_exactly(self):
        report = self.report_for_payload(synthetic_sysstring_payload([0, LARGEST_UINT]))
        self.assertEqual((report['minimumId'], report['maximumId']), (0, LARGEST_UINT))
        self.assertIs(type(report['maximumId']), int)
        self.assertEqual(report['missingIdCountInRange'], LARGEST_UINT - 1)

    def test_an_identifier_field_absent_from_the_rows_is_refused(self):
        with self.assertRaisesRegex(StrictCountReportError, 'no identifier field id'):
            self.report_for_payload(synthetic_sysstring_payload([1]), 'id')


    def test_a_failed_strict_decode_is_reported_with_its_header_count_and_no_decoded_facts(self):
        unterminated_payload = struct.pack('<II', 3, 7) + bytes([2]) + b'ab' + SAFE_PACKAGE_TRAILER
        with patch('native_catalog.tables.decode413', return_value=('fixture', unterminated_payload)), \
                patch('sysstring_systemmsg_counts.decode413', return_value=('fixture', unterminated_payload)):
            report, identifiers = table_count_report_and_identifiers(self.client_access, 'sysstring-e')
        self.assertEqual((report['declaredCount'], report['decodeStatus'], report['decodeError']),
                         (3, 'decode-failed:FormatError', 'Unterminated Unreal string'))
        self.assertTrue(all(report[field] is None for field in DECODED_FACT_FIELDS))
        self.assertEqual(report['sourcePath'], SYSSTRING_FILE)
        self.assertIsNone(identifiers)


class CountVerdictTests(unittest.TestCase):
    def test_verdict_follows_only_from_the_decoded_counts(self):
        evidence = elbera_count_evidence()
        decoded, failed = {'decodeStatus': 'decoded'}, {'decodeStatus': 'decode-failed:FormatError', 'decodedRecordCount': None}
        matching = [dict(decoded, decodedRecordCount=evidence['count']), dict(decoded, decodedRecordCount=evidence['count'])]
        differing = [dict(decoded, decodedRecordCount=evidence['count']), dict(decoded, decodedRecordCount=evidence['count'] + 1)]
        self.assertEqual(count_verdict(matching, evidence), COUNT_CONFIRMED_VERDICT)
        self.assertEqual(count_verdict(differing, evidence), COUNT_FIXED_VERDICT)
        self.assertEqual(count_verdict([failed, matching[1]], evidence), COUNT_UNRESOLVED_VERDICT)

    def test_identifier_set_comparison_counts_each_side_or_stays_empty_without_both_decodes(self):
        self.assertEqual(identifier_set_comparison([1, 2, 3], [2, 3, 4, 5]),
                         {'idSetsEqual': False, 'sharedIdCount': 2, 'onlyInSysstringCount': 1, 'onlyInSystemmsgCount': 2})
        self.assertEqual(set(identifier_set_comparison(None, [1]).values()), {None})


class CommittedStrictCountReportTests(unittest.TestCase):
    def setUp(self):
        self.report = json.loads(STRICT_COUNT_REPORT_PATH.read_bytes())

    def test_committed_report_validates(self):
        validate_strict_count_report(self.report)

    def test_inventory_rows_agree_with_the_strict_decodes(self):
        inventory_rows = {row['table']: row for row in json.loads(COMMITTED_INVENTORY_PATH.read_bytes())['rows']}
        for table_report in self.report['tables']:
            with self.subTest(table=table_report['table']):
                row = inventory_rows[table_report['table']]
                if table_report['decodeStatus'] == 'decoded':
                    self.assertEqual((row['route'], row['recordCount']), ('local-decoded', table_report['decodedRecordCount']))
                else:
                    self.assertEqual((row['route'], row['status']), ('local-layout-only', table_report['decodeStatus']))

    def test_a_verdict_that_does_not_follow_from_the_counts_is_refused(self):
        tampered = dict(self.report, verdict=COUNT_FIXED_VERDICT if self.report['verdict'] != COUNT_FIXED_VERDICT else COUNT_CONFIRMED_VERDICT)
        with self.assertRaisesRegex(StrictCountReportError, 'does not follow from the decoded counts'):
            validate_strict_count_report(tampered)


if __name__ == '__main__':
    unittest.main()
