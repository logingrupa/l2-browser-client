import json

from actors.npc_store_records import native_resource_store_path
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root
from native_store.unit_ledger import locked_input_records

DATA_UI_LANE_NAME = 'data-ui'


class DataUiTableManifestError(ValueError):
    pass


def data_ui_table_manifest(project_root, table_name):
    store_root = lane_store_root(project_root, DATA_UI_LANE_NAME)
    catalog_path = store_root / 'catalog.json'
    if not catalog_path.is_file():
        return None
    records = [record for record in json.loads(catalog_path.read_bytes()).get('tables', []) if record['id'] == table_name]
    if len(records) != 1:
        return None
    record = records[0]
    manifest_bytes = native_resource_store_path(store_root, record['manifest']).read_bytes()
    if sha256_hex(manifest_bytes) != record['manifestSha256'] or len(manifest_bytes) != record['manifestBytes']:
        raise DataUiTableManifestError(f'data-ui lane manifest {record["manifest"]} differs from its tables record')
    manifest = json.loads(manifest_bytes)
    locked_sha256 = locked_input_records([manifest['sourcePath']])[0]['sha256']
    if not (manifest['sourceSha256'] == record['sourceSha256'] == locked_sha256):
        raise DataUiTableManifestError(f'data-ui lane manifest {record["manifest"]} is not decoded from the locked {manifest["sourcePath"]}')
    return manifest
