import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.character_class_sources import (class_default_candidate, class_join_verdict,
                                            chargrp_row_meshes_by_row, pawn_class_ancestries, read_character_class_sources,
                                            table_record_candidates)
from actors.character_requests import (ADOPTED_CLASS_SOURCES_VERDICT as ADOPTED_VERDICT, CHARACTER_CLASS_SOURCES_RELATIVE_PATH,
                                       NOT_DECIDED_CLASS_SOURCES_VERDICT as NOT_DECIDED_VERDICT)

SHA256_PATTERN = re.compile(r'[0-9a-f]{64}')
PAWN_CLASSES = {'LineageWarrior.SyntheticFighter', 'LineageWarrior.SyntheticMystic'}


def synthetic_chargrp_rows():
    return [{'body_mesh': {'body_mesh1': 'Fighter.Fighter_m001_u', 'body_mesh2': 'Fighter.Fighter_m001_l'},
             'face_mesh': [{'param_face_mesh': 'Fighter.Fighter_m000_f'}]},
            {'body_mesh': {'body_mesh1': 'Mystic.Mystic_m005_u'}, 'face_mesh': [{'param_face_mesh': 'Mystic.Mystic_m000_f'}]},
            {'body_mesh': {'body_mesh1': ''}, 'face_mesh': []}]


def class_record(class_name, meshes, head_bone='Bip01_head'):
    return {'class': class_name, 'package': 'system/LineageWarrior.u', 'packageSha256': 'e' * 64, 'headBone': head_bone,
            'headBoneDeclaringClass': 'Engine.Pawn', 'meshes': meshes}


def class_candidates(records):
    meshes_by_row = chargrp_row_meshes_by_row(synthetic_chargrp_rows())
    return [candidate for candidate in (class_default_candidate(record, meshes_by_row) for record in records) if candidate]


class ChargrpRowIdentityTests(unittest.TestCase):
    def test_padding_rows_carry_no_identity_and_body_and_face_meshes_list_per_row(self):
        self.assertEqual(chargrp_row_meshes_by_row(synthetic_chargrp_rows()),
                         {0: ['Fighter.Fighter_m000_f', 'Fighter.Fighter_m001_l', 'Fighter.Fighter_m001_u'],
                          1: ['Mystic.Mystic_m000_f', 'Mystic.Mystic_m005_u']})


class PawnAncestryTests(unittest.TestCase):
    def test_only_classes_below_engine_pawn_count_across_packages_with_their_export_table_ancestry(self):
        packages = [{'classes': {'Engine.Actor': 'Core.Object', 'Engine.Pawn': 'Engine.Actor', 'Engine.Light': 'Engine.Actor'}},
                    {'classes': {'LineageWarrior.LineagePawn': 'Engine.Pawn', 'LineageWarrior.MFighter': 'LineageWarrior.LineagePawn'}}]
        self.assertEqual(pawn_class_ancestries(packages),
                         {'LineageWarrior.LineagePawn': ['engine.pawn', 'engine.actor', 'core.object'],
                          'LineageWarrior.MFighter': ['lineagewarrior.lineagepawn', 'engine.pawn', 'engine.actor', 'core.object']})


class ClassJoinVerdictTests(unittest.TestCase):
    def test_exactly_one_class_per_row_is_adopted_with_the_row_to_class_map(self):
        candidates = class_candidates([class_record('LineageWarrior.SyntheticFighter', ['Fighter.Fighter_m001_u', 'Fighter.Fighter_m000_f']),
                                       class_record('LineageWarrior.SyntheticMystic', ['mystic.mystic_m000_f']),
                                       class_record('LineageWarrior.LineagePawn', [])])
        verdict, rows = class_join_verdict([0, 1], [], candidates)
        self.assertEqual(verdict, ADOPTED_VERDICT)
        self.assertEqual({row: (entry['actorClass'], entry['candidateCount']) for row, entry in rows.items()},
                         {'0': ('LineageWarrior.SyntheticFighter', 1), '1': ('LineageWarrior.SyntheticMystic', 1)})
        self.assertEqual(rows['0']['classPackageSha256'], 'e' * 64)

    def test_two_classes_for_a_row_or_none_is_not_decided_with_candidate_counts(self):
        candidates = class_candidates([class_record('LineageWarrior.SyntheticFighter', ['Fighter.Fighter_m001_u']),
                                       class_record('LineageWarrior.OtherFighter', ['Fighter.Fighter_m001_l'])])
        verdict, rows = class_join_verdict([0, 1], [], candidates)
        self.assertEqual(verdict, NOT_DECIDED_VERDICT)
        self.assertEqual({row: (entry['actorClass'], entry['candidateCount']) for row, entry in rows.items()}, {'0': (None, 2), '1': (None, 0)})
        self.assertEqual(rows['0']['candidateClasses'], ['LineageWarrior.OtherFighter', 'LineageWarrior.SyntheticFighter'])

    def test_one_class_naming_two_rows_decides_neither(self):
        candidates = class_candidates([class_record('LineageWarrior.SharedPawn', ['Fighter.Fighter_m001_u', 'Mystic.Mystic_m000_f'])])
        verdict, rows = class_join_verdict([0, 1], [], candidates)
        self.assertEqual(verdict, NOT_DECIDED_VERDICT)
        self.assertEqual((rows['0']['actorClass'], rows['1']['actorClass']), (None, None))

    def test_a_table_record_naming_another_class_for_the_row_makes_it_ambiguous(self):
        manifest = {'sourceSha256': 'f' * 64,
                    'records': {'class': [{'mesh': 'Fighter.Fighter_m001_u', 'pawn': 'LineageWarrior.SyntheticMystic'},
                                          {'mesh': 'Nothing.Else', 'pawn': 'LineageWarrior.SyntheticFighter'}]}}
        meshes_by_row = chargrp_row_meshes_by_row(synthetic_chargrp_rows())
        table_candidates = table_record_candidates('synthetic-table', manifest, meshes_by_row, PAWN_CLASSES)
        self.assertEqual(table_candidates, [{'table': 'synthetic-table', 'sourceSha256': 'f' * 64, 'recordPath': ['class', 0],
                                             'rowIndexes': [0], 'actorClasses': ['LineageWarrior.SyntheticMystic']}])
        candidates = class_candidates([class_record('LineageWarrior.SyntheticFighter', ['Fighter.Fighter_m001_u']),
                                       class_record('LineageWarrior.SyntheticMystic', ['Mystic.Mystic_m000_f'])])
        verdict, rows = class_join_verdict([0, 1], table_candidates, candidates)
        self.assertEqual((verdict, rows['0']['candidateCount'], rows['1']['actorClass']), (NOT_DECIDED_VERDICT, 2, None))

    def test_a_chargrp_index_field_identifies_a_row_and_a_record_without_a_class_decides_nothing(self):
        manifest = {'sourceSha256': 'f' * 64, 'records': [{'chargrp_index': 1, 'label': 'Mystic'}]}
        candidates = table_record_candidates('synthetic-list', manifest, chargrp_row_meshes_by_row(synthetic_chargrp_rows()), PAWN_CLASSES)
        self.assertEqual(candidates, [{'table': 'synthetic-list', 'sourceSha256': 'f' * 64, 'recordPath': [0], 'rowIndexes': [1], 'actorClasses': []}])
        verdict, rows = class_join_verdict([0, 1], candidates, [])
        self.assertEqual((verdict, rows['1']['candidateCount'], rows['1']['tableRecordsWithoutClass']), (NOT_DECIDED_VERDICT, 0, 1))


class CommittedClassSourcesTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / CHARACTER_CLASS_SOURCES_RELATIVE_PATH
        if not self.path.is_file():
            self.skipTest('the committed class source search result is absent')
        self.document = read_character_class_sources(ROOT)['document']

    def test_the_committed_result_holds_hashes_and_names_only(self):
        def walk(value, key=''):
            if isinstance(value, dict):
                for child_key, child in value.items():
                    self.assertNotIn(child_key.casefold(), {'payloadhex', 'unparsedhex', 'bytes', 'data'})
                    walk(child, child_key)
            elif isinstance(value, list):
                for child in value:
                    walk(child, key)
            elif isinstance(value, str) and key.casefold().endswith('sha256'):
                self.assertRegex(value, SHA256_PATTERN)
            elif isinstance(value, str):
                self.assertLessEqual(len(value), 400)
        walk(self.document)
        self.assertIn(self.document['verdict'], (ADOPTED_VERDICT, NOT_DECIDED_VERDICT))
        self.assertTrue(self.document['sourcesSearched']['tables'] and self.document['sourcesSearched']['scriptPackages'])

    def test_an_adopted_result_maps_every_character_row_to_one_class_and_each_class_to_one_row(self):
        rows = self.document['rows']
        classes = [entry['actorClass'] for entry in rows.values()]
        if self.document['verdict'] == ADOPTED_VERDICT:
            self.assertTrue(all(entry['candidateCount'] == 1 for entry in rows.values()))
            self.assertEqual(len(set(classes)), len(classes))
        else:
            self.assertTrue(any(entry['candidateCount'] != 1 for entry in rows.values()) or len(set(classes)) != len(classes))


if __name__ == '__main__':
    unittest.main()
