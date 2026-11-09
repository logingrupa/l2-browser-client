import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from world.terrain_chunk_step import TERRAIN_CHUNK_STEP_ALGORITHM_VERSION, build_tile_terrain_chunks, extrapolated_mask_uv_rule
from world.terrain_coordinates import f32, native_to_gltf
from world.terrain_layers import QUALIFIED_MASK_UV_FORMULA
from world.tile_chunk_plan import plan_tile_chunks
from synthetic_terrain_fixture import glb_mesh_arrays, synthetic_layer_records, synthetic_terrain, synthetic_topology_words

TILE_ID = '20_21'
SOURCE_IDENTITY = {'path': 'maps/20_21.unr', 'sha256': 'a' * 64}
EVIDENCE = 'work/tile__20_21/terrain/receipt.json'
REAL_TERRAIN_INDEX_PATH = ROOT / 'artifacts/lane-store/world/work/tile__20_21/terrain/products/terrain-chunks.json'


def synthetic_chunk_plan(native):
    terrain_actor = {'id': 'interlude:Fixture.TerrainInfo0', 'object': native['object'],
                     'sourceTransform': {'Location': {'status': 'serialized', 'value': {'X': 0.0, 'Y': 0.0, 'Z': 0.0}}}}
    terrain_record = {'id': terrain_actor['id'], 'terrainScale': {'X': 128.0, 'Y': 128.0, 'Z': 76.0}}
    return plan_tile_chunks(TILE_ID, native, terrain_record, [terrain_actor], (None, 'player-start-missing'))


def build_synthetic_chunks(sector_columns, sector_rows, layer_indices=(0, 1, 2), words=None, mutate=None):
    native, points = synthetic_terrain(sector_columns, sector_rows)
    if mutate:
        mutate(native)
    plan = synthetic_chunk_plan(native)
    results = build_tile_terrain_chunks(TILE_ID, native, points, words or synthetic_topology_words(native),
                                        synthetic_layer_records(layer_indices), plan['chunks'], SOURCE_IDENTITY, EVIDENCE)
    return native, points, plan, {record['chunkId']: (record, glb) for record, glb in results}, [record for record, _ in results]


def float32_point(point):
    return tuple(f32(value) for value in native_to_gltf(point))


class ExtrapolatedRuleTests(unittest.TestCase):
    def test_the_rule_is_the_20_20_submitted_formula_labelled_extrapolated(self):
        self.assertEqual(extrapolated_mask_uv_rule(), {'id': 'interlude-20_20-submitted-mask-uv-20261106',
                                                        'formula': QUALIFIED_MASK_UV_FORMULA, 'status': 'extrapolated'})
        self.assertEqual(TERRAIN_CHUNK_STEP_ALGORITHM_VERSION, 1)

    def test_every_chunk_record_and_glb_carries_the_extrapolated_label_and_its_source(self):
        _, _, _, by_chunk, records = build_synthetic_chunks(8, 8)
        self.assertEqual(len(records), 4)
        for record in records:
            with self.subTest(chunk=record['chunkId']):
                self.assertEqual(record['maskUvRule'], 'extrapolated')
                self.assertEqual(record['maskUvRuleSource'], 'interlude-20_20-submitted-mask-uv-20261106')
                extras = glb_mesh_arrays(by_chunk[record['chunkId']][1])['extras']
                self.assertEqual(extras['maskUVRule']['status'], 'extrapolated')
                self.assertEqual({layer['maskUVStatus'] for layer in extras['nativeLayers']}, {'extrapolated'})


class ChunkGeometryTests(unittest.TestCase):
    def test_chunk_positions_are_the_source_points_of_its_rectangle(self):
        native, points, plan, by_chunk, _ = build_synthetic_chunks(8, 8)
        for chunk in plan['chunks']:
            with self.subTest(chunk=chunk['chunkId']):
                record, glb = by_chunk[chunk['chunkId']]
                (first_x, first_y), (last_x, last_y) = chunk['sectorRectangle']['minOffset'], chunk['sectorRectangle']['maxOffset']
                expected = [float32_point(points[y * native['width'] + x])
                            for y in range(first_y, last_y + 3) for x in range(first_x, last_x + 3)]
                self.assertEqual(glb_mesh_arrays(glb)['POSITION'], expected)
                self.assertEqual(record['terrain']['bytes'], len(glb))
                self.assertEqual(record['triangleCount'], 8 * 8 * 2)
                self.assertEqual(record['hiddenQuads'], 0)
                self.assertEqual(record['gapRows'], [])

    def test_horizontal_neighbours_share_an_identical_boundary_vertex_column(self):
        _, _, _, by_chunk, _ = build_synthetic_chunks(8, 8)
        left, right = (glb_mesh_arrays(by_chunk[name][1]) for name in ('chunk-0-0', 'chunk-1-0'))
        row_length = 9
        for attribute in ('POSITION', 'NORMAL'):
            left_edge = [left[attribute][row * row_length + row_length - 1] for row in range(row_length)]
            right_edge = [right[attribute][row * row_length] for row in range(row_length)]
            self.assertEqual(left_edge, right_edge, attribute)


@unittest.skipUnless(REAL_TERRAIN_INDEX_PATH.is_file(), 'the 20_21 terrain unit is not sealed in this checkout')
class RealTileTerrainTests(unittest.TestCase):
    def test_the_sealed_20_21_terrain_writes_every_chunk_labelled_extrapolated_with_the_research_z_mismatch_count(self):
        index = json.loads(REAL_TERRAIN_INDEX_PATH.read_text(encoding='utf-8'))
        self.assertEqual(len(index['chunks']), 16)
        self.assertTrue(all(chunk['terrain'] is not None for chunk in index['chunks']))
        self.assertEqual({chunk['maskUvRule'] for chunk in index['chunks']}, {'extrapolated'})
        self.assertEqual(sum(chunk['cachedZBoundsMismatched'] for chunk in index['chunks']), 238)
        self.assertEqual({len(chunk['layers']) for chunk in index['chunks']}, {9})


if __name__ == '__main__':
    unittest.main()
