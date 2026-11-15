import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.interprocess_lock import lane_batch_lock
from native_store.store_paths import lane_work_root
from world import minimap_route_step
from world.format5_texture_pixels import Format5PixelMismatch, require_png_equals_format5_pixels
from world.minimap_radar_route_recipe import read_minimap_radar_route_recipe
from world.minimap_route_step import MINIMAP_ROUTE_UNIT_KEY, current_minimap_route, run_minimap_route_step
from world.minimap_textures import converter_package_request
from world.tile_census import WORLD_LANE_NAME

CLIENT_ROOT = Path('E:/Lineage2-client')
RECIPE = read_minimap_radar_route_recipe()['document']
FORMAT5_RULE = RECIPE['textureFormat5']
RADAR_GROUP = RECIPE['radar']['textureGroup']
WORLD_MAP_PREFIX = RECIPE['worldMap']['initializeMapDisplay']['english']
READABLE_DXT1 = {'status': 'readable', 'format': 'DXT1'}
FORMAT5_GAP = {'status': 'gap', 'reason': 'texture-format-unsupported:5'}


def png_bytes_of_rgba(width, height, rgba):
    buffer = io.BytesIO()
    Image.frombytes('RGBA', (width, height), rgba).save(buffer, format='PNG')
    return buffer.getvalue()


def png_header(width, height):
    return b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', width, height) + bytes(5)


def synthetic_package(package_name, path, objects):
    exports = [{'exportIndex': index, 'name': name.rsplit('.', 1)[-1], 'object': name, 'textureSource': dict(source), 'className': 'Texture'}
               for index, (name, source) in enumerate(objects, 1)]
    package = SimpleNamespace(package_name=package_name, exports=exports)
    index = {'path': path, 'sha256': '9' * 64, 'packageName': package_name, 'exports': exports}
    return package, index


def synthetic_route_packages():
    radar_objects = [(f'{RADAR_GROUP}.{case["texture"]}', FORMAT5_GAP) for case in RECIPE['radar']['cases']]
    radar_objects.append((f'{RADAR_GROUP}.{RECIPE["radar"]["default"]["texture"]}', READABLE_DXT1))
    pieces = [(f'{WORLD_MAP_PREFIX}{suffix}', READABLE_DXT1) for suffix in RECIPE['worldMap']['initializeMapDisplay']['suffixes']]
    return {RECIPE['radar']['texturePackage']: synthetic_package('L2_RadarMap', RECIPE['radar']['texturePackage'], radar_objects),
            'systextures/L2Font-e.utx': synthetic_package('L2Font-e', 'systextures/L2Font-e.utx', pieces)}


class SyntheticTextureConverter:
    def __init__(self, output):
        self.output, self.requests = Path(output), []

    def convert(self, request):
        self.requests.append(request)
        archive = b'synthetic archive of ' + request['object'].encode('utf-8')
        target = self.output / hashlib.sha256(archive).hexdigest()
        target.mkdir(parents=True, exist_ok=True)
        (target / 'asset.l2asset').write_bytes(archive)
        (target / 'texture.png').write_bytes(png_header(1024, 1024))
        return {'file': str(target / 'asset.l2asset'), 'sha256': hashlib.sha256(archive).hexdigest()}


class RefusingTextureConverter(SyntheticTextureConverter):
    def convert(self, request):
        if request['object'].endswith('int_worldmap3'):
            raise ValueError('UModel failed or reported an error; inspect export.log')
        return super().convert(request)


def pixel_check_of(object_name):
    return {'status': 'equal', 'width': 1024, 'height': 1024, 'pixelOrder': ['B', 'G', 'R', 'A'], 'decodedRgbaSha256': hashlib.sha256(object_name.encode()).hexdigest()}


class Format5PixelTests(unittest.TestCase):
    def test_a_synthetic_2_by_2_bgra_mip_decodes_to_rgba_and_equals_its_png(self):
        stored = bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
        rgba = bytes([3, 2, 1, 4, 7, 6, 5, 8, 11, 10, 9, 12, 15, 14, 13, 16])
        check = require_png_equals_format5_pixels('L2_RadarMap.RadarMaps.heine', 2, 2, stored, png_bytes_of_rgba(2, 2, rgba), FORMAT5_RULE)
        self.assertEqual((check['status'], check['width'], check['height'], check['decodedRgbaSha256']),
                         ('equal', 2, 2, hashlib.sha256(rgba).hexdigest()))

    def test_a_png_that_differs_in_one_pixel_is_refused_with_that_pixel_position(self):
        stored = bytes(range(16))
        rgba = bytearray(bytes([2, 1, 0, 3, 6, 5, 4, 7, 10, 9, 8, 11, 14, 13, 12, 15]))
        rgba[13] ^= 1
        with self.assertRaises(Format5PixelMismatch) as raised:
            require_png_equals_format5_pixels('L2_RadarMap.RadarMaps.heine', 2, 2, stored, png_bytes_of_rgba(2, 2, bytes(rgba)), FORMAT5_RULE)
        self.assertEqual(raised.exception.position, [1, 1])
        self.assertIn('at pixel [1, 1]', str(raised.exception))


class MinimapRouteStepTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        self.packages = synthetic_route_packages()
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / WORLD_LANE_NAME / 'l2'

    def run_route(self, converter, pixel_check=pixel_check_of):
        rows = [{'ID': 1, 'Color': 210, 'MapX': 20, 'MapY': 21, 'Top': 100.0, 'Bottom': -100.0, 'Name': 'A'},
                {'ID': 2, 'Color': 210, 'MapX': 20, 'MapY': 21, 'Top': 50.0, 'Bottom': -50.0, 'Name': 'B'}]
        with mock.patch.object(minimap_route_step, 'require_reference_client', return_value=SimpleNamespace(root=CLIENT_ROOT)), \
                mock.patch.object(minimap_route_step.RouteTextureConverter, 'package', lambda converter_self, path: self.packages[path]), \
                mock.patch.object(minimap_route_step, 'texture_format_id', return_value=FORMAT5_RULE['formatId']), \
                mock.patch.object(minimap_route_step, 'require_png_equals_format5_mip0',
                                  side_effect=lambda package, export, png, rule: pixel_check(export['object'])), \
                mock.patch.object(minimap_route_step, 'decoded_table_rows', return_value={'rows': rows}):
            return run_minimap_route_step(self.project_root, CLIENT_ROOT, converter)

    def read_manifest(self, result):
        return json.loads((self.store_root / result['manifest']['resource'].removeprefix('/l2/')).read_text(encoding='utf-8'))

    def test_the_route_converts_each_of_the_24_textures_once_seals_and_a_rerun_converts_nothing(self):
        converter = SyntheticTextureConverter(self.project_root / 'converter')
        result = self.run_route(converter)
        self.assertEqual((result['status'], result['converted'], len(converter.requests)), ('converted', 24, 24))
        manifest = self.read_manifest(result)
        self.assertEqual((manifest['kind'], manifest['schemaVersion']), ('native-minimap-route', 1))
        textures = [case['texture'] for case in manifest['radar']['cases']] + [manifest['radar']['default']['texture']] + \
                   [piece['texture'] for piece in manifest['worldMap']['pieces']]
        self.assertEqual(len(textures), 24)
        self.assertTrue(all((self.store_root / texture['archive'].removeprefix('/l2/')).is_file() for texture in textures))
        self.assertEqual({case['texture']['format'] for case in manifest['radar']['cases']}, {'RGBA8'})
        self.assertTrue(all('pixelCheck' in case['texture'] for case in manifest['radar']['cases']))
        self.assertEqual((manifest['radar']['default']['texture']['rule'], manifest['radar']['default']['texture']['format']), ('radar-default', 'DXT1'))
        self.assertEqual([(piece['column'], piece['row'], piece['originX'], piece['originY']) for piece in manifest['worldMap']['pieces']],
                         [(0, 0, 0, 0), (1, 0, 1024, 0), (0, 1, 0, 1024), (1, 1, 1024, 1024), (0, 2, 0, 2048), (1, 2, 1024, 2048)])
        self.assertEqual(manifest['worldMap']['projection']['scale'], 41 / 8192)
        self.assertEqual([gap['reason'] for gap in manifest['gaps']], ['minimap-join-unresolved:zone-title-source', 'minimap-join-unresolved:radar-anchor'])
        self.assertEqual([run['tileId'] for run in manifest['zoneKeys']['overlappingRuns']], ['20_21'])
        self.assertIsNotNone(current_minimap_route(self.project_root).product)
        rerun = self.run_route(converter)
        self.assertEqual((rerun['status'], rerun['converted'], len(converter.requests)), ('sealed', 0, 24))

    def test_a_format_5_pixel_mismatch_makes_that_texture_a_route_gap_with_no_archive(self):
        def pixel_check(object_name):
            if object_name.endswith('.heine'):
                raise Format5PixelMismatch(f'{object_name} PNG differs from the BGRA decode of mip 0 at pixel [3, 7]', [3, 7])
            return pixel_check_of(object_name)
        result = self.run_route(SyntheticTextureConverter(self.project_root / 'converter'), pixel_check)
        manifest = self.read_manifest(result)
        heine = next(case for case in manifest['radar']['cases'] if case['texture'] is None)
        self.assertEqual(heine['zoneName'], 'Heine')
        self.assertEqual(manifest['gaps'][2]['reason'], 'minimap-join-unresolved:texture-layout-differs')
        self.assertIn('at pixel [3, 7]', manifest['gaps'][2]['evidence'])
        self.assertEqual(len(list(self.store_root.glob('*/asset.l2asset'))), 23)

    def test_a_converter_refusal_makes_that_texture_a_route_gap(self):
        result = self.run_route(RefusingTextureConverter(self.project_root / 'converter'))
        manifest = self.read_manifest(result)
        self.assertIsNone(manifest['worldMap']['pieces'][2]['texture'])
        self.assertEqual(manifest['gaps'][2], {'reason': 'decode-failed:ValueError:UModel failed or reported an error',
                                               'evidence': f'{WORLD_MAP_PREFIX}3'})
        self.assertEqual(result['converted'], 23)

    def test_the_route_unit_key_names_one_interlude_unit(self):
        self.assertEqual(MINIMAP_ROUTE_UNIT_KEY, 'minimap-route:interlude')

    def test_a_package_name_two_client_files_share_is_requested_by_its_pinned_path(self):
        converter = SyntheticTextureConverter(self.project_root / 'converter')
        self.run_route(converter)
        packages = {request['package'] for request in converter.requests}
        self.assertEqual(packages, {'L2_RadarMap', 'systextures/L2Font-e.utx'})
        self.assertEqual(converter_package_request('systextures/l2zonename.utx'), 'l2zonename')

    def test_the_command_guards_the_parsed_client_and_refuses_a_held_world_lane_without_work(self):
        no_work = mock.Mock(side_effect=AssertionError('the route ran beside a held lane'))
        work_root = lane_work_root(self.project_root, WORLD_LANE_NAME)
        guard = mock.Mock(return_value=SimpleNamespace(root=CLIENT_ROOT))
        standard_output = io.StringIO()
        with mock.patch.multiple(minimap_route_step, REPOSITORY_ROOT=self.project_root, require_reference_client=guard,
                                 run_at_below_normal_priority=mock.DEFAULT, run_minimap_route_step=no_work), \
                lane_batch_lock(work_root), contextlib.redirect_stdout(standard_output):
            exit_code = minimap_route_step.main(['--client', 'client'])
        self.assertEqual(exit_code, 1)
        self.assertEqual(guard.call_args_list, [mock.call(Path('client'))])
        self.assertEqual(json.loads(standard_output.getvalue())['status'], 'failed')
        self.assertIn('lane world is in use', json.loads(standard_output.getvalue())['error'])


if __name__ == '__main__':
    unittest.main()
