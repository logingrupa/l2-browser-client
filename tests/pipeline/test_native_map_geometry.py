import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.ue2 import FormatError
from native_map import migrate_map
from native_map_geometry import (BOUND_TOLERANCE, GltfBuilder, bit, build_geometry, calculated_coords,
    coords_point, cross, glb_structure, gltf_placement, layer_sampling_source, native_to_gltf, quad_triangles, qualified_mask_uv_rule, resolved_static_values,
    reference_surface_candidate, rotation_rows, select_terrain_sectors, static_matrix, static_model_limit, subtract, surface_spawn_candidate,
    terrain_mask_uv, texture_uv, validate_static_requests, verify_geometry, vertex_normal)


def row_point(matrix, point):
    return [sum([*point, 1][i]*matrix[i][j] for i in range(4)) for j in range(3)]


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


class QualifiedMaskUvTests(unittest.TestCase):
    def source(self):
        pairs = [
            ('T_texture.Texture.Base', 'T_texture.Texture.layer0'),
            ('T_oren.Obase_1', 'T_20_20.Height.20_20_BASE_C'),
            ('T_texture.Texture.g_01', 'T_20_20.Height.20_20_S_C'),
            ('T_oren.OG_53', 'T_20_20.Height.20_20_G1'),
            ('T_oren.OG_44', 'T_20_20.Height.20_20_G2'),
            ('T_oren.OG_43_t', 'T_20_20.Height.20_20_G3'),
            ('T_oren.OST_10', 'T_20_20.Height.20_20_C'),
            ('T_oren.OS_01', 'T_20_20.Height.20_20_R'),
            ('T_oren.OG_49_t', 'T_20_20.Height.20_20_G4'),
        ]
        return ({'object': '20_20.TerrainInfo0', 'width': 256, 'height': 256},
                {'offset': [64, 208], 'quads': [48, 47]},
                SimpleNamespace(source_hash='1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'),
                'maps/20_20.unr',
                [{'index': i, 'texture': diffuse, 'alphaMap': mask} for i, (diffuse, mask) in enumerate(pairs)])

    def test_submitted_float_bytes_and_complete_independent_uv_hash(self):
        rule = qualified_mask_uv_rule(*self.source())
        self.assertIsNotNone(rule)
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

    def test_unqualified_source_section_or_resource_route_stays_ordinary(self):
        for mutation in ('package', 'path', 'terrain', 'width', 'height', 'offset', 'extent', 'mask', 'diffuse', 'order', 'missing'):
            native, selected, package, path, layers = self.source()
            if mutation == 'package': package.source_hash = '0'*64
            if mutation == 'path': path = 'maps/21_20.unr'
            if mutation == 'terrain': native['object'] = '20_20.TerrainInfo1'
            if mutation == 'width': native['width'] = 512
            if mutation == 'height': native['height'] = 512
            if mutation == 'offset': selected['offset'] = [80, 208]
            if mutation == 'extent': selected['quads'] = [48, 46]
            if mutation == 'mask': layers[1]['alphaMap'] = 'T_20_20.Height.20_20_C'
            if mutation == 'diffuse': layers[1]['texture'] = 'Other.Diffuse'
            if mutation == 'order': layers.reverse()
            if mutation == 'missing': layers.pop()
            with self.subTest(mutation=mutation):
                rule = qualified_mask_uv_rule(native, selected, package, path, layers)
                self.assertIsNone(rule)
                self.assertEqual(terrain_mask_uv(80, 255, 256, 256, rule), [.314453125, .998046875])

    def test_rule_preserves_names_and_records_offscreen_provenance_limits(self):
        values = self.source()
        before = copy.deepcopy(values)
        rule = qualified_mask_uv_rule(*values)
        self.assertEqual(values, before)
        self.assertEqual(rule['source']['packageSha256'], values[2].source_hash)
        self.assertEqual(rule['source']['gridMaximum'], [112, 255])
        self.assertIn('offscreen', rule['status'])
        self.assertIn('visible parity unverified', rule['status'])
        self.assertEqual(rule['evidence']['witnessDrawCall'], 142131)
        self.assertEqual(rule['evidence']['handoffSha256'], 'fe2e05c2468858931332c207f5b45c6b3ec7cdf9f61121d897ad137aa9b66556')
        self.assertIn('writer count unestablished', ' '.join(rule['evidence']['limitations']))
        native, selected, package, path, layers = values
        for layer in layers:
            layer['texture'] = layer['texture'].swapcase()
            layer['alphaMap'] = layer['alphaMap'].swapcase()
        self.assertIsNotNone(qualified_mask_uv_rule(native, selected, package, path, layers))


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

    def test_declared_model_limit_supports_larger_exact_sets_and_rejects_ambiguity(self):
        requests=[{'object':f'Fixture.Mesh{i}'} for i in range(20)]
        placements=[{'resolvedMeshObject':row['object']} for row in requests]
        with self.assertRaisesRegex(ValueError,'at most16'): validate_static_requests(requests,placements,{})
        self.assertEqual(validate_static_requests(requests,placements,{'maxStaticModels':32}),32)
        with self.assertRaises(ValueError): validate_static_requests(requests+[requests[0]],placements,{'maxStaticModels':32})
        with self.assertRaises(ValueError): validate_static_requests(requests,placements[:-1],{'maxStaticModels':32})
        self.assertEqual(validate_static_requests([],[],{'terrainSectorRectangle':{},'maxStaticModels':1}),1)
        for limit in (0,-1,True,2.5,1025):
            with self.subTest(limit=limit),self.assertRaises(ValueError): static_model_limit({'maxStaticModels':limit})

    def test_reference_xy_uses_native_diagonal_preserves_authored_z_and_all_source_samples(self):
        manifest={'nativeTerrain':{'width':2,'toHeightmap':{'origin':[0,0,0],'axes':[[1,0,0],[0,1,0],[0,0,1]]}},
                  'selectedRegion':{'offset':[0,0],'quads':[1,1]},
                  'referenceActor':{'object':'Fixture.PlayerStart','location':[.25,.75,100]}}
        points=[[0,0,0],[1,0,2],[0,1,4],[1,1,8]]
        original=copy.deepcopy(points)
        for turned,height in ((0,4),(1,3.5)):
            maps={'QuadVisibilityBitmap':(1,),'EdgeTurnBitmap':(turned,)}
            candidate=reference_surface_candidate(manifest,points,maps,[[2,2,3]])
            self.assertEqual(candidate['sourcePosition'],[.25,.75,height])
            self.assertEqual(candidate['referenceActor']['authoredSourcePosition'],[.25,.75,100])
            self.assertEqual(candidate['referenceActor']['authoredHeightAboveTerrainNativeUnits'],100-height)
            self.assertAlmostEqual(sum(candidate['triangleBarycentricWeights']),1)
            self.assertFalse(candidate['nativeSpawnVerified'])
            self.assertFalse(candidate['collisionVerified'])
        self.assertEqual(points,original)
        with self.assertRaisesRegex(FormatError,'hidden'):
            reference_surface_candidate(manifest,points,{'QuadVisibilityBitmap':(0,),'EdgeTurnBitmap':(0,)},[])
        manifest['referenceActor']['location']=[2,.5,100]
        with self.assertRaisesRegex(FormatError,'outside'):
            reference_surface_candidate(manifest,points,{'QuadVisibilityBitmap':(1,),'EdgeTurnBitmap':(0,)},[])
        with self.assertRaisesRegex(ValueError,'boolean'): static_model_limit({'sourceSpawnReferenceActor':'true'})


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
        # +local X is scaled2 and rotates to +worldY; not a world-space pivot subtraction.
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


class LayerSamplingSourceTests(unittest.TestCase):
    def source(self):
        # Distinct serialized array records, including negative zero; decoding
        # alone cannot retain that representation or the original tag bytes.
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


STAGED = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
RAW = ROOT/'artifacts/native-parity/map-20_20'
DEFAULTS = ROOT/'artifacts/native-parity/research/map-geometry/native-defaults'


@unittest.skipUnless((STAGED/'maps/20_20.unr').is_file() and (DEFAULTS/'Engine.Actor/defaults.json').is_file(), 'native sources/default evidence remain local')
class LocalTerrainGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name)/'geometry'
        cls.raw = Path(cls.temporary.name)/'raw'
        migrate_map(STAGED, json.loads((ROOT/'recipes/native-map-20_20.json').read_text()), cls.raw)
        cls.recipe = json.loads((ROOT/'recipes/native-map-section.json').read_text())
        cls.result = build_geometry(STAGED, cls.raw, cls.recipe, cls.output, DEFAULTS)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_sector_topology_uv_and_source_default_coverage(self):
        self.assertEqual(self.result['coverage'], {'vertices': 289, 'triangles': 512, 'staticActors': 7,
            'uniqueStaticMeshes': 6, 'terrainLayersWithUV': 9, 'terrainLayersRendered': 0,
            'nativeSectorBoundsCompared': 256, 'nativeSectorBoundsMatched': 35})
        report = json.loads((self.output/'manifest.json').read_text())
        self.assertTrue(report['selectedSector']['allBoundsMatch'])
        self.assertEqual(report['selectedSector']['absoluteErrors'], [0]*6)
        self.assertEqual(report['topology']['wholeMapQuads'], 65025)
        self.assertEqual(report['topology']['wholeMapHiddenQuads'], 28)
        self.assertEqual(report['topology']['sectionHiddenQuads'], 0)
        self.assertFalse(report['referenceActor']['walkableNativeSpawnVerified'])
        self.assertGreater(report['referenceActor']['nearestTerrainZ']-report['referenceActor']['location'][2], 1000)
        layers = json.loads((self.output/'layers.json').read_text())
        self.assertLessEqual(max(row['uvCoefficientMaxError'] for row in layers), .00001)
        actors = json.loads((self.output/'static-placements.json').read_text())
        self.assertTrue(all(actor['resolvedProperties']['PrePivot']['source'] == 'native-declared-field-zero-init' for actor in actors))

    def test_editable_gltf_and_glb_have_identical_buffers_and_positive_winding(self):
        data = json.loads((self.output/'terrain.gltf').read_text())
        binary = (self.output/'terrain.bin').read_bytes()
        glb = (self.output/'terrain.glb').read_bytes()
        magic, version, length = struct.unpack_from('<III', glb)
        self.assertEqual((magic, version, length), (0x46546c67, 2, len(glb)))
        json_size = struct.unpack_from('<I', glb, 12)[0]
        bin_offset = 20+json_size+8
        self.assertEqual(glb[bin_offset:bin_offset+len(binary)], binary)

        def rows(accessor_index, width, fmt):
            accessor = data['accessors'][accessor_index]
            view = data['bufferViews'][accessor['bufferView']]
            offset = view['byteOffset']
            return [struct.unpack_from('<'+str(width)+fmt, binary, offset+i*width*4) for i in range(accessor['count'])]

        primitive = data['meshes'][0]['primitives'][0]
        positions = rows(primitive['attributes']['POSITION'], 3, 'f')
        indices = [row[0] for row in rows(primitive['indices'], 1, 'I')]
        for i in range(0, len(indices), 3):
            a, b, c = (positions[j] for j in indices[i:i+3])
            self.assertGreater(cross(subtract(b, a), subtract(c, a))[1], 0)
        source = list(struct.iter_unpack('<3f', (self.output/'native-section-positions.float32le').read_bytes()))
        for native, gltf in zip(source, positions):
            for actual, expected in zip(gltf, native_to_gltf(native)):
                self.assertAlmostEqual(actual, expected, delta=.00004)
        self.assertEqual(glb_structure(self.output/'terrain.glb')['triangles'], 512)

    def test_layer_sampling_source_survives_section_receipt_and_gltf_extras(self):
        self.assertTrue(verify_geometry(STAGED, self.raw, self.output)['verified'])
        source = (self.raw/'raw/map.unwrapped.bin').read_bytes()
        raw_layers = json.loads((self.raw/'terrain.json').read_text())[0]['layers']
        layers = json.loads((self.output/'layers.json').read_text())
        gltf = json.loads((self.output/'terrain.gltf').read_text())
        self.assertEqual(gltf['meshes'][0]['extras']['nativeLayers'], layers)
        count = 0
        for layer in layers:
            preserved = layer['nativeSamplingSource']
            self.assertEqual(preserved['object'], '20_20.TerrainInfo0')
            self.assertEqual(preserved['package'], 'maps/20_20.unr')
            self.assertEqual(preserved['omittedProperties'], [])
            self.assertIn('unverified', layer['maskUVStatus'])
            expected = [p for p in raw_layers[layer['index']]['properties'] if p['name'] in ('Scale', 'ToWorld', 'ToMaskmap', 'bUseAlpha')]
            self.assertEqual([p['property'] for p in preserved['properties']], expected)
            for record in preserved['properties']:
                serialized = record['serializedTagAndPayload']
                payload = source[serialized['offset']:serialized['offset']+serialized['bytes']]
                self.assertEqual(bytes.fromhex(serialized['hex']), payload)
                self.assertEqual(serialized['sha256'], hashlib.sha256(payload).hexdigest())
                count += 1
        self.assertEqual(count, 90)
        original = (self.output/'layers.json').read_bytes()
        try:
            (self.output/'layers.json').write_bytes(original+b' ')
            with self.assertRaisesRegex(ValueError, 'output hash mismatch: layers.json'):
                verify_geometry(STAGED, self.raw, self.output)
        finally:
            (self.output/'layers.json').write_bytes(original)

    def test_surface_candidate_is_sampled_on_native_diagonal_with_explicit_collision_gap(self):
        placements = json.loads((self.output/'static-placements.json').read_text())
        candidate = surface_spawn_candidate(self.output, self.raw, placements)
        self.assertEqual(candidate['cell'], [174, 97])
        self.assertEqual(candidate['sourcePosition'], [22336, 78016, -2966.630126953125])
        self.assertLessEqual(candidate['maxCellSlopeDegrees'], 20)
        self.assertGreater(candidate['nearestStaticActorOriginDistanceMetres'], 11)
        self.assertFalse(candidate['collisionVerified'])
        corners = candidate['cornerSourcePositions']
        endpoints = (1, 2) if candidate['edgeTurn'] else (0, 3)
        self.assertEqual(candidate['sourcePosition'][2], sum(corners[i][2] for i in endpoints)/2)

    def test_cache_is_verified_and_tampering_is_reported(self):
        before = (self.output/'terrain.glb').stat().st_mtime_ns
        self.assertTrue(build_geometry(STAGED, self.raw, self.recipe, self.output, DEFAULTS)['cacheHit'])
        self.assertEqual((self.output/'terrain.glb').stat().st_mtime_ns, before)
        payload = (self.output/'terrain.glb').read_bytes()
        try:
            (self.output/'terrain.glb').write_bytes(payload[:-1])
            with self.assertRaisesRegex(ValueError, 'output hash'):
                verify_geometry(STAGED, self.raw, self.output)
        finally:
            (self.output/'terrain.glb').write_bytes(payload)

    def test_selected_stale_sector_is_rejected_before_geometry_output(self):
        candidate = {**self.recipe, 'terrainSector': '20_20.TerrainInfo0.TerrainSector105'}
        with self.assertRaisesRegex(FormatError, 'native bounds oracle'):
            build_geometry(STAGED, self.raw, candidate, Path(self.temporary.name)/'unverified', DEFAULTS)
        self.assertFalse((Path(self.temporary.name)/'unverified/terrain.glb').exists())

    def test_rectangle_keeps_central_geometry_uv_normals_and_reproducible_cache(self):
        recipe=json.loads((ROOT/'recipes/native-map-section-3x3-candidate.json').read_text())
        output=Path(self.temporary.name)/'rectangle'
        result=build_geometry(STAGED,self.raw,recipe,output,DEFAULTS)
        self.assertFalse(result['cacheHit'])
        report=json.loads((output/'manifest.json').read_text())
        self.assertNotIn('selectedSector',report)
        self.assertEqual(report['selectedRegion']['quads'],[48,48])
        self.assertEqual(report['selectedRegion']['cachedZBoundsMismatched'],8)
        self.assertEqual(report['coverage']['vertices'],49*49)
        self.assertEqual(report['coverage']['terrainSectors'],9)
        self.assertEqual(report['staticActorSelection']['actorOriginsWithinXY'],982)
        self.assertEqual(report['staticActorSelection']['actorOriginsExcludedByZ'],958)

        def arrays(folder):
            gltf=json.loads((folder/'terrain.gltf').read_text())
            binary=(folder/'terrain.bin').read_bytes()
            primitive=gltf['meshes'][0]['primitives'][0]
            result={}
            for name,index in primitive['attributes'].items():
                accessor=gltf['accessors'][index]
                view=gltf['bufferViews'][accessor['bufferView']]
                width={'VEC2':2,'VEC3':3}[accessor['type']]
                result[name]=list(struct.iter_unpack('<'+str(width)+'f',binary[view['byteOffset']:view['byteOffset']+view['byteLength']]))
            accessor=gltf['accessors'][primitive['indices']]
            view=gltf['bufferViews'][accessor['bufferView']]
            result['indices']=[row[0] for row in struct.iter_unpack('<I',binary[view['byteOffset']:view['byteOffset']+view['byteLength']])]
            return result

        original,expanded=arrays(self.output),arrays(output)
        lookup={value:index for index,value in enumerate(expanded['POSITION'])}
        self.assertEqual(len(lookup),49*49)
        for index,point in enumerate(original['POSITION']):
            other=lookup[point]
            for attribute in ('NORMAL','TEXCOORD_0','TEXCOORD_1'):
                self.assertEqual(original[attribute][index],expanded[attribute][other])
        def faces(data):
            return {tuple(data['POSITION'][index] for index in data['indices'][offset:offset+3]) for offset in range(0,len(data['indices']),3)}
        self.assertTrue(faces(original).issubset(faces(expanded)))
        placements=json.loads((output/'static-placements.json').read_text())
        candidate=surface_spawn_candidate(output,self.raw,placements)
        self.assertTrue(144<candidate['cell'][0]<192 and 80<candidate['cell'][1]<128)
        self.assertFalse(candidate['nativeSpawnVerified'])
        before={p.relative_to(output).as_posix():p.read_bytes() for p in output.rglob('*') if p.is_file()}
        self.assertTrue(build_geometry(STAGED,self.raw,recipe,output,DEFAULTS)['cacheHit'])
        clean=Path(self.temporary.name)/'rectangle-clean'
        self.assertFalse(build_geometry(STAGED,self.raw,recipe,clean,DEFAULTS)['cacheHit'])
        self.assertEqual(before,{p.relative_to(clean).as_posix():p.read_bytes() for p in clean.rglob('*') if p.is_file()})

    def test_playerstart10_rectangle_keeps_short_edge_sector_and_exact_reference_xy(self):
        recipe=json.loads((ROOT/'recipes/native-map-debug-location.json').read_text())
        output=Path(self.temporary.name)/'debug-location'
        result=build_geometry(STAGED,self.raw,recipe,output,DEFAULTS)
        report=json.loads((output/'manifest.json').read_text())
        self.assertEqual(report['selectedRegion']['quads'],[48,47])
        self.assertEqual(report['coverage']['vertices'],49*48)
        self.assertEqual(report['coverage']['staticActors'],151)
        self.assertEqual(report['coverage']['uniqueStaticMeshes'],61)
        self.assertEqual(report['staticActorSelection']['actorOriginsExcludedByZ'],0)
        placements=json.loads((output/'static-placements.json').read_text())
        candidate=surface_spawn_candidate(output,self.raw,placements)
        self.assertEqual(candidate['sourcePosition'],[10536,95034,-3455.286376953125])
        self.assertEqual(candidate['referenceActor']['authoredSourcePosition'],[10536,95034,-3374.786376953125])
        self.assertEqual(candidate['referenceActor']['authoredHeightAboveTerrainNativeUnits'],80.5)
        self.assertTrue(result['verified'])
        gltf=json.loads((output/'terrain.gltf').read_text())
        binary=(output/'terrain.bin').read_bytes()
        primitive=gltf['meshes'][0]['primitives'][0]
        def attribute_bytes(name):
            accessor=gltf['accessors'][primitive['attributes'][name]]
            view=gltf['bufferViews'][accessor['bufferView']]
            return binary[view['byteOffset']:view['byteOffset']+view['byteLength']]
        self.assertEqual(hashlib.sha256(attribute_bytes('TEXCOORD_0')).hexdigest(),
                         'd549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d')
        self.assertEqual(hashlib.sha256(attribute_bytes('TEXCOORD_1')).hexdigest(),
                         '4c6a9644e0f1f71293741b8bf835576efa68808548c63613e7ce9ec80efc7ab2')
        self.assertEqual(report['maskUVRule'],gltf['meshes'][0]['extras']['maskUVRule'])
        self.assertIn('offscreen',report['gaps'][0])
        layers=json.loads((output/'layers.json').read_text())
        self.assertEqual(layers,gltf['meshes'][0]['extras']['nativeLayers'])
        for layer in layers:
            self.assertEqual(layer['maskUV'],report['maskUVRule']['formula'])
            self.assertEqual(layer['maskUVStatus'],report['maskUVRule']['status'])
        self.assertNotIn('maskUVRule',json.loads((self.output/'manifest.json').read_text()))
        before={p.relative_to(output).as_posix():p.read_bytes() for p in output.rglob('*') if p.is_file()}
        self.assertTrue(build_geometry(STAGED,self.raw,recipe,output,DEFAULTS)['cacheHit'])
        clean=Path(self.temporary.name)/'debug-location-clean'
        self.assertFalse(build_geometry(STAGED,self.raw,recipe,clean,DEFAULTS)['cacheHit'])
        self.assertEqual(before,{p.relative_to(clean).as_posix():p.read_bytes() for p in clean.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
