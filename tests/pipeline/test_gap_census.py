from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from catalog_store_fixture import write_store_catalog
from native_store.build_coverage_report import build_coverage_report, validate_coverage_report
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_census import (GAP_CENSUS_STATUS_PRECEDENCE, GAP_CENSUS_STEP_ORDER, GapCensusIncompleteError, build_gap_census,
                                     item_census_rows)
from native_store.gap_census_denominators import census_item_join_rows, load_census_denominators

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


def counted_denominator(count, source='synthetic committed count'):
    return {'count': count, 'keys': None, 'source': source}


def npc_row(npc_id):
    return census_gap_row(f'npc:{npc_id}', 'npcs', 'census', 'pending', 'conversion-pending', 'system/npcgrp.dat')


def skill_row(skill_id, level, reason='conversion-pending'):
    return census_gap_row(f'skill:{skill_id}:{level}', 'skills-effects', 'census', 'pending' if reason == 'conversion-pending' else 'gap',
                          reason, 'system/skillgrp.dat')


def item_row(item_id):
    return census_gap_row(f'item:{item_id}', 'items', 'census', 'pending', 'conversion-pending', 'system/weapongrp.dat')


ITEM_TABLE_SOURCES = {'itemname-e': {'path': 'system/itemname-e.dat', 'sha256': 'c' * 64},
                      'etcitemgrp': {'path': 'system/etcitemgrp.dat', 'sha256': 'd' * 64}}


class GapCensusPartTests(unittest.TestCase):
    def test_tables_take_the_catalog_the_decode_failure_or_the_pending_row(self):
        denominators = {'data': enumerated_denominator(('table:chargrp', 'table:itemname-e', 'table:sysstring-e'))}
        decode_rows = [census_gap_row('table:sysstring-e', 'data', 'decode', 'gap', 'decode-failed:FormatError', 'system/sysstring-e.dat'),
                       census_gap_row('table:chargrp', 'data', 'decode', 'pending', 'step-pending:decode', 'system/chargrp.dat')]
        census_rows = census_rows_by_key(build_gap_census(denominators, decode_rows, {'table:itemname-e'}, {}))
        self.assertEqual([(census_rows[key]['status'], census_rows[key]['reason']) for key in sorted(census_rows)],
                         [('pending', 'step-pending:decode'), ('converted', None), ('gap', 'decode-failed:FormatError')])
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part data: .*table:chargrp'):
            build_gap_census(denominators, decode_rows[:1], {'table:itemname-e'}, {})

    def test_npc_keys_must_match_the_committed_row_count(self):
        denominators = {'npcs': counted_denominator(3, 'actor-unit-census.json npcgrp rowCount')}
        self.assertEqual(len(build_gap_census(denominators, [npc_row(1), npc_row(2), npc_row(3)], set(), {})), 3)
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part npcs: 2 keys .*denominator 3'):
            build_gap_census(denominators, [npc_row(1), npc_row(2)], set(), {})

    def test_item_rows_join_etcitems_and_ungrouped_items_to_itemname(self):
        join_rows = item_census_rows([1, 2, 3, 4], [item_row(1)], [2, 3], ITEM_TABLE_SOURCES)
        self.assertEqual([(row['key'], row['status'], row['reason'], row['sourceIdentity']['path']) for row in join_rows], [
            ('item:2', 'gap', 'etcitem-presentation-unplanned', 'system/etcitemgrp.dat'),
            ('item:3', 'gap', 'etcitem-presentation-unplanned', 'system/etcitemgrp.dat'),
            ('item:4', 'gap', 'item-group-row-absent', 'system/itemname-e.dat')])
        self.assertEqual({(row['part'], row['step'], row['evidence']) for row in join_rows}, {('items', 'census', 'docs/coverage.md')})
        census_rows = build_gap_census({'items': counted_denominator(4)}, [item_row(1), *join_rows], set(), {})
        self.assertEqual([row['key'] for row in census_rows], ['item:1', 'item:2', 'item:3', 'item:4'])

    def test_item_ids_outside_itemname_are_refused(self):
        for case, group_rows, etcitem_ids in (('etcitem', [], [9]), ('weapon or armor', [item_row(9)], [])):
            with self.subTest(case), self.assertRaisesRegex(GapCensusIncompleteError, r'part items: .*item:9'):
                item_census_rows([1, 2], group_rows, etcitem_ids, ITEM_TABLE_SOURCES)
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part items: .*item:1'):
            item_census_rows([1, 2], [item_row(1)], [1], ITEM_TABLE_SOURCES)

    def test_skill_rows_count_ambiguous_rows_only_when_declared(self):
        denominators = {'skills-effects': counted_denominator(4)}
        declared_rows = [skill_row(3, 1), skill_row(3, 2), skill_row(4, 1, 'skill-row-ambiguous:2')]
        self.assertEqual(len(build_gap_census(denominators, declared_rows, set(), {})), 3)
        for case, rows in (('undeclared', declared_rows[:2] + [skill_row(4, 1)]),
                           ('declared three', declared_rows[:2] + [skill_row(4, 1, 'skill-row-ambiguous:3')])):
            with self.subTest(case), self.assertRaisesRegex(GapCensusIncompleteError, 'part skills-effects'):
                build_gap_census(denominators, rows, set(), {})

    def test_committed_denominators_name_their_files(self):
        actor_denominators = load_census_denominators(['actors'])
        self.assertEqual(tuple(actor_denominators), ('player-characters', 'npcs', 'items', 'skills-effects', 'audio'))
        self.assertEqual((actor_denominators['player-characters']['count'], actor_denominators['npcs']['count']), (15, 6519))
        self.assertIn('docs/parts/npcs/actor-unit-census.json chargrp rowCount', actor_denominators['player-characters']['source'])
        self.assertIn('docs/parts/data/dat-table-inventory.json itemname-e recordCount', actor_denominators['items']['source'])
        self.assertEqual(actor_denominators['audio']['count'], 'unknown')
        window_denominator = load_census_denominators(['data-ui'])['ui']
        self.assertEqual((window_denominator['count'], len(window_denominator['keys'])), (248, 248))
        self.assertIn('window:StatusWnd', window_denominator['keys'])
        self.assertIn('docs/parts/ui/interface-window-census.json rootWindowCount', window_denominator['source'])

    def test_rows_are_sorted_by_part_then_key_and_repeat_byte_for_byte(self):
        denominators = {'world': enumerated_denominator(('tile:00_02', 'map:Lobby')), 'npcs': counted_denominator(2)}
        gap_rows = [npc_row(10), world_row('tile:00_02', 'census', 'gap', 'census-pending'), npc_row(9),
                    world_row('map:Lobby', 'census', 'gap', 'census-pending')]
        first_rows = build_gap_census(denominators, gap_rows, set(), {})
        self.assertEqual([row['key'] for row in first_rows], ['map:Lobby', 'tile:00_02', 'npc:10', 'npc:9'])
        self.assertEqual(canonical_json_bytes(first_rows), canonical_json_bytes(build_gap_census(denominators, gap_rows[::-1], set(), {})))


def write_decoded_table(store_root, table_name, source_sha256, records):
    record_count = records['data']
    payload = json.dumps({'descriptorSha256': 'f' * 64, 'kind': 'native-table', 'recordCount': record_count,
                          'records': records, 'route': 'local-decoded', 'schemaVersion': 1, 'sourcePath': f'system/{table_name}.dat',
                          'sourceSha256': source_sha256, 'table': table_name}, sort_keys=True).encode()
    manifest_sha256 = hashlib.sha256(payload).hexdigest()
    manifest_path = store_root / 'tables' / manifest_sha256 / f'{table_name}.json'
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(payload)
    return {'id': table_name, 'manifest': f'/l2/tables/{manifest_sha256}/{table_name}.json', 'manifestSha256': manifest_sha256,
            'manifestBytes': len(payload), 'recordCount': record_count, 'sourceSha256': source_sha256}


class GapCensusItemJoinTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / 'l2'
        self.store_root.mkdir(parents=True)

    def test_item_join_rows_read_the_decoded_itemname_and_etcitem_tables(self):
        table_records = [write_decoded_table(self.store_root, 'etcitemgrp', 'd' * 64, {'data': 1, 'item': [{'object_id': 2}]}),
                         write_decoded_table(self.store_root, 'itemname-e', 'c' * 64,
                                             {'data': 3, 'item_name': [{'id': 1}, {'id': 2}, {'id': 3}]})]
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'tables': table_records})
        join_rows = census_item_join_rows(self.project_root, [item_row(1)])
        self.assertEqual([(row['key'], row['reason'], row['sourceIdentity']) for row in join_rows], [
            ('item:2', 'etcitem-presentation-unplanned', {'path': 'system/etcitemgrp.dat', 'sha256': 'd' * 64}),
            ('item:3', 'item-group-row-absent', {'path': 'system/itemname-e.dat', 'sha256': 'c' * 64})])

    def test_a_lane_catalog_without_a_decoded_etcitem_table_is_refused(self):
        table_records = [write_decoded_table(self.store_root, 'itemname-e', 'c' * 64, {'data': 1, 'item_name': [{'id': 1}]})]
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'tables': table_records})
        with self.assertRaisesRegex(GapCensusIncompleteError, 'part items: .*etcitemgrp'):
            census_item_join_rows(self.project_root, [item_row(1)])


class GapCensusRefusalTests(unittest.TestCase):
    def setUp(self):
        self.denominators = {'npcs': counted_denominator(1), 'sandbox': {'count': 'unknown', 'keys': None, 'source': 'none yet'},
                             'world': enumerated_denominator(('map:Lobby',))}
        self.gap_rows = [npc_row(1), world_row('map:Lobby', 'census', 'gap', 'census-pending')]

    def test_a_complete_census_passes(self):
        self.assertEqual(len(build_gap_census(self.denominators, self.gap_rows, set(), {})), 2)

    def test_every_refusal_names_its_part(self):
        refused_cases = {
            'unlisted reason': ([census_gap_row('npc:1', 'npcs', 'census', 'gap', 'invented-reason')], r'part npcs: .*listed reason'),
            'unknown step': ([census_gap_row('npc:1', 'npcs', 'polish', 'pending', 'conversion-pending')], r'part npcs: .*step polish'),
            'key outside the denominator': ([world_row('map:entry', 'census', 'gap', 'census-pending')], r'part world: .*map:entry'),
            'rows under an unknown denominator': ([census_gap_row('npc:2', 'audio', 'census', 'pending', 'conversion-pending')],
                                                  r'part audio: .*npc:2'),
        }
        for case, (extra_rows, message) in refused_cases.items():
            with self.subTest(case), self.assertRaisesRegex(GapCensusIncompleteError, message):
                build_gap_census(self.denominators, self.gap_rows + extra_rows, set(), {})
        self.denominators['audio'] = {'count': 'unknown', 'keys': None, 'source': 'none yet'}
        with self.assertRaisesRegex(GapCensusIncompleteError, r'part audio has rows but its denominator is unknown'):
            build_gap_census(self.denominators, self.gap_rows + refused_cases['rows under an unknown denominator'][0], set(), {})

    def test_a_load_check_other_than_pass_or_failed_is_refused(self):
        with self.assertRaisesRegex(GapCensusIncompleteError, 'npc:1'):
            build_gap_census(self.denominators, self.gap_rows, set(), {'npc:1': 'unverified'})


CENSUS_LANE_NAMES = ('actors', 'data-ui', 'world')
SHARED_STORE_CATALOG_PATH = ROOT / 'public' / 'l2' / 'catalog.json'
CENSUS_GENERATED_AT_RIGA = '2026-11-09T06:30:00+02:00'


class GapCensusCompletenessTests(unittest.TestCase):
    def setUp(self):
        missing_inputs = [f'artifacts/lane-store/{lane_name}/gap-rows' for lane_name in CENSUS_LANE_NAMES
                          if not (ROOT / 'artifacts' / 'lane-store' / lane_name / 'gap-rows').is_dir()]
        missing_inputs += [path.relative_to(ROOT).as_posix() for path in
                           [SHARED_STORE_CATALOG_PATH, *(ROOT / 'artifacts' / 'lane-store' / lane_name / 'l2' / 'catalog.json'
                                                         for lane_name in CENSUS_LANE_NAMES)] if not path.is_file()]
        if missing_inputs:
            self.skipTest(f'real-data census needs the lane gap rows and catalogs: missing {", ".join(missing_inputs)}')

    def test_the_shared_store_and_lane_stores_give_every_denominator_key_one_status(self):
        report = build_coverage_report(ROOT, ROOT / 'public' / 'l2', CENSUS_LANE_NAMES, CENSUS_GENERATED_AT_RIGA, CENSUS_LANE_NAMES)
        self.assertEqual(validate_coverage_report(report), report)
        for part, denominator in report['denominators'].items():
            part_rows = [row for row in report['rows'] if row['part'] == part]
            with self.subTest(part):
                if denominator['count'] == 'unknown':
                    self.assertEqual(part_rows, [])
                else:
                    self.assertLessEqual(len(part_rows), denominator['count'])
                    self.assertEqual(len({row['key'] for row in part_rows}), len(part_rows))
        lobby_row = next(row for row in report['rows'] if row['key'] == 'map:Lobby')
        self.assertIn(lobby_row['status'], ('pass', 'failed', 'gap', 'pending'))


if __name__ == '__main__':
    unittest.main()
