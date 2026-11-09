from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.ue2 import FormatError
from world.static_placement import gltf_placement, resolved_static_values, rotation_rows, static_matrix
from world.terrain_coordinates import native_to_gltf


def row_point(matrix, point):
    return [sum([*point, 1][i]*matrix[i][j] for i in range(4)) for j in range(3)]


class StaticPlacementTests(unittest.TestCase):
    def values(self):
        return {name: {'value': value} for name, value in {
            'Location': {'X': 1000, 'Y': -2000, 'Z': 50}, 'PrePivot': {'X': 3, 'Y': 4, 'Z': 5},
            'DrawScale': 2, 'DrawScale3D': {'X': 1, 'Y': 2, 'Z': -1},
            'Rotation': {'Pitch': 0, 'Yaw': 16384, 'Roll': 0}}.items()}

    def test_prepivot_is_removed_before_scale_rotation_and_translation(self):
        matrix = static_matrix(self.values())
        for actual, expected in zip(row_point(matrix, [3, 4, 5]), [1000, -2000, 50]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip(row_point(matrix, [4, 4, 5]), [1000, -1998, 50]):
            self.assertAlmostEqual(actual, expected)

    def test_basis_conjugation_does_not_scale_existing_gltf_mesh_twice(self):
        native = static_matrix(self.values())
        flattened = gltf_placement(native)
        gltf_rows = [flattened[i:i+4] for i in range(0, 16, 4)]
        local_native = [12, -3, 14]
        actual = row_point(gltf_rows, native_to_gltf(local_native))
        expected = native_to_gltf(row_point(native, local_native))
        for a, b in zip(actual, expected):
            self.assertAlmostEqual(a, b)

    def test_rotation_uses_native_table_quantization(self):
        self.assertEqual(rotation_rows({'Pitch': 0, 'Yaw': 16384, 'Roll': 0}),
                         rotation_rows({'Pitch': 0, 'Yaw': 16387, 'Roll': 0}))
        self.assertNotEqual(rotation_rows({'Pitch': 0, 'Yaw': 16384, 'Roll': 0}),
                            rotation_rows({'Pitch': 0, 'Yaw': 16388, 'Roll': 0}))

    def test_exact_class_defaults_and_zero_initialization_are_attributed(self):
        evidence = {'Engine.Actor': {'defaults': {'DrawScale': 1, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1}}},
                    'Engine.StaticMeshActor': {'superClass': 'Actor', 'defaults': {}}}
        actor = {'classObject': 'Engine.StaticMeshActor', 'sourceTransform': {name: {'status': 'omitted-class-default-unresolved'}
                 for name in ('Location', 'Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D')}}
        result = resolved_static_values(actor, evidence)
        self.assertEqual(result['DrawScale']['source'], 'Engine.Actor')
        self.assertEqual(result['PrePivot']['source'], 'native-declared-field-zero-init')
        actor['classObject'] = 'Custom.StaticMeshActor'
        with self.assertRaises(FormatError):
            resolved_static_values(actor, evidence)


if __name__ == '__main__':
    unittest.main()
