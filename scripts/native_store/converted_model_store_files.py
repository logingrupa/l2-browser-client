import io
import json
from pathlib import Path
import zipfile

from native_assets import verify_archive
from native_store.catalog_writer import NATIVE_RESOURCE_PREFIX, add_store_file
from native_store.verified_file_writes import sha256_hex

MODEL_ARCHIVE_FILE_NAME = 'asset.l2asset'
MODEL_STORE_FILE_NAME = 'model.glb'


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
