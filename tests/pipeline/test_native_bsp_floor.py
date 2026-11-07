import copy
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.ue2 import FormatError
from native_bsp_floor import (GLB_RELATIVE, MAP_SHA, MATERIAL, SELECTED_NODES, TEXTURE_SHA,
    build, cross, difference, dot, f32, geometry_from_nodes, polygon_geometry,
    sha, source_nodes, write_unchanged_or_new)
from native_map_overlap import parse_glb


def square():
    return {'nativePositions': [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]],
            'sourcePlane': [0, 0, 1, 0], 'nativeTextureBase': [1, 2, 0],
            'nativeTextureU': [0, 2, 0], 'nativeTextureV': [-2, 0, 0]}


class BspPolygonTests(unittest.TestCase):
    def test_source_projection_and_reflection_preserve_facing(self):
        positions, normals, uv, indices = polygon_geometry(square(), 8, 16)
        self.assertEqual(uv, [-.5, .125, -.5, -.375, .5, -.375, .5, .125])
        points = [positions[i:i+3] for i in range(0, len(positions), 3)]
        for offset in range(0, len(indices), 3):
            a, b, c = [points[i] for i in indices[offset:offset+3]]
            self.assertGreater(dot(cross(difference(b, a), difference(c, a)), normals[:3]), 0)
        self.assertEqual(normals, [0, 1, 0]*4)

    def test_nonconvex_and_nonplanar_geometry_refused(self):
        examples = [
            [[0, 0, 0], [4, 0, 0], [1, 1, 0], [0, 4, 0]],
            [[0, 0, 0], [4, 0, 0], [4, 4, 1e-10], [0, 4, 0]],
            [[0, 0, 0], [0, 4, 0], [4, 4, 0], [4, 0, 0]],
            [[0, 0, 0], [4, 0, 0], [4, 0, 0], [0, 4, 0]],
            [[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0]],
        ]
        for points in examples:
            node = square(); node['nativePositions'] = points
            with self.subTest(points=points), self.assertRaises(FormatError):
                polygon_geometry(node, 256, 256)

    def test_rounded_native_plane_does_not_invent_nonplanarity(self):
        # Exact diagonal rectangle, with a normal rounded to source float32.
        node = square()
        node['nativePositions'] = [[0, 0, 0], [0, 0, 33], [-328.041015625, 328.0390625, 33],
                                   [-328.041015625, 328.0390625, 0]]
        node['sourcePlane'] = [-f32(2**-.5), -f32(2**-.5), 0, 0]
        positions, _, _, indices = polygon_geometry(node, 256, 256)
        self.assertEqual(len(positions), 12)
        self.assertEqual(len(indices), 6)

    def test_unknown_source_is_rejected_before_parsing(self):
        with self.assertRaisesRegex(FormatError, 'qualified original'):
            source_nodes(b'not the qualified package')

    def test_output_is_idempotent_and_refuses_authored_changes(self):
        files = {'bsp-floor.json': b'{"v":1}', 'bsp-floor.glb': b'original'}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)/'out'
            self.assertEqual(write_unchanged_or_new(output, files), 'created')
            self.assertEqual(write_unchanged_or_new(output, files), 'unchanged')
            (output/'bsp-floor.glb').write_bytes(b'authored change')
            with self.assertRaises(FormatError):
                write_unchanged_or_new(output, files)
            self.assertEqual((output/'bsp-floor.glb').read_bytes(), b'authored change')
            self.assertEqual((output/'bsp-floor.json').read_bytes(), files['bsp-floor.json'])


class RetainedFloorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
        cls.bundle = ROOT/'public/l2/maps/fdee12862293d14bb9812eb63789aa336f91ffd18473623b6debd709bfffc3dc'
        if not (cls.client/'maps/20_20.unr').is_file() or not (cls.bundle/GLB_RELATIVE).is_file():
            raise unittest.SkipTest('Private pinned native inputs are not available')
        cls.files = build(cls.client, cls.bundle)
        cls.geometry = json.loads(cls.files['bsp-floor.json'])

    def test_actual_level_reference_and_all_selected_final_nodes(self):
        geometry = self.geometry
        self.assertEqual(geometry['source']['mapSha256'], MAP_SHA)
        binding = geometry['source']['levelBinding']
        self.assertEqual(binding['level'], {'reference': 3, 'qualified': '20_20.myLevel'})
        self.assertEqual(binding['model'], {'reference': 9184, 'qualified': '20_20.Model798'})
        self.assertEqual(binding['spans']['modelReference'], [355324, 355327])
        self.assertEqual(tuple(n['node'] for n in geometry['nodeRanges']), SELECTED_NODES)
        self.assertEqual(len(geometry['positions'])//3, 48)
        self.assertEqual(len(geometry['indices'])//3, 28)
        self.assertEqual(geometry['source']['modelValidation']['unreachableNodes'], 0)

    def test_floor_is_lower_octagon_not_the_upper_static_mesh_trim(self):
        geometry = self.geometry
        floor = next(n for n in geometry['nodeRanges'] if n['node'] == 620)
        self.assertEqual((floor['surface'], floor['vertexCount'], floor['indexCount']), (2297, 8, 18))
        self.assertEqual(floor['sourceSurfaceFlags'], 0)
        self.assertEqual(floor['sourceLightMap'], 1786)
        self.assertEqual(floor['sourceMaterial'], MATERIAL)
        start, end = floor['vertexStart']*3, (floor['vertexStart']+floor['vertexCount'])*3
        self.assertEqual(set(geometry['positions'][start+1:end:3]), {f32(-34.26)})
        self.assertEqual(floor['nativePositions'][0], [9918.958984375, 95576.0, -3426.0])
        self.assertEqual(geometry['uvs'][floor['vertexStart']*2:floor['vertexStart']*2+2],
                         [f32((95576-6416.015625)/128), f32(-(9918.958984375+9256.998046875)/128)])

    def test_every_emitted_triangle_faces_its_preserved_source_normal(self):
        g = self.geometry
        points = [g['positions'][i:i+3] for i in range(0, len(g['positions']), 3)]
        for offset in range(0, len(g['indices']), 3):
            ia, ib, ic = g['indices'][offset:offset+3]
            normal = g['normals'][ia*3:ia*3+3]
            geometric = cross(difference(points[ib], points[ia]), difference(points[ic], points[ia]))
            self.assertGreater(dot(geometric, normal), 0)

    def test_embedded_glb_arrays_and_texture_equal_json_and_original(self):
        raw = self.files['bsp-floor.glb']
        parsed = parse_glb(raw)
        self.assertEqual(len(parsed), 1)
        self.assertEqual([v for row in parsed[0]['positions'] for v in row], self.geometry['positions'])
        self.assertEqual(parsed[0]['indices'], self.geometry['indices'])
        size = struct.unpack_from('<I', raw, 12)[0]
        doc, binary = json.loads(raw[20:20+size]), raw[28+size:]
        primitive = doc['meshes'][0]['primitives'][0]
        for attribute, field, dimensions in [('NORMAL', 'normals', 3), ('TEXCOORD_0', 'uvs', 2)]:
            accessor = doc['accessors'][primitive['attributes'][attribute]]
            view = doc['bufferViews'][accessor['bufferView']]
            values = struct.unpack_from('<'+str(accessor['count']*dimensions)+'f', binary, view['byteOffset'])
            self.assertEqual(list(values), self.geometry[field])
        view = doc['bufferViews'][doc['images'][0]['bufferView']]
        png = binary[view['byteOffset']:view['byteOffset']+view['byteLength']]
        self.assertEqual(png, self.files['texture.png'])
        self.assertEqual(sha(png), TEXTURE_SHA)

    def test_native_block_declarations_retained_without_collision_parity_claim(self):
        evidence = self.geometry['collisionDeclarations']
        for flag in ('bCollideActors', 'bBlockActors', 'bBlockPlayers', 'bBlockKarma'):
            self.assertEqual(evidence['resolvedActorFlags'][flag], {'value': True, 'source': 'Engine.StaticMeshActor'})
        self.assertTrue(evidence['sourceStaticMeshSlot']['EnableCollision'])
        self.assertIn('No native BSP collision', evidence['scope'])
        self.assertTrue(any('lightmap' in limit for limit in self.geometry['limitations']))


if __name__ == '__main__':
    unittest.main()
