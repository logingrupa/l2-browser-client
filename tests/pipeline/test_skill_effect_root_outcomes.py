from pathlib import Path
import sys
from types import SimpleNamespace
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.skill_effect_conversion import (ROOT_OUTCOME_RECORD_NAME, SKILL_EFFECT_ROOT_ALGORITHM_VERSION, SKILL_EFFECT_ROOT_STEP,
                                            STAGED_EFFECTS_FOLDER, STAGED_MANIFEST_NAME, SkillEffectConversionRun)
from actors.npc_store_records import file_output_record
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import STORE_CATALOG_NAME, read_store_catalog
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import UnitLedger

VISUAL_ROOT = 'skill.wh.1011'
STAGED_MANIFEST_SHA256 = 'e' * 64
INPUT_RECORDS = [{'path': 'system/skillgrp.dat', 'sha256': 'a' * 64}]
SIMULATED_BEFORE_RIBBON = frozenset({'Engine.MeshEmitter', 'Engine.SpriteEmitter'})
SIMULATED_WITH_RIBBON = SIMULATED_BEFORE_RIBBON | {'Engine.RibbonEmitter'}


def staged_component(object_name, emitter_class, texture):
    return {'object': object_name, 'class': emitter_class, 'bindings': {'mesh': None, 'texture': texture, 'primitiveMaterials': []}}


class SyntheticSkillEffectRun(SkillEffectConversionRun):
    def __init__(self, project_root, simulated_emitter_classes):
        self.project_root = Path(project_root)
        self.ledger = UnitLedger(lane_work_root(project_root, 'actors'), SKILL_EFFECT_ROOT_STEP, SKILL_EFFECT_ROOT_ALGORITHM_VERSION)
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'actors' / 'l2'
        self.bindings_by_root = {VISUAL_ROOT: [{'key': 'skill:1011:1', 'skillId': 1011, 'level': 1, 'soundRowOrdinal': 1}]}
        self.tables = SimpleNamespace(binding_rows=self.bindings_by_root[VISUAL_ROOT])
        self.simulated_emitter_classes = simulated_emitter_classes
        self.tool_identity = {'converterSha256': 'b' * 64}
        self.input_records = INPUT_RECORDS

    def seal_converted_root(self, components):
        unit_key, _, config, fingerprint = self.root_work(VISUAL_ROOT)
        step_directory = self.ledger.begin(unit_key, fingerprint)
        manifest_path = step_directory / STAGED_EFFECTS_FOLDER / STAGED_MANIFEST_SHA256 / STAGED_MANIFEST_NAME
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_bytes(canonical_json_bytes({'components': components}))
        outcome_path = step_directory / ROOT_OUTCOME_RECORD_NAME
        outcome_path.write_bytes(canonical_json_bytes({'status': 'converted', 'reason': None,
                                                       'emitterClasses': sorted({component['class'] for component in components}),
                                                       'manifestSha256': STAGED_MANIFEST_SHA256}))
        outputs = [file_output_record(self.ledger.lane_folder, path) for path in (outcome_path, manifest_path)]
        self.ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': INPUT_RECORDS, 'outputs': outputs, 'gapRows': []})


class SealedSkillRootOutcomeTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        components = [staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'}),
                      staged_component('fx.a.RibbonEmitter1', 'Engine.RibbonEmitter', None)]
        SyntheticSkillEffectRun(self.project_root, SIMULATED_BEFORE_RIBBON).seal_converted_root(components)

    def test_a_root_sealed_before_its_unbound_class_was_simulated_is_refused_and_not_published_once_it_is(self):
        outcome = SyntheticSkillEffectRun(self.project_root, SIMULATED_WITH_RIBBON).root_outcomes()[VISUAL_ROOT]
        self.assertEqual((outcome['status'], outcome['reason'], outcome['converted']),
                         ('gap', 'converter-refused:fx.a.RibbonEmitter1 has no converted resource', False))

    def test_the_same_seal_stays_an_unported_class_gap_while_its_unbound_class_is_not_simulated(self):
        outcome = SyntheticSkillEffectRun(self.project_root, SIMULATED_BEFORE_RIBBON).root_outcomes()[VISUAL_ROOT]
        self.assertEqual((outcome['status'], outcome['reason'], outcome['converted']),
                         ('gap', 'emitter-class-unported:Engine.RibbonEmitter', True))

    def test_a_rewrite_with_unchanged_outcomes_keeps_the_compact_lane_catalog_bytes_the_other_actor_writers_wrote(self):
        run = SyntheticSkillEffectRun(self.project_root, SIMULATED_BEFORE_RIBBON)
        run.write_store_records(run.root_outcomes())
        catalog, _ = read_store_catalog(run.store_root)
        compact_catalog_bytes = json_bytes(catalog)
        (run.store_root / STORE_CATALOG_NAME).write_bytes(compact_catalog_bytes)
        run.write_store_records(run.root_outcomes())
        self.assertEqual((run.store_root / STORE_CATALOG_NAME).read_bytes(), compact_catalog_bytes)


if __name__ == '__main__':
    unittest.main()
