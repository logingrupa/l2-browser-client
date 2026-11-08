import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
from typing import NamedTuple

from build_dat_table_inventory import ELBERA_EVIDENCE_COUNT_SOURCE, ELBERA_EVIDENCE_RECORD_COUNTS
from native_assets_lib.asset_manifest import reference_client_build
from native_catalog.table_source_resolver import descriptor_layout_for_file_name
from native_catalog.tables import (SAFE_PACKAGE_TRAILER, decode413, decode_table, interlude_descriptor_links, interlude_table_layout,
                                   read_value, table_source_path)
from native_catalog.ue2 import FormatError, Reader
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
STRICT_COUNT_REPORT_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'data' / 'sysstring-systemmsg-counts.json'
STRICT_COUNT_REPORT_SCHEMA_VERSION = 1
SYSSTRING_TABLE = 'sysstring-e'
SYSTEMMSG_TABLE = 'systemmsg-e'
STRICT_COUNT_TABLES = (SYSSTRING_TABLE, SYSTEMMSG_TABLE)
COUNT_CONFIRMED_VERDICT = 'count-confirmed'
COUNT_FIXED_VERDICT = 'count-fixed'
COUNT_UNRESOLVED_VERDICT = 'count-unresolved'
DECODED_STATUS = 'decoded'
DECODE_FAILED_STATUS_PREFIX = 'decode-failed:'
IDENTIFIER_READER = 'UINT'
DECODED_FACT_FIELDS = ('decodedRecordCount', 'decodedBytes', 'consumedBytes', 'trailerHex', 'exactEnd', 'minimumId', 'maximumId',
                       'distinctIdCount', 'duplicateIdCount', 'missingIdCountInRange')
TABLE_REPORT_FIELDS = ('table', 'sourcePath', 'sourceSha256', 'layout', 'identifierField', 'declaredCount', 'decodeStatus', 'decodeError',
                       *DECODED_FACT_FIELDS)
REPORT_FIELDS = ('schemaVersion', 'referenceTreeLockSha256', 'tables', 'comparison', 'elberaEvidence', 'verdict')
COMPARISON_FIELDS = ('idSetsEqual', 'sharedIdCount', 'onlyInSysstringCount', 'onlyInSystemmsgCount')


class StrictCountReportError(ValueError):
    pass


class RecordListLayout(NamedTuple):
    declared_count_field: str
    record_list: str
    identifier_field: str


def layout_record_list(layout_name):
    _, layout, schema_name = interlude_table_layout(layout_name)
    record_lists = [node for node in layout if node.tag == 'for']
    if len(record_lists) != 1 or not record_lists[0].get('size', '').startswith('#'):
        raise StrictCountReportError(f'{schema_name} must declare one record list sized by a count field')
    first_field = next(iter(record_lists[0]), None)
    if first_field is None or first_field.tag != 'node' or first_field.get('reader') != IDENTIFIER_READER:
        raise StrictCountReportError(f'{schema_name} record list must start with a {IDENTIFIER_READER} identifier field')
    return RecordListLayout(record_lists[0].get('size')[1:], record_lists[0].get('name'), first_field.get('name'))


def table_layout_name(table):
    layout_name = descriptor_layout_for_file_name(f'{table}.dat', interlude_descriptor_links())
    if layout_name is None:
        raise StrictCountReportError(f'{table}.dat has no Interlude descriptor layout')
    return layout_name


def identifier_set_facts(identifiers):
    distinct_identifiers = set(identifiers)
    if not identifiers:
        return {'minimumId': None, 'maximumId': None, 'distinctIdCount': 0, 'duplicateIdCount': 0, 'missingIdCountInRange': 0}
    minimum_id, maximum_id = min(identifiers), max(identifiers)
    return {'minimumId': minimum_id, 'maximumId': maximum_id, 'distinctIdCount': len(distinct_identifiers),
            'duplicateIdCount': len(identifiers) - len(distinct_identifiers),
            'missingIdCountInRange': maximum_id - minimum_id + 1 - len(distinct_identifiers)}


def strict_table_count_report(client_access, table, identifier_field):
    return strict_table_count_report_and_identifiers(client_access, table, identifier_field)[0]


def strict_table_count_report_and_identifiers(client_access, table, identifier_field):
    layout_name = table_layout_name(table)
    record_list_layout = layout_record_list(layout_name)
    decoded_table = decode_table(client_access.root, layout_name, source_filename=f'{table}.dat')
    records = decoded_table['data'][record_list_layout.record_list]
    if any(identifier_field not in record for record in records):
        raise StrictCountReportError(f'decoded {table} rows have no identifier field {identifier_field}')
    identifiers = [record[identifier_field] for record in records]
    if any(type(identifier) is not int for identifier in identifiers):
        raise StrictCountReportError(f'decoded {table} identifier field {identifier_field} holds a non-integer value')
    exact_end = (decoded_table['consumedBytes'] + len(SAFE_PACKAGE_TRAILER) == decoded_table['decodedBytes']
                 and bytes.fromhex(decoded_table['trailerHex']) == SAFE_PACKAGE_TRAILER)
    if not exact_end:
        raise FormatError(f'decoded {table} does not end exactly at the SafePackage trailer')
    report = {'table': table, 'sourcePath': decoded_table['source'], 'sourceSha256': decoded_table['sourceSha256'], 'layout': layout_name,
              'identifierField': identifier_field, 'declaredCount': decoded_table['data'][record_list_layout.declared_count_field],
              'decodeStatus': DECODED_STATUS, 'decodeError': None, 'decodedRecordCount': len(records),
              'decodedBytes': decoded_table['decodedBytes'], 'consumedBytes': decoded_table['consumedBytes'],
              'trailerHex': decoded_table['trailerHex'], 'exactEnd': exact_end, **identifier_set_facts(identifiers)}
    return report, identifiers


def header_declared_count(client_access, table, layout_name):
    link, layout, schema_name = interlude_table_layout(layout_name)
    count_node = next(iter(layout), None)
    if count_node is None or count_node.tag != 'node' or count_node.get('name') != layout_record_list(layout_name).declared_count_field:
        raise StrictCountReportError(f'{schema_name} does not open with the count field of its record list')
    path = table_source_path(client_access.root, link.pattern, f'{table}.dat')
    raw = path.read_bytes()
    _, decoded = decode413(raw)
    return path.relative_to(client_access.root).as_posix(), hashlib.sha256(raw).hexdigest(), read_value(Reader(decoded), count_node.get('reader'))


def failed_table_count_report(client_access, table, identifier_field, error):
    layout_name = table_layout_name(table)
    source_path, source_sha256, declared_count = header_declared_count(client_access, table, layout_name)
    return {'table': table, 'sourcePath': source_path, 'sourceSha256': source_sha256, 'layout': layout_name,
            'identifierField': identifier_field, 'declaredCount': declared_count,
            'decodeStatus': DECODE_FAILED_STATUS_PREFIX + type(error).__name__, 'decodeError': str(error),
            **dict.fromkeys(DECODED_FACT_FIELDS)}


def identifier_set_comparison(sysstring_identifiers, systemmsg_identifiers):
    if sysstring_identifiers is None or systemmsg_identifiers is None:
        return dict.fromkeys(COMPARISON_FIELDS)
    sysstring_set, systemmsg_set = set(sysstring_identifiers), set(systemmsg_identifiers)
    return {'idSetsEqual': sysstring_set == systemmsg_set, 'sharedIdCount': len(sysstring_set & systemmsg_set),
            'onlyInSysstringCount': len(sysstring_set - systemmsg_set), 'onlyInSystemmsgCount': len(systemmsg_set - sysstring_set)}


def elbera_count_evidence():
    counts = {ELBERA_EVIDENCE_RECORD_COUNTS[table] for table in STRICT_COUNT_TABLES}
    if len(counts) != 1:
        raise StrictCountReportError(f'Elbera evidence gives different counts for {", ".join(STRICT_COUNT_TABLES)}: {sorted(counts)}')
    return {'count': counts.pop(), 'source': ELBERA_EVIDENCE_COUNT_SOURCE}


def count_verdict(table_reports, elbera_evidence):
    if any(report['decodeStatus'] != DECODED_STATUS for report in table_reports):
        return COUNT_UNRESOLVED_VERDICT
    if all(report['decodedRecordCount'] == elbera_evidence['count'] for report in table_reports):
        return COUNT_CONFIRMED_VERDICT
    return COUNT_FIXED_VERDICT


def validate_table_count_report(table_report):
    if set(table_report) != set(TABLE_REPORT_FIELDS) or type(table_report['declaredCount']) is not int:
        raise StrictCountReportError(f'table report {table_report.get("table")} must hold exactly its fields and an integer declared count')
    if table_report['decodeStatus'] == DECODED_STATUS:
        if table_report['exactEnd'] is not True or table_report['decodedRecordCount'] != table_report['declaredCount']:
            raise StrictCountReportError(f'table report {table_report["table"]} must end exactly with its declared count of records')
    elif not (table_report['decodeStatus'].startswith(DECODE_FAILED_STATUS_PREFIX) and table_report['decodeError']
              and all(table_report[field] is None for field in DECODED_FACT_FIELDS)):
        raise StrictCountReportError(f'table report {table_report["table"]} is neither decoded nor a decode failure without decoded facts')


def validate_strict_count_report(report):
    if not (isinstance(report, dict) and set(report) == set(REPORT_FIELDS) and report['schemaVersion'] == STRICT_COUNT_REPORT_SCHEMA_VERSION):
        raise StrictCountReportError(f'strict count report must hold exactly {", ".join(REPORT_FIELDS)} at schemaVersion 1')
    tables = report['tables']
    if not (isinstance(tables, list) and [table.get('table') for table in tables] == list(STRICT_COUNT_TABLES)):
        raise StrictCountReportError(f'strict count report tables must be {", ".join(STRICT_COUNT_TABLES)} in that order')
    for table_report in tables:
        validate_table_count_report(table_report)
    if set(report['comparison']) != set(COMPARISON_FIELDS) or report['elberaEvidence'] != elbera_count_evidence():
        raise StrictCountReportError('strict count report comparison or Elbera evidence block is malformed')
    if report['verdict'] != count_verdict(tables, report['elberaEvidence']):
        raise StrictCountReportError(f'strict count report verdict {report["verdict"]} does not follow from the decoded counts')
    return report


def table_count_report_and_identifiers(client_access, table):
    identifier_field = layout_record_list(table_layout_name(table)).identifier_field
    try:
        return strict_table_count_report_and_identifiers(client_access, table, identifier_field)
    except (FormatError, UnicodeDecodeError) as error:
        return failed_table_count_report(client_access, table, identifier_field, error), None


def build_strict_count_report(client_access):
    reports_and_identifiers = {table: table_count_report_and_identifiers(client_access, table) for table in STRICT_COUNT_TABLES}
    table_reports = [reports_and_identifiers[table][0] for table in STRICT_COUNT_TABLES]
    elbera_evidence = elbera_count_evidence()
    return validate_strict_count_report({
        'schemaVersion': STRICT_COUNT_REPORT_SCHEMA_VERSION,
        'referenceTreeLockSha256': reference_client_build(client_access.lock)['referenceTreeLockSha256'],
        'tables': table_reports,
        'comparison': identifier_set_comparison(reports_and_identifiers[SYSSTRING_TABLE][1], reports_and_identifiers[SYSTEMMSG_TABLE][1]),
        'elberaEvidence': elbera_evidence,
        'verdict': count_verdict(table_reports, elbera_evidence),
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description='Strictly decode sysstring-e and systemmsg-e and write the committed DATA-03 count report.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        report = build_strict_count_report(client_access)
        replace_file(STRICT_COUNT_REPORT_PATH, canonical_json_bytes(report))
    except (OSError, ValueError) as error:
        print(f'Strict count report failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': STRICT_COUNT_REPORT_PATH.relative_to(REPOSITORY_ROOT).as_posix(), 'verdict': report['verdict'],
                      'decodeStatus': {table['table']: table['decodeStatus'] for table in report['tables']}}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
