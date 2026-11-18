import argparse
import hashlib
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))
from world.export_day_night_fixtures import DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures

SHARED_SKY_PASSES_SHA256 = '7cc8a82e1d5e222d6a652127768bcdad5aab25e53caa598f51d65d0603b95e22'
FIXTURES_OUTPUT_NAME = 'shared-sky-rm21-fixtures.json'
LOCAL_SKY_OVERRIDE_PART = 'materials/local-sky-override-part.json'
PASS_STATE_PART = 'passes/passes-part.json'
FOG_CROSS_CHECK_KIND = 'analyticalD3DFogCrossCheck'
OUTPUT_BLENDING_FUNCTION = 'Shader OutputBlending branch0x1000c7f7'
FRAME_BUFFER_BLENDING_FUNCTION = 'FinalBlend framebuffer branch0x1000f4e2'
KEPT_ACTOR_FIELDS = ('actor', 'exportIndex', 'referencePoint', 'hour', 'selectedTimes', 'nativeSpatialWeight', 'nativeHourWeight', 'runningRGB')
KEPT_CROSS_CHECK_FIELDS = ('map', 'hour', 'materialRGB', 'fogRGB', 'depth', 'fogWeight', 'unquantizedRGB', 'observedRGB')
KEPT_PASS_OUTPUT_FIELDS = ('srcBlend', 'destBlend', 'fogOverride', 'fogBGRA')
OUTPUT_BLENDING_COUNT = 7
FRAME_BUFFER_BLENDING_COUNT = 9


def kept_fields(record, fields, label):
    missing = [field for field in fields if field not in record]
    require(not missing, f'{label} misses {missing}')
    return {field: record[field] for field in fields}


def single_part(fixtures, source_part):
    matches = [entry for entry in fixtures if entry.get('sourcePart') == source_part and 'fixtures' in entry]
    require(len(matches) == 1, f'the RM-21 answer holds {len(matches)} {source_part} fixture sets, not 1')
    return matches[0]['fixtures']


def local_sky_override(fixtures):
    part = single_part(fixtures, LOCAL_SKY_OVERRIDE_PART)
    actors = part.get('fixtures')
    require(isinstance(actors, list) and actors, 'the RM-21 local sky override part holds no actor fixtures')
    return {'baselineRGB': part['baselineRGB'], 'finalRGB': part['finalRGB'],
            'actors': [kept_fields(actor, KEPT_ACTOR_FIELDS, f'local sky override actor {position}') for position, actor in enumerate(actors)]}


def pass_state(fixture, ordinal_field):
    output = kept_fields(fixture['output'], KEPT_PASS_OUTPUT_FIELDS, f'{fixture["function"]} {fixture.get(ordinal_field)} output')
    return {'ordinal': fixture[ordinal_field], 'hasOpacityMaterial': fixture.get('hasOpacityMaterial', False), **output}


def pass_states(fixtures, function, ordinal_field, expected_ordinals):
    rows = [pass_state(entry['fixture'], ordinal_field) for entry in fixtures
            if entry.get('sourcePart') == PASS_STATE_PART and entry.get('fixture', {}).get('function') == function]
    require(sorted({row['ordinal'] for row in rows}) == list(range(expected_ordinals)), f'the RM-21 {function} rows do not cover ordinals 0 to {expected_ordinals - 1}')
    return rows


def fog_cross_check(fixtures):
    matches = [entry for entry in fixtures if entry.get('kind') == FOG_CROSS_CHECK_KIND]
    require(len(matches) == 1, f'the RM-21 answer holds {len(matches)} {FOG_CROSS_CHECK_KIND} rows, not 1')
    return kept_fields(matches[0], KEPT_CROSS_CHECK_FIELDS, FOG_CROSS_CHECK_KIND)


def shared_sky_fixtures_document(answer):
    fixtures = answer.get('fixtures')
    require(isinstance(fixtures, list) and fixtures, 'the RM-21 answer holds no fixtures')
    return {'schemaVersion': 1, 'kind': 'shared-sky-rm21-fixtures', 'source': {'file': 'shared-sky-render-passes.json', 'sha256': SHARED_SKY_PASSES_SHA256},
            'localSkyOverride': local_sky_override(fixtures), 'fogCrossCheck': fog_cross_check(fixtures),
            'outputBlendingPasses': pass_states(fixtures, OUTPUT_BLENDING_FUNCTION, 'outputBlending', OUTPUT_BLENDING_COUNT),
            'frameBufferBlendingPasses': pass_states(fixtures, FRAME_BUFFER_BLENDING_FUNCTION, 'frameBufferBlending', FRAME_BUFFER_BLENDING_COUNT)}


def write_shared_sky_fixtures(answer_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    answer = read_pinned_json(answer_path, SHARED_SKY_PASSES_SHA256, 'the RM-21 shared sky render passes answer')
    data = (json.dumps(shared_sky_fixtures_document(answer), indent=1, ensure_ascii=True) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-21 shared sky local colour, pass state and fog fixtures into tests/fixtures/environment.')
    parser.add_argument('--answer', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = write_shared_sky_fixtures(options.answer, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
