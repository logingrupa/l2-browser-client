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
from native_store.build_coverage_report import build_coverage_report
from native_store.gap_census import build_gap_census
from native_store.gap_census_denominators import load_census_denominators
from native_store.gap_census_derived_parts import derived_converted_keys, derived_part_rows, derived_tile_denominator
from native_store.gap_rows import write_gap_rows

GENERATED_AT_RIGA = '2026-11-11T13:30:00+02:00'
SOURCE_SHA256 = 'b' * 64
CHUNK_MANIFEST_SHA256 = 'c' * 64
JOINED_TILE_ID = '20_20'
UNJOINED_TILE_ID = '20_21'
UNJOINED_MINIMAP_REASON = 'minimap-join-unresolved:radar-texture'
RESOURCE_PATH_TEMPLATES = {'minimap': '/l2/maps/{sha256}/native-tile-minimap/manifest.json',
                           'native-tile-collision': '/l2/maps/{sha256}/native-tile-collision/asset.json',
                           'world-audio': '/l2/world-audio/{sha256}/manifest.json'}


def world_row(key, step, status, reason):
    return {'key': key, 'part': 'world', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': f'maps/{key.split(":", 1)[1]}.unr', 'sha256': SOURCE_SHA256},
            'evidence': 'docs/parts/world/tile-census.json'}


def write_hash_addressed_file(store_root, path_template, document):
    payload = json.dumps(document, sort_keys=True).encode()
    sha256 = hashlib.sha256(payload).hexdigest()
    manifest = path_template.format(sha256=sha256)
    path = store_root / manifest[len('/l2/'):]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return {'manifest': manifest, 'manifestSha256': sha256, 'manifestBytes': len(payload)}


def write_tile_resource(store_root, kind, tile_id, minimap_gaps=()):
    document = {'tileId': tile_id, 'gaps': [{'reason': reason} for reason in minimap_gaps]} if kind == 'minimap' else {'tileId': tile_id}
    return {'kind': kind, **write_hash_addressed_file(store_root, RESOURCE_PATH_TEMPLATES[kind], document)}


def write_tile_record(store_root, tile_id, resources):
    manifest = {'kind': 'native-tile-runtime', 'schemaVersion': 1, 'tileId': tile_id, 'sourceMap': f'maps/{tile_id}.unr',
                'sourceSha256': SOURCE_SHA256,
                'frame': {'terrainInfo': f'{tile_id}.TerrainInfo0', 'location': [0.0, 0.0, 0.0], 'terrainScale': [128.0, 128.0, 76.0]},
                'anchor': {'playerStart': f'{tile_id}.PlayerStart0', 'location': [0.0, 0.0, 0.0]},
                'chunks': [{'chunkId': 'chunk-0-0', 'manifest': f'/l2/maps/{CHUNK_MANIFEST_SHA256}/native-tile-chunk-runtime/manifest.json',
                            'manifestSha256': CHUNK_MANIFEST_SHA256, 'manifestBytes': 10}],
                'resources': sorted(resources, key=lambda resource: (resource['kind'], resource['manifest'])), 'gaps': []}
    return {'id': tile_id, **write_hash_addressed_file(store_root, '/l2/tiles/{sha256}/tile.json', manifest)}


def write_tile_store(store_root, tile_resources_by_id):
    records = [write_tile_record(store_root, tile_id, [write_tile_resource(store_root, kind, tile_id, gaps) for kind, gaps in resources])
               for tile_id, resources in sorted(tile_resources_by_id.items())]
    catalog = {'schemaVersion': 1, 'models': [], 'tiles': records}
    write_store_catalog(store_root, catalog)
    return catalog


def census_by_key(census_rows):
    return {row['key']: row for row in census_rows}


class DerivedPartsTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'world' / 'l2'
        self.tile_keys = [key for key in load_census_denominators(['world'])['world']['keys'] if key.startswith('tile:')]
        self.world_census_rows = [world_row(key, 'census', 'pending', 'step-pending:raw') for key in self.tile_keys]


class MinimapPartTests(DerivedPartsTestCase):
    def test_the_minimap_denominator_is_exactly_the_locked_tile_keys(self):
        denominator = derived_tile_denominator('minimap')
        self.assertEqual(denominator['count'], 153)
        self.assertEqual(denominator['keys'], tuple(sorted(f'minimap:{key.split(":", 1)[1]}' for key in self.tile_keys)))
        self.assertIn('recipes/reference-client-tree.lock.json maps/XX_YY.unr (153 tiles as minimap:XX_YY keys)', denominator['source'])
        self.assertEqual(load_census_denominators(['world'])['minimap'], denominator)

    def test_only_a_pinned_minimap_resource_whose_join_has_no_gap_converts_its_key(self):
        catalog = write_tile_store(self.store_root, {JOINED_TILE_ID: [('minimap', ())],
                                                     UNJOINED_TILE_ID: [('minimap', (UNJOINED_MINIMAP_REASON,))],
                                                     '20_22': [('native-tile-collision', ())]})
        self.assertEqual(derived_converted_keys(self.store_root, catalog), {f'minimap:{JOINED_TILE_ID}'})

    def test_derived_rows_take_the_minimap_step_row_or_a_pending_row_and_ignore_other_parts_and_steps(self):
        source_rows = [*self.world_census_rows,
                       world_row(f'tile:{UNJOINED_TILE_ID}', 'minimap', 'gap', UNJOINED_MINIMAP_REASON),
                       world_row(f'tile:{JOINED_TILE_ID}', 'collision', 'failed', 'decode-failed:FormatError'),
                       {**world_row(f'tile:{JOINED_TILE_ID}', 'minimap', 'gap', 'census-pending'), 'part': 'npcs'}]
        denominators = {'minimap': derived_tile_denominator('minimap')}
        rows = derived_part_rows(denominators, source_rows)
        self.assertEqual(len(rows), 153)
        census_rows = census_by_key(build_gap_census(denominators, rows, {f'minimap:{JOINED_TILE_ID}'}, {}))
        self.assertEqual(len(census_rows), 153)
        self.assertEqual(census_rows[f'minimap:{UNJOINED_TILE_ID}'],
                         {'key': f'minimap:{UNJOINED_TILE_ID}', 'part': 'minimap', 'status': 'gap', 'reason': UNJOINED_MINIMAP_REASON,
                          'converted': False, 'loads': 'unverified'})
        self.assertEqual((census_rows[f'minimap:{JOINED_TILE_ID}']['status'], census_rows[f'minimap:{JOINED_TILE_ID}']['converted']),
                         ('converted', True))
        self.assertEqual((census_rows['minimap:20_22']['status'], census_rows['minimap:20_22']['reason']), ('pending', 'step-pending:minimap'))
        pending_row = next(row for row in rows if row['key'] == 'minimap:20_22')
        self.assertEqual((pending_row['part'], pending_row['step'], pending_row['sourceIdentity'], pending_row['evidence']),
                         ('minimap', 'minimap', {'path': 'maps/20_22.unr', 'sha256': SOURCE_SHA256}, 'docs/parts/world/tile-census.json'))

    def test_a_world_lane_report_counts_minimap_over_the_locked_tiles_without_writing_a_gap_row_file(self):
        write_gap_rows(self.project_root, 'world', 'census', [world_row(key, 'census', 'gap', 'census-pending') if key.startswith('map:')
                                                              else world_row(key, 'census', 'pending', 'step-pending:raw')
                                                              for key in load_census_denominators(['world'])['world']['keys']])
        write_gap_rows(self.project_root, 'world', 'minimap', [world_row(f'tile:{UNJOINED_TILE_ID}', 'minimap', 'gap', UNJOINED_MINIMAP_REASON)])
        write_tile_store(self.store_root, {JOINED_TILE_ID: [('minimap', ())], UNJOINED_TILE_ID: [('minimap', (UNJOINED_MINIMAP_REASON,))]})
        gap_row_files = sorted(path.name for path in (self.project_root / 'artifacts' / 'lane-store' / 'world' / 'gap-rows').iterdir())
        report = build_coverage_report(self.project_root, self.store_root, ('world',), GENERATED_AT_RIGA)
        minimap_rows = {row['key']: row for row in report['rows'] if row['part'] == 'minimap'}
        self.assertEqual((report['denominators']['minimap']['count'], len(minimap_rows)), (153, 153))
        counts = report['parts']['minimap']
        self.assertEqual((counts['converted'], counts['gap'], counts['pending']), (1, 1, 151))
        self.assertEqual(minimap_rows[f'minimap:{UNJOINED_TILE_ID}']['steps'],
                         [{'step': 'minimap', 'status': 'gap', 'reason': UNJOINED_MINIMAP_REASON}])
        self.assertEqual(len([row for row in report['rows'] if row['part'] == 'world']), 163)
        self.assertEqual(sorted(path.name for path in (self.project_root / 'artifacts' / 'lane-store' / 'world' / 'gap-rows').iterdir()),
                         gap_row_files)


if __name__ == '__main__':
    unittest.main()
