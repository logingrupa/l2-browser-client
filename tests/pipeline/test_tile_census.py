import copy
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from world.tile_census import (TILE_CENSUS_RELATIVE_PATH, TileCensusError, build_tile_census, census_gap_row, map_census_keys,
                               map_reader_gate, read_package_header, tile_census_bytes, validate_tile_census)

UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
LINEAGE_VERSION_111_WRAPPER = 'Lineage2Ver111'.encode('utf-16le')
LINEAGE_VERSION_111_XOR_KEY = 0xAC
COMMITTED_TILE_CENSUS_PATH = ROOT / TILE_CENSUS_RELATIVE_PATH


def plain_package_header(package_version, licensee):
    return struct.pack('<IHHIIIIIII', UNREAL_PACKAGE_SIGNATURE, package_version, licensee, 0, 1, 0, 1, 0, 1, 0).ljust(128, b'\0')


def lineage_version_111_package_header(package_version, licensee):
    return LINEAGE_VERSION_111_WRAPPER + bytes(value ^ LINEAGE_VERSION_111_XOR_KEY for value in plain_package_header(package_version, licensee))


UNREADABLE_PACKAGE_HEADER = b'not an unreal package header'.ljust(128, b'\0')


class SyntheticMapClient:
    def __init__(self, test_case, packages):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name) / 'client'
        for relative_path, payload in packages.items():
            path = self.root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        lock_client_as_checked_conversion_root(test_case, self.root, Path(temporary_directory.name) / 'reference-root', sorted(packages))
        self.access = require_reference_client(self.root)

    def census(self):
        return build_tile_census(self.access, self.access.lock.document, self.access.lock.records_by_path)


SYNTHETIC_MAP_PACKAGES = {
    'maps/20_21.unr': plain_package_header(123, 28),
    'maps/19_21.unr': lineage_version_111_package_header(123, 30),
    'maps/18_21.unr': plain_package_header(118, 0),
    'maps/17_21.unr': UNREADABLE_PACKAGE_HEADER,
    'maps/Lobby.unr': plain_package_header(123, 30),
    'maps/skylevel.unr': plain_package_header(118, 0),
}


def rows_by_key(census):
    return {row['key']: row for row in census['maps']}


class MapCensusKeyTests(unittest.TestCase):
    def test_tile_and_non_tile_maps_get_their_catalog_keys_in_key_order(self):
        lock_records = {path: {'eSha256': '0' * 64} for path in ('maps/20_21.unr', 'maps/Lobby.unr', 'maps/18_10.unr', 'maps/entry.unr',
                                                                 'textures/T_20_21.utx', 'maps/20_21.txt')}
        self.assertEqual(map_census_keys(lock_records), [
            {'map': 'maps/Lobby.unr', 'kind': 'non-tile', 'key': 'map:Lobby'},
            {'map': 'maps/entry.unr', 'kind': 'non-tile', 'key': 'map:entry'},
            {'map': 'maps/18_10.unr', 'kind': 'tile', 'key': 'tile:18_10'},
            {'map': 'maps/20_21.unr', 'kind': 'tile', 'key': 'tile:20_21'},
        ])

    def test_a_lock_with_no_tile_map_is_refused(self):
        with self.assertRaisesRegex(TileCensusError, 'no tile maps'):
            map_census_keys({'maps/Lobby.unr': {}, 'textures/T_20_21.utx': {}})
        with self.assertRaisesRegex(TileCensusError, 'no tile maps'):
            map_census_keys({})

    def test_two_lock_paths_that_differ_only_by_case_give_one_row(self):
        census_keys = map_census_keys({'maps/20_21.unr': {}, 'MAPS/20_21.UNR': {}})
        self.assertEqual([census_key['key'] for census_key in census_keys], ['tile:20_21'])


class MapReaderGateTests(unittest.TestCase):
    def test_only_version_123_licensee_28_passes(self):
        cases = (({'packageVersion': 123, 'licensee': 28, 'wrapper': 'UnrealPackage'}, ('pass', None)),
                 ({'packageVersion': 123, 'licensee': 30, 'wrapper': 'UnrealPackage'}, ('fail', 'map-licensee-unsupported:123/30')),
                 ({'packageVersion': 118, 'licensee': 28, 'wrapper': 'UnrealPackage'}, ('fail', 'map-version-unsupported:118')),
                 ({'error': 'Truncated package summary'}, ('fail', 'decode-failed:Truncated package summary')))
        for header, expected in cases:
            with self.subTest(header=header):
                self.assertEqual(map_reader_gate(header), expected)


class SyntheticTileCensusTests(unittest.TestCase):
    def setUp(self):
        self.client = SyntheticMapClient(self, SYNTHETIC_MAP_PACKAGES)

    def test_headers_are_read_plain_and_lineage_wrapped(self):
        self.assertEqual(read_package_header(self.client.access, 'maps/20_21.unr'),
                         {'packageVersion': 123, 'licensee': 28, 'wrapper': 'UnrealPackage'})
        self.assertEqual(read_package_header(self.client.access, 'maps/19_21.unr'),
                         {'packageVersion': 123, 'licensee': 30, 'wrapper': 'Lineage2Ver111'})
        self.assertIn('error', read_package_header(self.client.access, 'maps/17_21.unr'))

    def test_map_gate_results_and_reasons_per_row(self):
        rows = rows_by_key(self.client.census())
        self.assertEqual({key: (row['mapReaderGate'], row['status']) for key, row in rows.items() if row['reason'] is not None and
                          not row['reason'].startswith('decode-failed:')}, {
            'map:Lobby': ('fail', 'gap'), 'map:skylevel': ('fail', 'gap'), 'tile:18_21': ('fail', 'gap'), 'tile:19_21': ('fail', 'gap'),
            'tile:20_21': ('pass', 'gap')})
        self.assertEqual(rows['map:Lobby']['reason'], 'map-licensee-unsupported:123/30')
        self.assertEqual(rows['tile:19_21']['reason'], 'map-licensee-unsupported:123/30')
        self.assertEqual(rows['tile:18_21']['reason'], 'map-version-unsupported:118')
        self.assertTrue(rows['tile:17_21']['reason'].startswith('decode-failed:'))
        self.assertEqual((rows['tile:17_21']['packageVersion'], rows['tile:17_21']['licensee'], rows['tile:17_21']['wrapper']), (None, None, None))
        self.assertEqual((rows['tile:19_21']['packageVersion'], rows['tile:19_21']['licensee'], rows['tile:19_21']['wrapper']),
                         (123, 30, 'Lineage2Ver111'))
        self.assertTrue(all(row['terrainMapPackage'] is None for row in rows.values()))

    def test_an_unreadable_header_is_a_gap_row_and_does_not_stop_the_census(self):
        census = self.client.census()
        self.assertEqual(len(census['maps']), len(SYNTHETIC_MAP_PACKAGES))
        self.assertEqual(rows_by_key(census)['tile:17_21']['status'], 'gap')

    def test_rows_are_sorted_by_key_and_two_builds_are_byte_identical(self):
        first = self.client.census()
        keys = [row['key'] for row in first['maps']]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(keys[:2], ['map:Lobby', 'map:skylevel'])
        self.assertEqual(tile_census_bytes(first), tile_census_bytes(self.client.census()))

    def test_every_gap_reason_is_a_listed_gap_row_reason_with_the_lock_source_identity(self):
        census = self.client.census()
        reason_patterns = load_gap_reason_patterns()
        lock_records = self.client.access.lock.records_by_path
        for row in census['maps']:
            with self.subTest(key=row['key']):
                gap_row = validate_gap_row(census_gap_row(row, lock_records), reason_patterns)
                self.assertEqual(gap_row['sourceIdentity'], {'path': row['map'], 'sha256': lock_records[row['map']]['eSha256']})
                self.assertEqual((gap_row['part'], gap_row['step'], gap_row['evidence']), ('world', 'census', TILE_CENSUS_RELATIVE_PATH))

    def test_the_synthetic_census_is_refused_by_the_full_count_validation(self):
        with self.assertRaisesRegex(TileCensusError, 'expected 153 and 10'):
            validate_tile_census(self.client.census())


class CommittedTileCensusTests(unittest.TestCase):
    def setUp(self):
        self.census = json.loads(COMMITTED_TILE_CENSUS_PATH.read_text(encoding='utf-8'))

    def test_the_committed_census_validates_with_163_rows(self):
        validate_tile_census(self.census)
        rows = self.census['maps']
        self.assertEqual((len(rows), sum(row['kind'] == 'tile' for row in rows), sum(row['kind'] == 'non-tile' for row in rows)), (163, 153, 10))
        self.assertEqual(COMMITTED_TILE_CENSUS_PATH.read_bytes(), tile_census_bytes(self.census))

    def test_every_committed_reason_is_listed(self):
        reason_patterns = load_gap_reason_patterns()
        for row in self.census['maps']:
            if row['reason'] is not None:
                with self.subTest(key=row['key']):
                    self.assertTrue(any(pattern.fullmatch(row['reason']) for pattern in reason_patterns.values()), row['reason'])

    def test_lobby_status_is_known_as_a_gap(self):
        lobby = rows_by_key(self.census)['map:Lobby']
        self.assertEqual(lobby['status'], 'gap')
        self.assertRegex(lobby['reason'], r'^map-(licensee|version)-unsupported:')

    def test_the_non_tile_maps_are_the_ten_named_maps(self):
        self.assertEqual(sorted(row['key'] for row in self.census['maps'] if row['kind'] == 'non-tile'),
                         ['map:Auto0', 'map:Auto1', 'map:Auto2', 'map:Auto3', 'map:Auto4', 'map:Auto5', 'map:Lobby', 'map:entry',
                          'map:ship_position', 'map:skylevel'])

    def test_an_eligible_row_without_both_gates_passing_is_refused(self):
        census = copy.deepcopy(self.census)
        row = next(row for row in census['maps'] if row['mapReaderGate'] == 'fail')
        row.update(status='eligible', reason=None)
        with self.assertRaisesRegex(TileCensusError, 'is eligible but its gates'):
            validate_tile_census(census)


if __name__ == '__main__':
    unittest.main()
