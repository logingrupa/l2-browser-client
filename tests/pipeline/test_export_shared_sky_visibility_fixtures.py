import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_shared_sky_visibility_fixtures import (SHARED_SKY_NODES_SHA256, SKY_DRAW_ORDER_SHA256, VIEW_FRUSTUM_SHA256, level_tail_rules,
                                                         material_routes)
from world.shared_sky_visibility_rules import (SharedSkyVisibilityRulesError, material_requires_sorting, read_shared_sky_visibility_rules,
                                               validate_shared_sky_visibility_rules)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'environment' / 'shared-sky-visibility-fixtures.json'
FIXTURES_FILE_SHA256 = '7586d71fb14ad1eff5fb2e8f49bf7c189e2e1a84550f5924c93ae05630294ead'
RULES_FILE_SHA256 = '646156c47fea548a0a48c1e5ac4a4a9161dd77cad035c3dc40658b4c405aa4a6'
FIXTURES = json.loads(FIXTURES_FILE.read_bytes())


class CommittedSharedSkyVisibilityFixturesTests(unittest.TestCase):
    def test_the_committed_fixture_and_rules_come_from_the_pinned_rm22_rm23_and_rm24_answers(self):
        self.assertEqual(hashlib.sha256(FIXTURES_FILE.read_bytes()).hexdigest(), FIXTURES_FILE_SHA256)
        self.assertEqual(read_shared_sky_visibility_rules()['sha256'], RULES_FILE_SHA256)
        self.assertEqual(FIXTURES['sources'], {'sharedSkyNodes': SHARED_SKY_NODES_SHA256, 'viewFrustum': VIEW_FRUSTUM_SHA256,
                                               'skyDrawOrder': SKY_DRAW_ORDER_SHA256})

    def test_the_fixture_holds_the_682_submitted_nodes_and_the_679_ordered_draws_with_one_actor_slot(self):
        self.assertEqual(len(FIXTURES['submittedNodes']), len(set(FIXTURES['submittedNodes'])))
        draws = FIXTURES['orderedDraws']
        drawn_nodes = sorted(node for draw in draws for node in draw['nodeIndices'])
        self.assertEqual(drawn_nodes, FIXTURES['submittedNodes'])
        self.assertEqual([draw['route'] for draw in draws].count('actor'), 1)
        self.assertEqual(draws[0]['route'], 'unsorted-section')

    def test_every_drawn_material_has_one_route_in_the_rules_and_the_background_alone_writes_depth(self):
        rules = read_shared_sky_visibility_rules()['document']
        for row in rules['materialSorting']:
            with self.subTest(material=row['material']):
                self.assertEqual(row['renderState']['ZWRITEENABLE'] == 1, not row['requiresSorting'])
        self.assertIsNone(material_requires_sorting('L2_Skies.Shaders.Cloud_Final01_sh'))
        self.assertEqual(rules['depthClear']['flags'], 2)


class SharedSkyVisibilityRuleGuardTests(unittest.TestCase):
    def test_a_material_drawn_by_both_routes_is_refused(self):
        draws = [{'drawIndex': 0, 'route': 'sorted-bsp', 'material': 'M'}, {'drawIndex': 1, 'route': 'unsorted-section', 'material': 'M'}]
        with self.assertRaisesRegex(DayNightFixtureError, 'both the sorted and the unsorted route'):
            material_routes({'orderedDraws': draws})

    def test_a_ulevel_serialize_pseudocode_without_its_gates_is_refused(self):
        answer = {'functions': [{'va': '0x105d07f0', 'name': 'ULevel::Serialize', 'pseudocode': ''}], 'unresolved': [], 'claims': []}
        with self.assertRaisesRegex(DayNightFixtureError, 'lacks its FirstDeleted'):
            level_tail_rules(answer)

    def test_a_rules_document_with_a_repeated_material_or_backwards_gates_is_refused(self):
        document = read_shared_sky_visibility_rules()['document']
        repeated = copy.deepcopy(document)
        repeated['materialSorting'].append(dict(repeated['materialSorting'][0]))
        backwards = copy.deepcopy(document)
        backwards['levelTail']['stringArrayMigrationFromVersion'] = backwards['levelTail']['stringMapFromVersion'] + 1
        for changed, message in ((repeated, 'repeats a material'), (backwards, 'run backwards')):
            with self.subTest(message=message), self.assertRaisesRegex(SharedSkyVisibilityRulesError, message):
                validate_shared_sky_visibility_rules(changed)


if __name__ == '__main__':
    unittest.main()
