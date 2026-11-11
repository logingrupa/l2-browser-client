from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from actors.actor_sound_bindings import AUDIO_PART_NAME
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_index_keys import catalog_index_keys, read_measured_catalog
from native_store.catalog_writer import is_table_name_index_id, replace_file
from native_store.coverage_denominators import COVERAGE_PART_ORDER, UNKNOWN_DENOMINATOR, CoverageReportError
from native_store.gap_census import (GAP_CENSUS_LOAD_STATUSES, ITEM_CENSUS_STEP, ITEMS_PART, NAMED_EMITTER_GAP_REASONS, build_gap_census,
                                     is_named_emitter_gap_reason)
from native_store.gap_census_denominators import census_item_join_rows, load_census_denominators, measured_part_names, skill_sound_census_rows
from native_store.gap_census_derived_parts import DERIVED_PARTS, DERIVED_SOURCE_PARTS, derived_converted_keys, derived_part_rows
from native_store.gap_rows import (GAP_ROW_STATUSES, INTEGRATION_LANE_NAME, is_listed_reason, load_gap_reason_patterns, read_gap_rows,
                                   write_gap_rows)
from native_store.load_check_records import is_catalog_key, is_riga_timestamp, read_load_check_records
from native_store.store_paths import (REPOSITORY_ROOT, SHA256_PATTERN, StorePathError, confined_child_path, lane_store_root,
                                      read_lane_parts_by_name, require_converter_output)
from native_store.unit_ledger import MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW, read_machine_schedule, require_host_clock_on_riga_time

COVERAGE_REPORT_SCHEMA_VERSION = 1
COVERAGE_REPORT_FIELDS = frozenset({'schemaVersion', 'catalogSha256', 'storeRoot', 'generatedAtRiga', 'denominators', 'parts', 'rows'})
COVERAGE_ROW_FIELDS = frozenset({'key', 'part', 'status', 'reason', 'converted', 'loads', 'steps'})
COVERAGE_STEP_FIELDS = frozenset({'step', 'status', 'reason'})
COVERAGE_OUTPUT_NAME = 'coverage.json'
COVERAGE_STATUS_BY_CENSUS_STATUS = {'converted': 'pass', 'failed': 'failed', 'gap': 'gap', 'pending': 'pending'}
TABLE_CATALOG_KEY_PREFIX = 'table:'
ACTORS_LANE_NAME = 'actors'
LOBBY_MAP_KEY = 'map:Lobby'
LOADS_RULE_TEXT = 'Loads counts only recorded load checks; everything else is unverified.'
CENSUS_RULE_TEXT = ('Every denominator key has exactly one census status: the failed or gap row of its latest step when it has one, else '
                    'converted when a catalog lists it, else the pending row of its latest step. Converted counts pass rows and gap counts '
                    'rows with status gap or failed, including catalog-listed keys with a failed or gap step, so converted, gap and pending '
                    'add up to the denominator.')
MARKDOWN_TABLE_HEADER = ('| Part | Denominator | Converted | Loads pass | Loads failed | Loads unverified | Gap | Pending | Denominator source |\n'
                         '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')


def store_root_text(project_root, store_root):
    store_root, project_root = Path(store_root).absolute(), Path(project_root).absolute()
    return store_root.relative_to(project_root).as_posix() if store_root.is_relative_to(project_root) else store_root.as_posix()


def merged_load_statuses(project_root, lane_names_by_catalog_sha256):
    load_status_by_key = {}
    for catalog_sha256, lane_names in sorted(lane_names_by_catalog_sha256.items()):
        for lane_name in sorted(lane_names):
            for key, record in read_load_check_records(project_root, lane_name, catalog_sha256).items():
                if load_status_by_key.get(key) != 'failed':
                    load_status_by_key[key] = record['status']
    return load_status_by_key


def derived_source_lane_names(part_names):
    source_parts = {derived_part.source_part for derived_part in DERIVED_PARTS.values() if derived_part.part in part_names}
    return tuple(sorted(lane_name for lane_name, lane_parts in read_lane_parts_by_name().items() if source_parts & set(lane_parts)))


def measured_gap_rows(project_root, lane_names, part_names):
    gap_rows_by_lane_name = {lane_name: read_gap_rows(project_root, lane_name)
                             for lane_name in {*lane_names, *derived_source_lane_names(part_names)}}
    lane_rows = [row for lane_name in lane_names for row in gap_rows_by_lane_name[lane_name] if row['part'] in part_names]
    source_rows = [row for lane_name in derived_source_lane_names(part_names) for row in gap_rows_by_lane_name[lane_name]
                   if row['part'] in DERIVED_SOURCE_PARTS]
    return lane_rows, source_rows + (skill_sound_census_rows() if AUDIO_PART_NAME in part_names else [])


def store_converted_keys(project_root, store_root, catalog):
    shared_store_root = Path(project_root) / 'public' / 'l2'
    return denominator_catalog_keys(catalog_index_keys(store_root, catalog, shared_store_root)) | derived_converted_keys(store_root, catalog,
                                                                                                                          shared_store_root)


def write_item_join_rows(project_root, lane_names, part_names):
    if ITEMS_PART not in part_names:
        return lane_names
    weapon_and_armor_rows = [row for row in read_gap_rows(project_root, ACTORS_LANE_NAME) if row['part'] == ITEMS_PART]
    write_gap_rows(project_root, INTEGRATION_LANE_NAME, ITEM_CENSUS_STEP, census_item_join_rows(project_root, weapon_and_armor_rows))
    return tuple(sorted({*lane_names, INTEGRATION_LANE_NAME}))


def coverage_steps_by_key(gap_rows):
    steps_by_key = {}
    for row in gap_rows:
        steps = steps_by_key.setdefault(row['key'], {})
        if row['step'] in steps:
            raise CoverageReportError(f'gap rows repeat step {row["step"]} of {row["part"]} {row["key"]} across lanes')
        steps[row['step']] = {'step': row['step'], 'status': row['status'], 'reason': row['reason']}
    return {key: [steps[step] for step in sorted(steps)] for key, steps in steps_by_key.items()}


def coverage_row(census_row, steps):
    return {**census_row, 'status': COVERAGE_STATUS_BY_CENSUS_STATUS[census_row['status']], 'steps': steps}


def count_part_rows(rows, denominator_count):
    converted_rows = [row for row in rows if row['converted']]
    return {
        'denominator': denominator_count,
        'converted': sum(1 for row in rows if row['status'] == 'pass'),
        'loads': {load_status: sum(1 for row in converted_rows if row['loads'] == load_status) for load_status in GAP_CENSUS_LOAD_STATUSES},
        'gap': sum(1 for row in rows if row['status'] in ('gap', 'failed')),
        'pending': UNKNOWN_DENOMINATOR if denominator_count == UNKNOWN_DENOMINATOR else sum(1 for row in rows if row['status'] == 'pending'),
    }


def denominator_catalog_keys(catalog_keys):
    return {key for key in catalog_keys if not (key.startswith(TABLE_CATALOG_KEY_PREFIX)
                                                and is_table_name_index_id(key.removeprefix(TABLE_CATALOG_KEY_PREFIX)))}


def build_coverage_report(project_root, store_root, lane_names, generated_at_riga, census_lane_names=()):
    catalog, catalog_sha256 = read_measured_catalog(store_root)
    part_names = measured_part_names(lane_names)
    denominators = load_census_denominators(lane_names)
    converted_keys = store_converted_keys(project_root, store_root, catalog)
    lane_names_by_catalog_sha256 = {catalog_sha256: set(lane_names)}
    for census_lane_name in census_lane_names:
        census_store_root = lane_store_root(project_root, census_lane_name)
        census_catalog, census_catalog_sha256 = read_measured_catalog(census_store_root)
        converted_keys |= store_converted_keys(project_root, census_store_root, census_catalog)
        lane_names_by_catalog_sha256.setdefault(census_catalog_sha256, set()).add(census_lane_name)
    lane_rows, source_rows = measured_gap_rows(project_root, write_item_join_rows(project_root, lane_names, part_names), part_names)
    gap_rows = lane_rows + derived_part_rows(denominators, source_rows, converted_keys)
    census_rows = build_gap_census(denominators, gap_rows, converted_keys, merged_load_statuses(project_root, lane_names_by_catalog_sha256))
    steps_by_key = coverage_steps_by_key(gap_rows)
    rows = [coverage_row(census_row, steps_by_key.get(census_row['key'], [])) for census_row in census_rows]
    return validate_coverage_report({
        'schemaVersion': COVERAGE_REPORT_SCHEMA_VERSION,
        'catalogSha256': catalog_sha256,
        'storeRoot': store_root_text(project_root, store_root),
        'generatedAtRiga': generated_at_riga,
        'denominators': {part: {'count': denominator['count'], 'source': denominator['source']} for part, denominator in denominators.items()},
        'parts': {part: count_part_rows([row for row in rows if row['part'] == part], denominators[part]['count']) for part in part_names},
        'rows': rows,
    })


def validate_coverage_step(step, key):
    if not (isinstance(step, dict) and set(step) == COVERAGE_STEP_FIELDS and step['status'] in GAP_ROW_STATUSES):
        raise CoverageReportError(f'coverage row {key} step must be {{step, status, reason}} with a gap row status: {step!r}')


def validate_coverage_row(row, part_names, reason_patterns):
    if not (isinstance(row, dict) and set(row) == COVERAGE_ROW_FIELDS):
        raise CoverageReportError(f'coverage row must hold exactly {", ".join(sorted(COVERAGE_ROW_FIELDS))}: {row!r}')
    key = row['key']
    if not (is_catalog_key(key) and row['part'] in part_names):
        raise CoverageReportError(f'coverage row needs a catalog key and a measured part: {key!r} {row["part"]!r}')
    if row['status'] not in GAP_ROW_STATUSES or (row['reason'] is None) != (row['status'] == 'pass'):
        raise CoverageReportError(f'coverage row {key} status {row["status"]!r} does not fit its reason {row["reason"]!r}')
    if row['reason'] is not None and not is_listed_reason(row['reason'], reason_patterns):
        raise CoverageReportError(f'coverage row {key} reason is not listed: {row["reason"]!r}')
    if not (type(row['converted']) is bool and (row['converted'] or row['status'] != 'pass') and row['loads'] in GAP_CENSUS_LOAD_STATUSES
            and isinstance(row['steps'], list)):
        raise CoverageReportError(f'coverage row {key} needs converted on a pass status, a load status and a step list')
    for step in row['steps']:
        validate_coverage_step(step, key)
    step_names = [step['step'] for step in row['steps']]
    if step_names != sorted(set(step_names)):
        raise CoverageReportError(f'coverage row {key} steps must be sorted by step with one entry per step')


def validate_coverage_denominators(denominators):
    if not (isinstance(denominators, dict) and list(denominators) == [part for part in COVERAGE_PART_ORDER if part in denominators]):
        raise CoverageReportError(f'coverage denominators must list measured parts in the order {", ".join(COVERAGE_PART_ORDER)}')
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
    part_names = tuple(report['denominators'])
    if not isinstance(report['rows'], list):
        raise CoverageReportError('coverage rows must be a list')
    reason_patterns = load_gap_reason_patterns()
    for row in report['rows']:
        validate_coverage_row(row, part_names, reason_patterns)
    row_order = [(part_names.index(row['part']), row['key']) for row in report['rows']]
    if row_order != sorted(set(row_order)):
        raise CoverageReportError('coverage rows must be sorted by part order, then key, with one row per part and key')
    expected_parts = {part: count_part_rows([row for row in report['rows'] if row['part'] == part], report['denominators'][part]['count'])
                      for part in part_names}
    if report['parts'] != expected_parts:
        raise CoverageReportError('coverage part counts differ from the counts of their rows')
    return report


def coverage_report_bytes(report):
    return canonical_json_bytes(validate_coverage_report(report))


def report_keeping_unchanged_generation_time(previous_output_path, report):
    try:
        previous_report = json.loads(Path(previous_output_path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return report
    if not (isinstance(previous_report, dict) and is_riga_timestamp(previous_report.get('generatedAtRiga'))):
        return report
    previous_generation_time = previous_report['generatedAtRiga']
    unchanged = {**report, 'generatedAtRiga': previous_generation_time} == previous_report
    return {**report, 'generatedAtRiga': previous_generation_time} if unchanged else report


def coverage_markdown_row(part, denominator, counts):
    cells = (part, denominator['count'], counts['converted'], counts['loads']['pass'], counts['loads']['failed'],
             counts['loads']['unverified'], counts['gap'], counts['pending'], denominator['source'])
    return '| ' + ' | '.join(str(cell) for cell in cells) + ' |\n'


def lobby_status_text(report):
    lobby_row = next((row for row in report['rows'] if row['key'] == LOBBY_MAP_KEY), None)
    if lobby_row is None:
        return ''
    status_text = 'converted' if lobby_row['status'] == 'pass' else f'{lobby_row["status"]} `{lobby_row["reason"]}`'
    return f'Lobby (`{LOBBY_MAP_KEY}`) has the census status {status_text}.\n'


def named_emitter_gap_counts_by_part(report):
    counts_by_part = {}
    for row in report['rows']:
        if row['converted'] and row['status'] != 'pass' and is_named_emitter_gap_reason(row['reason']):
            reason_counts = counts_by_part.setdefault(row['part'], {})
            reason_counts[row['reason']] = reason_counts.get(row['reason'], 0) + 1
    return counts_by_part


def named_emitter_gaps_text(report):
    counts_by_part = named_emitter_gap_counts_by_part(report)
    if not counts_by_part:
        return ''
    reason_list = ' or '.join(f'`{reason}`' for reason in NAMED_EMITTER_GAP_REASONS)
    part_lines = ''.join(f'- {part}: ' + ', '.join(f'`{reason}` {count}' for reason, count in sorted(reason_counts.items())) + '\n'
                         for part, reason_counts in counts_by_part.items())
    return f'Converted keys that carry a named emitter gap ({reason_list}), counted per part and reason:\n\n{part_lines}\n'


def census_lanes_text(census_lane_names):
    if not census_lane_names:
        return ''
    lane_list = ', '.join(f'`artifacts/lane-store/{lane_name}/l2`' for lane_name in census_lane_names)
    return f' Converted keys and load checks also come from the census lane stores {lane_list}.'


def coverage_markdown(report, census_lane_names=()):
    validate_coverage_report(report)
    table_rows = ''.join(coverage_markdown_row(part, report['denominators'][part], report['parts'][part]) for part in report['parts'])
    return (f'# Coverage\n\n'
            f'Store root `{report["storeRoot"]}`, catalog SHA-256 `{report["catalogSha256"]}`, generated at {report["generatedAtRiga"]} '
            f'(Riga) by `pnpm report:coverage`.{census_lanes_text(census_lane_names)}\n\n'
            f'{MARKDOWN_TABLE_HEADER}{table_rows}\n'
            f'{CENSUS_RULE_TEXT} {LOADS_RULE_TEXT}\n\n'
            f'{named_emitter_gaps_text(report)}'
            f'{lobby_status_text(report)}')


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


def write_coverage_report(project_root, store_root, lane_names, census_lane_names=(), output=None, run_command=subprocess.run):
    exit_code, schedule, schedule_message = read_machine_schedule(run_command)
    if exit_code == MACHINE_SCHEDULE_EXIT_INSIDE_WINDOW:
        raise CoverageReportError(f'coverage report refused inside a machine window on {schedule["host"]}: {schedule_message}')
    require_host_clock_on_riga_time(schedule['rigaTime'], datetime.now().astimezone())
    output_path = coverage_output_path(project_root, store_root, output)
    report = build_coverage_report(project_root, store_root, lane_names, schedule['rigaTime'], census_lane_names)
    report = report_keeping_unchanged_generation_time(output_path, report)
    replace_file(output_path, coverage_report_bytes(report))
    return output_path, report


def refresh_lane_coverage_report(project_root, lane_name):
    store_root = lane_store_root(project_root, lane_name)
    if coverage_output_path(project_root, store_root, None).is_file():
        write_coverage_report(project_root, store_root, (lane_name,))


def main(argv=None, project_root=REPOSITORY_ROOT, run_command=subprocess.run):
    lane_names = sorted(read_lane_parts_by_name())
    parser = argparse.ArgumentParser(description='Write coverage.json and the coverage table for one native catalog root.')
    parser.add_argument('--store-root', type=Path, required=True)
    parser.add_argument('--lane', choices=lane_names)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--markdown')
    parser.add_argument('--census-lanes', nargs='+', choices=lane_names, default=[])
    arguments = parser.parse_args(argv)
    report_lane_names = sorted({*([arguments.lane] if arguments.lane else []), *arguments.census_lanes}) or lane_names
    try:
        markdown_path = coverage_markdown_path(project_root, arguments.markdown) if arguments.markdown is not None else None
        census_lane_names = sorted(set(arguments.census_lanes))
        output_path, report = write_coverage_report(project_root, arguments.store_root, report_lane_names, census_lane_names,
                                                    arguments.output, run_command)
        if markdown_path is not None:
            replace_file(markdown_path, coverage_markdown(report, census_lane_names).encode('utf-8'))
    except (OSError, ValueError) as error:
        print(f'Coverage report failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': output_path.as_posix(), 'catalogSha256': report['catalogSha256'], 'parts': report['parts']}, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
