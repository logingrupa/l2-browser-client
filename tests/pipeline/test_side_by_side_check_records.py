from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.side_by_side_check_records import (COMPUTED_UNVERIFIED_REASONS, STORED_UNVERIFIED_REASONS, SideBySideCheckRecordError,
                                                     read_side_by_side_records, side_by_side_checks_path, write_side_by_side_records)
from side_by_side_fixture import unverified_tile_record

WORLD_PART = 'world'


class SideBySideRecordsTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()

    def write_document(self, part, document):
        path = side_by_side_checks_path(self.project_root, part)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document), encoding='utf-8')
        return path

    def assert_write_refused(self, part, records, message_fragment):
        with self.assertRaisesRegex(SideBySideCheckRecordError, message_fragment):
            write_side_by_side_records(self.project_root, part, records)
        self.assertFalse(side_by_side_checks_path(self.project_root, part).exists())


class SideBySideRecordDocumentTest(SideBySideRecordsTestCase):
    def test_reasons_split_into_seven_stored_and_six_computed(self):
        self.assertEqual(len(STORED_UNVERIFIED_REASONS), 7)
        self.assertEqual(len(COMPUTED_UNVERIFIED_REASONS), 6)
        self.assertFalse(set(STORED_UNVERIFIED_REASONS) & set(COMPUTED_UNVERIFIED_REASONS))

    def test_absent_document_reads_as_no_records(self):
        self.assertEqual(read_side_by_side_records(self.project_root, WORLD_PART), [])

    def test_path_accepts_only_coverage_parts(self):
        self.assertEqual(side_by_side_checks_path(self.project_root, WORLD_PART),
                         self.project_root / 'docs' / 'parts' / 'world' / 'side-by-side-checks.json')
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'part must be one of'):
            side_by_side_checks_path(self.project_root, '../world')

    def test_written_records_read_back_sorted_and_rewrite_byte_identical(self):
        records = [unverified_tile_record('tile:21_20'), unverified_tile_record('tile:20_20')]
        document = write_side_by_side_records(self.project_root, WORLD_PART, records)
        path = side_by_side_checks_path(self.project_root, WORLD_PART)
        first_bytes = path.read_bytes()
        self.assertEqual([record['key'] for record in document['records']], ['tile:20_20', 'tile:21_20'])
        self.assertEqual(read_side_by_side_records(self.project_root, WORLD_PART), document['records'])
        write_side_by_side_records(self.project_root, WORLD_PART, read_side_by_side_records(self.project_root, WORLD_PART))
        self.assertEqual(path.read_bytes(), first_bytes)
        self.assertTrue(first_bytes.endswith(b'\n'))

    def test_unknown_record_field_is_refused(self):
        record = {**unverified_tile_record(), 'note': 'looks right'}
        self.assert_write_refused(WORLD_PART, [record], r"record 'tile:20_20' of part world record must hold exactly")

    def test_unsorted_records_in_a_document_are_refused(self):
        self.write_document(WORLD_PART, {'schemaVersion': 1, 'part': WORLD_PART,
                                         'records': [unverified_tile_record('tile:21_20'), unverified_tile_record('tile:20_20')]})
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'must be sorted by identity'):
            read_side_by_side_records(self.project_root, WORLD_PART)

    def test_repeated_record_in_a_document_is_refused(self):
        self.write_document(WORLD_PART, {'schemaVersion': 1, 'part': WORLD_PART,
                                         'records': [unverified_tile_record(), unverified_tile_record()]})
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'repeats a record identity'):
            read_side_by_side_records(self.project_root, WORLD_PART)

    def test_duplicate_json_key_and_non_finite_number_are_refused(self):
        path = side_by_side_checks_path(self.project_root, WORLD_PART)
        path.parent.mkdir(parents=True, exist_ok=True)
        for payload in ('{"schemaVersion": 1, "schemaVersion": 1, "part": "world", "records": []}',
                        '{"schemaVersion": NaN, "part": "world", "records": []}'):
            path.write_text(payload, encoding='utf-8')
            with self.assertRaisesRegex(SideBySideCheckRecordError, 'not strict JSON'):
                read_side_by_side_records(self.project_root, WORLD_PART)

    def test_reason_outside_the_stored_list_is_refused(self):
        self.assert_write_refused(WORLD_PART, [unverified_tile_record() | {'reason': 'looks-fine'}], 'unverified reason must be one of')

    def test_computed_reason_is_never_stored(self):
        for reason in COMPUTED_UNVERIFIED_REASONS:
            with self.subTest(reason=reason):
                self.assert_write_refused(WORLD_PART, [unverified_tile_record() | {'reason': reason}], 'computed by the report')

    def test_sandbox_half_capture_identity_and_hashes_are_checked(self):
        cases = (({'capturedBy': 'executor:02-01'}, 'capturedBy must match'),
                 ({'capturedAtRiga': '2026-11-11 09:00'}, 'capturedAtRiga must be ISO 8601'),
                 ({'pngSha256': 'D' * 64}, 'pngSha256 must be 64 lowercase hex'),
                 ({'viewport': {'width': 0, 'height': 900}}, 'viewport width and height must be positive integers'))
        for changes, message_fragment in cases:
            with self.subTest(changes=changes):
                record = unverified_tile_record()
                record['sandboxHalf'].update(changes)
                self.assert_write_refused(WORLD_PART, [record], message_fragment)


if __name__ == '__main__':
    unittest.main()
