import io
import json
from pathlib import Path
import zipfile

from native_assets import verify_archive
from native_store.catalog_writer import NATIVE_RESOURCE_PREFIX, StoreFileEntry, add_store_file_entry
from native_store.verified_file_writes import StorePayloadIntegrityError, sha256_hex

MODEL_ARCHIVE_FILE_NAME = 'asset.l2asset'
MODEL_STORE_FILE_NAME = 'model.glb'
PAYLOAD_CHANGED_IN_MEMORY = 'payload changed in memory since verification'


def unreadable_archive_error(archive_path, error):
    return StorePayloadIntegrityError(f'Archive {archive_path} is not a readable zip: {error}')


def verified_archive_sha256(archive_path):
    try:
        return verify_archive(archive_path)['sha256']
    except zipfile.BadZipFile as error:
        raise unreadable_archive_error(archive_path, error) from error


def archive_manifest_and_model_bytes(archive_path, archive_bytes):
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            manifest = json.loads(archive.read('asset.json'))
            return manifest, archive.read(manifest['model']['file'])
    except zipfile.BadZipFile as error:
        raise unreadable_archive_error(archive_path, error) from error


def manifest_model_sha256(archive_path, manifest, model_bytes):
    model_file = manifest['model']['file']
    pinned_sha256 = next(entry['sha256'] for entry in manifest['files'] if entry['path'] == model_file)
    model_sha256 = sha256_hex(model_bytes)
    if model_sha256 != pinned_sha256:
        raise StorePayloadIntegrityError(f'Archive {archive_path} {model_file} hashes to {model_sha256} where its manifest pins {pinned_sha256}: '
                                         f'{PAYLOAD_CHANGED_IN_MEMORY}')
    return pinned_sha256


def converted_model_store_files_and_record(record_id, archive_path):
    archive_bytes = Path(archive_path).read_bytes()
    archive_sha256 = sha256_hex(archive_bytes)
    verified_sha256 = verified_archive_sha256(archive_path)
    if archive_sha256 != verified_sha256:
        raise StorePayloadIntegrityError(f'Archive {archive_path} read as SHA-256 {archive_sha256} but verified as {verified_sha256}: '
                                         f'{PAYLOAD_CHANGED_IN_MEMORY}')
    manifest, model_bytes = archive_manifest_and_model_bytes(archive_path, archive_bytes)
    model_sha256 = manifest_model_sha256(archive_path, manifest, model_bytes)
    files = {}
    add_store_file_entry(files, StoreFileEntry(f'{archive_sha256}/{MODEL_ARCHIVE_FILE_NAME}', archive_bytes, archive_sha256))
    add_store_file_entry(files, StoreFileEntry(f'{archive_sha256}/{MODEL_STORE_FILE_NAME}', model_bytes, model_sha256))
    record = {'id': record_id, 'assetId': manifest['id'], 'source': manifest['source'],
              'archive': f'{NATIVE_RESOURCE_PREFIX}{archive_sha256}/{MODEL_ARCHIVE_FILE_NAME}', 'archiveSha256': archive_sha256,
              'model': f'{NATIVE_RESOURCE_PREFIX}{archive_sha256}/{MODEL_STORE_FILE_NAME}', 'modelSha256': model_sha256,
              'nativeSkinAdapter': manifest['model'].get('nativeSkinAdapter'), 'limitations': manifest['limitations']}
    return files, record
