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

NATIVE_FIXTURES_SHA256 = '7dbb25af32504745bbaff2c760c24d49457c5907ebc56fae10800d7593f8858b'
REAL_INPUTS_SHA256 = '435607c312bb87eeebb88e9e1906b26527d2a4729803c09f97f2d07cf3b7c220'
FIXTURES_OUTPUT_NAME = 'runtime-lighting-rm10-static-fixtures.json'
EXPECTED_FIXTURE_COUNT = 2
KEPT_FIXTURE_FIELDS = ('hour', 'environmentType', 'rotation', 'direction', 'sunPlane', 'ambientRGB', 'vertexIndices', 'instanceBGRA', 'matrix')
NORMAL_COMPONENTS = slice(3, 6)


def kept_fixture(fixture, position):
    missing = [field for field in KEPT_FIXTURE_FIELDS if field not in fixture]
    require(not missing, f'RM-10 static fixture {position} misses {missing}')
    require(len(fixture['vertexIndices']) == len(fixture['instanceBGRA']), f'RM-10 static fixture {position} pairs no colour with each vertex')
    return {'index': position, **{field: fixture[field] for field in KEPT_FIXTURE_FIELDS}}


def instance_masks(instance, kind):
    arrays = [entry for entry in instance['arrays'] if entry['kind'] == kind]
    require(len(arrays) == 1, f'the RM-10 instance lists {len(arrays)} {kind} light arrays')
    return [{'light': item['light']['objectIndex'], 'lightObject': item['light']['object'], 'maskHex': item['maskHex'], 'applied': item['flag']}
            for item in arrays[0]['items']]


def pillar_record(real_inputs):
    mesh, actor, instance = real_inputs['mesh'], real_inputs['actor'], real_inputs['instance']
    vertices = mesh['vertices']
    require(len(vertices) == mesh['vertexCount'] == instance['colourCount'], 'the RM-10 mesh and instance disagree on the vertex count')
    return {'actorExportIndex': actor['exportIndex'], 'actorObject': actor['object'], 'instanceExportIndex': instance['exportIndex'],
            'meshObject': mesh['object'], 'meshSourceSha256': mesh['source']['sha256'], 'vertexCount': mesh['vertexCount'],
            'nativeNormals': [component for vertex in vertices for component in vertex[NORMAL_COMPONENTS]],
            'primaryColoursHex': mesh['primaryColoursHex'], 'alternateColoursHex': mesh['alternateColoursHex'],
            'ordinaryMasks': instance_masks(instance, 'ordinary'), 'hourlyMasks': instance_masks(instance, 'hourly')}


def static_mesh_lighting_fixtures_document(native_fixtures, real_inputs):
    require(native_fixtures.get('passed') is True, 'the RM-10 static native fixtures did not pass')
    fixtures = native_fixtures.get('fixtures')
    require(isinstance(fixtures, list) and len(fixtures) == EXPECTED_FIXTURE_COUNT, f'the RM-10 static part must hold {EXPECTED_FIXTURE_COUNT} fixtures')
    return {'schemaVersion': 1, 'kind': 'runtime-lighting-rm10-static-fixtures',
            'source': {'nativeFixtures': {'file': 'runtime-lighting-rm10/static/native-fixtures.json', 'sha256': NATIVE_FIXTURES_SHA256,
                                          'method': native_fixtures.get('method')},
                       'realInputs': {'file': 'runtime-lighting-rm10/static/real-inputs.json', 'sha256': REAL_INPUTS_SHA256}},
            'pillar': pillar_record(real_inputs),
            'fixtures': [kept_fixture(fixture, position) for position, fixture in enumerate(fixtures)]}


def export_static_mesh_lighting_fixtures(native_fixtures_path, real_inputs_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    native_fixtures = read_pinned_json(native_fixtures_path, NATIVE_FIXTURES_SHA256, 'the RM-10 static native fixtures')
    real_inputs = read_pinned_json(real_inputs_path, REAL_INPUTS_SHA256, 'the RM-10 static real inputs')
    data = rows_per_line_json(static_mesh_lighting_fixtures_document(native_fixtures, real_inputs), 'fixtures')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-10 static mesh lighting fixtures into tests/fixtures/environment.')
    parser.add_argument('--native-fixtures', required=True)
    parser.add_argument('--real-inputs', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_static_mesh_lighting_fixtures(options.native_fixtures, options.real_inputs, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
