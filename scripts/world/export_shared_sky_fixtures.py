from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json

from world.export_day_night_fixtures import DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures

SHARED_SKY_PASSES_SHA256 = '7cc8a82e1d5e222d6a652127768bcdad5aab25e53caa598f51d65d0603b95e22'
SHARED_SKYLEVEL_DECODE_SHA256 = '6a7899f97b8678185ec3fa17a2540a78d1277ce4141cdb035a6e765bb9aed33b'
FIXTURES_OUTPUT_NAME = 'shared-sky-rm21-fixtures.json'
LOCAL_SKY_OVERRIDE_PART = 'materials/local-sky-override-part.json'
PASS_STATE_PART = 'passes/passes-part.json'
FOG_CROSS_CHECK_KIND = 'analyticalD3DFogCrossCheck'
OUTPUT_BLENDING_FUNCTION = 'Shader OutputBlending branch0x1000c7f7'
FRAME_BUFFER_BLENDING_FUNCTION = 'FinalBlend framebuffer branch0x1000f4e2'
KEPT_ACTOR_FIELDS = ('actor', 'exportIndex', 'referencePoint', 'hour', 'selectedTimes', 'nativeSpatialWeight', 'nativeHourWeight', 'runningRGB')
KEPT_CROSS_CHECK_FIELDS = ('map', 'hour', 'materialRGB', 'fogRGB', 'depth', 'fogWeight', 'unquantizedRGB', 'observedRGB')
KEPT_PASS_OUTPUT_FIELDS = ('srcBlend', 'destBlend', 'fogOverride', 'fogBGRA')
KEPT_MATERIAL_FIELDS = ('object', 'exportIndex', 'authoredOrDefaultColorBGRA', 'AlphaBlend', 'RenderTwoSided', 'shaderOutputBlending', 'hasOpacity',
                        'referencedBySharedSkyBSP')
KEPT_PIXEL_GEOMETRY_FIELDS = ('nodeIndex', 'surfaceIndex', 'pointIndices', 'cameraDepth')
OUTPUT_BLENDING_COUNT = 7
POLYGON_MINIMUM_VERTEX_COUNT = 3
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


def sky_zone_of_decode(decode):
    sky_zones = [zone for zone in decode['zones'] if zone['actor'] is not None and zone['actor'].endswith('.SkyZoneInfo0')]
    require(len(sky_zones) == 1, f'the RM-18 skylevel decode holds {len(sky_zones)} SkyZoneInfo0 zones, not 1')
    actor = next((actor for actor in decode['actors'] if actor['exportIndex'] == sky_zones[0]['actorIndex']), None)
    require(actor is not None and 'Location' in actor['values'], 'the RM-18 skylevel decode holds no Location of its SkyZoneInfo0 actor')
    return {'zoneIndex': sky_zones[0]['zoneIndex'], 'actor': actor['object'], 'exportIndex': actor['exportIndex'], 'location': actor['values']['Location'],
            'drawScale': actor['values'].get('DrawScale'), 'serializesRotation': 'Rotation' in actor['values']}


def sky_zone_node_counts(decode):
    sky_zone_index = sky_zone_of_decode(decode)['zoneIndex']
    sky_zone_nodes = [node for node in decode['nodes'] if sky_zone_index in node['zones']]
    return {'skyZoneNodeCount': len(sky_zone_nodes),
            'skyZonePolygonNodeCount': sum(1 for node in sky_zone_nodes if len(node['vertices']) >= POLYGON_MINIMUM_VERTEX_COUNT)}


def decoded_node_points(decode, node_index):
    node = decode['nodes'][node_index]
    require(node['nodeIndex'] == node_index, f'the RM-18 skylevel decode node list is not indexed by node at {node_index}')
    return {'nodeIndex': node_index, 'surfaceIndex': node['surfaceIndex'], 'material': node['material'], 'zones': node['zones'],
            'points': [{'pointIndex': vertex['pointIndex'], 'position': vertex['position']} for vertex in node['vertices']]}


def shared_skylevel(answer, decode):
    pixel_geometry = kept_fields(answer['pixelGeometry'], KEPT_PIXEL_GEOMETRY_FIELDS, 'RM-21 pixelGeometry')
    require(answer['transform']['skyEye'] == sky_zone_of_decode(decode)['location'], 'the RM-21 sky eye differs from the RM-18 SkyZoneInfo0 Location')
    return {'source': {'file': 'sky-fog-depth-rm18/data/shared-skylevel-data.json', 'sha256': SHARED_SKYLEVEL_DECODE_SHA256,
                       'mapSha256': decode['source']['fileSha256']},
            'levelExportIndex': decode['levelExportIndex'], 'modelExportIndex': decode['modelExportIndex'], 'zoneCount': len(decode['zones']),
            'surfaceCount': len(decode['surfaces']), 'nodeCount': len(decode['nodes']),
            'skyZone': sky_zone_of_decode(decode), **sky_zone_node_counts(decode),
            'surfaceCountsByMaterial': dict(sorted(Counter(surface['material'] for surface in decode['surfaces']).items())),
            'pixelGeometry': pixel_geometry, 'pixelNode': decoded_node_points(decode, pixel_geometry['nodeIndex']),
            'usesSkyDrawScale': answer['transform']['usesSkyDrawScale'],
            'materials': [kept_fields(material, KEPT_MATERIAL_FIELDS, f'RM-21 material {position}') for position, material in enumerate(answer['materials'])]}


def shared_sky_fixtures_document(answer, decode):
    fixtures = answer.get('fixtures')
    require(isinstance(fixtures, list) and fixtures, 'the RM-21 answer holds no fixtures')
    return {'schemaVersion': 1, 'kind': 'shared-sky-rm21-fixtures', 'source': {'file': 'shared-sky-render-passes.json', 'sha256': SHARED_SKY_PASSES_SHA256},
            'localSkyOverride': local_sky_override(fixtures), 'fogCrossCheck': fog_cross_check(fixtures),
            'outputBlendingPasses': pass_states(fixtures, OUTPUT_BLENDING_FUNCTION, 'outputBlending', OUTPUT_BLENDING_COUNT),
            'frameBufferBlendingPasses': pass_states(fixtures, FRAME_BUFFER_BLENDING_FUNCTION, 'frameBufferBlending', FRAME_BUFFER_BLENDING_COUNT),
            'sharedSkyLevel': shared_skylevel(answer, decode)}


def export_shared_sky_fixtures(answer_path, decode_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    answer = read_pinned_json(answer_path, SHARED_SKY_PASSES_SHA256, 'the RM-21 shared sky render passes answer')
    decode = read_pinned_json(decode_path, SHARED_SKYLEVEL_DECODE_SHA256, 'the RM-18 shared skylevel decode')
    data = (json.dumps(shared_sky_fixtures_document(answer, decode), indent=1, ensure_ascii=True) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-21 shared sky local colour, pass state, fog and skylevel fixtures into '
                                                 'tests/fixtures/environment.')
    parser.add_argument('--answer', required=True)
    parser.add_argument('--skylevel-decode', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_shared_sky_fixtures(options.answer, options.skylevel_decode, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
