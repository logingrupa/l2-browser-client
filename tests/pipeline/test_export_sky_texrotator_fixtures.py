import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_sky_texrotator_fixtures import (SKY_TEXROTATOR_MANIFEST_SHA256, SKY_TEXROTATOR_REPORT_SHA256, captured_rotators, decoded_rotator_inputs,
                                                  rotator_matrix_events)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'sky-texrotator-fixtures.json'
FIXTURES_FILE_SHA256 = '5afe09c4fc681827c80bc58acd6539b3695e2633f15bb613646bc45592e01aa4'
IDENTITY_MATRIX_BYTES_HEX = struct.pack('<16f', 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1).hex()
SYNTHETIC_LAYOUT = [{'offset': '0x0', 'name': 'TexRotationType', 'type': 'uint8'}, {'offset': '0x4', 'name': 'Rotation', 'type': 'int32 Pitch,Yaw,Roll'},
                    {'offset': '0x10', 'name': 'ConstantRotation legacy bit 0', 'type': 'uint32'}, {'offset': '0x14', 'name': 'UOffset', 'type': 'float32'},
                    {'offset': '0x18', 'name': 'VOffset', 'type': 'float32'}, {'offset': '0x1c', 'name': 'Matrix', 'type': '16 float32, row-major'}]


def synthetic_object_bytes(mode, yaw, u_offset):
    return struct.pack('<B3x3iIff', mode, 0, yaw, 0, 0, u_offset, 0.0).ljust(0x5c, b'\0')


def synthetic_event(sequence, object_name, object_bytes, time_hex='a2f43642', clock_hex='a2f43642'):
    return {'kind': 'rotator-matrix', 'sequence': sequence, 'functionVa': '0x105e0c00', 'object': object_name, 'objectBytesHex': object_bytes.hex(),
            'timeBytesHex': time_hex, 'clocks': {'timeSecondsBytesHex': clock_hex}, 'matrixBytesHex': IDENTITY_MATRIX_BYTES_HEX}


def capture_bytes(events):
    return '\n'.join(json.dumps(event) for event in events).encode('utf-8')


class CommittedSkyTexRotatorFixturesTests(unittest.TestCase):
    def test_the_committed_file_holds_the_eleven_native_fixtures_and_the_two_live_rotators_of_the_pinned_delivery(self):
        data = FIXTURES_FILE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), FIXTURES_FILE_SHA256)
        document = json.loads(data)
        self.assertEqual((document['source']['reportSha256'], document['source']['manifestSha256']), (SKY_TEXROTATOR_REPORT_SHA256, SKY_TEXROTATOR_MANIFEST_SHA256))
        self.assertEqual(len(document['fixtures']), 11)
        self.assertEqual([(row['object'], row['eventCount']) for row in document['capturedRotators']],
                         [('L2_Skies.Shaders.TexRotator1', 636), ('FX_E_T.WaterSurfaceShaderSet.ocn_rot', 1)])
        self.assertEqual(document['sineTable'], {'file': 'sky-texrotator-rm29/matrix/gmath-sin-cw027f.bin',
                                                 'sha256': '9893d14bd21e5c4194832659571b30363ddfb08d468ed662a4b6d5ae172262dc', 'entries': 16384})


class CapturedRotatorGroupingTests(unittest.TestCase):
    def test_decodes_the_layout_inputs_and_skips_the_output_matrix(self):
        inputs = decoded_rotator_inputs(synthetic_object_bytes(1, 4096, 512.0), SYNTHETIC_LAYOUT)
        self.assertEqual(inputs, {'TexRotationType': 1, 'Rotation': {'Pitch': 0, 'Yaw': 4096, 'Roll': 0}, 'ConstantRotation': 0, 'UOffset': 512.0, 'VOffset': 0.0})

    def test_groups_identical_calls_and_gives_the_replayed_object_its_resolved_size(self):
        star = synthetic_object_bytes(1, 0, 512.0)
        events = rotator_matrix_events(capture_bytes([synthetic_event(2, 'Star', star), synthetic_event(3, 'Star', star),
                                                      synthetic_event(9, 'Water', synthetic_object_bytes(0, 4096, 0.0))]))
        replay = {'object': 'Star', 'timeBytesHex': 'a2f43642', 'matrixBytesHex': IDENTITY_MATRIX_BYTES_HEX, 'resolvedSize': [1024, 1024]}
        rows = captured_rotators(events, SYNTHETIC_LAYOUT, replay)
        self.assertEqual([(row['object'], row['eventCount'], row['resolvedSize']) for row in rows], [('Star', 2, [1024, 1024]), ('Water', 1, None)])

    def test_refuses_a_call_whose_time_is_not_the_level_info_time_seconds(self):
        with self.assertRaisesRegex(DayNightFixtureError, 'differs from its LevelInfo.TimeSeconds'):
            rotator_matrix_events(capture_bytes([synthetic_event(2, 'Star', synthetic_object_bytes(1, 0, 0.0), clock_hex='00000000')]))

    def test_refuses_a_pivot_offset_without_a_resolved_texture_size(self):
        events = rotator_matrix_events(capture_bytes([synthetic_event(4, 'Pivoted', synthetic_object_bytes(0, 0, 64.0))]))
        replay = {'object': 'Star', 'timeBytesHex': 'a2f43642', 'matrixBytesHex': IDENTITY_MATRIX_BYTES_HEX, 'resolvedSize': [1024, 1024]}
        with self.assertRaisesRegex(DayNightFixtureError, 'has a pivot offset but no resolved texture size'):
            captured_rotators(events, SYNTHETIC_LAYOUT, replay)


if __name__ == '__main__':
    unittest.main()
