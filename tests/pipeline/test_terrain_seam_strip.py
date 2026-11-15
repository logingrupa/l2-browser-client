import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.gap_rows import validate_gap_row
from world.native_terrain_sectors import vertex_normal
from world.terrain_chunk_step import build_tile_terrain_chunks, terrain_seam_gap_rows, tile_layer_summaries
from world.terrain_coordinates import f32, native_to_gltf
from world.terrain_seam_facts import RAW_STEP_PENDING_REASON, terrain_seam_frame
from world.terrain_seam_strip import (TERRAIN_SEAM_RULES_PATH, TerrainSeamRuleError, build_terrain_seam_strip, read_terrain_seam_rules,
                                      seam_gap_statuses, terrain_map_index)
from world.tile_chunk_plan import plan_tile_chunks
from synthetic_terrain_fixture import (SYNTHETIC_TERRAIN_OBJECT, glb_mesh_arrays, synthetic_layer_records, synthetic_serialized_layers,
                                       synthetic_terrain, synthetic_topology_words)

OWNER_TILE_ID = '20_20'
OWNER_LOCATION = [16384.0, 81920.0, 0.0]
SOURCE_IDENTITY = {'path': 'maps/20_20.unr', 'sha256': 'a' * 64}
EVIDENCE = 'work/tile__20_20/terrain/receipt.json'
NEIGHBOUR_LOCATIONS = {'21_20': [49152.0, 81920.0, 0.0], '20_21': [16384.0, 114688.0, 0.0], '21_21': [49152.0, 114688.0, 0.0]}
NEIGHBOUR_ROLES = {'column': '21_20', 'row': '20_21', 'corner': '21_21'}
HEIGHT_ORIGIN_SAMPLE = 32767


def float32_gltf_point(point):
    return tuple(f32(value) for value in native_to_gltf(point))


def float32_gltf_normal(normal):
    return (f32(normal[0]), f32(normal[2]), f32(normal[1]))


def neighbour_inputs(map_sha256='b' * 64, eligible=True):
    return [{'role': role, 'tileId': tile_id, 'mapSha256': map_sha256, 'eligible': eligible, 'rawFingerprint': 'c' * 64}
            for role, tile_id in NEIGHBOUR_ROLES.items()]


def neighbour_frame(tile_id, side, location=None):
    samples = [HEIGHT_ORIGIN_SAMPLE + 500 + tile_id.count('1') * 100 + column * 3 + row * 5 for row in range(side) for column in range(side)]
    return terrain_seam_frame(tile_id, location or NEIGHBOUR_LOCATIONS[tile_id], [128.0, 128.0, 256.0], side, side, samples, 'd' * 64)


def synthetic_chunks(native, points, far_heights):
    terrain_actor = {'id': 'interlude:Fixture.TerrainInfo0', 'object': native['object'],
                     'sourceTransform': {'Location': {'status': 'serialized', 'value': {'X': 0.0, 'Y': 0.0, 'Z': 0.0}}}}
    plan = plan_tile_chunks(OWNER_TILE_ID, native, {'id': terrain_actor['id'], 'terrainScale': {'X': 128.0, 'Y': 128.0, 'Z': 76.0}},
                            [terrain_actor], (None, 'player-start-missing'))
    records = synthetic_layer_records((0,))
    summaries = tile_layer_summaries(synthetic_serialized_layers((0,)), records, {})
    results = build_tile_terrain_chunks(OWNER_TILE_ID, native, points, synthetic_topology_words(native), records, summaries, plan['chunks'],
                                        SOURCE_IDENTITY, EVIDENCE, far_heights)
    return {record['chunkId']: (record, glb_mesh_arrays(glb)) for record, glb in results}


class SeamNeighbourTests(unittest.TestCase):
    def test_the_map_index_follows_the_post_load_formula_for_the_17_12_terrain(self):
        self.assertEqual(terrain_map_index([-81920.0, -180224.0, 160.0]), (17, 12))
        self.assertEqual(terrain_map_index(OWNER_LOCATION), (20, 20))

    def test_converted_neighbours_give_their_facing_heights_and_write_no_gap_row(self):
        native, points = synthetic_terrain(8, 8)
        frames = {tile_id: (neighbour_frame(tile_id, native['width']), None) for tile_id in NEIGHBOUR_ROLES.values()}
        strip = build_terrain_seam_strip(frames.get, OWNER_TILE_ID, native, points, OWNER_LOCATION, neighbour_inputs())
        self.assertEqual(strip.far_heights['column'], [100.0 * 1 + 500 + row * 5 for row in range(17)])
        self.assertEqual(strip.far_heights['row'], [500 + 100.0 + column * 3 for column in range(17)])
        self.assertEqual(strip.far_heights['corner'], [700.0])
        self.assertEqual(seam_gap_statuses(strip), [])

    def test_a_pending_neighbour_leaves_its_strip_out_and_writes_one_pending_row(self):
        native, points = synthetic_terrain(8, 8)
        strip = build_terrain_seam_strip(lambda tile_id: (None, RAW_STEP_PENDING_REASON), OWNER_TILE_ID, native, points, OWNER_LOCATION,
                                         neighbour_inputs())
        self.assertEqual(strip.far_heights, {'column': None, 'row': None, 'corner': None})
        rows = terrain_seam_gap_rows(OWNER_TILE_ID, SOURCE_IDENTITY, SYNTHETIC_TERRAIN_OBJECT, seam_gap_statuses(strip), EVIDENCE)
        self.assertEqual([(row['status'], row['reason']) for row in rows], [('pending', RAW_STEP_PENDING_REASON)])
        for row in rows:
            validate_gap_row(row)

    def test_a_neighbour_map_the_client_lacks_keeps_the_own_clamped_samples(self):
        native, points = synthetic_terrain(8, 8)
        strip = build_terrain_seam_strip(None, OWNER_TILE_ID, native, points, OWNER_LOCATION, neighbour_inputs(map_sha256=None))
        self.assertEqual(strip.far_heights['column'], [points[row * 17 + 16][2] for row in range(17)])
        self.assertEqual(strip.far_heights['row'], [points[16 * 17 + column][2] for column in range(17)])
        self.assertEqual(strip.far_heights['corner'], [points[-1][2]])

    def test_an_unconvertible_or_misplaced_neighbour_is_a_named_gap(self):
        native, points = synthetic_terrain(8, 8)
        frames = {tile_id: (neighbour_frame(tile_id, native['width'], [0.0, 0.0, 0.0]), None) for tile_id in NEIGHBOUR_ROLES.values()}
        cases = {'not eligible': (None, neighbour_inputs(eligible=False), OWNER_LOCATION),
                 'misplaced neighbour terrain': (frames.get, neighbour_inputs(), OWNER_LOCATION),
                 'misplaced owner terrain': (None, neighbour_inputs(), [0.0, 0.0, 0.0])}
        for case, (read_frame, inputs, owner_location) in cases.items():
            with self.subTest(case=case):
                strip = build_terrain_seam_strip(read_frame, OWNER_TILE_ID, native, points, owner_location, inputs)
                self.assertEqual(seam_gap_statuses(strip), [('gap', f'terrain-seam-neighbour-unavailable:{tile_id}') for tile_id in NEIGHBOUR_ROLES.values()])
                for row in terrain_seam_gap_rows(OWNER_TILE_ID, SOURCE_IDENTITY, SYNTHETIC_TERRAIN_OBJECT, seam_gap_statuses(strip), EVIDENCE):
                    validate_gap_row(row)


class SeamStripGeometryTests(unittest.TestCase):
    def setUp(self):
        self.native, self.points = synthetic_terrain(8, 8)
        self.far_heights = {'column': [1000.0 + row for row in range(17)], 'row': [2000.0 + column for column in range(17)], 'corner': [3000.0]}
        self.with_strip = synthetic_chunks(self.native, self.points, self.far_heights)
        self.without_strip = synthetic_chunks(self.native, self.points, {'column': None, 'row': None, 'corner': None})

    def test_the_last_column_chunk_gains_one_quad_column_whose_far_vertices_take_the_neighbour_heights(self):
        record, arrays = self.with_strip['chunk-1-0']
        self.assertEqual(arrays['POSITION'][81:], [float32_gltf_point([17 * 128.0, row * 128.0, 1000.0 + row]) for row in range(9)])
        self.assertEqual((record['seamStripQuads'], record['triangleCount']), (8, 8 * 8 * 2 + 8 * 2))
        self.assertEqual(arrays['extras']['seamStripQuads'], 8)

    def test_the_corner_chunk_gains_the_column_the_row_and_the_corner_quad(self):
        record, arrays = self.with_strip['chunk-1-1']
        self.assertEqual(record['seamStripQuads'], 17)
        self.assertEqual(arrays['POSITION'][-1], float32_gltf_point([17 * 128.0, 17 * 128.0, 3000.0]))
        self.assertEqual(arrays['extras']['reconstructedBounds'][5], 3000.0)

    def test_a_far_vertex_takes_the_normal_of_the_own_edge_vertex(self):
        _, arrays = self.with_strip['chunk-1-0']
        for row in range(9):
            normal = vertex_normal(self.points, synthetic_topology_words(self.native)['EdgeTurnBitmap'], 17, 17, 16, row)
            self.assertEqual(arrays['NORMAL'][81 + row], float32_gltf_normal(normal))

    def test_an_inner_chunk_and_a_strip_without_neighbour_heights_are_unchanged(self):
        self.assertEqual(self.with_strip['chunk-0-0'], self.without_strip['chunk-0-0'])
        self.assertEqual(self.without_strip['chunk-1-1'][0]['seamStripQuads'], 0)
        self.assertEqual(len(self.without_strip['chunk-1-1'][1]['POSITION']), 81)


class SeamRuleRecipeTests(unittest.TestCase):
    def test_the_committed_recipe_decides_every_ported_rule_from_the_binary(self):
        rows = read_terrain_seam_rules()
        self.assertEqual({row['status'] for row in rows.values()}, {'confirmed-interlude'})
        self.assertFalse(rows['terrain.seam.strip-collision']['value'])

    def test_an_unknown_rule_is_refused(self):
        document = json.loads(TERRAIN_SEAM_RULES_PATH.read_text(encoding='utf-8'))
        document['rows'][2]['status'] = 'unknown'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'terrain-seam-rules.json'
            path.write_text(json.dumps(document), encoding='utf-8')
            with self.assertRaisesRegex(TerrainSeamRuleError, 'does not decide the seam'):
                read_terrain_seam_rules(path)


if __name__ == '__main__':
    unittest.main()
