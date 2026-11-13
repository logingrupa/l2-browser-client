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
sys.path.insert(0, str(Path(__file__).parent))
from minimap_route_fixture import seal_synthetic_minimap_route
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from native_store.store_paths import lane_work_root
from native_store.tile_manifest_validation import (TILE_MANIFEST_KIND, TILE_MANIFEST_SCHEMA_VERSION, TileManifestError, load_tile_manifest_vocabulary,
                                                   validate_tile_manifest)
from native_store.unit_ledger import UnitLedger
from world import minimap_route_step, minimap_step
from world.minimap_join import HUNTINGZONE_TABLE_ROLE, ZONE_NAME_PACKAGE_ROLE, ZONENAME_TABLE_ROLE
from world.minimap_sources import MinimapSources, locked_tile_ids, tile_frame_extent
from world.minimap_step import MINIMAP_STEP_NAME, run_minimap_step, sealed_minimap
from world.minimap_textures import MinimapTextureError
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
ROUTE_REASONS = ['minimap-join-unresolved:zone-title-source', 'minimap-join-unresolved:radar-anchor']
READABLE_P8_SOURCE = {'status': 'readable', 'format': 'P8'}
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


def zone_name_package(export_names):
    return {'path': 'systextures/l2zonename.utx', 'sha256': PACKAGE_SHA256, 'packageVersion': 123, 'licensee': 28, 'packageName': 'l2zonename',
            'exports': [{'exportIndex': index, 'name': name, 'object': f'l2zonename.{name}', 'textureSource': dict(READABLE_P8_SOURCE)}
                        for index, name in enumerate(export_names, 1)]}


def synthetic_sources(export_names=(TILE_ID,)):
    table = lambda name, rows: {'table': name, 'path': f'system/{name}-e.dat', 'sha256': TABLE_SHA256, 'rows': rows}
    return MinimapSources(
        {ZONE_NAME_PACKAGE_ROLE: zone_name_package(list(export_names))},
        {ZONENAME_TABLE_ROLE: table('zonename', [{'ID': 1, 'Color': 210, 'MapX': 20, 'MapY': 21, 'Top': 1.0, 'Bottom': -1.0, 'Name': 'Here', 'map': ''}]),
         HUNTINGZONE_TABLE_ROLE: table('huntingzone', [{'id': 4, 'name': 'Cruma Marshlands', 'loc': {'start_npc_x': 5106.0, 'start_npc_y': 126916.0,
                                                                                                      'start_npc_z': -3664.0}}])})


class SyntheticTextureConverter:
    def __init__(self, output):
        self.output, self.requests = Path(output), []

    def convert(self, request):
        self.requests.append(request)
        archive = b'synthetic archive of ' + request['object'].encode('utf-8')
        target = self.output / hashlib.sha256(archive).hexdigest()
        target.mkdir(parents=True, exist_ok=True)
        (target / 'asset.l2asset').write_bytes(archive)
        (target / 'texture.png').write_bytes(png_header(128, 128))
        return {'file': str(target / 'asset.l2asset'), 'sha256': hashlib.sha256(archive).hexdigest()}


class FailingTextureConverter:
    def __init__(self, output, error):
        self.output, self.error = Path(output), error

    def convert(self, request):
        raise self.error


class MisreportedArchiveConverter(SyntheticTextureConverter):
    def convert(self, request):
        return {**super().convert(request), 'sha256': '0' * 64}


class MinimapStepTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        self.converter = SyntheticTextureConverter(self.project_root / 'converter')
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / WORLD_LANE_NAME / 'l2'

    def read_manifest(self):
        _, product = sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID))
        return product, json.loads((self.store_root / product['manifest']['resource'].removeprefix('/l2/')).read_bytes())

    def run_step(self, sources=None, converter=None):
        return run_minimap_step(self.project_root, CLIENT_ROOT, TILE_ID, sources or synthetic_sources(), converter or self.converter)

    def test_the_step_writes_schema_2_pinning_the_route_and_the_zone_key_texture_and_skips_on_rerun(self):
        write_project(self.project_root)
        route_record = seal_synthetic_minimap_route(self.project_root)
        row = self.run_step()
        self.assertEqual((row['step'], row['status'], row['reason']), (MINIMAP_STEP_NAME, 'gap', ROUTE_REASONS[1]))
        product, manifest = self.read_manifest()
        self.assertRegex(product['manifest']['resource'], r'^/l2/maps/[a-f0-9]{64}/native-tile-minimap/manifest\.json$')
        self.assertEqual((manifest['kind'], manifest['schemaVersion'], manifest['tileId']), ('native-tile-minimap', 2, TILE_ID))
        self.assertEqual(manifest['route'], {'manifest': route_record['resource'], 'manifestSha256': route_record['sha256'],
                                             'manifestBytes': route_record['bytes']})
        self.assertEqual((manifest['radarTexture'], manifest['projection']), (None, None))
        texture = manifest['zoneKeyTexture']
        self.assertEqual((texture['sourceObject'], texture['rule'], texture['source']['exportIndex']), (f'l2zonename.{TILE_ID}', 'zone-sampler-tile', 1))
        self.assertTrue((self.store_root / texture['archiveSha256'] / 'asset.l2asset').is_file())
        self.assertEqual([zone['id'] for zone in manifest['huntingZones']], [4])
        self.assertEqual([gap['reason'] for gap in manifest['gaps']], ROUTE_REASONS)
        self.assertEqual(sorted(gap['reason'] for gap in product['gapRows']), sorted(ROUTE_REASONS))
        self.assertEqual(self.converter.requests, [{'kind': 'texture', 'package': 'l2zonename', 'object': f'l2zonename.{TILE_ID}'}])
        self.assertEqual(self.run_step()['reason'], ROUTE_REASONS[1])
        self.assertEqual(len(self.converter.requests), 1)

    def test_a_tile_with_an_overlapping_key_run_lists_the_zone_key_run_gap(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root, [TILE_ID])
        self.run_step()
        _, manifest = self.read_manifest()
        self.assertEqual([gap['reason'] for gap in manifest['gaps']], [*ROUTE_REASONS, 'minimap-join-unresolved:zone-key-run'])

    def test_a_changed_route_fingerprint_reseals_the_tile(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        self.run_step()
        changed_config = {'recipeSha256': '1' * 64, 'converterSha256': '2' * 64}
        with mock.patch.object(minimap_route_step, 'minimap_route_config', return_value=changed_config):
            self.assertEqual(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID)), (None, None))
            seal_synthetic_minimap_route(self.project_root)
            self.run_step()
            self.assertIsNotNone(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID))[0])
        self.assertEqual(len(self.converter.requests), 2)

    def test_a_changed_converter_implementation_reconverts_a_sealed_tile(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        with mock.patch.object(minimap_step, 'implementation_hash', return_value='a' * 64):
            self.run_step()
        with mock.patch.object(minimap_step, 'implementation_hash', return_value='b' * 64):
            self.run_step()
        self.assertEqual(len(self.converter.requests), 2)

    def test_a_tile_without_a_current_route_runs_the_route_unit_first(self):
        write_project(self.project_root)
        with mock.patch.object(minimap_step, 'run_minimap_route_step', side_effect=lambda project_root, client, converter:
                               seal_synthetic_minimap_route(project_root)) as route_step:
            self.run_step()
        route_step.assert_called_once()
        self.assertIsNotNone(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID))[0])

    def test_a_converter_refusal_of_the_zone_key_texture_is_a_sealed_decode_gap(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        self.run_step(converter=FailingTextureConverter(self.project_root / 'converter', ValueError('UModel failed or reported an error; inspect export.log')))
        product, manifest = self.read_manifest()
        self.assertIsNone(manifest['zoneKeyTexture'])
        self.assertEqual(manifest['gaps'][-1], {'reason': 'decode-failed:ValueError:UModel failed or reported an error', 'evidence': f'l2zonename.{TILE_ID}'})
        self.assertIn(f'l2zonename.{TILE_ID}', [row['sourceIdentity'].get('object') for row in product['gapRows']])

    def test_a_tile_without_a_zone_key_texture_export_keeps_a_null_texture_without_a_conversion(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        self.run_step(sources=synthetic_sources(['21_21']))
        _, manifest = self.read_manifest()
        self.assertIsNone(manifest['zoneKeyTexture'])
        self.assertEqual(self.converter.requests, [])

    def test_an_environment_failure_during_conversion_propagates_and_leaves_the_unit_unsealed(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        with self.assertRaises(PermissionError):
            self.run_step(converter=FailingTextureConverter(self.project_root / 'converter', PermissionError('umodel.exe is locked')))
        self.assertEqual(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID)), (None, None))

    def test_a_converted_archive_that_differs_from_its_reported_hash_propagates_and_leaves_the_unit_unsealed(self):
        write_project(self.project_root)
        seal_synthetic_minimap_route(self.project_root)
        with self.assertRaisesRegex(MinimapTextureError, 'differs from its reported SHA-256'):
            self.run_step(converter=MisreportedArchiveConverter(self.project_root / 'converter'))
        self.assertEqual(sealed_minimap(self.project_root, TILE_ID, read_tile_map_lock_record(TILE_ID)), (None, None))

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
        for what in ('zone-title-source', 'radar-anchor', 'zone-key-run', 'texture-layout-differs', 'route-texture-absent', 'hunting-zone-rows',
                     'source-package-absent'):
            self.assertTrue(is_listed_reason(f'minimap-join-unresolved:{what}', patterns), what)

    def test_the_tile_inputs_drop_the_radar_and_town_map_packages(self):
        paths = [record['path'] for record in minimap_step.minimap_input_records(TILE_ID)]
        self.assertEqual(paths, ['maps/20_21.unr', 'system/huntingzone-e.dat', 'system/zonename-e.dat', 'systextures/l2zonename.utx'])

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
    def test_tile_20_21_takes_its_zone_key_texture_by_the_sampler_name(self):
        from world.minimap_join import join_tile_route_half
        sources = minimap_step.read_minimap_sources(CLIENT_ROOT.resolve())
        tile = join_tile_route_half(TILE_ID, tile_frame_extent(CHUNK_PLAN_FRAME), sources.packages[ZONE_NAME_PACKAGE_ROLE], sources.tables, set())
        self.assertEqual((tile['zoneKeyTexture']['object'], tile['zoneKeyTexture']['rule']), (f'l2zonename.{TILE_ID}', 'zone-sampler-tile'))
        self.assertEqual(tile['gaps'], [])


if __name__ == '__main__':
    unittest.main()
