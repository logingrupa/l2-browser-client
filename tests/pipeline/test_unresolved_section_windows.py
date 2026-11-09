import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_map import validate_recipe

HAND_CHOSEN_WINDOW_REASON = 'hand-chosen-presentation-window'
CHUNK_PLANNER_PATH = 'scripts/world/tile_chunk_plan.py'
HAND_CHOSEN_WINDOW_POINTERS = {
    'recipes/native-map-20_20.json': ['/section/min', '/section/max'],
    'recipes/native-map-debug-location.json': ['/terrainSectorRectangle', '/staticActorOriginZ'],
}
XY_WINDOW_POINTERS = ('/section/min', '/section/max', '/terrainSectorRectangle')
UNRESOLVED_RECORD_FIELDS = {'pointer', 'reason', 'statement', 'replacement'}


def read_recipe(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding='utf-8'))


def resolve_json_pointer(document, pointer):
    value = document
    for token in pointer.split('/')[1:]:
        token = token.replace('~1', '/').replace('~0', '~')
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


class UnresolvedSectionWindowTests(unittest.TestCase):
    def test_every_hand_chosen_window_value_is_labelled_unresolved_and_nothing_else_is(self):
        for relative_path, expected_pointers in HAND_CHOSEN_WINDOW_POINTERS.items():
            with self.subTest(recipe=relative_path):
                recipe = read_recipe(relative_path)
                self.assertEqual(list(recipe)[-1], 'unresolved')
                records = recipe['unresolved']
                self.assertEqual([record['pointer'] for record in records], expected_pointers)
                for record in records:
                    self.assertEqual(set(record), UNRESOLVED_RECORD_FIELDS)
                    self.assertIsNotNone(resolve_json_pointer(recipe, record['pointer']))
                    self.assertEqual(record['reason'], HAND_CHOSEN_WINDOW_REASON)
                    self.assertIn('not a source value', record['statement'])
                    self.assertTrue(record['replacement'].strip())
                    if record['pointer'] in XY_WINDOW_POINTERS:
                        self.assertIn(CHUNK_PLANNER_PATH, record['replacement'])

    def test_the_labelled_raw_recipe_still_validates_with_its_window_values(self):
        recipe = read_recipe('recipes/native-map-20_20.json')
        validate_recipe(recipe)
        self.assertEqual((recipe['section']['min'], recipe['section']['max']), ([13000, 73500], [25000, 85500]))
        section_recipe = read_recipe('recipes/native-map-debug-location.json')
        self.assertEqual(section_recipe['terrainSectorRectangle'], {'minOffset': [64, 208], 'maxOffset': [96, 240]})
        self.assertEqual(section_recipe['staticActorOriginZ'], [-4000, -2500])


if __name__ == '__main__':
    unittest.main()
