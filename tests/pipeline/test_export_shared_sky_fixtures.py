import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_shared_sky_fixtures import (SHARED_SKY_PASSES_SHA256, SHARED_SKYLEVEL_DECODE_SHA256, shared_sky_fixtures_document, sky_zone_node_counts,
                                              sky_zone_of_decode)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'shared-sky-rm21-fixtures.json'
FIXTURES_FILE_SHA256 = '0d329836e4b3cc86b8d1612a50ba20c5c0acf5a7c7d60e735dc5e55b8e3d8aae'


class CommittedSharedSkyFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_rm21_local_colours_pass_states_and_fog_cross_check_from_the_pinned_answer(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual(document['source']['sha256'], SHARED_SKY_PASSES_SHA256)
        self.assertEqual(document['localSkyOverride']['finalRGB']['SkyColor'], [132, 146, 131])
        self.assertEqual([row['ordinal'] for row in document['frameBufferBlendingPasses']], list(range(9)))
        self.assertEqual(document['fogCrossCheck']['observedRGB'], [131, 144, 129])

    def test_the_committed_file_holds_the_rm18_skylevel_decode_beside_the_rm21_geometry_and_materials(self):
        skylevel = json.loads(FIXTURES_FILE.read_bytes())['sharedSkyLevel']
        self.assertEqual(skylevel['source']['sha256'], SHARED_SKYLEVEL_DECODE_SHA256)
        self.assertEqual((skylevel['modelExportIndex'], skylevel['surfaceCount'], skylevel['nodeCount'], skylevel['zoneCount']), (61, 1372, 4970, 2))
        self.assertEqual(skylevel['skyZone']['actor'], 'skylevel.SkyZoneInfo0')
        self.assertEqual([point['pointIndex'] for point in skylevel['pixelNode']['points']], skylevel['pixelGeometry']['pointIndices'])
        self.assertEqual(len(skylevel['materials']), 9)

    def test_the_sky_zone_node_counts_use_the_decoded_sky_zone_and_count_the_nodes_with_a_polygon(self):
        polygon = [{'pointIndex': index, 'position': [0.0, 0.0, 0.0]} for index in range(3)]
        decode = {'zones': [{'zoneIndex': 0, 'actor': None, 'actorIndex': 0}, {'zoneIndex': 2, 'actor': 'skylevel.SkyZoneInfo0', 'actorIndex': 13}],
                  'actors': [{'exportIndex': 13, 'object': 'skylevel.SkyZoneInfo0', 'values': {'Location': [1.0, 2.0, 3.0]}}],
                  'nodes': [{'zones': [0, 2], 'vertices': polygon}, {'zones': [2, 2], 'vertices': polygon[:2]}, {'zones': [1, 1], 'vertices': polygon}]}
        self.assertEqual(sky_zone_node_counts(decode), {'skyZoneNodeCount': 2, 'skyZonePolygonNodeCount': 1})

    def test_an_answer_without_fixtures_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'holds no fixtures'):
            shared_sky_fixtures_document({'fixtures': []}, {})

    def test_a_decode_without_one_sky_zone_actor_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'holds 0 SkyZoneInfo0 zones'):
            sky_zone_of_decode({'zones': [{'zoneIndex': 0, 'actor': None, 'actorIndex': 0}], 'actors': []})


if __name__ == '__main__':
    unittest.main()
