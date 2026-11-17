import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world import export_day_night_fixtures, export_hourly_lighting_fixtures
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_hourly_lighting_fixtures import COMPOSITION_SHA256, REPLAY_RESULT_SHA256, export_hourly_lighting_fixtures as export_fixtures

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'hourly-lighting-db7-fixtures.json'
FIXTURES_FILE_SHA256 = '1f45d34a22e97c036f5272f82e38311dc7ec53213766d02670cd4baee03a351b'
SYNTHETIC_FIXTURE = {'hour': 6, 'surfaceType': 'actor', 'object': None, 'environmentType': 0, 'status': 'conditional-input-fixture',
                     'claimIds': ['ma-actor-ambient'], 'input': {'hourlyAmbientRGB': [90, 97, 120]}, 'output': {'ambientRGB': [45, 48, 60], 'alpha': 255},
                     'note': 'dropped', 'replay': [{'bytesHex': '00'}]}
SYNTHETIC_CONTEXT = {'tIntMapTimes': [1.5], 'tIntMapSample134x129': [156], 'nativePatchSamplesLocal6x1': [156], 'terrainLightMaskBit23': [[361, 0, 0]],
                     'staticHourlyVertex0Bits': [0], 'staticHourlyItemsContiguous': True, 'atlasChildCounts': [8]}


def replayed_row(index):
    return {'index': index, 'hour': 6, 'surfaceType': 'actor', 'matched': True, 'problems': []}


class CommittedHourlyLightingFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_32_db7_rows_from_the_pinned_composition_and_replay(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual((document['source']['composition']['sha256'], document['source']['replayResult']['sha256']),
                         (COMPOSITION_SHA256, REPLAY_RESULT_SHA256))
        self.assertEqual([fixture['surfaceType'] for fixture in document['fixtures']].count('terrain'), 12)
        self.assertEqual(len(document['fixtures']), 32)
        self.assertEqual(document['context']['staticHourlyVertex0Bits'], [0, 1, 0, 0, 1, 1, 1, 1])


class ExportHourlyLightingFixturesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name).resolve()
        self.fixtures_root = self.root / 'fixtures'
        self.composition = self.root / 'hourly-lighting-composition.json'
        self.replay_result = self.root / 'replay-result.json'
        self.write_inputs([replayed_row(index) for index in range(32)])

    def write_inputs(self, replayed_rows):
        self.composition.write_bytes(json.dumps({'question': 'DB-7', 'generatedAt': 'now', 'fixtures': [SYNTHETIC_FIXTURE] * 32}).encode('utf-8'))
        self.composition_sha256 = hashlib.sha256(self.composition.read_bytes()).hexdigest()
        self.replay_result.write_bytes(json.dumps({'composition': 'C:\\work\\hourly-lighting-composition.json', 'compositionSha256': self.composition_sha256,
                                                   'fixtureContext': SYNTHETIC_CONTEXT,
                                                   'fixtures': {'checked': 32, 'matched': 32, 'results': replayed_rows}}).encode('utf-8'))
        self.replay_result_sha256 = hashlib.sha256(self.replay_result.read_bytes()).hexdigest()

    def export(self, output_directory=None):
        with patch.object(export_day_night_fixtures, 'FIXTURES_ROOT', self.fixtures_root), \
                patch.object(export_hourly_lighting_fixtures, 'COMPOSITION_SHA256', self.composition_sha256), \
                patch.object(export_hourly_lighting_fixtures, 'REPLAY_RESULT_SHA256', self.replay_result_sha256):
            return export_fixtures(self.composition, self.replay_result, output_directory or self.fixtures_root / 'environment')

    def test_pinned_inputs_write_the_rows_without_replay_bytes_and_with_both_source_hashes(self):
        written = self.export()
        document = json.loads((self.fixtures_root / 'environment' / 'hourly-lighting-db7-fixtures.json').read_bytes())
        self.assertEqual(document['fixtures'][31], {'index': 31, **{key: value for key, value in SYNTHETIC_FIXTURE.items() if key not in ('note', 'replay')}})
        self.assertEqual((document['source']['composition']['sha256'], document['source']['replayResult']['sha256']),
                         (self.composition_sha256, self.replay_result_sha256))
        self.assertEqual(document['context'], SYNTHETIC_CONTEXT)
        self.assertEqual(set(written), {'hourly-lighting-db7-fixtures.json'})

    def test_a_composition_with_another_sha256_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'differs from the pinned'):
            export_fixtures(self.composition, self.replay_result, ROOT / 'tests' / 'fixtures' / 'environment')

    def test_a_row_the_replay_did_not_recompute_is_refused(self):
        rows = [replayed_row(index) for index in range(32)]
        rows[7] = {**rows[7], 'matched': False, 'problems': ['output.ambientRGB']}
        self.write_inputs(rows)
        with self.assertRaisesRegex(DayNightFixtureError, 'replay result 7 did not recompute'):
            self.export()

    def test_an_output_outside_tests_fixtures_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'outside tests/fixtures'):
            self.export(self.root / 'elsewhere')
        self.assertFalse((self.root / 'elsewhere').exists())


if __name__ == '__main__':
    unittest.main()
