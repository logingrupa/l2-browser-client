from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_environment import HEADER, XOR
from reference_client_guard import ReferenceClientLockError, require_reference_client
from world.environment_program import (ENVIRONMENT_TYPES, environment_lock_input_records, read_environment_program, typed_environment_value)

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SETUP_TEXT = ('[EnvSetup]\r\nIsClock=true\r\nStartTime=12\r\nTimeRatio=6\r\nTimeEnvFileNum=4\r\n'
              + ''.join(f'TimeEnvFileName{index}=TimeEnv{index}.INT\r\n' for index in ENVIRONMENT_TYPES)
              + '[FOG]\r\nStartRange1=1.0\r\n[WaterVolume]\r\nWaterVolumeFogColor=(R=39,G=87,B=126)\r\n')


def environment_type_text(environment_type):
    return (f'[EnvType]\r\nEnvType={environment_type}\r\n[SunColor]\r\nNUM=2\r\nColor0=(T=6,R=255,G=200,B={environment_type})\r\n'
            'Color1=(T=24,R=10,G=20,B=30)\r\n[SunScale]\r\nNUM=1\r\nScale0=(T=6,S=1.5)\r\n')


def encoded_environment_file(text):
    body = HEADER + text.encode('ascii').translate(XOR)
    return body + struct.pack('<5I', 0, 7, 90, zlib.crc32(body), 0)


class DirectoryClientAccess:
    def __init__(self, root, refused=()):
        self.root, self.refused = root, set(refused)

    def require_equal_file(self, relative_path):
        if relative_path in self.refused:
            raise ReferenceClientLockError(f'reference client lock class of {relative_path} is different, not equal')
        return self.root / relative_path


def synthetic_client(directory, missing_types=()):
    system = Path(directory) / 'system'
    system.mkdir()
    (system / 'Env.int').write_bytes(encoded_environment_file(SETUP_TEXT))
    for environment_type in ENVIRONMENT_TYPES:
        if environment_type not in missing_types:
            (system / f'TimeEnv{environment_type}.INT').write_bytes(encoded_environment_file(environment_type_text(environment_type)))
    return Path(directory)


class EnvironmentValueTests(unittest.TestCase):
    def test_values_are_typed_by_their_written_form(self):
        self.assertEqual(typed_environment_value('true'), {'kind': 'boolean', 'value': True})
        self.assertEqual(typed_environment_value('6'), {'kind': 'integer', 'value': 6})
        self.assertEqual(typed_environment_value('1.500000'), {'kind': 'number', 'value': 1.5})
        self.assertEqual(typed_environment_value('(T=6,R=255,G=200,B=7)'), {'kind': 'tuple', 'fields': [['T', 6], ['R', 255], ['G', 200], ['B', 7]]})
        self.assertEqual(typed_environment_value('(X1=0,Y1=-2.5)'), {'kind': 'tuple', 'fields': [['X1', 0], ['Y1', -2.5]]})
        self.assertEqual(typed_environment_value('TimeEnv0.INT'), {'kind': 'text', 'value': 'TimeEnv0.INT'})


class EnvironmentProgramTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.directory = temporary_directory.name

    def test_all_four_environment_types_are_typed_with_the_setup_time_values(self):
        program = read_environment_program(DirectoryClientAccess(synthetic_client(self.directory)))
        self.assertEqual(program['unresolved'], [])
        self.assertEqual(program['setupValues']['TimeRatio']['value'], 6)
        self.assertEqual(program['setupValues']['StartTime']['value'], 12)
        self.assertEqual([entry['environmentType'] for entry in program['environmentTypes']], list(ENVIRONMENT_TYPES))
        for entry in program['environmentTypes']:
            with self.subTest(entry['environmentType']):
                self.assertEqual(entry['declaredEnvType']['value'], entry['environmentType'])
                sun = next(section for section in entry['sections'] if section['section'] == 'SunColor')
                self.assertEqual([prop['key'] for prop in sun['properties']], ['NUM', 'Color0', 'Color1'])
                self.assertEqual(sun['properties'][1]['fields'][3], ['B', entry['environmentType']])

    def test_a_missing_type_file_is_unresolved_and_never_a_default(self):
        program = read_environment_program(DirectoryClientAccess(synthetic_client(self.directory, missing_types=(2,))))
        self.assertEqual(program['unresolved'], ['environment-program-unresolved:TimeEnv2.INT'])
        missing = program['environmentTypes'][2]
        self.assertEqual((missing['sections'], missing['declaredEnvType'], missing['sha256']), ([], None, None))
        self.assertIsNone(program['environmentTypes'][1]['unresolved'])

    def test_a_setup_file_outside_the_lock_leaves_every_type_unresolved(self):
        access = DirectoryClientAccess(synthetic_client(self.directory), refused={'system/Env.int'})
        program = read_environment_program(access)
        self.assertEqual(program['unresolved'], ['environment-program-unresolved:Env.int'])
        self.assertTrue(all(entry['unresolved'] == 'environment-program-unresolved:Env.int' for entry in program['environmentTypes']))
        self.assertEqual(program['setupValues'], {'TimeRatio': None, 'StartTime': None, 'TimeEnvFileNum': None})


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class RealClientEnvironmentProgramTests(unittest.TestCase):
    def test_the_locked_client_types_all_four_environments(self):
        program = read_environment_program(require_reference_client(REFERENCE_CLIENT))
        self.assertEqual(program['unresolved'], [])
        self.assertEqual([entry['declaredEnvType']['value'] for entry in program['environmentTypes']], [0, 1, 2, 3])
        self.assertEqual({record['path'].casefold() for record in environment_lock_input_records()},
                         {'system/env.int', *(f'system/timeenv{index}.int' for index in ENVIRONMENT_TYPES)})


if __name__ == '__main__':
    unittest.main()
