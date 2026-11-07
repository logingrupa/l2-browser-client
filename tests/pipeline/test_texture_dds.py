import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.texture_dds import build_texture_dds, UnsupportedTextureDDS
from native_catalog.ue2 import FormatError


def sha(data):
    return hashlib.sha256(data).hexdigest()


def refresh(metadata, files):
    files['native-texture-source.json'] = json.dumps(metadata, sort_keys=True).encode('utf-8')


def fixture(dimensions=((8, 8), (4, 4), (2, 2), (1, 1)), format_id=3):
    export = bytearray(b'original native properties')
    files, mips = {}, []
    for level, (width, height) in enumerate(dimensions):
        size = max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * (16 if format_id == 8 else 8)
        payload = bytes((index * 17 + level * 43) % 256 for index in range(size))
        name = f'native/mip{level:02d}.bin'
        files[name] = payload
        export += b'header'
        mips.append({'level': level, 'width': width, 'height': height, 'file': name,
                     'sourceOffset': 73 + len(export), 'sourceBytes': size, 'sha256': sha(payload)})
        export += payload + b'trailer'
    export = bytes(export)
    files['native/texture-export.bin'] = export
    metadata = {'schemaVersion': 1, 'kind': 'native-texture-source',
                'format': {'id': format_id, 'name': 'DXT5' if format_id == 8 else 'DXT1', 'propertyStatus': 'authored'},
                'source': {'package': 'Fixture.utx', 'object': 'Fixture.Texture',
                           'packageSha256': '1' * 64, 'sourceOffset': 73,
                           'sourceBytes': len(export), 'sourceExportSha256': sha(export)},
                'originalExportFile': 'native/texture-export.bin',
                'sourceExportFullyConsumed': True, 'pixelDecodingApplied': False,
                'mipsGenerated': False, 'colorOrAlphaModified': False,
                'mips': mips, 'mipCount': len(mips),
                'nativeMipBytes': sum(mip['sourceBytes'] for mip in mips),
                'completeTo1x1': bool(mips and dimensions[-1] == (1, 1))}
    refresh(metadata, files)
    return metadata, files


BABYLON_PROBE = r"""
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DDSTools } from './node_modules/@babylonjs/core/Misc/dds.pure.js';
import { _DDSTextureLoader } from './node_modules/@babylonjs/core/Materials/Textures/Loaders/ddsTextureLoader.js';
const paths = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const results = paths.map(path => {
    const data = Uint8Array.from(readFileSync(path));
    const uploaded = [];
    const engine = {
        getCaps: () => ({ s3tc: {} }),
        _uploadCompressedDataToTextureDirectly: (_texture, format, width, height, bytes, face, level) => {
            uploaded.push({ format, width, height, face, level, bytes: bytes.byteLength,
                sha256: createHash('sha256').update(bytes).digest('hex') });
        },
    };
    const texture = { generateMipMaps: true, getEngine: () => engine };
    try {
        const info = DDSTools.GetDDSInfo(data);
        let settings;
        new _DDSTextureLoader().loadData(data, texture, (width, height, mipmaps, compressed, upload) => {
            settings = { width, height, mipmaps, compressed };
            upload();
        });
        return { path, info, settings, uploaded, error: null };
    } catch (error) {
        return { path, error: { name: error.name, message: error.message }, uploaded };
    }
});
process.stdout.write(JSON.stringify(results));
"""


class TextureDDSTests(unittest.TestCase):
    def test_dxt5_header_and_independent_color_alpha_blocks_are_exact(self):
        from test_texture_mips import fixture as native_fixture
        from native_assets_lib.texture_mips import build_texture_source
        blocks = [bytes.fromhex('ff0088c6fa88c6fa00f8e007e4e4e4e4'),
                  bytes.fromhex('00ff88c6fa88c6fa00f8e007e4e4e4e4')]
        levels = [(8,4,blocks[0]+blocks[1]),(4,2,blocks[1]),(2,1,blocks[0]),(1,1,blocks[1])]
        package,item,_,_ = native_fixture(fmt=8,dimensions=(8,4),levels=levels)
        native,files = build_texture_source(package,item)
        original = copy.deepcopy((native,files))
        metadata,output = build_texture_dds(native,files)
        header = struct.unpack('<32I',output['texture.dds'][:128])
        self.assertEqual(header[:8],(0x20534444,124,0xa1007,4,8,32,0,4))
        self.assertEqual(header[19:27],(32,4,0x35545844,0,0,0,0,0))
        self.assertEqual(header[27:],(0x401008,0,0,0,0))
        self.assertEqual(output['texture.dds'][128:],b''.join(level[2] for level in levels))
        self.assertEqual(metadata['format'],'DXT5')
        self.assertEqual(metadata['nativeMipBytes'],80)
        self.assertEqual([mip['bytes'] for mip in metadata['mips']],[32,16,16,16])
        self.assertTrue(metadata['consumer']['headerParserCompatible'])
        self.assertTrue(any('BC3' in limit for limit in metadata['limitations']))
        self.assertFalse(any('DXT1' in limit for limit in metadata['limitations']))
        self.assertEqual((native,files),original)
        self.assertEqual(build_texture_dds(native,files),(metadata,output))

    def test_single_dxt5_block_is_valid_144_byte_dds_without_padding(self):
        for size in (1,2,4):
            native,files = fixture(((size,size),),format_id=8)
            metadata,output = build_texture_dds(native,files)
            self.assertEqual(len(output['texture.dds']),144)
            self.assertEqual(output['texture.dds'][128:],files['native/mip00.bin'])
            self.assertEqual(struct.unpack_from('<I',output['texture.dds'],108)[0],0x1000)
            self.assertTrue(metadata['consumer']['headerParserCompatible'])

    def test_dxt5_format_identity_and_full_alpha_block_size_are_required(self):
        for name in ('DXT1','DXT3','DXT5N'):
            native,files = fixture(format_id=8);native['format']['name']=name;refresh(native,files)
            with self.subTest(name=name),self.assertRaisesRegex(FormatError,'identity'):
                build_texture_dds(native,files)
        native,files = fixture(((4,4),));native['format']={'id':8,'name':'DXT5'};refresh(native,files)
        with self.assertRaisesRegex(FormatError,'DXT5 mip byte count'):
            build_texture_dds(native,files)

    def test_dxt5_authored_alpha_change_cannot_be_hidden_by_updating_the_mip_hash(self):
        native,files = fixture(format_id=8)
        altered=bytearray(files['native/mip00.bin']);altered[2]^=1
        files['native/mip00.bin']=bytes(altered);native['mips'][0]['sha256']=sha(altered);refresh(native,files)
        with self.assertRaisesRegex(FormatError,'original native export'):
            build_texture_dds(native,files)

    def test_header_and_every_authored_block_are_exact(self):
        native, files = fixture()
        metadata, output = build_texture_dds(native, files)
        dds = output['texture.dds']
        header = struct.unpack('<32I', dds[:128])
        self.assertEqual(header[:8], (0x20534444, 124, 0xa1007, 8, 8, 32, 0, 4))
        self.assertEqual(header[8:19], (0,) * 11)
        self.assertEqual(header[19:27], (32, 4, 0x31545844, 0, 0, 0, 0, 0))
        self.assertEqual(header[27:], (0x401008, 0, 0, 0, 0))
        self.assertEqual(dds[128:], b''.join(files[mip['file']] for mip in native['mips']))
        offset = 128
        for mip, original in zip(metadata['mips'], native['mips']):
            self.assertEqual(mip['ddsOffset'], offset)
            self.assertEqual(dds[offset:offset + mip['bytes']], files[original['file']])
            self.assertEqual(mip['sourceSha256'], original['sha256'])
            offset += mip['bytes']
        self.assertEqual(offset, len(dds))
        self.assertEqual(metadata['nativeMipBytes'], 56)
        self.assertEqual(metadata['sha256'], sha(dds))
        self.assertEqual(metadata, json.loads(output['native-texture-dds.json']))

    def test_rectangular_chain_keeps_one_pixel_axis_and_sub_four_blocks(self):
        native, files = fixture(((8, 2), (4, 1), (2, 1), (1, 1)))
        metadata, output = build_texture_dds(native, files)
        self.assertEqual([mip['bytes'] for mip in metadata['mips']], [16, 8, 8, 8])
        self.assertEqual(len(output['texture.dds']), 168)
        self.assertTrue(metadata['completeTo1x1'])
        self.assertEqual(metadata['consumer']['mipUploadPolicy'], 'all-authored-levels')

    def test_partial_mip_chain_is_preserved_and_consumer_limit_is_explicit(self):
        native, files = fixture(((8, 8), (4, 4)))
        metadata, output = build_texture_dds(native, files)
        self.assertFalse(metadata['completeTo1x1'])
        self.assertEqual(metadata['mipCount'], 2)
        self.assertEqual(len(output['texture.dds']), 168)
        self.assertEqual(metadata['consumer']['mipUploadPolicy'], 'mip0-only')
        self.assertFalse(metadata['mipsGenerated'])
        self.assertTrue(any('incomplete' in item for item in metadata['limitations']))

    def test_single_level_omits_mipmap_caps_without_discarding_small_blocks(self):
        for size in (1, 2, 4, 8):
            native, files = fixture(((size, size),))
            metadata, output = build_texture_dds(native, files)
            header = struct.unpack('<32I', output['texture.dds'][:128])
            self.assertEqual(header[2], 0x81007)
            self.assertEqual(header[7], 1)
            self.assertEqual(header[27], 0x1000)
            self.assertEqual(output['texture.dds'][128:], files['native/mip00.bin'])
            self.assertEqual(metadata['consumer']['headerParserCompatible'], size == 8)
            self.assertEqual(len(output['texture.dds']), 160 if size == 8 else 136)

    def test_determinism_and_inputs_are_not_modified(self):
        native, files = fixture()
        original = copy.deepcopy((native, files))
        first = build_texture_dds(native, files)
        self.assertEqual(first, build_texture_dds(native, files))
        self.assertEqual((native, files), original)
        first[0]['source']['object'] = 'changed'
        self.assertEqual(native['source']['object'], 'Fixture.Texture')
        self.assertFalse(first[0]['compressionApplied'])
        self.assertFalse(first[0]['pixelDecodingApplied'])
        self.assertFalse(first[0]['colorOrAlphaModified'])

    def test_p8_is_explicitly_unsupported_not_recompressed(self):
        for fmt in ({'id': 0, 'name': 'P8'}, {'id': 5, 'name': 'DXT5'}):
            native, files = fixture()
            native['format'] = fmt
            refresh(native, files)
            with self.assertRaises(UnsupportedTextureDDS) as raised:
                build_texture_dds(native, files)
            if fmt['id'] == 0:
                self.assertEqual(str(raised.exception), 'DDS block preservation does not support P8; native indices and palette remain preserved')
        native['format'] = {'id': 3, 'name': 'P8'}
        refresh(native, files)
        with self.assertRaises(FormatError):
            build_texture_dds(native, files)

    def test_bad_json_or_mismatched_sidecar_fails(self):
        native, files = fixture()
        files['native-texture-source.json'] = b'invalid'
        with self.assertRaises(FormatError):
            build_texture_dds(native, files)
        refresh(native, files)
        native['mipCount'] = 2
        with self.assertRaisesRegex(FormatError, 'differs from its sidecar'):
            build_texture_dds(native, files)

    def test_supported_mip_payload_corruption_is_fatal(self):
        mutations = [lambda files: files.pop('native/mip01.bin'),
                     lambda files: files.update({'native/mip00.bin': b'x' * 31}),
                     lambda files: files.update({'native/mip02.bin': b'x' * 8}),
                     lambda files: files.update({'native/texture-export.bin': b'x' * len(files['native/texture-export.bin'])})]
        for mutate in mutations:
            native, files = fixture()
            mutate(files)
            with self.subTest(mutate=mutate), self.assertRaises(FormatError):
                build_texture_dds(native, files)

    def test_matching_mip_hash_cannot_bypass_original_export_equality(self):
        native, files = fixture()
        files['native/mip00.bin'] = b'x' * 32
        native['mips'][0]['sha256'] = sha(files['native/mip00.bin'])
        refresh(native, files)
        with self.assertRaisesRegex(FormatError, 'original native export'):
            build_texture_dds(native, files)

    def test_invalid_mip_order_range_dimensions_and_summary_fail(self):
        mutations = [lambda native: native['mips'][0].update(level=True),
                     lambda native: native['mips'][1].update(width=8),
                     lambda native: native['mips'][0].update(width=3),
                     lambda native: native['mips'][0].update(height=8192),
                     lambda native: native['mips'][0].update(sourceOffset=-1),
                     lambda native: native['mips'][0].update(file='../mip00.bin'),
                     lambda native: native.update(mipCount=1),
                     lambda native: native.update(nativeMipBytes=1),
                     lambda native: native.update(completeTo1x1=False),
                     lambda native: native.update(mipsGenerated=True)]
        for mutate in mutations:
            native, files = fixture()
            mutate(native)
            refresh(native, files)
            with self.subTest(mutate=mutate), self.assertRaises(FormatError):
                build_texture_dds(native, files)

    def test_empty_excessive_and_repeated_terminal_mips_fail(self):
        for dimensions in ((), ((1, 1), (1, 1)), ((1, 1),) * 14):
            native, files = fixture(dimensions)
            with self.subTest(dimensions=dimensions), self.assertRaises(FormatError):
                build_texture_dds(native, files)

    @unittest.skipUnless(shutil.which('node') and (ROOT / 'node_modules/@babylonjs/core/Misc/dds.pure.js').is_file(),
                         'pinned Babylon/Node unavailable')
    def test_actual_babylon_loader_receives_exact_blocks_and_reports_known_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, expected = [], []
            dimensions_list = (((8, 8), (4, 4), (2, 2), (1, 1)),
                               ((8, 2), (4, 1), (2, 1), (1, 1)),
                               ((8, 8), (4, 4)), ((8, 8),), ((1, 1),))
            for index, (format_id, dimensions) in enumerate((fmt, dims) for fmt in (3,8) for dims in dimensions_list):
                native, files = fixture(dimensions,format_id=format_id)
                metadata, output = build_texture_dds(native, files)
                path = Path(directory) / f'{index}.dds'
                path.write_bytes(output['texture.dds'])
                paths.append(str(path))
                expected.append(metadata)
            listing = Path(directory) / 'paths.json'
            listing.write_text(json.dumps(paths), encoding='utf-8')
            result = subprocess.run(['node', '--input-type=module', '-e', BABYLON_PROBE, str(listing)],
                                    cwd=ROOT, check=True, text=True, capture_output=True)
            rows = json.loads(result.stdout)
        for row, metadata in zip(rows, expected):
            with self.subTest(path=row['path']):
                if not metadata['consumer']['headerParserCompatible']:
                    self.assertEqual(row['error']['name'], 'RangeError')
                    self.assertEqual(row['uploaded'], [])
                    continue
                self.assertIsNone(row['error'])
                self.assertEqual(row['info']['mipmapCount'], metadata['mipCount'])
                self.assertTrue(row['info']['isCompressed'])
                self.assertFalse(row['info']['isCube'])
                self.assertEqual(row['settings']['mipmaps'], metadata['mipCount'] > 1 and metadata['completeTo1x1'])
                mips = metadata['mips'] if metadata['completeTo1x1'] else metadata['mips'][:1]
                self.assertEqual(len(row['uploaded']), len(mips))
                for actual, mip in zip(row['uploaded'], mips):
                    self.assertEqual(actual, {'format': 33779 if metadata['format']=='DXT5' else 33777, 'width': mip['width'], 'height': mip['height'],
                                              'face': 0, 'level': mip['level'], 'bytes': mip['bytes'],
                                              'sha256': mip['sourceSha256']})


if __name__ == '__main__':
    unittest.main()
