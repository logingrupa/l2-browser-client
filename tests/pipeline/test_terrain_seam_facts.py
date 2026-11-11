from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.terrain_seam_facts import (RAW_STEP_PENDING_REASON, TerrainSeamFactsError, adjacent_tile_pairs, seam_pair_facts,
                                      terrain_seam_facts_document, terrain_seam_frame)

HEIGHTMAP_SIDE = 256
TERRAIN_SCALE = [128.0, 128.0, 76.0]
TILE_SPACING = 32768.0


def synthetic_samples(height_of_point):
    return [height_of_point(column, row) for row in range(HEIGHTMAP_SIDE) for column in range(HEIGHTMAP_SIDE)]


def synthetic_frame(tile_id, location, height_of_point):
    return terrain_seam_frame(tile_id, location, TERRAIN_SCALE, HEIGHTMAP_SIDE, HEIGHTMAP_SIDE, synthetic_samples(height_of_point), 'f' * 64)


def owner_heights(column, row):
    return 20000 + row * 3 + column


def neighbour_heights_matching_owner(column, row):
    return 20000 + row * 3 + (HEIGHTMAP_SIDE - 1) + column * 7


class TerrainSeamPairFactsTest(unittest.TestCase):
    def test_equal_facing_columns_report_strip_width_128_and_every_sample_equal(self):
        owner = synthetic_frame('17_12', [-81920.0, -180224.0, 160.0], owner_heights)
        neighbour = synthetic_frame('18_12', [-81920.0 + TILE_SPACING, -180224.0, 160.0], neighbour_heights_matching_owner)
        pair = seam_pair_facts(owner, neighbour, 'x')
        self.assertEqual(pair['tiles'], ['17_12', '18_12'])
        self.assertTrue(pair['measured'])
        self.assertEqual(pair['stripWidth'], 128.0)
        self.assertEqual(pair['acrossAxisOffset'], 0.0)
        self.assertEqual(pair['facingEdge']['sampleCount'], 256)
        self.assertEqual(pair['facingEdge']['equalCount'], 256)
        self.assertEqual(pair['facingEdge']['largestDifference'], 0.0)
        self.assertEqual(owner['coveredExtent'], {'min': [-98304.0, -196608.0], 'max': [-65664.0, -163968.0]})

    def test_one_differing_facing_sample_reports_255_equal_and_the_largest_difference(self):
        def neighbour_with_one_raised_sample(column, row):
            return neighbour_heights_matching_owner(column, row) + (512 if (column, row) == (0, 40) else 0)
        owner = synthetic_frame('20_20', [0.0, 0.0, 0.0], owner_heights)
        neighbour = synthetic_frame('20_21', [0.0, TILE_SPACING, 0.0], lambda column, row: owner_heights(column, row + HEIGHTMAP_SIDE - 1))
        changed = synthetic_frame('20_21', [0.0, TILE_SPACING, 0.0],
                                  lambda column, row: owner_heights(column, row + HEIGHTMAP_SIDE - 1) + (512 if (column, row) == (40, 0) else 0))
        self.assertEqual(seam_pair_facts(owner, neighbour, 'y')['facingEdge']['equalCount'], 256)
        pair = seam_pair_facts(owner, changed, 'y')
        self.assertEqual(pair['stripWidth'], 128.0)
        self.assertEqual(pair['facingEdge']['equalCount'], 255)
        self.assertEqual(pair['facingEdge']['largestDifference'], 512 * 76.0 / 256)
        x_neighbour = synthetic_frame('21_20', [TILE_SPACING, 0.0, 0.0], neighbour_with_one_raised_sample)
        self.assertEqual(seam_pair_facts(owner, x_neighbour, 'x')['facingEdge']['equalCount'], 255)

    def test_the_facing_edge_hashes_hold_the_edge_samples_not_the_client_bytes(self):
        owner = synthetic_frame('17_12', [0.0, 0.0, 0.0], owner_heights)
        neighbour = synthetic_frame('18_12', [TILE_SPACING, 0.0, 0.0], neighbour_heights_matching_owner)
        edge = seam_pair_facts(owner, neighbour, 'x')['facingEdge']
        self.assertEqual(edge['ownerEdgeSha256'], edge['neighbourEdgeSha256'])
        self.assertNotIn('samples', edge)

    def test_facing_edges_of_different_sample_counts_are_refused(self):
        owner = synthetic_frame('17_12', [0.0, 0.0, 0.0], owner_heights)
        narrow = terrain_seam_frame('18_12', [TILE_SPACING, 0.0, 0.0], TERRAIN_SCALE, 128, 128, [16384] * 128 * 128, 'e' * 64)
        with self.assertRaisesRegex(TerrainSeamFactsError, 'sample counts'):
            seam_pair_facts(owner, narrow, 'x')


class TerrainSeamPairListingTest(unittest.TestCase):
    def test_adjacent_pairs_follow_the_tile_grid_in_x_and_y(self):
        self.assertEqual(adjacent_tile_pairs(['17_12', '18_12', '17_13', '19_14']),
                         [('17_12', '18_12', 'x'), ('17_12', '17_13', 'y')])

    def test_a_pair_with_an_unsealed_raw_step_is_listed_as_not_measured(self):
        owner = synthetic_frame('17_12', [0.0, 0.0, 0.0], owner_heights)
        document = terrain_seam_facts_document('c' * 64, ['17_12', '18_12', '17_13'],
                                               {'17_12': (owner, None), '18_12': (None, RAW_STEP_PENDING_REASON),
                                                '17_13': (None, RAW_STEP_PENDING_REASON)})
        self.assertEqual([pair['measured'] for pair in document['pairs']], [False, False])
        self.assertEqual(document['pairs'][0]['tiles'], ['17_12', '18_12'])
        self.assertIsNone(document['pairs'][0]['stripWidth'])
        self.assertIsNone(document['pairs'][0]['facingEdge'])
        self.assertEqual(document['pairs'][0]['unmeasuredTerrains'], [{'tileId': '18_12', 'reason': RAW_STEP_PENDING_REASON}])
        self.assertEqual(document['summary']['measuredPairs'], 0)
        self.assertEqual(document['summary']['notMeasuredPairs'], 2)
        self.assertIsNone(document['summary']['everyMeasuredFacingEdgeEqual'])
        self.assertEqual(document['terrains']['18_12'], {'measured': False, 'reason': RAW_STEP_PENDING_REASON})


if __name__ == '__main__':
    unittest.main()
