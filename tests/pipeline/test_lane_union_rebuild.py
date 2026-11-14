import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_index_keys import character_model_record_id
from native_store.catalog_writer import CatalogWriteError, add_store_file, merge_catalog_slice, read_store_catalog, write_store
from native_store.gap_rows import write_gap_rows
from native_store.store_paths import lane_store_root
from native_store.write_lane_catalog import LaneCatalogError, write_lane_catalog
from test_lane_catalog_writer import (GOLDEN_CATALOG_BYTES, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES, MODEL_VERSION_ONE_RECORD,
                                      MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES, MODEL_VERSION_TWO_RECORD, snapshot_tree)

RESEALED_MODEL_VERSION_ONE_RECORD = dict(MODEL_VERSION_ONE_RECORD, source={'object': 'SyntheticFixture.ResealedSource'})
DISAGREEING_MODEL_VERSION_TWO_RECORD = dict(MODEL_VERSION_TWO_RECORD, source={'object': 'SyntheticFixture.DisagreeingSource'})
UNION_LANE_NAMES = ('world', 'actors')
GAPPED_CHARACTER_INDEX = 8
GAPPED_CHARACTER_KEY = f'character:{GAPPED_CHARACTER_INDEX}'
GAPPED_CHARACTER_RECORD = dict(MODEL_VERSION_ONE_RECORD, id=character_model_record_id(GAPPED_CHARACTER_INDEX))
CHARACTER_REFUSAL_REASON = 'converter-refused:Rigid attachment requires one verified root-only rigid skin'
CHARGRP_SOURCE_IDENTITY = {'path': 'system/chargrp.dat', 'sha256': 'c' * 64}


def character_gap_row(step, status, reason):
    return {'key': GAPPED_CHARACTER_KEY, 'part': 'player-characters', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': CHARGRP_SOURCE_IDENTITY, 'evidence': 'docs/parts/player-characters/EVIDENCE.md'}


class LaneUnionRebuildTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        (self.project / 'public' / 'l2').mkdir(parents=True)
        (self.project / 'public' / 'l2' / 'catalog.json').write_bytes(GOLDEN_CATALOG_BYTES)
        self.world_store = lane_store_root(self.project, 'world')
        self.actors_store = lane_store_root(self.project, 'actors')
        self.integration_store = lane_store_root(self.project, 'integration')
        self.stage_model(self.world_store, MODEL_VERSION_TWO_RECORD, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        self.stage_model(self.actors_store, MODEL_VERSION_ONE_RECORD, MODEL_VERSION_ONE_ARCHIVE, MODEL_VERSION_ONE_BYTES)
        write_lane_catalog(self.project, 'world')
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)

    def stage_model(self, store_root, record, relative, payload):
        catalog, before = read_store_catalog(store_root)
        files = {}
        add_store_file(files, relative, payload)
        write_store(store_root, files, before, json_bytes(merge_catalog_slice(catalog, 'models', record, 4)))

    def replace_lane_catalog(self, store_root, **fields):
        catalog, before = read_store_catalog(store_root)
        write_store(store_root, {}, before, json_bytes(dict(catalog, **fields)))

    def integration_models(self):
        return json.loads((self.integration_store / 'catalog.json').read_bytes())['models']

    def union_a_converted_character_then_gap_it_in_the_actors_lane(self, gap_row):
        self.replace_lane_catalog(self.actors_store, models=[MODEL_VERSION_ONE_RECORD, GAPPED_CHARACTER_RECORD])
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.replace_lane_catalog(self.actors_store, models=[MODEL_VERSION_ONE_RECORD])
        write_lane_catalog(self.project, 'actors')
        write_gap_rows(self.project, 'actors', gap_row['step'], [gap_row])

    def test_a_resealed_lane_record_replaces_the_earlier_union_record(self):
        self.replace_lane_catalog(self.actors_store, models=[RESEALED_MODEL_VERSION_ONE_RECORD])
        write_lane_catalog(self.project, 'actors')
        rebuilt = write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(self.integration_models(), [MODEL_VERSION_TWO_RECORD, RESEALED_MODEL_VERSION_ONE_RECORD])
        self.assertEqual((rebuilt['filesWritten'], rebuilt['recordsBySlice'], rebuilt['retiredRecords']), (1, {'models': 2}, []))

    def test_two_union_lanes_disagreeing_on_one_record_are_refused_naming_both_lanes_before_any_write(self):
        self.stage_model(self.actors_store, DISAGREEING_MODEL_VERSION_TWO_RECORD, MODEL_VERSION_TWO_ARCHIVE, MODEL_VERSION_TWO_BYTES)
        write_lane_catalog(self.project, 'actors')
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, f'^catalog models record {MODEL_VERSION_TWO_RECORD["id"]} differs between union lanes '
                                                      'world and actors; preserved$'):
            write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_earlier_union_record_whose_unit_the_owning_lane_gapped_is_retired_and_reported(self):
        gap_row = character_gap_row('characters', 'gap', CHARACTER_REFUSAL_REASON)
        self.union_a_converted_character_then_gap_it_in_the_actors_lane(gap_row)
        self.assertEqual(len(self.integration_models()), 3)
        rebuilt = write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(self.integration_models(), [MODEL_VERSION_TWO_RECORD, MODEL_VERSION_ONE_RECORD])
        self.assertEqual(rebuilt['retiredRecords'], [{'slice': 'models', 'id': GAPPED_CHARACTER_RECORD['id'], 'unitKey': GAPPED_CHARACTER_KEY,
                                                      'lane': 'actors', 'step': 'characters', 'status': 'gap',
                                                      'reason': CHARACTER_REFUSAL_REASON}])

    def test_an_earlier_union_record_whose_unit_the_owning_lane_records_as_failed_is_retired(self):
        self.union_a_converted_character_then_gap_it_in_the_actors_lane(character_gap_row('characters', 'failed', CHARACTER_REFUSAL_REASON))
        rebuilt = write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual([(record['id'], record['status']) for record in rebuilt['retiredRecords']],
                         [(GAPPED_CHARACTER_RECORD['id'], 'failed')])

    def test_an_earlier_union_record_whose_unit_is_only_pending_is_refused_before_any_write(self):
        self.union_a_converted_character_then_gap_it_in_the_actors_lane(character_gap_row('census', 'pending', 'conversion-pending'))
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, f'^lane integration catalog models record {GAPPED_CHARACTER_RECORD["id"]} is owned by '
                                                      'no union lane, and no union lane gap or failed row explains its unit '
                                                      f'{GAPPED_CHARACTER_KEY}; preserved$'):
            write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_earlier_union_record_no_union_lane_owns_or_gaps_is_refused_before_any_write(self):
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(LaneCatalogError, f'^lane integration catalog models record {MODEL_VERSION_ONE_RECORD["id"]} '
                                                      'is owned by no union lane, and no union lane gap or failed row explains it, '
                                                      'as its id maps to no unit key; preserved$'):
            write_lane_catalog(self.project, 'integration', ('world',))
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_unknown_field_in_the_earlier_union_catalog_is_refused_instead_of_dropped(self):
        for unknown_field, value in (('futureSlice', []), ('generatedAt', '2026-11-14')):
            with self.subTest(unknown_field=unknown_field):
                self.replace_lane_catalog(self.integration_store, **{unknown_field: value})
                snapshot = snapshot_tree(self.project)
                with self.assertRaisesRegex(LaneCatalogError, f'^lane integration catalog holds unknown fields {unknown_field}; preserved$'):
                    write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
                self.assertEqual(snapshot_tree(self.project), snapshot)
                catalog, before = read_store_catalog(self.integration_store)
                del catalog[unknown_field]
                write_store(self.integration_store, {}, before, json_bytes(catalog))

    def test_an_input_lane_missing_a_pinned_file_is_refused_before_any_write(self):
        (self.actors_store / MODEL_VERSION_ONE_ARCHIVE).unlink()
        snapshot = snapshot_tree(self.project)
        with self.assertRaisesRegex(CatalogWriteError, f'^pinned store file is missing from .*: {MODEL_VERSION_ONE_ARCHIVE}$'):
            write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_an_unchanged_union_rebuild_is_byte_identical_and_writes_nothing(self):
        catalog_bytes = (self.integration_store / 'catalog.json').read_bytes()
        snapshot = snapshot_tree(self.project)
        self.assertEqual(write_lane_catalog(self.project, 'integration', UNION_LANE_NAMES)['filesWritten'], 0)
        self.assertEqual((self.integration_store / 'catalog.json').read_bytes(), catalog_bytes)
        self.assertEqual(snapshot_tree(self.project), snapshot)


if __name__ == '__main__':
    unittest.main()
