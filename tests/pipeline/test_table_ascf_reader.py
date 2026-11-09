from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.tables import read_value
from native_catalog.ue2 import FormatError, Reader

COMPACT_INDEX_65537 = bytes([0x41, 0x80, 0x08])
NEGATIVE_COMPACT_INDEX_65537 = bytes([0xc1, 0x80, 0x08])


def wide_ascf(code_units):
    return bytes([0x80 | len(code_units)]) + struct.pack(f'<{len(code_units)}H', *code_units)


def read_ascf_text_and_end(payload):
    reader = Reader(payload)
    return read_value(reader, 'ASCF'), reader.position


class CoreFStringTextTests(unittest.TestCase):
    def test_terminated_ansi_and_wide_strings_keep_their_text(self):
        self.assertEqual(read_ascf_text_and_end(b'\x0bItem Skill\0'), ('Item Skill', 12))
        self.assertEqual(read_ascf_text_and_end(wide_ascf([0x43, 0x2019, 0])), ('C’', 7))
        self.assertEqual(read_ascf_text_and_end(b'\x00'), ('', 1))

    def test_a_one_unit_string_is_emptied_whatever_its_unit(self):
        self.assertEqual(read_ascf_text_and_end(b'\x01 '), ('', 2))
        self.assertEqual(read_ascf_text_and_end(b'\x01\0'), ('', 2))
        self.assertEqual(read_ascf_text_and_end(wide_ascf([0x41])), ('', 3))

    def test_text_ends_at_the_first_nul_and_every_counted_unit_is_consumed(self):
        self.assertEqual(read_ascf_text_and_end(b'\x11Player settings\0,'), ('Player settings', 18))
        self.assertEqual(read_ascf_text_and_end(wide_ascf([0x41, 0, 0x42, 0])), ('A', 9))

    def test_a_counted_string_without_any_nul_unit_fails(self):
        for payload in (b'\x02ab', wide_ascf([0x41, 0x42])):
            with self.subTest(payload=payload), self.assertRaisesRegex(FormatError, 'Unterminated Unreal string'):
                read_ascf_text_and_end(payload)

    def test_a_wide_string_ends_only_at_an_aligned_nul_unit(self):
        self.assertEqual(read_ascf_text_and_end(wide_ascf([0x0041, 0x4100, 0])), ('A䄀', 7))

    def test_ansi_bytes_widen_to_the_code_unit_of_the_same_value(self):
        self.assertEqual(read_ascf_text_and_end(b'\x04\x81\x92\xab\0'), ('\x81\x92\xab', 5))

    def test_an_unpaired_surrogate_in_the_visible_text_fails(self):
        with self.assertRaises(UnicodeDecodeError):
            read_ascf_text_and_end(wide_ascf([0xd800, 0]))

    def test_a_counted_length_past_the_payload_fails_as_truncated(self):
        with self.assertRaisesRegex(FormatError, 'Truncated input at 1, requested 5, end 3'):
            read_ascf_text_and_end(b'\x05ab')
        with self.assertRaisesRegex(FormatError, 'Truncated input at 3, requested 65537, end 4'):
            read_ascf_text_and_end(COMPACT_INDEX_65537 + b'\0')
        with self.assertRaisesRegex(FormatError, 'Truncated input at 3, requested 131074, end 5'):
            read_ascf_text_and_end(NEGATIVE_COMPACT_INDEX_65537 + b'\0\0')


if __name__ == '__main__':
    unittest.main()
