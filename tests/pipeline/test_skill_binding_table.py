from pathlib import Path
import sys
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors.skill_binding_table import (SKILL_BINDING_ROW_FIELDS, SKILL_BINDING_STATUSES, build_skill_binding_rows,
                                        reviewed_source_dispatch_keys)


def skill_row(skill_id, level, description):
    return {'skill_id': skill_id, 'skill_level': level, 'description': description, 'mp_consume': 10, 'cast_range': 600,
            'hit_time': 5.0, 'icon': 'icon.skill1011'}


def sound_row(skill_id, level):
    return {'skill_id': skill_id, 'skill_level': level, 'spelleffect_sound_1': 'SkillSound.heal_cast', 'spelleffect_sound_vol_1': 250.0}


class VisualRootBindingTests(unittest.TestCase):
    def test_a_qualified_description_with_one_exact_sound_row_binds_the_visual_root_and_the_sound_row_ordinal(self):
        rows = build_skill_binding_rows([skill_row(1011, 1, 'skill.wh.1011')], [sound_row(4, 1), sound_row(1011, 1)], frozenset())
        self.assertEqual(rows, [{'key': 'skill:1011:1', 'skillId': 1011, 'level': 1, 'status': 'visual-root', 'visualRoot': 'skill.wh.1011',
                                 'soundRowOrdinal': 1, 'soundReason': None, 'reason': None}])
        self.assertIn(rows[0]['status'], SKILL_BINDING_STATUSES)
        self.assertEqual(tuple(rows[0]), SKILL_BINDING_ROW_FIELDS)

    def test_power_strike_is_the_reviewed_source_dispatch_key_read_from_its_recipe(self):
        self.assertEqual(reviewed_source_dispatch_keys(REPOSITORY_ROOT), frozenset({'skill:3:1'}))


if __name__ == '__main__':
    unittest.main()
