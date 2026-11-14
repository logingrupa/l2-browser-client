import contextlib
import io
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.minimap_join import join_tile_route_half
from world.minimap_join_census import (MINIMAP_JOIN_CENSUS_RELATIVE_PATH, MinimapCensusSources, minimap_join_census, minimap_join_census_bytes,
                                       package_summary)
from world.minimap_join_census import main as minimap_join_census_main
from world.minimap_radar_route_recipe import read_minimap_radar_route_recipe

LONG_BINARY_RUN_PATTERN = re.compile(r'[A-Za-z0-9+/=]{129,}')
COMMITTED_CENSUS_PATH = ROOT / MINIMAP_JOIN_CENSUS_RELATIVE_PATH
CENSUS_BYTE_LIMIT = 30720
DELETED_REASON_SUFFIXES = (':radar-texture', ':radar-texture-conflict', ':zone-grid', ':projection')
ROUTE_REASONS = ['minimap-join-unresolved:zone-title-source', 'minimap-join-unresolved:radar-anchor']

PACKAGE_SHA256 = '1' * 64
TABLE_SHA256 = '2' * 64
FRAME = {'frameMinimumNative': [0.0, 98304.0], 'frameMaximumNative': [32640.0, 130944.0]}
READABLE_DXT1_SOURCE = {'status': 'readable', 'format': 'DXT1'}


def texture_package(name, export_names, texture_source=READABLE_DXT1_SOURCE):
    return {'path': f'systextures/{name}.utx', 'sha256': PACKAGE_SHA256, 'packageVersion': 123, 'licensee': 28, 'packageName': name,
            'exports': [{'exportIndex': index, 'name': export_name, 'object': f'{name}.{export_name}', 'textureSource': dict(texture_source)}
                        for index, export_name in enumerate(export_names, 1)]}


def zone_row(identifier, map_x, map_y, name='', color=200, bottom=-1000, top=1000):
    return {'ID': identifier, 'Color': color, 'MapX': map_x, 'MapY': map_y, 'Name': name, 'Bottom': bottom, 'Top': top, 'map': ''}


def hunting_row(identifier, x, y, name=''):
    return {'id': identifier, 'name': name, 'loc': {'start_npc_x': x, 'start_npc_y': y, 'start_npc_z': 0.0}}


def table(name, rows):
    return {'table': name, 'path': f'system/{name}-e.dat', 'sha256': TABLE_SHA256, 'rows': rows}


def route_half(zone_name_exports=('20_21',), hunting_rows=(), frame=FRAME, overlapping=frozenset(), tables=None):
    tables = tables if tables is not None else {'zonename': table('zonename', []), 'huntingzone': table('huntingzone', list(hunting_rows))}
    return join_tile_route_half('20_21', frame, texture_package('l2zonename', list(zone_name_exports)), tables, overlapping)


class TileRouteHalfTests(unittest.TestCase):
    def test_the_zone_key_texture_is_the_l2zonename_export_named_the_tile_id_under_casefolding(self):
        tile = route_half(zone_name_exports=['Gludio Territory', '20_21'])
        self.assertEqual((tile['zoneKeyTexture']['object'], tile['zoneKeyTexture']['rule'], tile['zoneKeyTexture']['source']['exportIndex']),
                         ('l2zonename.20_21', 'zone-sampler-tile', 2))
        self.assertIsNone(route_half(zone_name_exports=['map_20_21'])['zoneKeyTexture'])

    def test_a_hunting_zone_on_the_frame_maximum_edge_is_inside_and_one_unit_beyond_is_outside(self):
        tile = route_half(hunting_rows=[hunting_row(1, 32640.0, 130944.0), hunting_row(2, 32641.0, 100000.0), hunting_row(3, 0.0, 98304.0)])
        self.assertEqual([zone['id'] for zone in tile['huntingZones']], [1, 3])

    def test_zero_hunting_rows_and_an_absent_table_are_listed_gaps(self):
        self.assertEqual([gap['reason'] for gap in route_half()['gaps']], ['minimap-join-unresolved:hunting-zone-rows'])
        absent = route_half(tables={'zonename': None, 'huntingzone': table('huntingzone', [hunting_row(1, 1.0, 100000.0)])})
        self.assertEqual([gap['reason'] for gap in absent['gaps']], ['minimap-join-unresolved:source-package-absent'])

    def test_a_tile_with_an_overlapping_key_run_carries_the_zone_key_run_gap(self):
        tile = route_half(hunting_rows=[hunting_row(1, 1.0, 100000.0)], overlapping={'20_21'})
        self.assertEqual([gap['reason'] for gap in tile['gaps']], ['minimap-join-unresolved:zone-key-run'])


def radar_package():
    recipe = read_minimap_radar_route_recipe()['document']
    names = [case['texture'] for case in recipe['radar']['cases']] + [recipe['radar']['default']['texture']]
    package = texture_package('L2_RadarMap', names)
    for export in package['exports']:
        export['object'] = f'L2_RadarMap.RadarMaps.{export["name"]}'
    return package


def synthetic_census_tile_ids():
    return [f'{column}_{row}' for column in range(15, 27) for row in range(10, 27)][:153]


def synthetic_sources():
    world_map_package = texture_package('L2Font-e', [f'int_worldmap{number}' for number in range(1, 7)])
    for export in world_map_package['exports']:
        export['object'] = f'L2Font-e.Minimap.{export["name"]}'
    zone_rows = [zone_row(1, 20, 21, 'Here'), zone_row(2, 20, 21, 'Also here', color=201), zone_row(3, 20, 21, 'Stacked', bottom=0, top=500),
                 zone_row(4, 20, 21, 'Stacked', bottom=100, top=900), zone_row(5, 0, 0, 'town of gludio', color=10), zone_row(6, 40, 40, 'Far away')]
    radar = radar_package()
    texture_statuses = {export['object']: {'format': 'RGBA8'} for export in radar['exports']}
    texture_statuses.update({export['object']: {'format': 'DXT1'} for export in world_map_package['exports'][:5]})
    zone_name_package = texture_package('l2zonename', ['20_21', '15_10'])
    return MinimapCensusSources({package['path']: package_summary(package) for package in (radar, world_map_package, zone_name_package)},
                                texture_statuses, zone_name_package,
                                {'zonename': table('zonename', zone_rows), 'huntingzone': table('huntingzone', [hunting_row(4, 10.0, 100000.0)])})


def synthetic_census():
    return minimap_join_census('8' * 64, read_minimap_radar_route_recipe(), synthetic_sources(), list(reversed(synthetic_census_tile_ids())),
                               {'20_21': FRAME}, [{'windowId': 'MinimapWnd', 'controlNames': ['Minimap']}])


class MinimapJoinCensusTests(unittest.TestCase):
    def test_the_census_is_schema_2_and_lists_the_route_cases_with_format_and_name_row_counts(self):
        census = synthetic_census()
        self.assertEqual(census['schemaVersion'], 2)
        recipe = read_minimap_radar_route_recipe()['document']
        self.assertEqual([case['zoneName'] for case in census['route']['cases']], [case['zoneName'] for case in recipe['radar']['cases']])
        gludio = next(case for case in census['route']['cases'] if case['zoneName'] == 'Town of Gludio')
        self.assertEqual((gludio['texture'], gludio['format'], gludio['zonenameRowsWithName']),
                         ('L2_RadarMap.RadarMaps.gludio_castle_town', 'RGBA8', 1))
        self.assertEqual(census['route']['default']['texture'], 'L2_RadarMap.RadarMaps.Global')
        pieces = census['route']['worldMapPieces']
        self.assertEqual([piece['texture'] for piece in pieces], [f'L2Font-e.Minimap.int_worldmap{number}' for number in range(1, 7)])
        self.assertEqual((pieces[0]['format'], pieces[5]['reason']), ('DXT1', 'minimap-join-unresolved:route-texture-absent'))
        self.assertEqual(census['routeGapReasons'], [*ROUTE_REASONS, 'minimap-join-unresolved:route-texture-absent'])
        self.assertEqual([row['path'] for row in census['packages']], ['systextures/L2Font-e.utx', 'systextures/L2_RadarMap.utx', 'systextures/l2zonename.utx'])

    def test_the_zone_key_summary_counts_rows_keys_global_rows_shared_keys_and_overlapping_runs(self):
        summary = synthetic_census()['zoneKeys']
        self.assertEqual((summary['rows'], summary['keys'], summary['globalKeyRows'], summary['rowsOutsideLockedTiles'], summary['sharedKeys'],
                          summary['rowsInSharedKeys']), (6, 4, 1, 1, 1, 3))
        self.assertEqual([(run['tileId'], run['rowIndices']) for run in summary['overlappingRuns']], [('20_21', [0, 2, 3])])

    def test_one_short_row_per_locked_tile_sorted_with_zone_ids_by_key_and_route_reasons_counted_for_every_tile(self):
        census = synthetic_census()
        tile_ids = [tile['tileId'] for tile in census['tiles']]
        self.assertEqual((len(tile_ids), tile_ids), (153, sorted(tile_ids)))
        here = next(tile for tile in census['tiles'] if tile['tileId'] == '20_21')
        self.assertEqual(here['zoneKeyTexture'], 'l2zonename.20_21')
        self.assertEqual(sorted(here['zoneIdsByKey'].values()), [[1, 3, 4], [2]])
        self.assertEqual((here['huntingZoneIds'], here['status']), ([4], 'gap'))
        self.assertEqual(census['tileGapReasons'], {'20_21': ['minimap-join-unresolved:zone-key-run']})
        unframed = next(tile for tile in census['tiles'] if tile['tileId'] == '15_10')
        self.assertIsNone(unframed['huntingZoneIds'])
        self.assertEqual(census['gapReasonCounts']['minimap-join-unresolved:zone-title-source'], 153)
        self.assertEqual(census['statusCounts'], {'gap': 153})
        self.assertEqual(census['gapReasonCounts']['minimap-join-unresolved:zone-key-run'], 1)

    def test_no_deleted_rule_or_reason_appears_and_the_census_reruns_byte_identically_under_the_byte_limit(self):
        payload = minimap_join_census_bytes(synthetic_census())
        text = payload.decode('utf-8')
        self.assertFalse(any(suffix + '"' in text for suffix in DELETED_REASON_SUFFIXES))
        self.assertNotIn('tile-id-map', text)
        self.assertNotIn('town_map', text)
        self.assertIsNone(LONG_BINARY_RUN_PATTERN.search(text))
        self.assertLess(len(payload), CENSUS_BYTE_LIMIT)
        self.assertEqual(json.loads(text), json.loads(json.dumps(synthetic_census())))
        self.assertEqual(minimap_join_census_bytes(synthetic_census()), payload)

    def test_the_census_writes_only_its_fixed_tracked_doc_and_takes_no_output_option(self):
        self.assertEqual(MINIMAP_JOIN_CENSUS_RELATIVE_PATH, 'docs/parts/minimap/minimap-join-census.json')
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            minimap_join_census_main(['--client', str(ROOT), '--output', 'docs/minimap.json'])

    @unittest.skipUnless(COMMITTED_CENSUS_PATH.is_file(), 'the committed minimap join census is not written yet')
    def test_the_committed_census_is_schema_2_lists_the_153_locked_tiles_and_stays_under_the_byte_limit(self):
        text = COMMITTED_CENSUS_PATH.read_text(encoding='utf-8')
        census = json.loads(text)
        self.assertEqual((census['schemaVersion'], len(census['tiles'])), (2, 153))
        self.assertFalse(any(reason.endswith(DELETED_REASON_SUFFIXES) for reason in census['gapReasonCounts']))
        self.assertLess(COMMITTED_CENSUS_PATH.stat().st_size, CENSUS_BYTE_LIMIT)
        self.assertIsNone(LONG_BINARY_RUN_PATTERN.search(text))


if __name__ == '__main__':
    unittest.main()
