from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json

from world.export_day_night_fixtures import (DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures,
                                             rows_per_line_json)

NATIVE_FIXTURES_SHA256 = 'f5c37a237c79cd8dac8037feb6f60e5d24f57305e24275986678d42902cc0047'
FIXTURES_OUTPUT_NAME = 'fog-transition-rm17-fixtures.json'
EXPECTED_FIXTURE_COUNT = 15
STATE_FIELDS = ('targetColorBGRA', 'targetStart', 'targetEnd', 'oldColorBGRA', 'oldStart', 'oldEnd', 'colorBGRA', 'start', 'end', 'duration', 'remaining')


def kept_state(state, label):
    require(isinstance(state, dict) and all(field in state for field in STATE_FIELDS), f'{label} misses a fog transition state field')
    return {field: state[field] for field in STATE_FIELDS}


def kept_fixture(fixture, position):
    label = f'RM-17 transition fixture {position}'
    require(fixture.get('passed') is True and fixture.get('output') == fixture.get('scalarOutput'), f'{label} did not pass its scalar recomputation')
    return {'index': position, 'scenario': fixture['scenario'], 'deltaSeconds': fixture['deltaSeconds'],
            'before': kept_state(fixture['before'], f'{label} before'), 'output': kept_state(fixture['output'], f'{label} output')}


def fog_transition_fixtures_document(native_fixtures):
    fixtures = native_fixtures.get('fixtures')
    require(isinstance(fixtures, list) and len(fixtures) == EXPECTED_FIXTURE_COUNT, f'the RM-17 transition part must hold {EXPECTED_FIXTURE_COUNT} fixtures')
    return {'schemaVersion': 1, 'kind': 'fog-transition-rm17-fixtures',
            'source': {'file': 'sky-fog-route-rm17/transition/native-fixtures.json', 'sha256': NATIVE_FIXTURES_SHA256, 'method': native_fixtures.get('method')},
            'fixtures': [kept_fixture(fixture, position) for position, fixture in enumerate(fixtures)]}


def export_fog_transition_fixtures(native_fixtures_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    native_fixtures = read_pinned_json(native_fixtures_path, NATIVE_FIXTURES_SHA256, 'the RM-17 transition native fixtures')
    data = rows_per_line_json(fog_transition_fixtures_document(native_fixtures), 'fixtures')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the 15 RM-17 fog transition fixtures into tests/fixtures/environment.')
    parser.add_argument('--native-fixtures', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_fog_transition_fixtures(options.native_fixtures, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
