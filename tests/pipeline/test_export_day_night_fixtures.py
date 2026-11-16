import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world import export_day_night_fixtures
from world.export_day_night_fixtures import DAY_NIGHT_REPORT_SHA256, DayNightFixtureError, export_day_night_fixtures as export_fixtures

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'day-night-db4-fixtures.json'
FIXTURES_FILE_SHA256 = '89d83263c38deeb5c8df1589e320da6ec916e192f3a89f737cd672778363cc83'
SYNTHETIC_FIXTURE = {'hour': 6, 'environmentType': 0, 'consumer': 'SkyBoxColor', 'value': [81, 75, 146], 'format': 'RGB bytes',
                     'nativeFunction': '0x105171c0', 'status': 'proven-synthetic', 'claimIds': ['fixtures-native'], 'scope': 'steady'}
SYNTHETIC_TABLE = {'environmentType': 0, 'section': 'SkyBoxColor', 'num': 1, 'rows': [{'key': 'COLOR1', 'replay': {}}], 'packedHex': '0000000028314600'}


class CommittedDayNightFixturesTests(unittest.TestCase):
    def test_the_committed_fixture_file_holds_the_336_db4_rows_from_the_pinned_report(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual(document['source']['reportSha256'], DAY_NIGHT_REPORT_SHA256)
        self.assertEqual(len(document['fixtures']), 336)
        self.assertEqual(document['fixtures'][0], {**document['fixtures'][0], 'hour': 0, 'environmentType': 0, 'consumer': 'SkyBoxColor',
                                                   'value': [40, 49, 70]})


class ExportDayNightFixturesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name).resolve()
        self.fixtures_root = self.root / 'fixtures'
        self.loaded_tables = self.root / 'loaded-tables.json'
        self.loaded_tables.write_bytes(json.dumps([SYNTHETIC_TABLE] * 68).encode('utf-8'))
        self.report = self.root / 'day-night-cycle.json'
        loaded_tables_sha256 = hashlib.sha256(self.loaded_tables.read_bytes()).hexdigest()
        self.report.write_bytes(json.dumps({'question': 'DB-4', 'generatedAt': 'now', 'fixtures': [SYNTHETIC_FIXTURE] * 336,
                                            'outputFiles': [{'file': 'C:\\work\\loaded-tables.json', 'sha256': loaded_tables_sha256}]}).encode('utf-8'))
        self.report_sha256 = hashlib.sha256(self.report.read_bytes()).hexdigest()

    def export(self, output_directory=None):
        with patch.object(export_day_night_fixtures, 'FIXTURES_ROOT', self.fixtures_root), \
                patch.object(export_day_night_fixtures, 'DAY_NIGHT_REPORT_SHA256', self.report_sha256):
            return export_fixtures(self.report, self.loaded_tables, output_directory or self.fixtures_root / 'environment')

    def test_a_pinned_report_writes_both_fixture_files_with_their_sources(self):
        written = self.export()
        fixtures = json.loads((self.fixtures_root / 'environment' / 'day-night-db4-fixtures.json').read_bytes())
        tables = json.loads((self.fixtures_root / 'environment' / 'day-night-db4-loaded-tables.json').read_bytes())
        self.assertEqual((len(fixtures['fixtures']), fixtures['fixtures'][0], fixtures['source']['reportSha256']), (336, SYNTHETIC_FIXTURE, self.report_sha256))
        self.assertEqual(tables['tables'][0], {'environmentType': 0, 'section': 'SkyBoxColor', 'num': 1, 'keys': ['COLOR1'], 'packedHex': '0000000028314600'})
        self.assertEqual(set(written), {'day-night-db4-fixtures.json', 'day-night-db4-loaded-tables.json'})

    def test_a_report_with_another_sha256_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'differs from the pinned'):
            export_fixtures(self.report, self.loaded_tables, ROOT / 'tests' / 'fixtures' / 'environment')

    def test_loaded_tables_differing_from_the_report_listing_are_refused(self):
        self.loaded_tables.write_bytes(b'[]')
        with self.assertRaisesRegex(DayNightFixtureError, 'loaded-tables.json sha256'):
            self.export()

    def test_an_output_outside_tests_fixtures_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'outside tests/fixtures'):
            self.export(self.root / 'elsewhere')
        self.assertFalse((self.root / 'elsewhere').exists())

    def test_a_fixture_row_with_an_unknown_field_is_refused(self):
        document = json.loads(self.report.read_bytes())
        document['fixtures'][5] = {**SYNTHETIC_FIXTURE, 'guess': 1}
        self.report.write_bytes(json.dumps(document).encode('utf-8'))
        self.report_sha256 = hashlib.sha256(self.report.read_bytes()).hexdigest()
        with self.assertRaisesRegex(DayNightFixtureError, r'fixtures\[5\] has unknown fields'):
            self.export()


if __name__ == '__main__':
    unittest.main()
