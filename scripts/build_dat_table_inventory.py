import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ElementTree

from hash_reference_client_tree import canonical_json_bytes
from native_catalog.tables import SCHEMA_HASHES, SCHEMA_ROOT, TABLES, checked_bytes, decode_table
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, ReferenceClientLockError, require_reference_client

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INVENTORY_OUTPUT_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'data' / 'dat-table-inventory.json'
DEFAULT_ELBERA_ROOT = Path('E:/Lineage2Elbera')
INVENTORY_SCHEMA_VERSION = 1
EXPECTED_DAT_TABLE_COUNT = 40
DESCRIPTOR_NAME = 'CT0 Interlude'
DESCRIPTOR_FILE = '06_interlude.xml'
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
ELBERA_PARSER_SOURCES = {
    'hairgrp': ('tools/dat/extract_charcreate.py', 'parse_hairgrp'),
    'helmetgrp': ('tools/ui/check_hair_selection_native.py', 'keyed_hair_pairs'),
    'hairaccessarygrp': ('tools/ui/check_hair_selection_native.py', 'keyed_hair_pairs'),
}
ELBERA_PARSER_PRESENT_STATUS = 'Elbera parser present, unverified'
ROUTES = ('local-decoded', 'local-layout-only', 'elbera', 'none')
ROW_FIELDS = ('table', 'file', 'descriptorLayout', 'layout', 'route', 'recordCount', 'countSource', 'status')
LOCAL_DECODE_COUNT_SOURCE = 'scripts/native_catalog/tables.py decode_table on lock-equal E:/Lineage2-client/'


class DatTableInventoryError(ValueError):
    pass


def descriptor_layout_links(descriptor_bytes):
    descriptor = ElementTree.fromstring(descriptor_bytes)
    if descriptor.get('name') != DESCRIPTOR_NAME:
        raise DatTableInventoryError(f'descriptor is not {DESCRIPTOR_NAME}: {descriptor.get("name")!r}')
    links = [(link.get('pattern'), link.get('file')) for link in descriptor.iter('link')]
    if any(not pattern or not layout for pattern, layout in links):
        raise DatTableInventoryError('descriptor link without pattern or file')
    return links


def classify_dat_table(file_name, links, elbera_parser_statuses):
    matched_layouts = [layout for pattern, layout in links if re.fullmatch(pattern, file_name, re.IGNORECASE)]
    if len(matched_layouts) > 1:
        raise DatTableInventoryError(f'descriptor matches more than one layout for {file_name}: {matched_layouts}')
    layout = matched_layouts[0] if matched_layouts else None
    table = file_name.removesuffix('.dat')
    if layout in TABLES:
        route = 'local-decoded'
    elif layout is not None:
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
    for path, values in lock['files'].items():
        match = SYSTEM_DAT_PATH_PATTERN.fullmatch(path)
        if match and values[2] is not None:
            file_names.append(path.split('/', 1)[1])
    if len(file_names) != EXPECTED_DAT_TABLE_COUNT:
        raise DatTableInventoryError(f'reference client lock lists {len(file_names)} system .dat files, expected {EXPECTED_DAT_TABLE_COUNT}')
    return file_names


def decoded_record_count(decoded_table):
    record_lists = [value for value in decoded_table['data'].values() if isinstance(value, list)]
    if len(record_lists) != 1:
        raise DatTableInventoryError(f'decoded {decoded_table["source"]} has {len(record_lists)} top-level record lists, expected 1')
    return len(record_lists[0])


def describe_decode_against_elbera(table, record_count):
    elbera_count = ELBERA_EVIDENCE_RECORD_COUNTS.get(table)
    if elbera_count is None:
        return 'decoded'
    if elbera_count == record_count:
        return 'decoded, matches Elbera evidence'
    return f'decoded, Elbera evidence differs ({elbera_count})'


def count_local_decoded_table(client_access, row, schema_root):
    source_filename = row['file'] if row['layout'] == 'npcname' else None
    try:
        decoded_table = decode_table(client_access.root, row['layout'], schema_root, source_filename=source_filename)
    except ReferenceClientLockError:
        return {'recordCount': UNKNOWN_RECORD_COUNT, 'countSource': None, 'status': 'E: copy not equal to IMPORTA-PC'}
    record_count = decoded_record_count(decoded_table)
    return {'recordCount': record_count, 'countSource': LOCAL_DECODE_COUNT_SOURCE + 'system/' + row['file'],
        'status': describe_decode_against_elbera(row['table'], record_count)}


def count_undecoded_table(row, elbera_parser_statuses):
    if row['route'] == 'elbera':
        status = elbera_parser_statuses[row['table']]
    elif row['route'] == 'local-layout-only':
        status = 'layout pinned, not decoded'
    else:
        status = 'no descriptor layout and no Elbera parser'
    elbera_count = ELBERA_EVIDENCE_RECORD_COUNTS.get(row['table'])
    if elbera_count is None:
        return {'recordCount': UNKNOWN_RECORD_COUNT, 'countSource': None, 'status': status}
    return {'recordCount': elbera_count, 'countSource': ELBERA_EVIDENCE_COUNT_SOURCE, 'status': status}


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
        if count == UNKNOWN_RECORD_COUNT:
            if row['countSource'] is not None:
                raise DatTableInventoryError(f'unknown count of {row["table"]} names a source')
        elif not isinstance(count, int) or isinstance(count, bool) or count < 1 or not row['countSource']:
            raise DatTableInventoryError(f'record count of {row["table"]} is not a sourced positive integer')
    return inventory


def build_dat_table_inventory(client_access, lock, elbera_root, schema_root=SCHEMA_ROOT):
    descriptor_bytes = checked_bytes(Path(schema_root) / DESCRIPTOR_FILE, SCHEMA_HASHES[DESCRIPTOR_FILE])
    links = descriptor_layout_links(descriptor_bytes)
    elbera_parser_statuses = elbera_parser_presence(elbera_root)
    rows = []
    for file_name in reference_side_dat_file_names(lock):
        row = classify_dat_table(file_name, links, elbera_parser_statuses)
        if row['route'] == 'local-decoded':
            row.update(count_local_decoded_table(client_access, row, schema_root))
        else:
            row.update(count_undecoded_table(row, elbera_parser_statuses))
        rows.append(row)
    return validate_dat_table_inventory({
        'schemaVersion': INVENTORY_SCHEMA_VERSION,
        'descriptorSha256': SCHEMA_HASHES[DESCRIPTOR_FILE],
        'referenceTreeLockSha256': hashlib.sha256(canonical_json_bytes(lock)).hexdigest(),
        'rows': sorted(rows, key=lambda row: row['table']),
    })


def dat_table_inventory_bytes(inventory):
    return (json.dumps(inventory, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Write the 40-table .dat inventory from the locked reference client tree.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=DEFAULT_INVENTORY_OUTPUT_PATH)
    parser.add_argument('--elbera-root', type=Path, default=DEFAULT_ELBERA_ROOT)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        lock = json.loads(REFERENCE_CLIENT_LOCK_PATH.read_bytes().decode('utf-8'))
        inventory = build_dat_table_inventory(client_access, lock, arguments.elbera_root)
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_bytes(dat_table_inventory_bytes(inventory))
    except (OSError, ValueError) as error:
        print(f'Dat table inventory failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': str(arguments.output), 'rows': len(inventory['rows'])}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
