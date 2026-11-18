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

SKY_FOG_DEPTH_SHA256 = '2078c337142b8294533c033da4f308757986703209d10ad8dc51fc41c5920492'
FIXTURES_OUTPUT_NAME = 'sky-fog-depth-rm18-fixtures.json'
KEPT_FIXTURE_FIELDS = ('id', 'map', 'pointIndex', 'hour', 'skyEye', 'position', 'viewPosition', 'depthRule', 'fogDepth', 'fogStart', 'fogEnd', 'fogColor',
                       'factorRealArithmetic', 'preFogRGB', 'resultRGBRealArithmetic', 'conditions')


def kept_fixture(fixture, position):
    missing = [field for field in KEPT_FIXTURE_FIELDS if field not in fixture]
    require(not missing and fixture.get('passed') is True, f'RM-18 numeric fixture {position} misses {missing} or did not pass')
    return {field: fixture[field] for field in KEPT_FIXTURE_FIELDS}


def sky_fog_depth_fixtures_document(answer):
    fixtures = answer.get('numericFixtures')
    require(isinstance(fixtures, list) and fixtures, 'the RM-18 answer holds no numeric fixtures')
    return {'schemaVersion': 1, 'kind': 'sky-fog-depth-rm18-fixtures', 'source': {'file': 'sky-fog-depth.json', 'sha256': SKY_FOG_DEPTH_SHA256},
            'fixtures': [kept_fixture(fixture, position) for position, fixture in enumerate(fixtures)]}


def export_sky_fog_depth_fixtures(answer_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    answer = read_pinned_json(answer_path, SKY_FOG_DEPTH_SHA256, 'the RM-18 sky fog depth answer')
    data = rows_per_line_json(sky_fog_depth_fixtures_document(answer), 'fixtures')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-18 sky fog depth numeric fixtures into tests/fixtures/environment.')
    parser.add_argument('--answer', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_sky_fog_depth_fixtures(options.answer, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
