from pathlib import Path
import json
import sys
from types import SimpleNamespace
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.emitter_feature_coverage import EmitterFeatureCoverageError, read_emitter_feature_rules, unported_emitter_feature_reasons
from actors.skill_bundle_step_names import SKILL_EFFECT_ROOT_STEP
from actors.skill_effect_conversion import (ROOT_OUTCOME_RECORD_NAME, SKILL_EFFECT_ROOT_ALGORITHM_VERSION, STAGED_EFFECTS_FOLDER,
                                            STAGED_MANIFEST_NAME, SkillEffectConversionRun, emitter_feature_gap_roots_by_reason)
from actors.npc_store_records import file_output_record
from actors.skill_dispatch_class_conversion import SkillDispatchClassUnits
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
SYNTHETIC_CLASS_DEFAULTS = json.loads((ROOT / 'tests' / 'fixtures' / 'particles' / 'synthetic-class-defaults.json').read_text(encoding='utf-8'))
EMITTER_FEATURE_RULES = read_emitter_feature_rules(ROOT)
BOUND_MESH = {'mesh': {'assetId': 'm'}, 'texture': None, 'primitiveMaterials': [{'textureResourceKey': 't'}]}
NO_CANDIDATE_DOCUMENT = {'classes': [], 'bindings': [], 'animationNotify': {'classes': [], 'bindings': []}}


def synthetic_effective_properties(emitter_class, overrides):
    return {**SYNTHETIC_CLASS_DEFAULTS['Engine.ParticleEmitter'], **SYNTHETIC_CLASS_DEFAULTS.get(emitter_class, {}),
            **({'UseMeshBlendMode': False} if emitter_class == 'Engine.MeshEmitter' else {}), **overrides}


def staged_component(object_name, emitter_class, texture, overrides=None, bindings=None):
    return {'object': object_name, 'class': emitter_class, 'effectiveProperties': synthetic_effective_properties(emitter_class, overrides or {}),
            'bindings': bindings or {'mesh': None, 'texture': texture, 'primitiveMaterials': []}}


def sprite_feature_reasons(overrides):
    return unported_emitter_feature_reasons(staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'}, overrides),
                                            EMITTER_FEATURE_RULES)


class SyntheticSkillEffectRun(SkillEffectConversionRun):
    def __init__(self, project_root, simulated_emitter_classes, candidate_document=NO_CANDIDATE_DOCUMENT, candidate_binding_rows=()):
        self.project_root = Path(project_root)
        self.ledger = UnitLedger(lane_work_root(project_root, 'actors'), SKILL_EFFECT_ROOT_STEP, SKILL_EFFECT_ROOT_ALGORITHM_VERSION)
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / 'actors' / 'l2'
        self.bindings_by_root = {VISUAL_ROOT: [{'key': 'skill:1011:1', 'skillId': 1011, 'level': 1, 'soundRowOrdinal': 1}]}
        self.tables = SimpleNamespace(binding_rows=self.bindings_by_root[VISUAL_ROOT])
        self.simulated_emitter_classes = simulated_emitter_classes
        self.emitter_feature_rules = EMITTER_FEATURE_RULES
        self.tool_identity = {'converterSha256': 'b' * 64}
        self.input_records = INPUT_RECORDS
        self.dispatch_classes = SkillDispatchClassUnits(self, candidate_document, list(candidate_binding_rows))

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
        run.write_store_records(run.root_outcomes(), {})
        catalog, _ = read_store_catalog(run.store_root)
        compact_catalog_bytes = json_bytes(catalog)
        (run.store_root / STORE_CATALOG_NAME).write_bytes(compact_catalog_bytes)
        run.write_store_records(run.root_outcomes(), {})
        self.assertEqual((run.store_root / STORE_CATALOG_NAME).read_bytes(), compact_catalog_bytes)


class ConvertedRootEmitterFeatureTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)

    def root_outcomes_of(self, components):
        run = SyntheticSkillEffectRun(self.project_root, SIMULATED_WITH_RIBBON)
        run.seal_converted_root(components)
        return run.root_outcomes()

    def test_a_converted_root_with_an_unported_feature_is_a_converted_feature_gap(self):
        outcomes = self.root_outcomes_of([staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'}, {'UseCollision': True})])
        outcome = outcomes[VISUAL_ROOT]
        self.assertEqual((outcome['status'], outcome['reason'], outcome['converted']), ('gap', 'emitter-feature-unported:UseCollision', True))
        self.assertEqual(outcome['emitterFeatureGaps'], [{'emitter': 'fx.a.SpriteEmitter0', 'reason': 'emitter-feature-unported:UseCollision'}])
        self.assertEqual(emitter_feature_gap_roots_by_reason(outcomes), {'emitter-feature-unported:UseCollision': 1})

    def test_a_converted_root_without_an_unported_feature_keeps_its_class_verdict(self):
        outcome = self.root_outcomes_of([staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'})])[VISUAL_ROOT]
        self.assertEqual((outcome['status'], outcome['reason'], outcome['converted'], outcome['emitterFeatureGaps']), ('pass', None, True, []))

    def test_a_mesh_emitter_that_keeps_its_static_mesh_materials_is_a_use_mesh_blend_mode_gap(self):
        components = [staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'}),
                      staged_component('fx.a.MeshEmitter1', 'Engine.MeshEmitter', None, {'UseMeshBlendMode': True}, BOUND_MESH)]
        outcome = self.root_outcomes_of(components)[VISUAL_ROOT]
        self.assertEqual((outcome['status'], outcome['reason'], outcome['converted']), ('gap', 'emitter-feature-unported:UseMeshBlendMode', True))

    def test_every_unported_feature_of_every_component_is_listed_and_the_first_names_the_root(self):
        components = [staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'}, {'WeatherEffect': True, 'UseDirectionAs': 1}),
                      staged_component('fx.a.MeshEmitter1', 'Engine.MeshEmitter', None, {'CoordinateSystem': 3, 'UseMeshBlendMode': True}, BOUND_MESH)]
        outcome = self.root_outcomes_of(components)[VISUAL_ROOT]
        self.assertEqual(outcome['reason'], 'emitter-feature-unported:WeatherEffect')
        self.assertEqual([f"{gap['emitter']} {gap['reason']}" for gap in outcome['emitterFeatureGaps']], [
            'fx.a.SpriteEmitter0 emitter-feature-unported:WeatherEffect', 'fx.a.SpriteEmitter0 emitter-feature-unported:UseDirectionAs',
            'fx.a.MeshEmitter1 emitter-feature-unported:CoordinateSystem', 'fx.a.MeshEmitter1 emitter-feature-unported:UseMeshBlendMode'])


class EmitterFeatureRuleTests(unittest.TestCase):
    def test_the_age_driven_atlas_blend_needs_blending_no_random_cell_and_more_than_one_cell(self):
        blending = {'BlendBetweenSubdivisions': True, 'UseRandomSubdivision': False}
        self.assertEqual(sprite_feature_reasons({**blending, 'TextureUSubdivisions': 2, 'TextureVSubdivisions': 1}),
                         ['emitter-feature-unported:BlendBetweenSubdivisions'])
        self.assertEqual(sprite_feature_reasons({**blending, 'TextureUSubdivisions': 1, 'TextureVSubdivisions': 0}), [])
        self.assertEqual(sprite_feature_reasons({**blending, 'UseRandomSubdivision': True, 'TextureUSubdivisions': 4}), [])

    def test_camera_facing_direction_usages_and_a_negative_spawn_source_are_ported(self):
        self.assertEqual(sprite_feature_reasons({'UseDirectionAs': 7, 'SpawnFromOtherEmitter': -1}), [])
        self.assertEqual(sprite_feature_reasons({'UseDirectionAs': 4, 'SpawnFromOtherEmitter': 0}),
                         ['emitter-feature-unported:SpawnFromOtherEmitter', 'emitter-feature-unported:UseDirectionAs'])

    def test_sprite_only_features_do_not_apply_to_a_mesh_emitter(self):
        mesh = staged_component('fx.a.MeshEmitter1', 'Engine.MeshEmitter', None,
                                {'UseDirectionAs': 4, 'BlendBetweenSubdivisions': True, 'TextureUSubdivisions': 4}, BOUND_MESH)
        self.assertEqual(unported_emitter_feature_reasons(mesh, EMITTER_FEATURE_RULES), [])

    def test_a_component_without_a_class_default_feature_field_is_refused(self):
        component = staged_component('fx.a.SpriteEmitter0', 'Engine.SpriteEmitter', {'assetId': 't'})
        del component['effectiveProperties']['SpawnFromOtherEmitter']
        with self.assertRaisesRegex(EmitterFeatureCoverageError, 'no Interlude class default SpawnFromOtherEmitter'):
            unported_emitter_feature_reasons(component, EMITTER_FEATURE_RULES)

    def test_a_feature_field_of_the_wrong_type_is_refused(self):
        with self.assertRaisesRegex(EmitterFeatureCoverageError, 'UseCollision is not a boolean'):
            sprite_feature_reasons({'UseCollision': 1})

    def test_a_recipe_condition_outside_the_rule_vocabulary_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            recipe_path = Path(temporary_directory) / 'recipes' / 'actors' / 'emitter-feature-coverage.json'
            recipe_path.parent.mkdir(parents=True)
            recipe = json.loads((ROOT / 'recipes' / 'actors' / 'emitter-feature-coverage.json').read_text(encoding='utf-8'))
            recipe['features'][0]['when']['test'] = 'is-odd'
            recipe_path.write_text(json.dumps(recipe), encoding='utf-8')
            with self.assertRaisesRegex(EmitterFeatureCoverageError, 'condition outside'):
                read_emitter_feature_rules(temporary_directory)


if __name__ == '__main__':
    unittest.main()
