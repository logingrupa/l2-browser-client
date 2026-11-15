import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from tile_census_fixture import (NO_TERRAIN_MAP_PROPERTY, UNREADABLE_PACKAGE_HEADER, SyntheticMapClient, census_reviewed_reader_pairs,
                                 lineage_version_111_package_header, plain_package_header, synthetic_terrain_map_package)
from world.reader_licensee_layouts import G16_HEIGHTMAP_READER, MAP_READERS, RAW_MAP_READER, reviewed_reader_pairs
from world.tile_census import (census_gap_row, declared_terrain_map_package, map_census_keys, map_reader_gate, read_package_header,
                               terrain_height_gate_by_package_name, tile_census_bytes)
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH, TileCensusError, validate_tile_census

COMMITTED_TILE_CENSUS_PATH = ROOT / TILE_CENSUS_RELATIVE_PATH
UNREVIEWED_LICENSEE = 27
SYNTHETIC_MAP_PAIRS = [(123, 28), (123, 30)]
SYNTHETIC_REVIEWED_READER_PAIRS = {G16_HEIGHTMAP_READER: [(123, 25), (123, 28)], **{reader: SYNTHETIC_MAP_PAIRS for reader in MAP_READERS}}


SYNTHETIC_MAP_PACKAGES = {
    'maps/20_21.unr': synthetic_terrain_map_package(['T_20_21.Height.T_20_21']),
    'textures/T_20_21.utx': lineage_version_111_package_header(123, 28),
    'maps/20_22.unr': synthetic_terrain_map_package([]),
    'maps/20_23.unr': synthetic_terrain_map_package(['T_20_23.T_20_23']),
    'textures/T_20_23.utx': plain_package_header(123, 25),
    'maps/20_31.unr': synthetic_terrain_map_package(['T_20_31.T_20_31']),
    'textures/T_20_31.utx': plain_package_header(123, UNREVIEWED_LICENSEE),
    'maps/20_24.unr': synthetic_terrain_map_package(['T_20_24.T_20_24']),
    'textures/t_20_24.UTX': plain_package_header(123, 28),
    'maps/20_25.unr': synthetic_terrain_map_package(['T_99_99.Height.X']),
    'maps/20_26.unr': synthetic_terrain_map_package(['T_99_99.Height.X']),
    'textures/T_99_99.utx': plain_package_header(123, 28),
    'textures/T_20_25.utx': plain_package_header(123, 25),
    'maps/20_27.unr': synthetic_terrain_map_package([NO_TERRAIN_MAP_PROPERTY]),
    'maps/20_28.unr': synthetic_terrain_map_package(['T_98_98.Height.X']),
    'maps/20_29.unr': synthetic_terrain_map_package([None]),
    'maps/20_30.unr': plain_package_header(123, 28),
    'textures/T_20_30.utx': plain_package_header(123, 28),
    'maps/19_21.unr': lineage_version_111_package_header(123, UNREVIEWED_LICENSEE),
    'textures/T_19_21.utx': plain_package_header(123, 28),
    'maps/19_22.unr': plain_package_header(123, UNREVIEWED_LICENSEE),
    'textures/T_19_22.utx': plain_package_header(123, UNREVIEWED_LICENSEE),
    'maps/18_21.unr': plain_package_header(118, 0),
    'maps/17_21.unr': UNREADABLE_PACKAGE_HEADER,
    'maps/Lobby.unr': synthetic_terrain_map_package([], 30),
    'maps/entry.unr': lineage_version_111_package_header(123, 0),
    'maps/skylevel.unr': plain_package_header(118, 0),
}


def rows_by_key(census):
    return {row['key']: row for row in census['maps']}


def declared_package(terrain_map_object, path, package_version, licensee):
    return {'basis': 'TerrainInfo.TerrainMap', 'object': terrain_map_object, 'path': path, 'packageVersion': package_version, 'licensee': licensee}


def package_named(path, package_version, licensee):
    return {'basis': 'package-name', 'object': None, 'path': path, 'packageVersion': package_version, 'licensee': licensee}


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


def package_header(licensee, package_version=123):
    return {'packageVersion': package_version, 'licensee': licensee, 'wrapper': 'UnrealPackage'}


class MapReaderGateTests(unittest.TestCase):
    def test_a_map_passes_only_when_every_map_reader_reviews_its_pair(self):
        cases = ((package_header(28), ('pass', None)), (package_header(30), ('pass', None)),
                 (package_header(UNREVIEWED_LICENSEE), ('fail', f'map-licensee-unsupported:123/{UNREVIEWED_LICENSEE}')),
                 (package_header(28, 118), ('fail', 'map-version-unsupported:118')),
                 ({'error': 'Truncated package summary'}, ('fail', 'decode-failed:Truncated package summary')))
        with census_reviewed_reader_pairs(SYNTHETIC_REVIEWED_READER_PAIRS):
            for header, expected in cases:
                with self.subTest(header=header):
                    self.assertEqual(map_reader_gate(header), expected)

    def test_a_pair_that_only_the_raw_map_reader_reviews_stays_a_map_licensee_gap(self):
        only_raw_map_reviews_30 = {reader: [(123, 28)] for reader in MAP_READERS}
        only_raw_map_reviews_30[RAW_MAP_READER] = SYNTHETIC_MAP_PAIRS
        with census_reviewed_reader_pairs(only_raw_map_reviews_30):
            self.assertEqual(map_reader_gate(package_header(30)), ('fail', 'map-licensee-unsupported:123/30'))

    def test_the_real_reader_state_refuses_a_map_pair_that_one_map_reader_still_refuses(self):
        refused_by_one_reader = [pair for pair in reviewed_reader_pairs(RAW_MAP_READER)
                                 if any(pair not in reviewed_reader_pairs(reader) for reader in MAP_READERS)]
        self.assertTrue(refused_by_one_reader)
        for package_version, licensee in refused_by_one_reader:
            with self.subTest(licensee=licensee):
                self.assertEqual(map_reader_gate(package_header(licensee, package_version)),
                                 ('fail', f'map-licensee-unsupported:{package_version}/{licensee}'))


class DeclaredTerrainMapPackageTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(census_reviewed_reader_pairs(SYNTHETIC_REVIEWED_READER_PAIRS))
        self.client = SyntheticMapClient(self, SYNTHETIC_MAP_PACKAGES)

    def test_the_declared_terrain_map_resolves_to_its_lock_package_and_passes(self):
        lock_records = self.client.access.lock.records_by_path
        self.assertEqual(declared_terrain_map_package(self.client.access, lock_records, 'maps/20_25.unr'),
                         {'object': 'T_99_99.Height.X', 'path': 'textures/T_99_99.utx'})
        self.assertEqual(self.client.declared_gate('maps/20_25.unr'), ('pass', None, declared_package('T_99_99.Height.X', 'textures/T_99_99.utx', 123, 28)))

    def test_a_declared_package_passes_only_while_the_heightmap_reader_reviews_its_pair(self):
        declared = declared_package('T_20_23.T_20_23', 'textures/T_20_23.utx', 123, 25)
        self.assertEqual(self.client.declared_gate('maps/20_23.unr'), ('pass', None, declared))
        with census_reviewed_reader_pairs({G16_HEIGHTMAP_READER: [(123, 28)]}):
            self.assertEqual(self.client.declared_gate('maps/20_23.unr'), ('fail', 'terrain-height-licensee-unsupported:123/25', declared))

    def test_the_package_stem_is_matched_casefolded_against_the_lock(self):
        self.assertEqual(self.client.declared_gate('maps/20_24.unr'),
                         ('pass', None, declared_package('T_20_24.T_20_24', 'textures/t_20_24.UTX', 123, 28)))

    def test_no_terrain_info_no_terrain_map_or_an_unlocked_package_is_missing(self):
        cases = (('maps/20_22.unr', None), ('maps/20_27.unr', None), ('maps/20_29.unr', None), ('maps/20_28.unr', 'T_98_98.Height.X'))
        for map_relative_path, terrain_map_object in cases:
            with self.subTest(map=map_relative_path):
                self.assertEqual(self.client.declared_gate(map_relative_path),
                                 ('missing', 'terrain-height-package-missing', declared_package(terrain_map_object, None, None, None)))

    def test_a_map_with_two_terrain_infos_stops_the_census_naming_the_map(self):
        client = SyntheticMapClient(self, {'maps/20_21.unr': synthetic_terrain_map_package(['T_20_21.A', 'T_20_21.B']),
                                           'textures/T_20_21.utx': plain_package_header(123, 28)})
        with self.assertRaisesRegex(TileCensusError, r'maps/20_21\.unr holds 2 Engine\.TerrainInfo exports'):
            client.census()


class SyntheticTileCensusTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(census_reviewed_reader_pairs(SYNTHETIC_REVIEWED_READER_PAIRS))
        self.client = SyntheticMapClient(self, SYNTHETIC_MAP_PACKAGES)

    def test_headers_are_read_plain_and_lineage_wrapped(self):
        self.assertEqual(read_package_header(self.client.access, 'maps/20_30.unr'),
                         {'packageVersion': 123, 'licensee': 28, 'wrapper': 'UnrealPackage'})
        self.assertEqual(read_package_header(self.client.access, 'maps/19_21.unr'),
                         {'packageVersion': 123, 'licensee': UNREVIEWED_LICENSEE, 'wrapper': 'Lineage2Ver111'})
        self.assertIn('error', read_package_header(self.client.access, 'maps/17_21.unr'))

    def test_map_and_terrain_gate_results_status_and_reason_per_row(self):
        rows = rows_by_key(self.client.census())
        self.assertEqual({key: (row['mapReaderGate'], row['terrainHeightGate'], row['status'], row['reason']) for key, row in rows.items()
                          if key not in ('tile:17_21', 'tile:20_30')}, {
            'map:Lobby': ('pass', 'not-applicable', 'eligible', None),
            'map:entry': ('fail', 'not-applicable', 'gap', 'map-licensee-unsupported:123/0'),
            'map:skylevel': ('fail', 'not-applicable', 'gap', 'map-version-unsupported:118'),
            'tile:18_21': ('fail', 'missing', 'gap', 'map-version-unsupported:118'),
            'tile:19_21': ('fail', 'pass', 'gap', f'map-licensee-unsupported:123/{UNREVIEWED_LICENSEE}'),
            'tile:19_22': ('fail', 'fail', 'gap', f'map-licensee-unsupported:123/{UNREVIEWED_LICENSEE}'),
            'tile:20_21': ('pass', 'pass', 'eligible', None),
            'tile:20_22': ('pass', 'missing', 'gap', 'terrain-height-package-missing'),
            'tile:20_23': ('pass', 'pass', 'eligible', None),
            'tile:20_31': ('pass', 'fail', 'gap', f'terrain-height-licensee-unsupported:123/{UNREVIEWED_LICENSEE}'),
            'tile:20_24': ('pass', 'pass', 'eligible', None),
            'tile:20_25': ('pass', 'pass', 'eligible', None),
            'tile:20_26': ('pass', 'pass', 'eligible', None),
            'tile:20_27': ('pass', 'missing', 'gap', 'terrain-height-package-missing'),
            'tile:20_28': ('pass', 'missing', 'gap', 'terrain-height-package-missing'),
            'tile:20_29': ('pass', 'missing', 'gap', 'terrain-height-package-missing')})
        self.assertTrue(rows['tile:17_21']['reason'].startswith('decode-failed:'))
        self.assertEqual(rows['tile:17_21']['terrainHeightGate'], 'missing')
        self.assertFalse(any(row['reason'] == 'census-pending' for row in rows.values()))
        self.assertEqual((rows['tile:17_21']['packageVersion'], rows['tile:17_21']['licensee'], rows['tile:17_21']['wrapper']), (None, None, None))
        self.assertEqual((rows['tile:19_21']['packageVersion'], rows['tile:19_21']['licensee'], rows['tile:19_21']['wrapper']),
                         (123, UNREVIEWED_LICENSEE, 'Lineage2Ver111'))

    def test_the_census_records_the_reviewed_reader_pairs_it_was_built_from(self):
        self.assertEqual(self.client.census()['reviewedReaderPairs'],
                         {reader: [list(pair) for pair in sorted(pairs)] for reader, pairs in sorted(SYNTHETIC_REVIEWED_READER_PAIRS.items())})

    def test_every_gate_records_its_basis(self):
        rows = rows_by_key(self.client.census())
        self.assertEqual(rows['tile:20_21']['terrainMapPackage'], declared_package('T_20_21.Height.T_20_21', 'textures/T_20_21.utx', 123, 28))
        self.assertEqual(rows['tile:19_21']['terrainMapPackage'], package_named('textures/T_19_21.utx', 123, 28))
        self.assertEqual(rows['tile:18_21']['terrainMapPackage'], package_named(None, None, None))
        self.assertIsNone(rows['map:Lobby']['terrainMapPackage'])
        for row in rows.values():
            with self.subTest(key=row['key']):
                if row['kind'] == 'tile':
                    expected_basis = 'TerrainInfo.TerrainMap' if row['mapReaderGate'] == 'pass' else 'package-name'
                    self.assertEqual(row['terrainMapPackage']['basis'], expected_basis)

    def test_a_declared_package_wins_over_the_tile_name(self):
        row = rows_by_key(self.client.census())['tile:20_25']
        self.assertEqual(row['terrainMapPackage']['path'], 'textures/T_99_99.utx')
        self.assertEqual(row['status'], 'eligible')

    def test_two_tiles_that_declare_the_same_height_package_each_record_it(self):
        rows = rows_by_key(self.client.census())
        expected = declared_package('T_99_99.Height.X', 'textures/T_99_99.utx', 123, 28)
        self.assertEqual((rows['tile:20_25']['terrainMapPackage'], rows['tile:20_26']['terrainMapPackage']), (expected, expected))

    def test_a_readable_header_with_an_undecodable_package_table_is_a_decode_failed_gap(self):
        row = rows_by_key(self.client.census())['tile:20_30']
        self.assertEqual((row['mapReaderGate'], row['terrainHeightGate'], row['status']), ('pass', 'fail', 'gap'))
        self.assertTrue(row['reason'].startswith('decode-failed:'))
        self.assertEqual(row['terrainMapPackage'], declared_package(None, None, None, None))

    def test_an_unreadable_header_is_a_gap_row_and_does_not_stop_the_census(self):
        census = self.client.census()
        self.assertEqual(len(census['maps']), sum(path.startswith('maps/') for path in SYNTHETIC_MAP_PACKAGES))
        self.assertEqual(rows_by_key(census)['tile:17_21']['status'], 'gap')

    def test_rows_are_sorted_by_key_and_two_builds_are_byte_identical(self):
        first = self.client.census()
        keys = [row['key'] for row in first['maps']]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(keys[:3], ['map:Lobby', 'map:entry', 'map:skylevel'])
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

    def test_the_by_name_terrain_height_gate_reads_the_t_package_by_casefolded_name(self):
        lock_records = self.client.access.lock.records_by_path
        cases = (('20_21', ('pass', None, package_named('textures/T_20_21.utx', 123, 28))),
                 ('20_24', ('pass', None, package_named('textures/t_20_24.UTX', 123, 28))),
                 ('20_22', ('missing', 'terrain-height-package-missing', package_named(None, None, None))),
                 ('20_31', ('fail', f'terrain-height-licensee-unsupported:123/{UNREVIEWED_LICENSEE}',
                            package_named('textures/T_20_31.utx', 123, UNREVIEWED_LICENSEE))))
        for tile_id, expected in cases:
            with self.subTest(tile_id=tile_id):
                self.assertEqual(terrain_height_gate_by_package_name(self.client.access, lock_records, tile_id), expected)

    def test_the_synthetic_census_is_refused_by_the_full_count_validation(self):
        with self.assertRaisesRegex(TileCensusError, 'expected 153 and 10'):
            validate_tile_census(self.client.census())


class TerrainPackageVersionTests(unittest.TestCase):
    def test_a_declared_terrain_package_of_another_ue_version_is_a_lane_listed_gap(self):
        client = SyntheticMapClient(self, {'maps/20_21.unr': synthetic_terrain_map_package(['t_20_21.Height.X']),
                                           'textures/t_20_21.utx': plain_package_header(118, 11)})
        row = rows_by_key(client.census())['tile:20_21']
        self.assertEqual((row['terrainHeightGate'], row['status'], row['reason']), ('fail', 'gap', 'terrain-height-version-unsupported:118'))

    def test_an_unreadable_terrain_package_stops_the_census_naming_it(self):
        client = SyntheticMapClient(self, {'maps/20_21.unr': synthetic_terrain_map_package(['T_20_21.Height.X']),
                                           'textures/T_20_21.utx': UNREADABLE_PACKAGE_HEADER})
        with self.assertRaisesRegex(TileCensusError, 'textures/T_20_21.utx'):
            client.census()

    def test_a_non_tile_map_that_passes_the_map_gate_is_eligible_with_no_terrain_gate(self):
        client = SyntheticMapClient(self, {'maps/20_21.unr': synthetic_terrain_map_package([]), 'maps/Lobby.unr': plain_package_header(123, 28)})
        lobby = rows_by_key(client.census())['map:Lobby']
        self.assertEqual((lobby['mapReaderGate'], lobby['terrainHeightGate'], lobby['terrainMapPackage'], lobby['status'], lobby['reason']),
                         ('pass', 'not-applicable', None, 'eligible', None))


class CommittedTileCensusTests(unittest.TestCase):
    def setUp(self):
        self.census = json.loads(COMMITTED_TILE_CENSUS_PATH.read_text(encoding='utf-8'))

    def test_the_committed_census_validates_with_163_rows(self):
        validate_tile_census(self.census)
        rows = self.census['maps']
        self.assertEqual((len(rows), sum(row['kind'] == 'tile' for row in rows), sum(row['kind'] == 'non-tile' for row in rows)), (163, 153, 10))

    def test_no_committed_row_keeps_census_pending_and_gates_fit_their_kind(self):
        rows = self.census['maps']
        self.assertEqual([row['key'] for row in rows if row['reason'] == 'census-pending'], [])
        self.assertTrue(all(row['mapReaderGate'] == 'pass' and row['terrainHeightGate'] == ('pass' if row['kind'] == 'tile' else 'not-applicable')
                            for row in rows if row['status'] == 'eligible'))
        self.assertTrue(all(row['terrainHeightGate'] == 'not-applicable' and row['terrainMapPackage'] is None for row in rows if row['kind'] == 'non-tile'))
        self.assertEqual({row['terrainHeightGate'] for row in rows if row['kind'] == 'tile'} - {'pass', 'fail', 'missing'}, set())

    def test_every_map_gate_pass_tile_takes_its_terrain_gate_from_the_declared_terrain_map(self):
        map_gate_pass_tiles = [row for row in self.census['maps'] if row['kind'] == 'tile' and row['mapReaderGate'] == 'pass']
        self.assertTrue(map_gate_pass_tiles)
        self.assertEqual([row['key'] for row in map_gate_pass_tiles if row['terrainMapPackage']['basis'] != 'TerrainInfo.TerrainMap'], [])
        self.assertEqual([row['key'] for row in self.census['maps'] if row['kind'] == 'tile' and row['mapReaderGate'] == 'fail'
                          and row['terrainMapPackage']['basis'] != 'package-name'], [])

    def test_every_eligible_row_has_its_map_and_height_package_pairs_inside_the_reviewed_reader_pairs(self):
        pairs = {reader: {tuple(pair) for pair in reader_pairs} for reader, reader_pairs in self.census['reviewedReaderPairs'].items()}
        eligible_rows = [row for row in self.census['maps'] if row['status'] == 'eligible']
        self.assertTrue(eligible_rows)
        for row in eligible_rows:
            with self.subTest(key=row['key']):
                self.assertTrue(all((row['packageVersion'], row['licensee']) in pairs[reader] for reader in MAP_READERS))
                if row['kind'] == 'tile':
                    package = row['terrainMapPackage']
                    self.assertEqual(package['basis'], 'TerrainInfo.TerrainMap')
                    self.assertIn((package['packageVersion'], package['licensee']), pairs[G16_HEIGHTMAP_READER])
                    self.assertIsNotNone(package['path'])

    def test_the_committed_census_was_built_from_the_current_reviewed_reader_pairs(self):
        self.assertEqual(self.census['reviewedReaderPairs'],
                         {reader: [list(pair) for pair in reviewed_reader_pairs(reader)] for reader in sorted((G16_HEIGHTMAP_READER, *MAP_READERS))})

    def test_a_map_gate_pass_row_whose_pair_is_not_reviewed_is_refused(self):
        census = copy.deepcopy(self.census)
        row = next(row for row in census['maps'] if row['kind'] == 'tile' and row['mapReaderGate'] == 'pass')
        row['licensee'] = UNREVIEWED_LICENSEE
        with self.assertRaisesRegex(TileCensusError, 'does not fit its map package'):
            validate_tile_census(census)

    def test_a_census_without_its_reviewed_reader_pairs_is_refused(self):
        census = copy.deepcopy(self.census)
        del census['reviewedReaderPairs']
        with self.assertRaisesRegex(TileCensusError, 'schemaVersion'):
            validate_tile_census(census)

    def test_every_committed_reason_is_listed(self):
        reason_patterns = load_gap_reason_patterns()
        for row in self.census['maps']:
            if row['reason'] is not None:
                with self.subTest(key=row['key']):
                    self.assertTrue(any(pattern.fullmatch(row['reason']) for pattern in reason_patterns.values()), row['reason'])

    def test_lobby_status_is_known_and_eligible_on_the_map_gate_alone(self):
        lobby = rows_by_key(self.census)['map:Lobby']
        self.assertEqual((lobby['packageVersion'], lobby['licensee']), (123, 30))
        self.assertEqual((lobby['mapReaderGate'], lobby['terrainHeightGate'], lobby['status'], lobby['reason']),
                         ('pass', 'not-applicable', 'eligible', None))

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

    def test_a_tile_row_without_a_terrain_gate_basis_is_refused(self):
        census = copy.deepcopy(self.census)
        row = next(row for row in census['maps'] if row['kind'] == 'tile' and row['mapReaderGate'] == 'pass')
        row['terrainMapPackage'] = None
        with self.assertRaisesRegex(TileCensusError, 'terrainMapPackage must hold exactly'):
            validate_tile_census(census)

    def test_a_map_gate_pass_tile_with_a_package_name_basis_is_refused(self):
        census = copy.deepcopy(self.census)
        row = next(row for row in census['maps'] if row['kind'] == 'tile' and row['mapReaderGate'] == 'pass')
        row['terrainMapPackage']['basis'] = 'package-name'
        with self.assertRaisesRegex(TileCensusError, 'must have terrain gate basis TerrainInfo.TerrainMap'):
            validate_tile_census(census)


if __name__ == '__main__':
    unittest.main()
