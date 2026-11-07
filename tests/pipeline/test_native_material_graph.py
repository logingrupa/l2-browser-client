"""Raw material policy preserves source data and makes runtime gaps explicit."""
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from native_assets import Converter,implementation_hash,verify_archive
from native_assets_lib.material_graph import preserve_material_graph
from native_catalog.ue2 import FormatError,Package
from native_map_geometry import static_model_policies,validate_static_requests


class MaterialGraphPolicyTests(unittest.TestCase):
    def test_policy_is_explicit_and_not_a_generic_conversion_fallback(self):
        for request in ({'kind':'model','materialPolicy':'guess-diffuse'},
                        {'kind':'texture','materialPolicy':'preserve-native-graph'},
                        {'kind':'model','materialPolicy':'preserve-native-graph','parts':[{}]},
                        {'kind':'model','materialPolicy':'preserve-native-graph','materials':['0=Other.Texture']}):
            with self.subTest(request=request),self.assertRaisesRegex(ValueError,'material policy|material-policy'):
                Converter.convert(SimpleNamespace(),request)

    def test_exact_static_policy_declarations_must_be_consumed_without_aliasing(self):
        recipe={'staticModelPolicies':{'Native.Mesh':'preserve-native-graph'}}
        self.assertEqual(static_model_policies(recipe),recipe['staticModelPolicies'])
        request={'object':'Native.Mesh','materialPolicy':'preserve-native-graph'}
        self.assertEqual(validate_static_requests([request],[{'resolvedMeshObject':'Native.Mesh'}],recipe),16)
        for requests,selection in (([{'object':'Native.Mesh'}],recipe),([request],{}),
            ([{'object':'Native.Other'}],recipe)):
            with self.assertRaises(ValueError): validate_static_requests(requests,[{'resolvedMeshObject':requests[0]['object']}],selection)
        for policies in ({'Mesh':'preserve-native-graph'},{'Native.Mesh':'flatten'},
                         {'Native.Mesh':'preserve-native-graph','native.mesh':'preserve-native-graph'}):
            with self.assertRaises(ValueError): static_model_policies({'staticModelPolicies':policies})

    def test_missing_slots_and_unreviewed_node_classes_still_fail(self):
        converter=SimpleNamespace(client=Path('fixture'))
        item={'classObject':'Engine.StaticMesh','object':'Native.Mesh'}
        document=SimpleNamespace(data={'materials':[{}]})
        with self.assertRaisesRegex(FormatError,'count'):
            preserve_material_graph(converter,Path('work'),document,item,{'slots':[]})
        slot={'slot':0,'sourceReference':'Native.Material','referenceStatus':'explicit-null'}
        with self.assertRaisesRegex(FormatError,'resolvable'):
            preserve_material_graph(converter,Path('work'),document,item,{'slots':[slot]})
        slot['referenceStatus']='exact-native-object-index'
        packages=SimpleNamespace(resolve=lambda _:({'resolution':'exact-qualified-object'},None,
                                                   {'object':'Native.Material','className':'UnknownMaterial'}))
        with patch('native_assets_lib.material_graph.SourcePackages',return_value=packages),self.assertRaisesRegex(FormatError,'Unreviewed'):
            preserve_material_graph(converter,Path('work'),document,item,{'slots':[slot]})


MIGRATION=Path(os.environ.get('L2_MIGRATION_TEST_OUTPUT', str(ROOT/'artifacts/native-parity/migration'))).resolve()
VALIDATION=MIGRATION/'validation.json'
FLAME_ID='interlude:FX_E_S.Flameset.Default_Flame01'
CLIENT=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'


@unittest.skipUnless(VALIDATION.is_file(),'Local native migration validation is unavailable; run pnpm assets:migrate')
class NativeFlameGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Select the active product by stable ID: older hash directories are
        # intentionally retained and must not silently become the test fixture.
        validation=json.loads(VALIDATION.read_bytes())
        if not validation['passed'] or validation['errors']:
            raise AssertionError('Native migration validation did not pass')
        matches=[entry for entry in validation['archives'] if entry['id']==FLAME_ID]
        if len(matches)!=1:
            raise AssertionError('Expected one validated production flame archive')
        result=matches[0]
        products=json.loads((MIGRATION/'products.json').read_bytes())
        if not result['archiveVerified'] or products.get(result['path'])!=result['sha256']:
            raise AssertionError('Flame archive is not a verified active migration product')
        cls.path=(MIGRATION/result['path']).resolve()
        if not cls.path.is_relative_to(MIGRATION.resolve()):
            raise AssertionError('Flame archive path escapes the migration directory')
        if hashlib.sha256(cls.path.read_bytes()).hexdigest()!=result['sha256']:
            raise AssertionError('Production flame archive hash differs from validation')
        verify_archive(cls.path)
        cls.archive=zipfile.ZipFile(cls.path)
        cls.addClassCleanup(cls.archive.close)
        cls.asset=json.loads(cls.archive.read('asset.json'))
        cls.provenance=json.loads(cls.archive.read('provenance.json'))
        if cls.asset['id']!=FLAME_ID:
            raise AssertionError('Production archive has the wrong native asset identity')
        if cls.provenance['converterSha256']!=implementation_hash():
            raise AssertionError('Production flame predates current converter; run pnpm assets:migrate')
        cls.graph=json.loads(cls.archive.read('native-materials/graph.json'))

    def test_full_graph_exports_and_dependency_hashes_match_original_native_bytes(self):
        self.assertEqual(len(self.graph['nodes']),23)
        self.assertEqual(sum(n['source']['object'].startswith('FX_E_T.') for n in self.graph['nodes']),21)
        packages={}
        for node in self.graph['nodes']:
            source=node['source']
            if source['package'] not in packages:
                path=CLIENT/source['package'];raw=path.read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),source['packageSha256'])
                packages[source['package']]=Package(raw,path.name)
            pkg=packages[source['package']]
            expected=pkg.data[source['sourceOffset']:source['sourceOffset']+source['sourceBytes']]
            payload=self.archive.read(node['rawExport']['file'])
            self.assertEqual(payload,expected)
            self.assertEqual(hashlib.sha256(payload).hexdigest(),node['rawExport']['sha256'])
        for path,digest in self.provenance['dependencies'].items():
            self.assertEqual(hashlib.sha256((CLIENT/path).read_bytes()).hexdigest(),digest)

    def test_texture_sources_png_and_supported_dds_are_retained_without_graph_flattening(self):
        textures=[node for node in self.graph['nodes'] if node['source']['class']=='Texture']
        self.assertEqual(len(textures),18)
        self.assertEqual(sum(n['dds']['status']=='available' for n in textures),17)
        glow=next(node for node in textures if node['source']['object']=='FX_E_T.Flameset.de_fire_glow')
        self.assertEqual(glow['nativeTextureSource']['status'],'preserved')
        self.assertEqual(glow['dds']['status'],'available')
        glow_source=json.loads(self.archive.read(glow['nativeTextureSource']['manifest']))
        self.assertEqual(glow_source['format']['id'],8)
        self.assertEqual(glow_source['format']['name'],'DXT5')
        self.assertEqual(glow_source['mipCount'],7)
        self.assertEqual(self.archive.read(glow['dds']['file'])[84:88],b'DXT5')
        for node in textures:
            self.assertTrue(self.archive.read(node['image']['file']).startswith(b'\x89PNG\r\n\x1a\n'))
            if node['dds']['status']!='available':
                if node['nativeTextureSource']['status']=='unsupported-layout':
                    self.assertTrue(node['nativeTextureSource']['originalExportRetained'])
                else:
                    self.assertEqual(node['nativeTextureSource']['status'],'preserved')
                continue
            source_path=node['nativeTextureSource']['manifest']
            source=json.loads(self.archive.read(source_path))
            prefix=source_path.rsplit('/',1)[0]+'/'
            dds=self.archive.read(node['dds']['file'])
            payloads=[self.archive.read(prefix+mip['file']) for mip in source['mips']]
            self.assertEqual(dds[128:],b''.join(payloads))
        self.assertEqual(len([edge for edge in self.graph['edges'] if edge['field']=='AnimNext']),15)
        combiner=next(n for n in self.graph['nodes'] if n['source']['class']=='Combiner')
        self.assertEqual(combiner['properties']['CombineOperation'],2)
        self.assertTrue(combiner['properties']['Modulate2X'])

    def test_original_sections_remain_diagnostic_with_explicit_pending_runtime_status(self):
        import struct
        data=self.archive.read('model.glb')
        length=struct.unpack_from('<I',data,12)[0]
        gltf=json.loads(data[20:20+length])
        binary=data[28+length:]
        offset=0
        for source in self.provenance['metadata']['originalExportBuffers']:
            offset=(offset+3)&~3
            self.assertEqual(hashlib.sha256(binary[offset:offset+source['bytes']]).hexdigest(),source['sha256'])
            offset+=source['bytes']
        self.assertEqual(len(gltf['materials']),2)
        self.assertEqual(sum(len(m['primitives']) for m in gltf['meshes']),2)
        for index,material in enumerate(gltf['materials']):
            self.assertEqual(material['name'],f'UNSUPPORTED_NATIVE_GRAPH_SLOT_{index}')
            self.assertNotIn('baseColorTexture',material['pbrMetallicRoughness'])
            self.assertEqual(material['extras']['nativeRuntimeStatus'],'unsupported-diagnostic')
            self.assertEqual(material['extras']['nativeMaterialGraph'],'native-materials/graph.json')
        summary=self.asset['model']['nativeMaterialGraph']
        self.assertFalse(summary['runtimeImplemented'])
        self.assertEqual(len(summary['runtimeGaps']),5)
        self.assertTrue(next(t['value'] for t in self.graph['nativeMeshPropertyTags'] if t['name']=='bUseBillBoard'))
        for name in self.graph['classDefinitions']:
            definition=json.loads(self.archive.read('native-materials/source/classes/'+name+'.json'))
            self.assertEqual(hashlib.sha256(self.archive.read(definition['sourceScript'])).hexdigest(),definition['sourceScriptSha256'])


if __name__=='__main__':unittest.main()
