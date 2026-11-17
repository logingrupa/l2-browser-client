from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_catalog.ue2 import FormatError
from world.error_detail import MODEL_CONVERSION_ERRORS, conversion_failure_reason, first_line_of_error


class ConversionFailureReasonTests(unittest.TestCase):
    def test_the_reason_keeps_the_error_type_and_the_first_sentence_before_a_colon_or_semicolon(self):
        self.assertEqual(conversion_failure_reason(FormatError('Unsupported mesh: Lod 2 holds 0 faces\nsecond line')),
                         'decode-failed:FormatError:Unsupported mesh')
        self.assertEqual(conversion_failure_reason(ValueError('archive refused; hash differs')), 'decode-failed:ValueError:archive refused')

    def test_an_empty_message_gives_no_message(self):
        self.assertEqual(conversion_failure_reason(KeyError()), 'decode-failed:KeyError:no message')

    def test_the_model_conversion_errors_are_the_decoder_value_and_timeout_errors(self):
        self.assertEqual(MODEL_CONVERSION_ERRORS, (FormatError, ValueError, subprocess.TimeoutExpired))


class FirstLineOfErrorTests(unittest.TestCase):
    def test_the_first_line_or_the_type_name_of_an_empty_error(self):
        self.assertEqual(first_line_of_error(ValueError('first\nsecond')), 'first')
        self.assertEqual(first_line_of_error(KeyError()), 'KeyError')


if __name__ == '__main__':
    unittest.main()
