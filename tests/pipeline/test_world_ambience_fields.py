import hashlib
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import world_ambience as ambience

CORE = ROOT / 'artifacts/native-parity/research/flame-runtime/inputs/Core.dll'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def wav(frames=22050, rate=22050):
    data = b'\0\0' * frames
    return b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(data)) + data


def prop(name, value):
    return {'name': name, 'arrayIndex': None, 'value': value}


class AmbienceFieldTests(unittest.TestCase):
    def test_wav_facts_and_emitter_row_keep_omitted_fields_null(self):
        self.assertEqual(ambience.wav_facts(wav()), {'channels': 1, 'sampleRate': 22050, 'bitsPerSample': 16, 'durationSeconds': 1.0})
        item = {'id': 'interlude:20_20.AmbientSoundObject1', 'object': '20_20.AmbientSoundObject1', 'exportIndex': 5,
                'soundReference': 'AmbSound.Wind.w_01',
                'declaration': {'class': 'AmbientSoundObject', 'id': 'interlude:20_20.AmbientSoundObject1', 'properties': [
                    prop('SoundRadius', 120.0), prop('SoundVolume', 250), prop('Group', 'None,s_wind'),
                    prop('Location', {'X': 1.0, 'Y': 2.0, 'Z': 3.0}),
                    prop('Region', [{'name': 'Zone', 'value': {'index': 2, 'object': '20_20.LevelInfo0'}}, {'name': 'ZoneNumber', 'value': 0}])]}}
        row = dict(zip(ambience.FIELDS, ambience.emitter_row(item, {'ambsound.wind.w_01'})))
        self.assertEqual((row['x'], row['y'], row['z'], row['soundRadius'], row['soundVolume'], row['sound'], row['zone']),
                         (1.0, 2.0, 3.0, 120.0, 250, 'ambsound.wind.w_01', '20_20.LevelInfo0'))
        self.assertIsNone(row['ambientSoundType']); self.assertIsNone(row['ambientRandom']); self.assertIsNone(row['soundPitch'])
        with self.assertRaisesRegex(ValueError, 'unexported sound'):
            ambience.emitter_row(item, set())

    @unittest.skipUnless(CORE.is_file(), 'Retained original Core.dll is not present')
    def test_reads_static_radius_multiplier_from_original_core(self):
        data = CORE.read_bytes()
        self.assertEqual(sha(data), '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf')
        value = ambience.pe_export_f32(data, '?GAudioMaxRadiusMultiplier@@3MA')
        self.assertEqual((value['value'], value['section'], value['bytesHex']), (50.0, '.data', '00004842'))
        self.assertEqual(ambience.pe_export_f32(data, '?GAudioDefaultRadius@@3MA')['value'], 80.0)
        with self.assertRaisesRegex(ValueError, 'Export not found'):
            ambience.pe_export_f32(data, '?Missing@@3MA')


if __name__ == '__main__':
    unittest.main()
