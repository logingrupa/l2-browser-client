import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.catalog_writer import read_store_catalog
from native_store.store_paths import lane_store_root
from native_store.tile_manifest_validation import TileManifestError, validate_tile_chunk_manifest, validate_tile_manifest
from world import tile_manifest_step
from world.terrain_chunk_step import TerrainUnit, build_tile_terrain_chunks, terrain_step_ledger, tile_layer_summaries
from world.tile_chunk_plan import first_enabled_player_start, plan_tile_chunks
from world.tile_manifest_step import (PENDING_TILE_STEPS, TILE_CATALOG_CAPACITY, TILE_MANIFEST_STEP_ALGORITHM_VERSION, TileManifestStepError,
                                      build_tile_chunk_manifest, build_tile_manifest, run_tile_manifest_step, tile_store_files)
from synthetic_terrain_fixture import synthetic_layer_records, synthetic_serialized_layers, synthetic_terrain, synthetic_topology_words

FIXTURE_TILE_ID = '00_00'
FIXTURE_SOURCE_IDENTITY = {'path': 'maps/00_00.unr', 'sha256': hashlib.sha256(b'synthetic tile source for the lane store fixture').hexdigest()}
FIXTURE_EVIDENCE = 'work/tile__00_00/manifest/receipt.json'
FIXTURE_LANE_STORE_ROOT = ROOT / 'tests/fixtures/lane-store/l2'
REAL_TILE_ID = '20_21'
REAL_SOURCE_IDENTITY = {'path': 'maps/20_21.unr', 'sha256': 'e123be27672ce30235829fc09a3da0aa381e7be14add0fe30ce15f1dd4379f93'}
TERRAIN_ID = 'interlude:Fixture.TerrainInfo0'
EVIDENCE = 'work/tile__20_21/manifest/receipt.json'


def fixture_actors(anchor_location):
    terrain = {'id': TERRAIN_ID, 'object': 'Fixture.TerrainInfo0', 'classObject': 'Engine.TerrainInfo', 'exportIndex': 1, 'properties': [],
               'sourceTransform': {'Location': {'status': 'serialized', 'value': {'X': 0.0, 'Y': 0.0, 'Z': 0.0}}}}
    if anchor_location is None:
        return [terrain]
    player_start = {'id': 'interlude:Fixture.PlayerStart0', 'object': 'Fixture.PlayerStart0', 'classObject': 'Engine.PlayerStart',
                    'exportIndex': 2, 'properties': [{'name': 'bEnabled', 'arrayIndex': None, 'value': True}],
                    'sourceTransform': {'Location': {'status': 'serialized', 'value': dict(zip('XYZ', anchor_location))}}}
    return [terrain, player_start]


def synthetic_tile(tile_id, sector_columns, sector_rows, anchor_location=(128.0, 128.0, 200.0), words=None):
    native, points = synthetic_terrain(sector_columns, sector_rows)
    actors = fixture_actors(anchor_location)
    terrain_record = {'id': TERRAIN_ID, 'terrainScale': {'X': 128.0, 'Y': 128.0, 'Z': 76.0}}
    plan = plan_tile_chunks(tile_id, native, terrain_record, actors, first_enabled_player_start(actors, {}))
    layers = synthetic_layer_records([0])
    results = build_tile_terrain_chunks(tile_id, native, points, words or synthetic_topology_words(native), layers,
                                        tile_layer_summaries(synthetic_serialized_layers([0]), layers), plan['chunks'],
                                        FIXTURE_SOURCE_IDENTITY, FIXTURE_EVIDENCE)
    return plan, [record for record, _ in results], {record['chunkId']: glb for record, glb in results if glb is not None}


def lane_store_fixture_tile():
    plan, records, glbs = synthetic_tile(FIXTURE_TILE_ID, 1, 1)
    return tile_store_files(FIXTURE_TILE_ID, FIXTURE_SOURCE_IDENTITY, plan, records, glbs, FIXTURE_EVIDENCE)


def hidden_terrain_record(record, gap_rows=()):
    return {**record, 'terrain': None, 'triangleCount': 0, 'gapRows': list(gap_rows)}


def decode_failed_row(sector_object):
    return {'key': f'tile:{REAL_TILE_ID}', 'part': 'world', 'step': 'terrain', 'status': 'gap', 'reason': 'decode-failed:sector bounds differ',
            'sourceIdentity': {**REAL_SOURCE_IDENTITY, 'object': sector_object}, 'evidence': EVIDENCE}


class ChunkManifestTests(unittest.TestCase):
    def setUp(self):
        self.plan, self.records, self.glbs = synthetic_tile(REAL_TILE_ID, 8, 8)

    def test_a_chunk_manifest_pins_its_terrain_by_the_glb_hash_and_lists_the_pending_steps(self):
        manifest = build_tile_chunk_manifest(REAL_TILE_ID, self.records[0], self.plan['chunks'][0], REAL_SOURCE_IDENTITY, EVIDENCE)
        terrain_sha256 = hashlib.sha256(self.glbs['chunk-0-0']).hexdigest()
        self.assertEqual((manifest['kind'], manifest['schemaVersion'], manifest['tileId'], manifest['chunkId']),
                         ('native-tile-chunk-runtime', 1, REAL_TILE_ID, 'chunk-0-0'))
        self.assertEqual(manifest['sectorRange'], self.plan['chunks'][0]['sectorRange'])
        self.assertEqual(manifest['terrain'], {'resource': f'/l2/maps/{terrain_sha256}/native-tile-chunk-terrain/terrain.glb',
                                               'sha256': terrain_sha256, 'maskUvRule': 'extrapolated'})
        self.assertEqual((manifest['models'], manifest['bsp'], manifest['collision']), ([], None, None))
        self.assertEqual([(row['step'], row['status'], row['reason']) for row in manifest['gaps']],
                         [(step, 'pending', f'step-pending:{step}') for step in ('bsp', 'collision', 'meshes', 'terrain-material')])
        self.assertIs(validate_tile_chunk_manifest(manifest), manifest)

    def test_a_null_terrain_without_chunk_gap_rows_gets_the_all_hidden_reason_on_its_first_sector(self):
        record = hidden_terrain_record(self.records[0])
        manifest = build_tile_chunk_manifest(REAL_TILE_ID, record, self.plan['chunks'][0], REAL_SOURCE_IDENTITY, EVIDENCE)
        terrain_rows = [row for row in manifest['gaps'] if row['step'] == 'terrain']
        self.assertIsNone(manifest['terrain'])
        self.assertEqual([(row['status'], row['reason'], row['sourceIdentity']['object']) for row in terrain_rows],
                         [('gap', 'terrain-quads-all-hidden', self.plan['chunks'][0]['sectorObjects'][0])])

    def test_a_null_terrain_keeps_its_decode_failed_chunk_row(self):
        failed_row = decode_failed_row(self.plan['chunks'][0]['sectorObjects'][3])
        record = hidden_terrain_record(self.records[0], [failed_row])
        manifest = build_tile_chunk_manifest(REAL_TILE_ID, record, self.plan['chunks'][0], REAL_SOURCE_IDENTITY, EVIDENCE)
        self.assertEqual([row for row in manifest['gaps'] if row['step'] == 'terrain'], [failed_row])

    def test_the_validator_refuses_a_null_terrain_without_its_terrain_row(self):
        manifest = build_tile_chunk_manifest(REAL_TILE_ID, hidden_terrain_record(self.records[0]), self.plan['chunks'][0],
                                             REAL_SOURCE_IDENTITY, EVIDENCE)
        manifest['gaps'] = [row for row in manifest['gaps'] if row['step'] != 'terrain']
        with self.assertRaisesRegex(TileManifestError, 'has no terrain'):
            validate_tile_chunk_manifest(manifest)

    def test_a_terrain_record_of_another_chunk_is_refused(self):
        with self.assertRaisesRegex(TileManifestStepError, 'does not match chunk plan entry'):
            build_tile_chunk_manifest(REAL_TILE_ID, self.records[1], self.plan['chunks'][0], REAL_SOURCE_IDENTITY, EVIDENCE)


class TileManifestTests(unittest.TestCase):
    def test_a_two_by_two_plan_lists_its_chunks_in_column_row_order_with_hash_addressed_paths(self):
        plan, records, glbs = synthetic_tile(REAL_TILE_ID, 8, 8)
        files, record = tile_store_files(REAL_TILE_ID, REAL_SOURCE_IDENTITY, plan, records, glbs, EVIDENCE)
        tile = json.loads(files[record['manifest'][len('/l2/'):]])
        self.assertEqual([chunk['chunkId'] for chunk in tile['chunks']], ['chunk-0-0', 'chunk-0-1', 'chunk-1-0', 'chunk-1-1'])
        for chunk in tile['chunks']:
            with self.subTest(chunk=chunk['chunkId']):
                payload = files[chunk['manifest'][len('/l2/'):]]
                self.assertEqual(chunk['manifest'], f'/l2/maps/{hashlib.sha256(payload).hexdigest()}/native-tile-chunk-runtime/manifest.json')
                self.assertEqual((chunk['manifestSha256'], chunk['manifestBytes']), (hashlib.sha256(payload).hexdigest(), len(payload)))
        self.assertEqual(tile['frame'], {'terrainInfo': 'Fixture.TerrainInfo0', 'location': [0.0, 0.0, 0.0], 'terrainScale': [128.0, 128.0, 76.0]})
        self.assertEqual(tile['anchor'], {'playerStart': 'Fixture.PlayerStart0', 'location': [128.0, 128.0, 200.0]})
        self.assertEqual(sorted(row['step'] for row in tile['gaps']), sorted(PENDING_TILE_STEPS))
        self.assertEqual({row['status'] for row in tile['gaps']}, {'pending'})
        self.assertEqual(record['manifest'], f'/l2/tiles/{record["manifestSha256"]}/tile.json')
        self.assertIs(validate_tile_manifest(tile), tile)

    def test_build_tile_manifest_keeps_only_the_three_frame_fields(self):
        plan, records, glbs = synthetic_tile(REAL_TILE_ID, 4, 4)
        files, _ = tile_store_files(REAL_TILE_ID, REAL_SOURCE_IDENTITY, plan, records, glbs, EVIDENCE)
        chunk_path = next(path for path in files if path.endswith('/native-tile-chunk-runtime/manifest.json'))
        payload = files[chunk_path]
        chunk_record = {'chunkId': 'chunk-0-0', 'manifest': '/l2/' + chunk_path, 'manifestSha256': hashlib.sha256(payload).hexdigest(),
                        'manifestBytes': len(payload)}
        tile = build_tile_manifest(REAL_TILE_ID, REAL_SOURCE_IDENTITY, plan, [chunk_record], EVIDENCE)
        self.assertEqual(list(tile['frame']), ['terrainInfo', 'location', 'terrainScale'])

    def test_a_glb_that_differs_from_its_terrain_record_is_refused(self):
        plan, records, glbs = synthetic_tile(REAL_TILE_ID, 4, 4)
        with self.assertRaisesRegex(TileManifestStepError, 'differs from its terrain record'):
            tile_store_files(REAL_TILE_ID, REAL_SOURCE_IDENTITY, plan, records, {'chunk-0-0': glbs['chunk-0-0'] + b' '}, EVIDENCE)

    def test_terrain_records_out_of_chunk_plan_order_are_refused(self):
        plan, records, glbs = synthetic_tile(REAL_TILE_ID, 8, 8)
        with self.assertRaisesRegex(TileManifestStepError, 'in order'):
            tile_store_files(REAL_TILE_ID, REAL_SOURCE_IDENTITY, plan, list(reversed(records)), glbs, EVIDENCE)

    def test_the_step_constants(self):
        self.assertEqual((TILE_MANIFEST_STEP_ALGORITHM_VERSION, TILE_CATALOG_CAPACITY), (2, 163))
        self.assertEqual(PENDING_TILE_STEPS, ('meshes', 'bsp', 'collision', 'movers', 'sky', 'audio', 'minimap', 'terrain-material'))


class LaneStoreFixtureTileTests(unittest.TestCase):
    def test_the_committed_fixture_tile_is_regenerated_byte_for_byte(self):
        files, _ = lane_store_fixture_tile()
        self.assertEqual(len(files), 3)
        for relative_path, payload in files.items():
            with self.subTest(path=relative_path):
                self.assertEqual((FIXTURE_LANE_STORE_ROOT / relative_path).read_bytes(), payload)

    def test_the_fixture_catalog_does_not_list_the_fixture_tile(self):
        catalog = json.loads((FIXTURE_LANE_STORE_ROOT / 'catalog.json').read_text(encoding='utf-8'))
        self.assertNotIn('tiles', catalog)


class RunTileManifestStepTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        self.store_root = self.project_root / 'artifacts/lane-store/world/l2'

    def sealed_terrain(self, anchor_location=(128.0, 128.0, 200.0)):
        plan, records, glbs = synthetic_tile(REAL_TILE_ID, 8, 8, anchor_location)
        products_directory = self.project_root / 'terrain-products'
        for chunk_id, glb in glbs.items():
            (products_directory / chunk_id).mkdir(parents=True, exist_ok=True)
            (products_directory / chunk_id / 'terrain.glb').write_bytes(glb)
        unit = TerrainUnit(terrain_step_ledger(self.project_root), f'tile:{REAL_TILE_ID}', 'a' * 64, {}, [], 'b' * 64, plan, None, None)
        return patch.multiple(tile_manifest_step, sealed_terrain_chunks=MagicMock(return_value=(unit, records, products_directory)),
                              sealed_static_meshes=MagicMock(return_value=(None, None)))

    def store_snapshot(self):
        return {path.relative_to(self.project_root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in sorted(self.project_root.joinpath('artifacts').rglob('*')) if path.is_file()}

    def test_the_step_writes_the_tile_and_its_catalog_record_and_returns_one_row_per_step(self):
        with self.sealed_terrain():
            rows = run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)
        catalog, _ = read_store_catalog(lane_store_root(self.project_root, 'world'))
        self.assertEqual([record['id'] for record in catalog['tiles']], [REAL_TILE_ID])
        tile_path = self.store_root / catalog['tiles'][0]['manifest'][len('/l2/'):]
        self.assertEqual(hashlib.sha256(tile_path.read_bytes()).hexdigest(), catalog['tiles'][0]['manifestSha256'])
        self.assertEqual([(row['step'], row['status']) for row in rows], [('manifest', 'pass'), *((step, 'pending') for step in PENDING_TILE_STEPS)])
        self.assertEqual(len({row['step'] for row in rows}), len(rows))
        self.assertTrue(all(row['key'] == f'tile:{REAL_TILE_ID}' for row in rows))

    def test_a_second_run_is_sealed_and_writes_nothing(self):
        with self.sealed_terrain():
            first_rows = run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)
            before = self.store_snapshot()
            second_rows = run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)
        self.assertEqual(self.store_snapshot(), before)
        self.assertEqual(second_rows, first_rows)

    def test_a_null_anchor_writes_no_tile_and_returns_only_a_manifest_gap_row(self):
        with self.sealed_terrain(anchor_location=None):
            rows = run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)
        self.assertEqual([(row['step'], row['status'], row['reason']) for row in rows], [('manifest', 'gap', 'player-start-missing')])
        self.assertFalse(self.store_root.exists())

    def test_an_output_other_than_the_world_lane_store_is_refused(self):
        with self.sealed_terrain(), self.assertRaisesRegex(TileManifestStepError, 'sealed only in the world lane store'):
            run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.project_root / 'artifacts/elsewhere/l2')

    def test_an_output_outside_the_artifacts_folder_is_refused(self):
        with self.sealed_terrain(), self.assertRaises(ValueError):
            run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.project_root / 'public/l2')

    def test_a_differing_existing_tile_record_is_preserved(self):
        with self.sealed_terrain():
            run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)
        catalog_path = self.store_root / 'catalog.json'
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
        changed = copy.deepcopy(catalog)
        changed['tiles'][0]['manifestBytes'] += 1
        catalog_path.write_text(json.dumps(changed), encoding='utf-8')
        for seal in self.project_root.rglob('manifest/complete.json'):
            seal.unlink()
        with self.sealed_terrain(), self.assertRaisesRegex(ValueError, 'differs; preserved'):
            run_tile_manifest_step(self.project_root, REAL_TILE_ID, self.store_root)


if __name__ == '__main__':
    unittest.main()
