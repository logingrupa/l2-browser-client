import json

from native_store.catalog_writer import (NATIVE_RESOURCE_PREFIX, CatalogWriteError, read_store_catalog, refuse_duplicate_json_keys,
                                         refuse_non_finite_json_number, sha256_hex, validate_catalog_record)
from native_store.store_paths import confined_child_path, lane_store_root
from native_store.unit_ledger import locked_input_records

DATA_UI_LANE_NAME = 'data-ui'
DECODED_TABLE_KIND = 'native-table'
DECODED_TABLE_SCHEMA_VERSION = 1


class DataUiTableManifestError(ValueError):
    pass


def data_ui_tables_record(store_root, table_name):
    try:
        catalog, _ = read_store_catalog(store_root)
        tables = catalog.get('tables', [])
        if not isinstance(tables, list):
            raise CatalogWriteError('catalog tables slice is not a list')
        records = [validate_catalog_record('tables', record) for record in tables if isinstance(record, dict) and record.get('id') == table_name]
    except CatalogWriteError as error:
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane catalog holds a refused {table_name} tables record: {error}') from error
    if len(records) > 1:
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane catalog holds more than one {table_name} tables record')
    return records[0] if records else None


def read_pinned_manifest_bytes(store_root, record):
    manifest_path = confined_child_path(store_root, record['manifest'][len(NATIVE_RESOURCE_PREFIX):])
    with open(manifest_path, 'rb') as stream:
        manifest_bytes = stream.read(record['manifestBytes'] + 1)
    if len(manifest_bytes) != record['manifestBytes'] or sha256_hex(manifest_bytes) != record['manifestSha256']:
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane manifest {record["manifest"]} differs from its tables record')
    return manifest_bytes


def data_ui_table_manifest(project_root, table_name):
    store_root = lane_store_root(project_root, DATA_UI_LANE_NAME)
    record = data_ui_tables_record(store_root, table_name)
    if record is None:
        return None
    manifest_bytes = read_pinned_manifest_bytes(store_root, record)
    try:
        manifest = json.loads(manifest_bytes, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane manifest {record["manifest"]} is not strict JSON: {error}') from error
    if not (isinstance(manifest, dict) and manifest.get('kind') == DECODED_TABLE_KIND
            and manifest.get('schemaVersion') == DECODED_TABLE_SCHEMA_VERSION and manifest.get('table') == table_name
            and isinstance(manifest.get('sourcePath'), str) and isinstance(manifest.get('records'), dict)):
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane manifest {record["manifest"]} must be a {DECODED_TABLE_KIND} '
                                       f'v{DECODED_TABLE_SCHEMA_VERSION} manifest of {table_name} with a sourcePath and records')
    locked_sha256 = locked_input_records([manifest['sourcePath']])[0]['sha256']
    if not (manifest.get('sourceSha256') == record['sourceSha256'] == locked_sha256):
        raise DataUiTableManifestError(f'{DATA_UI_LANE_NAME} lane manifest {record["manifest"]} is not decoded from the locked '
                                       f'{manifest["sourcePath"]}')
    return manifest
