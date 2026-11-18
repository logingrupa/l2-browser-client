import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_static_mesh_lighting_fixtures import (NATIVE_FIXTURES_SHA256, REAL_INPUTS_SHA256, kept_fixture,
                                                        static_mesh_lighting_fixtures_document)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'runtime-lighting-rm10-static-fixtures.json'
FIXTURES_FILE_SHA256 = 'afc3a9419b2a6b1f0de994f12de8a960dceec4244d0613bcb60f8119704f9b7b'


class CommittedStaticMeshLightingFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_two_rm10_pillar_fixtures_from_the_pinned_answer(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual((document['source']['nativeFixtures']['sha256'], document['source']['realInputs']['sha256']),
                         (NATIVE_FIXTURES_SHA256, REAL_INPUTS_SHA256))
        self.assertEqual([fixture['rotation'] for fixture in document['fixtures']], [[-9194, 24675, 0], [-9197, 24668, 0]])
        pillar = document['pillar']
        self.assertEqual((pillar['actorExportIndex'], pillar['instanceExportIndex'], len(pillar['nativeNormals'])), (7732, 7099, 108))
        self.assertEqual([mask['maskHex'] for mask in pillar['ordinaryMasks']], ['cc00004108', '0000000000'])


class StaticMeshLightingFixturesDocumentTests(unittest.TestCase):
    def test_a_fixture_without_a_colour_for_each_vertex_or_a_failed_answer_is_refused(self):
        fixture = {'hour': 12.3, 'environmentType': 0, 'rotation': [0, 0, 0], 'direction': [0, 0, 1], 'sunPlane': [0, 0, 0, 0], 'ambientRGB': [0, 0, 0],
                   'vertexIndices': [0, 4], 'instanceBGRA': [[5, 5, 5, 255]], 'matrix': [0] * 16}
        with self.assertRaisesRegex(DayNightFixtureError, 'pairs no colour'):
            kept_fixture(fixture, 0)
        with self.assertRaisesRegex(DayNightFixtureError, 'did not pass'):
            static_mesh_lighting_fixtures_document({'passed': False, 'fixtures': []}, {})


if __name__ == '__main__':
    unittest.main()
