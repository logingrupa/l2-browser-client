import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_assets_lib.texture_mips import build_texture_source, UnsupportedTextureSource, MAX_MIPS
from native_catalog.ue2 import FormatError, Package


def compact(value):
    negative, value = value < 0, abs(value)
    result = bytearray([(value & 63) | (128 if negative else 0)])
    value >>= 6
    if value:
        result[0] |= 64
    while value:
        byte, value = value & 127, value >> 7
        result.append(byte | (128 if value else 0))
    return bytes(result)


def fstring(value, wide=False):
    raw = (value+'\0').encode('utf-16le' if wide else 'cp1252')
    return compact(-len(raw)//2 if wide else len(raw))+raw


def licensee30_header():
    header = struct.pack('<i6B3i', -741, 1, 2, 3, 4, 5, 250, -17, 2147483647, -2147483648)
    header += bytes((index*37+offset)%256 for index in range(8) for offset in range(128))
    header += bytes((0x91,0x12,0x73,0xe4,0x55,0xa6,0x37,0xc8))
    header += struct.pack('<iii', 0x7fc01234, -2147483648, -1)
    header += fstring('caf\u00e9.\u20ac')+fstring('\u7eb9\u7406.\u6811',wide=True)
    header += b'\0'+fstring('',wide=True)+b'\0'*12
    return header+fstring('shader\r\n\u03a9',wide=True)


def fixture(fmt=3, omit_format=False, dimensions=(4,4), levels=None, palette=False,
            palette_alpha=193, version=(123,28), extra=b'', count=None, palette_count=256,
            material_header=None):
    if levels is None:
        levels = [(4,4,b'\x00\xffnative'), (2,2,b'original'), (1,1,b'lastmip!')] if fmt == 3 else [(2,2,b'\0\x01\x7f\xff')]
        if fmt == 0:
            dimensions = (2,2)
    width, height = dimensions
    tags = bytearray(b'' if omit_format else b'\x01\x01'+bytes([fmt]))
    tags += b'\x02\x22'+struct.pack('<i',width)+b'\x03\x22'+struct.pack('<i',height)
    tags += b'\x04\x01'+bytes([width.bit_length()-1])+b'\x05\x01'+bytes([height.bit_length()-1])
    if palette:
        tags += b'\x06\x05\x02'
    tags += b'\0'
    start = 17
    if material_header is None:
        material_header = licensee30_header() if version == (123,30) else struct.pack('<i',-741)
    tail = bytearray(material_header+compact(len(levels) if count is None else count))
    offsets = []
    for width,height,payload in levels:
        record = start+len(tags)+len(tail)
        length = compact(len(payload))
        payload_start = record+4+len(length)
        offsets.append({'record':record,'payload':payload_start,'end':payload_start+len(payload)})
        tail += struct.pack('<i',payload_start+len(payload))+length+payload
        tail += struct.pack('<iiBB',width,height,width.bit_length()-1,height.bit_length()-1)
    texture = bytes(tags+tail+extra)
    colors = bytes(value for index in range(256) for value in (index,(index+5)%256,(index+19)%256,palette_alpha if index==0 else index))
    palette_bytes = b'\0'+compact(palette_count)+colors
    data = b'P'*start+texture+palette_bytes
    package = Package.__new__(Package)
    package.data, package.filename, package.package_name = data,'Fixture.utx','Fixture'
    package.source_hash = hashlib.sha256(data).hexdigest()
    package.summary = {'version':version[0],'licenseeVersion':version[1]}
    package.names = ['None','Format','USize','VSize','UBits','VBits','Palette']
    package.imports = []
    item = {'name':'Tex','object':'Fixture.Tex','className':'Texture','classObject':'Engine.Texture',
            'outerIndex':0,'exportIndex':1,'offset':start,'size':len(texture)}
    pal = {'name':'Pal','object':'Fixture.Pal','className':'Palette','classObject':'Engine.Palette',
           'outerIndex':0,'exportIndex':2,'offset':start+len(texture),'size':len(palette_bytes)}
    package.exports = [item,pal]
    return package,item,offsets,colors


class TextureMipTests(unittest.TestCase):
    def test_dxt5_color_and_both_alpha_selector_modes_survive_native_records(self):
        # Independent BC3 blocks: alpha endpoints, 16 packed 3-bit selectors,
        # RGB565 red/green endpoints and packed 2-bit color selectors.
        eight_alpha = bytes.fromhex('ff0088c6fa88c6fa00f8e007e4e4e4e4')
        six_alpha = bytes.fromhex('00ff88c6fa88c6fa00f8e007e4e4e4e4')
        self.assertEqual([(int.from_bytes(eight_alpha[2:8], 'little') >> (index*3)) & 7 for index in range(16)], list(range(8))*2)
        levels = [(8,4,eight_alpha+six_alpha),(4,2,six_alpha),(2,1,eight_alpha),(1,1,six_alpha)]
        for version in ((123,20),(123,28),(123,30)):
            package,item,offsets,_ = fixture(fmt=8, dimensions=(8,4), levels=levels, version=version)
            original = bytes(package.data)
            result,files = build_texture_source(package,item)
            self.assertEqual(result['format'], {'id':8,'name':'DXT5','propertyStatus':'authored'})
            self.assertEqual(result['nativeMipBytes'],80)
            self.assertTrue(result['completeTo1x1'])
            self.assertFalse(result['pixelDecodingApplied'])
            self.assertFalse(result['colorOrAlphaModified'])
            self.assertEqual(result['layout']['evidence']['dxt5']['blockLayout']['bytes'],16)
            for level,((_,_,expected),offset) in enumerate(zip(levels,offsets)):
                self.assertEqual(files[f'native/mip{level:02d}.bin'],expected)
                self.assertEqual(expected,original[offset['payload']:offset['end']])
            self.assertEqual(package.data,original)
            self.assertEqual(build_texture_source(package,item),(result,files))

    def test_dxt5_block_count_rejects_dxt1_sized_or_misaligned_payloads(self):
        for size in (8,15,17,32):
            package,item,_,_ = fixture(fmt=8,levels=[(4,4,b'x'*size)])
            with self.subTest(size=size),self.assertRaisesRegex(FormatError,'byte count'):
                build_texture_source(package,item)

    def test_exact_dxt_blocks_order_offsets_and_complete_export_are_preserved(self):
        package,item,offsets,_ = fixture()
        original = bytes(package.data)
        result,files = build_texture_source(package,item)
        self.assertEqual(result['mipCount'],3)
        self.assertEqual(result['nativeMipBytes'],24)
        self.assertTrue(result['completeTo1x1'])
        self.assertEqual(files['native/texture-export.bin'],original[item['offset']:item['offset']+item['size']])
        for level,(mip,offset) in enumerate(zip(result['mips'],offsets)):
            self.assertEqual(mip['sourceOffset'],offset['payload'])
            self.assertEqual(mip['lazyArrayEnd'],offset['end'])
            self.assertEqual(files[mip['file']],original[offset['payload']:offset['end']])
            self.assertEqual(bytes.fromhex(mip['headerHex']),original[offset['record']:offset['payload']])
            self.assertEqual(mip['level'],level)
        self.assertEqual(package.data,original)

    def test_p8_retains_palette_entry_zero_alpha_and_index_bytes(self):
        package,item,_,colors = fixture(fmt=0,palette=True)
        result,files = build_texture_source(package,item)
        self.assertEqual(files['native/palette.rgba'],colors)
        self.assertEqual(result['palette']['entry0Alpha'],193)
        self.assertFalse(result['palette']['alphaModified'])
        self.assertEqual(files['native/mip00.bin'],b'\0\x01\x7f\xff')
        pal = package.exports[1]
        self.assertEqual(files['native/palette-export.bin'],package.data[pal['offset']:pal['offset']+pal['size']])

    def test_dxt_palette_is_preserved_without_reinterpreting_blocks(self):
        package,item,_,colors = fixture(palette=True)
        result,files = build_texture_source(package,item)
        self.assertEqual(result['format']['name'],'DXT1')
        self.assertEqual(files['native/palette.rgba'],colors)
        self.assertEqual(files['native/mip01.bin'],b'original')

    def test_partial_authored_chain_is_not_completed(self):
        package,item,_,_ = fixture(levels=[(4,4,b'one mip!')])
        result,files = build_texture_source(package,item)
        self.assertEqual(result['mipCount'],1)
        self.assertFalse(result['completeTo1x1'])
        self.assertFalse(result['mipsGenerated'])
        self.assertNotIn('native/mip01.bin',files)

    def test_omitted_format_is_distinct_from_authored_p8(self):
        outputs = []
        for omitted in (False,True):
            package,item,_,_ = fixture(fmt=0,palette=True,omit_format=omitted)
            outputs.append(build_texture_source(package,item)[0]['format'])
        self.assertEqual([row['id'] for row in outputs],[0,0])
        self.assertEqual([row['propertyStatus'] for row in outputs],['authored','omitted-native-zero-default'])

    def test_unsupported_type_is_reserved_for_numeric_format_and_version(self):
        for kwargs in ({'version':(123,31)},{'version':(123,33)},{'version':(123,36)},
                       {'version':(123,37)},{'version':(122,30)},{'fmt':7},{'fmt':13}):
            package,item,_,_ = fixture(**kwargs)
            with self.subTest(kwargs=kwargs),self.assertRaises(UnsupportedTextureSource):
                build_texture_source(package,item)
        package,item,_,_ = fixture()
        item['classObject'] = 'Other.Texture'
        with self.assertRaises(FormatError) as raised:
            build_texture_source(package,item)
        self.assertNotIsInstance(raised.exception,UnsupportedTextureSource)

    def test_licensee30_nonzero_fields_strings_and_mip_offsets_are_preserved(self):
        for fmt in (0,3):
            with self.subTest(fmt=fmt):
                package,item,offsets,colors = fixture(version=(123,30),fmt=fmt,palette=True)
                original = bytes(package.data)
                metadata,files = build_texture_source(package,item)
                prefix = metadata['nativePrefix']
                self.assertEqual(prefix['reservedInt32'],-741)
                self.assertEqual(bytes.fromhex(prefix['hex']),licensee30_header()+compact(len(offsets)))
                self.assertEqual(prefix['sourceOffset']+prefix['sourceBytes'],offsets[0]['record'])
                fields = prefix['licensee30Material']
                self.assertEqual(list(fields['byteFields'].values()),[1,2,3,4,5,250])
                self.assertEqual(list(fields['int32Fields'].values()),[-17,2147483647,-2147483648])
                self.assertEqual(fields['sourceOffset'],prefix['sourceOffset']+4)
                self.assertEqual(fields['sourceBytes'],len(licensee30_header())-4)
                for index,block in enumerate(fields['opaqueMatrixBlocks']):
                    raw = bytes((index*37+offset)%256 for offset in range(128))
                    self.assertEqual(block['index'],index)
                    self.assertEqual(block['sourceOffset'],prefix['sourceOffset']+22+index*128)
                    self.assertEqual(block['sourceBytes'],128)
                    self.assertEqual(bytes.fromhex(block['hex']),raw)
                    self.assertEqual(block['sha256'],hashlib.sha256(raw).hexdigest())
                self.assertEqual(fields['nativeFCColorSourceOffset'],prefix['sourceOffset']+1046)
                self.assertEqual(fields['nativeFCColorBytesHex'],'911273e455a637c8')
                self.assertEqual(list(fields['fcInt32Fields'].values()),[0x7fc01234,-2147483648,-1])
                self.assertEqual([row['value'] for row in fields['textureStrings']],['caf\u00e9.\u20ac','\u7eb9\u7406.\u6811']+['']*14)
                self.assertEqual([row['encodedLength'] for row in fields['textureStrings'][:4]],[7,-5,0,-1])
                self.assertEqual([row['encoding'] for row in fields['textureStrings'][:2]],['cp1252','utf-16le'])
                self.assertEqual(fields['ShaderCode']['value'],'shader\r\n\u03a9')
                for row in fields['textureStrings']+[fields['ShaderCode']]:
                    self.assertEqual(bytes.fromhex(row['hex']),original[row['sourceOffset']:row['sourceOffset']+row['sourceBytes']])
                for mip,offset in zip(metadata['mips'],offsets):
                    self.assertEqual(mip['recordOffset'],offset['record'])
                    self.assertEqual(mip['sourceOffset'],offset['payload'])
                    self.assertEqual(mip['lazyArrayEnd'],offset['end'])
                    self.assertEqual(files[mip['file']],original[offset['payload']:offset['end']])
                self.assertEqual(files['native/palette.rgba'],colors)
                self.assertEqual(metadata['palette']['entry0Alpha'],193)
                self.assertEqual(files['native/texture-export.bin'],original[item['offset']:item['offset']+item['size']])
                self.assertEqual(metadata,json.loads(files['native-texture-source.json']))
                self.assertEqual(package.data,original)
                self.assertEqual(build_texture_source(package,item),(metadata,files))
                metadata['layout']['evidence']['licensee30Material']['lines'].clear()
                self.assertEqual(build_texture_source(package,item)[0]['layout']['evidence']['licensee30Material']['lines'],[185,248])

    def test_licensee30_fixed_header_truncation_is_corruption(self):
        for cut in (0,3,4,9,10,21,22,149,1045,1046,1053,1054,1065,1066):
            package,item,_,_ = fixture(version=(123,30))
            _,reader = package.properties(item)
            item['size'] = reader.position-item['offset']+cut
            with self.subTest(cut=cut),self.assertRaises(FormatError) as raised:
                build_texture_source(package,item)
            self.assertNotIsInstance(raised.exception,UnsupportedTextureSource)

    def test_licensee30_string_counts_termination_and_encoding_are_validated(self):
        malformed = [compact(65537), compact(-65537), compact(20)+b'X',
                     compact(2)+b'XX', compact(-2)+b'A\0B\0',
                     compact(2)+b'\x81\0', compact(-2)+b'\x00\xd8\0\0',
                     b'\x40\x80\x80\x80\xff']
        for raw in malformed:
            header = licensee30_header()[:1066]+raw
            package,item,_,_ = fixture(version=(123,30),material_header=header,levels=[])
            with self.subTest(raw=raw.hex()),self.assertRaises(FormatError) as raised:
                build_texture_source(package,item)
            self.assertNotIsInstance(raised.exception,UnsupportedTextureSource)

    def test_licensee30_texture_and_shader_string_truncation_is_corruption(self):
        package,item,_,_ = fixture(version=(123,30))
        fields = build_texture_source(package,item)[0]['nativePrefix']['licensee30Material']
        strings = fields['textureStrings']+[fields['ShaderCode']]
        for row in strings:
            for relative_cut in (0,row['sourceBytes']-1):
                truncated = dict(item,size=row['sourceOffset']-item['offset']+relative_cut)
                with self.subTest(string=row['value'],cut=relative_cut),self.assertRaises(FormatError):
                    build_texture_source(package,truncated)

    def test_licensee30_missing_header_extra_field_and_tail_are_corruption(self):
        for kwargs in ({'material_header':struct.pack('<i',-741)},
                       {'material_header':licensee30_header()+b'\0'}, {'extra':b'trailing'}):
            package,item,_,_ = fixture(version=(123,30),**kwargs)
            with self.subTest(kwargs=kwargs),self.assertRaises(FormatError) as raised:
                build_texture_source(package,item)
            self.assertNotIsInstance(raised.exception,UnsupportedTextureSource)

    def test_bad_lazy_offset_and_bad_byte_count_fail_as_corruption(self):
        package,item,offsets,_ = fixture()
        data = bytearray(package.data)
        struct.pack_into('<i',data,offsets[0]['record'],offsets[0]['end']+1)
        package.data = bytes(data)
        with self.assertRaisesRegex(FormatError,'lazy-array'):
            build_texture_source(package,item)
        package,item,_,_ = fixture(levels=[(4,4,b'short')])
        with self.assertRaisesRegex(FormatError,'byte count'):
            build_texture_source(package,item)

    def test_truncated_payload_trailer_and_export_ranges_are_rejected(self):
        for removed in (1,7,12):
            package,item,_,_ = fixture()
            item['size'] -= removed
            with self.subTest(removed=removed),self.assertRaises(FormatError):
                build_texture_source(package,item)
        package,item,_,_ = fixture()
        item['size'] = len(package.data)+1
        with self.assertRaisesRegex(FormatError,'range'):
            build_texture_source(package,item)

    def test_invalid_mip_dimensions_bits_order_and_terminal_repeat_are_rejected(self):
        cases = [[(4,4,b'12345678'),(4,4,b'12345678')],
                 [(1,1,b'12345678'),(1,1,b'12345678')],[(3,4,b'12345678')]]
        for levels in cases:
            package,item,_,_ = fixture(dimensions=levels[0][:2],levels=levels)
            with self.subTest(levels=levels),self.assertRaises(FormatError):
                build_texture_source(package,item)
        package,item,offsets,_ = fixture()
        data = bytearray(package.data)
        data[offsets[0]['end']+8] = 13
        package.data = bytes(data)
        with self.assertRaisesRegex(FormatError,'bits'):
            build_texture_source(package,item)

    def test_empty_excessive_mips_and_trailing_data_are_rejected(self):
        for kwargs in ({'levels':[]},{'count':MAX_MIPS+1},{'extra':b'unparsed'}):
            package,item,_,_ = fixture(**kwargs)
            with self.subTest(kwargs=kwargs),self.assertRaises(FormatError):
                build_texture_source(package,item)

    def test_missing_palette_wrong_palette_class_count_and_tail_are_rejected(self):
        for kwargs in ({'fmt':0},{'fmt':0,'palette':True,'palette_count':255}):
            package,item,_,_ = fixture(**kwargs)
            with self.subTest(kwargs=kwargs),self.assertRaises(FormatError):
                build_texture_source(package,item)
        package,item,_,_ = fixture(fmt=0,palette=True)
        package.exports[1]['classObject'] = 'Other.Palette'
        with self.assertRaisesRegex(FormatError,'exact Engine.Palette'):
            build_texture_source(package,item)
        package,item,_,_ = fixture(fmt=0,palette=True)
        package.data += b'X'
        package.exports[1]['size'] += 1
        with self.assertRaisesRegex(FormatError,'Unconsumed'):
            build_texture_source(package,item)

    def test_palette_index_and_reference_must_resolve_same_native_object(self):
        package,item,_,_ = fixture(fmt=0,palette=True)
        original_properties = package.properties
        def changed(selected):
            tags,reader = original_properties(selected)
            for tag in tags:
                if tag['name'] == 'Palette':
                    tag['value']['object'] = 'Elsewhere.Pal'
            return tags,reader
        package.properties = changed
        with self.assertRaisesRegex(FormatError,'identity'):
            build_texture_source(package,item)

    def test_deterministic_sidecar_hashes_and_metadata_are_independent(self):
        package,item,_,_ = fixture(palette=True)
        first,files = build_texture_source(package,item)
        self.assertEqual(first,json.loads(files['native-texture-source.json']))
        for row in first['files']:
            self.assertEqual(len(files[row['path']]),row['bytes'])
            self.assertEqual(hashlib.sha256(files[row['path']]).hexdigest(),row['sha256'])
        expected = copy.deepcopy(first)
        first['layout']['evidence']['files'].clear()
        first['propertyTags'][0]['value'] = 8
        again,repeated_files = build_texture_source(package,item)
        self.assertEqual(again,expected)
        self.assertEqual(files,repeated_files)


class LocalTextureMipTests(unittest.TestCase):
    @unittest.skipUnless((ROOT/'artifacts/native-parity/inputs/IMPORTA-PC/textures/FX_E_T.utx').is_file(), 'local flame fixture unavailable')
    def test_pinned_flame_dxt5_preserves_all_seven_authored_levels_without_inventing_one_by_one(self):
        path = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC/textures/FX_E_T.utx'
        raw = path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),'cbc082f0f042dbd57f7bd3e1410e6afa05e6b08ef40b9891efbf70e69a2db78c')
        package = Package(raw,path.name)
        item = next(item for item in package.exports if item['object']=='FX_E_T.Flameset.de_fire_glow')
        metadata,files = build_texture_source(package,item)
        self.assertEqual(item['exportIndex'],44)
        self.assertEqual(metadata['format']['id'],8)
        self.assertEqual(metadata['source']['sourceExportSha256'],'461b829f8c02a25a467d7cdca18791b55e9a8273534ea58b783dca685f118c98')
        self.assertEqual([(mip['width'],mip['height'],mip['sourceBytes']) for mip in metadata['mips']],
                         [(64,128,8192),(32,64,2048),(16,32,512),(8,16,128),(4,8,32),(2,4,16),(1,2,16)])
        self.assertEqual(metadata['nativeMipBytes'],10944)
        self.assertFalse(metadata['completeTo1x1'])
        self.assertFalse(metadata['mipsGenerated'])
        for mip in metadata['mips']:
            self.assertEqual(files[mip['file']],package.data[mip['sourceOffset']:mip['sourceOffset']+mip['sourceBytes']])
        self.assertEqual(path.read_bytes(),raw)

    @unittest.skipUnless((ROOT/'artifacts/native-parity/inputs/IMPORTA-PC/textures/T_20_20.utx').is_file(), 'local native fixtures unavailable')
    def test_pinned_terrain_and_effect_scope(self):
        client = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
        pins = {row['relativePath'].casefold():row for row in json.loads((ROOT/'recipes/native-inputs.lock.json').read_text())['files']}
        requests = json.loads((ROOT/'recipes/native-terrain-textures.json').read_text())
        requests += [{'package':'LineageEffectsTextures','object':'LineageEffectsTextures.'+name} for name in
                     ('Spark.fx_m_t0042','Spark.fx_m_t0043','Spark.fx_m_t0044','Spark.fx_m_t0045','Particles.fx_m_t0002','Particles.fx_m_t0050')]
        requests += [{'package':'Engine','object':'Engine.'+name} for name in ('S_Emitter','DefaultTexture')]
        cache,results,unsupported = {},[],[]
        for request in requests:
            key = request['package'].casefold()
            if key not in cache:
                candidates = [path for path in client.rglob('*') if path.is_file() and path.stem.casefold()==key and path.suffix.lower() in ('.utx','.u')]
                self.assertEqual(len(candidates),1)
                path = candidates[0]
                raw = path.read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),pins[path.relative_to(client).as_posix().casefold()]['sha256'])
                cache[key] = Package(raw,path.name)
            package = cache[key]
            matches = [item for item in package.exports if item['object'].casefold()==request['object'].casefold()]
            self.assertEqual(len(matches),1)
            item = matches[0]
            try:
                metadata,files = build_texture_source(package,item)
            except UnsupportedTextureSource:
                unsupported.append(item['object'])
                continue
            self.assertEqual(files['native/texture-export.bin'],package.data[item['offset']:item['offset']+item['size']])
            for mip in metadata['mips']:
                self.assertEqual(files[mip['file']],package.data[mip['sourceOffset']:mip['sourceOffset']+mip['sourceBytes']])
            results.append(metadata)
        self.assertEqual(len(results),26)
        self.assertEqual(unsupported,[])
        self.assertEqual(sum(row['mipCount'] for row in results),141)
        self.assertEqual(sum(row['nativeMipBytes'] for row in results),4458013)
        engines = results[-2:]
        self.assertEqual([row['mipCount'] for row in engines],[1,5])
        self.assertEqual([row['nativeMipBytes'] for row in engines],[1024,341])
        self.assertEqual([row['nativePrefix']['sourceBytes'] for row in engines],[1084,1084])
        self.assertEqual([row['completeTo1x1'] for row in engines],[False,True])
        self.assertTrue(all(row['palette']['status']=='exact-native-object-index' for row in engines))
        terrain = results[:18]
        self.assertEqual(sum(row['mipCount'] for row in terrain),90)
        self.assertEqual(sum(row['nativeMipBytes'] for row in terrain),4358264)


if __name__ == '__main__':
    unittest.main()
