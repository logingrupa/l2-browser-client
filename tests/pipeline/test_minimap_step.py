import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from native_store.store_paths import lane_work_root
from native_store.tile_manifest_validation import (TILE_MANIFEST_KIND, TILE_MANIFEST_SCHEMA_VERSION, TileManifestError, load_tile_manifest_vocabulary,
                                                   validate_tile_manifest)
from native_store.unit_ledger import UnitLedger
from world.minimap_join import RADAR_PACKAGE_ROLE, TOWN_MAP_PACKAGE_ROLE, ZONE_NAME_PACKAGE_ROLE, ZONENAME_TABLE_ROLE, HUNTINGZONE_TABLE_ROLE
from world import minimap_step
from world.minimap_sources import MinimapSources, locked_tile_ids, tile_frame_extent
from world.minimap_step import MINIMAP_STEP_NAME, MinimapStepError, run_minimap_step, sealed_minimap
from world.raw_map_step import (PRODUCTS_FOLDER_NAME, RAW_MAP_STEP_ALGORITHM_VERSION, RAW_STEP_NAME, raw_map_recipe, read_tile_map_lock_record,
                                tile_unit_key)
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import ELIGIBLE_STATUS, TILE_CENSUS_RELATIVE_PATH
from world.tile_chunk_plan import CHUNK_PLAN_PRODUCT_NAME, CHUNK_PLAN_STEP_ALGORITHM_VERSION, CHUNK_PLAN_STEP_NAME, chunk_plan_unit_config
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME, tile_resources
from world.tile_step_registry import TILE_STEP_NAMES

TILE_ID = '20_21'
CLIENT_ROOT = Path('E:/Lineage2-client')
PACKAGE_SHA256 = '3' * 64
TABLE_SHA256 = '4' * 64
CHUNK_PLAN_FRAME = {'heightmapDimensions': [256, 256], 'location': [16384.0, 114688.0, 160.0], 'terrainScale': [128.0, 128.0, 76.0],
                    'terrainInfo': '20_21.TerrainInfo0'}


def png_header(width, height):
    return b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', width, height) + bytes(5)


def seal_product(project_root, step, version, config, product_name, product_bytes):
    lock_record = read_tile_map_lock_record(TILE_ID)
    ledger = UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), step, version)
    fingerprint = ledger.unit_fingerprint([lock_record['eSha256']], config)
    products = ledger.begin(tile_unit_key(TILE_ID), fingerprint) / PRODUCTS_FOLDER_NAME
    products.mkdir()
    (products / product_name).write_bytes(product_bytes)
    output = {'path': (products / product_name).relative_to(ledger.lane_folder).as_posix(), 'sha256': hashlib.sha256(product_bytes).hexdigest(),
              'bytes': len(product_bytes)}
    ledger.seal(tile_unit_key(TILE_ID), fingerprint, {'config': config, 'inputs': [{'path': f'maps/{TILE_ID}.unr', 'sha256': lock_record['eSha256']}],
                                                       'outputs': [output], 'gapRows': []})
    return fingerprint


def write_project(project_root, census_status=ELIGIBLE_STATUS, seal_raw=True, seal_chunks=True):
    census_path = Path(project_root) / TILE_CENSUS_RELATIVE_PATH
    census_path.parent.mkdir(parents=True)
    row = {'key': f'tile:{TILE_ID}', 'map': f'maps/{TILE_ID}.unr', 'status': census_status, 'reason': 'map-version-unsupported:1'}
    census_path.write_text(json.dumps({'maps': [row]}), encoding='utf-8')
    if not seal_raw:
        return
    raw_fingerprint = seal_product(project_root, RAW_STEP_NAME, RAW_MAP_STEP_ALGORITHM_VERSION, raw_map_recipe(TILE_ID, read_tile_map_lock_record(TILE_ID)),
                                   'terrain.json', b'[]')
    if seal_chunks:
        seal_product(project_root, CHUNK_PLAN_STEP_NAME, CHUNK_PLAN_STEP_ALGORITHM_VERSION, chunk_plan_unit_config(raw_fingerprint), CHUNK_PLAN_PRODUCT_NAME,
                     json.dumps({'tileId': TILE_ID, 'frame': CHUNK_PLAN_FRAME}).encode('utf-8'))


def texture_package(name, export_names, version):
    return {'path': f'systextures/{name}.utx', 'sha256': PACKAGE_SHA256, 'packageVersion': version[0], 'licensee': version[1], 'packageName': name,
            'exports': [{'exportIndex': index, 'name': export_name, 'object': f'{name}.Maps.{export_name}'} for index, export_name in enumerate(export_names, 1)]}


def synthetic_sources(radar_version=(123, 28)):
    table = lambda name, rows: {'table': name, 'path': f'system/{name}-e.dat', 'sha256': TABLE_SHA256, 'rows': rows}
    return MinimapSources(
        {RADAR_PACKAGE_ROLE: texture_package('Radar', [TILE_ID], radar_version), TOWN_MAP_PACKAGE_ROLE: texture_package('town_map', [], (123, 23)),
         ZONE_NAME_PACKAGE_ROLE: texture_package('l2zonename', [TILE_ID], (123, 28))},
        {ZONENAME_TABLE_ROLE: table('zonename', [{'ID': 1, 'MapX': 20, 'MapY': 21, 'Name': 'Gludio Territory', 'map': ''}]),
         HUNTINGZONE_TABLE_ROLE: table('huntingzone', [{'id': 4, 'name': 'Cruma Marshlands', 'loc': {'start_npc_x': 5106.0, 'start_npc_y': 126916.0,
                                                                                                      'start_npc_z': -3664.0}}])})


class SyntheticTextureConverter:
    def __init__(self, output_root, dimensions=(256, 256)):
        self.output_root, self.dimensions, self.requests = Path(output_root), dimensions, []

    def convert(self, request):
        self.requests.append(request)
        archive = b'synthetic archive of ' + request['object'].encode('utf-8')
        target = self.output_root / hashlib.sha256(archive).hexdigest()
        target.mkdir(parents=True, exist_ok=True)
        (target / 'asset.l2asset').write_bytes(archive)
        (target / 'texture.png').write_bytes(png_header(*self.dimensions))
        return {'file': str(target / 'asset.l2asset'), 'sha256': hashlib.sha256(archive).hexdigest()}


class FailingTextureConverter:
    def __init__(self, error):
        self.error = error

    def convert(self, request):
        raise self.error


class MisreportedArchiveConverter(SyntheticTextureConverter):
    def convert(self, request):
        return {**super().convert(request), 'sha256': '0' * 64}


class MinimapStepTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temporary_directory.name)
        self.converter = SyntheticTextureConverter(self.project_root / 'converter')

    def tearDown(self):
        self.temporary_directory.cleanup()

    def read_manifest(self):
        _, product = sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID))
        store_root = self.project_root / 'artifacts' / 'lane-store' / WORLD_LANE_NAME
        return product, json.loads((store_root / product['manifest']['resource'].removeprefix('/')).read_bytes())

    def test_the_step_writes_the_manifest_seals_the_unit_and_skips_on_rerun(self):
        write_project(self.project_root)
        row = run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), self.converter)
        self.assertEqual((row['step'], row['status'], row['reason']), (MINIMAP_STEP_NAME, 'pass', None))
        product, manifest = self.read_manifest()
        self.assertRegex(product['manifest']['resource'], r'^/l2/maps/[a-f0-9]{64}/native-tile-minimap/manifest\.json$')
        self.assertEqual((manifest['kind'], manifest['schemaVersion'], manifest['tileId']), ('native-tile-minimap', 1, TILE_ID))
        self.assertEqual(manifest['radarTexture']['rule'], 'tile-id')
        self.assertEqual(manifest['radarTexture']['archive'], f'/l2/{manifest["radarTexture"]["archiveSha256"]}/asset.l2asset')
        self.assertEqual(manifest['projection']['frameMinimumNative'], [0.0, 98304.0])
        self.assertEqual(manifest['projection']['frameMaximumNative'], [32640.0, 130944.0])
        self.assertEqual([zone['id'] for zone in manifest['zones']], [1])
        self.assertEqual([zone['id'] for zone in manifest['huntingZones']], [4])
        self.assertEqual(manifest['labels'], {'schemaFieldMeaning': 'schema field name, meaning unverified on IMPORTA'})
        store_root = self.project_root / 'artifacts' / 'lane-store' / WORLD_LANE_NAME / 'l2'
        self.assertTrue((store_root / manifest['radarTexture']['archiveSha256'] / 'asset.l2asset').is_file())
        rerun = run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), self.converter)
        self.assertEqual(rerun['status'], 'pass')
        self.assertEqual(len(self.converter.requests), 1)

    def test_a_changed_converter_implementation_reconverts_a_sealed_tile(self):
        write_project(self.project_root)
        with mock.patch.object(minimap_step, 'implementation_hash', return_value='a' * 64):
            run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), self.converter)
        with mock.patch.object(minimap_step, 'implementation_hash', return_value='b' * 64):
            rerun = run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), self.converter)
        self.assertEqual(rerun['status'], 'pass')
        self.assertEqual(len(self.converter.requests), 2)

    def test_a_converter_refusal_of_the_radar_texture_is_a_sealed_decode_gap(self):
        write_project(self.project_root)
        converter = FailingTextureConverter(ValueError('UModel failed or reported an error; inspect export.log'))
        row = run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), converter)
        self.assertEqual((row['status'], row['reason']), ('gap', 'decode-failed:ValueError:UModel failed or reported an error'))
        self.assertIsNotNone(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID))[0])

    def test_an_environment_failure_during_radar_conversion_propagates_and_leaves_the_unit_unsealed(self):
        write_project(self.project_root)
        converter = FailingTextureConverter(PermissionError('umodel.exe is locked'))
        with self.assertRaises(PermissionError):
            run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), converter)
        self.assertEqual(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID)), (None, None))

    def test_a_converted_archive_that_differs_from_its_reported_hash_propagates_and_leaves_the_unit_unsealed(self):
        write_project(self.project_root)
        converter = MisreportedArchiveConverter(self.project_root / 'converter')
        with self.assertRaisesRegex(MinimapStepError, 'differs from its reported SHA-256'):
            run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources(), converter)
        self.assertEqual(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID)), (None, None))

    def test_a_radar_package_outside_the_reviewed_versions_is_a_licensee_gap_with_no_texture_output(self):
        write_project(self.project_root)
        row = run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, synthetic_sources((118, 11)), self.converter)
        self.assertEqual((row['status'], row['reason']), ('gap', 'texture-licensee-unsupported:118/11'))
        _, manifest = self.read_manifest()
        self.assertIsNone(manifest['radarTexture'])
        self.assertIn('texture-licensee-unsupported:118/11', [gap['reason'] for gap in manifest['gaps']])
        self.assertEqual(self.converter.requests, [])

    def test_a_census_gap_tile_returns_its_census_gap_without_touching_the_client(self):
        write_project(self.project_root, census_status='gap', seal_raw=False)
        row = run_minimap_step(self.project_root, self.project_root / 'no-client', TILE_ID)
        self.assertEqual((row['status'], row['reason']), ('gap', 'map-version-unsupported:1'))

    def test_an_eligible_tile_without_a_sealed_raw_or_chunk_step_is_pending_on_that_step(self):
        write_project(self.project_root, seal_raw=False)
        row = run_minimap_step(self.project_root, self.project_root / 'no-client', TILE_ID)
        self.assertEqual((row['status'], row['reason']), ('pending', 'upstream-step-failed:raw'))

    def test_the_frame_extent_spans_the_heightmap_vertices_of_the_terrain_info_frame(self):
        self.assertEqual(tile_frame_extent(CHUNK_PLAN_FRAME), {'frameMinimumNative': [0.0, 98304.0], 'frameMaximumNative': [32640.0, 130944.0]})


class MinimapRegistrationTests(unittest.TestCase):
    def test_the_minimap_step_runs_after_audio_and_before_the_tile_manifest(self):
        self.assertLess(TILE_STEP_NAMES.index('audio'), TILE_STEP_NAMES.index(MINIMAP_STEP_NAME))
        self.assertEqual(TILE_STEP_NAMES.index(MINIMAP_STEP_NAME) + 1, TILE_STEP_NAMES.index(TILE_MANIFEST_STEP_NAME))

    def test_every_minimap_gap_reason_is_listed(self):
        patterns = load_gap_reason_patterns()
        for what in ('radar-texture', 'radar-texture-conflict', 'zone-grid', 'zone-rows', 'hunting-zone-rows', 'projection', 'source-package-absent'):
            self.assertTrue(is_listed_reason(f'minimap-join-unresolved:{what}', patterns), what)
        self.assertTrue(is_listed_reason('texture-licensee-unsupported:118/11', patterns))

    def test_the_lock_names_the_153_locked_tiles(self):
        self.assertEqual(len(locked_tile_ids()), 153)

    def synthetic_tile_manifest(self):
        sha256 = '5' * 64
        minimap = {'manifest': {'resource': f'/l2/maps/{sha256}/native-tile-minimap/manifest.json', 'sha256': sha256, 'bytes': 2592}}
        return {'kind': TILE_MANIFEST_KIND, 'schemaVersion': TILE_MANIFEST_SCHEMA_VERSION, 'tileId': TILE_ID, 'sourceMap': f'maps/{TILE_ID}.unr',
                'sourceSha256': '6' * 64, 'frame': {'terrainInfo': '20_21.TerrainInfo0', 'location': [0.0, 0.0, 0.0], 'terrainScale': [1.0, 1.0, 1.0]},
                'anchor': {'playerStart': '20_21.PlayerStart0', 'location': [0.0, 0.0, 0.0]},
                'chunks': [{'chunkId': 'chunk-0-0', 'manifest': f'/l2/maps/{"7" * 64}/native-tile-chunk-runtime/manifest.json', 'manifestSha256': '7' * 64,
                            'manifestBytes': 100}],
                'resources': tile_resources(None, None, minimap=minimap), 'gaps': []}

    def test_the_repository_vocabulary_accepts_a_minimap_resource_and_one_without_minimap_refuses_it(self):
        manifest = self.synthetic_tile_manifest()
        self.assertEqual([resource['kind'] for resource in validate_tile_manifest(manifest, load_tile_manifest_vocabulary())['resources']], ['minimap'])
        with tempfile.TemporaryDirectory() as directory:
            vocabulary = json.loads((ROOT / 'recipes' / 'world' / 'tile-manifest-vocabulary.json').read_text(encoding='utf-8'))
            vocabulary['resourceKinds'] = [kind for kind in vocabulary['resourceKinds'] if kind != 'minimap']
            vocabulary_path = Path(directory) / 'recipes' / 'world' / 'tile-manifest-vocabulary.json'
            vocabulary_path.parent.mkdir(parents=True)
            vocabulary_path.write_text(json.dumps(vocabulary), encoding='utf-8')
            with self.assertRaises(TileManifestError):
                validate_tile_manifest(manifest, load_tile_manifest_vocabulary(directory))


@unittest.skipUnless(CLIENT_ROOT.is_dir(), 'the reference client E:/Lineage2-client is absent on this host')
class RealClientMinimapTests(unittest.TestCase):
    def test_tile_20_21_joins_its_zone_name_texture_by_tile_id_and_lists_its_radar_gap(self):
        from world.minimap_step import join_tile_minimap
        from world.minimap_step import read_minimap_sources
        tile = join_tile_minimap(TILE_ID, tile_frame_extent(CHUNK_PLAN_FRAME), read_minimap_sources(CLIENT_ROOT.resolve()))
        self.assertEqual([(item['object'], item['rule']) for item in tile['zoneNameTextures']], [('l2zonename.20_21', 'tile-id')])
        self.assertIn('minimap-join-unresolved:radar-texture', [gap['reason'] for gap in tile['gaps']])


if __name__ == '__main__':
    unittest.main()
