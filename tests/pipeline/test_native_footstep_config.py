import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_assets_lib import footstep_config as foot
from native_catalog.ue2 import FormatError, Reader
from reference_client_guard import ReferenceClientLockError
from reference_client_lock_fixture import lock_client_as_checked_conversion_root, lock_client_as_reference_root

spec = importlib.util.spec_from_file_location('audit_native_footstep_config', ROOT/'scripts/audit-native-footstep-config.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def encoded(text, words=(0, 8, 71, 0)):
    body = 'Lineage2Ver111'.encode('utf-16le') + text.translate(bytes(x ^ 0xac for x in range(256)))
    return body + struct.pack('<5I', words[0], words[1], words[2], zlib.crc32(body), words[3])


class SoundPackage:
    def __init__(self):
        memory = io.BytesIO()
        with wave.open(memory, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(22050)
            wav.writeframes(b'\x00\x00')
        self.payload = memory.getvalue()
        self.data = b'\x00' + struct.pack('<i', 6+len(self.payload)) + bytes([len(self.payload)]) + self.payload
        self.exports = [{'object': 'StepSound.Default.Step_1', 'className': 'Sound', 'exportIndex': 1,
                         'offset': 0, 'size': len(self.data)}]
        self.summary = {'version': 123, 'licenseeVersion': 28}

    def properties(self, export):
        return [], Reader(self.data, export['offset'], export['offset']+export['size'])

    def name(self, index):
        return 'WAV'


class FootstepConfigTests(unittest.TestCase):
    def test_supported_decoder_preserves_bytes_and_rejects_bad_crc(self):
        text = b'[L2FootStepSound]\r\nDefWalkSound1=StepSound.Default.Step_1\r\n'
        source = encoded(text)
        result, framing = foot.decode_config(source)
        self.assertEqual(result, text)
        self.assertTrue(framing['crc32Verified'])
        changed = bytearray(source)
        changed[30] ^= 1
        with self.assertRaisesRegex(FormatError, 'CRC32'):
            foot.decode_config(bytes(changed))

    def test_new_footer_form_not_generalized_to_unpinned_input(self):
        with self.assertRaisesRegex(FormatError, 'footer framing'):
            foot.decode_config(encoded(b'[L2FootStepSound]\r\nDefWalkSound1=StepSound.Step_1\r\n', (0, 10, 90, 0)))
        with self.assertRaisesRegex(FormatError, 'framing'):
            foot.decode_config(b'x'*100)

    def test_dotted_unrelated_sections_keep_exact_rebased_offsets(self):
        prefix = b'[Engine.Audio]\r\r\nOther=x\r\r\n'
        line = b'  dEfWalkSound1=StepSound.Default.Step_1\r\r\n'
        source = prefix+b'[L2FootStepSound]\r\r\n'+line+b'[Other.Class]\r\nIgnored=x\r\n'
        records, section = foot.selected_records(source)
        self.assertEqual(len(records), 1)
        row = records[0]
        self.assertEqual(row['payloadByteOffset'], source.index(line))
        self.assertEqual(row['encodedFileByteOffset'], source.index(line)+28)
        self.assertEqual(row['rawLine'].encode(), line.rstrip(b'\r\n'))
        self.assertEqual(row['key'], 'dEfWalkSound1')
        self.assertEqual(section['startByte'], len(prefix))

    def test_duplicate_sections_keys_and_malformed_assignment_reject(self):
        for text in (b'[L2FootStepSound]\nX=A\n[l2footstepsound]\nX=B\n',
                     b'[L2FootStepSound]\nDefWalkSound1=A\ndefwalksound1=B\n',
                     b'[L2FootStepSound]\nDefWalkSound1 A\n'):
            with self.subTest(text=text), self.assertRaises(FormatError):
                foot.selected_records(text)

    def test_missing_empty_extra_and_literal_whitespace_preserved(self):
        self.assertEqual(foot.selected_records(b'[Other]\nA=x\n'), ([], None))
        self.assertEqual(foot.selected_records(b'[L2FootStepSound]\n;empty\n')[0], [])
        records, _ = foot.selected_records(b'[L2FootStepSound]\nDefWalkSound1=\nExtra= x \n')
        self.assertEqual([row['value'] for row in records], ['', ' x '])
        for literal in (' x ', "Sound'StepSound.Group.X'", '"StepSound.Group.X"', 'X', 'StepSound..X'):
            self.assertIsNone(foot.strict_reference(literal))
        self.assertEqual(foot.strict_reference('StepSound.X'), 'StepSound.X')

    def test_package_name_must_select_one_pinned_package(self):
        pins = [{'relativePath': 'sounds/StepSound.uax'}, {'relativePath': 'other/stepsound.uax'}]
        self.assertEqual(len(foot.package_candidates(pins, 'STEPSOUND.X')), 2)
        self.assertEqual(foot.package_candidates(pins, 'Other.X'), [])

    def test_full_object_join_never_uses_unique_leaf_candidate(self):
        package = SoundPackage()
        status, chosen, candidates = foot.object_match(package, 'StepSound.Step_1')
        self.assertEqual(status, 'missing-exact-object')
        self.assertIsNone(chosen)
        self.assertEqual(candidates[0]['object'], 'StepSound.Default.Step_1')
        self.assertEqual(foot.object_match(package, 'stepsound.default.step_1')[0], 'resolved')

    def test_ambiguous_exact_and_wrong_class_do_not_resolve(self):
        package = SoundPackage()
        package.exports.append(dict(package.exports[0]))
        self.assertEqual(foot.object_match(package, 'StepSound.Default.Step_1')[0], 'ambiguous-object')
        package.exports.pop()
        package.exports[0]['className'] = 'Texture'
        self.assertEqual(foot.object_match(package, 'StepSound.Default.Step_1')[0], 'wrong-object-class')

    def test_native_sound_exact_span_and_lazy_end_enforced(self):
        package = SoundPackage()
        payload, source = foot.sound_payload(package, package.exports[0])
        self.assertEqual(payload, package.payload)
        self.assertNotEqual(source['embeddedPayloadSha256'], source['serializedExportSha256'])
        package.data = package.data[:1]+struct.pack('<i', 999)+package.data[5:]
        with self.assertRaisesRegex(FormatError, 'boundary'):
            foot.sound_payload(package, package.exports[0])
        package.data = package.data[:-1]
        package.exports[0]['size'] -= 1
        with self.assertRaisesRegex(FormatError, 'Truncated'):
            foot.sound_payload(package, package.exports[0])

    def fixture(self, root, text):
        inputs = root/'inputs'
        inputs.mkdir()
        config = inputs/'ALAudio.int'
        config.write_bytes(encoded(text))
        snapshot = root/'client'
        (snapshot/'sounds').mkdir(parents=True)
        lock_client_as_reference_root(self, snapshot)
        package = snapshot/'sounds/stepsound.uax'
        package.write_bytes(b'mocked-native-package')
        lock = inputs/'lock.json'
        lock.write_text(json.dumps({'sourceHost': 'TEST-HOST', 'sourceRoot': 'C:/test-client', 'files': [
            {'relativePath': 'sounds/stepsound.uax', 'bytes': package.stat().st_size,
             'sha256': hashlib.sha256(package.read_bytes()).hexdigest()}]}))
        return argparse.Namespace(config=config, config_sha256=hashlib.sha256(config.read_bytes()).hexdigest(),
            config_source_host='TEST-HOST', config_source_path='C:/test-client/system/ALAudio.int',
            client_snapshot=snapshot, input_lock=lock, output=root/'run1')

    def test_repeat_preserves_key_rows_deduplicates_only_payloads_and_keeps_runtime_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = self.fixture(root, b'[L2FootStepSound]\nDefWalkSound1=StepSound.Default.Step_1\nDefWalkSound2=stepsound.default.step_1\nDefWalkSound3=\nExtra=StepSound.X\n')
            package = SoundPackage()
            with patch.object(audit, 'Package', return_value=package):
                first = audit.run(args)
                args.output = root/'run2'
                second = audit.run(args)
            self.assertEqual(first['coverageSha256'], second['coverageSha256'])
            result = json.loads((root/'run1/coverage.json').read_text())
            self.assertEqual(len(result['rows']), 24)
            self.assertEqual(result['coverage']['presentKeys'], 3)
            self.assertEqual(result['coverage']['resolvedKeyRows'], 2)
            self.assertEqual(result['coverage']['uniquePayloadHashes'], 1)
            self.assertEqual(len(list((root/'run1/native').glob('*'))), 1)
            self.assertEqual(len(list((root/'run1/audio').glob('*'))), 1)
            self.assertEqual(result['rows'][2]['status'], 'empty-value')
            for row in result['rows']:
                for key, value in foot.RUNTIME_FLAGS.items():
                    self.assertEqual(row[key], value)
            for path in (root/'run1').rglob('*'):
                if path.is_file():
                    self.assertEqual(path.read_bytes(), (root/'run2'/path.relative_to(root/'run1')).read_bytes())

    def test_source_hash_mismatch_fails_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = self.fixture(root, b'[L2FootStepSound]\nDefWalkSound1=StepSound.Default.Step_1\n')
            (args.client_snapshot/'sounds/stepsound.uax').write_bytes(b'changed')
            with self.assertRaisesRegex(FormatError, 'hash/length mismatch'):
                audit.run(args)
            self.assertFalse(args.output.exists())
            args.config_sha256 = '0'*64
            with self.assertRaisesRegex(FormatError, 'Config source SHA256 mismatch'):
                audit.run(args)

    def test_source_overlap_and_existing_destination_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'inputs'
            source.mkdir()
            for destination in (source/'new', root, source):
                with self.subTest(destination=destination), self.assertRaises(FormatError):
                    audit.safe_destination(destination, (source,))

    def test_locked_package_absent_from_a_lock_checked_root_is_reported_not_staged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = self.fixture(root, b'[L2FootStepSound]\nDefWalkSound1=StepSound.Default.Step_1\n')
            lock_client_as_checked_conversion_root(self, args.client_snapshot, root/'reference', ['sounds/stepsound.uax'])
            (args.client_snapshot/'sounds/stepsound.uax').unlink()
            audit.run(args)
            result = json.loads((args.output/'coverage.json').read_text())
            self.assertEqual(result['rows'][0]['status'], 'locked-package-not-staged')
            self.assertEqual(result['packages'], [])

    def test_present_package_on_a_lock_checked_root_still_needs_lock_equal_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = self.fixture(root, b'[L2FootStepSound]\nDefWalkSound1=StepSound.Default.Step_1\n')
            lock_client_as_checked_conversion_root(self, args.client_snapshot, root/'reference', ['sounds/stepsound.uax'])
            (args.client_snapshot/'sounds/stepsound.uax').write_bytes(b'mocked-native-packagE')
            with self.assertRaisesRegex(ReferenceClientLockError, 'stale for sounds/stepsound.uax'):
                audit.run(args)
            self.assertFalse(args.output.exists())

    def test_unresolved_group_less_values_never_extract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = self.fixture(root, b'[L2FootStepSound]\nDefWalkSound1=StepSound.Step_1\n')
            with patch.object(audit, 'Package', return_value=SoundPackage()):
                audit.run(args)
            result = json.loads((args.output/'coverage.json').read_text())
            self.assertEqual(result['rows'][0]['status'], 'missing-exact-object')
            self.assertEqual(len(result['rows'][0]['unresolvedCandidates']), 1)
            self.assertEqual(result['coverage']['resolvedKeyRows'], 0)
            self.assertFalse((args.output/'native').exists())


if __name__ == '__main__':
    unittest.main()
