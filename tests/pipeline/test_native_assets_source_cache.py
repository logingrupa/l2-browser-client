import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_assets
import reference_client_guard
from native_assets import Converter
from reference_client_guard import read_reference_client_lock
from test_native_assets_manifest_v2 import synthetic_wav
from test_reference_client_guard import GuardedConversionRootTestCase, write_tree_file

MEDIA_RELATIVE_PATH = 'media/sample.wav'
MEDIA_REQUEST = {'kind': 'audio', 'media': MEDIA_RELATIVE_PATH}
FILETIME_TICK_NANOSECONDS = 100


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
        self.umodel_sha256 = hashlib.sha256(self.umodel.read_bytes()).hexdigest()
        umodel_patcher = patch.object(native_assets, 'UMODEL_SHA256', self.umodel_sha256)
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


def move_modification_time_by_one_filetime_tick(path):
    status = os.stat(path)
    os.utime(path, ns=(status.st_atime_ns, status.st_mtime_ns + FILETIME_TICK_NANOSECONDS))
    if os.stat(path).st_mtime_ns == status.st_mtime_ns:
        raise AssertionError(f'modification time of {path} did not move by one FILETIME tick')


class SourceDigestMemoTests(LockedSourceTestCase):
    def setUp(self):
        super().setUp()
        self.media = self.trees.conversion_root / MEDIA_RELATIVE_PATH
        self.converter = self.create_converter(self.trees.conversion_root)

    def test_modification_time_change_alone_is_hashed_once_per_file_identity(self):
        move_modification_time_by_one_filetime_tick(self.media)
        with ClientFileHashCounter(self.trees.conversion_root) as counter:
            for _ in range(3):
                self.converter.source(self.media)
            self.converter.convert(MEDIA_REQUEST)
            self.assertTrue(self.converter.convert(MEDIA_REQUEST)['cacheHit'])
            self.assertEqual(counter.count(MEDIA_RELATIVE_PATH), 1)
            move_modification_time_by_one_filetime_tick(self.media)
            self.converter.source(self.media)
            self.assertEqual(counter.count(MEDIA_RELATIVE_PATH), 2)

    def test_different_bytes_are_refused_by_the_stale_lock_error(self):
        self.converter.source(self.media)
        self.media.write_bytes(synthetic_wav()[:-2] + b'\x07\x00')
        with self.assertRaisesRegex(ValueError, 'reference client lock is stale for media/sample.wav; re-lock ordered'):
            self.converter.source(self.media)

    def test_file_edited_during_a_conversion_fails_the_unchanged_check(self):
        self.converter.source(self.media)
        self.media.write_bytes(b'edited during the conversion')
        with self.assertRaises(ValueError):
            self.converter.require_unchanged_dependencies()

    @unittest.skipUnless(sys.platform == 'win32', 'Windows path casing')
    def test_two_spellings_of_one_file_share_one_verification(self):
        with ClientFileHashCounter(self.trees.conversion_root) as counter:
            self.converter.source(self.media)
            self.converter.source(self.trees.conversion_root / 'Media/SAMPLE.wav')
        self.assertEqual(len(counter.hashed_relative_paths), 1)
        self.assertEqual(list(self.converter.dependencies), [MEDIA_RELATIVE_PATH])
        media_identities = [identity for identity in reference_client_guard.sha256_by_file_identity if identity[0].endswith('sample.wav')]
        self.assertEqual(len(media_identities), 1)

    def test_empty_dependency_map_checks_nothing(self):
        self.converter.dependencies = {}
        with patch.object(self.converter.source_digests, 'digest_of') as digest_of:
            self.converter.require_unchanged_dependencies()
        digest_of.assert_not_called()

    def test_one_conversion_computes_the_implementation_hash_once(self):
        with patch.object(native_assets, 'implementation_hash', wraps=native_assets.implementation_hash) as implementation_hash:
            result = self.converter.convert(MEDIA_REQUEST)
        self.assertEqual(implementation_hash.call_count, 1)
        self.assertEqual(archived_json(result, 'provenance.json')['converterSha256'], archived_json(result, 'asset.json')['converterVersion'])

    def test_recorded_source_sha256_reads_only_digests_source_recorded(self):
        self.converter.source(self.media)
        self.assertEqual(self.converter.recorded_source_sha256(self.media), self.locked_sha256(MEDIA_RELATIVE_PATH))
        with self.assertRaises(KeyError):
            self.converter.recorded_source_sha256(self.trees.conversion_root / 'animations/Fighter.ukx')


class UnlockedRootSourceDigestTests(LockedSourceTestCase):
    def test_reference_root_hashes_every_source_read(self):
        converter = self.create_converter(self.trees.importa_root)
        self.assertFalse(converter.reference_client.requires_lock)
        media = self.trees.importa_root / MEDIA_RELATIVE_PATH
        with ClientFileHashCounter(self.trees.importa_root) as counter:
            for expected_count in (1, 2, 3):
                converter.source(media)
                self.assertEqual(counter.count(MEDIA_RELATIVE_PATH), expected_count)
            converter.require_unchanged_dependencies()
            self.assertEqual(counter.count(MEDIA_RELATIVE_PATH), 4)


if __name__ == '__main__':
    unittest.main()
