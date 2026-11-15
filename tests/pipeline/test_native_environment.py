import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_environment import (FOOTER_FORMS, HEADER, FormatError, build_products,
                                convert, decode_environment, parse_records)


def envelope(payload, form=(0, 1, 32, 0)):
    body = HEADER + bytes(value ^ 0xac for value in payload)
    return body + struct.pack('<5I', *form[:3], zlib.crc32(body), form[3])


SAMPLE = (b'[EnvType]\r\nEnvType=0\r\n[SkyBoxColor]\r\nNUM=1\r\n'
          b'COLOR1=(T=0,R=1,G=2,B=3)\r\nCOLOR2=(T=12,R=66,G=124,B=176)\r\n')


class EnvironmentEnvelopeTests(unittest.TestCase):
    def test_observed_footer_forms_admit_new_content_with_crc_and_exact_roundtrip(self):
        for form in FOOTER_FORMS:
            with self.subTest(form=form):
                raw = envelope(SAMPLE, form)
                payload, receipt = decode_environment(raw)
                self.assertEqual(payload, SAMPLE)
                self.assertTrue(receipt['roundTripExact'])
                self.assertEqual(receipt['crcCoveredBytes'], len(raw) - 20)
                self.assertEqual(receipt['footerWordsLE'], list(struct.unpack('<5I', raw[-20:])))

    def test_invalid_header_footer_crc_truncation_and_encoding_are_rejected(self):
        original = envelope(SAMPLE)
        damaged = bytearray(original); damaged[40] ^= 1
        variants = [('header', b'X' + original[1:]), ('footer', envelope(SAMPLE, (0, 8, 71, 0))),
                    ('CRC32', bytes(damaged)), ('bounds', original[:48]),
                    ('CRC32', original[:-1]), ('encoding', envelope(b'[X]\r\nKey=\0\r\n')),
                    ('encoding', envelope(b'\xef\xbb\xbf' + SAMPLE))]
        for message, data in variants:
            with self.subTest(message=message, size=len(data)):
                # Removing one byte can fail the footer allowlist before the CRC.
                if data == original[:-1]:
                    with self.assertRaises(FormatError): decode_environment(data)
                else:
                    with self.assertRaisesRegex(FormatError, message): decode_environment(data)
        with patch('native_environment.MAX_SOURCE_BYTES', len(original) - 1):
            with self.assertRaisesRegex(FormatError, 'bounds'): decode_environment(original)

    def test_non_ascii_comments_whitespace_and_all_offsets_roundtrip(self):
        payload = b';\xb1\xe2\xba\xbb\r\n [SkyBoxColor] \r\n NUM = 1 \r\n\tCOLOR1 = (T=12,R=66,G=124,B=176)  \r\n'
        records = parse_records(decode_environment(envelope(payload))[0])
        self.assertEqual(b''.join(bytes.fromhex(row['rawHex']) for row in records), payload)
        color = records[-1]
        self.assertEqual(color['valueAscii'], '(T=12,R=66,G=124,B=176)')
        value = bytes.fromhex(color['valueHex'])
        self.assertEqual(payload[color['valueDecodedOffset']:color['valueDecodedOffset'] + len(value)], value)
        self.assertEqual(color['valueSourceOffset'], color['valueDecodedOffset'] + 28)
        self.assertEqual(color['sourceOffset'], color['decodedOffset'] + 28)
        self.assertEqual(records[0]['kind'], 'comment')


class EnvironmentRecordsTests(unittest.TestCase):
    def tables(self, payload):
        return json.loads(build_products({'test.int': envelope(payload)})['sky-tables.json'])

    def test_count_mismatch_keeps_every_physical_row_and_no_runtime_selection(self):
        result = self.tables(SAMPLE)
        table = result['tables'][0]
        self.assertEqual(table['declaredNum'], 1)
        self.assertEqual(table['physicalColorRows'], 2)
        self.assertFalse(table['declaredNumMatchesPhysicalRows'])
        self.assertEqual(table['rows'][1]['rgb'], [66, 124, 176])
        self.assertIsNone(table['runtimeConsumedRows'])
        self.assertTrue(all(value is None for value in result['selection'].values()))
        self.assertTrue(result['typedComplete'])
        self.assertEqual(result['anomalies'][0]['kind'], 'declared-count-mismatch')

    def test_duplicate_sections_properties_and_color_keys_never_collapse(self):
        payload = SAMPLE + b'[HSVTerrainLight]\nNUM=1\nValue=first\n[HSVTerrainLight]\nNUM=1\nValue=last\n' + SAMPLE
        products = build_products({'test.int': envelope(payload)})
        data, tables = json.loads(products['environment-records.json']), json.loads(products['sky-tables.json'])
        self.assertEqual(len(tables['tables']), 2)
        self.assertNotEqual(tables['tables'][0]['sectionIndex'], tables['tables'][1]['sectionIndex'])
        values = [row['valueAscii'] for row in data['files'][0]['records'] if row.get('key') == 'Value']
        self.assertEqual(values, ['first', 'last'])
        self.assertEqual(len([row for row in tables['duplicateSectionHeaders'] if row['section'] == 'HSVTerrainLight']), 2)
        duplicate = self.tables(SAMPLE.replace(b'COLOR2=', b'COLOR1='))
        self.assertEqual(len(duplicate['tables'][0]['rows']), 2)
        self.assertIn('duplicate-color-key', [row['kind'] for row in duplicate['anomalies']])

    def test_duplicate_num_is_retained_without_selecting_precedence(self):
        result = self.tables(SAMPLE.replace(b'NUM=1', b'NUM=1\nNUM=2'))
        self.assertEqual(len(result['tables'][0]['numDeclarations']), 2)
        self.assertIsNone(result['tables'][0]['declaredNum'])
        self.assertFalse(result['typedComplete'])

    def test_unknown_line_and_bad_color_stay_visible_in_records_and_partial_result(self):
        payload = SAMPLE.replace(b'R=66', b'R=256') + b'not a property\n'
        products = build_products({'test.int': envelope(payload)})
        tables, records = json.loads(products['sky-tables.json']), json.loads(products['environment-records.json'])
        self.assertFalse(tables['typedComplete'])
        self.assertIsNone(tables['tables'][0]['rows'][1]['rgb'])
        self.assertEqual(records['files'][0]['records'][-1]['kind'], 'unparsed')
        self.assertEqual(tables['physicalColorRows'], 2)


class EnvironmentOutputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.inputs = self.root / 'inputs'; self.inputs.mkdir()
        (self.inputs / 'test.int').write_bytes(envelope(SAMPLE))
        self.output = self.root / 'output'

    def snapshot(self, path):
        return {file.relative_to(path).as_posix(): (hashlib.sha256(file.read_bytes()).hexdigest(), file.stat().st_mtime_ns)
                for file in path.rglob('*') if file.is_file()}

    def test_clean_repeat_verify_only_and_source_mtime_preserved(self):
        before = self.snapshot(self.inputs)
        first = convert(self.inputs, self.output, ['test.int'])
        output_before = self.snapshot(self.output)
        again = convert(self.inputs, self.output, ['test.int'])
        verified = convert(self.inputs, self.output, ['test.int'], verify_only=True)
        self.assertEqual(first['written'], 6)
        self.assertEqual(again['written'], 0)
        self.assertEqual(again['existingVerified'], 6)
        self.assertEqual(verified['written'], 0)
        self.assertEqual(self.snapshot(self.output), output_before)
        self.assertEqual(self.snapshot(self.inputs), before)
        second = self.root / 'clean'
        convert(self.inputs, second, ['test.int'])
        self.assertEqual({k: v[0] for k, v in self.snapshot(second).items()}, {k: v[0] for k, v in output_before.items()})

    def test_differing_or_unowned_output_refused_without_partial_mutation(self):
        convert(self.inputs, self.output, ['test.int'])
        (self.output / 'sky-tables.json').write_bytes(b'authored unrelated bytes')
        before = self.snapshot(self.output)
        with self.assertRaisesRegex(FormatError, 'differs'): convert(self.inputs, self.output, ['test.int'])
        self.assertEqual(self.snapshot(self.output), before)

    def test_overlap_traversal_duplicate_missing_and_verify_only_guards(self):
        for output in (self.inputs, self.inputs / 'nested', self.root):
            with self.subTest(output=output):
                with self.assertRaisesRegex(FormatError, 'overlaps'): convert(self.inputs, output, ['test.int'])
        for names in (['../test.int'], ['test.int', 'TEST.INT'], ['missing.int']):
            with self.subTest(names=names):
                with self.assertRaises(FormatError): convert(self.inputs, self.output, names)
        with self.assertRaisesRegex(FormatError, 'incomplete'):
            convert(self.inputs, self.output, ['test.int'], verify_only=True)
        self.assertFalse(self.output.exists())

    def test_corrupt_later_input_causes_no_output(self):
        (self.inputs / 'broken.int').write_bytes(b'not an environment')
        with self.assertRaises(FormatError): convert(self.inputs, self.output, ['test.int', 'broken.int'])
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
