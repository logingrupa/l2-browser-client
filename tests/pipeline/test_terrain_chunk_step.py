import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_store.gap_rows import validate_gap_row
from world.native_terrain_sectors import sector_oracle, select_terrain_sectors
from world.terrain_chunk_step import (TERRAIN_CHUNK_STEP_ALGORITHM_VERSION, build_tile_terrain_chunks, extrapolated_mask_uv_rule,
                                      terrain_layer_gap_rows, tile_layer_summaries, tile_terrain_row)
from world.terrain_coordinates import f32, native_to_gltf
from world.terrain_layers import QUALIFIED_MASK_UV_FORMULA, layer_records, terrain_layer_gap_reasons
from world.terrain_rectangle_mesh import build_terrain_rectangle_gltf
from world.tile_chunk_plan import plan_tile_chunks
from synthetic_terrain_fixture import (SYNTHETIC_TERRAIN_OBJECT, glb_mesh_arrays, glb_triangle_positions, synthetic_layer_records,
                                       synthetic_serialized_layers, synthetic_terrain, synthetic_topology_words)

TILE_ID = '20_21'
SOURCE_IDENTITY = {'path': 'maps/20_21.unr', 'sha256': 'a' * 64}
EVIDENCE = 'work/tile__20_21/terrain/receipt.json'
REAL_TERRAIN_INDEX_PATH = ROOT / 'artifacts/lane-store/world/work/tile__20_21/terrain/products/terrain-chunks.json'
WORLD_07_DISCRIMINATING_CASES_PATH = ROOT / 'tests/fixtures/world-07/discriminating-cases.json'
THREE_LAYER_FOUR_SECTOR_CHUNK_GLB_SHA256 = '73680f738faafea18a0f1d21f3290d11b3374319d8e3f159a77b3c0149af5306'
NO_SEAM_STRIP = {'column': None, 'row': None, 'corner': None}


def synthetic_chunk_plan(native):
    terrain_actor = {'id': 'interlude:Fixture.TerrainInfo0', 'object': native['object'],
                     'sourceTransform': {'Location': {'status': 'serialized', 'value': {'X': 0.0, 'Y': 0.0, 'Z': 0.0}}}}
    terrain_record = {'id': terrain_actor['id'], 'terrainScale': {'X': 128.0, 'Y': 128.0, 'Z': 76.0}}
    return plan_tile_chunks(TILE_ID, native, terrain_record, [terrain_actor], (None, 'player-start-missing'))


def build_synthetic_chunks(sector_columns, sector_rows, layer_indices=(0, 1, 2), words=None, mutate=None, empty_layer_indices=(),
                           texture_only_layer_indices=(), placement_overrides=None, seam_far_heights=None):
    native, points = synthetic_terrain(sector_columns, sector_rows)
    if mutate:
        mutate(native)
    plan = synthetic_chunk_plan(native)
    serialized_layers = synthetic_serialized_layers(layer_indices, empty_layer_indices, texture_only_layer_indices, placement_overrides)
    layer_gap_reasons = terrain_layer_gap_reasons(serialized_layers)
    records = synthetic_layer_records([index for index in layer_indices if index not in empty_layer_indices and index not in layer_gap_reasons])
    summaries = tile_layer_summaries(serialized_layers, records, layer_gap_reasons)
    results = build_tile_terrain_chunks(TILE_ID, native, points, words or synthetic_topology_words(native),
                                        records, summaries, plan['chunks'], SOURCE_IDENTITY, EVIDENCE, seam_far_heights or NO_SEAM_STRIP)
    return native, points, plan, {record['chunkId']: (record, glb) for record, glb in results}, [record for record, _ in results]


def float32_point(point):
    return tuple(f32(value) for value in native_to_gltf(point))


class ExtrapolatedRuleTests(unittest.TestCase):
    def test_the_rule_is_the_20_20_submitted_formula_labelled_extrapolated(self):
        self.assertEqual(extrapolated_mask_uv_rule(), {'id': 'interlude-20_20-submitted-mask-uv-20261106',
                                                        'formula': QUALIFIED_MASK_UV_FORMULA, 'status': 'extrapolated'})
        self.assertEqual(TERRAIN_CHUNK_STEP_ALGORITHM_VERSION, 3)

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


class ChunkAdjacencyTests(unittest.TestCase):
    def test_chunk_triangles_together_equal_the_whole_rectangle_and_no_quad_is_emitted_twice(self):
        native, points, _, by_chunk, records = build_synthetic_chunks(8, 8)
        words = synthetic_topology_words(native)
        oracle = sector_oracle(native, points)
        whole_rectangle = {'minOffset': [0, 0], 'maxOffset': [14, 14]}
        region, _ = select_terrain_sectors(native, oracle, {'terrainSectorRectangle': whole_rectangle})
        whole_files, whole_statistics = build_terrain_rectangle_gltf(native, points, words, synthetic_layer_records((0, 1, 2)), region,
                                                                     extrapolated_mask_uv_rule(), whole_rectangle, 'terrain_chunk_step.py',
                                                                     NO_SEAM_STRIP)
        chunk_triangles = [glb_triangle_positions(glb_mesh_arrays(glb)) for _, glb in by_chunk.values()]
        self.assertEqual(sum(len(triangles) for triangles in chunk_triangles), whole_statistics['triangleCount'])
        self.assertEqual(sum(record['triangleCount'] for record in records), whole_statistics['triangleCount'])
        self.assertEqual(set().union(*chunk_triangles), glb_triangle_positions(glb_mesh_arrays(whole_files['terrain.glb'])))

    def test_vertical_neighbours_share_an_identical_boundary_vertex_row(self):
        _, _, _, by_chunk, _ = build_synthetic_chunks(8, 8)
        lower, upper = (glb_mesh_arrays(by_chunk[name][1]) for name in ('chunk-0-0', 'chunk-0-1'))
        row_length = 9
        for attribute in ('POSITION', 'NORMAL'):
            self.assertEqual(lower[attribute][-row_length:], upper[attribute][:row_length], attribute)


class EmptyAndFailedChunkTests(unittest.TestCase):
    def test_a_chunk_whose_quads_are_all_hidden_has_no_terrain_no_glb_and_no_gap_row(self):
        native, points = synthetic_terrain(4, 4)
        words = synthetic_topology_words(native, visibility_word=0)
        plan = synthetic_chunk_plan(native)
        records = synthetic_layer_records((0,))
        summaries = tile_layer_summaries(synthetic_serialized_layers((0,)), records, {})
        [(record, glb)] = build_tile_terrain_chunks(TILE_ID, native, points, words, records, summaries, plan['chunks'], SOURCE_IDENTITY, EVIDENCE,
                                                    NO_SEAM_STRIP)
        self.assertIsNone(glb)
        self.assertIsNone(record['terrain'])
        self.assertEqual((record['hiddenQuads'], record['triangleCount'], record['gapRows']), (64, 0, []))
        self.assertEqual(tile_terrain_row(TILE_ID, SOURCE_IDENTITY, [], [record], [], EVIDENCE)['status'], 'pass')

    def test_a_chunk_whose_sector_xy_bounds_disagree_with_the_samples_gets_one_decode_gap_row(self):
        def shift_one_sector_x_bound(native):
            native['sectors'][36]['bounds'][0] += 1.0
        _, _, _, by_chunk, records = build_synthetic_chunks(8, 8, mutate=shift_one_sector_x_bound)
        record, glb = by_chunk['chunk-1-1']
        self.assertIsNone(glb)
        self.assertIsNone(record['terrain'])
        [gap_row] = record['gapRows']
        validate_gap_row(gap_row)
        self.assertEqual(gap_row['reason'], 'decode-failed:Selected rectangle has not passed its declared native bounds oracle policy')
        self.assertEqual(gap_row['sourceIdentity'], {**SOURCE_IDENTITY, 'object': 'Fixture.TerrainInfo0.TerrainSector36'})
        self.assertEqual((gap_row['key'], gap_row['step'], gap_row['status']), ('tile:20_21', 'terrain', 'gap'))
        self.assertIn('Fixture.TerrainInfo0.TerrainSector36', record['sectorObjects'])
        self.assertTrue(all(by_chunk[name][1] is not None for name in ('chunk-0-0', 'chunk-0-1', 'chunk-1-0')))
        tile_row = tile_terrain_row(TILE_ID, SOURCE_IDENTITY, [], records, [], EVIDENCE)
        self.assertEqual((tile_row['status'], tile_row['reason']), ('gap', gap_row['reason']))

    def test_two_builds_of_the_same_source_give_byte_identical_records_and_glbs(self):
        first, second = build_synthetic_chunks(8, 8)[3], build_synthetic_chunks(8, 8)[3]
        self.assertEqual(json.dumps({name: record for name, (record, _) in first.items()}, sort_keys=True),
                         json.dumps({name: record for name, (record, _) in second.items()}, sort_keys=True))
        self.assertEqual({name: glb for name, (_, glb) in first.items()}, {name: glb for name, (_, glb) in second.items()})


class LayerOrderTests(unittest.TestCase):
    def test_layers_keep_serialized_index_order_and_count_when_diffuse_names_sort_differently(self):
        textures = {0: 'Fixture.Zeta', 1: 'Fixture.Alpha', 2: 'Fixture.Mu', 3: 'Fixture.Beta'}
        summaries = tile_layer_summaries(synthetic_serialized_layers((0, 1, 2, 3)), synthetic_layer_records((0, 1, 2, 3), textures), {})
        self.assertEqual([layer['index'] for layer in summaries], [0, 1, 2, 3])
        self.assertEqual([layer['texture'] for layer in summaries], ['Fixture.Zeta', 'Fixture.Alpha', 'Fixture.Mu', 'Fixture.Beta'])
        _, _, _, _, chunk_records = build_synthetic_chunks(4, 4, layer_indices=(0, 1, 2, 3))
        self.assertEqual([layer['index'] for layer in chunk_records[0]['layers']], [0, 1, 2, 3])

    def test_empty_layer_slots_stay_listed_so_the_count_equals_the_serialized_layers(self):
        _, _, _, by_chunk, chunk_records = build_synthetic_chunks(4, 4, layer_indices=(0, 1, 2, 3), empty_layer_indices=(2, 3))
        layers = chunk_records[0]['layers']
        self.assertEqual([(layer['index'], layer['emptySlot']) for layer in layers], [(0, False), (1, False), (2, True), (3, True)])
        self.assertEqual((layers[2]['texture'], layers[2]['alphaMap'], layers[2]['useAlpha']), (None, None, False))
        self.assertEqual([layer['index'] for layer in glb_mesh_arrays(by_chunk['chunk-0-0'][1])['extras']['nativeLayers']], [0, 1])

    def test_a_dropped_or_reordered_layer_fails_instead_of_shrinking_the_layer_list(self):
        serialized = synthetic_serialized_layers((0, 1, 2, 3))
        for indices in ((0, 1, 3), (0, 2, 1, 3)):
            with self.subTest(indices=indices), self.assertRaises(FormatError):
                tile_layer_summaries(serialized, synthetic_layer_records(indices), {})
        texture_only = synthetic_serialized_layers((0, 1), texture_only_indices=(1,))
        with self.assertRaisesRegex(FormatError, 'differ from the placeable serialized Layers'):
            tile_layer_summaries(texture_only, synthetic_layer_records((0,)), {})

    def test_the_world_07_seven_layer_order_survives_into_the_chunk_records_and_glb(self):
        observed_layers = json.loads(WORLD_07_DISCRIMINATING_CASES_PATH.read_text(encoding='utf-8'))['sevenLayers']['layers']
        self.assertEqual(observed_layers, [0, 2, 3, 4, 5, 6, 7])
        _, _, _, by_chunk, chunk_records = build_synthetic_chunks(4, 4, layer_indices=observed_layers)
        self.assertEqual([layer['index'] for layer in chunk_records[0]['layers']], observed_layers)
        extras = glb_mesh_arrays(by_chunk['chunk-0-0'][1])['extras']
        self.assertEqual([layer['index'] for layer in extras['nativeLayers']], observed_layers)


class LayerGapTests(unittest.TestCase):
    def test_a_layer_naming_only_a_texture_becomes_a_layer_incomplete_gap_row_and_the_other_layers_stay(self):
        serialized_layers = synthetic_serialized_layers((0, 1, 2, 3, 4), texture_only_indices=(3,))
        layer_gap_reasons = terrain_layer_gap_reasons(serialized_layers)
        self.assertEqual(layer_gap_reasons, {3: 'terrain-layer-incomplete:3'})
        summaries = tile_layer_summaries(serialized_layers, synthetic_layer_records((0, 1, 2, 4)), layer_gap_reasons)
        self.assertEqual([layer['index'] for layer in summaries], [0, 1, 2, 4])
        [gap_row] = terrain_layer_gap_rows(TILE_ID, SOURCE_IDENTITY, SYNTHETIC_TERRAIN_OBJECT, layer_gap_reasons, EVIDENCE)
        validate_gap_row(gap_row)
        self.assertEqual((gap_row['key'], gap_row['step'], gap_row['status'], gap_row['reason']),
                         ('tile:20_21', 'terrain', 'gap', 'terrain-layer-incomplete:3'))
        self.assertEqual(gap_row['sourceIdentity'], {**SOURCE_IDENTITY, 'object': SYNTHETIC_TERRAIN_OBJECT})
        _, _, _, by_chunk, chunk_records = build_synthetic_chunks(4, 4, layer_indices=(0, 1, 2, 3, 4), texture_only_layer_indices=(3,))
        self.assertEqual([layer['index'] for layer in chunk_records[0]['layers']], [0, 1, 2, 4])
        self.assertEqual([layer['index'] for layer in glb_mesh_arrays(by_chunk['chunk-0-0'][1])['extras']['nativeLayers']], [0, 1, 2, 4])
        tile_row = tile_terrain_row(TILE_ID, SOURCE_IDENTITY, [gap_row], chunk_records, [], EVIDENCE)
        self.assertEqual((tile_row['status'], tile_row['reason']), ('gap', 'terrain-layer-incomplete:3'))

    def test_a_terrain_whose_only_filled_layer_is_incomplete_still_writes_its_height_mesh_without_a_base_layer_uv_set(self):
        native, points, plan, by_chunk, chunk_records = build_synthetic_chunks(4, 4, layer_indices=(0, 1), empty_layer_indices=(1,),
                                                                               texture_only_layer_indices=(0,))
        [(record, glb)] = by_chunk.values()
        self.assertEqual(record['triangleCount'], 8 * 8 * 2)
        self.assertEqual(record['terrain']['bytes'], len(glb))
        self.assertEqual([(layer['index'], layer['emptySlot']) for layer in record['layers']], [(1, True)])
        arrays = glb_mesh_arrays(glb)
        self.assertEqual(arrays['attributeNames'], ['NORMAL', 'POSITION', 'TEXCOORD_0'])
        self.assertEqual(arrays['POSITION'], [float32_point(points[y * native['width'] + x]) for y in range(9) for x in range(9)])
        self.assertEqual((arrays['extras']['maskUvSet'], arrays['extras']['baseLayerUvSet'], arrays['extras']['nativeLayers']), (0, None, []))
        gap_rows = terrain_layer_gap_rows(TILE_ID, SOURCE_IDENTITY, SYNTHETIC_TERRAIN_OBJECT, {0: 'terrain-layer-incomplete:0'}, EVIDENCE)
        tile_row = tile_terrain_row(TILE_ID, SOURCE_IDENTITY, gap_rows, chunk_records, [], EVIDENCE)
        self.assertEqual((tile_row['status'], tile_row['reason']), ('gap', 'terrain-layer-incomplete:0'))

    def test_a_terrain_with_a_placeable_layer_keeps_texcoord_1_from_its_first_layer_byte_for_byte(self):
        ungapped = build_synthetic_chunks(4, 4)[3]['chunk-0-0'][1]
        with_gapped_layer = build_synthetic_chunks(4, 4, layer_indices=(0, 1, 2, 3), texture_only_layer_indices=(3,))[3]['chunk-0-0'][1]
        self.assertEqual(hashlib.sha256(ungapped).hexdigest(), THREE_LAYER_FOUR_SECTOR_CHUNK_GLB_SHA256)
        self.assertEqual(with_gapped_layer, ungapped)
        arrays = glb_mesh_arrays(ungapped)
        self.assertEqual(arrays['attributeNames'], ['NORMAL', 'POSITION', 'TEXCOORD_0', 'TEXCOORD_1'])
        self.assertEqual((arrays['extras']['maskUvSet'], arrays['extras']['baseLayerUvSet']), (0, 1))


class LayerUvGapTests(unittest.TestCase):
    UNVERIFIED_PLACEMENTS = {'non-xy axis': {'TextureMapAxis': 1}, 'texture rotation': {'TextureRotation': 16384.0},
                             'layer rotation': {'LayerRotation': {'Pitch': 0, 'Roll': 0, 'Yaw': 16384}}, 'u pan': {'UPan': 4.0},
                             'v pan': {'VPan': 4.0}, 'zero scale': {'VScale': 0.0}, 'missing scale': {'UScale': None}}

    def test_a_rotated_non_xy_panned_or_badly_scaled_layer_becomes_a_layer_uv_unverified_gap_row_and_the_other_layers_convert(self):
        for case, placement in self.UNVERIFIED_PLACEMENTS.items():
            with self.subTest(case=case):
                serialized_layers = synthetic_serialized_layers((0, 1, 2, 3), placement_overrides={2: placement})
                self.assertEqual(terrain_layer_gap_reasons(serialized_layers), {2: 'terrain-layer-uv-unverified:2'})
                _, _, _, by_chunk, chunk_records = build_synthetic_chunks(4, 4, layer_indices=(0, 1, 2, 3), placement_overrides={2: placement})
                self.assertEqual([layer['index'] for layer in chunk_records[0]['layers']], [0, 1, 3])
                extras = glb_mesh_arrays(by_chunk['chunk-0-0'][1])['extras']
                self.assertEqual(([layer['index'] for layer in extras['nativeLayers']], extras['baseLayerUvSet']), ([0, 1, 3], 1))

    def test_the_uv_rule_reads_only_filled_layers_and_the_incomplete_reason_wins_over_the_uv_reason(self):
        serialized_layers = synthetic_serialized_layers((0, 1, 2), empty_indices=(1,), texture_only_indices=(2,),
                                                        placement_overrides={1: {'UScale': 0.0, 'VScale': 0.0}, 2: {'TextureMapAxis': 2}})
        self.assertEqual(terrain_layer_gap_reasons(serialized_layers), {2: 'terrain-layer-incomplete:2'})

    def test_every_layer_gap_row_is_a_listed_reason_naming_the_terrain_object(self):
        layer_gap_reasons = terrain_layer_gap_reasons(synthetic_serialized_layers((0, 1, 2), texture_only_indices=(0,),
                                                                                  placement_overrides={2: {'TextureMapAxis': 1}}))
        gap_rows = terrain_layer_gap_rows(TILE_ID, SOURCE_IDENTITY, SYNTHETIC_TERRAIN_OBJECT, layer_gap_reasons, EVIDENCE)
        for gap_row in gap_rows:
            validate_gap_row(gap_row)
        self.assertEqual([row['reason'] for row in gap_rows], ['terrain-layer-incomplete:0', 'terrain-layer-uv-unverified:2'])

    def test_an_xy_layer_whose_serialized_matrix_differs_from_the_native_calculation_still_raises(self):
        serialized_layers = synthetic_serialized_layers((0, 1), placement_overrides={1: {'TextureMapAxis': 1}})
        terrain = {'id': f'interlude:{SYNTHETIC_TERRAIN_OBJECT}', 'layers': serialized_layers}
        native = {'object': SYNTHETIC_TERRAIN_OBJECT, 'exportIndex': 1,
                  'toHeightmap': {'origin': [0.0, 0.0, 0.0], 'axes': [[128.0, 0.0, 0.0], [0.0, 128.0, 0.0], [0.0, 0.0, 1.0]]}}
        package = SimpleNamespace(exports=[{'object': SYNTHETIC_TERRAIN_OBJECT}])
        layer_gap_reasons = terrain_layer_gap_reasons(serialized_layers)
        self.assertEqual(layer_gap_reasons, {1: 'terrain-layer-uv-unverified:1'})
        with self.assertRaisesRegex(FormatError, 'Serialized terrain UV matrix differs from native reference calculation'):
            layer_records(terrain, native, package, 'maps/Fixture.unr', layer_gap_reasons)
        every_layer_gapped = synthetic_serialized_layers((0, 1), texture_only_indices=(0,), placement_overrides={1: {'TextureMapAxis': 1}})
        self.assertEqual(layer_records({**terrain, 'layers': every_layer_gapped}, native, package, 'maps/Fixture.unr',
                                       terrain_layer_gap_reasons(every_layer_gapped)), [])


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
