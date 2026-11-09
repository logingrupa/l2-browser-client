import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.tile_manifest_validation import chunk_grid_position, require_sector_range
from world.terrain_coordinates import SOURCE_TO_GLTF
from world.tile_chunk_plan import (CHUNK_PLAN_STEP_ALGORITHM_VERSION, ChunkPlanStepError, first_enabled_player_start, plan_tile_chunks,
                                   read_raw_terrain_record, run_chunk_plan_step)
from synthetic_terrain_fixture import synthetic_native_terrain
from test_world_raw_step import TILE_ID, SyntheticTileTestCase, two_actors_sharing_one_mesh

TERRAIN_ID = 'interlude:Fixture.TerrainInfo0'
TERRAIN_LOCATION = {'X': 16384.0, 'Y': 114688.0, 'Z': 160.5}
TERRAIN_SCALE = {'X': 128.0, 'Y': 128.0, 'Z': 76.0}
CHUNK_PLAN_FOLDER = Path('artifacts/lane-store/world/work/tile__20_21/chunks')
REAL_CHUNK_PLAN_PATH = ROOT / 'artifacts/lane-store/world/work/tile__20_21/chunks/products/chunk-plan.json'


def terrain_actor():
    return {'id': TERRAIN_ID, 'object': 'Fixture.TerrainInfo0', 'classObject': 'Engine.TerrainInfo', 'exportIndex': 1, 'properties': [],
            'sourceTransform': {'Location': {'status': 'serialized', 'value': TERRAIN_LOCATION}}}


def player_start(name, export_index, enabled=None, location=(1.0, 2.0, 3.0)):
    properties = [] if enabled is None else [{'name': 'bEnabled', 'arrayIndex': None, 'value': enabled}]
    return {'id': f'interlude:Fixture.{name}', 'object': f'Fixture.{name}', 'classObject': 'Engine.PlayerStart', 'exportIndex': export_index,
            'properties': properties, 'sourceTransform': {'Location': {'status': 'serialized', 'value': dict(zip('XYZ', location))}}}


def terrain_record():
    return {'id': TERRAIN_ID, 'terrainScale': TERRAIN_SCALE}


def plan_for(sector_columns, sector_rows, actors=(), class_defaults=None):
    all_actors = [terrain_actor(), *actors]
    native = synthetic_native_terrain(sector_columns, sector_rows)
    selection = first_enabled_player_start(all_actors, {'bEnabled': True} if class_defaults is None else class_defaults)
    return plan_tile_chunks(TILE_ID, native, terrain_record(), all_actors, selection)


class ChunkGridTests(unittest.TestCase):
    def test_eight_by_eight_sectors_give_a_two_by_two_grid_in_column_row_order(self):
        plan = plan_for(8, 8)
        self.assertEqual([chunk['chunkId'] for chunk in plan['chunks']], ['chunk-0-0', 'chunk-0-1', 'chunk-1-0', 'chunk-1-1'])
        chunk = next(chunk for chunk in plan['chunks'] if chunk['chunkId'] == 'chunk-1-0')
        self.assertEqual((chunk['column'], chunk['row']), (1, 0))
        self.assertEqual(chunk['sectorRange'], {'firstColumn': 4, 'lastColumn': 7, 'firstRow': 0, 'lastRow': 3})
        self.assertEqual(chunk['sectorRectangle'], {'minOffset': [8, 0], 'maxOffset': [14, 6]})
        self.assertEqual(len(chunk['sectorObjects']), 16)

    def test_six_by_five_sectors_give_edge_chunks_with_fewer_sectors(self):
        plan = plan_for(6, 5)
        chunk = next(chunk for chunk in plan['chunks'] if chunk['chunkId'] == 'chunk-1-1')
        self.assertEqual(chunk['sectorRange'], {'firstColumn': 4, 'lastColumn': 5, 'firstRow': 4, 'lastRow': 4})
        self.assertEqual(chunk['sectorRectangle'], {'minOffset': [8, 8], 'maxOffset': [10, 8]})
        self.assertEqual(chunk['sectorObjects'], ['Fixture.TerrainInfo0.TerrainSector28', 'Fixture.TerrainInfo0.TerrainSector29'])

    def test_every_sector_belongs_to_exactly_one_chunk_ordered_by_native_offset_y_then_x(self):
        native = synthetic_native_terrain(6, 5)
        plan = plan_for(6, 5)
        listed = [name for chunk in plan['chunks'] for name in chunk['sectorObjects']]
        self.assertEqual(sorted(listed), sorted(sector['object'] for sector in native['sectors']))
        offsets = {sector['object']: sector['offset'] for sector in native['sectors']}
        for chunk in plan['chunks']:
            keys = [(offsets[name][1], offsets[name][0]) for name in chunk['sectorObjects']]
            self.assertEqual(keys, sorted(keys))

    def test_every_sector_range_passes_the_tile_chunk_manifest_rule(self):
        for columns, rows in ((8, 8), (6, 5), (16, 16), (1, 1)):
            for chunk in plan_for(columns, rows)['chunks']:
                with self.subTest(grid=(columns, rows), chunk=chunk['chunkId']):
                    position = chunk_grid_position(chunk['chunkId'], 'test')
                    self.assertEqual(position, (chunk['column'], chunk['row']))
                    require_sector_range(chunk['sectorRange'], position, 'test')

    def test_an_incomplete_sector_grid_fails(self):
        native = synthetic_native_terrain(4, 4)
        native['sectors'].pop()
        with self.assertRaisesRegex(FormatError, 'complete sector grid'):
            plan_tile_chunks(TILE_ID, native, terrain_record(), [terrain_actor()], (None, 'player-start-missing'))


class FrameTests(unittest.TestCase):
    def test_frame_holds_the_terrain_info_name_location_scale_dimensions_and_grid(self):
        self.assertEqual(plan_for(6, 5)['frame'], {
            'terrainInfo': 'Fixture.TerrainInfo0', 'location': [16384.0, 114688.0, 160.5], 'terrainScale': [128.0, 128.0, 76.0],
            'heightmapDimensions': [13, 11], 'sectorGrid': [6, 5], 'sourceToGltf': SOURCE_TO_GLTF})

    def test_two_plans_of_the_same_source_are_byte_identical(self):
        actors = [player_start('PlayerStart0', 7)]
        self.assertEqual(canonical_json_bytes(plan_for(8, 8, actors)), canonical_json_bytes(plan_for(8, 8, actors)))
        self.assertEqual(CHUNK_PLAN_STEP_ALGORITHM_VERSION, 1)


class AnchorTests(unittest.TestCase):
    def test_the_anchor_is_the_first_player_start_in_export_order_whose_enabled_flag_is_true(self):
        actors = [player_start('PlayerStart9', 30, location=(9.0, 9.0, 9.0)), player_start('PlayerStart3', 12, location=(5.0, 6.0, 7.0))]
        plan = plan_for(4, 4, actors)
        self.assertEqual(plan['anchor'], {'playerStart': 'Fixture.PlayerStart3', 'location': [5.0, 6.0, 7.0]})
        self.assertIsNone(plan['anchorGap'])

    def test_an_explicit_false_enabled_tag_is_skipped(self):
        actors = [player_start('PlayerStart0', 10, enabled=False), player_start('PlayerStart1', 11)]
        self.assertEqual(plan_for(4, 4, actors)['anchor']['playerStart'], 'Fixture.PlayerStart1')

    def test_an_own_true_tag_wins_over_a_false_class_default(self):
        actors = [player_start('PlayerStart0', 10), player_start('PlayerStart1', 11, enabled=True)]
        self.assertEqual(plan_for(4, 4, actors, {'bEnabled': False})['anchor']['playerStart'], 'Fixture.PlayerStart1')

    def test_an_unresolved_enabled_default_gives_a_null_anchor_instead_of_skipping(self):
        actors = [player_start('PlayerStart0', 10), player_start('PlayerStart1', 11, enabled=True)]
        plan = plan_for(4, 4, actors, {})
        self.assertIsNone(plan['anchor'])
        self.assertEqual(plan['anchorGap'], {'reason': 'actor-default-unresolved:bEnabled'})

    def test_a_map_without_an_enabled_player_start_gives_player_start_missing(self):
        for actors in ((), (player_start('PlayerStart0', 10, enabled=False),)):
            with self.subTest(actors=len(actors)):
                plan = plan_for(4, 4, actors)
                self.assertIsNone(plan['anchor'])
                self.assertEqual(plan['anchorGap'], {'reason': 'player-start-missing'})


class RawTerrainRecordTests(unittest.TestCase):
    def test_a_raw_unit_without_terrain_info_or_height_texture_has_no_terrain_record(self):
        with tempfile.TemporaryDirectory() as folder:
            products = Path(folder)
            for terrains, expected in (([], None), ([{'id': TERRAIN_ID, 'bitmaps': []}], None),
                                       ([{'id': TERRAIN_ID, 'height': {'mips': []}}], {'id': TERRAIN_ID, 'height': {'mips': []}})):
                with self.subTest(terrains=terrains):
                    (products / 'terrain.json').write_text(json.dumps(terrains), encoding='utf-8')
                    self.assertEqual(read_raw_terrain_record(products), expected)


class ChunkPlanStepTests(SyntheticTileTestCase):
    def test_an_unsealed_raw_unit_is_refused(self):
        self.write_client(two_actors_sharing_one_mesh())
        with self.assertRaisesRegex(ChunkPlanStepError, 'not sealed'):
            run_chunk_plan_step(self.project_root, self.client, TILE_ID)

    def test_a_sealed_raw_unit_without_terrain_info_gives_a_gap_row_and_no_chunk_plan(self):
        self.write_client(two_actors_sharing_one_mesh())
        self.assertEqual(self.run_step()['status'], 'pass')
        row = run_chunk_plan_step(self.project_root, self.client, TILE_ID)
        self.assertEqual((row['step'], row['status'], row['reason']), ('chunks', 'gap', 'terrain-height-package-missing'))
        self.assertEqual(row['evidence'], 'work/tile__20_21/raw/products/terrain.json')
        self.assertFalse((self.project_root / CHUNK_PLAN_FOLDER).exists())


@unittest.skipUnless(REAL_CHUNK_PLAN_PATH.is_file(), 'the 20_21 chunk plan unit is not sealed in this checkout')
class RealTileChunkPlanTests(unittest.TestCase):
    def test_the_sealed_20_21_plan_covers_the_sixteen_by_sixteen_sector_grid_with_an_enabled_anchor(self):
        plan = json.loads(REAL_CHUNK_PLAN_PATH.read_text(encoding='utf-8'))
        self.assertEqual(plan['frame']['terrainInfo'], '20_21.TerrainInfo0')
        self.assertEqual(plan['frame']['sectorGrid'], [16, 16])
        self.assertEqual(len(plan['chunks']), 16)
        self.assertEqual(sum(len(chunk['sectorObjects']) for chunk in plan['chunks']), 256)
        self.assertEqual(plan['anchor']['playerStart'], '20_21.PlayerStart2')
        positions = [(chunk['column'], chunk['row']) for chunk in plan['chunks']]
        self.assertEqual(positions, sorted(positions))


if __name__ == '__main__':
    unittest.main()
