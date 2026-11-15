from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import world.tile_music as tile_music

ENCODER_PIN = {'name': 'ffmpeg', 'version': 'pinned', 'sha256': 'e' * 64}
OTHER_ENCODER_PIN = {'name': 'ffmpeg', 'version': 'other', 'sha256': 'f' * 64}


class MusicEncoderIdentityReuseTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.executable = Path(self.temporary_directory.name) / 'ffmpeg.exe'
        self.executable.write_bytes(b'first encoder build')
        self.asked_pins = []
        self.failures_before_an_answer = []
        tile_music.music_encoder_identities_by_executable_and_pin.clear()
        self.enterContext(patch.object(tile_music.shutil, 'which', return_value=str(self.executable)))
        self.enterContext(patch.object(tile_music, 'encoder_identity', side_effect=self.asked_encoder_identity))
        self.derivative_spec = self.enterContext(patch.object(tile_music, 'music_derivative_spec', return_value={'encoder': ENCODER_PIN}))

    def tearDown(self):
        tile_music.music_encoder_identities_by_executable_and_pin.clear()
        self.temporary_directory.cleanup()

    def asked_encoder_identity(self, executable, encoder_pin):
        self.asked_pins.append(encoder_pin)
        if self.failures_before_an_answer:
            raise self.failures_before_an_answer.pop()
        return {**encoder_pin, 'banner': f'ffmpeg version {encoder_pin["version"]} asked {len(self.asked_pins)}'}

    def test_many_calls_for_one_executable_ask_the_encoder_once_and_give_equal_answers(self):
        encoders = [tile_music.pinned_music_encoder() for _ in range(25)]
        self.assertEqual(len(self.asked_pins), 1)
        self.assertEqual(set(encoder.executable for encoder in encoders), {str(self.executable)})
        self.assertTrue(all(encoder.identity == encoders[0].identity for encoder in encoders))
        self.assertEqual(encoders[0].identity['banner'], 'ffmpeg version pinned asked 1')

    def test_a_replaced_executable_is_asked_again(self):
        first = tile_music.pinned_music_encoder()
        self.executable.unlink()
        self.executable.write_bytes(b'second encoder build, another size')
        second = tile_music.pinned_music_encoder()
        self.assertEqual(len(self.asked_pins), 2)
        self.assertNotEqual(first.identity, second.identity)

    def test_a_changed_pin_is_asked_again(self):
        tile_music.pinned_music_encoder()
        self.derivative_spec.return_value = {'encoder': OTHER_ENCODER_PIN}
        encoder = tile_music.pinned_music_encoder()
        self.assertEqual(self.asked_pins, [ENCODER_PIN, OTHER_ENCODER_PIN])
        self.assertEqual(encoder.identity['version'], 'other')

    def test_a_failed_question_is_not_kept(self):
        for failure in (OSError('the executable is in use by another process'), tile_music.subprocess.TimeoutExpired('ffmpeg', 60),
                        ValueError('Encoder version differs from the recipe pin')):
            self.failures_before_an_answer.append(failure)
            self.assertEqual(tile_music.pinned_music_encoder(), tile_music.PinnedMusicEncoder(None, None))
        encoder = tile_music.pinned_music_encoder()
        self.assertEqual(len(self.asked_pins), 4)
        self.assertEqual((encoder.executable, encoder.identity['version']), (str(self.executable), 'pinned'))

    def test_a_caller_that_changes_the_returned_identity_does_not_change_the_next_answer(self):
        first = tile_music.pinned_music_encoder()
        first.identity['banner'] = 'changed by a caller'
        self.assertEqual(tile_music.pinned_music_encoder().identity['banner'], 'ffmpeg version pinned asked 1')

    def test_no_executable_on_the_path_gives_no_pinned_encoder_and_keeps_nothing(self):
        self.failures_before_an_answer.append(ValueError('No local AAC encoder: install the pinned ffmpeg or pass --ffmpeg'))
        with patch.object(tile_music.shutil, 'which', return_value=None):
            self.assertEqual(tile_music.pinned_music_encoder(), tile_music.PinnedMusicEncoder(None, None))
        self.assertEqual(tile_music.music_encoder_identities_by_executable_and_pin, {})


if __name__ == '__main__':
    unittest.main()
