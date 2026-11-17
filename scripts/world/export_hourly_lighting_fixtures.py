from pathlib import Path, PureWindowsPath
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json

from world.export_day_night_fixtures import (DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures,
                                             rows_per_line_json)

COMPOSITION_SHA256 = 'f0a6eb0f106be32fa9b4b58f1ea5868eb3f5d5a394ef5c0696016ac8ab6dee3c'
REPLAY_RESULT_SHA256 = '7a0b2e2f73e9b199e8f47a63773e3f7d82b9202b4c57a93741ad71c52206a787'
FIXTURES_OUTPUT_NAME = 'hourly-lighting-db7-fixtures.json'
EXPECTED_FIXTURE_COUNT = 32
SURFACE_TYPES = ('terrain', 'BSP', 'staticMesh', 'actor')
KEPT_FIXTURE_FIELDS = ('hour', 'surfaceType', 'object', 'vertexIndex', 'environmentType', 'controlWord', 'status', 'claimIds', 'input', 'output')
CONTEXT_FIELDS = ('tIntMapTimes', 'tIntMapSample134x129', 'nativePatchSamplesLocal6x1', 'terrainLightMaskBit23', 'staticHourlyVertex0Bits',
                  'staticHourlyItemsContiguous', 'atlasChildCounts')


def kept_fixture(fixture, replayed, position):
    label = f'fixtures[{position}]'
    require(isinstance(fixture, dict) and fixture.get('surfaceType') in SURFACE_TYPES, f'{label} has no known surfaceType')
    require(isinstance(fixture.get('input'), dict) and isinstance(fixture.get('output'), dict), f'{label} needs input and output objects')
    require(isinstance(replayed, dict) and replayed.get('index') == position, f'replay result {position} is out of order')
    require((replayed.get('hour'), replayed.get('surfaceType')) == (fixture.get('hour'), fixture['surfaceType']),
            f'replay result {position} recomputes another fixture')
    require(replayed.get('matched') is True and replayed.get('problems') == [], f'replay result {position} did not recompute')
    return {'index': position, **{field: fixture[field] for field in KEPT_FIXTURE_FIELDS if field in fixture}}


def hourly_lighting_fixtures_document(composition, replay_result):
    require(replay_result.get('compositionSha256') == COMPOSITION_SHA256, 'the replay result recomputes another composition')
    fixtures = composition.get('fixtures')
    require(isinstance(fixtures, list) and len(fixtures) == EXPECTED_FIXTURE_COUNT, f'the composition must hold {EXPECTED_FIXTURE_COUNT} fixtures')
    summary = replay_result.get('fixtures', {})
    require(summary.get('checked') == EXPECTED_FIXTURE_COUNT and summary.get('matched') == EXPECTED_FIXTURE_COUNT,
            f'the replay result must recompute all {EXPECTED_FIXTURE_COUNT} fixtures')
    results = summary.get('results')
    require(isinstance(results, list) and len(results) == EXPECTED_FIXTURE_COUNT, 'the replay result lists another fixture count')
    context = replay_result.get('fixtureContext', {})
    require(all(field in context for field in CONTEXT_FIELDS), 'the replay result fixture context misses a field')
    return {'schemaVersion': 1, 'kind': 'hourly-lighting-db7-fixtures',
            'source': {'composition': {'file': PureWindowsPath(replay_result.get('composition', '')).name, 'sha256': COMPOSITION_SHA256,
                                       'question': composition.get('question'), 'generatedAt': composition.get('generatedAt')},
                       'replayResult': {'file': 'replay-result.json', 'sha256': REPLAY_RESULT_SHA256, 'checked': summary['checked'],
                                        'matched': summary['matched']}},
            'context': {field: context[field] for field in CONTEXT_FIELDS},
            'fixtures': [kept_fixture(fixture, replayed, position) for position, (fixture, replayed) in enumerate(zip(fixtures, results))]}


def export_hourly_lighting_fixtures(composition_path, replay_result_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    composition = read_pinned_json(composition_path, COMPOSITION_SHA256, 'the DB-7 composition')
    replay_result = read_pinned_json(replay_result_path, REPLAY_RESULT_SHA256, 'the DB-7 replay result')
    data = rows_per_line_json(hourly_lighting_fixtures_document(composition, replay_result), 'fixtures')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the 32 DB-7 hourly lighting fixtures into tests/fixtures/environment.')
    parser.add_argument('--composition', required=True)
    parser.add_argument('--replay-result', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_hourly_lighting_fixtures(options.composition, options.replay_result, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
