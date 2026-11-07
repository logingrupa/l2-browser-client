import io
import json
from pathlib import Path
import struct
import sys
import unittest

from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from native_catalog.ue2 import Package, FormatError
from native_sky import (ExactSkyPackage, EXPECTED_COLORS, ROOTS, SKY_ORIGIN, TEXTURES,
                        build, cross, difference, dot, sha)


class SkyReaderTests(unittest.TestCase):
    def test_unqualified_package_refused_before_any_layout_read(self):
        with self.assertRaisesRegex(FormatError,'qualified original'):
            ExactSkyPackage(b'not the source package')


class RetainedSkyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
        if not (cls.client/'textures/l2_skies.utx').is_file():
            raise unittest.SkipTest('Private original sky input unavailable')
        cls.files=build(cls.client);cls.sky=json.loads(cls.files['sky.json'])

    def test_generic_reader_gate_stays_closed_for118(self):
        with self.assertRaises(FormatError):
            Package((self.client/'textures/l2_skies.utx').read_bytes(),'l2_skies.utx')
        package=ExactSkyPackage((self.client/'textures/l2_skies.utx').read_bytes())
        self.assertEqual([package.summary['version'],package.summary['licenseeVersion']],[118,0])
        self.assertEqual((len(package.names),len(package.exports),len(package.imports)),(172,110,11))

    def test_exact_zone_origin_material_census_and_real_source_colors(self):
        sky=self.sky
        self.assertEqual(sky['skyZoneIndex'],28)
        self.assertEqual(sky['sourceSkyZonePosition'],SKY_ORIGIN)
        self.assertEqual(sky['levelModelBinding']['model'],{'reference':9184,'qualified':'20_20.Model798'})
        self.assertEqual([(len(p['nodeRanges']),len(p['positions'])//3,len(p['indices'])//3) for p in sky['parts']],
                         [(5,20,10),(47,158,64),(1,4,2)])
        self.assertEqual([p['sourceMaterial'] for p in sky['parts']],list(ROOTS))
        self.assertEqual([p['authoredColorRGBA'] for p in sky['parts']],[EXPECTED_COLORS[k] for k in ROOTS])
        self.assertEqual([p['alphaBlend'] for p in sky['parts']],[False,True,True])
        self.assertEqual(sky['parts'][0]['authoredColorRGBA'],[206,150,0,255])
        self.assertEqual(len(sky['materialGraph']),9)

    def test_fans_match_source_normals_and_stored_uv_projection(self):
        for part in self.sky['parts']:
            points=[part['positions'][i:i+3] for i in range(0,len(part['positions']),3)]
            for i in range(0,len(part['indices']),3):
                a,b,c=part['indices'][i:i+3]
                self.assertGreater(dot(cross(difference(points[b],points[a]),difference(points[c],points[a])),part['normals'][a*3:a*3+3]),0)
            for node in part['nodeRanges']:
                for offset,p in enumerate(node['nativePositions']):
                    delta=difference(p,node['nativeTextureBase'])
                    expected=[dot(delta,node['nativeTextureU'])/part['texture']['width'],dot(delta,node['nativeTextureV'])/part['texture']['height']]
                    rounded=list(struct.unpack('<2f',struct.pack('<2f',*expected)))
                    start=(node['vertexStart']+offset)*2
                    self.assertEqual(part['uvs'][start:start+2],rounded)

    def test_original_mip_blocks_survive_dds_and_png_decodes(self):
        for name,(_,_,width,height,digest) in TEXTURES.items():
            blocks=self.files[name+'.mip0.bin'];dds=self.files[name+'.dds']
            self.assertEqual(sha(blocks),digest)
            self.assertEqual(dds[:4],b'DDS ')
            self.assertEqual(dds[128:],blocks)
            native=Image.open(io.BytesIO(dds)).convert('RGBA')
            png=Image.open(io.BytesIO(self.files[name+'.png'])).convert('RGBA')
            self.assertEqual(native.size,(width,height));self.assertEqual(native.tobytes(),png.tobytes())

    def test_root_translation_happens_once_and_attributes_roundtrip(self):
        data=self.files['sky.glb'];size=struct.unpack_from('<I',data,12)[0]
        doc=json.loads(data[20:20+size]);binary=data[28+size:]
        self.assertEqual(doc['scenes'],[{'nodes':[0]}])
        self.assertEqual(doc['nodes'][0]['translation'],[-SKY_ORIGIN[i]*.01 for i in (0,2,1)])
        self.assertEqual(doc['nodes'][0]['children'],[1,2,3])
        self.assertTrue(all('translation' not in node for node in doc['nodes'][1:]))
        for index,part in enumerate(self.sky['parts']):
            primitive=doc['meshes'][index]['primitives'][0]
            for attribute,field,dim in [('POSITION','positions',3),('NORMAL','normals',3),('TEXCOORD_0','uvs',2)]:
                accessor=doc['accessors'][primitive['attributes'][attribute]];view=doc['bufferViews'][accessor['bufferView']]
                actual=list(struct.unpack_from('<'+str(accessor['count']*dim)+'f',binary,view['byteOffset']))
                self.assertEqual(actual,part[field])
            self.assertEqual(doc['materials'][index]['pbrMetallicRoughness']['baseColorFactor'],[v/255 for v in part['authoredColorRGBA']])
            self.assertIn('KHR_materials_unlit',doc['materials'][index]['extensions'])

    def test_panner_retained_without_invented_animation_or_native_claim(self):
        sky=self.sky
        self.assertFalse(sky['unresolvedDynamics']['TexPanner0']['applied'])
        panner=next(n for n in sky['materialGraph'] if n['source']['object']=='l2_skies.Shaders.TexPanner0')
        fields={p['name']:p for p in panner['propertyTags']}
        self.assertEqual(fields['PanRate']['value'],.0020000000949949026)
        self.assertEqual(fields['M']['structName'],'Matrix')
        self.assertTrue(fields['M']['payloadHex'])
        self.assertTrue(any('time-of-day' in item for item in sky['limitations']))
        self.assertTrue(any('two-sided precedence' in item for item in sky['limitations']))


if __name__=='__main__':unittest.main()
