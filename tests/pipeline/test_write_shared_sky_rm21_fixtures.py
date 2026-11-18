import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tools' / 'shared-sky-fixtures'))
from world.export_day_night_fixtures import DayNightFixtureError
from write_shared_sky_rm21_fixtures import SHARED_SKY_PASSES_SHA256, shared_sky_fixtures_document

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'shared-sky-rm21-fixtures.json'
FIXTURES_FILE_SHA256 = '7572b408dfba58a8f999c89d3f1a01d44f5b39003217fb7137d22045eae634b6'


class CommittedSharedSkyFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_rm21_local_colours_pass_states_and_fog_cross_check_from_the_pinned_answer(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual(document['source']['sha256'], SHARED_SKY_PASSES_SHA256)
        self.assertEqual(document['localSkyOverride']['finalRGB']['SkyColor'], [132, 146, 131])
        self.assertEqual([row['ordinal'] for row in document['frameBufferBlendingPasses']], list(range(9)))
        self.assertEqual(document['fogCrossCheck']['observedRGB'], [131, 144, 129])

    def test_an_answer_without_fixtures_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'holds no fixtures'):
            shared_sky_fixtures_document({'fixtures': []})


if __name__ == '__main__':
    unittest.main()
