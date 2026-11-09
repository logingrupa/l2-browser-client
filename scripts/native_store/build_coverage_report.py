from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_index_keys import catalog_index_keys
from native_store.catalog_writer import (MAXIMUM_CATALOG_BYTES, STORE_CATALOG_NAME, CatalogWriteError, decode_store_catalog,
                                         is_table_name_index_id, replace_file, sha256_hex)
from native_store.coverage_denominators import COVERAGE_PART_ORDER, UNKNOWN_DENOMINATOR, CoverageReportError, coverage_denominators
from native_store.gap_rows import GAP_ROW_STATUSES, is_listed_reason, load_gap_reason_patterns, read_gap_rows
from native_store.load_check_records import is_catalog_key, is_riga_timestamp, read_load_check_records
from native_store.store_paths import (REPOSITORY_ROOT, SHA256_PATTERN, StorePathError, confined_child_path, read_lane_parts_by_name,
                                      require_converter_output)
from native_store.unit_ledger import MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW, read_machine_schedule, require_host_clock_on_riga_time

COVERAGE_REPORT_SCHEMA_VERSION = 1
COVERAGE_REPORT_FIELDS = frozenset({'schemaVersion', 'catalogSha256', 'storeRoot', 'generatedAtRiga', 'denominators', 'parts', 'rows'})
COVERAGE_ROW_FIELDS = frozenset({'key', 'part', 'status', 'reason', 'converted', 'loads', 'steps'})
COVERAGE_STEP_FIELDS = frozenset({'step', 'status', 'reason'})
COVERAGE_OUTPUT_NAME = 'coverage.json'
STEP_STATUS_SEVERITY_ORDER = ('failed', 'gap', 'pending', 'pass')
LOAD_STATUSES = ('pass', 'failed', 'unverified')
TABLE_CATALOG_KEY_PREFIX = 'table:'
UNVERIFIED_LOAD_STATUS = 'unverified'
CENSUS_PENDING_REASON = 'census-pending'
CATALOG_KEY_KIND_PARTS = {'table': 'data', 'tile': 'world', 'map': 'world', 'character': 'player-characters', 'window': 'ui',
                          'npc': 'npcs', 'item': 'items', 'skill': 'skills-effects'}
LOADS_RULE_TEXT = 'Loads counts only recorded load checks; everything else is unverified.'
MARKDOWN_TABLE_HEADER = ('| Part | Denominator | Converted | Loads pass | Loads failed | Loads unverified | Gap | Pending | Denominator source |\n'
                         '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')


def catalog_key_part(key):
    return CATALOG_KEY_KIND_PARTS[key.split(':', 1)[0]]


def store_root_text(project_root, store_root):
    store_root, project_root = Path(store_root).absolute(), Path(project_root).absolute()
    return store_root.relative_to(project_root).as_posix() if store_root.is_relative_to(project_root) else store_root.as_posix()


def read_measured_catalog(store_root):
    catalog_path = Path(store_root) / STORE_CATALOG_NAME
    if not catalog_path.is_file():
        raise CoverageReportError(f'measured store has no catalog: {catalog_path}')
    with open(catalog_path, 'rb') as stream:
        payload = stream.read(MAXIMUM_CATALOG_BYTES + 1)
    if len(payload) > MAXIMUM_CATALOG_BYTES:
        raise CoverageReportError(f'measured catalog exceeds {MAXIMUM_CATALOG_BYTES} bytes: {catalog_path}')
    try:
        return decode_store_catalog(payload), sha256_hex(payload)
    except (CatalogWriteError, ValueError) as error:
        raise CoverageReportError(f'measured catalog is not a native catalog: {catalog_path}: {error}') from error


def merged_load_statuses(project_root, lane_names, catalog_sha256):
    load_status_by_key = {}
    for lane_name in lane_names:
        for key, record in read_load_check_records(project_root, lane_name, catalog_sha256).items():
            if load_status_by_key.get(key) != 'failed':
                load_status_by_key[key] = record['status']
    return load_status_by_key


def gap_steps_by_part_and_key(project_root, lane_names):
    steps_by_part_and_key = {}
    for lane_name in lane_names:
        for row in read_gap_rows(project_root, lane_name):
            steps = steps_by_part_and_key.setdefault((row['part'], row['key']), {})
            if row['step'] in steps:
                raise CoverageReportError(f'gap rows repeat step {row["step"]} of {row["part"]} {row["key"]} across lanes')
            steps[row['step']] = {'step': row['step'], 'status': row['status'], 'reason': row['reason']}
    return {part_and_key: [steps[step] for step in sorted(steps)] for part_and_key, steps in steps_by_part_and_key.items()}


def coverage_row(part, key, converted, steps, load_status):
    if steps:
        most_severe_step = min(steps, key=lambda step: STEP_STATUS_SEVERITY_ORDER.index(step['status']))
        status, reason = most_severe_step['status'], most_severe_step['reason']
    elif converted:
        status, reason = 'pass', None
    else:
        status, reason = 'gap', CENSUS_PENDING_REASON
    return {'key': key, 'part': part, 'status': status, 'reason': reason, 'converted': converted, 'loads': load_status, 'steps': steps}


def listed_part_keys(part, denominator, converted_keys, steps_by_part_and_key):
    keys = ({key for key in converted_keys if catalog_key_part(key) == part}
            | {key for row_part, key in steps_by_part_and_key if row_part == part})
    if denominator['keys'] is not None:
        outside_keys = sorted(keys - set(denominator['keys']))
        if outside_keys:
            raise CoverageReportError(f'part {part} has keys outside its denominator ({denominator["source"]}): {", ".join(outside_keys)}')
        return sorted(denominator['keys'])
    if denominator['count'] != UNKNOWN_DENOMINATOR and len(keys) > denominator['count']:
        raise CoverageReportError(f'part {part} lists {len(keys)} keys, more than its denominator {denominator["count"]}')
    return sorted(keys)


def count_part_rows(rows, denominator_count):
    converted_rows = [row for row in rows if row['converted']]
    listed_pending = sum(1 for row in rows if row['status'] == 'pending')
    return {
        'denominator': denominator_count,
        'converted': len(converted_rows),
        'loads': {load_status: sum(1 for row in converted_rows if row['loads'] == load_status) for load_status in LOAD_STATUSES},
        'gap': sum(1 for row in rows if row['status'] in ('gap', 'failed')),
        'pending': UNKNOWN_DENOMINATOR if denominator_count == UNKNOWN_DENOMINATOR else listed_pending + denominator_count - len(rows),
    }


def denominator_catalog_keys(catalog_keys):
    return {key for key in catalog_keys if not (key.startswith(TABLE_CATALOG_KEY_PREFIX)
                                                and is_table_name_index_id(key.removeprefix(TABLE_CATALOG_KEY_PREFIX)))}


def build_coverage_report(project_root, store_root, lane_names, generated_at_riga):
    catalog, catalog_sha256 = read_measured_catalog(store_root)
    denominators = coverage_denominators()
    converted_keys = denominator_catalog_keys(catalog_index_keys(store_root, catalog, Path(project_root) / 'public' / 'l2'))
    steps_by_part_and_key = gap_steps_by_part_and_key(project_root, lane_names)
    load_status_by_key = merged_load_statuses(project_root, lane_names, catalog_sha256)
    rows, parts = [], {}
    for part in COVERAGE_PART_ORDER:
        part_rows = [coverage_row(part, key, catalog_key_part(key) == part and key in converted_keys,
                                  steps_by_part_and_key.get((part, key), []), load_status_by_key.get(key, UNVERIFIED_LOAD_STATUS))
                     for key in listed_part_keys(part, denominators[part], converted_keys, steps_by_part_and_key)]
        rows.extend(part_rows)
        parts[part] = count_part_rows(part_rows, denominators[part]['count'])
    return validate_coverage_report({
        'schemaVersion': COVERAGE_REPORT_SCHEMA_VERSION,
        'catalogSha256': catalog_sha256,
        'storeRoot': store_root_text(project_root, store_root),
        'generatedAtRiga': generated_at_riga,
        'denominators': {part: {'count': denominators[part]['count'], 'source': denominators[part]['source']} for part in COVERAGE_PART_ORDER},
        'parts': parts,
        'rows': rows,
    })


def validate_coverage_step(step, key):
    if not (isinstance(step, dict) and set(step) == COVERAGE_STEP_FIELDS and step['status'] in GAP_ROW_STATUSES):
        raise CoverageReportError(f'coverage row {key} step must be {{step, status, reason}} with a gap row status: {step!r}')


def validate_coverage_row(row, reason_patterns):
    if not (isinstance(row, dict) and set(row) == COVERAGE_ROW_FIELDS):
        raise CoverageReportError(f'coverage row must hold exactly {", ".join(sorted(COVERAGE_ROW_FIELDS))}: {row!r}')
    key = row['key']
    if not (is_catalog_key(key) and row['part'] in COVERAGE_PART_ORDER):
        raise CoverageReportError(f'coverage row needs a catalog key and a Stage A part: {key!r} {row["part"]!r}')
    if row['status'] not in GAP_ROW_STATUSES or (row['reason'] is None) != (row['status'] == 'pass'):
        raise CoverageReportError(f'coverage row {key} status {row["status"]!r} does not fit its reason {row["reason"]!r}')
    if row['reason'] is not None and not is_listed_reason(row['reason'], reason_patterns):
        raise CoverageReportError(f'coverage row {key} reason is not listed: {row["reason"]!r}')
    if not (type(row['converted']) is bool and row['loads'] in LOAD_STATUSES and isinstance(row['steps'], list)):
        raise CoverageReportError(f'coverage row {key} needs a boolean converted, a load status and a step list')
    for step in row['steps']:
        validate_coverage_step(step, key)
    step_names = [step['step'] for step in row['steps']]
    if step_names != sorted(set(step_names)):
        raise CoverageReportError(f'coverage row {key} steps must be sorted by step with one entry per step')


def validate_coverage_denominators(denominators):
    if not (isinstance(denominators, dict) and set(denominators) == set(COVERAGE_PART_ORDER)):
        raise CoverageReportError(f'coverage denominators must list exactly the parts {", ".join(COVERAGE_PART_ORDER)}')
    for part, denominator in denominators.items():
        if not (isinstance(denominator, dict) and set(denominator) == {'count', 'source'}):
            raise CoverageReportError(f'coverage denominator of {part} must be {{count, source}}: {denominator!r}')
        count, source = denominator['count'], denominator['source']
        if not ((count == UNKNOWN_DENOMINATOR or (type(count) is int and count >= 0)) and isinstance(source, str) and source):
            raise CoverageReportError(f'coverage denominator of {part} needs a count or unknown and a source: {denominator!r}')


def validate_coverage_report(report):
    if not (isinstance(report, dict) and set(report) == COVERAGE_REPORT_FIELDS
            and report['schemaVersion'] == COVERAGE_REPORT_SCHEMA_VERSION):
        raise CoverageReportError(f'coverage report must be schemaVersion {COVERAGE_REPORT_SCHEMA_VERSION} with exactly '
                                  f'{", ".join(sorted(COVERAGE_REPORT_FIELDS))}')
    if not (isinstance(report['catalogSha256'], str) and SHA256_PATTERN.fullmatch(report['catalogSha256'])):
        raise CoverageReportError(f'coverage catalogSha256 must be 64 lowercase hex characters: {report["catalogSha256"]!r}')
    if not (isinstance(report['storeRoot'], str) and report['storeRoot'] and is_riga_timestamp(report['generatedAtRiga'])):
        raise CoverageReportError('coverage report needs a storeRoot and a generatedAtRiga in ISO 8601 with the Riga offset')
    validate_coverage_denominators(report['denominators'])
    if not isinstance(report['rows'], list):
        raise CoverageReportError('coverage rows must be a list')
    reason_patterns = load_gap_reason_patterns()
    for row in report['rows']:
        validate_coverage_row(row, reason_patterns)
    row_order = [(COVERAGE_PART_ORDER.index(row['part']), row['key']) for row in report['rows']]
    if row_order != sorted(set(row_order)):
        raise CoverageReportError('coverage rows must be sorted by part order, then key, with one row per part and key')
    expected_parts = {part: count_part_rows([row for row in report['rows'] if row['part'] == part], report['denominators'][part]['count'])
                      for part in COVERAGE_PART_ORDER}
    if report['parts'] != expected_parts:
        raise CoverageReportError('coverage part counts differ from the counts of their rows')
    return report


def coverage_report_bytes(report):
    return canonical_json_bytes(validate_coverage_report(report))


def coverage_markdown_row(part, denominator, counts):
    cells = (part, denominator['count'], counts['converted'], counts['loads']['pass'], counts['loads']['failed'],
             counts['loads']['unverified'], counts['gap'], counts['pending'], denominator['source'])
    return '| ' + ' | '.join(str(cell) for cell in cells) + ' |\n'


def coverage_markdown(report):
    validate_coverage_report(report)
    table_rows = ''.join(coverage_markdown_row(part, report['denominators'][part], report['parts'][part]) for part in COVERAGE_PART_ORDER)
    return (f'# Coverage\n\n'
            f'Store root `{report["storeRoot"]}`, catalog SHA-256 `{report["catalogSha256"]}`, generated at {report["generatedAtRiga"]} '
            f'(Riga) by `pnpm report:coverage`.\n\n'
            f'{MARKDOWN_TABLE_HEADER}{table_rows}\n'
            f'{LOADS_RULE_TEXT} Gap counts rows with status gap or failed. Pending counts pending rows plus the keys of a counted '
            f'denominator that no row lists yet.\n')


def coverage_output_path(project_root, store_root, output):
    output_path = Path(output if output is not None else Path(store_root) / COVERAGE_OUTPUT_NAME).absolute()
    try:
        return require_converter_output(project_root, output_path.parent) / output_path.name
    except StorePathError as error:
        raise CoverageReportError(f'coverage output refused: {error}') from error


def coverage_markdown_path(project_root, markdown):
    try:
        markdown_path = confined_child_path(project_root, markdown)
    except StorePathError as error:
        raise CoverageReportError(f'coverage markdown path refused: {error}') from error
    if markdown_path.is_relative_to(Path(project_root).resolve() / 'public' / 'l2'):
        raise CoverageReportError(f'coverage markdown must not be written into the shared native store: {markdown}')
    return markdown_path


def main(argv=None, project_root=REPOSITORY_ROOT, run_command=subprocess.run):
    lane_names = sorted(read_lane_parts_by_name())
    parser = argparse.ArgumentParser(description='Write coverage.json and the coverage table for one native catalog root.')
    parser.add_argument('--store-root', type=Path, required=True)
    parser.add_argument('--lane', choices=lane_names)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--markdown')
    arguments = parser.parse_args(argv)
    try:
        exit_code, schedule, schedule_message = read_machine_schedule(run_command)
        if exit_code == MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW:
            raise CoverageReportError(f'coverage report refused inside a machine window on {schedule["host"]}: {schedule_message}')
        require_host_clock_on_riga_time(schedule['rigaTime'], datetime.now().astimezone())
        output_path = coverage_output_path(project_root, arguments.store_root, arguments.output)
        markdown_path = coverage_markdown_path(project_root, arguments.markdown) if arguments.markdown is not None else None
        report = build_coverage_report(project_root, arguments.store_root, [arguments.lane] if arguments.lane else lane_names,
                                       schedule['rigaTime'])
        replace_file(output_path, coverage_report_bytes(report))
        if markdown_path is not None:
            replace_file(markdown_path, coverage_markdown(report).encode('utf-8'))
    except (OSError, ValueError) as error:
        print(f'Coverage report failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': output_path.as_posix(), 'catalogSha256': report['catalogSha256'], 'parts': report['parts']}, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
