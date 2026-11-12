import io
import json
from pathlib import Path
import zipfile

from native_actor_profiles import verify_npc_profiles
from native_assets import verify_archive
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import (add_store_file, merge_catalog_slice, merge_catalog_slice_records, read_store_catalog, sha256_hex,
                                         validate_catalog_record, write_store)
from native_store.store_paths import StorePathError, confined_child_path

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


def catalog_without_record(catalog, slice_name, record_id):
    if slice_name not in catalog:
        return catalog
    return {**catalog, slice_name: [existing for existing in catalog[slice_name] if existing.get('id') != record_id]}


def catalog_without_records(catalog, slice_name, record_ids):
    if slice_name not in catalog or not record_ids:
        return catalog
    return {**catalog, slice_name: [existing for existing in catalog[slice_name] if existing.get('id') not in record_ids]}


def catalog_with_record_replaced(catalog, slice_name, record, capacity):
    return merge_catalog_slice(catalog_without_record(catalog, slice_name, record['id']), slice_name, record, capacity)


def catalog_with_records_replaced(catalog, slice_name, records, capacity):
    if not records:
        return catalog
    last_records_by_id = {}
    for record in records:
        record_id = validate_catalog_record(slice_name, record)['id']
        last_records_by_id.pop(record_id, None)
        last_records_by_id[record_id] = record
    pruned_catalog = catalog_without_records(catalog, slice_name, last_records_by_id.keys())
    return merge_catalog_slice_records(pruned_catalog, slice_name, list(last_records_by_id.values()), capacity)


def write_catalog_without_record(store_root, slice_name, record_id):
    catalog, before = read_store_catalog(store_root)
    pruned = catalog_without_records(catalog, slice_name, {record_id})
    if pruned != catalog:
        write_store(store_root, {}, before, json_bytes(pruned))


def native_resource_store_path(store_root, resource):
    if not (isinstance(resource, str) and resource.startswith(NATIVE_RESOURCE_PREFIX)):
        raise StorePathError(f'store resource does not start with {NATIVE_RESOURCE_PREFIX}: {resource!r}')
    return confined_child_path(Path(store_root), resource[len(NATIVE_RESOURCE_PREFIX):])


def profile_record_npc_ids(store_root, record):
    manifest = json.loads(native_resource_store_path(store_root, record['manifest']).read_bytes())
    return [profile['npcId'] for profile in manifest['profiles']]


def bundle_output_records(lane_folder, bundle_root):
    bundle_root = Path(bundle_root)
    names = [PROFILE_MANIFEST_FILE_NAME, PROFILE_RECEIPT_FILE_NAME]
    return [file_output_record(lane_folder, bundle_root / name) for name in names]


def file_output_record(lane_folder, path):
    payload = Path(path).read_bytes()
    return {'path': Path(path).relative_to(lane_folder).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
