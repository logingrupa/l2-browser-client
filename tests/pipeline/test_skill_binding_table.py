from pathlib import Path
import sys
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors.skill_binding_table import (SKILL_BINDING_ANOMALY_FIELDS, SKILL_BINDING_CENSUS_FIELDS, SKILL_BINDING_ROW_FIELDS,
                                        SKILL_BINDING_STATUSES, SkillBindingTableError, build_skill_binding_rows, emitter_class_root_outcome,
                                        representative_skill_binding, require_census_totals, reviewed_source_dispatch_keys,
                                        skill_binding_anomalies, skill_binding_census, skill_binding_gap_rows, skill_bindings_by_visual_root,
                                        visual_roots_in_first_key_order)
from actors.skill_effect_conversion import (MAXIMUM_SKILL_ROOT_CLASS_CLOSURE, class_limit_reason, read_simulated_emitter_classes,
                                            skill_effect_component_id, skill_root_bundle_id, unbound_simulated_component_reason)
from native_effect_bundle import CONVERTED_EMITTER_CLASSES, MAX_CLASSES
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row

GAMEPLAY_FIELDS = ('mp_consume', 'hp_consume', 'cast_range', 'hit_time', 'is_magic', 'operate_type', 'reuse_delay', 'power')
SKILL_TABLE_IDENTITY = {'path': 'system/skillgrp.dat', 'sha256': 'a' * 64}


def skill_row(skill_id, level, description):
    return {'skill_id': skill_id, 'skill_level': level, 'description': description, 'mp_consume': 10, 'cast_range': 600,
            'hit_time': 1.0800000429153442, 'is_magic': 1, 'operate_type': 0, 'hp_consume': 0, 'icon': 'icon.skill1011'}


def sound_row(skill_id, level):
    return {'skill_id': skill_id, 'skill_level': level, 'spelleffect_sound_1': 'SkillSound.heal_cast', 'spelleffect_sound_vol_1': 250.0}


def decoded_table(name, rows, sha256):
    return {'source': f'system/{name}.dat', 'sourceSha256': sha256, 'data': {name.replace('grp', ''): rows}}


def binding_of(skill_rows, sound_rows, reviewed=frozenset()):
    rows = build_skill_binding_rows(skill_rows, sound_rows, reviewed)
    if len(rows) != 1:
        raise AssertionError(f'expected one binding, got {rows}')
    return rows[0]


def staged_component(object_name, emitter_class, mesh=None, texture=None, primitives=()):
    return {'object': object_name, 'class': emitter_class, 'bindings': {'mesh': mesh, 'texture': texture, 'primitiveMaterials': list(primitives)}}


class VisualRootBindingTests(unittest.TestCase):
    def test_a_qualified_description_with_one_exact_sound_row_binds_the_visual_root_and_the_sound_row_ordinal(self):
        rows = build_skill_binding_rows([skill_row(1011, 1, 'skill.wh.1011')], [sound_row(4, 1), sound_row(1011, 1)], frozenset())
        self.assertEqual(rows, [{'key': 'skill:1011:1', 'skillId': 1011, 'level': 1, 'status': 'visual-root', 'visualRoot': 'skill.wh.1011',
                                 'soundRowOrdinal': 1, 'soundReason': None, 'reason': None}])
        self.assertIn(rows[0]['status'], SKILL_BINDING_STATUSES)
        self.assertEqual(tuple(rows[0]), SKILL_BINDING_ROW_FIELDS)

    def test_power_strike_is_the_reviewed_source_dispatch_key_read_from_its_recipe(self):
        self.assertEqual(reviewed_source_dispatch_keys(REPOSITORY_ROOT), frozenset({'skill:3:1'}))

    def test_an_empty_description_needs_native_dispatch_unless_a_reviewed_recipe_names_the_key(self):
        self.assertEqual(binding_of([skill_row(4, 1, '')], [])['reason'], 'native-skill-dispatch-required')
        reviewed = binding_of([skill_row(3, 1, '')], [sound_row(3, 1)], frozenset({'skill:3:1'}))
        self.assertEqual((reviewed['status'], reviewed['visualRoot'], reviewed['reason']), ('reviewed-source-dispatch', None, None))

    def test_a_description_without_a_package_qualifier_is_an_unqualified_reference_gap(self):
        binding = binding_of([skill_row(5, 1, 'heal')], [sound_row(5, 1)])
        self.assertEqual((binding['status'], binding['visualRoot'], binding['reason']), ('gap', None, 'skill-visual-reference-unqualified'))

    def test_two_skill_rows_for_one_key_are_one_ambiguous_gap(self):
        binding = binding_of([skill_row(6, 1, 'skill.a.6'), skill_row(6, 1, 'skill.b.6')], [sound_row(6, 1)])
        self.assertEqual((binding['status'], binding['reason']), ('gap', 'skill-row-ambiguous:2'))


class ExactSoundBindingTests(unittest.TestCase):
    def test_zero_and_two_sound_rows_both_give_no_exact_skillsound_row(self):
        for sound_rows in ([], [sound_row(1011, 1), sound_row(1011, 1)]):
            binding = binding_of([skill_row(1011, 1, 'skill.wh.1011')], sound_rows)
            self.assertEqual((binding['status'], binding['soundRowOrdinal'], binding['soundReason']),
                             ('visual-root', None, 'no-exact-skillsound-row'))

    def test_a_level_two_skill_with_only_a_level_one_sound_row_binds_no_sound(self):
        rows = build_skill_binding_rows([skill_row(1011, 1, 'skill.wh.1011'), skill_row(1011, 2, 'skill.wh.1011')], [sound_row(1011, 1)],
                                        frozenset())
        self.assertEqual([(row['key'], row['soundRowOrdinal'], row['soundReason']) for row in rows],
                         [('skill:1011:1', 0, None), ('skill:1011:2', None, 'no-exact-skillsound-row')])

    def test_the_root_unit_is_converted_from_the_first_key_with_an_exact_sound_row(self):
        rows = build_skill_binding_rows([skill_row(1011, 1, 'skill.wh.1011'), skill_row(1011, 2, 'skill.wh.1011')], [sound_row(1011, 2)],
                                        frozenset())
        self.assertEqual(representative_skill_binding(skill_bindings_by_visual_root(rows)['skill.wh.1011'])['key'], 'skill:1011:2')
        self.assertIsNone(representative_skill_binding(skill_bindings_by_visual_root(rows[:1])['skill.wh.1011']))


class LevelAndPrecisionTests(unittest.TestCase):
    def test_levels_below_one_are_census_anomalies_and_never_keys(self):
        skill_rows = [skill_row(1011, 0, 'skill.wh.1011'), skill_row(1011, -1, 'skill.wh.1011'), skill_row(1011, 1, 'skill.wh.1011')]
        self.assertEqual([row['key'] for row in build_skill_binding_rows(skill_rows, [], frozenset())], ['skill:1011:1'])
        anomalies = skill_binding_anomalies(skill_rows)
        self.assertEqual(anomalies, [{'rowOrdinal': 0, 'reason': 'skill-level-below-one'}, {'rowOrdinal': 1, 'reason': 'skill-level-below-one'}])
        self.assertTrue(all(tuple(anomaly) == SKILL_BINDING_ANOMALY_FIELDS for anomaly in anomalies))

    def test_keys_are_unpadded_integers_and_record_ids_name_the_key_and_root(self):
        binding = binding_of([skill_row(7, 12, 'skill.mo.7')], [sound_row(7, 12)])
        self.assertEqual((binding['key'], binding['skillId'], binding['level']), ('skill:7:12', 7, 12))
        self.assertEqual(skill_effect_component_id(7, 12), 'interlude:skill:7:level:12:native-description-action')
        self.assertEqual(skill_root_bundle_id('skill.mo.7'), 'interlude:skill-root:skill.mo.7')

    def test_the_census_counts_every_decoded_row_once_and_copies_identities_unchanged(self):
        skill_rows = [skill_row(3, 1, ''), skill_row(4, 1, ''), skill_row(1011, 1, 'skill.wh.1011'), skill_row(1011, 2, 'skill.wh.1011'),
                      skill_row(5, 1, 'heal'), skill_row(6, 1, 'skill.a.6'), skill_row(6, 1, 'skill.b.6'), skill_row(8, 0, 'skill.mo.8')]
        sound_rows = [sound_row(1011, 1), sound_row(3, 1)]
        bindings = build_skill_binding_rows(skill_rows, sound_rows, frozenset({'skill:3:1'}))
        census = skill_binding_census(decoded_table('skillgrp', skill_rows, 'b' * 64), decoded_table('skillsoundgrp', sound_rows, 'c' * 64),
                                      bindings, skill_binding_anomalies(skill_rows))
        self.assertEqual(census, {
            'schemaVersion': 1, 'sources': {'skillgrp': 'b' * 64, 'skillsoundgrp': 'c' * 64}, 'rowCount': 8, 'distinctSkillIds': 5,
            'keys': {'visualRoot': 2, 'reviewedSourceDispatch': 1,
                     'gap': {'native-skill-dispatch-required': 1, 'skill-row-ambiguous:2': 2, 'skill-visual-reference-unqualified': 1}},
            'sound': {'exactRow': 2, 'noExactRow': 4}, 'visualRoots': 1, 'anomalies': [{'rowOrdinal': 7, 'reason': 'skill-level-below-one'}]})
        self.assertEqual(tuple(census), SKILL_BINDING_CENSUS_FIELDS)

    def test_a_census_whose_counts_miss_a_row_is_refused(self):
        census = {'rowCount': 3, 'keys': {'visualRoot': 1, 'reviewedSourceDispatch': 0, 'gap': {'native-skill-dispatch-required': 1}},
                  'anomalies': []}
        with self.assertRaisesRegex(SkillBindingTableError, 'covers 2 rows'):
            require_census_totals(census)


class GameplayFieldProhibitionTests(unittest.TestCase):
    def test_binding_rows_and_the_census_hold_only_presentation_identity_fields(self):
        skill_rows = [skill_row(1011, 1, 'skill.wh.1011'), skill_row(4, 1, '')]
        bindings = build_skill_binding_rows(skill_rows, [sound_row(1011, 1)], frozenset())
        census = skill_binding_census(decoded_table('skillgrp', skill_rows, 'b' * 64), decoded_table('skillsoundgrp', [], 'c' * 64), bindings, [])
        for row in bindings:
            self.assertEqual(set(row), set(SKILL_BINDING_ROW_FIELDS))
        self.assertEqual(set(census), set(SKILL_BINDING_CENSUS_FIELDS))
        serialized = repr((bindings, census))
        for field in GAMEPLAY_FIELDS:
            self.assertNotIn(field, serialized)
        self.assertNotIn('1.0800000429153442', serialized)


class EmitterClassTests(unittest.TestCase):
    def test_sprite_mesh_beam_ribbon_and_vertmesh_emitters_convert_and_spark_and_trail_do_not(self):
        self.assertEqual(CONVERTED_EMITTER_CLASSES, frozenset({'Engine.SpriteEmitter', 'Engine.MeshEmitter', 'Engine.BeamEmitter',
                                                               'Engine.RibbonEmitter', 'Engine.VertMeshEmitter'}))
        self.assertNotIn('Engine.SparkEmitter', CONVERTED_EMITTER_CLASSES)
        self.assertNotIn('Engine.TrailEmitter', CONVERTED_EMITTER_CLASSES)

    def test_a_root_passes_only_when_every_emitter_class_is_simulated(self):
        simulated = read_simulated_emitter_classes(REPOSITORY_ROOT)
        self.assertEqual(simulated, frozenset({'Engine.MeshEmitter', 'Engine.SpriteEmitter'}))
        self.assertEqual(emitter_class_root_outcome(['Engine.MeshEmitter', 'Engine.SpriteEmitter'], simulated), ('pass', None))
        self.assertEqual(emitter_class_root_outcome(['Engine.SparkEmitter', 'Engine.BeamEmitter', 'Engine.SpriteEmitter'], simulated),
                         ('gap', 'emitter-class-unported:Engine.BeamEmitter'))

    def test_a_simulated_component_without_its_converted_resource_refuses_the_root(self):
        simulated = frozenset({'Engine.MeshEmitter', 'Engine.SpriteEmitter'})
        bound = {'components': [staged_component('fx.a.MeshEmitter0', 'Engine.MeshEmitter', mesh={'assetId': 'm'}, primitives=[{}]),
                                staged_component('fx.a.SpriteEmitter1', 'Engine.SpriteEmitter', texture={'assetId': 't'}),
                                staged_component('fx.a.BeamEmitter2', 'Engine.BeamEmitter')]}
        self.assertIsNone(unbound_simulated_component_reason(bound, simulated))
        unbound = {'components': [staged_component('fx.a.MeshEmitter0', 'Engine.MeshEmitter')]}
        self.assertEqual(unbound_simulated_component_reason(unbound, simulated), 'converter-refused:fx.a.MeshEmitter0 has no converted resource')


class ClassLimitTests(unittest.TestCase):
    def test_a_root_of_exactly_the_class_limit_converts_and_one_more_class_is_a_class_limit_gap(self):
        self.assertEqual(MAXIMUM_SKILL_ROOT_CLASS_CLOSURE, MAX_CLASSES)
        closures = {'at-limit': tuple(f'Synthetic.c{index}' for index in range(MAX_CLASSES)),
                    'over-limit': tuple(f'Synthetic.c{index}' for index in range(MAX_CLASSES + 1))}
        self.assertIsNone(class_limit_reason('at-limit', closures.__getitem__))
        self.assertEqual(class_limit_reason('over-limit', closures.__getitem__), f'effect-bundle-class-limit:{MAX_CLASSES + 1}')


class SkillsGapRowTests(unittest.TestCase):
    def test_every_key_gets_one_listed_skills_row_from_its_binding_or_its_sealed_root(self):
        skill_rows = [skill_row(3, 1, ''), skill_row(4, 1, ''), skill_row(1011, 1, 'skill.wh.1011'), skill_row(1012, 1, 'skill.wh.1012'),
                      skill_row(1013, 1, 'skill.wh.1013')]
        bindings = build_skill_binding_rows(skill_rows, [sound_row(1011, 1), sound_row(1012, 1)], frozenset({'skill:3:1'}))
        root_outcomes = {'skill.wh.1011': {'status': 'gap', 'reason': 'emitter-class-unported:Engine.BeamEmitter', 'evidence': 'work/r/receipt.json'},
                         'skill.wh.1012': {'status': 'pass', 'reason': None, 'evidence': 'work/s/receipt.json'}}
        rows = skill_binding_gap_rows(bindings, root_outcomes, SKILL_TABLE_IDENTITY)
        self.assertEqual([(row['key'], row['status'], row['reason']) for row in rows], [
            ('skill:3:1', 'pending', 'conversion-pending'), ('skill:4:1', 'gap', 'native-skill-dispatch-required'),
            ('skill:1011:1', 'gap', 'emitter-class-unported:Engine.BeamEmitter'), ('skill:1012:1', 'pass', None),
            ('skill:1013:1', 'pending', 'conversion-pending')])
        patterns = load_gap_reason_patterns()
        for row in rows:
            validate_gap_row(row, patterns)

    def test_roots_are_converted_in_the_order_of_their_first_key(self):
        bindings = build_skill_binding_rows([skill_row(1011, 1, 'skill.wh.1011'), skill_row(4, 1, 'skill.mo.4'), skill_row(4, 2, 'skill.wh.1011')],
                                            [], frozenset())
        self.assertEqual(visual_roots_in_first_key_order(bindings), ['skill.mo.4', 'skill.wh.1011'])


if __name__ == '__main__':
    unittest.main()
