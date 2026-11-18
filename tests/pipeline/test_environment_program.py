import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError
from support.environment_source_files import ENVIRONMENT_SETUP_SECTION_TEXT, FOG_SECTION_TEXT, SETUP_FILE_TEXT, environment_setup_file_text, time_tables_of
from world.environment_config_cache import float32
from world.environment_program import ENVIRONMENT_NATIVE_RULES_PATH, load_environment_native_rules

TYPE_FILE_TEXT = '[EnvType]\r\nEnvType=0\r\n'


def setup_of(setup_text):
    document = time_tables_of({'Env.int': setup_text, 'timeenv0.int': TYPE_FILE_TEXT})
    return document['setup'], document['unresolved']


class EnvironmentSetupTests(unittest.TestCase):
    def test_file_values_are_typed_and_located(self):
        setup, unresolved = setup_of(SETUP_FILE_TEXT)
        self.assertEqual(unresolved, [])
        self.assertEqual({key: (setting['value'], setting['source']) for key, setting in setup['values'].items()},
                         {'IsClock': (True, 'file'), 'TimeRatio': (6, 'file'), 'StartTime': (12.0, 'file'), 'ShadowTick': (float32(0.1), 'file'),
                          'SlopeSunAngle': (30.0, 'file'), 'TimeEnvFileNum': (1, 'file')})
        self.assertEqual((setup['values']['TimeRatio']['recordIndex'], setup['values']['TimeRatio']['raw']), (3, '6'))
        self.assertEqual([(cloud['key'], cloud['value']) for cloud in setup['bindings']['CLOUD']], [('CLOUD1', 'Cloud_Final')])
        self.assertEqual([(entry['index'], entry['value']) for entry in setup['timeEnvironmentFiles']], [(0, 'TimeEnv0.INT')])

    def test_missing_setup_keys_take_the_native_defaults_and_a_missing_time_ratio_never_throws(self):
        setup, _ = setup_of(environment_setup_file_text('[EnvSetup]\r\nTimeEnvFileName0=TimeEnv0.INT\r\nHAZERING=HazeRing_Final\r\nNumCloudColor=0\r\n'))
        self.assertEqual({key: (setting['value'], setting['source']) for key, setting in setup['values'].items()},
                         {'IsClock': (True, 'native-default'), 'TimeRatio': (6, 'native-default'), 'StartTime': (6.0, 'native-default'),
                          'ShadowTick': (-1.0, 'native-default'), 'SlopeSunAngle': (0.0, 'native-default'), 'TimeEnvFileNum': (1, 'native-default')})
        self.assertEqual((setup['bindings']['SKYBOX']['value'], setup['bindings']['SKYBOX']['source']), ('SkybackgroundColor', 'native-default'))

    def test_bindings_without_an_audited_default_and_unparsed_values_stay_unresolved(self):
        setup, unresolved = setup_of(environment_setup_file_text('[EnvSetup]\r\nTimeRatio=fast\r\nTimeEnvFileName0=TimeEnv0.INT\r\n'))
        self.assertEqual(unresolved, ['environment-setup-value-missing:HAZERING', 'environment-setup-value-missing:NumCloudColor',
                                      'environment-setup-value-unparsed:TimeRatio'])
        self.assertEqual((setup['values']['TimeRatio']['value'], setup['values']['TimeRatio']['raw']), (None, 'fast'))
        self.assertEqual(setup['bindings']['CLOUD'], [])

    def test_a_missing_time_environment_file_name_is_unresolved(self):
        _, unresolved = setup_of(SETUP_FILE_TEXT.replace('TimeEnvFileNum=1', 'TimeEnvFileNum=2'))
        self.assertEqual(unresolved, ['environment-setup-value-missing:TimeEnvFileName1'])

    def test_the_fog_section_keeps_five_start_and_end_ranges_and_the_fog_speed_located_in_their_records(self):
        setup, unresolved = setup_of(SETUP_FILE_TEXT)
        fog = setup['fog']
        self.assertEqual(unresolved, [])
        self.assertEqual([(setting['index'], setting['key'], setting['value']) for setting in fog['startRanges']],
                         [(1, 'StartRange1', 1.0), (2, 'StartRange2', 1.5), (3, 'StartRange3', 2.0), (4, 'StartRange4', 2.5), (5, 'StartRange5', 4.0)])
        self.assertEqual([setting['value'] for setting in fog['endRanges']], [4.0, 5.0, 6.0, 7.0, 10.0])
        self.assertEqual((fog['section'], fog['FogSpeed']['value'], fog['FogSpeed']['raw']), ('FOG', 1.0, '1'))

    def test_a_missing_fog_key_has_no_audited_default_and_stays_unresolved(self):
        setup, unresolved = setup_of(environment_setup_file_text(fog_section_text=FOG_SECTION_TEXT.replace('EndRange5=10.0\r\n', '')))
        self.assertEqual(unresolved, ['environment-setup-value-missing:EndRange5'])
        self.assertEqual((setup['fog']['endRanges'][4]['value'], setup['fog']['endRanges'][4]['source']), (None, 'unresolved'))
        _, without_section = setup_of(ENVIRONMENT_SETUP_SECTION_TEXT)
        self.assertEqual(len([reason for reason in without_section if reason.startswith('environment-setup-value-missing:')]), 11)


class EnvironmentNativeRulesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.directory = Path(temporary_directory.name)

    def test_every_rule_row_cites_db4_or_q12_and_the_17_sections_are_listed(self):
        document = json.loads(ENVIRONMENT_NATIVE_RULES_PATH.read_text(encoding='utf-8'))
        self.assertTrue(all(('DB-4' in row['provenance'] or 'Q12' in row['provenance']) and row['status'] == 'confirmed-interlude'
                            for row in document['rows']))
        rules, _ = load_environment_native_rules()
        self.assertEqual(len(rules['table.sections']), 17)

    def test_a_rules_file_with_a_missing_or_repeated_row_is_refused(self):
        document = json.loads(ENVIRONMENT_NATIVE_RULES_PATH.read_text(encoding='utf-8'))
        for label, rows in (('missing', document['rows'][1:]), ('repeated', [*document['rows'], document['rows'][0]])):
            with self.subTest(label):
                path = self.directory / f'{label}.json'
                path.write_text(json.dumps({**document, 'rows': rows}), encoding='utf-8')
                with self.assertRaisesRegex(FormatError, 'misses rule rows'):
                    load_environment_native_rules(path)


if __name__ == '__main__':
    unittest.main()
