import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
import re

from hash_reference_client_tree import canonical_json_bytes
from native_catalog.table_layout_pins import CRYPTO_HASH, SCHEMA_HASHES
from native_catalog.table_source_resolver import descriptor_layout_for_file_name, descriptor_layout_links
from native_catalog.tables import DESCRIPTOR_FILE, SCHEMA_ROOT, checked_bytes, decode_table, decoded_table_record_count
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import (add_store_file, merge_catalog_slice, read_store_catalog, sha256_hex, validate_catalog_record,
                                         write_store)
from native_store.gap_rows import read_gap_rows, write_gap_rows
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root, require_converter_output
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, RECEIPT_RECORD_NAME, UnitLedger, locked_input_records,
                                      require_batch_preflight, run_at_below_normal_priority)
import reference_client_guard
from reference_client_guard import require_reference_client

DECODE_TABLE_ALGORITHM_VERSION = 1
LANE_NAME = 'data-ui'
PART_NAME = 'data'
DECODE_STEP = 'decode'
LOCAL_DESCRIPTOR_ROUTE = 'local-descriptor'
NATIVE_TABLE_MANIFEST_KIND = 'native-table'
NATIVE_TABLE_MANIFEST_SCHEMA_VERSION = 1
TABLES_CATALOG_SLICE = 'tables'
TABLES_CATALOG_CAPACITY = 40
DECODE_ERROR_RECORD_NAME = 'decode-error.json'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'
SYSTEM_DAT_PATH_PATTERN = re.compile(r'system/([^/]+)\.dat', re.IGNORECASE)


class ConvertTablesError(ValueError):
    pass


def descriptor_links(schema_root=SCHEMA_ROOT):
    return descriptor_layout_links(checked_bytes(Path(schema_root) / DESCRIPTOR_FILE, SCHEMA_HASHES[DESCRIPTOR_FILE]))


def table_unit_plan(table, links):
    file_name = f'{table}.dat'
    layout = descriptor_layout_for_file_name(file_name, links)
    if layout is None:
        raise ConvertTablesError(f'{file_name} has no Interlude descriptor layout')
    layout_schema = f'dats/{layout}.xml'
    if layout_schema not in SCHEMA_HASHES:
        raise ConvertTablesError(f'layout {layout_schema} of {file_name} has no SHA-256 pin')
    inputs = locked_input_records([f'system/{file_name}'], reference_client_guard.REFERENCE_CLIENT_LOCK_PATH)
    config = {'table': table, 'layout': layout, 'descriptorSha256': SCHEMA_HASHES[DESCRIPTOR_FILE],
              'layoutSha256': SCHEMA_HASHES[layout_schema], 'cryptoSha256': CRYPTO_HASH}
    return file_name, layout, inputs, config


def native_table_manifest(table, decoded_table, route):
    return {'kind': NATIVE_TABLE_MANIFEST_KIND, 'schemaVersion': NATIVE_TABLE_MANIFEST_SCHEMA_VERSION, 'table': table,
            'sourcePath': decoded_table['source'], 'sourceSha256': decoded_table['sourceSha256'],
            'descriptorSha256': decoded_table['schema']['descriptorSha256'], 'route': route,
            'recordCount': decoded_table_record_count(decoded_table), 'records': decoded_table['data']}


def native_table_manifest_bytes(manifest):
    try:
        return canonical_json_bytes(manifest)
    except ValueError as error:
        raise FormatError(f'native table {manifest["table"]} holds a value JSON cannot carry: {error}') from error


def lane_relative_path(ledger, path):
    try:
        return Path(path).relative_to(ledger.lane_folder).as_posix()
    except ValueError as error:
        raise ConvertTablesError(f'{path} is outside the {ledger.lane_name} lane folder {ledger.lane_folder}') from error


def replace_table_gap_row(project_root, unit_key, gap_row):
    decode_rows = [row for row in read_gap_rows(project_root, LANE_NAME) if row['step'] == DECODE_STEP]
    kept_rows = [row for row in decode_rows if row['key'] != unit_key]
    if gap_row is None and len(kept_rows) == len(decode_rows):
        return
    write_gap_rows(project_root, LANE_NAME, DECODE_STEP, kept_rows + ([gap_row] if gap_row else []))


def write_table_to_store(output_root, table, manifest_bytes, manifest):
    manifest_sha256 = sha256_hex(manifest_bytes)
    manifest_relative = f'{TABLES_CATALOG_SLICE}/{manifest_sha256}/{table}.json'
    record = validate_catalog_record(TABLES_CATALOG_SLICE, {
        'id': table, 'manifest': f'/l2/{manifest_relative}', 'manifestSha256': manifest_sha256,
        'manifestBytes': len(manifest_bytes), 'recordCount': manifest['recordCount'], 'sourceSha256': manifest['sourceSha256']})
    catalog, before = read_store_catalog(output_root)
    merged = merge_catalog_slice(catalog, TABLES_CATALOG_SLICE, record, TABLES_CATALOG_CAPACITY)
    merged[TABLES_CATALOG_SLICE] = sorted(merged[TABLES_CATALOG_SLICE], key=lambda existing: existing['id'])
    files = {}
    add_store_file(files, manifest_relative, manifest_bytes)
    write_store(output_root, files, before, canonical_json_bytes(merged))
    return record, Path(output_root) / manifest_relative


def seal_decode_failure(project_root, ledger, unit_key, fingerprint, step_directory, inputs, config, error):
    error_bytes = canonical_json_bytes({'errorClass': type(error).__name__, 'message': str(error)})
    error_path = step_directory / DECODE_ERROR_RECORD_NAME
    error_path.write_bytes(error_bytes)
    gap_row = {'key': unit_key, 'part': PART_NAME, 'step': DECODE_STEP, 'status': 'gap',
               'reason': DECODE_FAILED_REASON_PREFIX + type(error).__name__,
               'sourceIdentity': {'path': inputs[0]['path'], 'sha256': inputs[0]['sha256']},
               'evidence': lane_relative_path(ledger, step_directory / RECEIPT_RECORD_NAME)}
    replace_table_gap_row(project_root, unit_key, gap_row)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': [gap_row], 'outputs': [
        {'path': lane_relative_path(ledger, error_path), 'sha256': sha256_hex(error_bytes), 'bytes': len(error_bytes)}]})
    return {'unit': unit_key, 'status': 'gap', 'reason': gap_row['reason']}


def convert_table_unit(project_root, client_access, table, output_root, ledger, links):
    unit_key = f'table:{table}'
    file_name, layout, inputs, config = table_unit_plan(table, links)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    if ledger.is_sealed(unit_key, fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    step_directory = ledger.begin(unit_key, fingerprint)
    try:
        manifest = native_table_manifest(table, decode_table(client_access.root, layout, source_filename=file_name), LOCAL_DESCRIPTOR_ROUTE)
        manifest_bytes = native_table_manifest_bytes(manifest)
    except (FormatError, UnicodeDecodeError) as error:
        return seal_decode_failure(project_root, ledger, unit_key, fingerprint, step_directory, inputs, config, error)
    record, manifest_path = write_table_to_store(output_root, table, manifest_bytes, manifest)
    replace_table_gap_row(project_root, unit_key, None)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': [], 'outputs': [
        {'path': lane_relative_path(ledger, manifest_path), 'sha256': record['manifestSha256'], 'bytes': record['manifestBytes']}]})
    return {'unit': unit_key, 'status': 'decoded', 'recordCount': record['recordCount'], 'manifest': record['manifest']}


def descriptor_linked_tables(lock, links):
    tables = []
    for path in lock.records_by_path:
        match = SYSTEM_DAT_PATH_PATTERN.fullmatch(path)
        if match and descriptor_layout_for_file_name(f'{match[1]}.dat', links) is not None:
            tables.append(match[1])
    return sorted(tables)


def convert_table_batch(project_root, client_access, output_root, ledger, limit, links):
    results = []
    for table in descriptor_linked_tables(client_access.lock, links):
        if len([result for result in results if result['status'] != 'skipped-sealed']) >= limit:
            break
        results.append(convert_table_unit(project_root, client_access, table, output_root, ledger, links))
        print(json.dumps(results[-1], sort_keys=True), flush=True)
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description='Decode descriptor-linked Interlude .dat tables into the data-ui lane store, one sealed unit per table.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument('--table', action='append')
    selection.add_argument('--batch', choices=(TABLES_CATALOG_SLICE,))
    parser.add_argument('--limit', type=int)
    arguments = parser.parse_args(argv)
    if arguments.batch and not (arguments.limit and arguments.limit > 0):
        parser.error('--batch tables needs --limit with a positive unit count')
    try:
        output_root = require_converter_output(REPOSITORY_ROOT, arguments.output or lane_store_root(REPOSITORY_ROOT, LANE_NAME))
        client_access = require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        ledger = UnitLedger(lane_work_root(REPOSITORY_ROOT, LANE_NAME), DECODE_STEP, DECODE_TABLE_ALGORITHM_VERSION)
        links = descriptor_links()
        if arguments.batch:
            convert_table_batch(REPOSITORY_ROOT, client_access, output_root, ledger, arguments.limit, links)
        for table in dict.fromkeys(arguments.table or ()):
            print(json.dumps(convert_table_unit(REPOSITORY_ROOT, client_access, table, output_root, ledger, links), sort_keys=True),
                  flush=True)
    except (OSError, ValueError) as error:
        print(f'Table conversion failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
