import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

from data.hair_table_adapter import ELBERA_HAIR_SELECTION_SCRIPT_PATH, HAIR_TABLE_FIELD_PROOF, HAIR_TABLE_PARSERS
from data.pinned_elbera_module import ELBERA_COMMIT, ELBERA_ROOT
from hash_reference_client_tree import canonical_json_bytes
from native_catalog.table_layout_pins import CLIENT_DERIVED_LAYOUTS
from native_catalog.table_source_resolver import descriptor_layout_for_file_name
from native_catalog.tables import DESCRIPTOR_FILE, SCHEMA_HASHES, SCHEMA_ROOT, interlude_descriptor_links
from native_store.catalog_writer import read_pinned_file, require_file_pin, validate_catalog_record
from native_store.gap_rows import read_gap_rows
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INVENTORY_OUTPUT_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'data' / 'dat-table-inventory.json'
DEFAULT_DECODED_TABLES_CATALOG_PATH = REPOSITORY_ROOT / 'artifacts' / 'lane-store' / 'data-ui' / 'l2' / 'catalog.json'
DECODED_TABLES_LANE_NAME = 'data-ui'
DECODE_STEP = 'decode'
INVENTORY_SCHEMA_VERSION = 1
EXPECTED_DAT_TABLE_COUNT = 40
SYSTEM_DAT_PATH_PATTERN = re.compile(r'system/([^/]+)\.dat', re.IGNORECASE)
UNKNOWN_RECORD_COUNT = 'unknown'
ELBERA_EVIDENCE_COUNT_SOURCE = 'docs/PORT_SCOPE.md section 2 (Elbera extract_gamedata.py)'
ELBERA_EVIDENCE_RECORD_COUNTS = {
    'npcgrp': 6519,
    'npcname-e': 6519,
    'itemname-e': 9238,
    'etcitemgrp': 6911,
    'weapongrp': 1313,
    'armorgrp': 1014,
    'skillgrp': 29812,
    'skillname-e': 29812,
    'sysstring-e': 2083,
    'systemmsg-e': 2083,
    'actionname-e': 102,
}
ELBERA_PARSER_SOURCES = {table: (ELBERA_HAIR_SELECTION_SCRIPT_PATH, function_name) for table, function_name in HAIR_TABLE_PARSERS.items()}
ELBERA_PARSER_PRESENT_STATUS = 'Elbera parser present, unverified'
LAYOUT_NOT_DECODED_STATUS = 'layout pinned, not decoded'
ROUTES = ('local-decoded', 'local-layout-only', 'elbera', 'none')
ROW_FIELDS = ('table', 'file', 'descriptorLayout', 'layout', 'route', 'recordCount', 'countSource', 'status')
NOT_LOCK_EQUAL_STATUS = 'E: copy not equal to IMPORTA-PC'
DECODED_TABLE_COUNT_SOURCE = 'scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/'
ELBERA_ADAPTER_COUNT_SOURCE = (f'scripts/data/hair_table_adapter.py (Elbera {Path(ELBERA_HAIR_SELECTION_SCRIPT_PATH).name} at {ELBERA_COMMIT})'
                               ' on lock-equal E:/Lineage2-client/')
ELBERA_ADAPTER_DECODED_STATUS = f'decoded by Elbera adapter, {HAIR_TABLE_FIELD_PROOF}'


class DatTableInventoryError(ValueError):
    pass


def classify_dat_table(file_name, links, elbera_parser_statuses):
    layout = descriptor_layout_for_file_name(file_name, links)
    table = file_name.removesuffix('.dat')
    if layout is not None:
        route = 'local-layout-only'
    elif elbera_parser_statuses.get(table):
        route = 'elbera'
    else:
        route = 'none'
    return {'table': table, 'file': file_name, 'descriptorLayout': layout is not None, 'layout': layout, 'route': route}


def elbera_parser_presence(elbera_root):
    statuses = {}
    for table, (relative_source, function_name) in ELBERA_PARSER_SOURCES.items():
        source_path = Path(elbera_root) / relative_source
        defines_parser = source_path.is_file() and f'def {function_name}(' in source_path.read_text(encoding='utf-8')
        statuses[table] = ELBERA_PARSER_PRESENT_STATUS if defines_parser else None
    return statuses


def reference_side_dat_file_names(lock):
    file_names = []
    for path, record in lock.records_by_path.items():
        if SYSTEM_DAT_PATH_PATTERN.fullmatch(path) and record['importaSha256'] is not None:
            file_names.append(path.split('/', 1)[1])
    if len(file_names) != EXPECTED_DAT_TABLE_COUNT:
        raise DatTableInventoryError(f'reference client lock lists {len(file_names)} system .dat files, expected {EXPECTED_DAT_TABLE_COUNT}')
    return file_names


def describe_decode_against_elbera(table, record_count):
    elbera_count = ELBERA_EVIDENCE_RECORD_COUNTS.get(table)
    if elbera_count is None:
        return 'decoded'
    if elbera_count == record_count:
        return 'decoded, matches Elbera evidence'
    return f'decoded, Elbera evidence differs ({elbera_count})'


def read_decoded_table_records(catalog_path):
    if not Path(catalog_path).is_file():
        return []
    catalog = json.loads(Path(catalog_path).read_bytes().decode('utf-8'))
    return [validate_catalog_record('tables', record) for record in catalog.get('tables', [])]


def undecoded_count(table, status):
    elbera_count = ELBERA_EVIDENCE_RECORD_COUNTS.get(table)
    if elbera_count is None:
        return {'recordCount': UNKNOWN_RECORD_COUNT, 'countSource': None, 'status': status}
    return {'recordCount': elbera_count, 'countSource': ELBERA_EVIDENCE_COUNT_SOURCE, 'status': status}


def lock_equal_source_sha256(client_access, file_name):
    relative_path = f'system/{file_name}'
    lock_record = client_access.lock.record(relative_path)
    if lock_record is None or lock_record['class'] != 'equal':
        return None
    client_access.require_equal_file(relative_path)
    return lock_record['eSha256']


def count_descriptor_linked_table(row, source_sha256, decoded_records_by_table, decode_gap_rows_by_key):
    if source_sha256 is None:
        return {'route': 'local-layout-only', 'recordCount': UNKNOWN_RECORD_COUNT, 'countSource': None, 'status': NOT_LOCK_EQUAL_STATUS}
    decoded_record = decoded_records_by_table.get(row['table'])
    if decoded_record is not None and decoded_record['sourceSha256'] == source_sha256:
        return {'route': 'local-decoded', 'recordCount': decoded_record['recordCount'],
                'countSource': f'{DECODED_TABLE_COUNT_SOURCE}system/{row["file"]}',
                'status': describe_decode_against_elbera(row['table'], decoded_record['recordCount'])}
    gap_row = decode_gap_rows_by_key.get(f'table:{row["table"]}')
    if gap_row is not None and gap_row['sourceIdentity']['sha256'] == source_sha256:
        return {'route': 'local-layout-only', **undecoded_count(row['table'], gap_row['reason'])}
    return {'route': 'local-layout-only', **undecoded_count(row['table'], LAYOUT_NOT_DECODED_STATUS)}


def in_use_slot_status(decoded_tables_store_root, decoded_record, in_use_slots):
    manifest_reference = require_file_pin(decoded_record, 'manifest', 'manifestSha256', 'manifestBytes', f'tables record {decoded_record["id"]}')
    slots = json.loads(read_pinned_file(decoded_tables_store_root, manifest_reference))['records'][in_use_slots['records']]
    in_use_count = sum(1 for slot in slots if slot[in_use_slots['inUseField']] != 0)
    return f'decoded, {len(slots)} slots, {in_use_count} in use'


def count_elbera_route_table(row, elbera_parser_statuses, source_sha256, decoded_records_by_table, decode_gap_rows_by_key):
    decoded_record = decoded_records_by_table.get(row['table'])
    if source_sha256 is not None and decoded_record is not None and decoded_record['sourceSha256'] == source_sha256:
        return {'recordCount': decoded_record['recordCount'], 'countSource': f'{ELBERA_ADAPTER_COUNT_SOURCE}system/{row["file"]}',
                'status': ELBERA_ADAPTER_DECODED_STATUS}
    gap_row = decode_gap_rows_by_key.get(f'table:{row["table"]}')
    if source_sha256 is not None and gap_row is not None and gap_row['sourceIdentity']['sha256'] == source_sha256:
        return undecoded_count(row['table'], gap_row['reason'])
    return undecoded_count(row['table'], elbera_parser_statuses[row['table']])


def validate_dat_table_inventory(inventory):
    rows = inventory['rows']
    if len(rows) != EXPECTED_DAT_TABLE_COUNT:
        raise DatTableInventoryError(f'inventory has {len(rows)} rows, expected {EXPECTED_DAT_TABLE_COUNT}')
    tables = [row['table'] for row in rows]
    if tables != sorted(tables) or len(set(tables)) != len(tables):
        raise DatTableInventoryError('inventory rows must be unique and sorted by table')
    for row in rows:
        if tuple(sorted(row)) != tuple(sorted(ROW_FIELDS)) or row['route'] not in ROUTES:
            raise DatTableInventoryError(f'inventory row {row.get("table")} has unexpected fields or route')
        count = row['recordCount']
        minimum_count = 0 if row['route'] == 'local-decoded' else 1
        if count == UNKNOWN_RECORD_COUNT:
            if row['countSource'] is not None:
                raise DatTableInventoryError(f'unknown count of {row["table"]} names a source')
        elif not isinstance(count, int) or isinstance(count, bool) or count < minimum_count or not row['countSource']:
            raise DatTableInventoryError(
                f'record count of {row["table"]} is not a sourced integer of at least {minimum_count} on route {row["route"]}')
    return inventory


def build_dat_table_inventory(client_access, elbera_root, decoded_tables_catalog_path, gap_rows, schema_root=SCHEMA_ROOT):
    links = interlude_descriptor_links(schema_root)
    elbera_parser_statuses = elbera_parser_presence(elbera_root)
    decoded_records_by_table = {record['id']: record for record in read_decoded_table_records(decoded_tables_catalog_path)}
    decode_gap_rows_by_key = {row['key']: row for row in gap_rows if row['step'] == DECODE_STEP}
    rows = []
    for file_name in reference_side_dat_file_names(client_access.lock):
        row = classify_dat_table(file_name, links, elbera_parser_statuses)
        if row['layout'] is not None:
            source_sha256 = lock_equal_source_sha256(client_access, file_name)
            row.update(count_descriptor_linked_table(row, source_sha256, decoded_records_by_table, decode_gap_rows_by_key))
            in_use_slots = CLIENT_DERIVED_LAYOUTS.get(row['layout'], {}).get('inUseSlots')
            if row['route'] == 'local-decoded' and in_use_slots is not None:
                row['status'] = in_use_slot_status(Path(decoded_tables_catalog_path).parent, decoded_records_by_table[row['table']],
                                                   in_use_slots)
        elif row['route'] == 'elbera':
            source_sha256 = lock_equal_source_sha256(client_access, file_name)
            row.update(count_elbera_route_table(row, elbera_parser_statuses, source_sha256, decoded_records_by_table, decode_gap_rows_by_key))
        else:
            row.update(undecoded_count(row['table'], 'no descriptor layout and no Elbera parser'))
        rows.append(row)
    return validate_dat_table_inventory({
        'schemaVersion': INVENTORY_SCHEMA_VERSION,
        'descriptorSha256': SCHEMA_HASHES[DESCRIPTOR_FILE],
        'referenceTreeLockSha256': hashlib.sha256(canonical_json_bytes(client_access.lock.document)).hexdigest(),
        'rows': sorted(rows, key=lambda row: row['table']),
    })


def dat_table_inventory_bytes(inventory):
    return (json.dumps(inventory, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Write the 40-table .dat inventory from the locked reference client tree and sealed table decodes.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=DEFAULT_INVENTORY_OUTPUT_PATH)
    parser.add_argument('--elbera-root', type=Path, default=ELBERA_ROOT)
    parser.add_argument('--decoded-tables-catalog', type=Path, default=DEFAULT_DECODED_TABLES_CATALOG_PATH)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        inventory = build_dat_table_inventory(client_access, arguments.elbera_root, arguments.decoded_tables_catalog,
                                              read_gap_rows(REPOSITORY_ROOT, DECODED_TABLES_LANE_NAME))
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_bytes(dat_table_inventory_bytes(inventory))
    except (OSError, ValueError) as error:
        print(f'Dat table inventory failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': str(arguments.output), 'rows': len(inventory['rows'])}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
