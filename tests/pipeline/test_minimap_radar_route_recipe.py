import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.texture_mips import build_texture_source
from native_catalog.ue2 import Package, Reader, summary, unwrap
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, require_reference_client
from world.format5_texture_pixels import format5_mip0
from world.minimap_radar_route_recipe import (MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH, MinimapRadarRouteRecipeError, load_minimap_radar_route_recipe,
                                              read_minimap_radar_route_recipe)
from world.minimap_sources import decoded_table_rows, locked_tile_ids
from world.minimap_textures import read_texture_package
from world.zone_name_keys import zone_key_table

CLIENT_ROOT = Path('E:/Lineage2-client')
RECIPE_PATH = ROOT / MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH
UNREAL_STRING_TOKEN = b'\x1f'


def recipe_document():
    return json.loads(RECIPE_PATH.read_text(encoding='utf-8'))


def binary(document, path):
    return next(entry for entry in document['binaries'] if entry['path'] == path)


def export_names_of_any_ue2_version(data, filename):
    package_summary = summary(data[:128], filename)
    _, decoded = unwrap(data, filename)
    reader = Reader(decoded, package_summary['nameOffset'])
    names = []
    for _ in range(package_summary['nameCount']):
        names.append(reader.string())
        reader.number('I')
    reader, exports = Reader(decoded, package_summary['exportOffset']), []
    for _ in range(package_summary['exportCount']):
        reader.compact(), reader.compact(), reader.number('i')
        name, _, size = names[reader.compact()], reader.number('I'), reader.compact()
        exports.append({'name': name, 'size': size, 'offset': reader.compact() if size else 0})
    return decoded, exports


class RecipeReaderTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)

    def load(self, text):
        path = Path(self.temporary_directory.name) / 'minimap-radar-route.json'
        path.write_text(text, encoding='utf-8')
        return load_minimap_radar_route_recipe(path, REFERENCE_CLIENT_LOCK_PATH)

    def load_document(self, document):
        return self.load(json.dumps(document))

    def assert_refused(self, document, message):
        with self.assertRaisesRegex(MinimapRadarRouteRecipeError, message):
            self.load_document(document)

    def test_the_committed_recipe_reads_with_its_pins_cases_and_open_items(self):
        recipe = read_minimap_radar_route_recipe()
        document = recipe['document']
        self.assertEqual(recipe['path'], MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH)
        self.assertEqual(binary(document, 'system/interface.u')['eSha256'], '4addc1323405170219233435074c279b5cba7c041d518c1673780af8f2622cf9')
        self.assertEqual((binary(document, 'system/nwindow.dll')['lockClass'], binary(document, 'system/Localization.ini')['lockClass']),
                         ('differing', 'volatile-config'))
        self.assertEqual(len(document['radar']['cases']), 17)
        self.assertIn('Town  of Goddard', [case['zoneName'] for case in document['radar']['cases']])
        self.assertEqual(document['radar']['default'], {'texture': 'Global', 'mapX': -229300, 'mapY': -260600, 'isGlobal': True})
        self.assertEqual([item['tileGap'] for item in document['open'] if item['tileGap']],
                         ['minimap-join-unresolved:radar-anchor', 'minimap-join-unresolved:zone-title-source', 'minimap-join-unresolved:zone-key-run'])
        self.assertEqual([entry['value'] for entry in document['zoneSampler']['constants']], [32768.0, 1 / 32768])

    def test_a_repeated_key_or_a_non_finite_number_is_refused(self):
        text = RECIPE_PATH.read_text(encoding='utf-8')
        with self.assertRaisesRegex(MinimapRadarRouteRecipeError, 'repeats a JSON key'):
            self.load(text.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,', 1))
        with self.assertRaisesRegex(MinimapRadarRouteRecipeError, 'non-finite'):
            self.load(text.replace('"scale": 0.0050048828125', '"scale": NaN', 1))

    def test_a_pin_that_differs_from_its_lock_entry_is_refused(self):
        for path, field, value in (('system/interface.u', 'eSha256', '0' * 64), ('system/nwindow.dll', 'lockClass', 'equal')):
            document = recipe_document()
            binary(document, path)[field] = value
            self.assert_refused(document, 'differs from the system/')

    def test_two_cases_equal_under_casefold_are_refused(self):
        document = recipe_document()
        document['radar']['cases'][1]['zoneName'] = document['radar']['cases'][0]['zoneName'].upper()
        self.assert_refused(document, 'equal under the case-insensitive match')

    def test_a_case_without_a_field_is_refused(self):
        for field in ('zoneName', 'texture', 'mapX', 'mapY'):
            document = recipe_document()
            del document['radar']['cases'][3][field]
            self.assert_refused(document, 'every radar case needs exactly')

    def test_a_rule_without_its_address_is_refused(self):
        for section, rule in (('radar', 'match'), ('zoneKey', 'helper'), ('worldMap', 'getMinimapPosition')):
            document = recipe_document()
            del document[section][rule]['address']
            self.assert_refused(document, f'rule {section}.{rule} needs its hex address')


class RealClientRouteFactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not CLIENT_ROOT.is_dir():
            raise unittest.SkipTest('the reference client E:/Lineage2-client is absent on this host')
        try:
            cls.client = require_reference_client(CLIENT_ROOT)
        except (OSError, ValueError) as error:
            raise unittest.SkipTest(f'the reference client does not match its lock: {error}') from error
        cls.document = read_minimap_radar_route_recipe()['document']

    def test_the_new_radar_window_exports_and_the_zone_title_event_constant_are_where_the_recipe_says(self):
        radar = self.document['radar']
        interface = Package(self.client.require_equal_file('system/interface.u').read_bytes(), 'interface.u')
        for name in ('onLoad', 'onEvent', 'getLocInfo'):
            self.assertEqual(interface.object_name(radar[name]['export']), radar[name]['function'])
        decoded, exports = export_names_of_any_ue2_version(self.client.require_equal_file('system/nwindow.u').read_bytes(), 'nwindow.u')
        constant = exports[radar['zoneTitleEvent']['constExport'] - 1]
        self.assertEqual(constant['name'], radar['zoneTitleEvent']['name'].rsplit('.', 1)[-1])
        reader = Reader(decoded, constant['offset'], constant['offset'] + constant['size'])
        reader.compact(), reader.compact(), reader.compact()
        self.assertEqual(reader.string().strip(), str(radar['zoneTitleEvent']['id']))

    def test_every_case_literal_and_texture_literal_sits_in_the_get_loc_info_bytecode(self):
        radar = self.document['radar']
        location = radar['getLocInfo']
        interface = Package(self.client.require_equal_file('system/interface.u').read_bytes(), 'interface.u')
        export = interface.exports[location['export'] - 1]
        bytecode_offset = int(location['bytecodeOffset'], 16)
        self.assertEqual(export['offset'], int(location['serialOffset'], 16))
        self.assertEqual(struct.unpack_from('<i', interface.data, bytecode_offset - 4)[0], location['scriptSize'])
        bytecode = bytes(interface.data[bytecode_offset:export['offset'] + export['size']])
        for case in radar['cases']:
            self.assertIn(UNREAL_STRING_TOKEN + case['zoneName'].encode('cp1252') + b'\x00', bytecode, case['zoneName'])
            self.assertIn(UNREAL_STRING_TOKEN + f'{radar["textureGroup"]}.{case["texture"]}'.encode('cp1252') + b'\x00', bytecode, case['texture'])
        self.assertIn(UNREAL_STRING_TOKEN + f'{radar["textureGroup"]}.{radar["default"]["texture"]}'.encode('cp1252') + b'\x00', bytecode)
        self.assertEqual(bytecode.count(UNREAL_STRING_TOKEN + b'Town of Goddard\x00'), 0)

    def test_the_seventeen_town_maps_are_format_5_with_one_full_mip_and_the_global_map_exists(self):
        rule = self.document['textureFormat5']
        package = read_texture_package(CLIENT_ROOT, rule['package']['path'])
        self.assertEqual((package.summary['version'], package.summary['licenseeVersion'], package.summary['wrapper']),
                         (rule['package']['packageVersion'], rule['package']['licensee'], rule['package']['wrapper']))
        self.assertEqual(sum(package.filename.lower().encode('ascii')) & 255, int(rule['package']['key'], 16))
        exports = {export['object'].casefold(): export for export in package.exports}
        group = self.document['radar']['textureGroup']
        for case in self.document['radar']['cases']:
            export = exports[f'{group}.{case["texture"]}'.casefold()]
            width, height, pixels = format5_mip0(package, export, rule)
            self.assertEqual((width, height, len(pixels)), (rule['townMapMip']['width'], rule['townMapMip']['height'], rule['townMapMip']['bytes']))
        self.assertIn(f'{group}.{self.document["radar"]["default"]["texture"]}'.casefold(), exports)

    def test_the_six_world_map_pieces_are_dxt1_pieces_of_the_drawn_size(self):
        display, draw = self.document['worldMap']['initializeMapDisplay'], self.document['worldMap']['drawWorldMap']
        package = read_texture_package(CLIENT_ROOT, 'systextures/L2Font-e.utx')
        exports = {export['object'].casefold(): export for export in package.exports}
        for suffix in display['suffixes']:
            metadata, _ = build_texture_source(package, exports[f'{display["english"]}{suffix}'.casefold()])
            self.assertEqual((metadata['format']['name'], metadata['mips'][0]['width'], metadata['mips'][0]['height']),
                             (draw['pieceFormat'], draw['pieceWidth'], draw['pieceHeight']))

    def test_every_locked_tile_has_one_zone_key_texture(self):
        package = read_texture_package(CLIENT_ROOT, self.document['zoneSampler']['texturePackage'])
        names = [export['name'].casefold() for export in package.exports if export['className'] == 'Texture']
        self.assertEqual([tile_id for tile_id in locked_tile_ids() if names.count(tile_id) != 1], [])

    def test_the_zonename_rows_give_the_stated_key_facts(self):
        rows = decoded_table_rows(CLIENT_ROOT, 'zonename')['rows']
        table = zone_key_table(rows)
        self.assertEqual((len(rows), table['keyCount'], table['sharedKeyCount'], table['rowsInSharedKeys'], table['globalRowCount']),
                         (369, 304, 45, 110, 21))
        self.assertEqual(sorted(run['tileId'] for run in table['overlappingRuns']), ['20_14', '21_25', '25_19'])
        self.assertIn('Town of Goddard', [row['Name'] for row in rows])
        self.assertTrue(all(row['MapX'] == row['MapY'] == 0 and row['Color'] <= 20 for row in rows if row['Color'] < 200))


if __name__ == '__main__':
    unittest.main()
