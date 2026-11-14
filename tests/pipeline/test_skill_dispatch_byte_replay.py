from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_effect_bundle import _pe32_file_section_reader
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, ReferenceClientLockError, require_reference_client
from skill_dispatch_byte_replay import (ReferenceClientBytes, SkillDispatchReplayError, decode_instruction, recompute_candidate_binding,
                                        table_slice_sha256)

CLIENT_ROOT = Path('E:/Lineage2-client')
RECIPE_PATH = ROOT / 'recipes' / 'actors' / 'skill-dispatch-candidates.json'
SAMPLE_SKILL_IDS = (1, 3, 56, 1419, 2023, 2025, 2039, 4049, 5007, 5115)


def lowest_level_of(bindings):
    return min(low for binding in bindings for low, _ in binding['levelRuns'])


def bindings_of_row(recipe, skill_id, level):
    return [binding for binding in recipe['bindings'] if binding['skillId'] == skill_id
            and any(low <= level <= high for low, high in binding['levelRuns'])]


def sample_rows(recipe):
    rows = []
    for skill_id in SAMPLE_SKILL_IDS:
        level = lowest_level_of([binding for binding in recipe['bindings'] if binding['skillId'] == skill_id])
        rows.append((skill_id, level, bindings_of_row(recipe, skill_id, level)))
    return rows


def reference_client_bytes():
    if not (CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file()):
        raise unittest.SkipTest(f'the lock-equal client {CLIENT_ROOT.as_posix()} or the reference client lock is absent')
    try:
        access = require_reference_client(CLIENT_ROOT)
        engine_path, _ = access.require_equal_file_with_sha256('system/engine.dll')
        soulshot_path, _ = access.require_equal_file_with_sha256('system/soulshot.int')
    except ReferenceClientLockError as error:
        raise unittest.SkipTest(f'the client {CLIENT_ROOT.as_posix()} is not lock-equal: {error}') from error
    return ReferenceClientBytes(_pe32_file_section_reader(engine_path.read_bytes()), soulshot_path.read_bytes())


class InstructionFormTests(unittest.TestCase):
    def test_the_replayed_forms_decode_and_any_other_form_is_refused_with_its_bytes(self):
        self.assertEqual(decode_instruction(bytes.fromhex('8b83f8040000') + bytes(9), 0x104f2f40).operands, ('eax', 'ebx', 0x4f8))
        self.assertEqual(decode_instruction(bytes.fromhex('0f874d770000') + bytes(9), 0x104f2f5f).operands, (0x104fa6b2,))
        self.assertEqual(decode_instruction(bytes.fromhex('ff248508a74f10') + bytes(8), 0x104f2f6c).operands, ('eax', 0x104fa708))
        self.assertEqual(decode_instruction(bytes.fromhex('83c0ff') + bytes(12), 0).operands, ('eax', -1))
        with self.assertRaisesRegex(SkillDispatchReplayError, 'c3'):
            decode_instruction(bytes.fromhex('c3') + bytes(14), 0x104ef523)


class SampledBindingByteReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_bytes = reference_client_bytes()
        cls.recipe = json.loads(RECIPE_PATH.read_text(encoding='utf-8'))

    def test_every_pinned_table_slice_hashes_to_the_engine_bytes(self):
        for table in self.recipe['tables']:
            for entry in table['slices']:
                self.assertEqual(table_slice_sha256(self.client_bytes, entry), entry['sha256'], f'{table["id"]} {entry["va"]}')

    def test_every_binding_of_the_sample_rows_recomputes_its_case_and_class_from_the_engine_bytes(self):
        recomputed = 0
        for skill_id, level, bindings in sample_rows(self.recipe):
            self.assertTrue(bindings, f'skill {skill_id} level {level} has no binding')
            for binding in bindings:
                case_va, class_name = recompute_candidate_binding(self.client_bytes, self.recipe, binding, skill_id, level)
                self.assertEqual((case_va, class_name), (int(binding['resolvedCaseVA'] or binding['caseVA'], 16), binding['effectObject']))
                recomputed += 1
        self.assertGreaterEqual(recomputed, len(SAMPLE_SKILL_IDS))

    def test_the_index_shifted_by_one_fails_for_at_least_one_sampled_binding(self):
        failures = 0
        for skill_id, level, bindings in sample_rows(self.recipe):
            for binding in bindings:
                try:
                    case_va, class_name = recompute_candidate_binding(self.client_bytes, self.recipe, binding, skill_id, level, index_shift=1)
                except SkillDispatchReplayError:
                    failures += 1
                    continue
                failures += (case_va, class_name) != (int(binding['resolvedCaseVA'] or binding['caseVA'], 16), binding['effectObject'])
        self.assertGreater(failures, 0)


if __name__ == '__main__':
    unittest.main()
