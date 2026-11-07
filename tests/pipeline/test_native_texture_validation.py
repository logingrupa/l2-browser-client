"""Migration must reject self-consistent derivative hashes with altered source blocks."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.texture_mips import build_texture_source
from native_assets_lib.texture_dds import build_texture_dds, UnsupportedTextureDDS
from native_texture_validation import verify_texture_products
from test_texture_mips import fixture
from native_assets import Converter, sha


class TextureValidationTests(unittest.TestCase):
    def convert_fixture(self, root, format_id, alter_derivative=False):
        block = bytes.fromhex('ff0088c6fa88c6fa00f8e007e4e4e4e4')
        package, item, _, _ = fixture(fmt=8, levels=[(4, 4, block)]) if format_id == 8 else fixture()
        client = root / 'source'
        client.mkdir()
        source = client / 'Fixture.utx'
        source.write_bytes(package.data)
        tool = root / 'tool.exe'
        tool.write_bytes(b'not executed; PNG export stub only')
        preview = root / 'preview.png'
        preview.write_bytes(b'\x89PNG\r\n\x1a\n')
        with patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())):
            converter = Converter(client, root / 'output', tool)
        original_builder = build_texture_dds

        def derivative_builder(native, files):
            metadata, products = original_builder(native, files)
            if alter_derivative:
                metadata['format'] = 'DXT1'
            return metadata, products

        with patch.object(converter, 'package', return_value=(source, package)), \
                patch.object(converter, 'run'), patch.object(converter, 'exported', return_value=preview), \
                patch('native_assets.build_texture_dds', side_effect=derivative_builder):
            return converter.convert({'kind': 'texture', 'package': 'Fixture', 'object': item['object']})

    def test_standalone_archive_declares_original_dxt1_or_dxt5_fourcc(self):
        for format_id, name in ((3, 'DXT1'), (8, 'DXT5')):
            with self.subTest(format_id=format_id), tempfile.TemporaryDirectory() as directory:
                result = self.convert_fixture(Path(directory), format_id)
                with zipfile.ZipFile(result['file']) as archive:
                    manifest = json.loads(archive.read('asset.json'))
                    derivative = json.loads(archive.read('native-texture-dds.json'))
                    self.assertEqual(manifest['image']['derivatives'], [
                        {'file': 'texture.dds', 'manifest': 'native-texture-dds.json', 'format': name}])
                    self.assertEqual(derivative['format'], name)
                    self.assertEqual(archive.read('texture.dds')[84:88], name.encode('ascii'))

    def test_standalone_archive_rejects_derivative_format_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'differs from native source or FourCC'):
                self.convert_fixture(Path(directory), 8, alter_derivative=True)

    def write_fixture(self, root, palette=False, dxt5=False):
        if dxt5:
            block = bytes.fromhex('ff0088c6fa88c6fa00f8e007e4e4e4e4')
            package,item,_,_ = fixture(fmt=8,levels=[(4,4,block),(2,2,block),(1,1,block)])
        else:
            package, item, _, _ = fixture(fmt=0, palette=True) if palette else fixture()
        native, files = build_texture_source(package, item)
        source = {'status': 'preserved', 'manifest': 'native-texture-source.json'}
        try:
            dds, products = build_texture_dds(native, files)
            files.update(products)
            derivative = {'status': 'available', 'manifest': 'native-texture-dds.json',
                          **{key: dds[key] for key in ('file', 'sha256', 'mipCount', 'completeTo1x1', 'consumer')}}
        except UnsupportedTextureDDS as error:
            derivative = {'status': 'unsupported', 'reason': str(error)}
        for name, data in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return {'nativeTextureSource': source, 'nativeTextureDDS': derivative}

    def test_changed_dds_cannot_pass_with_rewritten_derivative_hashes(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = self.write_fixture(root)
            self.assertTrue(verify_texture_products(root, metadata)['nativeMipPayloadsIdentical'])
            path = root / 'texture.dds'
            altered = bytearray(path.read_bytes())
            altered[-1] ^= 1
            path.write_bytes(altered)
            digest = hashlib.sha256(altered).hexdigest()
            metadata['nativeTextureDDS']['sha256'] = digest
            receipt_path = root / 'native-texture-dds.json'
            receipt = json.loads(receipt_path.read_bytes())
            receipt['sha256'] = digest
            receipt_path.write_text(json.dumps(receipt), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'differs from native source'):
                verify_texture_products(root, metadata)

    def test_supported_source_cannot_silently_lose_derivative(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = self.write_fixture(root)
            metadata['nativeTextureDDS'] = {'status': 'unsupported', 'reason': 'ignored'}
            with self.assertRaisesRegex(ValueError, 'missing its compressed derivative'):
                verify_texture_products(root, metadata)

    def test_palette_source_reports_gap_and_rejects_leftover_dds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = self.write_fixture(root, palette=True)
            self.assertEqual(verify_texture_products(root, metadata)['dds']['status'], 'unsupported')
            (root / 'texture.dds').write_bytes(b'unrelated output')
            with self.assertRaisesRegex(ValueError, 'undeclared DDS'):
                verify_texture_products(root, metadata)

    def test_consumer_policy_must_match_actual_authored_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = self.write_fixture(root)
            metadata['nativeTextureDDS']['consumer'] = {'mipUploadPolicy': 'invented'}
            with self.assertRaisesRegex(ValueError, 'provenance differs: consumer'):
                verify_texture_products(root, metadata)

    def test_dxt5_alpha_payload_and_fourcc_cannot_change_even_with_rewritten_derivative_hashes(self):
        import hashlib
        for offset in (84,130):  # FourCC and a three-bit alpha selector byte.
            with self.subTest(offset=offset),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);metadata=self.write_fixture(root,dxt5=True)
                self.assertTrue(verify_texture_products(root,metadata)['nativeMipPayloadsIdentical'])
                path=root/'texture.dds';altered=bytearray(path.read_bytes());altered[offset]^=1;path.write_bytes(altered)
                digest=hashlib.sha256(altered).hexdigest();metadata['nativeTextureDDS']['sha256']=digest
                receipt_path=root/'native-texture-dds.json';receipt=json.loads(receipt_path.read_bytes());receipt['sha256']=digest
                receipt_path.write_text(json.dumps(receipt),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'differs from native source'):
                    verify_texture_products(root,metadata)

    def test_supported_dxt5_cannot_be_reported_as_a_coverage_gap(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);metadata=self.write_fixture(root,dxt5=True)
            metadata['nativeTextureDDS']={'status':'unsupported','reason':'ignored'}
            with self.assertRaisesRegex(ValueError,'missing its compressed derivative'):
                verify_texture_products(root,metadata)


if __name__ == '__main__':
    unittest.main()
