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
from reference_client_lock_fixture import lock_client_as_reference_root


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
    def test_converter_writes_a_v2_manifest_with_derived_source_path_build_and_version(self):
        fixture_lock = GOLDEN / 'reference-client-tree.lock.json'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            media = client / 'sample.wav'
            media.write_bytes(synthetic_wav())
            tool = root / 'tool.exe'
            tool.write_bytes(b'not executed by the media adapter')
            with patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())), patch('native_assets.REFERENCE_CLIENT_LOCK_PATH', fixture_lock):
                result = Converter(client, root / 'output', tool).convert({'kind': 'audio', 'media': 'sample.wav'})
            with zipfile.ZipFile(result['file']) as archive:
                manifest = json.loads(archive.read('asset.json'))
        self.assertEqual(manifest['schemaVersion'], 2)
        self.assertEqual(manifest['source']['path'], {'host': socket.gethostname().upper(), 'absolutePath': media.resolve().as_posix()})
        self.assertEqual(manifest['clientBuild'], reference_client_build(fixture_lock))
        self.assertEqual(manifest['converterVersion'], implementation_hash())
        self.assertNotIn('coordinates', manifest)

    def test_converter_refuses_to_write_without_the_reference_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            (client / 'sample.wav').write_bytes(synthetic_wav())
            tool = root / 'tool.exe'
            tool.write_bytes(b'not executed by the media adapter')
            with patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())), patch('native_assets.REFERENCE_CLIENT_LOCK_PATH', root / 'absent.lock.json'):
                with self.assertRaisesRegex(ValueError, 'reference client lock missing'):
                    Converter(client, root / 'output', tool).convert({'kind': 'audio', 'media': 'sample.wav'})


if __name__ == '__main__':
    unittest.main()
