import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world import copy_world07_fixtures as world07_fixture_copy
from world.copy_world07_fixtures import (World07FixtureCopyError, World07PacketManifestError, copy_world07_fixtures,
    drop_absolute_path_fields, find_absolute_path_text, find_long_binary_runs, verify_world07_packet_manifest)

COMMITTED_FIXTURE_DIRECTORY = ROOT / 'tests' / 'fixtures' / 'world-07'
BACKSLASH = chr(92)
BROWSER_TEST_CASES_SOURCE = 'composition-submission/BROWSER_TEST_CASES.md'
DISCRIMINATING_CASES_SOURCE = 'composition-submission/DISCRIMINATING_CASES.json'
MUSIC_ID_JOIN_SOURCE = 'music-id-evidence/MUSIC_ID_JOIN.json'
SYNTHETIC_BROWSER_TEST_CASES = b'# Cases\n'
SYNTHETIC_DISCRIMINATING_CASES = {'adjacent': [{'id': 'shared-edge', 'triangles': [{'layers': [0]}, {'layers': [0, 6]}]}]}
SYNTHETIC_MUSIC_ID_JOIN = {'joins': [{'storedString': 'D03_F', 'filenameMatches': [{'path': 'C:/client/music/d03_f.ogg', 'bytes': 7}]}]}


def write_packet_file(packet_root, relative_path, payload):
    path = packet_root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def manifest_row(relative_path, payload):
    return {'path': relative_path, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}


def write_packet_manifest(packet_root, rows):
    write_packet_file(packet_root, 'SHA256_MANIFEST.json', json.dumps({'files': rows}).encode('utf-8'))


def write_synthetic_packet(packet_root):
    payloads = {
        DISCRIMINATING_CASES_SOURCE: json.dumps(SYNTHETIC_DISCRIMINATING_CASES).encode('utf-8'),
        BROWSER_TEST_CASES_SOURCE: SYNTHETIC_BROWSER_TEST_CASES,
        MUSIC_ID_JOIN_SOURCE: json.dumps(SYNTHETIC_MUSIC_ID_JOIN).encode('utf-8'),
    }
    for relative_path, payload in payloads.items():
        write_packet_file(packet_root, relative_path, payload)
    write_packet_manifest(packet_root, [manifest_row(path, payload) for path, payload in payloads.items()])
    return payloads


class World07PacketManifestTest(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.packet_root = Path(temporary_directory.name) / 'packet'
        self.payloads = write_synthetic_packet(self.packet_root)

    def test_synthetic_packet_with_three_files_verifies(self):
        verification = verify_world07_packet_manifest(self.packet_root)
        manifest_sha256 = hashlib.sha256((self.packet_root / 'SHA256_MANIFEST.json').read_bytes()).hexdigest()
        self.assertEqual(verification, {'manifestSha256': manifest_sha256, 'rowCount': 3, 'matchedRows': 3, 'packetFileCount': 4})

    def test_delivery_verification_file_is_allowed_outside_the_manifest(self):
        write_packet_file(self.packet_root, 'DELIVERY_VERIFICATION.json', b'{}')
        self.assertEqual(verify_world07_packet_manifest(self.packet_root)['packetFileCount'], 5)

    def test_every_broken_packet_is_refused(self):
        def zero_rows():
            write_packet_manifest(self.packet_root, [])

        def missing_file():
            (self.packet_root / BROWSER_TEST_CASES_SOURCE).unlink()

        def wrong_byte_count():
            rows = [manifest_row(path, payload) for path, payload in self.payloads.items()]
            rows[1]['bytes'] += 1
            write_packet_manifest(self.packet_root, rows)

        def wrong_sha256():
            write_packet_file(self.packet_root, BROWSER_TEST_CASES_SOURCE, b'# Casex\n')

        def unlisted_extra_file():
            write_packet_file(self.packet_root, 'extra.json', b'{}')

        def parent_directory_path():
            write_packet_manifest(self.packet_root, [manifest_row('../' + BROWSER_TEST_CASES_SOURCE, SYNTHETIC_BROWSER_TEST_CASES)])

        def backslash_path():
            backslash_source = BROWSER_TEST_CASES_SOURCE.replace('/', BACKSLASH)
            write_packet_manifest(self.packet_root, [manifest_row(backslash_source, SYNTHETIC_BROWSER_TEST_CASES)])

        def absolute_path():
            write_packet_manifest(self.packet_root, [manifest_row('C:/' + BROWSER_TEST_CASES_SOURCE, SYNTHETIC_BROWSER_TEST_CASES)])

        def duplicated_row():
            rows = [manifest_row(path, payload) for path, payload in self.payloads.items()]
            write_packet_manifest(self.packet_root, rows + rows[:1])

        breakages = [(zero_rows, 'no rows'), (missing_file, f'file missing: {BROWSER_TEST_CASES_SOURCE}'),
                     (wrong_byte_count, 'byte count mismatch'), (wrong_sha256, f'sha256 mismatch: {BROWSER_TEST_CASES_SOURCE}'),
                     (unlisted_extra_file, 'not listed in the manifest: extra.json'),
                     (parent_directory_path, 'escapes the packet'), (backslash_path, 'forward slashes'),
                     (absolute_path, 'forward slashes'), (duplicated_row, 'listed twice')]
        for breakage, expected_message in breakages:
            with self.subTest(breakage=breakage.__name__):
                self.payloads = write_synthetic_packet(self.packet_root)
                (self.packet_root / 'extra.json').unlink(missing_ok=True)
                breakage()
                with self.assertRaisesRegex(World07PacketManifestError, re.escape(expected_message)):
                    verify_world07_packet_manifest(self.packet_root)


class DropAbsolutePathFieldsTest(unittest.TestCase):
    def test_nested_path_fields_are_dropped_with_their_pointers_and_list_order_is_kept(self):
        source = {
            'kind': 'join',
            'note': {'path': 'C:' + BACKSLASH + 'Users' + BACKSLASH + 'reader' + BACKSLASH + 'note.md', 'bytes': 10},
            'scratch': 'D:/work/.codex-proxy/scratch/table.tsv',
            'joins': [{'storedString': 'D03_F', 'matches': [{'path': 'C:/client/music/d03_f.ogg', 'bytes': 7}]},
                      {'storedString': 'A01', 'order': [3, 1, 2, 1]}],
            'relative': 'music/d03_f.ogg',
        }
        fixture_value, dropped_pointers = drop_absolute_path_fields(source)
        self.assertEqual(dropped_pointers, ['/note/path', '/scratch', '/joins/0/matches/0/path'])
        self.assertEqual(fixture_value['note'], {'pathBasename': 'note.md', 'bytes': 10})
        self.assertEqual(fixture_value['scratchBasename'], 'table.tsv')
        self.assertEqual(fixture_value['joins'][0]['matches'], [{'pathBasename': 'd03_f.ogg', 'bytes': 7}])
        self.assertEqual(fixture_value['joins'][1]['order'], [3, 1, 2, 1])
        self.assertEqual(fixture_value['relative'], 'music/d03_f.ogg')
        self.assertEqual(source['note']['path'][:3], 'C:' + BACKSLASH)
        self.assertEqual(find_absolute_path_text(json.dumps(fixture_value)), [])

    def test_existing_basename_field_beside_a_dropped_path_is_refused(self):
        with self.assertRaisesRegex(World07FixtureCopyError, re.escape('/path')):
            drop_absolute_path_fields({'path': 'C:/client/a.ogg', 'pathBasename': 'b.ogg'})

    def test_pointer_tokens_escape_slash_and_tilde(self):
        _, dropped_pointers = drop_absolute_path_fields({'a/b~c': 'C:/x'})
        self.assertEqual(dropped_pointers, ['/a~1b~0c'])


class FindLongBinaryRunsTest(unittest.TestCase):
    def test_runs_longer_than_128_characters_are_found(self):
        self.assertEqual(find_long_binary_runs('x ' + 'a' * 129 + ' y'), ['a' * 129])
        self.assertEqual(find_long_binary_runs('x ' + '0f' * 64 + ' y'), [])
        self.assertEqual(len(find_long_binary_runs('QUJD' * 40 + '==')), 1)


class World07FixtureCopyTest(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.packet_root = base / 'packet'
        write_synthetic_packet(self.packet_root)
        self.destination = base / 'fixtures' / 'world-07'
        self.destination.parent.mkdir()
        destination_patch = patch.object(world07_fixture_copy, 'WORLD07_FIXTURE_DESTINATION', self.destination)
        destination_patch.start()
        self.addCleanup(destination_patch.stop)

    def read_destination(self):
        return {path.name: path.read_bytes() for path in sorted(self.destination.iterdir())}

    def replace_packet_source(self, source_path, payload):
        write_packet_file(self.packet_root, source_path, payload)
        rows = json.loads((self.packet_root / 'SHA256_MANIFEST.json').read_bytes())['files']
        write_packet_manifest(self.packet_root, [manifest_row(source_path, payload) if row['path'] == source_path else row for row in rows])

    def test_copy_writes_the_fixtures_and_index_and_a_rerun_is_byte_identical(self):
        verification = copy_world07_fixtures(self.packet_root, self.destination)
        first_copy = self.read_destination()
        copy_world07_fixtures(self.packet_root, self.destination)
        self.assertEqual(self.read_destination(), first_copy)
        self.assertEqual(sorted(first_copy), ['browser-test-cases.md', 'discriminating-cases.json', 'fixtures.json', 'music-id-join.json'])
        self.assertEqual(first_copy['browser-test-cases.md'], SYNTHETIC_BROWSER_TEST_CASES)
        self.assertEqual(json.loads(first_copy['discriminating-cases.json']), SYNTHETIC_DISCRIMINATING_CASES)
        self.assertEqual(json.loads(first_copy['music-id-join.json']),
                         {'joins': [{'storedString': 'D03_F', 'filenameMatches': [{'pathBasename': 'd03_f.ogg', 'bytes': 7}]}]})
        fixture_index = json.loads(first_copy['fixtures.json'])
        self.assertEqual(fixture_index['packetManifestSha256'], verification['manifestSha256'])
        self.assertEqual([(row['sourcePath'], row['droppedPointers']) for row in fixture_index['fixtures']],
                         [(BROWSER_TEST_CASES_SOURCE, []), (DISCRIMINATING_CASES_SOURCE, []),
                          (MUSIC_ID_JOIN_SOURCE, ['/joins/0/filenameMatches/0/path'])])
        self.assertEqual([entry.name for entry in self.destination.parent.iterdir()], ['world-07'])

    def test_failure_mid_copy_leaves_the_previous_destination_unchanged(self):
        copy_world07_fixtures(self.packet_root, self.destination)
        previous_copy = self.read_destination()
        written_names = []

        def write_then_fail(path, text):
            written_names.append(path.name)
            if path.name == 'fixtures.json':
                raise OSError('disk full')
            path.write_bytes(text.encode('utf-8'))

        with patch.object(world07_fixture_copy, 'write_fixture_text', write_then_fail):
            with self.assertRaisesRegex(OSError, 'disk full'):
                copy_world07_fixtures(self.packet_root, self.destination)
        self.assertEqual(written_names, ['browser-test-cases.md', 'discriminating-cases.json', 'music-id-join.json', 'fixtures.json'])
        self.assertEqual(self.read_destination(), previous_copy)
        self.assertEqual([entry.name for entry in self.destination.parent.iterdir()], ['world-07'])

    def test_manifest_mismatch_copies_nothing(self):
        write_packet_file(self.packet_root, BROWSER_TEST_CASES_SOURCE, b'changed\n')
        with self.assertRaises(World07PacketManifestError):
            copy_world07_fixtures(self.packet_root, self.destination)
        self.assertFalse(self.destination.parent.joinpath('world-07').exists())

    def test_long_binary_run_in_a_source_is_refused(self):
        self.replace_packet_source(DISCRIMINATING_CASES_SOURCE, json.dumps({'blob': 'ab' * 65}).encode('utf-8'))
        with self.assertRaisesRegex(World07FixtureCopyError, 'longer than 128'):
            copy_world07_fixtures(self.packet_root, self.destination)
        self.assertEqual([entry.name for entry in self.destination.parent.iterdir()], [])

    def test_absolute_path_in_a_markdown_source_is_refused(self):
        self.replace_packet_source(BROWSER_TEST_CASES_SOURCE, ('see C:' + BACKSLASH + 'Users' + BACKSLASH + 'reader\n').encode('utf-8'))
        with self.assertRaisesRegex(World07FixtureCopyError, 'absolute or private path'):
            copy_world07_fixtures(self.packet_root, self.destination)
        self.assertEqual([entry.name for entry in self.destination.parent.iterdir()], [])

    def test_destination_other_than_the_fixture_directory_is_refused(self):
        with self.assertRaisesRegex(World07FixtureCopyError, 'fixture destination must be'):
            copy_world07_fixtures(self.packet_root, self.destination.parent / 'elsewhere')


class CommittedWorld07FixturesTest(unittest.TestCase):
    def test_fixture_index_validates(self):
        fixture_index = json.loads((COMMITTED_FIXTURE_DIRECTORY / 'fixtures.json').read_text(encoding='utf-8'))
        self.assertEqual(fixture_index['schemaVersion'], 1)
        self.assertRegex(fixture_index['packetManifestSha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(fixture_index['packetRelativeRoot'], 'post-migration-visibility-20261106')
        rows = fixture_index['fixtures']
        self.assertEqual([row['sourcePath'] for row in rows], sorted(row['sourcePath'] for row in rows))
        for row in rows:
            self.assertEqual(sorted(row), ['droppedPointers', 'fixture', 'sourceBytes', 'sourcePath', 'sourceSha256', 'transform'])
            self.assertRegex(row['sourceSha256'], r'^[0-9a-f]{64}$')
            self.assertTrue((COMMITTED_FIXTURE_DIRECTORY / row['fixture']).is_file(), row['fixture'])
        committed_names = sorted(path.name for path in COMMITTED_FIXTURE_DIRECTORY.iterdir())
        self.assertEqual(committed_names, sorted([row['fixture'] for row in rows] + ['fixtures.json']))

    def test_no_fixture_holds_an_absolute_path_or_a_long_binary_run(self):
        for path in sorted(COMMITTED_FIXTURE_DIRECTORY.iterdir()):
            with self.subTest(fixture=path.name):
                text = path.read_text(encoding='utf-8')
                self.assertEqual(find_absolute_path_text(text), [])
                self.assertEqual(find_long_binary_runs(text), [])


if __name__ == '__main__':
    unittest.main()
