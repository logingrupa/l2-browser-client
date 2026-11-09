import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from hash_reference_client_tree import canonical_json_bytes
from lane_unit_outcomes import seal_unit_manifest, write_pinned_manifest_to_store
from convert_tables import DECODE_STEP, LANE_NAME, NATIVE_TABLE_MANIFEST_KIND, TABLES_CATALOG_CAPACITY, TABLES_CATALOG_SLICE
from native_store.catalog_writer import (TABLE_NAME_INDEX_ID_SUFFIX, is_table_name_index_id, read_store_catalog, sha256_hex,
                                         validate_catalog_record)
from native_store.gap_rows import read_gap_rows
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root, require_converter_output
from native_store.unit_ledger import UnitLedger
from table_name_index_sources import NAME_INDEX_SOURCES

NAME_INDEX_ALGORITHM_VERSION = 1
NAME_INDEX_STEP = 'name-index'
NAME_INDEX_MANIFEST_KIND = 'native-table-name-index'
NAME_INDEX_MANIFEST_SCHEMA_VERSION = 1


class TableNameIndexError(ValueError):
    pass


def name_index_record_id(table):
    record_id = table.replace('-', '_') + TABLE_NAME_INDEX_ID_SUFFIX
    if not is_table_name_index_id(record_id):
        raise TableNameIndexError(f'{table} gives a name index id {record_id} outside the tables id rule')
    return record_id


def require_name_index_source(table):
    if table not in NAME_INDEX_SOURCES:
        raise TableNameIndexError(f'{table} has no name index source; tables: {", ".join(sorted(NAME_INDEX_SOURCES))}')
    return NAME_INDEX_SOURCES[table]


def source_rows(table, source_manifest, source):
    if not (isinstance(source_manifest, dict) and source_manifest.get('kind') == NATIVE_TABLE_MANIFEST_KIND
            and source_manifest.get('table') == table and isinstance(source_manifest.get('records'), dict)):
        raise TableNameIndexError(f'source manifest is not a {NATIVE_TABLE_MANIFEST_KIND} manifest of {table}')
    rows = source_manifest['records'].get(source.rows_field)
    if not isinstance(rows, list):
        raise TableNameIndexError(f'{table} manifest records hold no {source.rows_field} list')
    for row_index, row in enumerate(rows):
        if not (isinstance(row, dict) and all(type(row.get(field)) is int for field in source.identifier_fields)
                and isinstance(row.get(source.name_field), str)):
            raise TableNameIndexError(f'{table} row {row_index} lacks integer {", ".join(source.identifier_fields)} '
                                      f'or a string {source.name_field}')
    return rows


def native_table_name_index(table, source_manifest, source_manifest_sha256):
    source = require_name_index_source(table)
    entry_fields = (*source.identifier_fields, source.name_field)
    entries = sorted(({field: row[field] for field in entry_fields} for row in source_rows(table, source_manifest, source)),
                     key=lambda entry: tuple(entry[field] for field in source.identifier_fields))
    identifier_tuples = [tuple(entry[field] for field in source.identifier_fields) for entry in entries]
    return {'kind': NAME_INDEX_MANIFEST_KIND, 'schemaVersion': NAME_INDEX_MANIFEST_SCHEMA_VERSION, 'table': table,
            'sourceManifestSha256': source_manifest_sha256, 'sourceSha256': source_manifest['sourceSha256'],
            'identifierFields': list(source.identifier_fields), 'nameField': source.name_field, 'entryCount': len(entries),
            'duplicateIdentifierCount': len(identifier_tuples) - len(set(identifier_tuples)), 'entries': entries}


def tables_record_by_id(catalog, record_id):
    matching = [record for record in catalog.get(TABLES_CATALOG_SLICE, []) if record.get('id') == record_id]
    return validate_catalog_record(TABLES_CATALOG_SLICE, matching[0]) if matching else None


def decode_gap_row(project_root, table):
    unit_key = f'table:{table}'
    return next((row for row in read_gap_rows(project_root, LANE_NAME) if row['step'] == DECODE_STEP and row['key'] == unit_key), None)


def verified_source_manifest_bytes(output_root, source_record):
    source_path = Path(output_root) / source_record['manifest'].removeprefix('/l2/')
    source_bytes = source_path.read_bytes()
    if len(source_bytes) != source_record['manifestBytes'] or sha256_hex(source_bytes) != source_record['manifestSha256']:
        raise TableNameIndexError(f'source manifest {source_record["manifest"]} differs from its catalog manifestSha256; refused')
    return source_bytes


def write_table_name_index(project_root, table, output_root, ledger):
    source = require_name_index_source(table)
    unit_key = f'table:{table}'
    catalog, _ = read_store_catalog(output_root)
    source_record = tables_record_by_id(catalog, table)
    if source_record is None:
        gap_row = decode_gap_row(project_root, table)
        if gap_row is None:
            raise TableNameIndexError(f'{table} has neither a sealed tables record nor a decode gap row in the {LANE_NAME} lane')
        return {'unit': unit_key, 'status': 'gap', 'reason': gap_row['reason']}
    inputs = [{'path': 'l2/' + source_record['manifest'].removeprefix('/l2/'), 'sha256': source_record['manifestSha256']}]
    config = {'table': table, 'rowsField': source.rows_field, 'identifierFields': list(source.identifier_fields),
              'nameField': source.name_field}
    fingerprint = ledger.unit_fingerprint([source_record['manifestSha256']], config)
    if ledger.is_sealed(unit_key, fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    source_bytes = verified_source_manifest_bytes(output_root, source_record)
    ledger.begin(unit_key, fingerprint)
    name_index = native_table_name_index(table, json.loads(source_bytes), source_record['manifestSha256'])
    index_bytes = canonical_json_bytes(name_index)
    index_sha256 = sha256_hex(index_bytes)
    record_id = name_index_record_id(table)
    manifest_relative = f'{TABLES_CATALOG_SLICE}/{index_sha256}/{record_id}.json'
    record = validate_catalog_record(TABLES_CATALOG_SLICE, {
        'id': record_id, 'manifest': f'/l2/{manifest_relative}', 'manifestSha256': index_sha256, 'manifestBytes': len(index_bytes),
        'recordCount': name_index['entryCount'], 'sourceSha256': name_index['sourceSha256']})
    manifest_path = write_pinned_manifest_to_store(output_root, TABLES_CATALOG_SLICE, record, manifest_relative, index_bytes,
                                                   TABLES_CATALOG_CAPACITY)
    seal_unit_manifest(project_root, ledger, unit_key, fingerprint, inputs, config, manifest_path, record)
    return {'unit': unit_key, 'status': 'indexed', 'id': record_id, 'entryCount': record['recordCount'],
            'duplicateIdentifierCount': name_index['duplicateIdentifierCount'], 'manifest': record['manifest'],
            'manifestBytes': record['manifestBytes']}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build id and name indexes from sealed table manifests in the data-ui lane store.')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--table', action='append', choices=sorted(NAME_INDEX_SOURCES))
    arguments = parser.parse_args(argv)
    try:
        output_root = require_converter_output(REPOSITORY_ROOT, arguments.output or lane_store_root(REPOSITORY_ROOT, LANE_NAME))
        ledger = UnitLedger(lane_work_root(REPOSITORY_ROOT, LANE_NAME), NAME_INDEX_STEP, NAME_INDEX_ALGORITHM_VERSION)
        with lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, LANE_NAME):
            for table in dict.fromkeys(arguments.table or sorted(NAME_INDEX_SOURCES)):
                print(json.dumps(write_table_name_index(REPOSITORY_ROOT, table, output_root, ledger), sort_keys=True), flush=True)
    except (OSError, ValueError) as error:
        print(f'Table name index failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
