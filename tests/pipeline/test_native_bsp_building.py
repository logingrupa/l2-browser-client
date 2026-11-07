"""Command-hall regressions against the retained, unchanged native map."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_bsp_building import PARTS, build, building_nodes, convex_triangles
from native_catalog.ue2 import FormatError
from native_map_overlap import parse_glb

MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
MODEL_SHA = 'be427963ce1dfe4a7bf75f5eae7b09911805023827f175aa0bf9ccb1e7d43653'
PNG_SHA = {
    'walls': '09dc1510d8017f3dd0c3fbcac7cf98e9e7d87f09de00959d7273e955f8d3699a',
    'floor': '6744287c6d61d253881def76ce3038e428bab58d65f38a4a36a07f08d165ed4d',
    'ceiling': 'f98adcdfde88c93dab9b0cd3a4db7d037c941b8e5edaf0df7f8aa419b8e632ef',
}
NODE_IDS = {'walls': (1448, 1449, 1451, 1452, 1454, 1455, 1458, 1459),
            'floor': (1457,), 'ceiling': (1456,)}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def sub(a, b):
    return [x-y for x, y in zip(a, b)]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def ray_hits(mesh, origin, direction):
    hits = []
    for offset in range(0, len(mesh['indices']), 3):
        a, b, c = [mesh['positions'][i] for i in mesh['indices'][offset:offset+3]]
        edge1, edge2 = sub(b, a), sub(c, a)
        h = cross(direction, edge2)
        determinant = dot(edge1, h)
        if abs(determinant) < 1e-10:
            continue
        delta = sub(origin, a)
        u = dot(delta, h)/determinant
        q = cross(delta, edge1)
        v, distance = dot(direction, q)/determinant, dot(edge2, q)/determinant
        if 0 <= u <= 1 and 0 <= v and u+v <= 1 and distance > 0:
            hits.append(distance)
    return sorted(hits)


class BuildingTriangulationTests(unittest.TestCase):
    def test_collinear_boundary_vertices_preserve_full_area_and_facing(self):
        # A fan from vertex zero would produce degenerate triangles here.
        points = [[0, 0, 0], [2, 0, 0], [4, 0, 0], [4, 2, 0],
                  [4, 4, 0], [2, 4, 0], [0, 4, 0], [0, 2, 0]]
        indices = convex_triangles(points, [0, 0, 1])
        self.assertEqual(len(indices)//3, len(points)-2)
        self.assertEqual(set(indices), set(range(len(points))))
        area = 0
        for offset in range(0, len(indices), 3):
            a, b, c = [points[i] for i in indices[offset:offset+3]]
            twice_area = cross(sub(b, a), sub(c, a))[2]
            self.assertLess(twice_area, 0)  # the declared single XZY reflection
            area += abs(twice_area)/2
            reflected = [[p[0], p[2], p[1]] for p in (a, b, c)]
            self.assertGreater(dot(cross(sub(reflected[1], reflected[0]),
                                         sub(reflected[2], reflected[0])), [0, 1, 0]), 0)
        self.assertEqual(area, 16)

    def test_reversed_nonplanar_and_concave_boundaries_are_rejected(self):
        cases = {
            'Reversed': [[0, 0, 0], [0, 4, 0], [4, 4, 0], [4, 0, 0]],
            'Nonplanar': [[0, 0, 0], [4, 0, 0], [4, 4, 1e-20], [0, 4, 0]],
            'Nonconvex': [[0, 0, 0], [4, 0, 0], [1, 1, 0], [0, 4, 0]],
        }
        for reason, points in cases.items():
            with self.subTest(reason=reason), self.assertRaisesRegex(FormatError, reason):
                convex_triangles(points, [0, 0, 1])

    def test_unqualified_source_is_refused_before_parsing(self):
        with self.assertRaisesRegex(FormatError, 'qualified original'):
            building_nodes(b'not the pinned original map')


class RetainedBuildingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
        cls.bundle = ROOT/'public/l2/maps/93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66'
        paths = [cls.client/'maps/20_20.unr',
                 cls.client/'textures/l2fortress_01_t.utx',
                 *[cls.bundle/part['glb'] for part in PARTS.values()]]
        if not all(path.is_file() for path in paths):
            raise unittest.SkipTest('Private pinned native map/texture inputs are unavailable')
        cls.input_hashes = {path: sha(path.read_bytes()) for path in paths}
        cls.files = build(cls.client, cls.bundle)
        cls.parts = {name: json.loads(cls.files[f'bsp-command-{name}.json']) for name in NODE_IDS}

    def test_original_map_model_binding_and_ten_final_nodes_are_retained(self):
        totals = {'nodes': 0, 'vertices': 0, 'triangles': 0}
        for name, g in self.parts.items():
            with self.subTest(part=name):
                self.assertEqual(g['sourceBrush'], '20_20.Brush610')
                self.assertEqual(g['source']['mapSha256'], MAP_SHA)
                self.assertEqual(g['source']['modelSha256'], MODEL_SHA)
                self.assertEqual(g['source']['levelBinding']['level'], {'reference': 3, 'qualified': '20_20.myLevel'})
                self.assertEqual(g['source']['levelBinding']['model'], {'reference': 9184, 'qualified': '20_20.Model798'})
                self.assertEqual(tuple(row['node'] for row in g['nodeRanges']), NODE_IDS[name])
                self.assertTrue(all(row['sourceBrush'] == '20_20.Brush610' and
                                    row['sourceNodeFlags'] == row['sourceSurfaceFlags'] == 0
                                    for row in g['nodeRanges']))
                totals['nodes'] += len(g['nodeRanges'])
                totals['vertices'] += len(g['positions'])//3
                totals['triangles'] += len(g['indices'])//3
        self.assertEqual(totals, {'nodes': 10, 'vertices': 52, 'triangles': 32})
        self.assertEqual(json.loads(self.files['manifest.json'])['counts'], totals)
        self.assertEqual(sha((self.client/'maps/20_20.unr').read_bytes()), MAP_SHA)
        for path, before in self.input_hashes.items():
            self.assertEqual(sha(path.read_bytes()), before, str(path))

    def test_world_positions_normals_and_projected_uvs_match_original_vertices(self):
        for name, g in self.parts.items():
            with self.subTest(part=name):
                material = g['material']
                for row in g['nodeRanges']:
                    for local, native in enumerate(row['nativePositions']):
                        index = row['vertexStart']+local
                        self.assertEqual(g['positions'][index*3:index*3+3],
                                         [f32(native[0]/100), f32(native[2]/100), f32(native[1]/100)])
                        expected_normal = [f32(row['sourcePlane'][axis]) for axis in (0, 2, 1)]
                        self.assertEqual(struct.pack('<3f', *g['normals'][index*3:index*3+3]),
                                         struct.pack('<3f', *expected_normal))
                        delta = sub(native, row['nativeTextureBase'])
                        self.assertEqual(g['uvs'][index*2:index*2+2],
                                         [f32(dot(delta, row['nativeTextureU'])/material['width']),
                                          f32(dot(delta, row['nativeTextureV'])/material['height'])])
                points = [g['positions'][i:i+3] for i in range(0, len(g['positions']), 3)]
                for offset in range(0, len(g['indices']), 3):
                    a, b, c = g['indices'][offset:offset+3]
                    normal = g['normals'][a*3:a*3+3]
                    self.assertGreater(dot(cross(sub(points[b], points[a]), sub(points[c], points[a])), normal), 0)
        walls = self.parts['walls']
        self.assertEqual(walls['bounds']['min'], [f32(109.37), f32(-34.53), f32(943.87)])
        self.assertEqual(walls['bounds']['max'], [f32(121.37), f32(-31.35), f32(955.87)])

    def test_glb_channels_and_embedded_original_png_are_byte_preserved(self):
        for name, g in self.parts.items():
            with self.subTest(part=name):
                raw = self.files[f'bsp-command-{name}.glb']
                parsed = parse_glb(raw)
                self.assertEqual(len(parsed), 1)
                self.assertEqual([value for row in parsed[0]['positions'] for value in row], g['positions'])
                self.assertEqual(parsed[0]['indices'], g['indices'])
                size = struct.unpack_from('<I', raw, 12)[0]
                doc, binary = json.loads(raw[20:20+size]), raw[28+size:]
                primitive = doc['meshes'][0]['primitives'][0]
                for attribute, field, width in [('POSITION', 'positions', 3), ('NORMAL', 'normals', 3), ('TEXCOORD_0', 'uvs', 2)]:
                    accessor = doc['accessors'][primitive['attributes'][attribute]]
                    view = doc['bufferViews'][accessor['bufferView']]
                    start = view.get('byteOffset', 0)+accessor.get('byteOffset', 0)
                    expected = struct.pack('<'+str(len(g[field]))+'f', *g[field])
                    self.assertEqual(accessor['count']*width, len(g[field]))
                    self.assertEqual(binary[start:start+len(expected)], expected)
                view = doc['bufferViews'][doc['images'][0]['bufferView']]
                start = view.get('byteOffset', 0)
                png = binary[start:start+view['byteLength']]
                self.assertEqual(png, self.files[f'bsp-command-{name}.png'])
                self.assertEqual(sha(png), PNG_SHA[name])
                self.assertEqual(g['material']['textureSha256'], PNG_SHA[name])
                self.assertEqual(doc['materials'][0]['extras']['nativeSourceReference'], g['material']['sourceReference'])

    def test_original_doorway_remains_open_and_adjacent_wall_blocks_ray(self):
        mesh = parse_glb(self.files['bsp-command-walls.glb'])[0]
        self.assertEqual(ray_hits(mesh, [115.37, -34, 954], [0, 0, 1]), [])
        hits = ray_hits(mesh, [112, -34, 954], [0, 0, 1])
        self.assertTrue(hits)
        self.assertAlmostEqual(hits[0], 1.87, places=4)


if __name__ == '__main__':
    unittest.main()
