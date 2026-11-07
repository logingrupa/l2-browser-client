"""Map music bundle contract: L2SD Ogg restoration, MusicVolume brushes, joins and
deterministic refuse-overwrite output. Synthetic fixtures; real inputs only when present."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import world_music as subject  # noqa: E402

MAP = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC/maps/20_20.unr'
SPAWN = (10560.0, 95040.0, -3455.0)  # staged section surface candidate, native units


def sha(data):
    return hashlib.sha256(data).hexdigest()


def page(capture, flags, granule, sequence, packets, serial=7):
    lacing, body = b'', b''
    for packet in packets:
        size = len(packet)
        lacing += bytes([255] * (size // 255) + [size % 255])
        body += packet
    header = bytearray(b'OggS' + bytes([0, flags]) + struct.pack('<qII', granule, serial, sequence) + b'\0\0\0\0' + bytes([len(lacing)]) + lacing)
    data = bytearray(header + body)
    struct.pack_into('<I', data, 22, subject.ogg_crc(bytes(data)))
    data[0:4] = capture
    return bytes(data)


def vorbis_id(channels=2, rate=44100):
    return b'\x01vorbis' + struct.pack('<I', 0) + bytes([channels]) + struct.pack('<I', rate) + struct.pack('<iii', 0, 128000, 0) + b'\xb8\x01'


def l2_stream(trailer=bytes.fromhex('000000000200000036000000dc198db400000000'), seconds=3, channels=2):
    return (page(b'L2SD', 2, 0, 0, [vorbis_id(channels)]) + page(b'OggS', 0, 0, 1, [b'\x03vorbis' + b'c' * 40, b'\x05vorbis' + b's' * 300]) +
            page(b'OggS', 4, 44100 * seconds, 2, [b'audio' * 60]) + trailer)


class RestorationTests(unittest.TestCase):
    def test_restores_only_the_capture_and_trailer_and_is_reversible(self):
        original = l2_stream()
        restored, facts = subject.restore_l2_ogg(original)
        self.assertEqual(restored, b'OggS' + original[4:-20])
        self.assertEqual(subject.unpatch(restored, facts['patch']), original)
        self.assertEqual((facts['channels'], facts['sampleRate'], facts['pages'], facts['durationSeconds']), (2, 44100, 3, 3.0))
        self.assertEqual(facts['patch']['originalCapture'], 'L2SD')
        # A standard Ogg stream is accepted unchanged with an empty patch.
        plain = b'OggS' + original[4:-20]
        self.assertEqual(subject.restore_l2_ogg(plain)[0], plain)

    def test_rejects_corrupt_crc_extra_pages_and_non_vorbis(self):
        original = bytearray(l2_stream())
        original[200] ^= 0x55
        with self.assertRaisesRegex(ValueError, 'CRC'):
            subject.restore_l2_ogg(bytes(original))
        with self.assertRaisesRegex(ValueError, 'after the Ogg EOS'):
            subject.restore_l2_ogg(l2_stream(trailer=page(b'OggS', 4, 1, 3, [b'x'])))
        with self.assertRaisesRegex(ValueError, 'after the Ogg EOS'):
            subject.restore_l2_ogg(l2_stream(trailer=b'\0' * 65))
        bad = page(b'L2SD', 2, 0, 0, [b'\x01notvorbis' + b'\0' * 20]) + l2_stream()[len(page(b'L2SD', 2, 0, 0, [vorbis_id()])):]
        with self.assertRaisesRegex(ValueError, 'Vorbis identification'):
            subject.restore_l2_ogg(bad)
        with self.assertRaisesRegex(ValueError, 'L2SD/Ogg'):
            subject.restore_l2_ogg(b'RIFF' + bytes(100))


@unittest.skipUnless(MAP.is_file(), 'Locked 20_20 map snapshot is not present')
class RealMapTests(unittest.TestCase):
    def test_music_volumes_are_convex_brushes_and_spawn_is_in_volume_one(self):
        volumes = subject.music_volumes(MAP.read_bytes(), 'maps/20_20.unr')
        self.assertEqual([(v['object'], v['exportIndex'], v['musicId'], v['forcePlayMusic']) for v in volumes],
                         [('20_20.MusicVolume0', 335, 202001, None), ('20_20.MusicVolume1', 1329, 202002, True)])
        inside = lambda v, p: all(a * p[0] + b * p[1] + c * p[2] - w <= 0 for a, b, c, w in v['worldPlanes'])
        self.assertEqual([len(v['worldPlanes']) for v in volumes], [6, 10])
        self.assertFalse(inside(volumes[0], SPAWN))
        self.assertTrue(inside(volumes[1], SPAWN))
        for volume in volumes:  # every transformed brush point lies on/inside its own planes
            lo, hi = volume['worldBounds']['min'], volume['worldBounds']['max']
            centre = [(a + b) / 2 for a, b in zip(lo, hi)]
            self.assertTrue(inside(volume, centre))
        self.assertEqual(volumes[1]['worldBounds']['min'][2], -4675.0)


ORACLE = ROOT / 'artifacts/native-parity/research/native-sound-answers-20261107/evidence/lead-ps10/ps10_music_ambient.json'


@unittest.skipUnless(MAP.is_file() and ORACLE.is_file(), 'Locked map or the PlayerStart10 research oracle is not present')
class ResearchOracleTests(unittest.TestCase):
    """Our exporter's MusicVolume planes against native-sound-answers-20261107 (REPORT.md Q2):
    PlayerStart10 inside MusicVolume1, BSP prism X 8898..14066, Y 93481..96601, Z -4675..-2675."""

    @classmethod
    def setUpClass(cls):
        cls.volumes = {v['object']: v for v in subject.music_volumes(MAP.read_bytes(), 'maps/20_20.unr')}
        cls.oracle = json.loads(ORACLE.read_text(encoding='utf-8'))

    @staticmethod
    def inside(volume, point):
        return all(a * point[0] + b * point[1] + c * point[2] - w <= 1e-3 for a, b, c, w in volume['worldPlanes'])

    def test_player_starts_and_extents_match_the_oracle(self):
        mv1, music = self.volumes['20_20.MusicVolume1'], self.oracle['music']
        self.assertEqual(mv1['brush']['object'].rsplit('.', 1)[-1], 'Model18')
        self.assertEqual(mv1['transformPolicy'].split(';')[0], 'world = local - PrePivot + Location')
        for name in ('PlayerStart10', 'PlayerStart34'):
            point = music[name]['location']
            self.assertTrue(self.inside(mv1, point), name)
            self.assertFalse(self.inside(self.volumes['20_20.MusicVolume0'], point), name)
            # Margin: the nearest plane distance equals the oracle's mv1MarginUnits.
            margin = min(w - (a * point[0] + b * point[1] + c * point[2]) for a, b, c, w in mv1['worldPlanes'])
            self.assertAlmostEqual(margin, music[name]['mv1MarginUnits'], places=2)
        lo, hi = music['mv1WorldAABB']
        for axis in range(3):
            self.assertAlmostEqual(mv1['worldBounds']['min'][axis], lo[axis], places=2)
            self.assertAlmostEqual(mv1['worldBounds']['max'][axis], hi[axis], places=2)
        x, y, _ = music['PlayerStart10']['location']
        self.assertTrue(self.inside(mv1, (x, y, -2676.0)))
        self.assertFalse(self.inside(mv1, (x, y, -2600.0)))  # not the Polys32 top (Z -435)
        self.assertFalse(self.inside(mv1, (x, y, -4700.0)))

    def test_octagon_footprint_and_every_listed_ambient_origin_agree(self):
        mv1, music = self.volumes['20_20.MusicVolume1'], self.oracle['music']
        cx, cy = (8898 + 14066) / 2, (93481 + 96601) / 2
        for vx, vy in music['mv1Footprint']:
            self.assertTrue(self.inside(mv1, (vx, vy, -3675.0)))
            dx, dy = vx - cx, vy - cy
            length = (dx * dx + dy * dy) ** .5
            self.assertFalse(self.inside(mv1, (vx + 2 * dx / length, vy + 2 * dy / length, -3675.0)))
        rows = self.oracle['ambientObjects']
        self.assertEqual(len(rows), 99)
        for row in rows:
            self.assertEqual(self.inside(mv1, row['origin']), row['insideMV1'], row['object'])


class BundlePlumbingTests(unittest.TestCase):
    """Temporary project root; map decoding and the AAC encoder are substituted."""

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
