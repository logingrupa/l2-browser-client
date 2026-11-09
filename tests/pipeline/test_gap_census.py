from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.gap_census import GAP_CENSUS_STATUS_PRECEDENCE, GAP_CENSUS_STEP_ORDER, GapCensusIncompleteError, build_gap_census

SOURCE_SHA256 = 'b' * 64
WORLD_KEYS = ('map:Lobby', 'tile:00_01', 'tile:00_02', 'tile:00_03')


def census_gap_row(key, part, step, status, reason, path='maps/source.unr'):
    return {'key': key, 'part': part, 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': path, 'sha256': SOURCE_SHA256}, 'evidence': 'docs/coverage.md'}


def world_row(key, step, status, reason):
    return census_gap_row(key, 'world', step, status, reason, f'maps/{key.split(":", 1)[1]}.unr')


def enumerated_denominator(keys, source='synthetic committed list'):
    return {'count': len(keys), 'keys': tuple(keys), 'source': source}


def census_rows_by_key(census_rows):
    return {row['key']: row for row in census_rows}


class GapCensusWorldTests(unittest.TestCase):
    def setUp(self):
        self.denominators = {'world': enumerated_denominator(WORLD_KEYS)}
        self.gap_rows = [
            world_row('tile:00_01', 'census', 'gap', 'map-licensee-unsupported:123/25'),
            world_row('tile:00_02', 'census', 'gap', 'census-pending'),
            world_row('tile:00_02', 'raw', 'gap', 'decode-failed:FormatError'),
            world_row('map:Lobby', 'census', 'gap', 'map-licensee-unsupported:123/30'),
            world_row('tile:00_03', 'census', 'pending', 'step-pending:raw'),
            world_row('tile:00_03', 'manifest', 'pending', 'step-pending:manifest'),
        ]
        self.converted_keys = {'tile:00_03'}

    def build(self, gap_rows=None, load_checks=None):
        return build_gap_census(self.denominators, self.gap_rows if gap_rows is None else gap_rows, self.converted_keys, load_checks or {})

    def test_every_world_key_gets_one_status_and_the_reason_of_its_latest_step(self):
        census_rows = self.build()
        self.assertEqual([row['key'] for row in census_rows], list(WORLD_KEYS))
        self.assertEqual(census_rows_by_key(census_rows), {
            'tile:00_01': {'key': 'tile:00_01', 'part': 'world', 'status': 'gap', 'reason': 'map-licensee-unsupported:123/25',
                           'converted': False, 'loads': 'unverified'},
            'tile:00_02': {'key': 'tile:00_02', 'part': 'world', 'status': 'gap', 'reason': 'decode-failed:FormatError',
                           'converted': False, 'loads': 'unverified'},
            'tile:00_03': {'key': 'tile:00_03', 'part': 'world', 'status': 'converted', 'reason': None, 'converted': True,
                           'loads': 'unverified'},
            'map:Lobby': {'key': 'map:Lobby', 'part': 'world', 'status': 'gap', 'reason': 'map-licensee-unsupported:123/30',
                          'converted': False, 'loads': 'unverified'},
        })

    def test_a_missing_lobby_row_fails_naming_the_part_and_the_key(self):
        gap_rows = [row for row in self.gap_rows if row['key'] != 'map:Lobby']
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part world: .*map:Lobby'):
            self.build(gap_rows)

    def test_failed_wins_over_gap_and_gap_over_pending_whatever_the_step(self):
        self.assertEqual(GAP_CENSUS_STATUS_PRECEDENCE, ('converted', 'failed', 'gap', 'pending'))
        gap_rows = self.gap_rows + [world_row('tile:00_01', 'raw', 'pending', 'step-pending:raw'),
                                    world_row('map:Lobby', 'raw', 'failed', 'decode-failed:Truncated')]
        census_rows = census_rows_by_key(self.build(gap_rows))
        self.assertEqual((census_rows['tile:00_01']['status'], census_rows['tile:00_01']['reason']),
                         ('gap', 'map-licensee-unsupported:123/25'))
        self.assertEqual((census_rows['map:Lobby']['status'], census_rows['map:Lobby']['reason']), ('failed', 'decode-failed:Truncated'))

    def test_a_pass_row_never_converts_a_key_without_a_catalog_entry(self):
        self.converted_keys = set()
        census_rows = census_rows_by_key(self.build(self.gap_rows + [world_row('tile:00_03', 'terrain', 'pass', None)]))
        self.assertEqual((census_rows['tile:00_03']['status'], census_rows['tile:00_03']['converted']), ('pending', False))
        self.assertEqual(census_rows['tile:00_03']['reason'], 'step-pending:manifest')
        only_pass_rows = [row for row in self.gap_rows if row['key'] != 'tile:00_03'] + [world_row('tile:00_03', 'raw', 'pass', None)]
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part world: .*tile:00_03'):
            self.build(only_pass_rows)

    def test_loads_come_only_from_load_checks(self):
        census_rows = census_rows_by_key(self.build(load_checks={'tile:00_03': 'pass', 'map:Lobby': 'failed'}))
        self.assertEqual([census_rows[key]['loads'] for key in WORLD_KEYS], ['failed', 'unverified', 'unverified', 'pass'])

    def test_the_step_order_runs_census_first_and_holds_every_lane_step(self):
        self.assertEqual(GAP_CENSUS_STEP_ORDER[0], 'census')
        for step in ('raw', 'chunks', 'terrain', 'terrain-material', 'decode', 'layout', 'textures', 'npc-model'):
            with self.subTest(step):
                self.assertIn(step, GAP_CENSUS_STEP_ORDER)
        self.assertLess(GAP_CENSUS_STEP_ORDER.index('raw'), GAP_CENSUS_STEP_ORDER.index('manifest'))


if __name__ == '__main__':
    unittest.main()
