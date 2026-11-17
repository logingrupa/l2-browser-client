import json
from pathlib import Path

from native_actor_profiles import verify_npc_profiles
from native_store.catalog_record_replacement import catalog_with_records_replaced, catalog_without_records
from native_store.catalog_writer import NATIVE_RESOURCE_PREFIX, add_store_file
from native_store.verified_file_writes import sha256_hex
from native_store.store_paths import StorePathError, confined_child_path

PROFILE_STORE_FOLDER = 'npc-profiles'
PROFILE_MANIFEST_FILE_NAME = 'manifest.json'
PROFILE_RECEIPT_FILE_NAME = 'receipt.json'


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


def profile_slice_with_pack_record(profile_slice, superseded_ids, profile_record, capacity):
    return catalog_with_records_replaced(catalog_without_records(profile_slice, 'npcProfiles', superseded_ids), 'npcProfiles', [profile_record],
                                         capacity)


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
