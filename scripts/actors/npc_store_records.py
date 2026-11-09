import io
import json
from pathlib import Path
import zipfile

from native_actor_profiles import verify_npc_profiles
from native_assets import verify_archive
from native_store.catalog_writer import add_store_file, sha256_hex

NATIVE_RESOURCE_PREFIX = '/l2/'
MODEL_ARCHIVE_FILE_NAME = 'asset.l2asset'
MODEL_STORE_FILE_NAME = 'model.glb'
PROFILE_STORE_FOLDER = 'npc-profiles'
PROFILE_MANIFEST_FILE_NAME = 'manifest.json'
PROFILE_RECEIPT_FILE_NAME = 'receipt.json'


def converted_model_store_files_and_record(record_id, archive_path):
    archive_sha256 = verify_archive(archive_path)['sha256']
    archive_bytes = Path(archive_path).read_bytes()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        manifest = json.loads(archive.read('asset.json'))
        model_bytes = archive.read(manifest['model']['file'])
    files = {}
    add_store_file(files, f'{archive_sha256}/{MODEL_ARCHIVE_FILE_NAME}', archive_bytes)
    add_store_file(files, f'{archive_sha256}/{MODEL_STORE_FILE_NAME}', model_bytes)
    record = {'id': record_id, 'assetId': manifest['id'], 'source': manifest['source'],
              'archive': f'{NATIVE_RESOURCE_PREFIX}{archive_sha256}/{MODEL_ARCHIVE_FILE_NAME}', 'archiveSha256': archive_sha256,
              'model': f'{NATIVE_RESOURCE_PREFIX}{archive_sha256}/{MODEL_STORE_FILE_NAME}', 'modelSha256': sha256_hex(model_bytes),
              'nativeSkinAdapter': manifest['model'].get('nativeSkinAdapter'), 'limitations': manifest['limitations']}
    return files, record


def profile_bundle_store_files_and_record(client_root, bundle_root):
    bundle_root = Path(bundle_root)
    manifest_sha256 = verify_npc_profiles(client_root, bundle_root)['sha256']
    manifest_bytes = (bundle_root / PROFILE_MANIFEST_FILE_NAME).read_bytes()
    receipt_bytes = (bundle_root / PROFILE_RECEIPT_FILE_NAME).read_bytes()
    prefix = f'{PROFILE_STORE_FOLDER}/{manifest_sha256}/'
    files = {}
    add_store_file(files, prefix + PROFILE_MANIFEST_FILE_NAME, manifest_bytes)
    add_store_file(files, prefix + PROFILE_RECEIPT_FILE_NAME, receipt_bytes)
    for bundle_file in json.loads(receipt_bytes)['files']:
        add_store_file(files, prefix + bundle_file['file'], (bundle_root / bundle_file['file']).read_bytes())
    record = {'id': json.loads(manifest_bytes)['id'], 'manifest': f'{NATIVE_RESOURCE_PREFIX}{prefix}{PROFILE_MANIFEST_FILE_NAME}',
              'manifestSha256': manifest_sha256, 'manifestBytes': len(manifest_bytes)}
    return files, record


def bundle_output_records(lane_folder, bundle_root):
    bundle_root = Path(bundle_root)
    names = [PROFILE_MANIFEST_FILE_NAME, PROFILE_RECEIPT_FILE_NAME]
    return [file_output_record(lane_folder, bundle_root / name) for name in names]


def file_output_record(lane_folder, path):
    payload = Path(path).read_bytes()
    return {'path': Path(path).relative_to(lane_folder).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
