from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
import stage_native_world_audio as stager
from test_world_ambience_fields import sha, wav


class StageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-world-audio-stage-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.public = self.root / 'public/l2'
        self.public.mkdir(parents=True)
        self.catalog = {'schemaVersion': 1, 'models': [{'id': 'kept:0'}], 'animationAudio': [{'id': 'kept'}], 'extension': {'keep': [1, 2]}}
        (self.public / 'catalog.json').write_bytes(json_bytes(self.catalog))
        self.bundle = self.root / 'artifacts/ambience-bundle'
        (self.bundle / 'audio').mkdir(parents=True)
        self.wav = wav()
        (self.bundle / 'audio' / (sha(self.wav) + '.wav')).write_bytes(self.wav)
        self.manifest = json_bytes({'schemaVersion': 1, 'kind': 'native-map-ambience', 'emitters': [],
                                    'files': [{'path': 'audio/' + sha(self.wav) + '.wav', 'bytes': len(self.wav), 'sha256': sha(self.wav), 'mime': 'audio/wav'}]})
        (self.bundle / 'manifest.json').write_bytes(self.manifest)
        (self.root / 'assets').mkdir()
        (self.root / 'assets/authored.scene').write_bytes(b'sentinel')

    def catalog_sha(self):
        return sha((self.public / 'catalog.json').read_bytes())

    def stage(self, **options):
        return stager.stage(self.bundle, sha(self.manifest), options.pop('expected', self.catalog_sha()),
                            bundle_id=options.pop('bundle_id', 'map-20-20-ambience'), root=self.root, **options)

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_plan_stage_verify_and_zero_write_repeat(self):
        before = self.snapshot()
        planned = self.stage(plan=True)
        self.assertEqual((planned['filesWritten'], self.snapshot()), (0, before))
        staged = self.stage()
        self.assertEqual(staged['filesWritten'], 3)
        catalog = json.loads((self.public / 'catalog.json').read_bytes())
        self.assertEqual(catalog['worldAudio'], [staged['entry']])
        self.assertEqual({k: v for k, v in catalog.items() if k != 'worldAudio'}, self.catalog)
        prefix = self.public / 'world-audio' / sha(self.manifest)
        self.assertEqual((prefix / 'manifest.json').read_bytes(), self.manifest)
        self.assertEqual((prefix / 'audio' / (sha(self.wav) + '.wav')).read_bytes(), self.wav)
        after = self.snapshot()
        self.assertEqual(self.stage(verify_only=True)['filesWritten'], 0)
        self.assertEqual(self.stage()['filesWritten'], 0)
        self.assertEqual(self.snapshot(), after)
        self.assertEqual(after['assets/authored.scene'], b'sentinel')

    def test_refuses_catalog_drift_payload_drift_and_conflicting_identities(self):
        with self.assertRaisesRegex(ValueError, 'Catalog changed'):
            self.stage(expected='0' * 64)
        with self.assertRaisesRegex(ValueError, 'not completely staged'):
            self.stage(verify_only=True)
        self.stage()
        with self.assertRaisesRegex(ValueError, 'Another bundle of this kind'):
            self.stage(bundle_id='other-ambience')
        target = self.public / 'world-audio' / sha(self.manifest) / 'audio' / (sha(self.wav) + '.wav')
        target.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'differs; preserved'):
            self.stage()
        self.assertEqual(target.read_bytes(), b'corrupt')
        (self.bundle / 'audio' / (sha(self.wav) + '.wav')).write_bytes(b'drift')
        with self.assertRaisesRegex(ValueError, 'payload differs'):
            self.stage(plan=True)

    def test_rejects_unlisted_mime_and_non_project_bundle(self):
        manifest = json.loads(self.manifest)
        manifest['files'][0]['mime'] = 'audio/ogg'
        self.manifest = json_bytes(manifest)
        (self.bundle / 'manifest.json').write_bytes(self.manifest)
        with self.assertRaisesRegex(ValueError, 'payload descriptor'):
            self.stage(plan=True)
        with tempfile.TemporaryDirectory() as outside:
            with self.assertRaisesRegex(ValueError, 'project child'):
                stager.stage(Path(outside), sha(self.manifest), self.catalog_sha(), bundle_id='x-y', root=self.root)


CANONICAL = ROOT / 'artifacts/native-parity/research/native-world-audio-20261106/pointregion-integration/raw-map-after/ambient-sounds.json'
CANONICAL_SHA = 'cf92df3f848108556d166c7fb333fad1a7a29fa794eb0612c813a284cceb4f9a'
STAGED_AMBIENCE = ROOT / 'public/l2/world-audio/e2fe18be38caf3a8476e194b0ad1641b62f04dbd9dd1925f4c09ddd5d8e74a01/manifest.json'


@unittest.skipUnless(CANONICAL.is_file() and STAGED_AMBIENCE.is_file(), 'Canonical ambient decode or staged ambience bundle is not present')
class CanonicalDecodeTests(unittest.TestCase):
    def test_every_object_matches_the_canonical_decode_and_omitted_fields_stay_null(self):
        raw = CANONICAL.read_bytes()
        self.assertEqual(sha(raw), CANONICAL_SHA)
        canonical = json.loads(raw)['objects']
        manifest = json.loads(STAGED_AMBIENCE.read_text(encoding='utf-8'))
        fields = manifest['emitterFields']
        rows = {row[0]: dict(zip(fields, row)) for row in manifest['emitters']}
        self.assertEqual(len(canonical), 2622)
        self.assertEqual(set(rows), {item['object'] for item in canonical})
        names = {'AmbientSoundType': 'ambientSoundType', 'AmbientRandom': 'ambientRandom', 'AmbientSoundStartTime': 'ambientSoundStartTime',
                 'SoundRadius': 'soundRadius', 'SoundVolume': 'soundVolume', 'SoundPitch': 'soundPitch'}
        for item in canonical:
            row, props = rows[item['object']], {p['name']: p['value'] for p in item['properties']}
            for native, field in names.items():
                self.assertEqual(row[field], props.get(native), (item['object'], native))
            location = props['Location']
            self.assertEqual([row['x'], row['y'], row['z']], [location['X'], location['Y'], location['Z']], item['object'])
            sound = props.get('AmbientSound')
            self.assertEqual(row['sound'], sound['object'].lower() if isinstance(sound, dict) and sound.get('object') else None, item['object'])


if __name__ == '__main__':
    unittest.main()
