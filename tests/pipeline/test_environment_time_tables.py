import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_environment import DEFAULT_FILES, build_products
from reference_client_guard import require_reference_client
from support.environment_source_files import SETUP_FILE_TEXT, time_table_of, time_tables_of
from world.environment_config_cache import float32

REFERENCE_CLIENT = Path('E:/Lineage2-client')
LOADED_TABLES_FIXTURE = ROOT / 'tests' / 'fixtures' / 'environment' / 'day-night-db4-loaded-tables.json'
LOADED_TABLES_FIXTURE_SHA256 = '9424568d0545d02c5e8f8f604162aa9ce8ecebc94e8b99be44c1c5a715f83d84'
LOADED_TABLES_SOURCE_SHA256 = '3ed0e25a20b8ce42fc4c9e4a5ce0da75eec676327a230d9c261cfa704081788e'
PACKED_ROW_LAYOUT_BY_KIND = {'rgb': ('<f3Bx', ('T', 'R', 'G', 'B')), 'hsv': ('<f2B2xf', ('T', 'Hue', 'Sat', 'Bri')), 'scale': ('<2f', ('T', 'S'))}


def time_tables_with_type_file(type_file_text, setup_text=SETUP_FILE_TEXT):
    return time_tables_of({'Env.int': setup_text, 'timeenv0.int': type_file_text})


def row_values(table):
    return [(row['keyNumber'], row['values']) for row in table['rows']]


class EffectiveTimeTableTests(unittest.TestCase):
    def test_only_present_keys_one_to_num_load_and_extra_physical_rows_never_do(self):
        document = time_tables_with_type_file('[SkyBoxColor]\r\nNUM=3\r\nCOLOR1=(T=0,R=1,G=2,B=3)\r\nCOLOR3=(T=12,R=4,G=5,B=6)\r\n'
                                              'COLOR4=(T=18,R=7,G=8,B=9)\r\nCOLOR0=(T=1,R=1,G=1,B=1)\r\n')
        table = time_table_of(document, 0, 'SkyBoxColor')
        self.assertEqual(row_values(table), [(1, {'T': 0.0, 'R': 1, 'G': 2, 'B': 3}), (3, {'T': 12.0, 'R': 4, 'G': 5, 'B': 6})])
        self.assertEqual(table['num'], 3)
        self.assertTrue(document['typedComplete'])

    def test_a_missing_t_is_the_key_number_minus_one_and_a_missing_channel_is_255(self):
        table = time_table_of(time_tables_with_type_file('[SunColor]\r\nNum=3\r\nColor3=(R=10,B=20)\r\n'), 0, 'SunColor')
        self.assertEqual(table['rows'][0]['values'], {'T': 2.0, 'R': 10, 'G': 255, 'B': 20})
        self.assertEqual(table['rows'][0]['defaultedFields'], ['T', 'G'])

    def test_section_and_key_lookup_ignore_case(self):
        document = time_tables_with_type_file('[envtype]\r\nenvtype=2\r\n[skyboxcolor]\r\nnum=1\r\ncolor1=(t=6,r=1,g=2,b=3)\r\n',
                                              SETUP_FILE_TEXT.replace('TimeRatio=6', 'timeratio=5'))
        self.assertEqual(time_table_of(document, 2, 'SkyBoxColor')['rows'][0]['values'], {'T': 6.0, 'R': 1, 'G': 2, 'B': 3})
        self.assertEqual(document['setup']['values']['TimeRatio']['value'], 5)

    def test_a_repeated_section_merges_and_the_last_value_of_each_key_wins(self):
        document = time_tables_with_type_file('[HSVTerrainLight]\r\nNUM=1\r\nLight1=(T=0,Hue=240,Sat=100,Bri=100)\r\nLight2=(T=6,Hue=1,Sat=2,Bri=3)\r\n'
                                              '[HSVTerrainLight]\r\nNUM=2\r\nLight1=( T=0, Hue=138, Sat=182, Bri=0 )\r\n')
        table = time_table_of(document, 0, 'HSVTerrainLight')
        self.assertEqual(row_values(table), [(1, {'T': 0.0, 'Hue': 138, 'Sat': 182, 'Bri': 0.0}), (2, {'T': 6.0, 'Hue': 1, 'Sat': 2, 'Bri': 3.0})])
        self.assertEqual(document['environmentTypes'][0]['mergedDuplicateSections'], [{'section': 'HSVTerrainLight', 'headerLines': [1, 5]}])

    def test_fields_are_found_by_key_search_so_a_comma_less_light11_parses(self):
        table = time_table_of(time_tables_with_type_file('[HSVStaticMeshLight]\r\nNUM=11\r\nLight11=( T=10  Hue=1, Sat=255, Bri=180 )\r\n'),
                              0, 'HSVStaticMeshLight')
        self.assertEqual(table['rows'][0]['values'], {'T': 10.0, 'Hue': 1, 'Sat': 255, 'Bri': 180.0})
        self.assertEqual(table['rows'][0]['defaultedFields'], [])

    def test_t_bri_and_s_are_float32(self):
        document = time_tables_with_type_file('[SunScale]\r\nNUM=1\r\nScale1=(T=0.1,S=1.3)\r\n[HSVActorLight]\r\nNUM=1\r\nLight1=(T=0.7,Hue=1,Sat=2,Bri=0.3)\r\n')
        self.assertEqual(time_table_of(document, 0, 'SunScale')['rows'][0]['values'], {'T': float32(0.1), 'S': float32(1.3)})
        self.assertEqual(time_table_of(document, 0, 'HSVActorLight')['rows'][0]['values']['Bri'], float32(0.3))

    def test_an_unread_default_and_unparsed_or_out_of_range_fields_stay_visibly_unresolved(self):
        document = time_tables_with_type_file('[MoonScale]\r\nNUM=1\r\nScale1=(T=0)\r\n[SkyBoxColor]\r\nNUM=2\r\nColor1=(T=0,R=abc,G=1,B=1)\r\n'
                                              'Color2=(T=6,R=256,G=1,B=1)\r\n')
        self.assertFalse(document['typedComplete'])
        self.assertEqual(document['unresolved'], ['time-table-field-default-unresolved:timeenv0.int:MoonScale:Scale1:S',
                                                  'time-table-field-out-of-byte-range:timeenv0.int:SkyBoxColor:Color2:R',
                                                  'time-table-field-unparsed:timeenv0.int:SkyBoxColor:Color1:R'])
        self.assertIsNone(time_table_of(document, 0, 'MoonScale')['rows'][0]['values']['S'])

    def test_a_missing_num_loads_nothing_and_every_db4_section_is_listed(self):
        document = time_tables_with_type_file('[SkyBoxColor]\r\nCOLOR1=(T=0,R=1,G=2,B=3)\r\n')
        entry = document['environmentTypes'][0]
        self.assertEqual(len(entry['tables']), 17)
        self.assertEqual(time_table_of(document, 0, 'SkyBoxColor')['rows'], [])
        self.assertEqual((document['tableCount'], document['rowCount']), (17, 0))


class EnvironmentTypeSelectionTests(unittest.TestCase):
    def test_each_listed_file_is_keyed_by_its_own_env_type_and_a_missing_one_is_zero(self):
        setup = SETUP_FILE_TEXT.replace('TimeEnvFileNum=1', 'TimeEnvFileNum=2') + 'TimeEnvFileName1=Other.INT\r\n'
        document = time_tables_of({'Env.int': setup, 'timeenv0.int': '[EnvType]\r\nEnvType=3\r\n', 'other.int': '[SkyBoxColor]\r\nNUM=0\r\n'})
        self.assertEqual([(entry['file'], entry['environmentType'], entry['environmentTypeSource']) for entry in document['environmentTypes']],
                         [('timeenv0.int', 3, 'file'), ('other.int', 0, 'native-default')])

    def test_two_files_with_one_env_type_and_a_missing_listed_file_are_unresolved(self):
        setup = SETUP_FILE_TEXT.replace('TimeEnvFileNum=1', 'TimeEnvFileNum=3') + 'TimeEnvFileName1=Other.INT\r\nTimeEnvFileName2=Absent.INT\r\n'
        document = time_tables_of({'Env.int': setup, 'timeenv0.int': '[EnvType]\r\nEnvType=0\r\n', 'other.int': '[X]\r\nY=1\r\n'})
        self.assertEqual(document['unresolved'], ['environment-time-file-missing:Absent.INT', 'environment-type-declared-twice:0'])

    def test_no_setup_file_selects_no_table(self):
        document = time_tables_of({'timeenv0.int': '[EnvType]\r\nEnvType=0\r\n'})
        self.assertEqual((document['setup'], document['environmentTypes'], document['unresolved']),
                         (None, [], ['environment-setup-file-missing:Env.int']))


def loaded_tables_fixture():
    data = LOADED_TABLES_FIXTURE.read_bytes()
    return hashlib.sha256(data).hexdigest(), json.loads(data)


def packed_values(table, kind):
    layout, fields = PACKED_ROW_LAYOUT_BY_KIND[kind]
    return [dict(zip(fields, values)) for values in struct.iter_unpack(layout, bytes.fromhex(table['packedHex']))]


class LoadedTablesFixtureTests(unittest.TestCase):
    def test_the_fixture_bytes_and_their_db4_source_are_pinned(self):
        fixture_sha256, fixture = loaded_tables_fixture()
        self.assertEqual(fixture_sha256, LOADED_TABLES_FIXTURE_SHA256)
        self.assertEqual(fixture['source']['sha256'], LOADED_TABLES_SOURCE_SHA256)
        self.assertEqual(len(fixture['tables']), 68)


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class RealClientTimeTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        access = require_reference_client(REFERENCE_CLIENT)
        products = build_products({name: access.require_equal_file(f'system/{name}').read_bytes() for name in DEFAULT_FILES})
        cls.document = json.loads(products['time-tables.json'])

    def test_68_tables_and_1356_rows_load_with_nothing_unresolved(self):
        self.assertEqual((self.document['tableCount'], self.document['rowCount'], self.document['unresolved']), (68, 1356, []))
        self.assertEqual([entry['environmentType'] for entry in self.document['environmentTypes']], [0, 1, 2, 3])

    def test_all_5344_values_equal_the_db4_packed_tables(self):
        _, fixture = loaded_tables_fixture()
        compared = 0
        for expected in fixture['tables']:
            table = time_table_of(self.document, expected['environmentType'], expected['section'])
            with self.subTest(environment_type=expected['environmentType'], section=expected['section']):
                self.assertEqual(table['num'], expected['num'])
                self.assertEqual([row['key'] for row in table['rows']], expected['keys'])
                self.assertEqual([row['values'] for row in table['rows']], packed_values(expected, table['kind']))
            compared += sum(len(values) for values in packed_values(expected, table['kind']))
        self.assertEqual(compared, 5344)

    def test_the_second_hsv_terrain_light_section_wins_in_timeenv1_and_timeenv3(self):
        for environment_type in (1, 3):
            with self.subTest(environment_type=environment_type):
                light1 = time_table_of(self.document, environment_type, 'HSVTerrainLight')['rows'][0]
                self.assertEqual(light1['values'], {'T': 0.0, 'Hue': 138, 'Sat': 182, 'Bri': 0.0})

    def test_timeenv3_sky_box_colour_loads_only_color1(self):
        table = time_table_of(self.document, 3, 'SkyBoxColor')
        self.assertEqual((table['num'], [row['key'] for row in table['rows']]), (1, ['COLOR1']))
        self.assertEqual(table['rows'][0]['values'], {'T': 0.0, 'R': 255, 'G': 5, 'B': 5})

    def test_the_comma_less_light11_rows_parse(self):
        light11 = next(row for row in time_table_of(self.document, 0, 'HSVStaticMeshLight')['rows'] if row['keyNumber'] == 11)
        self.assertEqual(light11['values'], {'T': 10.0, 'Hue': 1, 'Sat': 255, 'Bri': 180.0})

    def test_the_setup_keeps_its_file_values_and_names_the_three_cloud_materials(self):
        setup = self.document['setup']
        self.assertEqual({key: setting['value'] for key, setting in setup['values'].items()},
                         {'IsClock': True, 'TimeRatio': 6, 'StartTime': 12.0, 'ShadowTick': float32(0.1), 'SlopeSunAngle': 30.0, 'TimeEnvFileNum': 4})
        self.assertEqual([setup['bindings'][key]['value'] for key in ('SKYBOX', 'HAZERING', 'NumCloudColor')], ['SkybackgroundColor', 'HazeRing_Final', 3])
        self.assertEqual([cloud['value'] for cloud in setup['bindings']['CLOUD']], ['Cloud_Final', 'StarField_Final01', 'StarField_Final02'])


if __name__ == '__main__':
    unittest.main()
