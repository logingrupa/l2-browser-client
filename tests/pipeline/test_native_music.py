from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import world_music as subject
from test_world_music_helpers import l2_stream, sha


class BundlePlumbingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-music-bundle-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.tracks = {'a01_f.ogg': l2_stream(seconds=2), 'a01_s01.ogg': l2_stream(seconds=4)}
        snapshot = self.root / 'artifacts/native-parity/inputs/IMPORTA-PC'
        (snapshot / 'music').mkdir(parents=True)
        (snapshot / 'maps').mkdir()
        self.map = b'fixture map bytes'
        (snapshot / 'maps/20_20.unr').write_bytes(self.map)
        for name, data in self.tracks.items():
            (snapshot / 'music' / name).write_bytes(data)
        self.payload_sha = 'e' * 64
        join = {'joins': [{'volumeEvidence': {'object': '20_20.MusicVolume1', 'exportIndex': 9, 'nMusicID': 101,
                                              'bForcePlayMusic': True, 'payloadSha256': self.payload_sha, 'payloadBytes': 50},
                           'musicinfo': {'id': 101, 'cnt': 2, 'orderedStrings': ['A01_F', 'A01_S01'], 'line': 3, 'rawLine': '101\t2\tA01_F\tA01_S01'},
                           'filenameJoins': [{'arrayIndex': i, 'storedString': s, 'filenameMatches': [
                               {'path': 'C:\\Lineage2-client\\music\\' + n, 'bytes': len(self.tracks[n]), 'sha256': sha(self.tracks[n])}]}
                               for i, (s, n) in enumerate((('A01_F', 'a01_f.ogg'), ('A01_S01', 'a01_s01.ogg')))]}]}
        evidence = self.root / 'artifacts/evidence/MUSIC_ID_JOIN.json'
        evidence.parent.mkdir(parents=True)
        evidence.write_bytes(json.dumps(join).encode())
        source = {'sourceHost': 'IMPORTA-PC', 'sourceRoot': 'C:/Lineage2-client'}
        (self.root / 'recipes').mkdir()
        self.write('recipes/map.lock.json', {'schemaVersion': 1, **source, 'files': [
            {'relativePath': 'maps/20_20.unr', 'bytes': len(self.map), 'sha256': sha(self.map)}]})
        self.join_pin = {'path': 'artifacts/evidence/MUSIC_ID_JOIN.json', 'sha256': sha(evidence.read_bytes())}
        self.write('recipes/music.lock.json', {'schemaVersion': 1, **source, 'joinEvidence': self.join_pin, 'files': [
            {'relativePath': 'music/' + n, 'bytes': len(d), 'sha256': sha(d)} for n, d in self.tracks.items()]})
        recipe = json.loads((ROOT / 'recipes/native-music-20_20.json').read_text())
        recipe.update(map={'file': 'maps/20_20.unr', 'bytes': len(self.map), 'sha256': sha(self.map), 'lock': 'recipes/map.lock.json'},
                      musicLock='recipes/music.lock.json', musicIdJoin=self.join_pin,
                      expectedVolumes=[{'object': '20_20.MusicVolume1', 'exportIndex': 9, 'musicId': 101}])
        self.write('recipes/music.json', recipe)
        self.output = self.root / 'artifacts/research/music-bundle'
        volume = {'id': 'interlude:20_20.MusicVolume1', 'object': '20_20.MusicVolume1', 'exportIndex': 9, 'musicId': 101,
                  'forcePlayMusic': True, 'nativePayload': {'bytes': 50, 'sha256': self.payload_sha}, 'worldPlanes': [[1, 0, 0, 1]] * 4}
        self.encodes = 0

        def encode(_encoder, _args, restored):
            self.encodes += 1
            return b'\0\0\0\x14ftypM4A \0\0\0\0' + sha(restored).encode()
        for target, value in (('music_volumes', lambda *_: [dict(volume)]),
                              ('encoder_identity', lambda *_: {'name': 'ffmpeg', 'version': 'fixture', 'sha256': 'f' * 64}),
                              ('encode', encode)):
            patcher = patch.object(subject, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write(self, name, value):
        (self.root / name).write_bytes(json.dumps(value, indent=1).encode())

    def run_bundle(self, **options):
        return subject.run(self.root, self.root / 'recipes/music.json', self.output, encoder='fixture-encoder', **options)

    def files(self):
        return {p.relative_to(self.output).as_posix(): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}

    def test_produces_deterministic_bundle_with_order_restoration_and_derivative(self):
        planned = self.run_bundle(plan=True)
        self.assertFalse(self.output.exists())
        first = self.run_bundle()
        self.assertEqual((first['status'], first['filesWritten'], first['manifestSha256']), ('produced', 5, planned['manifestSha256']))
        manifest = json.loads((self.output / 'manifest.json').read_bytes())
        self.assertEqual(manifest['volumes'][0]['tracks'], ['music:A01_F', 'music:A01_S01'])
        track = manifest['tracks'][0]
        restored = (self.output / track['file']).read_bytes()
        self.assertTrue(restored.startswith(b'OggS'))
        self.assertEqual(subject.unpatch(restored, track['original']['patch']), self.tracks['a01_f.ogg'])
        self.assertEqual(track['original']['sha256'], sha(self.tracks['a01_f.ogg']))
        self.assertTrue(track['derivative']['file'].startswith('derived/') and track['derivative']['mime'] == 'audio/mp4')
        self.assertEqual({row['path'] for row in manifest['files']} | {'manifest.json'}, set(self.files()))
        before = self.files()
        repeat = self.run_bundle()
        self.assertEqual((repeat['status'], repeat['filesWritten'], repeat['manifestSha256']), ('preserved', 0, first['manifestSha256']))
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(self.files(), before)

    def test_refuses_overwrite_drift_and_unlocked_inputs(self):
        with self.assertRaisesRegex(ValueError, 'Verify-only requires'):
            self.run_bundle(verify_only=True)
        self.run_bundle()
        target = next(p for p in self.output.rglob('*.ogg'))
        target.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'differs; preserved'):
            self.run_bundle()
        self.assertEqual(target.read_bytes(), b'tampered')
        (self.root / 'artifacts/native-parity/inputs/IMPORTA-PC/music/a01_s01.ogg').write_bytes(l2_stream(seconds=5))
        with self.assertRaisesRegex(ValueError, 'hash/size differs'):
            self.run_bundle(plan=True)

    def test_refuses_outputs_outside_artifacts_and_join_mismatch(self):
        self.output = self.root / 'public/l2/music'
        with self.assertRaisesRegex(ValueError, 'artifacts/scratch'):
            self.run_bundle()
        self.assertFalse(self.output.exists())
        self.output = self.root / 'artifacts/research/music-bundle'
        with patch.object(subject, 'music_volumes', lambda *_: [{'id': 'x', 'object': '20_20.MusicVolume1', 'exportIndex': 9, 'musicId': 101,
                                                                 'forcePlayMusic': None, 'nativePayload': {'bytes': 50, 'sha256': self.payload_sha}}]):
            with self.assertRaisesRegex(ValueError, 'Join evidence differs'):
                self.run_bundle(plan=True)


class LockTests(unittest.TestCase):
    def test_music_lock_matches_join_and_main_lock_is_unchanged(self):
        music = json.loads((ROOT / 'recipes/native-music.inputs.json').read_text())
        join_path = ROOT / music['joinEvidence']['path']
        main = json.loads((ROOT / 'recipes/native-inputs.lock.json').read_text())
        self.assertFalse(any(row['relativePath'].startswith('music/') for row in main['files']))
        if not join_path.is_file():
            self.skipTest('Join evidence is not present')
        self.assertEqual(sha(join_path.read_bytes()), music['joinEvidence']['sha256'])
        join = json.loads(join_path.read_text())
        expected = sorted((('music/' + m['path'].split('\\')[-1], m['bytes'], m['sha256'])
                           for row in join['joins'] for f in row['filenameJoins'] for m in f['filenameMatches']))
        self.assertEqual(sorted((r['relativePath'], r['bytes'], r['sha256']) for r in music['files']), expected)


if __name__ == '__main__':
    unittest.main()
