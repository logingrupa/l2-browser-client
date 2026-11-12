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
from actors.skill_effect_conversion import ROOT_OUTCOME_RECORD_NAME, STAGED_EFFECTS_FOLDER, STAGED_MANIFEST_NAME
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
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


if __name__ == '__main__':
    unittest.main()
