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
from native_store.build_coverage_report import build_coverage_report, count_part_rows, coverage_markdown, validate_coverage_report
from native_store.gap_census import build_gap_census
from native_store.gap_census_denominators import load_census_denominators, skill_sound_census_row
from native_store.gap_census_derived_parts import derived_converted_keys, derived_part_rows, derived_tile_denominator
from native_store.gap_rows import write_gap_rows

GENERATED_AT_RIGA = '2026-11-11T13:30:00+02:00'
SOURCE_SHA256 = 'b' * 64
CHUNK_MANIFEST_SHA256 = 'c' * 64
COMBAT_AUDIO_SHA256 = 'd' * 64
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


def write_tile_record(store_root, tile_id, resources, gaps=()):
    manifest = {'kind': 'native-tile-runtime', 'schemaVersion': 1, 'tileId': tile_id, 'sourceMap': f'maps/{tile_id}.unr',
                'sourceSha256': SOURCE_SHA256,
                'frame': {'terrainInfo': f'{tile_id}.TerrainInfo0', 'location': [0.0, 0.0, 0.0], 'terrainScale': [128.0, 128.0, 76.0]},
                'anchor': {'playerStart': f'{tile_id}.PlayerStart0', 'location': [0.0, 0.0, 0.0]},
                'chunks': [{'chunkId': 'chunk-0-0', 'manifest': f'/l2/maps/{CHUNK_MANIFEST_SHA256}/native-tile-chunk-runtime/manifest.json',
                            'manifestSha256': CHUNK_MANIFEST_SHA256, 'manifestBytes': 10}],
                'resources': sorted(resources, key=lambda resource: (resource['kind'], resource['manifest'])), 'gaps': list(gaps)}
    return {'id': tile_id, **write_hash_addressed_file(store_root, '/l2/tiles/{sha256}/tile.json', manifest)}


def write_tile_store(store_root, tile_resources_by_id, tile_gap_rows_by_id=None, combat_audio_ids=()):
    records = [write_tile_record(store_root, tile_id, [write_tile_resource(store_root, kind, tile_id, gaps) for kind, gaps in resources],
                                 (tile_gap_rows_by_id or {}).get(tile_id, ()))
               for tile_id, resources in sorted(tile_resources_by_id.items())]
    combat_audio_records = [{'id': bundle_id, 'manifest': f'/l2/combat-audio/{COMBAT_AUDIO_SHA256}/manifest.json', 'manifestBytes': 10,
                             'manifestSha256': COMBAT_AUDIO_SHA256} for bundle_id in combat_audio_ids]
    catalog = {'schemaVersion': 1, 'models': [], 'tiles': records, 'combatAudio': combat_audio_records}
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
        self.assertEqual({key for key in derived_converted_keys(self.store_root, catalog) if key.startswith('minimap:')},
                         {f'minimap:{JOINED_TILE_ID}'})

    def test_derived_rows_take_the_minimap_step_row_or_a_pending_row_and_ignore_other_parts_and_steps(self):
        source_rows = [*self.world_census_rows,
                       world_row(f'tile:{UNJOINED_TILE_ID}', 'minimap', 'gap', UNJOINED_MINIMAP_REASON),
                       world_row(f'tile:{JOINED_TILE_ID}', 'collision', 'failed', 'decode-failed:FormatError'),
                       {**world_row(f'tile:{JOINED_TILE_ID}', 'minimap', 'gap', 'census-pending'), 'part': 'npcs'}]
        denominators = {'minimap': derived_tile_denominator('minimap')}
        rows = derived_part_rows(denominators, source_rows, {f'minimap:{JOINED_TILE_ID}'})
        self.assertEqual((len(rows), [row for row in rows if row['key'] == f'minimap:{JOINED_TILE_ID}']), (152, []))
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


def npc_row(npc_id, step, status, reason):
    return {'key': f'npc:{npc_id}', 'part': 'npcs', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': 'system/npcgrp.dat', 'sha256': SOURCE_SHA256}, 'evidence': 'docs/parts/npcs/actor-unit-census.json'}


def enumerated_denominator(keys):
    return {'count': len(keys), 'keys': tuple(sorted(keys)), 'source': 'synthetic committed list'}


class MovementGeodataAndTileAudioTests(DerivedPartsTestCase):
    def test_collision_and_world_audio_resources_convert_their_keys_and_a_step_without_a_gap_converts_tile_audio(self):
        audio_gap_row = world_row('tile:20_22', 'audio', 'gap', 'music-volume-unreadable')
        catalog = write_tile_store(self.store_root, {'20_20': [('native-tile-collision', ()), ('world-audio', ())],
                                                     '20_21': [('minimap', (UNJOINED_MINIMAP_REASON,))],
                                                     '20_22': [('native-tile-collision', ())]},
                                   {'20_22': [audio_gap_row]})
        self.assertEqual(derived_converted_keys(self.store_root, catalog),
                         {'tile-collision:20_20', 'tile-audio:20_20', 'tile-audio:20_21', 'tile-collision:20_22'})

    def test_tile_keys_take_the_collision_and_audio_step_rows_of_their_tile(self):
        denominators = {'movement-geodata': derived_tile_denominator('tile-collision'), 'audio': derived_tile_denominator('tile-audio')}
        source_rows = [*self.world_census_rows, world_row('tile:20_21', 'collision', 'failed', 'decode-failed:FormatError'),
                       world_row('tile:20_21', 'audio', 'pending', 'upstream-step-failed:collision'),
                       world_row('tile:20_20', 'minimap', 'gap', UNJOINED_MINIMAP_REASON)]
        census_rows = census_by_key(build_gap_census(denominators, derived_part_rows(denominators, source_rows, {'tile-audio:20_20'}),
                                                     {'tile-audio:20_20'}, {}))
        self.assertEqual(len(census_rows), 306)
        self.assertEqual([(census_rows[key]['part'], census_rows[key]['status'], census_rows[key]['reason'], census_rows[key]['converted'])
                          for key in ('tile-collision:20_21', 'tile-audio:20_21', 'tile-collision:20_20', 'tile-audio:20_20')],
                         [('movement-geodata', 'failed', 'decode-failed:FormatError', False),
                          ('audio', 'pending', 'upstream-step-failed:collision', False),
                          ('movement-geodata', 'pending', 'step-pending:collision', False),
                          ('audio', 'converted', None, True)])


class NpcAndSkillSoundTests(unittest.TestCase):
    def setUp(self):
        self.denominators = {'audio': enumerated_denominator(['npc-sounds:1', 'npc-sounds:2', 'npc-sounds:3', 'npc-sounds:4'])}
        self.source_rows = [npc_row(npc_id, 'census', 'pending', 'conversion-pending') for npc_id in (1, 2, 3, 4)]
        self.source_rows += [npc_row(1, 'npc-model', 'gap', 'no-mesh-in-row'),
                             npc_row(3, 'npc-sound-identities', 'gap', 'sound-identity-unresolved')]
        self.converted_keys = {'npc:2', 'npc:3', 'npc:4', 'npc-sounds:4'}

    def test_npc_sound_keys_follow_the_npc_the_sound_identity_row_or_the_bundle(self):
        rows = derived_part_rows(self.denominators, self.source_rows, self.converted_keys)
        census_rows = census_by_key(build_gap_census(self.denominators, rows, self.converted_keys, {}))
        self.assertEqual([(census_rows[f'npc-sounds:{npc_id}']['status'], census_rows[f'npc-sounds:{npc_id}']['reason'],
                           census_rows[f'npc-sounds:{npc_id}']['converted']) for npc_id in (1, 2, 3, 4)],
                         [('gap', 'no-mesh-in-row', False), ('pending', 'step-pending:actor-sounds', False),
                          ('gap', 'sound-identity-unresolved', False), ('converted', None, True)])
        self.assertEqual({row['part'] for row in rows}, {'audio'})

    def test_only_npc_combat_audio_bundles_convert_npc_sound_keys(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        store_root = Path(temporary_directory.name).resolve() / 'l2'
        catalog = write_tile_store(store_root, {}, combat_audio_ids=('actor-sounds:npc:12077', 'actor-sounds:skill:3:1'))
        self.assertEqual(derived_converted_keys(store_root, catalog), {'npc-sounds:12077'})

    def test_skill_sound_rows_take_their_actor_unit_census_status(self):
        source_identity = {'path': 'system/skillsoundgrp.dat', 'sha256': SOURCE_SHA256}
        convertible_unit = {'key': 'skill-sound-row:0', 'status': 'convertible', 'reason': None, 'sourceIdentity': source_identity}
        gap_unit = {'key': 'skill-sound-row:1', 'status': 'gap', 'reason': 'sound-identity-unresolved', 'sourceIdentity': source_identity}
        source_rows = [skill_sound_census_row(convertible_unit), skill_sound_census_row(gap_unit)]
        denominators = {'audio': enumerated_denominator(['skill-sound-row:0', 'skill-sound-row:1'])}
        census_rows = census_by_key(build_gap_census(denominators, derived_part_rows(denominators, source_rows, set()), set(), {}))
        self.assertEqual([(census_rows[key]['status'], census_rows[key]['reason']) for key in ('skill-sound-row:0', 'skill-sound-row:1')],
                         [('pending', 'step-pending:skill-sounds'), ('gap', 'sound-identity-unresolved')])
        self.assertEqual(source_rows[0]['evidence'], 'docs/parts/npcs/actor-unit-census.json')


class CommittedDerivedDenominatorTests(unittest.TestCase):
    def test_movement_geodata_counts_the_locked_tiles_and_the_sandbox_states_why_it_has_no_count(self):
        denominators = load_census_denominators(['world', 'data-ui'])
        self.assertEqual(denominators['movement-geodata']['count'], 153)
        self.assertTrue(all(key.startswith('tile-collision:') for key in denominators['movement-geodata']['keys']))
        self.assertEqual(denominators['sandbox'], {'count': 'unknown', 'keys': None,
                                                   'source': 'the sandbox is the checking tool and has no key space (Phase 3 P15)'})

    def test_the_audio_denominator_sums_its_three_committed_sources(self):
        if not (ROOT / 'artifacts' / 'lane-store' / 'data-ui' / 'l2' / 'catalog.json').is_file():
            self.skipTest('the audio denominator reads the decoded npcgrp table of the data-ui lane store')
        audio = load_census_denominators(['actors'])['audio']
        kinds = [key.split(':', 1)[0] for key in audio['keys']]
        self.assertEqual((kinds.count('tile-audio'), kinds.count('skill-sound-row')), (153, 1398))
        self.assertEqual(audio['count'], len(audio['keys']))
        self.assertLessEqual(kinds.count('npc-sounds'), 6519)
        for source in ('recipes/reference-client-tree.lock.json', 'system/npcgrp.dat', 'docs/parts/npcs/actor-unit-census.json skill-sound-row'):
            self.assertIn(source, audio['source'])


def skills_coverage_row(key, status, reason, converted):
    return {'key': key, 'part': 'skills-effects', 'status': status, 'reason': reason, 'converted': converted,
            'loads': 'pass' if converted else 'unverified', 'steps': [{'step': 'skills', 'status': status, 'reason': reason}]}


class NamedEmitterGapReportTests(unittest.TestCase):
    def test_converted_named_emitter_gaps_count_as_gap_and_are_listed_per_part_and_reason(self):
        rows = [skills_coverage_row('skill:1011:1', 'gap', 'emitter-class-unported:Engine.BeamEmitter', True),
                skills_coverage_row('skill:1011:2', 'gap', 'emitter-class-unported:Engine.BeamEmitter', True),
                skills_coverage_row('skill:1012:1', 'gap', 'emitter-feature-unported:UseMeshBlendMode', True),
                skills_coverage_row('skill:1013:1', 'gap', 'converter-refused:FormatError', False),
                skills_coverage_row('skill:3:1', 'pass', None, True)]
        report = {'schemaVersion': 1, 'catalogSha256': 'a' * 64, 'storeRoot': 'artifacts/lane-store/integration/l2',
                  'generatedAtRiga': GENERATED_AT_RIGA, 'denominators': {'skills-effects': {'count': 5, 'source': 'synthetic committed count'}},
                  'parts': {'skills-effects': count_part_rows(rows, 5)}, 'rows': rows}
        self.assertEqual(validate_coverage_report(report), report)
        counts = report['parts']['skills-effects']
        self.assertEqual((counts['converted'], counts['gap'], counts['pending'], counts['loads']['pass']), (1, 4, 0, 4))
        markdown = coverage_markdown(report)
        self.assertIn('- skills-effects: `emitter-class-unported:Engine.BeamEmitter` 2, `emitter-feature-unported:UseMeshBlendMode` 1\n', markdown)
        self.assertNotIn('converter-refused:FormatError`', markdown)

    def test_a_report_without_named_emitter_gaps_has_no_named_gap_line(self):
        rows = [skills_coverage_row('skill:3:1', 'pass', None, True)]
        report = {'schemaVersion': 1, 'catalogSha256': 'a' * 64, 'storeRoot': 'artifacts/lane-store/integration/l2',
                  'generatedAtRiga': GENERATED_AT_RIGA, 'denominators': {'skills-effects': {'count': 1, 'source': 'synthetic committed count'}},
                  'parts': {'skills-effects': count_part_rows(rows, 1)}, 'rows': rows}
        self.assertNotIn('named emitter gap', coverage_markdown(report))


if __name__ == '__main__':
    unittest.main()
