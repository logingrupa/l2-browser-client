import io
import json
from pathlib import Path
import socket
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / 'tests' / 'fixtures' / 'golden'
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import Converter, archive_bytes, implementation_hash, sha, verify_archive
from native_assets_lib.asset_manifest import reference_client_build
from reference_client_guard import read_reference_client_lock
from reference_client_lock_fixture import lock_client_as_reference_root, use_reference_client_lock


def golden_manifest(name):
    with zipfile.ZipFile(GOLDEN / name) as archive:
        return json.loads(archive.read('asset.json'))


def repacked_with_manifest(name, manifest):
    with zipfile.ZipFile(GOLDEN / name) as archive:
        files = {item.filename: archive.read(item.filename) for item in archive.infolist() if item.filename != 'asset.json'}
    return archive_bytes(manifest, files)


def synthetic_wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(struct.pack('<h', 3) * 80)
    return output.getvalue()


class VerifyArchiveVersionTests(unittest.TestCase):
    def test_accepts_golden_v1_and_v2_packages(self):
        for name in ('model-v1.l2asset', 'model-v2.l2asset', 'audio-v2.l2asset'):
            self.assertEqual(verify_archive(GOLDEN / name)['kind'], golden_manifest(name)['kind'])

    def test_rejects_schema_version_three(self):
        manifest = golden_manifest('model-v2.l2asset')
        manifest['schemaVersion'] = 3
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'version-three.l2asset'
            path.write_bytes(repacked_with_manifest('model-v2.l2asset', manifest))
            with self.assertRaisesRegex(ValueError, 'schemaVersion'):
                verify_archive(path)


class ConverterManifestTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        self.client = self.root / 'source'
        self.client.mkdir()
        self.media = self.client / 'sample.wav'
        self.media.write_bytes(synthetic_wav())
        self.tool = self.root / 'tool.exe'
        self.tool.write_bytes(b'not executed by the media adapter')

    def convert_sample(self):
        with patch('native_assets.UMODEL_SHA256', sha(self.tool.read_bytes())):
            return Converter(self.client, self.root / 'output', self.tool).convert({'kind': 'audio', 'media': 'sample.wav'})

    def test_converter_writes_a_v2_manifest_with_derived_source_path_build_and_version(self):
        lock_path = lock_client_as_reference_root(self, self.client)
        with zipfile.ZipFile(self.convert_sample()['file']) as archive:
            manifest = json.loads(archive.read('asset.json'))
        self.assertEqual(manifest['schemaVersion'], 2)
        self.assertEqual(manifest['source']['path'], {'host': socket.gethostname().upper(), 'absolutePath': self.media.resolve().as_posix()})
        self.assertEqual(manifest['clientBuild'], reference_client_build(read_reference_client_lock(lock_path)))
        self.assertEqual(manifest['converterVersion'], implementation_hash())
        self.assertNotIn('coordinates', manifest)

    def test_converter_refuses_to_write_without_the_reference_lock(self):
        use_reference_client_lock(self, self.root / 'absent.lock.json')
        with self.assertRaisesRegex(ValueError, 'reference client lock missing'):
            self.convert_sample()
        self.assertFalse((self.root / 'output').exists())

    def test_converter_refuses_to_stamp_a_build_its_client_engine_library_does_not_match(self):
        lock_client_as_reference_root(self, self.client)
        engine_library = self.client / 'system/Engine.dll'
        for description, change_engine_library in (('differing', lambda: engine_library.write_bytes(b'another engine library')),
                                                    ('missing', engine_library.unlink)):
            with self.subTest(engine_library=description):
                change_engine_library()
                with self.assertRaisesRegex(ValueError, 'system/Engine.dll under .* is missing or differs from the locked reference build'):
                    self.convert_sample()
                self.assertEqual(list((self.root / 'output').rglob('asset.l2asset')), [])


if __name__ == '__main__':
    unittest.main()
