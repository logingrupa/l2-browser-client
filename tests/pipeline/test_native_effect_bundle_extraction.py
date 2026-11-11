import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_effect_bundle as bundle
from reference_client_lock_fixture import lock_client_as_checked_conversion_root

EFFECT_OBJECT = 'Fixture.Effect'
SPRITE_TEXTURE_OBJECT = 'Fixture.SpriteTexture'
SKILL_TABLE_PATH = 'system/skillgrp.dat'
SOUND_TABLE_PATH = 'system/skillsoundgrp.dat'
SKILL_ID = 3
SKILL_LEVEL = 1


def sprite_emitter_child():
    return {'name': 'SpriteA', 'object': EFFECT_OBJECT + '.SpriteA', 'class': 'Engine.SpriteEmitter',
        'properties': {'Texture': {'class': 'Texture', 'object': SPRITE_TEXTURE_OBJECT}}}


class FullyReadPropertyReader:
    end = 0
    position = 0


class NativeTexturePackage:
    data = b'native texture export'

    def properties(self, item):
        return [], FullyReadPropertyReader()


class FixtureSourcePackages:
    def __init__(self, client):
        self.loaded = {}

    def resolve(self, reference, expected=None):
        class_name = 'Class' if reference == EFFECT_OBJECT else 'Texture'
        record = {'object': reference, 'class': class_name, 'package': 'textures/Fixture.utx', 'packageSha256': 'a' * 64}
        item = {'className': class_name, 'classObject': 'Engine.' + class_name, 'offset': 0, 'size': len(NativeTexturePackage.data)}
        return record, NativeTexturePackage(), item


class FixtureDefaultReader:
    def __init__(self, emitter_children):
        self.emitter_children = emitter_children
        self.definitions = {}

    def get(self, reference, trail=()):
        if reference == EFFECT_OBJECT:
            return {'object': EFFECT_OBJECT, 'nativeSuperClass': 'Engine.Emitter', 'properties': {}, 'effectiveProperties': {},
                'children': self.emitter_children}
        return {'effectiveProperties': {}}


class ConverterRecordingRequestsAndFailingWithItsWorkLog:
    def __init__(self, recorded_requests):
        self.recorded_requests = recorded_requests

    def __call__(self, client, output, umodel):
        self.output = output
        return self

    def convert(self, request):
        self.recorded_requests.append(request)
        log_path = self.output / '.work' / '0123abcdef01-job' / '000-export-SpriteTexture.log'
        raise ValueError(f'UModel failed or reported an error; inspect {log_path}')


class EffectBundleExtractionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.client = self.root / 'client'
        tables = {SKILL_TABLE_PATH: b'native skill table', SOUND_TABLE_PATH: b'native skill sound table'}
        for relative_path, payload in tables.items():
            (self.client / relative_path).parent.mkdir(parents=True, exist_ok=True)
            (self.client / relative_path).write_bytes(payload)
        lock_client_as_checked_conversion_root(self, self.client, self.client, list(tables))
        row = {'skill_id': SKILL_ID, 'skill_level': SKILL_LEVEL}
        self.decoded_tables = {
            'skillgrp': {'source': SKILL_TABLE_PATH, 'sourceSha256': hashlib.sha256(tables[SKILL_TABLE_PATH]).hexdigest(),
                'data': {'skill': [dict(row, description='')]}},
            'skillsoundgrp': {'source': SOUND_TABLE_PATH, 'sourceSha256': hashlib.sha256(tables[SOUND_TABLE_PATH]).hexdigest(),
                'data': {'skillsound': [dict(row)]}}}

    def extract(self, emitter_children, output, converter_output):
        recorded_requests = []
        recipe = {'schemaVersion': 1, 'id': 'fixture:skill:3', 'skillId': SKILL_ID, 'level': SKILL_LEVEL,
            'effectClasses': [{'object': EFFECT_OBJECT, 'packageSha256': 'a' * 64}]}
        with patch.object(bundle, 'decode_table', side_effect=lambda client, name: self.decoded_tables[name]), \
                patch.object(bundle, 'SourcePackages', FixtureSourcePackages), \
                patch.object(bundle, 'DefaultReader', lambda *arguments: FixtureDefaultReader(emitter_children)), \
                patch.object(bundle, 'Converter', ConverterRecordingRequestsAndFailingWithItsWorkLog(recorded_requests)):
            result = bundle._extract_bundle(self.client, recipe, output, lambda name, data: name, converter_output)
        return result, recorded_requests

    def test_converter_failure_under_a_converter_folder_outside_the_output_keeps_gap_reasons_path_free(self):
        lane_result, _ = self.extract([sprite_emitter_child()], self.root / 'lane' / 'bundle',
            self.root / 'lane' / 'converter')
        main_result, _ = self.extract([sprite_emitter_child()], self.root / 'main' / 'bundle',
            self.root / 'main-store' / 'converter')
        conversion_gaps = [gap for gap in lane_result['gaps'] if gap['feature'] == 'asset-conversion']
        self.assertEqual(len(conversion_gaps), 1)
        self.assertIn('<converter>', conversion_gaps[0]['reason'])
        for gap in lane_result['gaps']:
            for spelling in (str(self.root), self.root.as_posix()):
                self.assertNotIn(spelling, gap['reason'])
        self.assertEqual(lane_result['gaps'], main_result['gaps'])


if __name__ == '__main__':
    unittest.main()
