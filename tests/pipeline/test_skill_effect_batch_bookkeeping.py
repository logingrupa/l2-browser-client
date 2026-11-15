import hashlib
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

from actors import skill_effect_conversion
from actors.npc_store_records import file_output_record
from actors.skill_binding_table import skill_bindings_by_visual_root
from actors.skill_effect_conversion import (ROOT_OUTCOME_RECORD_NAME, STAGED_EFFECTS_FOLDER, STAGED_MANIFEST_NAME, convert_skill,
                                            convert_skill_batch_slice)
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_index_keys import SKILL_EFFECT_COMPONENT_ID_PATTERN
from native_store.gap_rows import gap_reason_list_versions
from native_store.store_paths import lane_gap_rows_path
from test_skill_effect_root_outcomes import INPUT_RECORDS, SIMULATED_WITH_RIBBON, SyntheticSkillEffectRun, staged_component

TWO_LEVEL_ROOT, ONE_LEVEL_ROOT, UNSEALED_ROOT = 'skill.wh.1011', 'skill.wh.1012', 'skill.wh.1014'
TWO_LEVEL_ROOT_MANIFEST_SHA256, ONE_LEVEL_ROOT_MANIFEST_SHA256 = 'e' * 64, 'f' * 64
SKILL_TABLE_IDENTITY = {'path': 'system/skillgrp.dat', 'sha256': 'a' * 64}
SKILL_BINDING_CENSUS_RELATIVE_PATH = 'docs/parts/skills-effects/skill-binding-census.json'
UNQUALIFIED_REFERENCE_REASON = 'skill-visual-reference-unqualified'


def visual_root_binding(skill_id, level, visual_root):
    return {'key': f'skill:{skill_id}:{level}', 'skillId': skill_id, 'level': level, 'status': 'visual-root', 'visualRoot': visual_root,
            'soundRowOrdinal': 1, 'soundReason': None, 'reason': None}


BINDING_GAP_ROW = {'key': 'skill:1013:1', 'skillId': 1013, 'level': 1, 'status': 'gap', 'visualRoot': None, 'soundRowOrdinal': 1,
                   'soundReason': None, 'reason': UNQUALIFIED_REFERENCE_REASON}
BINDING_ROWS = [visual_root_binding(1011, 1, TWO_LEVEL_ROOT), visual_root_binding(1011, 2, TWO_LEVEL_ROOT),
                visual_root_binding(1012, 1, ONE_LEVEL_ROOT), BINDING_GAP_ROW, visual_root_binding(1014, 1, UNSEALED_ROOT)]


def effect_component_record(skill_id, level, visual_root, manifest_sha256):
    return {'id': f'interlude:skill:{skill_id}:level:{level}:native-description-action', 'bundleId': f'interlude:skill-root:{visual_root}',
            'manifest': f'/l2/effects/{manifest_sha256}/manifest.json', 'manifestSha256': manifest_sha256}


EXPECTED_EFFECT_COMPONENT_RECORDS = [effect_component_record(1011, 1, TWO_LEVEL_ROOT, TWO_LEVEL_ROOT_MANIFEST_SHA256),
                                     effect_component_record(1011, 2, TWO_LEVEL_ROOT, TWO_LEVEL_ROOT_MANIFEST_SHA256),
                                     effect_component_record(1012, 1, ONE_LEVEL_ROOT, ONE_LEVEL_ROOT_MANIFEST_SHA256)]


def receipt_evidence(visual_root):
    return f'work/skill-root__{visual_root}/skill-effect-root/receipt.json'


def expected_gap_row(key, status, reason, evidence):
    return {'key': key, 'part': 'skills-effects', 'step': 'skills', 'status': status, 'reason': reason,
            'sourceIdentity': SKILL_TABLE_IDENTITY, 'evidence': evidence}


def expected_gap_row_document():
    return {'schemaVersion': 1, 'lane': 'actors', 'step': 'skills', 'reasonListVersions': gap_reason_list_versions(), 'rows': [
        expected_gap_row('skill:1011:1', 'pass', None, receipt_evidence(TWO_LEVEL_ROOT)),
        expected_gap_row('skill:1011:2', 'pass', None, receipt_evidence(TWO_LEVEL_ROOT)),
        expected_gap_row('skill:1012:1', 'pass', None, receipt_evidence(ONE_LEVEL_ROOT)),
        expected_gap_row('skill:1013:1', 'gap', UNQUALIFIED_REFERENCE_REASON, SKILL_BINDING_CENSUS_RELATIVE_PATH),
        expected_gap_row('skill:1014:1', 'pending', 'conversion-pending', SKILL_BINDING_CENSUS_RELATIVE_PATH)]}


def staged_manifest_bytes(visual_root):
    return canonical_json_bytes({'components': [staged_component(f'{visual_root}.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'})]})


class BatchSkillEffectRun(SyntheticSkillEffectRun):
    def __init__(self, project_root):
        super().__init__(project_root, SIMULATED_WITH_RIBBON)
        self.bindings_by_root = skill_bindings_by_visual_root(BINDING_ROWS)
        self.tables = SimpleNamespace(binding_rows=BINDING_ROWS, skill_table_identity=SKILL_TABLE_IDENTITY)

    def seal_converted_root_with_manifest(self, visual_root, manifest_sha256):
        unit_key, _, config, fingerprint = self.root_work(visual_root)
        step_directory = self.ledger.begin(unit_key, fingerprint)
        manifest_path = step_directory / STAGED_EFFECTS_FOLDER / manifest_sha256 / STAGED_MANIFEST_NAME
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_bytes(staged_manifest_bytes(visual_root))
        outcome_path = step_directory / ROOT_OUTCOME_RECORD_NAME
        outcome_path.write_bytes(canonical_json_bytes({'status': 'converted', 'reason': None, 'emitterClasses': ['Engine.SpriteEmitter'],
                                                       'manifestSha256': manifest_sha256}))
        outputs = [file_output_record(self.ledger.lane_folder, path) for path in (outcome_path, manifest_path)]
        self.ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': INPUT_RECORDS, 'outputs': outputs, 'gapRows': []})


class SkillEffectBatchBookkeepingTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.run = BatchSkillEffectRun(self.project_root)
        self.catalog_path = self.run.store_root / 'catalog.json'
        patcher = mock.patch.object(skill_effect_conversion, 'merge_catalog_slice_records',
                                    wraps=skill_effect_conversion.merge_catalog_slice_records)
        self.merge_catalog_slice_records = patcher.start()
        self.addCleanup(patcher.stop)

    def seal_both_converted_roots(self):
        self.run.seal_converted_root_with_manifest(ONE_LEVEL_ROOT, ONE_LEVEL_ROOT_MANIFEST_SHA256)
        self.run.seal_converted_root_with_manifest(TWO_LEVEL_ROOT, TWO_LEVEL_ROOT_MANIFEST_SHA256)

    def test_one_finish_writes_the_catalog_and_the_gap_rows_with_the_expected_bytes(self):
        self.seal_both_converted_roots()
        report = self.run.finish()
        self.assertEqual(report['gapRowStatuses'], {'gap': 1, 'pass': 3, 'pending': 1})
        self.assertEqual(self.catalog_path.read_bytes(),
                         json_bytes({'schemaVersion': 1, 'models': [], 'effectComponents': EXPECTED_EFFECT_COMPONENT_RECORDS}))
        self.assertEqual(lane_gap_rows_path(self.project_root, 'actors', 'skills').read_bytes(), canonical_json_bytes(expected_gap_row_document()))
        for visual_root, manifest_sha256 in ((TWO_LEVEL_ROOT, TWO_LEVEL_ROOT_MANIFEST_SHA256), (ONE_LEVEL_ROOT, ONE_LEVEL_ROOT_MANIFEST_SHA256)):
            self.assertEqual((self.run.store_root / 'effects' / manifest_sha256 / 'manifest.json').read_bytes(), staged_manifest_bytes(visual_root))

    def test_the_records_of_every_converted_root_reach_the_catalog_through_one_merge(self):
        self.seal_both_converted_roots()
        self.run.finish()
        [merge_call] = self.merge_catalog_slice_records.call_args_list
        self.assertEqual(merge_call.args[1:], ('effectComponents', EXPECTED_EFFECT_COMPONENT_RECORDS, len(BINDING_ROWS)))

    def test_a_run_without_a_converted_root_makes_no_merge(self):
        self.run.finish()
        self.assertEqual(self.merge_catalog_slice_records.call_count, 0)
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes({'schemaVersion': 1, 'models': [], 'effectComponents': []}))


FIRST_CLASS, SECOND_CLASS, NOTIFY_CLASS = 'LineageEffect.s_u010_a', 'LineageEffect.s_u010_b', 'LineageEffect.mb_valakas_trample_ca'
CLASS_PACKAGE_SHA256 = 'd' * 64


def candidate_class_record(effect_object):
    return {'effectObject': effect_object, 'packageSha256': CLASS_PACKAGE_SHA256, 'nativeSuperClass': 'Engine.Emitter'}


def candidate_binding(index, effect_object):
    return {'index': index, 'stage': 'init', 'skillId': 1, 'levelRuns': [[1, 2]], 'dispatchKind': 'selector-table', 'caseIndex': 0,
            'caseVA': '0x104f3bec', 'entryGate': 'none', 'effectObject': effect_object}


CANDIDATE_DOCUMENT = {
    'classes': [candidate_class_record(FIRST_CLASS), candidate_class_record(SECOND_CLASS)],
    'bindings': [candidate_binding(0, SECOND_CLASS), candidate_binding(1, FIRST_CLASS)],
    'animationNotify': {'classes': [candidate_class_record(NOTIFY_CLASS)],
                        'bindings': [{'skillId': 4681, 'level': 1, 'routes': [{'npcId': 29028, 'sequence': 'atk01',
                                                                               'effects': [{'effectObject': NOTIFY_CLASS}]}]}]}}
DISPATCH_CANDIDATE_ENTRIES = [{'stage': 'init', 'case': {'dispatchKind': 'selector-table', 'caseIndex': 0, 'caseVA': '0x104f3bec'},
                               'candidateClasses': [FIRST_CLASS, SECOND_CLASS], 'entryGate': 'none'}]


def candidate_binding_row(skill_id, level, status, sound_row_ordinal, entries):
    return {'key': f'skill:{skill_id}:{level}', 'skillId': skill_id, 'level': level, 'status': status, 'visualRoot': None,
            'dispatchCandidates': entries, 'soundRowOrdinal': sound_row_ordinal, 'soundReason': None, 'reason': None}


CANDIDATE_BINDING_ROWS = [candidate_binding_row(1, 1, 'reviewed-native-dispatch-candidates', None, DISPATCH_CANDIDATE_ENTRIES),
                          candidate_binding_row(1, 2, 'reviewed-native-dispatch-candidates', 7, DISPATCH_CANDIDATE_ENTRIES),
                          candidate_binding_row(4681, 1, 'reviewed-animation-notify-candidates', None,
                                                [{'stage': 'animation-notify', 'candidateClasses': [NOTIFY_CLASS]}])]


def fake_manifest_sha256(recipe):
    return hashlib.sha256(recipe['id'].encode()).hexdigest()


class CandidateClassSkillEffectRun(SyntheticSkillEffectRun):
    def __init__(self, project_root):
        super().__init__(project_root, SIMULATED_WITH_RIBBON, CANDIDATE_DOCUMENT, BINDING_ROWS + CANDIDATE_BINDING_ROWS)
        self.bindings_by_root = skill_bindings_by_visual_root(BINDING_ROWS)
        self.tables = SimpleNamespace(binding_rows=BINDING_ROWS + CANDIDATE_BINDING_ROWS, skill_table_identity=SKILL_TABLE_IDENTITY)
        self.migrated_recipes = []

    def migrated_bundle_outcome(self, recipe, closure_item, closure_of, step_directory):
        self.migrated_recipes.append(recipe)
        manifest_sha256 = fake_manifest_sha256(recipe)
        manifest_path = step_directory / STAGED_EFFECTS_FOLDER / manifest_sha256 / STAGED_MANIFEST_NAME
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_bytes(staged_manifest_bytes(closure_item))
        return {'status': 'converted', 'reason': None, 'emitterClasses': ['Engine.SpriteEmitter'], 'manifestSha256': manifest_sha256}


class SkillDispatchClassUnitTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.run = CandidateClassSkillEffectRun(self.project_root)

    def test_a_class_unit_pins_only_its_class_and_converts_from_the_lowest_candidate_row_with_an_exact_sound_row(self):
        unit_key, representative, config, _ = self.run.dispatch_classes.class_work(FIRST_CLASS)
        self.assertEqual((unit_key, representative['key']), ('skill-dispatch-class:LineageEffect.s_u010_a', 'skill:1:2'))
        self.assertEqual(set(config), {'effectObject', 'packageSha256', 'representativeKey', 'tools'})
        self.assertEqual(set(self.run.root_work(TWO_LEVEL_ROOT)[2]), {'visualRoot', 'representativeKey', 'tools'})
        self.run.dispatch_classes.convert_class(FIRST_CLASS)
        self.assertEqual(self.run.migrated_recipes, [{'schemaVersion': 1, 'id': 'interlude:skill-dispatch-class:LineageEffect.s_u010_a',
                                                      'skillId': 1, 'level': 2,
                                                      'effectClasses': [{'object': FIRST_CLASS, 'packageSha256': CLASS_PACKAGE_SHA256}]}])

    def test_a_class_whose_rows_have_no_exact_sound_row_seals_as_a_no_exact_skillsound_row_gap(self):
        outcome = self.run.dispatch_classes.convert_class(NOTIFY_CLASS)
        self.assertEqual((outcome['status'], outcome['reason']), ('gap', 'no-exact-skillsound-row'))
        self.assertEqual(self.run.migrated_recipes, [])
        self.assertTrue(self.run.dispatch_classes.is_sealed(NOTIFY_CLASS))

    def test_a_candidate_row_converts_each_of_its_classes_once_and_a_second_cast_only_skips(self):
        outcomes, _ = convert_skill(self.run, 1, 1)
        self.assertEqual([(outcome['key'], outcome['status']) for outcome in outcomes],
                         [('skill-dispatch-class:LineageEffect.s_u010_a', 'converted'), ('skill-dispatch-class:LineageEffect.s_u010_b', 'converted')])
        outcomes, _ = convert_skill(self.run, 1, 2)
        self.assertEqual([outcome['status'] for outcome in outcomes], ['skipped', 'skipped'])
        self.assertEqual(len(self.run.migrated_recipes), 2)

    def test_the_batch_converts_pending_roots_then_classes_in_first_row_order_counted_against_the_limit(self):
        outcomes, summary = convert_skill_batch_slice(self.run, 4, lambda: None)
        self.assertEqual([outcome['key'] for outcome in outcomes], ['skill-root:skill.wh.1011', 'skill-root:skill.wh.1012',
                                                                   'skill-root:skill.wh.1014', 'skill-dispatch-class:LineageEffect.s_u010_a'])
        self.assertEqual((summary['convertedRoots'], summary['convertedDispatchClasses']), (3, 1))
        _, summary = convert_skill_batch_slice(self.run, 10, lambda: None)
        self.assertEqual((summary['alreadySealedRoots'], summary['alreadySealedDispatchClasses'], summary['convertedDispatchClasses']), (3, 1, 2))

    def test_converted_classes_add_one_shared_record_each_that_no_skill_lookup_reads_and_candidate_rows_stay_gaps(self):
        convert_skill_batch_slice(self.run, 10, lambda: None)
        catalog = json.loads(self.catalog_bytes())
        class_records = [record for record in catalog['effectComponents'] if record['id'].startswith('interlude:skill-dispatch-class:')]
        self.assertEqual([record['id'] for record in class_records], ['interlude:skill-dispatch-class:LineageEffect.s_u010_a',
                                                                      'interlude:skill-dispatch-class:LineageEffect.s_u010_b'])
        self.assertTrue(all(record['bundleId'] == record['id'] for record in class_records))
        self.assertFalse(any(SKILL_EFFECT_COMPONENT_ID_PATTERN.match(record['id']) for record in class_records))
        rows = json.loads(lane_gap_rows_path(self.project_root, 'actors', 'skills').read_bytes())['rows']
        candidate_rows = {row['key']: (row['status'], row['reason']) for row in rows if row['key'] in ('skill:1:1', 'skill:1:2', 'skill:4681:1')}
        self.assertEqual(set(candidate_rows.values()), {('gap', 'skill-dispatch-candidate-runtime-unresolved')})

    def catalog_bytes(self):
        return (self.run.store_root / 'catalog.json').read_bytes()


if __name__ == '__main__':
    unittest.main()
