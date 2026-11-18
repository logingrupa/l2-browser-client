import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_fog_transition_fixtures import NATIVE_FIXTURES_SHA256, kept_fixture

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'fog-transition-rm17-fixtures.json'
FIXTURES_FILE_SHA256 = '7fd167ec0598cd1ce8ff0808465268e196dfe0b57bfc9caa034210519a192db4'


class CommittedFogTransitionFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_15_rm17_transition_fixtures_from_the_pinned_answer(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual(document['source']['sha256'], NATIVE_FIXTURES_SHA256)
        self.assertEqual(len(document['fixtures']), 15)
        overshoot = next(fixture for fixture in document['fixtures'] if fixture['scenario'] == 'overshoot')['output']
        self.assertEqual((overshoot['colorBGRA'], overshoot['start'], overshoot['end']), ([65, 91, 86, 255], -2048.0, 7380.0))


class FogTransitionFixtureTests(unittest.TestCase):
    def test_a_fixture_whose_scalar_recomputation_disagrees_is_refused(self):
        state = {field: 0 for field in ('targetColorBGRA', 'targetStart', 'targetEnd', 'oldColorBGRA', 'oldStart', 'oldEnd', 'colorBGRA', 'start', 'end',
                                        'duration', 'remaining')}
        with self.assertRaisesRegex(DayNightFixtureError, 'did not pass its scalar recomputation'):
            kept_fixture({'scenario': 'x', 'deltaSeconds': 0, 'before': state, 'output': state, 'scalarOutput': {**state, 'remaining': 1}, 'passed': True}, 0)


if __name__ == '__main__':
    unittest.main()
