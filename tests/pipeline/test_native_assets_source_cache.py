import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_assets
import reference_client_guard
from native_assets import Converter, sha
from reference_client_guard import read_reference_client_lock
from test_native_assets_manifest_v2 import synthetic_wav
from test_reference_client_guard import GuardedConversionRootTestCase, write_tree_file

MEDIA_RELATIVE_PATH = 'media/sample.wav'
MEDIA_REQUEST = {'kind': 'audio', 'media': MEDIA_RELATIVE_PATH}


class ClientFileHashCounter:
    def __init__(self, client_root):
        self.client_root = Path(client_root).resolve()
        self.hashed_relative_paths = []

    def counted(self, hash_function):
        def hash_and_count(path):
            resolved = Path(path).resolve()
            if resolved.is_relative_to(self.client_root):
                self.hashed_relative_paths.append(resolved.relative_to(self.client_root).as_posix())
            return hash_function(path)
        return hash_and_count

    def __enter__(self):
        self.patchers = [patch.object(reference_client_guard, 'sha256_of_file', self.counted(reference_client_guard.sha256_of_file)),
                         patch.object(native_assets, 'hash_file', self.counted(native_assets.hash_file))]
        for patcher in self.patchers:
            patcher.start()
        return self

    def __exit__(self, *exception):
        for patcher in self.patchers:
            patcher.stop()

    def count(self, relative_path):
        return self.hashed_relative_paths.count(relative_path)


class LockedSourceTestCase(GuardedConversionRootTestCase):
    def setUp(self):
        super().setUp()
        for root in (self.trees.importa_root, self.trees.conversion_root):
            write_tree_file(root, MEDIA_RELATIVE_PATH, synthetic_wav())
        self.trees.write_lock()
        self.project = Path(self.temporary_directory.name).resolve()
        self.umodel = write_tree_file(self.project, 'tools/umodel.exe', b'dummy umodel')
        umodel_patcher = patch.object(native_assets, 'UMODEL_SHA256', hashlib.sha256(self.umodel.read_bytes()).hexdigest())
        umodel_patcher.start()
        self.addCleanup(umodel_patcher.stop)

    def create_converter(self, client_root):
        return Converter(client_root, self.project / 'artifacts' / 'output', self.umodel, project_root=self.project)

    def locked_sha256(self, relative_path):
        return read_reference_client_lock(self.trees.lock_path).record(relative_path)['eSha256']


def archived_json(result, name):
    with zipfile.ZipFile(result['file']) as archive:
        return json.loads(archive.read(name))


class LockedSourceDigestTests(LockedSourceTestCase):
    def test_cached_media_conversion_hashes_each_client_file_once_and_nothing_on_the_cache_hit(self):
        with ClientFileHashCounter(self.trees.conversion_root) as counter:
            converter = self.create_converter(self.trees.conversion_root)
            first = converter.convert(MEDIA_REQUEST)
            hashes_after_first_conversion = len(counter.hashed_relative_paths)
            second = converter.convert(MEDIA_REQUEST)
        self.assertFalse(first['cacheHit'])
        self.assertTrue(second['cacheHit'])
        self.assertEqual(len(counter.hashed_relative_paths), hashes_after_first_conversion)
        self.assertEqual(counter.count(MEDIA_RELATIVE_PATH), 1)
        self.assertEqual(counter.count('system/Engine.dll'), 1)
        self.assertEqual(sorted(counter.hashed_relative_paths), ['media/sample.wav', 'system/Engine.dll'])
        provenance = archived_json(first, 'provenance.json')
        self.assertEqual(provenance['dependencies'][MEDIA_RELATIVE_PATH], self.locked_sha256(MEDIA_RELATIVE_PATH))
        self.assertEqual(provenance['source']['sha256'], self.locked_sha256(MEDIA_RELATIVE_PATH))


if __name__ == '__main__':
    unittest.main()
