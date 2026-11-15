import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_catalog.cli import digest, json_bytes, parse_umodel_listing, safe_output, within
from native_catalog.tables import decode_table, NON_FINITE_FLOAT32_KEY, SCHEMA_ROOT, CRYPTO_SOURCE
from native_catalog.ue2 import FormatError, Package, Reader, summary
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

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
    @unittest.skipUnless(REFERENCE_CLIENT_LOCK_PATH.is_file(), 'Reference client lock absent; the guard refuses E: table reads until it is recorded')
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


@unittest.skipUnless(CLIENT.is_dir() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file() and REFERENCE_CLIENT_LOCK_PATH.is_file(),
                     'Reference client, its lock or the pinned formats are absent')
class ClientReadingTableTests(unittest.TestCase):
    def decode_exactly(self, layout, file_name):
        table = decode_table(CLIENT, layout, source_filename=file_name)
        self.assertEqual(table['decodedBytes'] - table['consumedBytes'], 13)
        self.assertEqual(bytes.fromhex(table['trailerHex']), b'\x0cSafePackage\0')
        return table

    def test_sysstring_reads_every_counted_unit_and_keeps_the_text_before_the_first_nul(self):
        table = self.decode_exactly('sysstring', 'sysstring-e.dat')
        strings = table['data']['string']
        self.assertEqual((table['data']['data'], len(strings), len({row['stringID'] for row in strings})), (2083, 2083, 2083))
        text_by_identifier = {row['stringID']: row['string'] for row in strings}
        self.assertEqual((text_by_identifier[1551], text_by_identifier[1574]), ('', 'Player settings'))

    def test_eula_reads_the_three_fl2eula_strings_of_the_client_derived_layout(self):
        table = self.decode_exactly('eula', 'eula-e.dat')
        [eula] = table['data']['eula']
        self.assertEqual((table['decodedBytes'], table['consumedBytes']), (59968, 59955))
        self.assertEqual((len(eula['eula']), eula['eulatestserver'], eula['eulachinaspecialmessage']), (29971, '\r\n', '\r\n'))
        self.assertTrue(eula['eula'].startswith('\r\nLineage II User Agreement'))
        self.assertEqual(table['schema']['file'], 'recipes/data/table-layouts/eula.xml')

    def test_servername_reads_all_200_slots_with_the_127_in_use_slots_first(self):
        table = self.decode_exactly('servername', 'servername-e.dat')
        slots = table['data']['server_name']
        self.assertEqual((table['data']['data'], len(slots), table['consumedBytes']), (127, 200, 3408))
        self.assertEqual([slot['id'] for slot in slots], list(range(200)))
        self.assertEqual([slot['tag_?'] for slot in slots], [1] * 127 + [0] * 73)
        self.assertEqual((slots[0]['name'], slots[126]['name']), ('Bartz', '방송용'))
        self.assertTrue(all((slot['name'], slot['desc']) == ('', '') for slot in slots[127:]))

    def test_questname_keeps_the_three_nan_words_as_their_source_bytes(self):
        table = self.decode_exactly('questname', 'questname-e.dat')
        quests = table['data']['quest']
        self.assertEqual((table['data']['data'], len(quests), table['consumedBytes']), (2050, 2050, 1028383))
        tagged_words = [(index, location, axis, value) for index, quest in enumerate(quests)
                        for location in ('target_loc', 'start_npc_loc') for axis, value in quest[location].items() if isinstance(value, dict)]
        self.assertEqual(tagged_words, [(730, 'start_npc_loc', 'start_npc_loc_z', {NON_FINITE_FLOAT32_KEY: 'FFFFFFFF'}),
                                        (735, 'start_npc_loc', 'start_npc_loc_y', {NON_FINITE_FLOAT32_KEY: 'FFFFFFFF'}),
                                        (736, 'start_npc_loc', 'start_npc_loc_y', {NON_FINITE_FLOAT32_KEY: 'FFFFFFFF'})])
        self.assertEqual({quests[index]['id'] for index, *_ in tagged_words}, {422})


if __name__ == '__main__':
    unittest.main()
