import copy
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.ue2 import FormatError
from native_map_overlap import (parse_glb, select_overlaps, source_placement,
                                transform_positions, triangle_rectangle_overlap)


def glb_fixture(positions=((0, 0, 0), (1, 0, 0), (0, 0, 1)), indices=(0, 1, 2), mutate=None):
    # Interleaved POSITION with a sentinel word verifies byteStride handling.
    binary = struct.pack('<3H', *indices)+b'\0\0'
    binary += b''.join(struct.pack('<3fI', *p, 0xdeadbeef) for p in positions)
    doc = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 6},
                           {'buffer': 0, 'byteOffset': 8, 'byteLength': len(binary)-8, 'byteStride': 16}],
           'accessors': [{'bufferView': 0, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'},
                         {'bufferView': 1, 'componentType': 5126, 'count': 3, 'type': 'VEC3'}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 1}, 'indices': 0}]}],
           'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0}
    if mutate:
        mutate(doc)
    payload = json.dumps(doc, separators=(',', ':')).encode()
    payload += b' '*(-len(payload) % 4)
    return (struct.pack('<III', 0x46546c67, 2, 28+len(payload)+len(binary))+
            struct.pack('<I4s', len(payload), b'JSON')+payload+
            struct.pack('<I4s', len(binary), b'BIN\0')+binary)


def actor(number, location, source='Pkg.Tree', rotation=None, scale3=None, pivot=None):
    fields = {name: {'status': 'omitted-class-default-unresolved'}
              for name in ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')}
    fields['Location'] = {'status': 'serialized', 'value': dict(zip('XYZ', location))}
    for name, value in (('Rotation', rotation), ('DrawScale3D', scale3), ('PrePivot', pivot)):
        if value is not None:
            fields[name] = {'status': 'serialized', 'value': value}
    return {'id': f'interlude:Map.StaticMeshActor{number}', 'object': f'Map.StaticMeshActor{number}',
            'class': 'StaticMeshActor', 'classObject': 'Engine.StaticMeshActor', 'exportIndex': number,
            'staticMesh': {'object': source}, 'sourceTransform': fields, 'materialOverrides': []}


EVIDENCE = {'Engine.Actor': {'defaults': {'DrawScale': 1, 'DrawScale3D': dict.fromkeys('XYZ', 1)}},
            'Engine.StaticMeshActor': {'defaults': {}, 'superClass': 'Actor'}}
MODEL = {'id': 'interlude:Pkg.Tree', 'sourceObject': 'Pkg.Tree',
         'model': {'sha256': 'a'*64, 'file': 'model/model.glb'}}


class TriangleRectangleTests(unittest.TestCase):
    def test_crossing_triangle_without_inside_vertex_and_winding(self):
        triangle = [[-1, 3, .25], [2, 6, .25], [.5, 9, 2]]
        polygon, area = triangle_rectangle_overlap(triangle, [0, 0, 1, 1])
        reverse, reverse_area = triangle_rectangle_overlap(list(reversed(triangle)), [0, 0, 1, 1])
        self.assertGreater(area, 0)
        self.assertAlmostEqual(area, reverse_area)
        self.assertTrue(all(0 <= p[0] <= 1 and 0 <= p[2] <= 1 for p in polygon+reverse))
        self.assertTrue(all(3 <= p[1] <= 9 for p in polygon))

    def test_aabb_false_positive_does_not_select_triangle(self):
        # Bounding box covers the rectangle, but the triangle lies beyond x+z=2.
        triangle = [[0, 0, 2], [2, 0, 0], [2, 0, 2]]
        self.assertEqual(triangle_rectangle_overlap(triangle, [0, 0, .5, .5]), ([], 0))

    def test_boundary_contacts_and_vertical_faces_do_not_qualify(self):
        for triangle in ([[1, 0, 0], [2, 0, 0], [1, 0, 1]],
                         [[1, 0, 1], [2, 0, 1], [1, 0, 2]],
                         [[.5, 0, .2], [.5, 1, .8], [.5, 2, .5]]):
            with self.subTest(triangle=triangle):
                self.assertEqual(triangle_rectangle_overlap(triangle, [0, 0, 1, 1]), ([], 0))

    def test_small_positive_area_is_not_removed_by_hidden_epsilon(self):
        polygon, area = triangle_rectangle_overlap([[0, 0, 0], [1e-9, 0, 0], [0, 0, 1e-9]], [0, 0, 1, 1])
        self.assertEqual(len(polygon), 3)
        self.assertGreater(area, 0)

    def test_nonfinite_reversed_and_degenerate_input_rejected(self):
        for rectangle in ([1, 0, 0, 1], [0, 0, 0, 1], [0, 0, float('inf'), 1]):
            with self.assertRaises(FormatError):
                triangle_rectangle_overlap([[0, 0, 0], [1, 0, 0], [0, 0, 1]], rectangle)
        with self.assertRaises(FormatError):
            triangle_rectangle_overlap([[0, 0, 0], [float('nan'), 0, 0], [0, 0, 1]], [0, 0, 1, 1])


class StaticGlbTests(unittest.TestCase):
    def test_interleaved_positions_and_indexed_triangle(self):
        primitives = parse_glb(glb_fixture())
        self.assertEqual(primitives, [{'mesh': 0, 'primitive': 0,
                                      'positions': [(0, 0, 0), (1, 0, 0), (0, 0, 1)],
                                      'indices': [0, 1, 2]}])

    def test_transforms_hierarchies_compression_and_deformation_fail_closed(self):
        mutations = [lambda d: d['nodes'][0].update(translation=[1, 0, 0]),
                     lambda d: d['nodes'][0].update(children=[]),
                     lambda d: d.update(extensionsUsed=['KHR_draco_mesh_compression']),
                     lambda d: d['meshes'][0]['primitives'][0].update(mode=5),
                     lambda d: d['meshes'][0]['primitives'][0].update(targets=[{'POSITION': 1}]),
                     lambda d: d['scenes'][0].update(nodes=[]),
                     lambda d: d['accessors'][1].update(sparse={'count': 1}),
                     lambda d: d['accessors'][1].update(normalized=True)]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(FormatError):
                parse_glb(glb_fixture(mutate=mutate))

    def test_corrupt_ranges_indices_and_nonfinite_geometry_fail_closed(self):
        mutations = [lambda d: d['accessors'][1].update(count=4),
                     lambda d: d['accessors'][1].update(byteOffset=2),
                     lambda d: d['bufferViews'][1].update(byteStride=8),
                     lambda d: d['accessors'][0].update(componentType=5126),
                     lambda d: d['buffers'][0].update(byteLength=9999)]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(FormatError):
                parse_glb(glb_fixture(mutate=mutate))
        with self.assertRaises(FormatError):
            parse_glb(glb_fixture(indices=(0, 1, 3)))
        with self.assertRaises(FormatError):
            parse_glb(glb_fixture(positions=((0, 0, 0), (1, float('nan'), 0), (0, 0, 1))))
        with self.assertRaises(FormatError):
            parse_glb(glb_fixture()+b'\0\0\0\0')


class PlacementAndSelectionTests(unittest.TestCase):
    def setup_inputs(self):
        original = actor(1, [50, 50, 0])
        runtime = {'models': [copy.deepcopy(MODEL)],
                   'placements': [source_placement(original, MODEL, EVIDENCE)]}
        geometry = {'selectedRegion': {'bounds': [0, 0, -100, 100, 100, 100]},
                    'recipe': {'staticActorOriginZ': [-100, 100]}, 'nativeDefaultEvidence': EVIDENCE}
        return original, runtime, geometry

    def test_source_rotation_scale_prepivot_and_units_are_applied_once(self):
        a = actor(1, [100, 200, 300], rotation={'Pitch': 0, 'Yaw': 16384, 'Roll': 0},
                  scale3={'X': 2, 'Y': 3, 'Z': 4}, pivot={'X': 10, 'Y': 20, 'Z': 30})
        placement = source_placement(a, MODEL, EVIDENCE)
        # glTF local [0.2,0.4,0.3] is native [20,30,40]. Subtract pivot,
        # scale -> [20,30,40], rotate +90 Z -> [-30,20,40], translate.
        point = transform_positions([[.2, .4, .3]], placement['matrix'])[0]
        for value, expected in zip(point, [.7, 3.4, 2.2]):
            self.assertAlmostEqual(value, expected, places=10)
        with self.assertRaises(FormatError):
            transform_positions([[0, 0, 0]], [float('nan')]*16)

    def test_partial_census_additive_selection_and_repeat_are_deterministic(self):
        original, runtime, geometry = self.setup_inputs()
        overlap = actor(2, [150, 50, 0])
        miss = actor(3, [500, 50, 0])
        unknown = actor(4, [150, 50, 0], source='Pkg.Unknown')
        outside_z = actor(5, [150, 50, 101])
        mesh = parse_glb(glb_fixture(positions=((-1, 0, -.25), (0, 0, -.25), (-1, 0, .25))))
        actors = [outside_z, unknown, miss, overlap, original]
        before = copy.deepcopy(runtime)
        result = select_overlaps(actors, runtime, geometry, lambda m: mesh)
        self.assertEqual(runtime, before)
        self.assertEqual([a['id'] for a in result['additions']], [overlap['id']])
        self.assertEqual(result['census']['originInsideXY'], 1)
        self.assertEqual(result['census']['outsideSourceZWindow'], 1)
        self.assertEqual(result['census']['evaluatedOutsideOrigins'], 2)
        self.assertEqual(result['census']['notEvaluatedMissingConvertedModel'], 1)
        self.assertEqual(result['census']['evaluatedNoPositiveAreaIntersection'], 1)
        self.assertEqual(result['witnesses'][0]['intersectingTriangles'], 1)
        self.assertEqual(result, select_overlaps(list(reversed(actors)), runtime, geometry, lambda m: mesh))
        runtime['placements'] += result['additions']
        again = select_overlaps(actors, runtime, geometry, lambda m: mesh)
        self.assertEqual(again['additions'], [])
        self.assertTrue(again['witnesses'][0]['alreadyPresent'])

    def test_known_model_error_is_not_silently_reclassified_as_missing(self):
        original, runtime, geometry = self.setup_inputs()
        def broken_loader(model):
            raise FormatError('corrupt known GLB')
        with self.assertRaisesRegex(FormatError, 'corrupt known GLB'):
            select_overlaps([original, actor(2, [150, 50, 0])], runtime, geometry, broken_loader)

    def test_duplicate_identity_or_existing_source_drift_fails(self):
        original, runtime, geometry = self.setup_inputs()
        with self.assertRaises(FormatError):
            select_overlaps([original, original], runtime, geometry, lambda m: [])
        runtime['placements'][0]['matrix'][12] += 1
        with self.assertRaisesRegex(FormatError, 'differs from retained source'):
            select_overlaps([original], runtime, geometry, lambda m: [])


if __name__ == '__main__':
    unittest.main()
