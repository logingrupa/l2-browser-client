import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_sky_fog_depth_fixtures import SKY_FOG_DEPTH_SHA256, sky_fog_depth_fixtures_document

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'sky-fog-depth-rm18-fixtures.json'
FIXTURES_FILE_SHA256 = '2856420f52eec8e9f66686dc78391a98500f63afd3613954f6ea049d937b9ed4'


class CommittedSkyFogDepthFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_rm18_table_and_range_depth_rows_from_the_pinned_answer(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual(document['source']['sha256'], SKY_FOG_DEPTH_SHA256)
        self.assertEqual([(fixture['depthRule'], fixture['fogDepth']) for fixture in document['fixtures']][0], ('table-W-or-vertex-depth', 571.34375))

    def test_an_answer_without_numeric_fixtures_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'holds no numeric fixtures'):
            sky_fog_depth_fixtures_document({'numericFixtures': []})


if __name__ == '__main__':
    unittest.main()
