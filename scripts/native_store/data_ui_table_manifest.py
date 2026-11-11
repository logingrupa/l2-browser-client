import json

from native_store.catalog_writer import (CatalogWriteError, read_pinned_file, read_store_catalog, refuse_duplicate_json_keys,
                                         refuse_non_finite_json_number, require_file_pin, validate_catalog_record)
from native_store.store_paths import lane_store_root
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


def data_ui_table_manifest(project_root, table_name):
    store_root = lane_store_root(project_root, DATA_UI_LANE_NAME)
    record = data_ui_tables_record(store_root, table_name)
    if record is None:
        return None
    label = f'{DATA_UI_LANE_NAME} lane manifest {record["manifest"]}'
    try:
        manifest_bytes = read_pinned_file(store_root, require_file_pin(record, 'manifest', 'manifestSha256', 'manifestBytes', label))
    except CatalogWriteError as error:
        raise DataUiTableManifestError(f'{label} differs from its tables record: {error}') from error
    try:
        manifest = json.loads(manifest_bytes, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise DataUiTableManifestError(f'{label} is not strict JSON: {error}') from error
    if not (isinstance(manifest, dict) and manifest.get('kind') == DECODED_TABLE_KIND
            and manifest.get('schemaVersion') == DECODED_TABLE_SCHEMA_VERSION and manifest.get('table') == table_name
            and isinstance(manifest.get('sourcePath'), str) and isinstance(manifest.get('records'), dict)):
        raise DataUiTableManifestError(f'{label} must be a {DECODED_TABLE_KIND} v{DECODED_TABLE_SCHEMA_VERSION} manifest of {table_name} '
                                       'with a sourcePath and records')
    locked_sha256 = locked_input_records([manifest['sourcePath']])[0]['sha256']
    if not (manifest.get('sourceSha256') == record['sourceSha256'] == locked_sha256):
        raise DataUiTableManifestError(f'{label} is not decoded from the locked {manifest["sourcePath"]}')
    return manifest
