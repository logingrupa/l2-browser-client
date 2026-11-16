import argparse
import hashlib
import json
from pathlib import Path, PureWindowsPath
import sys

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_ROOT = REPOSITORY_ROOT / 'tests' / 'fixtures'
DEFAULT_OUTPUT_DIRECTORY = FIXTURES_ROOT / 'environment'
DAY_NIGHT_REPORT_SHA256 = 'fe5de165a4dd92eb02daea3092c86bfd286978f385f051d279496aa5ec14731e'
LOADED_TABLES_FILE_NAME = 'loaded-tables.json'
FIXTURES_OUTPUT_NAME = 'day-night-db4-fixtures.json'
LOADED_TABLES_OUTPUT_NAME = 'day-night-db4-loaded-tables.json'
EXPECTED_FIXTURE_COUNT = 336
EXPECTED_LOADED_TABLE_COUNT = 68
FIXTURE_REQUIRED_FIELDS = ('hour', 'environmentType', 'consumer', 'value', 'format', 'nativeFunction', 'status', 'claimIds', 'scope')
FIXTURE_OPTIONAL_FIELDS = ('method',)
LOADED_TABLE_FIELDS = ('environmentType', 'section', 'num', 'rows', 'packedHex')


class DayNightFixtureError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DayNightFixtureError(message)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def read_pinned_json(path, expected_sha256, label):
    data = Path(path).read_bytes()
    actual_sha256 = hashlib.sha256(data).hexdigest()
    require(actual_sha256 == expected_sha256, f'{label} sha256 {actual_sha256} differs from the pinned {expected_sha256}')
    return json.loads(data.decode('utf-8'))


def loaded_tables_sha256_from_report(report):
    matches = [entry for entry in report.get('outputFiles', []) if PureWindowsPath(entry.get('file', '')).name == LOADED_TABLES_FILE_NAME]
    require(len(matches) == 1, f'the DB-4 report lists {len(matches)} {LOADED_TABLES_FILE_NAME} output files, not 1')
    return matches[0]['sha256']


def validated_fixture(row, position):
    label = f'fixtures[{position}]'
    require(isinstance(row, dict) and all(field in row for field in FIXTURE_REQUIRED_FIELDS), f'{label} misses a required field')
    require(set(row) <= {*FIXTURE_REQUIRED_FIELDS, *FIXTURE_OPTIONAL_FIELDS}, f'{label} has unknown fields {sorted(set(row) - {*FIXTURE_REQUIRED_FIELDS, *FIXTURE_OPTIONAL_FIELDS})}')
    require(is_number(row['hour']) and type(row['environmentType']) is int, f'{label} needs a numeric hour and an integer environmentType')
    value = row['value']
    require(is_number(value) or (isinstance(value, list) and value and all(is_number(item) for item in value)), f'{label} value is not numeric')
    require(all(isinstance(row[field], str) and row[field] for field in ('consumer', 'format', 'nativeFunction', 'status', 'scope')),
            f'{label} needs text consumer, format, nativeFunction, status and scope')
    require(isinstance(row['claimIds'], list) and all(isinstance(claim, str) for claim in row['claimIds']), f'{label} claimIds is not a text list')
    return {field: row[field] for field in (*FIXTURE_REQUIRED_FIELDS, *FIXTURE_OPTIONAL_FIELDS) if field in row}


def validated_loaded_table(table, position):
    label = f'loaded tables[{position}]'
    require(isinstance(table, dict) and all(field in table for field in LOADED_TABLE_FIELDS), f'{label} misses a required field')
    require(type(table['environmentType']) is int and type(table['num']) is int and isinstance(table['section'], str), f'{label} has a wrong type')
    require(isinstance(table['packedHex'], str) and len(table['packedHex']) % 2 == 0, f'{label} packedHex is not hex')
    bytes.fromhex(table['packedHex'])
    require(isinstance(table['rows'], list) and all(isinstance(row, dict) and isinstance(row.get('key'), str) for row in table['rows']),
            f'{label} rows need text keys')
    return {'environmentType': table['environmentType'], 'section': table['section'], 'num': table['num'],
            'keys': [row['key'] for row in table['rows']], 'packedHex': table['packedHex']}


def rows_per_line_json(document, list_field):
    head = {key: value for key, value in document.items() if key != list_field}
    head_text = json.dumps(head, indent=2, ensure_ascii=True)[:-2]
    rows = ',\n'.join('    ' + json.dumps(row, ensure_ascii=True, separators=(', ', ': ')) for row in document[list_field])
    return f'{head_text},\n  "{list_field}": [\n{rows}\n  ]\n}}\n'.encode('utf-8')


def fixtures_document(report):
    fixtures = report.get('fixtures')
    require(isinstance(fixtures, list) and len(fixtures) == EXPECTED_FIXTURE_COUNT, f'the DB-4 report must hold {EXPECTED_FIXTURE_COUNT} fixtures')
    return {'schemaVersion': 1, 'kind': 'day-night-db4-fixtures',
            'source': {'report': 'day-night-cycle.json', 'reportSha256': DAY_NIGHT_REPORT_SHA256, 'question': report.get('question'),
                       'generatedAt': report.get('generatedAt')},
            'fixtures': [validated_fixture(row, position) for position, row in enumerate(fixtures)]}


def loaded_tables_document(loaded_tables, loaded_tables_sha256):
    require(isinstance(loaded_tables, list) and len(loaded_tables) == EXPECTED_LOADED_TABLE_COUNT,
            f'{LOADED_TABLES_FILE_NAME} must hold {EXPECTED_LOADED_TABLE_COUNT} tables')
    return {'schemaVersion': 1, 'kind': 'day-night-db4-loaded-tables',
            'source': {'file': LOADED_TABLES_FILE_NAME, 'sha256': loaded_tables_sha256, 'reportSha256': DAY_NIGHT_REPORT_SHA256},
            'tables': [validated_loaded_table(table, position) for position, table in enumerate(loaded_tables)]}


def require_output_directory_inside_fixtures(output_directory):
    resolved = Path(output_directory).resolve()
    require(resolved.is_relative_to(FIXTURES_ROOT.resolve()), f'output directory {resolved} is outside tests/fixtures')
    return resolved


def export_day_night_fixtures(report_path, loaded_tables_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    report = read_pinned_json(report_path, DAY_NIGHT_REPORT_SHA256, 'the DB-4 report')
    loaded_tables_sha256 = loaded_tables_sha256_from_report(report)
    loaded_tables = read_pinned_json(loaded_tables_path, loaded_tables_sha256, LOADED_TABLES_FILE_NAME)
    products = {FIXTURES_OUTPUT_NAME: rows_per_line_json(fixtures_document(report), 'fixtures'),
                LOADED_TABLES_OUTPUT_NAME: rows_per_line_json(loaded_tables_document(loaded_tables, loaded_tables_sha256), 'tables')}
    output.mkdir(parents=True, exist_ok=True)
    for name, data in products.items():
        (output / name).write_bytes(data)
    return {name: hashlib.sha256(data).hexdigest() for name, data in products.items()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the DB-4 day/night fixtures and loaded tables into tests/fixtures/environment.')
    parser.add_argument('--report', required=True)
    parser.add_argument('--loaded-tables', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_day_night_fixtures(options.report, options.loaded_tables, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
