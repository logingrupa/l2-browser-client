import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_static_mesh_light_gate_fixtures import (RM19_FIXTURE_INPUTS_SHA256, RM19_INTEGRATED_FIXTURES_SHA256, RM26_REPORT_SHA256, RM27_REPORT_SHA256,
                                                          WALL5383_ADDENDUM_SHA256, light_cache_flag_defaults, rm26_live_receivers, rm26_map_sha256)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'static-mesh-light-gate-fixtures.json'
FIXTURES_FILE_SHA256 = '760b2ed0f7ac8aec030d0cc761fe88c66166e96d76dcfb5144625cd982d1cdad'


def class_default_flag(value):
    return {'value': value, 'source': 'package-class-default'}


class CommittedStaticMeshLightGateFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_pinned_rm19_flags_rm26_receivers_and_rm27_normals(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual([document['source'][name]['sha256'] for name in ('rm19FixtureInputs', 'rm19IntegratedFixtures', 'rm26Report', 'wall5383Addendum',
                                                                          'rm27Report')],
                         [RM19_FIXTURE_INPUTS_SHA256, RM19_INTEGRATED_FIXTURES_SHA256, RM26_REPORT_SHA256, WALL5383_ADDENDUM_SHA256, RM27_REPORT_SHA256])
        self.assertEqual(document['source']['rm26Map']['sha256'], '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4')
        self.assertEqual([receiver['exportIndex'] for receiver in document['rm26Receivers']], [9216, 6055, 1548, 5327, 5336, 5335, 5374, 5383])
        arch16 = next(receiver for receiver in document['rm26Receivers'] if receiver['exportIndex'] == 5327)
        self.assertEqual([entry['light'] for entry in arch16['ordinaryEntries']], [55, 128, 123])
        self.assertEqual({(field['field'], field['provenance'], field['value']) for light in arch16['lights'] for field in light['fields']},
                         {('bLightChanged', 'map-property-tag', True), ('bDynamicLight', 'package-class-default', False),
                          ('bDeleteMe', 'package-class-default', False)})
        self.assertEqual([vertex['vertex'] for vertex in document['rm27Normals']['vertices']], [104, 18, 0])


class StaticMeshLightGateFixturesDocumentTests(unittest.TestCase):
    def test_two_disagreeing_class_defaults_for_one_flag_are_refused(self):
        light = {'class': 'Engine.Light', 'effective': {'bDynamicLight': class_default_flag(False), 'bLightChanged': class_default_flag(False),
                                                       'bDeleteMe': class_default_flag(False)}}
        conflicting = {**light, 'effective': {**light['effective'], 'bLightChanged': class_default_flag(True)}}
        sun = {'effective': light['effective']}
        self.assertEqual(light_cache_flag_defaults({'lights': [light], 'sun': sun})['Engine.Light']['bLightChanged'], False)
        with self.assertRaisesRegex(DayNightFixtureError, 'two Engine.Light defaults for bLightChanged'):
            light_cache_flag_defaults({'lights': [light, conflicting], 'sun': sun})

    def test_a_report_without_one_20_20_map_pin_or_seven_live_samples_is_refused(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'pins 0 copies'):
            rm26_map_sha256({'sources': []})
        with self.assertRaisesRegex(DayNightFixtureError, 'holds 1 live samples'):
            rm26_live_receivers({'liveSamples': [{}]}, {})


if __name__ == '__main__':
    unittest.main()
