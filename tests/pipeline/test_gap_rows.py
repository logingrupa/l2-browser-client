from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.gap_rows import (GAP_ROW_FIELDS, GAP_ROW_STATUSES, SEED_GAP_REASONS_PATH, GapRowError,
                                   gap_reason_list_versions, load_gap_reason_patterns, read_gap_rows,
                                   stage_a_part_names, validate_gap_row, write_gap_rows)

SOURCE_SHA256 = 'f' * 64
NON_TILE_MAP_NAMES = ('Auto0', 'Auto1', 'Auto2', 'Auto3', 'Auto4', 'Auto5', 'Lobby', 'entry', 'ship_position', 'skylevel')


def gap_row(**changes):
    return {'key': 'tile:20_21', 'part': 'world', 'step': 'raw', 'status': 'gap', 'reason': 'map-licensee-unsupported:123/23',
            'sourceIdentity': {'path': 'maps/20_21.unr', 'sha256': SOURCE_SHA256},
            'evidence': 'docs/parts/world/tile-census.json', **changes}


def sample_reason_for_pattern(pattern):
    return re.sub(r'<[A-Za-z][A-Za-z0-9]*>', 'x1', pattern)


class GapRowValidationTests(unittest.TestCase):
    def test_a_listed_gap_row_validates(self):
        self.assertEqual(validate_gap_row(gap_row()), gap_row())
        self.assertEqual(GAP_ROW_STATUSES, ('pass', 'gap', 'pending', 'failed'))
        self.assertEqual(GAP_ROW_FIELDS, ('key', 'part', 'step', 'status', 'reason', 'sourceIdentity', 'evidence'))
        qualified_object = gap_row(sourceIdentity={'path': 'maps/20_21.unr', 'sha256': SOURCE_SHA256, 'object': 'myLevel.TerrainInfo0'})
        self.assertEqual(validate_gap_row(qualified_object), qualified_object)
        self.assertEqual(validate_gap_row(gap_row(status='pass', reason=None)), gap_row(status='pass', reason=None))

    def test_malformed_rows_are_refused(self):
        row_without_evidence = gap_row()
        del row_without_evidence['evidence']
        refused_rows = {
            'missing field': row_without_evidence,
            'extra field': gap_row(note='free text'),
            'short tile key': gap_row(key='tile:2_21'),
            'npc key without id': gap_row(key='npc:abc'),
            'unknown key kind': gap_row(key='model:x'),
            'part outside Stage A': gap_row(part='adapter-dispatch'),
            'step with capitals': gap_row(step='Raw'),
            'unknown status': gap_row(status='done'),
            'pass with a reason': gap_row(status='pass'),
            'gap without a reason': gap_row(reason=None),
            'unlisted reason': gap_row(reason='invented-reason'),
            'placeholder without value': gap_row(reason='map-licensee-unsupported'),
            'source without sha256': gap_row(sourceIdentity={'path': 'maps/20_21.unr'}),
            'absolute source path': gap_row(sourceIdentity={'path': 'C:/Lineage2-client/maps/20_21.unr', 'sha256': SOURCE_SHA256}),
            'unqualified object': gap_row(sourceIdentity={'path': 'maps/20_21.unr', 'sha256': SOURCE_SHA256, 'object': 'not qualified'}),
            'absolute evidence': gap_row(evidence='C:/x'),
            'escaping evidence': gap_row(evidence='../x'),
            'not an object': ['tile:20_21'],
        }
        for case, row in refused_rows.items():
            with self.subTest(case=case), self.assertRaises(GapRowError):
                validate_gap_row(row)

    def test_every_seed_reason_accepts_a_sample_value(self):
        seed = json.loads(SEED_GAP_REASONS_PATH.read_text(encoding='utf-8'))
        self.assertEqual((seed['schemaVersion'], seed['listVersion'], len(seed['reasons'])), (1, 3, 30))
        for pattern in seed['reasons']:
            with self.subTest(pattern=pattern):
                validate_gap_row(gap_row(reason=sample_reason_for_pattern(pattern)))
        validate_gap_row(gap_row(reason='decode-failed:cp1252 codec error'))
        validate_gap_row(gap_row(reason='step-pending:meshes', status='pending'))
        with self.assertRaises(GapRowError):
            validate_gap_row(gap_row(reason='decode-failed:'))

    def test_catalog_keys_of_every_kind_validate(self):
        keys = ['map:ship_position', 'window:StatusWnd', 'window:StatusWnd#2', 'skill:3:1', 'character:0', 'table:itemname-e',
                'npc:12077', 'item:57', *(f'map:{name}' for name in NON_TILE_MAP_NAMES)]
        for key in keys:
            with self.subTest(key=key):
                validate_gap_row(gap_row(key=key))

    def test_stage_a_parts_are_the_world_actors_and_data_ui_lane_parts(self):
        self.assertEqual(stage_a_part_names(), frozenset({
            'world', 'minimap', 'movement-geodata', 'player-characters', 'npcs', 'items', 'skills-effects', 'audio',
            'data', 'ui', 'sandbox'}))


class GapReasonListTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.repository = Path(temporary_directory.name).resolve()

    def write_lane_reasons(self, lane_folder, document):
        path = self.repository / 'recipes' / lane_folder / 'gap-reasons.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document), encoding='utf-8')

    def test_a_lane_file_extends_the_seed_list(self):
        self.write_lane_reasons('world', {'schemaVersion': 1, 'listVersion': 2, 'reasons': ['synthetic-lane-only-reason']})
        patterns = load_gap_reason_patterns(repository_root=self.repository)
        validate_gap_row(gap_row(reason='synthetic-lane-only-reason'), patterns)
        with self.assertRaises(GapRowError):
            validate_gap_row(gap_row(reason='synthetic-lane-only-reason'))
        self.assertEqual(gap_reason_list_versions(repository_root=self.repository), {'seed': 3, 'world': 2})

    def test_a_pattern_listed_in_two_files_is_refused(self):
        self.write_lane_reasons('actors', {'schemaVersion': 1, 'listVersion': 1, 'reasons': ['census-pending']})
        with self.assertRaisesRegex(GapRowError, 'census-pending'):
            load_gap_reason_patterns(repository_root=self.repository)

    def test_a_lane_file_below_list_version_one_is_refused(self):
        self.write_lane_reasons('data', {'schemaVersion': 1, 'listVersion': 0, 'reasons': ['window-unlisted']})
        with self.assertRaisesRegex(GapRowError, 'listVersion'):
            load_gap_reason_patterns(repository_root=self.repository)


class GapRowFileTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.gap_rows_folder = self.project / 'artifacts' / 'lane-store' / 'world' / 'gap-rows'

    def test_rows_are_written_sorted_by_key_into_one_file_per_step(self):
        rows = [gap_row(key='tile:20_22'), gap_row(key='map:Lobby', status='pending', reason='census-pending'), gap_row()]
        document = write_gap_rows(self.project, 'world', 'raw', rows)
        raw_path = self.gap_rows_folder / 'raw.json'
        self.assertEqual(json.loads(raw_path.read_text(encoding='utf-8')), document)
        self.assertEqual(document['schemaVersion'], 1)
        self.assertEqual((document['lane'], document['step'], document['reasonListVersions']), ('world', 'raw', gap_reason_list_versions()))
        self.assertEqual([row['key'] for row in document['rows']], ['map:Lobby', 'tile:20_21', 'tile:20_22'])
        first_bytes = raw_path.read_bytes()
        write_gap_rows(self.project, 'world', 'raw', list(reversed(rows)))
        self.assertEqual(raw_path.read_bytes(), first_bytes)
        self.assertEqual(sorted(path.name for path in self.gap_rows_folder.iterdir()), ['raw.json'])

    def test_the_integration_lane_writes_census_rows_of_any_stage_a_part(self):
        item_row = gap_row(key='item:57', part='items', step='census', reason='etcitem-presentation-unplanned')
        document = write_gap_rows(self.project, 'integration', 'census', [item_row])
        self.assertEqual(document['rows'], [item_row])
        self.assertEqual(read_gap_rows(self.project, 'integration'), [item_row])
        with self.assertRaises(GapRowError):
            write_gap_rows(self.project, 'integration', 'census', [gap_row(key='item:58', part='adapter-dispatch', step='census')])

    def test_rows_outside_the_lane_or_step_or_with_a_repeated_key_are_refused(self):
        refused_row_lists = {
            'part of another lane': [gap_row(part='npcs', key='npc:12077')],
            'row of another step': [gap_row(step='terrain')],
            'repeated key': [gap_row(), gap_row(status='failed', reason='decode-failed:truncated')],
        }
        for case, rows in refused_row_lists.items():
            with self.subTest(case=case), self.assertRaises(GapRowError):
                write_gap_rows(self.project, 'world', 'raw', rows)
        self.assertFalse(self.gap_rows_folder.exists())

    def test_one_tile_has_a_pass_or_gap_per_step_and_rows_read_back_sorted(self):
        self.assertEqual(read_gap_rows(self.project, 'world'), [])
        write_gap_rows(self.project, 'world', 'terrain', [
            gap_row(step='terrain', status='pending', reason='step-pending:terrain'),
            gap_row(key='map:entry', step='terrain', status='gap', reason='map-version-unsupported:sample')])
        write_gap_rows(self.project, 'world', 'raw', [gap_row(status='pass', reason=None)])
        rows = read_gap_rows(self.project, 'world')
        self.assertEqual([(row['key'], row['step'], row['status']) for row in rows],
                         [('map:entry', 'terrain', 'gap'), ('tile:20_21', 'raw', 'pass'), ('tile:20_21', 'terrain', 'pending')])


if __name__ == '__main__':
    unittest.main()
