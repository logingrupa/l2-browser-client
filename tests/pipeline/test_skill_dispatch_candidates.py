import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors import skill_dispatch_candidate_recipe
from actors.skill_dispatch_candidate_recipe import (EXPECTED_BINDING_COUNT, binding_record, class_records, entry_gate_of,
                                                    require_replay_counts, write_skill_dispatch_candidates)
from actors.skill_dispatch_candidates import (SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON, SkillDispatchCandidatesError,
                                              animation_notify_candidates_by_skill_key, candidate_class_records, dispatch_candidates_by_skill_key,
                                              inclusive_level_runs, read_skill_dispatch_candidates, read_strict_json_bytes,
                                              require_skill_dispatch_candidates)
from actors.skill_dispatch_recipe_sources import R2_ARCHIVE_SHA256, REPLAY_SHA256, read_pinned_json, require_locked_source
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

COMMITTED = read_skill_dispatch_candidates(ROOT)
COMMITTED_DOCUMENT = COMMITTED['document']


def replay_binding(index, skill_id, levels, effect_object, cast_style=None, package_sha256='e' * 64, record_ids=None):
    gate_ids = {None: [], 0: ['entry-gate:transient'], 12: ['entry-gate:union-target']}.get(cast_style, [])
    return {'r2BindingIndex': index, 'stage': 'init', 'skillId': skill_id,
            'r2': {'stage': 'init', 'skillId': skill_id, 'effectObject': effect_object, 'emptyDescriptionLevels': levels,
                   'requiredCastStyle': cast_style, 'nativeSuperClass': 'Engine.Emitter', 'classEvidence': {'packageSha256': package_sha256},
                   'switchVA': None, 'dispatchKind': 'comparison-tree', 'selectorIndex': None, 'caseIndex': None, 'caseVA': '0x104fa6b2',
                   'classPushVA': '0x104f3c51', 'classLiteralVA': '0x108aa884', 'status': 'case-class-references'},
            'replayRecordIds': record_ids if record_ids is not None else ['dispatch:0000', f'class-reference:{effect_object}', *gate_ids]}


SYNTHETIC_RECORDS = {'dispatch:0000': {}, 'class-reference:LineageEffect.a': {}, 'entry-gate:transient': {}}


class GeneratorRefusalTests(unittest.TestCase):
    def test_a_replay_file_other_than_the_pinned_one_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'skill-dispatch-r2-replay.json'
            path.write_bytes(b'{}')
            with self.assertRaisesRegex(SkillDispatchCandidatesError, REPLAY_SHA256):
                read_pinned_json(path, REPLAY_SHA256, 'replay')

    def test_an_engine_or_skillgrp_pin_that_differs_from_the_lock_is_refused(self):
        lock = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH)
        self.assertEqual(require_locked_source(lock, 'system/engine.dll', 'C:\\Lineage2-client\\system\\engine.dll', COMMITTED_DOCUMENT['engine']['sha256']),
                         {'path': 'system/engine.dll', 'sha256': COMMITTED_DOCUMENT['engine']['sha256']})
        for relative_path in ('system/engine.dll', 'system/skillgrp.dat'):
            with self.assertRaisesRegex(SkillDispatchCandidatesError, 'differs from the reference client lock'):
                require_locked_source(lock, relative_path, 'C:\\Lineage2-client\\' + relative_path.replace('/', '\\'), '0' * 64)

    def test_coverage_counts_that_the_recount_does_not_reproduce_are_refused(self):
        replay = {'candidateBindings': [replay_binding(0, 1, [1], 'LineageEffect.a')],
                  'coverage': {'candidateBindingsMapped': 1, 'candidateRowsUnchanged': 1, 'unresolvedRowsUnchanged': 0, 'emptyDescriptionRows': 1}}
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'replay holds 1 bindings'):
            require_replay_counts(replay, {(1, 1)})
        self.assertEqual(EXPECTED_BINDING_COUNT, 1483)

    def test_a_cast_style_outside_null_zero_and_twelve_is_refused(self):
        self.assertEqual([entry_gate_of(style) for style in (None, 0, 12)], ['none', 'transient', 'union-target'])
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'cast style 11'):
            entry_gate_of(11)

    def test_a_class_with_two_package_pins_is_refused(self):
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'more than one package pin'):
            class_records([replay_binding(0, 1, [1], 'LineageEffect.a'), replay_binding(1, 2, [1], 'LineageEffect.a', package_sha256='f' * 64)])

    def test_a_binding_whose_replay_record_ids_do_not_resolve_is_refused(self):
        binding = replay_binding(0, 1, [1], 'LineageEffect.a', record_ids=['dispatch:0000', 'class-reference:LineageEffect.a', 'case:missing'])
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'unresolved replay records'):
            binding_record(binding, SYNTHETIC_RECORDS, 'a' * 64)

    def test_duplicate_keys_and_non_finite_numbers_are_refused(self):
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'repeats a JSON key'):
            read_strict_json_bytes(b'{"a": 1, "a": 2}', 'replay')
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'non-finite'):
            read_strict_json_bytes(b'{"a": NaN}', 'replay')


class GeneratorCheckTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        patcher = mock.patch.object(skill_dispatch_candidate_recipe, 'skill_dispatch_candidate_document', return_value={'kind': 'synthetic'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_generator_writes_canonical_json_and_check_passes_on_equal_bytes_and_fails_on_one_changed_byte(self):
        payload = write_skill_dispatch_candidates(self.project_root, 'replay.json', 'client', False)
        recipe_path = self.project_root / 'recipes' / 'actors' / 'skill-dispatch-candidates.json'
        self.assertEqual(recipe_path.read_bytes(), payload)
        self.assertEqual(payload, b'{\n  "kind": "synthetic"\n}\n')
        self.assertEqual(write_skill_dispatch_candidates(self.project_root, 'replay.json', 'client', True), payload)
        recipe_path.write_bytes(payload.replace(b'synthetic', b'synthetiC'))
        with self.assertRaisesRegex(SkillDispatchCandidatesError, 'differs from its generated bytes'):
            write_skill_dispatch_candidates(self.project_root, 'replay.json', 'client', True)


class ReaderTests(unittest.TestCase):
    def refused(self, mutate, message):
        document = copy.deepcopy(COMMITTED_DOCUMENT)
        mutate(document)
        with self.assertRaisesRegex(SkillDispatchCandidatesError, message):
            require_skill_dispatch_candidates(document, REFERENCE_CLIENT_LOCK_PATH)

    def test_an_unknown_field_is_refused(self):
        self.refused(lambda document: document.update(playback=True), 'fields must be')

    def test_an_engine_pin_that_differs_from_the_lock_is_refused(self):
        self.refused(lambda document: document['engine'].update(sha256='0' * 64), 'differs from the system/engine.dll entry')

    def test_a_binding_naming_a_class_outside_classes_is_refused(self):
        self.refused(lambda document: document['bindings'][0].update(effectObject='LineageEffect.not_listed'), 'which classes does not list')

    def test_a_gate_outside_none_transient_and_union_target_is_refused(self):
        self.refused(lambda document: document['bindings'][0].update(entryGate='cast-style-11'), 'entry gate')

    def test_a_notify_binding_naming_a_class_outside_its_classes_is_refused(self):
        self.refused(lambda document: document['animationNotify']['classes'].pop(), 'animationNotify classes does not list')


class CandidateExpansionTests(unittest.TestCase):
    def test_level_runs_expand_to_rows_grouped_by_stage_and_case_with_sorted_classes(self):
        self.assertEqual(inclusive_level_runs([3, 1, 2, 7, 9, 8]), [[1, 3], [7, 9]])
        document = {'bindings': [
            {'stage': 'init', 'skillId': 1, 'levelRuns': [[1, 2]], 'dispatchKind': 'selector-table', 'caseIndex': 0, 'caseVA': '0x104f3bec',
             'entryGate': 'none', 'effectObject': 'LineageEffect.s_u010_b'},
            {'stage': 'init', 'skillId': 1, 'levelRuns': [[1, 1]], 'dispatchKind': 'selector-table', 'caseIndex': 0, 'caseVA': '0x104f3bec',
             'entryGate': 'none', 'effectObject': 'LineageEffect.s_u010_a'},
            {'stage': 'union-target', 'skillId': 1, 'levelRuns': [[2, 2]], 'dispatchKind': 'selector-table', 'caseIndex': 4, 'caseVA': '0x104fd300',
             'entryGate': 'union-target', 'effectObject': 'LineageEffect.el_flame_strike_ta'}]}
        init_case = {'dispatchKind': 'selector-table', 'caseIndex': 0, 'caseVA': '0x104f3bec'}
        self.assertEqual(dispatch_candidates_by_skill_key(document), {
            (1, 1): [{'stage': 'init', 'case': init_case, 'candidateClasses': ['LineageEffect.s_u010_a', 'LineageEffect.s_u010_b'], 'entryGate': 'none'}],
            (1, 2): [{'stage': 'init', 'case': init_case, 'candidateClasses': ['LineageEffect.s_u010_b'], 'entryGate': 'none'},
                     {'stage': 'union-target', 'case': {'dispatchKind': 'selector-table', 'caseIndex': 4, 'caseVA': '0x104fd300'},
                      'candidateClasses': ['LineageEffect.el_flame_strike_ta'], 'entryGate': 'union-target'}]})


class CommittedRecipeTests(unittest.TestCase):
    def test_the_committed_recipe_records_the_replay_archive_and_lock_equal_engine_pins(self):
        lock = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH)
        self.assertEqual((COMMITTED_DOCUMENT['replay']['sha256'], COMMITTED_DOCUMENT['replay']['r2ArchiveSha256']), (REPLAY_SHA256, R2_ARCHIVE_SHA256))
        self.assertEqual(COMMITTED_DOCUMENT['engine'], {'path': 'system/engine.dll', 'imageBase': '0x10300000',
                                                        'sha256': lock.record('system/engine.dll')['eSha256']})
        for source in COMMITTED_DOCUMENT['sources'].values():
            self.assertEqual(lock.record(source['path'])['eSha256'], source['sha256'])
        verification = COMMITTED_DOCUMENT['replay']['verification']
        self.assertEqual((verification['date'], verification['workflow']), ('2026-11-13', 'wf_f4663a6a-7bd'))
        self.assertEqual((verification['instructionOccurrences'], verification['dataSlices'], verification['bindings']),
                         ({'checked': 14505, 'matched': 14505}, {'checked': 823, 'matched': 823}, {'checked': 1483, 'reproduced': 1483}))
        self.assertNotIn('path', verification)

    def test_the_committed_recipe_holds_the_replayed_counts(self):
        document = COMMITTED_DOCUMENT
        self.assertEqual((len(document['stages']), len(document['tables']), len(document['bindings']), len(document['classes'])), (7, 34, 1483, 234))
        self.assertEqual(len(dispatch_candidates_by_skill_key(document)), 11211)
        self.assertEqual(sorted({binding['entryGate'] for binding in document['bindings']}), ['none', 'transient', 'union-target'])
        self.assertEqual(sorted(animation_notify_candidates_by_skill_key(document)), [(4108, 1), (4681, 1), (4682, 1), (5092, 1)])
        self.assertEqual([record['effectObject'] for record in document['animationNotify']['classes']],
                         ['LineageEffect.e_u042_a', 'LineageEffect.mb_valakas_trample_ca'])
        self.assertEqual(len(candidate_class_records(document)), 236)

    def test_the_committed_recipe_carries_no_disassembly_text_and_the_reason_is_listed(self):
        payload = (ROOT / 'recipes' / 'actors' / 'skill-dispatch-candidates.json').read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), COMMITTED['sha256'])
        self.assertNotIn(b'"disasm"', payload)
        self.assertNotIn(b'"instruction"', payload)
        reasons = json.loads((ROOT / 'recipes' / 'actors' / 'gap-reasons.json').read_text(encoding='utf-8'))['reasons']
        self.assertIn(SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON, reasons)


if __name__ == '__main__':
    unittest.main()
