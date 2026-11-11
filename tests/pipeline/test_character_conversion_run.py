import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import character_conversion
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, CHARGRP_ROW_UNIT_KIND, CONVERTIBLE_UNIT_STATUS
from actors.character_census import CONVERTED_STATUS, PENDING_STATUS, character_census, run_character_batch
from actors.character_conversion import CHARACTER_MODEL_ID_PREFIX, PADDING_STATUS, CharacterConversionRun
from actors.character_requests import GAP_STATUS
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX
from catalog_store_fixture import model_record
from native_store.catalog_writer import read_store_catalog
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from test_character_requests import character_sources, synthetic_chargrp_row

FIRST_CONVERTER_SHA256 = 'e' * 64
CHANGED_CONVERTER_SHA256 = 'f' * 64
CHARACTER_ROW_INDEXES = (1, 2, 3)
SYNTHETIC_REFUSAL = 'synthetic converter refusal'


def padding_chargrp_row():
    return {**synthetic_chargrp_row(), 'body_mesh': {'body_mesh1': ''}}


class SyntheticCharacterRun(CharacterConversionRun):
    def __init__(self, project_root, client_root, refusal=None):
        client_access = SimpleNamespace(root=Path(client_root), lock=SimpleNamespace(records_by_path={}))
        converter = SimpleNamespace(output=Path(client_root).parent / 'converter-output')
        sources = character_sources([padding_chargrp_row()] + [synthetic_chargrp_row() for _ in CHARACTER_ROW_INDEXES])
        super().__init__(project_root, client_access, converter, lane_work_root(project_root, 'actors'),
                         lane_store_root(project_root, 'actors'), sources)
        self.refusal, self.converted_rows = refusal, []
        self.converted_archive = Path(client_root).parent / 'converted.l2asset'
        self.converted_archive.write_bytes(b'synthetic converted archive')

    def converted_model_reason(self, request):
        self.converted_rows.append(request['parts'][0]['sourceBinding']['meshPath'][1])
        if self.refusal:
            return CONVERTER_REFUSED_REASON_PREFIX + self.refusal, None
        return None, {'file': self.converted_archive}


def synthetic_model_store_files_and_record(record_id, archive_path):
    return {}, model_record(record_id, 'Fighter.Body_m001_1')


class CharacterConversionRunTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        self.project_root, self.client_root = temporary_root / 'project', temporary_root / 'client'
        (self.project_root / 'artifacts').mkdir(parents=True)
        census_path = self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH
        census_path.parent.mkdir(parents=True)
        census_path.write_text(json.dumps({'units': [
            {'key': f'character:{row_index}', 'reason': None, 'unitKind': CHARGRP_ROW_UNIT_KIND, 'status': CONVERTIBLE_UNIT_STATUS}
            for row_index in CHARACTER_ROW_INDEXES]}))
        model_store_patch = mock.patch.object(character_conversion, 'converted_model_store_files_and_record',
                                              side_effect=synthetic_model_store_files_and_record)
        model_store_patch.start()
        self.addCleanup(model_store_patch.stop)

    def converted_outcomes(self, converter_sha256, row_indexes, refusal=None):
        run = SyntheticCharacterRun(self.project_root, self.client_root, refusal)
        with mock.patch.object(character_conversion, 'implementation_hash', return_value=converter_sha256):
            return [run.convert(row_index) for row_index in row_indexes]

    def census_with(self, converter_sha256):
        run = SyntheticCharacterRun(self.project_root, self.client_root)
        with mock.patch.object(character_conversion, 'implementation_hash', return_value=converter_sha256):
            return character_census(run)

    def catalog_model_ids(self):
        catalog, _ = read_store_catalog(lane_store_root(self.project_root, 'actors'))
        return [record['id'] for record in catalog['models']]

    def test_a_row_reconverted_into_a_model_gap_loses_its_catalog_model_record(self):
        self.converted_outcomes(FIRST_CONVERTER_SHA256, [1])
        self.assertEqual(self.catalog_model_ids(), [CHARACTER_MODEL_ID_PREFIX + '1'])
        [outcome] = self.converted_outcomes(CHANGED_CONVERTER_SHA256, [1], SYNTHETIC_REFUSAL)
        self.assertEqual((outcome['outputs'], outcome['reason']), ([], CONVERTER_REFUSED_REASON_PREFIX + SYNTHETIC_REFUSAL))
        self.assertEqual(self.catalog_model_ids(), [])

    def test_the_census_reports_rows_sealed_under_an_older_converter_as_pending(self):
        self.converted_outcomes(FIRST_CONVERTER_SHA256, CHARACTER_ROW_INDEXES)
        run = SyntheticCharacterRun(self.project_root, self.client_root)
        with mock.patch.object(character_conversion, 'implementation_hash', return_value=CHANGED_CONVERTER_SHA256):
            run_character_batch(run, 1, lambda: None)
            census = character_census(run)
        self.assertEqual([row['model'] for row in census['rows']], [None, 'converted', PENDING_STATUS, PENDING_STATUS])
        self.assertEqual((census['counts']['modelsConverted'], census['counts']['pendingKeys']), (1, 2))


    def test_an_unchanged_row_is_a_cache_hit_that_keeps_its_model_record_without_converting_again(self):
        self.converted_outcomes(FIRST_CONVERTER_SHA256, [1])
        run = SyntheticCharacterRun(self.project_root, self.client_root)
        with mock.patch.object(character_conversion, 'implementation_hash', return_value=FIRST_CONVERTER_SHA256):
            outcome = run.convert(1)
        self.assertEqual((outcome['cacheHit'], len(outcome['outputs']), run.converted_rows), (True, 1, []))
        self.assertEqual(self.catalog_model_ids(), [CHARACTER_MODEL_ID_PREFIX + '1'])

    def test_a_refused_conversion_seals_a_model_gap_row_and_writes_no_model_record(self):
        [outcome] = self.converted_outcomes(FIRST_CONVERTER_SHA256, [2], SYNTHETIC_REFUSAL)
        self.assertEqual((outcome['status'], outcome['cacheHit'], outcome['outputs']), (GAP_STATUS, False, []))
        self.assertEqual([(row['key'], row['reason']) for row in read_gap_rows(self.project_root, 'actors')],
                         [('character:2', CONVERTER_REFUSED_REASON_PREFIX + SYNTHETIC_REFUSAL)])
        self.assertEqual(self.catalog_model_ids(), [])

    def test_a_padding_row_is_never_converted_or_sealed(self):
        [outcome] = self.converted_outcomes(FIRST_CONVERTER_SHA256, [0])
        self.assertEqual((outcome['key'], outcome['status'], outcome['outputs']), (None, PADDING_STATUS, []))
        self.assertEqual(self.census_with(FIRST_CONVERTER_SHA256)['rows'][0]['padding'], True)

    def test_the_batch_stops_at_its_limit_counting_only_rows_it_converted(self):
        run, preflights = SyntheticCharacterRun(self.project_root, self.client_root), []
        with mock.patch.object(character_conversion, 'implementation_hash', return_value=FIRST_CONVERTER_SHA256):
            first_batch = run_character_batch(run, 2, lambda: preflights.append('first'))
            second_batch = run_character_batch(run, 2, lambda: preflights.append('second'))
        self.assertEqual([(outcome['chargrpIndex'], outcome['cacheHit']) for outcome in first_batch], [(0, False), (1, False), (2, False)])
        self.assertEqual([(outcome['chargrpIndex'], outcome['cacheHit']) for outcome in second_batch], [(0, False), (1, True), (2, True), (3, False)])
        self.assertEqual((run.converted_rows, preflights), ([1, 2, 3], ['first'] * 3 + ['second'] * 4))

    def test_the_census_counts_converted_gap_pending_and_padding_rows(self):
        self.converted_outcomes(FIRST_CONVERTER_SHA256, [1])
        self.converted_outcomes(FIRST_CONVERTER_SHA256, [2], SYNTHETIC_REFUSAL)
        census = self.census_with(FIRST_CONVERTER_SHA256)
        self.assertEqual([row['model'] for row in census['rows']], [None, CONVERTED_STATUS, GAP_STATUS, PENDING_STATUS])
        self.assertEqual(census['counts'], {'rows': 4, 'padding': 1, 'characters': 3, 'modelsConverted': 1, 'profilesWritten': 0,
                                            'gapKeys': 2, 'pendingKeys': 1})


if __name__ == '__main__':
    unittest.main()
