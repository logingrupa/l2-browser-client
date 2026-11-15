import math
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from support.actor_class_defaults import SyntheticActorClassDefaults
from world.static_placement import gltf_placement, resolved_static_values, rotation_rows, static_matrix
from world.terrain_coordinates import native_to_gltf


FRACTION_BITS = 192
PI_DECIMAL_DIGITS = '31415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679'
SCALED_PI = (int(PI_DECIMAL_DIGITS) << FRACTION_BITS) // 10**(len(PI_DECIMAL_DIGITS) - 1)


def row_point(matrix, point):
    return [sum([*point, 1][i]*matrix[i][j] for i in range(4)) for j in range(3)]


def exactly_scaled(value):
    numerator, denominator = value.as_integer_ratio()
    return (numerator << FRACTION_BITS) // denominator


def scaled_sine(scaled_angle):
    reduced, sign = scaled_angle, 1
    if reduced > SCALED_PI:
        reduced, sign = reduced - SCALED_PI, -1
    if reduced > SCALED_PI >> 1:
        reduced = SCALED_PI - reduced
    squared = (reduced*reduced) >> FRACTION_BITS
    term, total, order = reduced, reduced, 1
    while term:
        term = -((term*squared) >> FRACTION_BITS) // (2*order*(2*order + 1))
        total += term
        order += 1
    return sign*total


def float32_step(value, steps):
    bits = struct.unpack('<i', struct.pack('<f', value))[0]
    return struct.unpack('<f', struct.pack('<i', bits + steps))[0]


def builder_table_entry(entry):
    sine = scaled_sine(exactly_scaled(entry*2*math.pi/16384))
    if sine == 0:
        return 0.0
    magnitude = abs(sine)
    nearest = struct.unpack('<f', struct.pack('<f', magnitude / (1 << FRACTION_BITS)))[0]
    lower, upper = (exactly_scaled((float32_step(nearest, -1) + nearest)/2), exactly_scaled((nearest + float32_step(nearest, 1))/2))
    margin = magnitude >> 50
    if not (magnitude - lower > margin and upper - magnitude > margin):
        raise ValueError(f'sine table entry {entry} lies within 2^-50 of a float32 rounding midpoint')
    return nearest if sine > 0 else -nearest


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

    def test_rotation_table_equals_the_core_dll_global_math_builder_at_every_entry(self):
        differing = [entry for entry in range(16384)
                     if rotation_rows({'Pitch': entry*4, 'Yaw': 0, 'Roll': 0})[0][2] != builder_table_entry(entry)]
        self.assertEqual(differing, [])

    def test_exact_class_defaults_and_zero_initialization_are_attributed(self):
        evidence = SyntheticActorClassDefaults()
        actor = {'classObject': 'Engine.StaticMeshActor', 'sourceTransform': {name: {'status': 'omitted-class-default-unresolved'}
                 for name in ('Location', 'Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D')}}
        result = resolved_static_values(actor, evidence)
        self.assertEqual((result['DrawScale']['source'], result['DrawScale']['provenance']), ('Engine.Actor', 'class-default'))
        self.assertEqual((result['PrePivot']['value'], result['PrePivot']['provenance']), ({'X': 0, 'Y': 0, 'Z': 0}, 'ue-zero'))
        actor['classObject'] = 'Custom.StaticMeshActor'
        with self.assertRaises(FormatError):
            resolved_static_values(actor, evidence)


if __name__ == '__main__':
    unittest.main()
