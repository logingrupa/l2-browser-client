import copy
import hashlib
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.ue2 import FormatError
from world.native_terrain_sectors import BOUND_TOLERANCE, bit, quad_triangles, select_terrain_sectors, vertex_normal
from world.terrain_chunk_step import extrapolated_mask_uv_rule
from world.terrain_coordinates import calculated_coords, coords_point, cross, native_to_gltf, subtract
from world.terrain_layers import layer_sampling_source, terrain_mask_uv, texture_uv


class TerrainNumericsTests(unittest.TestCase):
    def test_native_32767_midpoint_and_exact_serialized_coords(self):
        coords = calculated_coords([16384, 81920, 160.65126037597656], [128, 128, 76], 256, 256)
        self.assertEqual(coords, {'origin': [0, -512, 32225.859375], 'axes': [[128, 0, 0], [0, 128, 0], [0, 0, .296875]]})
        self.assertEqual(coords_point(coords, [160, 96, 21279]), [20480, 77824, -3249.848876953125])
        self.assertEqual(coords_point(coords, [128, 128, 32767])[:2], [16384, 81920])
        self.assertAlmostEqual(coords_point(coords, [128, 128, 32767])[2], 160.65126037597656, delta=BOUND_TOLERANCE)
        self.assertNotAlmostEqual(coords_point(coords, [128, 128, 32768])[2], 160.65126037597656, delta=BOUND_TOLERANCE)

    def test_native_topology_word_index_and_both_diagonals(self):
        words = (1, 2)
        self.assertTrue(bit(words, 8, 0, 0))
        self.assertTrue(bit(words, 8, 1, 4))
        self.assertFalse(bit(words, 8, 0, 4))
        self.assertEqual(quad_triangles(0, 1, 2, 3, True), [(0, 1, 2), (2, 1, 3)])
        self.assertEqual(quad_triangles(0, 1, 2, 3, False), [(0, 1, 3), (0, 3, 2)])
        with self.assertRaises(FormatError):
            bit(words, 8, 0, 8)

    def test_mirrored_gltf_basis_and_native_render_order_face_up(self):
        points = [native_to_gltf(p) for p in ([0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0])]
        for turned in (True, False):
            for a, b, c in quad_triangles(0, 1, 2, 3, turned, native_render_order=True):
                normal = cross(subtract(points[b], points[a]), subtract(points[c], points[a]))
                self.assertGreater(normal[1], 0)
                self.assertEqual(normal[0], 0)
                self.assertEqual(normal[2], 0)

    def test_native_four_cell_normal_rule_includes_full_grid_neighbors(self):
        points = [[x, y, x*.25+y*.5] for y in range(3) for x in range(3)]
        for turned in (0, 0xffffffff):
            normal = vertex_normal(points, (turned,), 3, 3, 1, 1)
            expected = [-.25, -.5, 1]
            length = sum(x*x for x in expected)**.5
            for a, b in zip(normal, expected):
                self.assertAlmostEqual(a, b/length)

    def test_source_texture_uv_preserves_native_phase_and_mask_half_texel(self):
        matrix = [[1/128, 0, 0, 0], [0, 1/128, 0, 0], [0, 0, 256/76, 0], [0, -.03125, 365643, 1]]
        uv = texture_uv(matrix, [20480, 77824, -3249.848876953125])
        self.assertEqual(uv, [160, 607.96875])
        self.assertEqual([(160+.5)/256, (96+.5)/256], [.626953125, .376953125])


class ExtrapolatedMaskUvTests(unittest.TestCase):
    def test_submitted_float_bytes_and_complete_independent_uv_hash(self):
        rule = extrapolated_mask_uv_rule()
        expected = {240: '0080703f', 241: '0070713f', 248: '0000783f', 255: '00907e3f'}
        for y, encoded in expected.items():
            with self.subTest(y=y):
                uv = terrain_mask_uv(80, y, 256, 256, rule)
                self.assertEqual(struct.pack('<f', uv[1]).hex(), encoded)
                self.assertEqual(uv[0], .314453125)
        ordinary, corrected, changed = bytearray(), bytearray(), []
        for y in range(208, 256):
            for x in range(64, 113):
                old = [(x+.5)/256, (y+.5)/256]
                new = terrain_mask_uv(x, y, 256, 256, rule)
                ordinary.extend(struct.pack('<2f', *old))
                corrected.extend(struct.pack('<2f', *new))
                self.assertEqual(old[0], new[0])
                if old[1] != new[1]:
                    changed.append((x, y))
                if y <= 240:
                    self.assertEqual(old, new)
        self.assertEqual(len(changed), 735)
        self.assertEqual({y for _, y in changed}, set(range(241, 256)))
        self.assertEqual(hashlib.sha256(ordinary).hexdigest(), '957f2061e9b83e8e4fdb6e1504ee66fb2100a0c0b6cf4e70f686e97e98814695')
        self.assertEqual(hashlib.sha256(corrected).hexdigest(), 'd549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d')
        self.assertNotEqual(terrain_mask_uv(80, 255, 256, 256, rule)[1], .99072265625)


class TerrainRectangleSelectionTests(unittest.TestCase):
    def source(self):
        native={'object':'Fixture.Terrain','width':5,'height':5}
        rows=[]
        for y in (0,2):
            for x in (0,2):
                rows.append({'object':f'Fixture.Sector{x}_{y}','offset':[x,y],'quads':[2,2],
                             'bounds':[x,y,0,x+2,y+2,1],'reconstructedBounds':[x,y,0,x+2,y+2,1],
                             'xyMatches':True,'allBoundsMatch':True,'absoluteErrors':[0]*6})
        return native,{'sectors':rows},{'terrainSectorRectangle':{'minOffset':[0,0],'maxOffset':[2,2]}}

    def test_contiguous_rectangle_retains_native_sector_order_and_shared_sample_extent(self):
        native,oracle,recipe=self.source()
        original=copy.deepcopy(oracle)
        region,members=select_terrain_sectors(native,oracle,recipe)
        self.assertEqual(region['offset'],[0,0])
        self.assertEqual(region['quads'],[4,4])
        self.assertEqual(region['sectorGrid'],[2,2])
        self.assertEqual(region['bounds'],[0,0,0,4,4,1])
        self.assertEqual(members,oracle['sectors'])
        self.assertEqual(oracle,original)
        self.assertEqual(select_terrain_sectors(native,oracle,{'terrainSector':'Fixture.Sector0_0'})[0],oracle['sectors'][0])

    def test_stale_z_requires_explicit_policy_and_never_changes_source_bounds_or_tolerance(self):
        native,oracle,recipe=self.source()
        oracle['sectors'][1]['bounds'][2]=9999
        oracle['sectors'][1]['allBoundsMatch']=False
        oracle['sectors'][1]['absoluteErrors'][2]=9999
        with self.assertRaisesRegex(FormatError,'bounds oracle'):
            select_terrain_sectors(native,oracle,recipe)
        recipe['cachedSectorBoundsPolicy']='require-xy-preserve-z-discrepancies'
        region,members=select_terrain_sectors(native,oracle,recipe)
        self.assertEqual(region['bounds'],[0,0,0,4,4,1])
        self.assertEqual(region['cachedZBoundsMismatched'],1)
        self.assertEqual(region['cachedBoundsToleranceNativeUnits'],BOUND_TOLERANCE)
        self.assertEqual(members[1]['bounds'][2],9999)
        oracle['sectors'][1]['xyMatches']=False
        with self.assertRaisesRegex(FormatError,'bounds oracle'): select_terrain_sectors(native,oracle,recipe)

    def test_ambiguous_missing_noninteger_and_noncontiguous_rectangles_fail(self):
        native,oracle,recipe=self.source()
        for invalid in ({}, {'terrainSector':'Fixture.Sector0_0',**recipe},
                        {'terrainSectorRectangle':{'minOffset':[True,0],'maxOffset':[2,2]}},
                        {'terrainSectorRectangle':{'minOffset':[1,0],'maxOffset':[2,2]}},
                        {'terrainSectorRectangle':{'minOffset':[2,0],'maxOffset':[0,2]}},
                        {**recipe,'cachedSectorBoundsPolicy':'ignore-errors'}):
            with self.subTest(invalid=invalid),self.assertRaises(FormatError): select_terrain_sectors(native,oracle,invalid)
        for mutation in ('missing','duplicate','gap','unequal','outside'):
            bad=copy.deepcopy(oracle)
            if mutation=='missing': bad['sectors'].pop(1)
            if mutation=='duplicate': bad['sectors'].append(copy.deepcopy(bad['sectors'][0]))
            if mutation=='gap': bad['sectors'][0]['quads'][0]=1
            if mutation=='unequal': bad['sectors'][-1]['quads'][1]=1
            if mutation=='outside': native={**native,'width':4}
            with self.subTest(mutation=mutation),self.assertRaises(FormatError): select_terrain_sectors(native,bad,recipe)


class LayerSamplingSourceTests(unittest.TestCase):
    def source(self):
        data = b'prefix' + b'\x91\x03' + struct.pack('<3f', -0., 32., 76.) + b'\x91\x83\x01' + struct.pack('<3f', .03125, 0., 0.) + b'\x92\x03' + b'end'
        properties = []
        for name, index, tag, payload, size in [('ToMaskmap', None, 6, 8, 12), ('ToMaskmap', 1, 20, 23, 12), ('bUseAlpha', None, 35, 37, 0)]:
            properties.append({'name': name, 'arrayIndex': index, 'offset': tag,
                'payload': {'path': 'raw/map.unwrapped.bin', 'offset': payload, 'bytes': size,
                            'sha256': hashlib.sha256(data[payload:payload+size]).hexdigest()}})
        package = SimpleNamespace(data=data, source_hash='a'*64)
        export = {'offset': 6, 'size': 31, 'object': 'Fixture.TerrainInfo0', 'exportIndex': 2}
        return {'index': 6, 'properties': properties}, package, export

    def test_preserves_order_original_array_indices_negative_zero_and_bool_tag(self):
        layer, package, export = self.source()
        result = layer_sampling_source(layer, package, export, 'maps/Fixture.unr')
        self.assertEqual(result['omittedProperties'], ['Scale', 'ToWorld'])
        self.assertEqual(result['object'], 'Fixture.TerrainInfo0')
        self.assertEqual(result['layerIndex'], 6)
        self.assertEqual([p['property']['arrayIndex'] for p in result['properties']], [None, 1, None])
        self.assertEqual([p['property'] for p in result['properties']], layer['properties'])
        self.assertEqual(b''.join(bytes.fromhex(p['serializedTagAndPayload']['hex']) for p in result['properties']), package.data[6:37])
        self.assertEqual(bytes.fromhex(result['properties'][0]['serializedTagAndPayload']['hex'])[2:6], b'\x00\x00\x00\x80')
        self.assertEqual(result['properties'][-1]['serializedTagAndPayload']['bytes'], 2)

    def test_rejects_wrong_ranges_paths_or_corrupt_supported_payload(self):
        layer, package, export = self.source()
        for field, value in [('offset', 5), ('offset', -1), ('offset', True)]:
            bad = copy.deepcopy(layer)
            bad['properties'][0][field] = value
            with self.assertRaisesRegex(FormatError, 'exceeds'):
                layer_sampling_source(bad, package, export, 'maps/Fixture.unr')
        for field, value in [('path', '../different.bin'), ('bytes', -1), ('bytes', 999), ('sha256', '0'*64)]:
            bad = copy.deepcopy(layer)
            bad['properties'][0]['payload'][field] = value
            with self.assertRaises(FormatError):
                layer_sampling_source(bad, package, export, 'maps/Fixture.unr')


if __name__ == '__main__':
    unittest.main()
