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
from native_map_geometry import build_geometry, verify_geometry
from world.section_static_models import static_model_limit, validate_static_requests
from world.surface_spawn_candidate import reference_surface_candidate, surface_spawn_candidate
from world.gltf_builder import glb_structure
from world.terrain_coordinates import cross, native_to_gltf, subtract
from world.terrain_layers import qualified_mask_uv_rule, terrain_mask_uv


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


class SectionStaticModelAndSpawnTests(unittest.TestCase):
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
