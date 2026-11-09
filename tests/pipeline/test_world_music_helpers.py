import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import world_music as subject

MAP = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC/maps/20_20.unr'
SECTION_SURFACE_SPAWN_NATIVE_UNITS = (10560.0, 95040.0, -3455.0)


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
        self.assertFalse(inside(volumes[0], SECTION_SURFACE_SPAWN_NATIVE_UNITS))
        self.assertTrue(inside(volumes[1], SECTION_SURFACE_SPAWN_NATIVE_UNITS))
        for volume in volumes:
            lo, hi = volume['worldBounds']['min'], volume['worldBounds']['max']
            centre = [(a + b) / 2 for a, b in zip(lo, hi)]
            self.assertTrue(inside(volume, centre))
        self.assertEqual(volumes[1]['worldBounds']['min'][2], -4675.0)


ORACLE = ROOT / 'artifacts/native-parity/research/native-sound-answers-20261107/evidence/lead-ps10/ps10_music_ambient.json'


@unittest.skipUnless(MAP.is_file() and ORACLE.is_file(), 'Locked map or the PlayerStart10 research oracle is not present')
class ResearchOracleTests(unittest.TestCase):
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
            margin = min(w - (a * point[0] + b * point[1] + c * point[2]) for a, b, c, w in mv1['worldPlanes'])
            self.assertAlmostEqual(margin, music[name]['mv1MarginUnits'], places=2)
        lo, hi = music['mv1WorldAABB']
        for axis in range(3):
            self.assertAlmostEqual(mv1['worldBounds']['min'][axis], lo[axis], places=2)
            self.assertAlmostEqual(mv1['worldBounds']['max'][axis], hi[axis], places=2)
        x, y, _ = music['PlayerStart10']['location']
        self.assertTrue(self.inside(mv1, (x, y, -2676.0)))
        self.assertFalse(self.inside(mv1, (x, y, -2600.0)))
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


if __name__ == '__main__':
    unittest.main()
