import contextlib
import io
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.canonical_json import canonical_json_bytes
from world.minimap_join import MINIMAP_JOIN_ALGORITHM_VERSION, join_minimap_sources, locked_tile_grid
from world.minimap_join_census import MINIMAP_JOIN_CENSUS_RELATIVE_PATH, minimap_join_census, minimap_join_census_bytes, world_map_pieces
from world.minimap_join_census import main as minimap_join_census_main
from world.minimap_sources import MinimapSources

LONG_BINARY_RUN_PATTERN = re.compile(r'[A-Za-z0-9+/=]{129,}')
COMMITTED_CENSUS_PATH = ROOT / MINIMAP_JOIN_CENSUS_RELATIVE_PATH

PACKAGE_SHA256 = '1' * 64
TABLE_SHA256 = '2' * 64
FRAME = {'frameMinimumNative': [0.0, 98304.0], 'frameMaximumNative': [32640.0, 130944.0]}
LOCKED_GRID = locked_tile_grid(['16_10', '26_26'])


def texture_package(name, export_names, version=(123, 28)):
    return {'path': f'systextures/{name}.utx', 'sha256': PACKAGE_SHA256, 'packageVersion': version[0], 'licensee': version[1], 'packageName': name,
            'exports': [{'exportIndex': index, 'name': export_name, 'object': f'{name}.Group.{export_name}'}
                        for index, export_name in enumerate(export_names, 1)]}


def zone_row(identifier, map_x, map_y, name='', map_texture=''):
    return {'ID': identifier, 'MapX': map_x, 'MapY': map_y, 'Name': name, 'map': map_texture}


def hunting_row(identifier, x, y, name=''):
    return {'id': identifier, 'name': name, 'loc': {'start_npc_x': x, 'start_npc_y': y, 'start_npc_z': 0.0}}


def table(name, rows):
    return {'table': name, 'path': f'system/{name}-e.dat', 'sha256': TABLE_SHA256, 'rows': rows}


def joined_tile(radar_exports=(), town_exports=(), zone_name_exports=(), zone_rows=(), hunting_rows=(), frame=FRAME, radar_version=(123, 28),
                dimensions=None, tile_id='20_21'):
    result = join_minimap_sources([tile_id], {} if frame is None else {tile_id: frame}, texture_package('Radar', radar_exports, radar_version),
                                  texture_package('town_map', town_exports), texture_package('l2zonename', zone_name_exports),
                                  table('zonename', list(zone_rows)), table('huntingzone', list(hunting_rows)), LOCKED_GRID, dimensions)
    return result['tiles'][0]


def gap_reasons(tile):
    return [gap['reason'] for gap in tile['gaps']]


class ExactNameRuleTests(unittest.TestCase):
    def test_a_radar_export_named_the_tile_id_joins_by_rule_tile_id_and_a_prefixed_name_does_not(self):
        tile = joined_tile(radar_exports=['20_21'], dimensions={'Radar.Group.20_21': [256, 256]})
        self.assertEqual((tile['radarTexture']['object'], tile['radarTexture']['rule']), ('Radar.Group.20_21', 'tile-id'))
        unmatched = joined_tile(radar_exports=['map_20_21'])
        self.assertIsNone(unmatched['radarTexture'])
        self.assertIn('minimap-join-unresolved:radar-texture', gap_reasons(unmatched))

    def test_the_tile_id_map_name_joins_any_package_with_its_citation(self):
        tile = joined_tile(town_exports=['20_21_MAP'])
        self.assertEqual([(item['object'], item['rule']) for item in tile['townMapTextures']], [('town_map.Group.20_21_MAP', 'tile-id-map')])
        self.assertIn('12c9656', tile['townMapTextures'][0]['citation'])

    def test_a_zone_row_map_value_joins_by_rule_zonename_map_under_unreal_casefolding(self):
        tile = joined_tile(radar_exports=['Gludio_Town'], zone_rows=[zone_row(1, 20, 21, map_texture='gludio_town')], dimensions={'Radar.Group.Gludio_Town': [8, 8]})
        self.assertEqual((tile['radarTexture']['object'], tile['radarTexture']['rule']), ('Radar.Group.Gludio_Town', 'zonename-map'))

    def test_two_different_radar_exports_are_a_conflict_gap(self):
        tile = joined_tile(radar_exports=['20_21', 'gludio_town'], zone_rows=[zone_row(1, 20, 21, map_texture='gludio_town')])
        self.assertIsNone(tile['radarTexture'])
        self.assertIn('minimap-join-unresolved:radar-texture-conflict', gap_reasons(tile))

    def test_zone_name_and_hunting_zone_names_join_their_packages(self):
        tile = joined_tile(zone_name_exports=['Gludio Territory', '20_21'], town_exports=['Cruma Tower'],
                           zone_rows=[zone_row(2, 20, 21, name='Gludio Territory')], hunting_rows=[hunting_row(5, 100.0, 100000.0, 'Cruma Tower')])
        self.assertEqual([(item['object'], item['rule']) for item in tile['zoneNameTextures']],
                         [('l2zonename.Group.20_21', 'tile-id'), ('l2zonename.Group.Gludio Territory', 'zonename-name')])
        self.assertEqual([item['rule'] for item in tile['townMapTextures']], ['huntingzone-name'])


class ZoneAndHuntingZoneTests(unittest.TestCase):
    def test_zone_rows_join_only_by_map_x_and_map_y_equal_to_the_tile_grid(self):
        tile = joined_tile(zone_rows=[zone_row(1, 20, 21, 'Here'), zone_row(2, 21, 20, 'Elsewhere')])
        self.assertEqual([(zone['id'], zone['rule'], zone['source']['rowIndex']) for zone in tile['zones']], [(1, 'zonename-grid', 0)])

    def test_any_zone_row_outside_the_locked_grid_makes_every_zone_join_a_grid_gap(self):
        tile = joined_tile(zone_rows=[zone_row(1, 20, 21, 'Here'), zone_row(0, 0, 0, 'Unplaced')])
        self.assertEqual(tile['zones'], [])
        self.assertIn('minimap-join-unresolved:zone-grid', gap_reasons(tile))

    def test_a_hunting_zone_on_the_frame_maximum_edge_is_inside_and_one_unit_beyond_is_outside(self):
        tile = joined_tile(hunting_rows=[hunting_row(1, 32640.0, 130944.0), hunting_row(2, 32641.0, 100000.0), hunting_row(3, 0.0, 98304.0)])
        self.assertEqual([zone['id'] for zone in tile['huntingZones']], [1, 3])

    def test_a_tile_without_a_frame_joins_no_hunting_zone_and_its_projection_is_a_gap(self):
        tile = joined_tile(hunting_rows=[hunting_row(1, 10.0, 100000.0)], frame=None)
        self.assertEqual(tile['huntingZones'], [])
        self.assertIn('minimap-join-unresolved:projection', gap_reasons(tile))


class EmptyInputAndProjectionTests(unittest.TestCase):
    def test_empty_indexes_and_zero_rows_give_listed_gaps_never_an_exception(self):
        tile = joined_tile()
        self.assertEqual(sorted(gap_reasons(tile)), ['minimap-join-unresolved:hunting-zone-rows', 'minimap-join-unresolved:radar-texture',
                                                     'minimap-join-unresolved:zone-rows'])

    def test_an_absent_package_or_table_is_a_source_gap_for_every_tile(self):
        result = join_minimap_sources(['20_21', '20_22'], {}, None, None, None, None, None, LOCKED_GRID)
        for tile in result['tiles']:
            self.assertEqual(gap_reasons(tile)[0], 'minimap-join-unresolved:source-package-absent')
            self.assertEqual(tile['status'], 'gap')

    def test_a_radar_package_outside_the_reviewed_versions_is_a_licensee_gap(self):
        tile = joined_tile(radar_exports=['20_21'], radar_version=(118, 0))
        self.assertIsNone(tile['radarTexture'])
        self.assertIn('texture-licensee-unsupported:118/0', gap_reasons(tile))
        self.assertNotIn('minimap-join-unresolved:projection', gap_reasons(tile))

    def test_a_square_texture_gives_the_unverified_tile_frame_extent_projection_and_a_non_square_one_a_gap(self):
        tile = joined_tile(radar_exports=['20_21'], zone_rows=[zone_row(1, 20, 21)], hunting_rows=[hunting_row(1, 1.0, 100000.0)],
                           dimensions={'Radar.Group.20_21': [256, 256]})
        self.assertEqual(tile['projection'], {'rule': 'tile-frame-extent', 'status': 'unverified', 'frameMinimumNative': [0.0, 98304.0],
                                              'frameMaximumNative': [32640.0, 130944.0], 'textureWidth': 256, 'textureHeight': 256})
        self.assertEqual((tile['status'], tile['gaps']), ('joined', []))
        non_square = joined_tile(radar_exports=['20_21'], dimensions={'Radar.Group.20_21': [256, 128]})
        self.assertIsNone(non_square['projection'])
        self.assertIn('minimap-join-unresolved:projection', gap_reasons(non_square))


class OrderingTests(unittest.TestCase):
    def test_joined_items_list_in_source_row_order_then_export_index_and_reruns_are_byte_identical(self):
        arguments = dict(zone_name_exports=['B', 'A', '20_21'], zone_rows=[zone_row(1, 20, 21, 'B'), zone_row(2, 20, 21, 'A')])
        tile = joined_tile(**arguments)
        self.assertEqual([item['object'] for item in tile['zoneNameTextures']], ['l2zonename.Group.20_21', 'l2zonename.Group.B', 'l2zonename.Group.A'])
        self.assertEqual(canonical_json_bytes(joined_tile(**arguments)), canonical_json_bytes(tile))

    def test_the_result_counts_every_rule_and_carries_the_algorithm_version(self):
        result = join_minimap_sources(['20_21'], {'20_21': FRAME}, texture_package('Radar', ['20_21']), texture_package('town_map', []),
                                      texture_package('l2zonename', ['20_21']), table('zonename', [zone_row(1, 20, 21)]), table('huntingzone', []), LOCKED_GRID)
        self.assertEqual(result['algorithmVersion'], MINIMAP_JOIN_ALGORITHM_VERSION)
        self.assertEqual(result['ruleMatchCounts']['tile-id'], 2)
        self.assertEqual(result['ruleMatchCounts']['zonename-grid'], 1)
        self.assertEqual(result['ruleMatchCounts']['zonename-map'], 0)


def synthetic_census_tile_ids():
    return [f'{column}_{row}' for column in range(15, 27) for row in range(10, 27)][:153]


def synthetic_census():
    sources = MinimapSources({'radar': texture_package('Radar', ['town']), 'town-map': texture_package('town_map', []),
                              'zone-name': texture_package('l2zonename', ['20_21', '15_10'])},
                             {'zonename': table('zonename', [zone_row(1, 20, 21, 'Here')]), 'huntingzone': table('huntingzone', [hunting_row(4, 10.0, 100000.0)])})
    world_map_package = texture_package('L2Font-e', ['int_worldmap2', 'int_worldmap1', 'other'])
    return minimap_join_census('8' * 64, sources, list(reversed(synthetic_census_tile_ids())), {'20_21': FRAME}, world_map_pieces(world_map_package),
                               [{'windowId': 'MinimapWnd', 'controlNames': ['Minimap']}])


class MinimapJoinCensusTests(unittest.TestCase):
    def test_the_census_holds_one_row_per_tile_sorted_by_tile_id_with_a_reason_on_every_gap(self):
        census = synthetic_census()
        tile_ids = [tile['tileId'] for tile in census['tiles']]
        self.assertEqual(len(tile_ids), 153)
        self.assertEqual(tile_ids, sorted(tile_ids))
        self.assertTrue(all(tile['reason'] for tile in census['tiles'] if tile['status'] == 'gap'))
        here = next(tile for tile in census['tiles'] if tile['tileId'] == '20_21')
        self.assertEqual((here['zoneIds'], here['huntingZoneIds'], here['zoneNameTextures']), ([1], [4], ['l2zonename.Group.20_21']))

    def test_package_rows_rule_counts_and_row_counts_are_integers_and_world_map_pieces_are_evidence_only(self):
        census = synthetic_census()
        self.assertEqual([(row['path'], row['packageVersion'], row['licensee'], row['reviewed'], row['textureExportCount']) for row in census['packages']],
                         [('systextures/L2_RadarMap.utx', 123, 28, True, 1), ('systextures/town_map.utx', 123, 28, True, 0),
                          ('systextures/l2zonename.utx', 123, 28, True, 2)])
        self.assertTrue(all(type(count) is int for count in census['ruleMatchCounts'].values()))
        self.assertEqual([row['rowCount'] for row in census['tables']], [1, 1])
        self.assertEqual((census['worldMapPieces']['pieces'], census['worldMapPieces']['usedByJoin']),
                         (['L2Font-e.Group.int_worldmap1', 'L2Font-e.Group.int_worldmap2'], False))

    def test_the_census_holds_no_long_binary_run_and_reruns_byte_identically(self):
        payload = minimap_join_census_bytes(synthetic_census())
        self.assertIsNone(LONG_BINARY_RUN_PATTERN.search(payload.decode('utf-8')))
        self.assertEqual(minimap_join_census_bytes(synthetic_census()), payload)

    def test_the_census_writes_only_its_fixed_tracked_doc_and_takes_no_output_option(self):
        self.assertEqual(MINIMAP_JOIN_CENSUS_RELATIVE_PATH, 'docs/parts/minimap/minimap-join-census.json')
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            minimap_join_census_main(['--client', str(ROOT), '--output', 'docs/minimap.json'])

    @unittest.skipUnless(COMMITTED_CENSUS_PATH.is_file(), 'the committed minimap join census is not written yet')
    def test_the_committed_census_lists_the_153_locked_tiles_without_texture_bytes(self):
        text = COMMITTED_CENSUS_PATH.read_text(encoding='utf-8')
        census = json.loads(text)
        self.assertEqual(len(census['tiles']), 153)
        self.assertTrue(all(tile['reason'] for tile in census['tiles'] if tile['status'] == 'gap'))
        self.assertIsNone(LONG_BINARY_RUN_PATTERN.search(text))


if __name__ == '__main__':
    unittest.main()
