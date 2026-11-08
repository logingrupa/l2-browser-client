import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
DISCRIMINATING_CASES_PATH = ROOT / 'tests' / 'fixtures' / 'world-07' / 'discriminating-cases.json'
OBSERVED_SHARED_EDGE_CASES = {
    'base-only-next-to-layer-6': {'sharedEdge': [955, 1004], 'layersByTriangle': {'955,1004,1005': [0], '954,955,1004': [0, 6]}},
    'layer-1-near-layer-6-boundary': {'sharedEdge': [1863, 1912],
                                      'layersByTriangle': {'1863,1912,1913': [0, 1, 2], '1862,1863,1912': [0, 1, 2, 6]}},
}
OBSERVED_SPARSE_OVERLAY = ('1831,1832,1881', [0, 7])
OBSERVED_SEVEN_LAYER_ORDER = ('926,927,976', [0, 2, 3, 4, 5, 6, 7])
OBSERVED_SPLIT_LAYER = 6
OBSERVED_SPLIT_DRAWS = {142250: 900, 142255: 300}


def load_discriminating_cases():
    return json.loads(DISCRIMINATING_CASES_PATH.read_text(encoding='utf-8'))


def collect_fixture_triangles(value):
    if isinstance(value, list):
        return [triangle for item in value for triangle in collect_fixture_triangles(item)]
    if not isinstance(value, dict):
        return []
    own_triangle = [value] if 'layers' in value and 'sourceIndices' in value else []
    return own_triangle + [triangle for field_value in value.values() for triangle in collect_fixture_triangles(field_value)]


def require_observed_layer_list(triangle):
    layers = triangle['layers']
    if not layers:
        raise AssertionError(f'triangle {triangle["key"]} has an empty layer list')
    if layers[0] != 0:
        raise AssertionError(f'triangle {triangle["key"]} layer list does not start with the base layer 0: {layers}')
    if any(later <= earlier for earlier, later in zip(layers, layers[1:])):
        raise AssertionError(f'triangle {triangle["key"]} layer list is not strictly ascending: {layers}')
    occurrence_layers = [occurrence['layer'] for occurrence in triangle['occurrences']]
    if occurrence_layers != layers:
        raise AssertionError(f'triangle {triangle["key"]} layer list {layers} differs from its submission order {occurrence_layers}')
    return layers


class ObservedLayerListTest(unittest.TestCase):
    def setUp(self):
        self.cases = load_discriminating_cases()

    def test_fixture_holds_the_four_case_groups(self):
        self.assertEqual(sorted(self.cases), ['adjacent', 'sevenLayers', 'sparseOverlay', 'splitGroups'])

    def test_every_fixture_triangle_has_a_non_empty_ascending_list_from_the_base_layer(self):
        triangles = collect_fixture_triangles(self.cases)
        self.assertEqual(len(triangles), 10)
        for triangle in triangles:
            with self.subTest(triangle=triangle['key']):
                require_observed_layer_list(triangle)

    def test_a_triangle_with_an_empty_layer_list_fails(self):
        with self.assertRaisesRegex(AssertionError, 'empty layer list'):
            require_observed_layer_list({'key': '1,2,3', 'layers': [], 'occurrences': []})

    def test_a_reordered_or_repeated_layer_list_fails(self):
        for layers in ([0, 6, 2], [0, 2, 2], [2, 6]):
            with self.subTest(layers=layers):
                occurrences = [{'layer': layer} for layer in layers]
                with self.assertRaises(AssertionError):
                    require_observed_layer_list({'key': '1,2,3', 'layers': layers, 'occurrences': occurrences})


class SharedEdgeAdjacencyTest(unittest.TestCase):
    def test_each_triangle_keeps_its_own_layer_list_across_the_shared_edge(self):
        cases_by_id = {case['id']: case for case in load_discriminating_cases()['adjacent']}
        self.assertEqual(sorted(cases_by_id), sorted(OBSERVED_SHARED_EDGE_CASES))
        for case_id, observed in OBSERVED_SHARED_EDGE_CASES.items():
            with self.subTest(case=case_id):
                case = cases_by_id[case_id]
                self.assertEqual(case['sharedEdgeSourceIndices'], observed['sharedEdge'])
                layers_by_triangle = {triangle['key']: triangle['layers'] for triangle in case['triangles']}
                self.assertEqual(layers_by_triangle, observed['layersByTriangle'])
                for triangle in case['triangles']:
                    self.assertTrue(set(observed['sharedEdge']) <= set(triangle['sourceIndices']), triangle['key'])
                first_layers, second_layers = layers_by_triangle.values()
                self.assertNotEqual(first_layers, second_layers)


class SparseAndOrderedLayerTest(unittest.TestCase):
    def test_sparse_overlay_keeps_a_later_layer_without_the_intermediate_layers(self):
        triangle = load_discriminating_cases()['sparseOverlay']
        self.assertEqual((triangle['key'], triangle['layers']), OBSERVED_SPARSE_OVERLAY)

    def test_seven_layer_triangle_keeps_the_submission_order(self):
        triangle = load_discriminating_cases()['sevenLayers']
        self.assertEqual((triangle['key'], triangle['layers']), OBSERVED_SEVEN_LAYER_ORDER)


class SplitLayerGroupTest(unittest.TestCase):
    def test_two_draws_of_one_source_layer_select_disjoint_triangles(self):
        split_groups = {group['layer']: group for group in load_discriminating_cases()['splitGroups']}
        layer_group = split_groups[OBSERVED_SPLIT_LAYER]
        selected_counts = {group['draw']: group['selectedTriangleCount'] for group in layer_group['groups']}
        self.assertEqual(selected_counts, OBSERVED_SPLIT_DRAWS)
        shared_by_draw_pair = {tuple(entry['draws']): entry for entry in layer_group['sharedTriangles']}
        observed_pair = shared_by_draw_pair[tuple(sorted(OBSERVED_SPLIT_DRAWS))]
        self.assertEqual((observed_pair['sharedSelectedTriangles'], observed_pair['witnessKeys']), (0, []))


if __name__ == '__main__':
    unittest.main()
