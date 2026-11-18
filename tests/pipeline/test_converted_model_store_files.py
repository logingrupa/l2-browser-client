import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_store import converted_model_store_files
from native_store.catalog_writer import StoreFileEntry
from native_store.converted_model_store_files import converted_model_store_files_and_record
from native_store.verified_file_writes import StorePayloadIntegrityError

MODEL_BYTES = b'synthetic model glb bytes of one converted static mesh'
PROVENANCE_BYTES = json_bytes({'metadata': {}})
RECORD_ID = 'interlude:Synthetic.Rock'
REAL_READ_BYTES = Path.read_bytes


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def asset_manifest(model_sha256):
    return {'schemaVersion': 1, 'id': RECORD_ID, 'name': 'Rock', 'kind': 'model',
            'source': {'object': 'Synthetic.Rock', 'package': 'Synthetic', 'sha256': 'a' * 64},
            'model': {'file': 'model.glb'}, 'limitations': ['Synthetic converted model fixture.'],
            'files': [{'path': 'model.glb', 'bytes': len(MODEL_BYTES), 'sha256': model_sha256},
                      {'path': 'provenance.json', 'bytes': len(PROVENANCE_BYTES), 'sha256': sha256_hex(PROVENANCE_BYTES)}]}


def converted_archive_bytes():
    return archive_bytes(asset_manifest(sha256_hex(MODEL_BYTES)), {'model.glb': MODEL_BYTES, 'provenance.json': PROVENANCE_BYTES})


def archive_whose_manifest_pins_another_model_sha256():
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('asset.json', json_bytes(asset_manifest('b' * 64)))
        archive.writestr('model.glb', MODEL_BYTES)
        archive.writestr('provenance.json', PROVENANCE_BYTES)
    return result.getvalue()


def with_one_flipped_model_byte(payload):
    offset = payload.index(MODEL_BYTES)
    return payload[:offset] + bytes([payload[offset] ^ 0x01]) + payload[offset + 1:]


class ConvertedModelStoreFilesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.archive_path = Path(temporary_directory.name) / 'asset.l2asset'

    def reads_with_one_flipped_model_byte_at(self, flipped_read_index):
        reads_of_the_archive = []

        def read_bytes(path):
            payload = REAL_READ_BYTES(path)
            if Path(path) != self.archive_path:
                return payload
            reads_of_the_archive.append(path)
            return with_one_flipped_model_byte(payload) if len(reads_of_the_archive) - 1 == flipped_read_index else payload

        return mock.patch.object(Path, 'read_bytes', read_bytes)

    def test_an_intact_archive_is_named_by_the_hash_of_its_single_read_and_its_model_expects_the_manifest_sha256(self):
        archive = converted_archive_bytes()
        self.archive_path.write_bytes(archive)
        files, record = converted_model_store_files_and_record(RECORD_ID, self.archive_path)
        archive_sha256 = sha256_hex(archive)
        self.assertEqual(list(files.values()), [StoreFileEntry(f'{archive_sha256}/asset.l2asset', archive, archive_sha256),
                                                StoreFileEntry(f'{archive_sha256}/model.glb', MODEL_BYTES, sha256_hex(MODEL_BYTES))])
        self.assertEqual((record['archiveSha256'], record['modelSha256']), (archive_sha256, sha256_hex(MODEL_BYTES)))

    def test_two_reads_of_the_archive_that_disagree_by_one_flipped_byte_raise_an_integrity_error_naming_the_archive(self):
        self.archive_path.write_bytes(converted_archive_bytes())
        for flipped_read_index in (0, 1):
            with self.subTest(flipped_read_index=flipped_read_index), self.reads_with_one_flipped_model_byte_at(flipped_read_index):
                with self.assertRaises(StorePayloadIntegrityError) as refusal:
                    converted_model_store_files_and_record(RECORD_ID, self.archive_path)
                self.assertNotIsInstance(refusal.exception, ValueError)
                self.assertIn(str(self.archive_path), str(refusal.exception))

    def test_the_archive_bytes_hash_differs_from_the_verified_sha256_names_both_hashes(self):
        archive = converted_archive_bytes()
        self.archive_path.write_bytes(archive)
        with self.reads_with_one_flipped_model_byte_at(0), \
                mock.patch.object(converted_model_store_files, 'verify_archive', return_value={'sha256': sha256_hex(archive)}):
            with self.assertRaises(StorePayloadIntegrityError) as refusal:
                converted_model_store_files_and_record(RECORD_ID, self.archive_path)
        self.assertEqual(str(refusal.exception), f'Archive {self.archive_path} read as SHA-256 {sha256_hex(with_one_flipped_model_byte(archive))} '
                                                 f'but verified as {sha256_hex(archive)}: payload changed in memory since verification')

    def test_a_bad_crc_of_model_glb_raises_an_integrity_error_naming_the_archive_and_not_a_bad_zip_file(self):
        self.archive_path.write_bytes(with_one_flipped_model_byte(converted_archive_bytes()))
        with self.assertRaises(StorePayloadIntegrityError) as refusal:
            converted_model_store_files_and_record(RECORD_ID, self.archive_path)
        self.assertIsInstance(refusal.exception.__cause__, zipfile.BadZipFile)
        self.assertEqual(str(refusal.exception), f'Archive {self.archive_path} is not a readable zip: Bad CRC-32 for file \'model.glb\'')

    def test_model_glb_bytes_that_differ_from_the_manifest_entry_raise_an_integrity_error(self):
        archive = archive_whose_manifest_pins_another_model_sha256()
        self.archive_path.write_bytes(archive)
        with mock.patch.object(converted_model_store_files, 'verify_archive', return_value={'sha256': sha256_hex(archive)}):
            with self.assertRaises(StorePayloadIntegrityError) as refusal:
                converted_model_store_files_and_record(RECORD_ID, self.archive_path)
        self.assertEqual(str(refusal.exception), f'Archive {self.archive_path} model.glb hashes to {sha256_hex(MODEL_BYTES)} where its manifest '
                                                 f'pins {"b" * 64}: payload changed in memory since verification')


if __name__ == '__main__':
    unittest.main()
