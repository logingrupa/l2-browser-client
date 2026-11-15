import importlib.util
import hashlib
import io
from pathlib import Path
import struct
import tempfile
import unittest
import wave
import zlib

spec = importlib.util.spec_from_file_location("native_audio", Path(__file__).parents[2] / "scripts/native_audio.py")
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


def page(sequence, flags, granule, payload):
    value = bytearray(b"OggS" + bytes([0, flags]) + struct.pack("<QIII", granule, 17, sequence, 0) + bytes([1, len(payload)]) + payload)
    struct.pack_into("<I", value, 22, audio.ogg_crc(value))
    return bytes(value)


class NativeAudioTests(unittest.TestCase):
    def setUp(self):
        identification = b"\x01vorbis" + struct.pack("<IBIiiiBB", 0, 2, 44100, -1, 128000, -1, 0xB8, 1)
        self.standard = page(0, 2, 0, identification) + page(1, 4, 44100, b"encoded-audio-fixture")

    def test_signature_recovery_preserves_every_encoded_byte_and_checks_crc(self):
        wrapped = b"L2SD" + self.standard[4:]
        decoded, metadata = audio.decode_ogg(wrapped)
        self.assertEqual(decoded, self.standard)
        self.assertEqual(metadata["durationSeconds"], 1)
        self.assertEqual(metadata["changedByteRange"], [0, 4])
        self.assertTrue(metadata["allPageCrcsValid"])

    def test_standard_ogg_is_unchanged(self):
        decoded, metadata = audio.decode_ogg(self.standard)
        self.assertEqual(decoded, self.standard)
        self.assertIsNone(metadata["changedByteRange"])

    def test_native_footer_is_verified_and_retained_as_metadata(self):
        wrapped = b"L2SD" + self.standard[4:]
        footer = struct.pack("<IIIII", 0, 2, 54, zlib.crc32(wrapped), 0)
        decoded, metadata = audio.decode_ogg(wrapped + footer)
        self.assertEqual(decoded, self.standard)
        self.assertEqual(metadata["nativeFooterHex"], footer.hex())
        self.assertTrue(metadata["nativeFooterCrcValid"])
        with self.assertRaisesRegex(ValueError, "footer/checksum"):
            audio.decode_ogg(wrapped + footer[:-1] + b"x")
        standard_footer = struct.pack("<IIIII", 0, 1, 54, zlib.crc32(self.standard), 0)
        self.assertEqual(audio.decode_ogg(self.standard + standard_footer)[0], self.standard)

    def test_bad_crc_truncation_and_missing_end_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "CRC"):
            audio.decode_ogg(self.standard[:-1] + b"x")
        with self.assertRaisesRegex(ValueError, "Truncated"):
            audio.decode_ogg(self.standard[:-2])
        with self.assertRaisesRegex(ValueError, "end/duration"):
            audio.decode_ogg(self.standard[:58])

    def test_unknown_signature_is_not_renamed_as_playable_audio(self):
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            audio.decode_ogg(b"not-an-ogg")


def riff_chunk(fourcc, payload, padding=b"\0"):
    return fourcc + struct.pack('<I', len(payload)) + payload + (padding if len(payload) & 1 else b'')


def pcm_wav(trailing=b'', leading=b''):
    fmt = struct.pack('<HHIIHH', 1, 1, 8000, 16000, 2, 16)
    body = b'WAVE' + leading + riff_chunk(b'fmt ', fmt) + riff_chunk(b'data', b'\0\0' * 8) + trailing
    return b'RIFF' + struct.pack('<I', len(body)) + body


class WavRiffTests(unittest.TestCase):
    def decode(self, original):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.wav'
            path.write_bytes(original)
            result = audio.decode_native_audio(path)
            self.assertEqual(path.read_bytes(), original)
            return result

    def test_preserves_info_and_unknown_chunks_on_both_sides_of_pcm(self):
        info = b'INFO' + riff_chunk(b'ISFT', b'editor\0')
        original = pcm_wav(riff_chunk(b'LIST', info) + riff_chunk(b'PAD ', b'abc', b'\x81'),
                           riff_chunk(b'Xtra', b'first'))
        decoded, mime, metadata = self.decode(original)
        self.assertEqual(decoded, original)
        self.assertEqual(mime, 'audio/wav')
        self.assertEqual(metadata['sourceSha256'], metadata['outputSha256'])
        self.assertEqual(metadata['durationSeconds'], 0.001)
        chunks = metadata['riff']['chunks']
        self.assertEqual([chunk['fourCC'] for chunk in chunks], ['Xtra', 'fmt ', 'data', 'LIST', 'PAD '])
        self.assertEqual(chunks[3]['listType'], 'INFO')
        self.assertEqual(chunks[4]['paddingHex'], '81')
        end = 12
        for chunk in chunks:
            self.assertEqual(chunk['headerOffset'], end)
            start = chunk['dataOffset']
            end = start + chunk['bytes']
            self.assertEqual(hashlib.sha256(original[start:end]).hexdigest(), chunk['payloadSha256'])
            end += chunk['bytes'] & 1
        self.assertEqual(end, len(original))

    def test_reports_repeated_sampler_ids_without_inventing_loop_semantics(self):
        original = pcm_wav(riff_chunk(b'smpl', b'opaque-one') + riff_chunk(b'smpl', b'opaque-two'))
        decoded, _, metadata = self.decode(original)
        self.assertEqual(decoded, original)
        chunks = metadata['riff']['chunks']
        self.assertEqual([chunk['fourCC'] for chunk in chunks], ['fmt ', 'data', 'smpl', 'smpl'])
        self.assertNotEqual(chunks[2]['payloadSha256'], chunks[3]['payloadSha256'])
        self.assertNotIn('loop', metadata)
        self.assertIn('semantics uninterpreted', metadata['riff']['scope'])

    def test_rejects_trailing_corruption_ignored_by_pcm_reader(self):
        cases = [
            (b'broken', 'header'),
            (b'JUNK' + struct.pack('<I', 20) + b'x', 'payload'),
            (b'JUNK' + struct.pack('<I', 1) + b'x', 'padding'),
            (riff_chunk(b'LIST', b'INF'), 'LIST type'),
        ]
        for trailing, error in cases:
            with self.subTest(error=error):
                original = pcm_wav(trailing)
                # Establish the old blind spot: valid PCM can precede bad metadata.
                with wave.open(io.BytesIO(original), 'rb') as source:
                    self.assertEqual(source.readframes(8), b'\0\0' * 8)
                with self.assertRaisesRegex(ValueError, error):
                    self.decode(original)

    def test_rejects_header_and_riff_length_damage(self):
        for value in (b'', b'RIFF', b'RIFF\0\0\0\0WAVE', pcm_wav()[:-1]):
            with self.subTest(value=value[:12]), self.assertRaises(ValueError):
                audio.inspect_wav_riff(value)


if __name__ == "__main__":
    unittest.main()
