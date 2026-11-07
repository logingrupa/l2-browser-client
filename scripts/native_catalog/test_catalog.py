import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_catalog.cli import digest, file_hash, inventory, json_bytes, parse_umodel_listing, safe_output, verify, within
from native_catalog.tables import decode_table, SCHEMA_ROOT, CRYPTO_SOURCE
from native_catalog.ue2 import FormatError, Package, Reader, summary

CLIENT = Path('E:/lineage2-client')


class BoundedFormatTests(unittest.TestCase):
    def test_truncated_compact_index_is_rejected(self):
        with self.assertRaises(FormatError):
            Reader(b'\x40').compact()
        with self.assertRaises(FormatError):
            Reader(b'\x40\x80\x80\x80\xe0').compact()

    def test_121_depends_on_original_filename(self):
        raw = struct.pack('<IHHIIIIIII', 0x9e2a83c1, 123, 28, 1, 0, 36, 0, 36, 0, 36)
        key = sum(b'ffighter.utx') & 255
        wrapped = 'Lineage2Ver121'.encode('utf-16le') + bytes(value ^ key for value in raw)
        self.assertEqual(summary(wrapped, 'FFighter.utx')['licenseeVersion'], 28)
        with self.assertRaises(FormatError):
            summary(wrapped, 'renamed.utx')

    def test_umodel_listing_keeps_hex_offsets_and_original_names(self):
        rows = parse_umodel_listing('Loading package: ignore\n  0 8409 31639F MeshAnimation MFighter_anim\n 3 31E7AA 69 AnimNotify_Sound AnimNotify_Sound655\n')
        self.assertEqual(rows[0]['offset'], 33801)
        self.assertEqual(rows[1]['size'], 105)
        self.assertEqual(rows[1]['exportIndex'], 4)

    def test_source_output_and_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with self.assertRaises(FormatError):
                safe_output(root, root / 'must-not-be-created' / 'catalog.json')
            self.assertFalse((root / 'must-not-be-created').exists())
            with self.assertRaises(FormatError):
                within(root, '../outside.json')

    def test_inventory_repeats_and_verification_detects_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            root = base / 'client'
            root.mkdir()
            (root / 'sample.ogg').write_bytes(b'OggS unchanged media fixture')
            first, second = inventory(root), inventory(root)
            self.assertEqual(first['inventorySha256'], second['inventorySha256'])
            catalog = {'sourceRoot': str(root), **first}
            output = base / 'catalog.json'
            output.write_bytes(json_bytes(catalog))
            output.with_suffix('.receipt.json').write_bytes(json_bytes({'catalogSha256': file_hash(output), 'artifacts': []}))
            self.assertEqual(verify(root, output)['fileCount'], 1)
            (root / 'sample.ogg').write_bytes(b'OggS mutated media fixture!!')
            with self.assertRaisesRegex(FormatError, 'source hash mismatch'):
                verify(root, output)


@unittest.skipUnless((CLIENT / 'animations/Fighter.ukx').is_file(), 'Original native client is not staged on this machine')
class NativeSourceEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (CLIENT / 'animations/Fighter.ukx').read_bytes()
        cls.package = Package(cls.raw, 'Fighter.ukx')
        cls.sidecar = cls.package.notification_sidecar()

    def test_exact_original_package_and_complete_event_coverage(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), '8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c')
        self.assertEqual(len(self.package.exports), 797)
        self.assertEqual(len(self.sidecar['notifies']), 651)
        self.assertEqual(len(self.sidecar['animationEvents']), 655)
        self.assertEqual(self.sidecar['unsupported'], [])

    def test_run_events_keep_native_clip_rate_sound_and_timing(self):
        events = [event for event in self.sidecar['animationEvents'] if event['clip'] == 'Run_Hand_MFighter']
        self.assertEqual(len(events), 3)
        self.assertEqual(events[0]['sourceFrames'], 13)
        self.assertEqual(events[0]['sourceRate'], 15)
        self.assertEqual(events[0]['sound'], 'ChrSound.MHFighter_Basic_Action.MHFighter_Breath_1')
        self.assertAlmostEqual(events[0]['timeSeconds'], 2 / 15, places=6)
        self.assertAlmostEqual(events[2]['timeSeconds'], 8 / 15, places=6)
        self.assertEqual(events[0]['properties']['Volume'], 250)
        self.assertEqual(events[0]['properties']['Random'], 5)
        self.assertEqual(events[1]['properties']['DefaultRunSound'][0], 'StepSound.Default.default_run_01')

    def test_class_defaults_and_sound_bindings_are_not_invented(self):
        event = next(event for event in self.sidecar['animationEvents'] if event['type'] == 'AnimNotify_AttackItem')
        self.assertEqual(event['properties'], {})
        self.assertIsNone(event['sound'])

    def test_sidecar_is_deterministic(self):
        repeated = self.package.notification_sidecar()
        self.assertEqual(digest(json_bytes(repeated)), digest(json_bytes(self.sidecar)))

    def test_corrupt_export_extent_fails_before_metadata_output(self):
        with self.assertRaises(FormatError):
            Package(self.raw[:-10000], 'Fighter.ukx')

    @unittest.skipUnless(SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'Pinned local schema/format resources absent')
    def test_interlude_descriptor_tables_consume_exact_source_bytes(self):
        expected = {'skillgrp': 29812, 'skillsoundgrp': 1398, 'mobskillanimgrp': 5463, 'chargrp': 15}
        for name, count in expected.items():
            with self.subTest(table=name):
                table = decode_table(CLIENT, name)
                rows = next(value for value in table['data'].values() if isinstance(value, list))
                self.assertEqual(table['schema']['descriptor'], '06_interlude.xml')
                self.assertEqual(len(rows), count)
                self.assertEqual(table['decodedBytes'] - table['consumedBytes'], 13)
                self.assertEqual(bytes.fromhex(table['trailerHex']), b'\x0cSafePackage\0')
                if name == 'chargrp':
                    self.assertEqual(rows[0]['body_mesh']['body_mesh1'], 'Fighter.MFighter_m001_u')
                    self.assertEqual(rows[0]['body_texture']['body_texture2'], 'MFighter.MFighter_m001_t02_l')
                    self.assertEqual(rows[0]['face_mesh'][0]['param_face_mesh'], 'Fighter.MFighter_m000_f')
                    self.assertEqual(rows[0]['_counts']['face_texture'], 3)
                    self.assertEqual(len(rows[0]['face_texture']), 3)


if __name__ == '__main__':
    unittest.main()
