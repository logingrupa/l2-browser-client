from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import re
import struct

from native_store.store_paths import REPOSITORY_ROOT
from world.export_day_night_fixtures import DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures
from world.shared_sky_visibility_rules import SHARED_SKY_VISIBILITY_RULES_SCHEMA_VERSION

SHARED_SKY_NODES_SHA256 = '5275acf9d8027d4556f3419f33db4006fc07bf39b0da9b5541dd32d660460fd4'
VIEW_FRUSTUM_SHA256 = '1ea27d25e8cd8660e416a86d6978aef7d151057bdf789632882224b6ae62e10f'
VIEW_FRUSTUM_MANIFEST_SHA256 = 'e6699aa3218ac1fe986fbef5b7c918a4c337afdd3a2bce53d9385e7f819927ce'
SKY_DRAW_ORDER_SHA256 = 'ad73cee09e34a1d9ad560026b90c6e4643b1225c8b905d4377b0b19cb3fa20c1'
SKY_DRAW_ORDER_MANIFEST_SHA256 = '1d02a8374e80d46f2099f1e05ad04ec4a9268aca056cfe385750798ab64f2303'
VERIFIED_SKY_DRAW_ORDER_FILE = 'verified-sky-draw-order.md'
VERIFIED_SKY_DRAW_ORDER_SHA256 = 'ff5d8490305f462f636a79309ac1aa9b1cdc42d8b26c1252e8712496318a1d78'
ENGINE_CLASS_PACKAGE = 'Engine'
FORWARDING_RULE_PATTERN = re.compile(r'Each surface material is an L2_Skies \w+\. U(\w+)::RequiresSorting \((0x[0-9a-f]+)\) forwards to (\w+) at '
                                     r'\+0x[0-9a-f]+, or returns 0 when \3 is null')
SHADER_OPACITY_RULE_PATTERN = re.compile(r'U(\w+) (0x[0-9a-f]+): OB (\d+) with (\w+)')
SHADER_SORTING_SET_PATTERN = re.compile(r'OB in \{([0-9,]+)\}')
SHADER_OUTPUT_BLENDING_FIELD_PATTERN = re.compile(r'the byte at \+0x598 holds (\w+)')
TEXTURE_RULE_PATTERN = re.compile(r'U(\w+) (0x[0-9a-f]+): \(\+0x5c0>>1\)&1')
TEXTURE_FLAG_FIELD_PATTERN = re.compile(r'Treating bit 1 of \+0x5c0 as (\w+) is the UE2 layout')
FIXTURES_OUTPUT_NAME = 'shared-sky-visibility-fixtures.json'
STAGED_SKY_VISIBILITY_FOLDER = 'skylevel-visibility'
STAGED_SKY_VISIBILITY_FILES = ('visibility.json', 'payload.bin')
STAGED_SKY_SNAPSHOT_NAME = 'sky.json'
STAGED_MATERIAL_PROGRAMS_LISTING_NAME = 'material-programs.json'
STAGED_MATERIAL_PROGRAMS_FOLDER = 'material-programs'
PROGRAM_FILE_NAME = 'program.json'
RULES_RELATIVE_PATH = 'recipes/world/shared-sky-visibility.json'
LEVEL_SERIALIZE_ADDRESS = '0x105d07f0'
VIEW_FRUSTUM_ADDRESS = '0x10654530'
OBSOLETE_ARRAY_PATTERN = re.compile(r'if Ar\.Ver<(\d+): serialize and destroy temporary legacy')
OBJECT_REFERENCE_PATTERN = re.compile(r'for i in0\.\.(\d+): Ar << objectRef\(this\+0xc4')
STRING_MAP_PATTERN = re.compile(r'if Ar\.Ver>=(\d+): SerializeStringMap')
STRING_ARRAY_MIGRATION_PATTERN = re.compile(r'else if Ar\.Ver>=(\d+): read two string arrays')
NODE_SELECTOR_ADDRESS = '0x10689fd0'
BACKFACE_PATTERN = re.compile(r'If d<=0 and !\(surf\.flags&(0x[0-9a-f]+)\) and scene\.zone!=0 and !\(surf\.flags&(0x[0-9a-f]+)\): skip this node')
FAKE_BACKDROP_PATTERN = re.compile(r'If surf\.flags&(0x[0-9a-f]+): evaluate FakeBackdrop gates')
ORDINARY_GEOMETRY_PATTERN = re.compile(r'Ordinary geometry additionally requires !\(flags&(0x[0-9a-f]+|\d+)\) OR \(!\(flags&(0x[0-9a-f]+|\d+)\) AND '
                                       r'!\(flags&(0x[0-9a-f]+|\d+)\)\)')
TAIL_NAME_CLAIM_PREFIX = 'RM22-TAIL-'
TAIL_NAME_CLAIM_SUFFIX = '-NAME'
TAIL_OLDER_VERSIONS_CLAIM = 'RM22-TAIL-OLDER-VERSIONS'
FIRST_DELETED_CLAIM = 'RM22-LEVEL-FIRST-DELETED'
NEAR_CLIPPING_PLANE_NAME = 'NEAR_CLIPPING_PLANE image initial value'
FAR_CLIPPING_PLANE_NAME = 'FAR_CLIPPING_PLANE image initial value'
SAFE_NORMAL_THRESHOLD_NAME = 'SafeNormal threshold'
SCENE_MATRIX_NAMES = ('WorldToCamera', 'WorldToScreen', 'ScreenToWorld')
SCENE_EYE_NAME = 'ViewOrigin'
MATRIX_BYTES = 64
EYE_BYTES = 12
PLANE_BYTES = 16
SORTED_ROUTE = 'sorted-bsp'
UNSORTED_ROUTE = 'unsorted-section'
ACTOR_ROUTE = 'actor'
STATE_TUPLE_KEYS = ('ZENABLE', 'ZWRITEENABLE', 'ZFUNC', 'SRCBLEND', 'DESTBLEND', 'ALPHABLENDENABLE')
QUEUE_FIXTURE_SCENARIOS = ('BSP-visit-order', 'non-sorted-section-first-encounter')
KEPT_TRIGGER_FIELDS = ('nodeIndex', 'surfaceIndex', 'nativeSectionIndex', 'nodePlane', 'nodeZoneMask', 'visibleZoneMask', 'zones', 'numVertices',
                       'selectedSide', 'cameraPlaneDistanceF32', 'sphereVisibilityResult', 'surfaceFlags', 'viewport160Dword', 'childZoneIndex')


def single(rows, predicate, label):
    matches = [row for row in rows if predicate(row)]
    require(len(matches) == 1, f'{label}: found {len(matches)}, not 1')
    return matches[0]


def read_pinned_bytes(path, expected_sha256, label):
    data = Path(path).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    require(actual == expected_sha256, f'{label} sha256 {actual} differs from the pinned {expected_sha256}')
    return data


def pattern_integer(pattern, text, label):
    match = pattern.search(text)
    require(match is not None, f'the RM-22 ULevel::Serialize pseudocode states no {label}')
    return int(match.group(1))


def level_tail_rules(nodes_answer):
    function = single(nodes_answer['functions'], lambda row: row['va'] == LEVEL_SERIALIZE_ADDRESS, 'RM-22 ULevel::Serialize')
    pseudocode = function['pseudocode']
    unresolved_ids = [row['id'] for row in nodes_answer['unresolved']]
    claim_ids = [row['id'] for row in nodes_answer['claims']]
    require(FIRST_DELETED_CLAIM in claim_ids and TAIL_OLDER_VERSIONS_CLAIM in unresolved_ids, 'the RM-22 answer lacks its FirstDeleted or older-version rows')
    return {'function': function['name'], 'address': LEVEL_SERIALIZE_ADDRESS,
            'obsoleteArrayBelowVersion': pattern_integer(OBSOLETE_ARRAY_PATTERN, pseudocode, 'obsolete array gate'),
            'objectReferenceCount': pattern_integer(OBJECT_REFERENCE_PATTERN, pseudocode, 'object reference loop') + 1,
            'stringMapFromVersion': pattern_integer(STRING_MAP_PATTERN, pseudocode, 'string map gate'),
            'stringArrayMigrationFromVersion': pattern_integer(STRING_ARRAY_MIGRATION_PATTERN, pseudocode, 'string array migration gate'),
            'firstDeletedClaim': FIRST_DELETED_CLAIM, 'olderVersionsUnresolved': TAIL_OLDER_VERSIONS_CLAIM,
            'unprovenNames': sorted(identifier for identifier in unresolved_ids
                                    if identifier.startswith(TAIL_NAME_CLAIM_PREFIX) and identifier.endswith(TAIL_NAME_CLAIM_SUFFIX))}


def pattern_flags(pattern, text, label):
    match = pattern.search(text)
    require(match is not None, f'the RM-22 selector pseudocode states no {label}')
    return [int(group, 0) for group in match.groups()]


def node_selector_rules(nodes_answer):
    pseudocode = single(nodes_answer['functions'], lambda row: row['va'] == NODE_SELECTOR_ADDRESS, 'RM-22 selector')['pseudocode']
    [ordinary_excluded_flag, ordinary_first_flag, ordinary_second_flag] = pattern_flags(ORDINARY_GEOMETRY_PATTERN, pseudocode, 'ordinary geometry rule')
    [fake_backdrop_flag] = pattern_flags(FAKE_BACKDROP_PATTERN, pseudocode, 'FakeBackdrop flag')
    return {'function': 'Route visible BSP node', 'address': NODE_SELECTOR_ADDRESS,
            'backfaceKeepFlags': pattern_flags(BACKFACE_PATTERN, pseudocode, 'backface keep flags'), 'fakeBackdropFlag': fake_backdrop_flag,
            'ordinaryGeometry': {'excludedFlag': ordinary_excluded_flag, 'unlessNeitherFlags': [ordinary_first_flag, ordinary_second_flag]}}


def data_row_value(frustum_answer, name):
    row = single(frustum_answer['construction']['dataReplay'], lambda entry: entry['decodedValues'].get('name') == name, f'RM-23 data row {name}')
    values = row['decodedValues']
    return values['float32'] if 'float32' in values else values['float64']


def view_frustum_rules(frustum_answer):
    precision = frustum_answer['construction']['precision']
    return {'function': 'FLevelSceneNode::GetViewFrustum', 'address': VIEW_FRUSTUM_ADDRESS,
            'planeOrder': frustum_answer['construction']['planeOrder'], 'signedDistance': precision['signedDistance'], 'inside': precision['inside'],
            'nearClip': data_row_value(frustum_answer, NEAR_CLIPPING_PLANE_NAME), 'farClip': data_row_value(frustum_answer, FAR_CLIPPING_PLANE_NAME),
            'safeNormalThreshold': data_row_value(frustum_answer, SAFE_NORMAL_THRESHOLD_NAME)}


def material_routes(order_answer):
    routes = {}
    for draw in order_answer['orderedDraws']:
        if draw['route'] == ACTOR_ROUTE:
            continue
        require(draw['route'] in (SORTED_ROUTE, UNSORTED_ROUTE), f'RM-24 draw {draw["drawIndex"]} has the unknown route {draw["route"]}')
        routes.setdefault(draw['material'], set()).add(draw['route'])
    require(all(len(found) == 1 for found in routes.values()), 'an RM-24 material draws through both the sorted and the unsorted route')
    return {material: next(iter(found)) for material, found in routes.items()}


def material_state(order_answer, material):
    row = single(order_answer['byMaterial'], lambda entry: entry['material'] == material, f'RM-24 byMaterial {material}')
    require(tuple(row['stateTupleKeys']) == STATE_TUPLE_KEYS and len(row['stateTuples']) == 1, f'RM-24 {material} needs one state tuple')
    return dict(zip(STATE_TUPLE_KEYS, row['stateTuples'][0]))


def material_sorting_rules(order_answer):
    return [{'material': material, 'requiresSorting': route == SORTED_ROUTE, 'renderState': material_state(order_answer, material)}
            for material, route in sorted(material_routes(order_answer).items())]


def depth_clear_rules(order_answer):
    clear = order_answer['depth']['clearRule']
    return {'callerAddress': clear['callerVa'], 'flags': clear['flags'], 'depth': clear['depth'], 'colorCleared': clear['colorCleared'],
            'stencilCleared': clear['stencilCleared']}


def verified_groups(pattern, text, label):
    match = pattern.search(text)
    require(match is not None, f'{VERIFIED_SKY_DRAW_ORDER_FILE} states no {label}')
    return match.groups()


def engine_class(name):
    return f'{ENGINE_CLASS_PACKAGE}.{name}'


def requires_sorting_rules(verified_text):
    forwarding_owner, forwarding_address, forwarding_field = verified_groups(FORWARDING_RULE_PATTERN, verified_text, 'modifier forwarding rule')
    shader_class, shader_address, opacity_output_blending, opacity_field = verified_groups(SHADER_OPACITY_RULE_PATTERN, verified_text, 'shader opacity rule')
    [sorting_set] = verified_groups(SHADER_SORTING_SET_PATTERN, verified_text, 'shader output blending set')
    [output_blending_field] = verified_groups(SHADER_OUTPUT_BLENDING_FIELD_PATTERN, verified_text, 'shader output blending field')
    texture_class, texture_address = verified_groups(TEXTURE_RULE_PATTERN, verified_text, 'texture rule')
    [texture_flag_field] = verified_groups(TEXTURE_FLAG_FIELD_PATTERN, verified_text, 'texture flag field')
    return {'source': {'file': VERIFIED_SKY_DRAW_ORDER_FILE, 'sha256': VERIFIED_SKY_DRAW_ORDER_SHA256},
            'forwarding': {'class': engine_class(forwarding_owner), 'function': f'U{forwarding_owner}::RequiresSorting', 'address': forwarding_address,
                           'field': forwarding_field},
            'shader': {'class': engine_class(shader_class), 'address': shader_address, 'outputBlendingField': output_blending_field,
                       'sortingOutputBlending': [int(value) for value in sorting_set.split(',')],
                       'opacityOutputBlending': int(opacity_output_blending), 'opacityField': opacity_field},
            'texture': {'class': engine_class(texture_class), 'address': texture_address, 'flagField': texture_flag_field}}


def shared_sky_visibility_rules(nodes_answer, frustum_answer, order_answer, verified_order_text):
    return {'schemaVersion': SHARED_SKY_VISIBILITY_RULES_SCHEMA_VERSION, 'kind': 'shared-sky-visibility-rules',
            'sources': {'sharedSkyNodes': {'file': 'shared-sky-nodes.json', 'sha256': SHARED_SKY_NODES_SHA256},
                        'viewFrustum': {'file': 'view-frustum.json', 'sha256': VIEW_FRUSTUM_SHA256, 'manifestSha256': VIEW_FRUSTUM_MANIFEST_SHA256},
                        'skyDrawOrder': {'file': 'sky-draw-order.json', 'sha256': SKY_DRAW_ORDER_SHA256, 'manifestSha256': SKY_DRAW_ORDER_MANIFEST_SHA256}},
            'levelTail': level_tail_rules(nodes_answer), 'nodeSelector': node_selector_rules(nodes_answer), 'viewFrustum': view_frustum_rules(frustum_answer),
            'requiresSortingRules': requires_sorting_rules(verified_order_text), 'materialSorting': material_sorting_rules(order_answer),
            'depthClear': depth_clear_rules(order_answer)}


def scene_field_hex(scene_bytes, offset_text, size):
    offset = int(offset_text, 16)
    return scene_bytes[offset:offset + size].hex()


def frustum_record(frustum_answer, frustum):
    layout = frustum_answer['construction']['sceneLayout']
    scene_bytes = bytes.fromhex(frustum['entry']['scene']['bytesHex'])
    output = frustum['result']['output']
    planes_hex = output['bytesHex'][:2 * PLANE_BYTES * output['count']]
    return {'role': frustum['role'], 'isSky': frustum['entry']['isSky'], 'mainViewport': frustum['entry']['mainViewport'],
            'zone': frustum['entry']['scene']['zone'], 'eyeHex': scene_field_hex(scene_bytes, layout[SCENE_EYE_NAME], EYE_BYTES),
            **{f'{name[0].lower()}{name[1:]}Hex': scene_field_hex(scene_bytes, layout[name], MATRIX_BYTES) for name in SCENE_MATRIX_NAMES},
            'planeCount': output['count'], 'planesHex': planes_hex}


def construction_fixture(fixture):
    return {'scenario': fixture['scenario'], 'eye': fixture['sceneEye'], 'worldToScreen': fixture['worldToScreen'], 'screenToWorld': fixture['screenToWorld'],
            'planeCount': fixture['numPlanes'], 'determinant': fixture['trace']['determinant'],
            'corners': [row['output'] for row in fixture['trace']['deproject']], 'planes': fixture['planes']}


def sphere_fixture(fixture):
    return {'scene': fixture['sceneType'], 'nodeIndex': fixture['nodeIndex'], 'sphereHex': fixture['sphereBytesHex'],
            'sseFlags': fixture['native']['1']['result'], 'x87Flags': fixture['native']['0']['result'],
            'points': [{'positionHex': point['f32BytesHex'],
                        'sseDistancesHex': [row['f32BytesHex'] for row in sorted(point['distancesByRoute']['1'], key=lambda row: row['planeIndex'])]}
                       for point in fixture['points']]}


def ordered_draw(draw):
    return {'route': draw['route'], 'material': draw['material'], 'section': draw['section'], 'nodeIndices': draw['nodeIndices']}


def queue_fixture(order_answer, scenario):
    fixture = single(order_answer['fixtures'], lambda row: row['scenario'] == scenario, f'RM-24 fixture {scenario}')
    return {key: value for key, value in fixture.items() if key != 'output'} | {'output': fixture['output']}


def shared_sky_visibility_fixtures(nodes_answer, frustum_answer, order_answer):
    inputs = frustum_answer['construction']['constructorInputs']
    trigger = nodes_answer['liveGates']['firstTrigger']
    return {'schemaVersion': 1, 'kind': 'shared-sky-visibility-fixtures',
            'sources': {'sharedSkyNodes': SHARED_SKY_NODES_SHA256, 'viewFrustum': VIEW_FRUSTUM_SHA256, 'skyDrawOrder': SKY_DRAW_ORDER_SHA256},
            'pose': {'cameraPosition': inputs['root']['cameraPosition'], 'rotation': inputs['root']['rotation'],
                     'horizontalFieldOfViewDegrees': inputs['root']['horizontalFOV'], 'viewport': inputs['root']['viewport'],
                     'skyLocation': inputs['sky']['location'], 'skyZone': nodes_answer['skyScene']['scene']['zone']},
            'frusta': [frustum_record(frustum_answer, frustum) for frustum in frustum_answer['liveValues']['allFrusta']],
            'constructionFixtures': [construction_fixture(fixture) for fixture in frustum_answer['nativeConstructionFixtures']],
            'sphereFixtures': [sphere_fixture(fixture) for fixture in frustum_answer['fixtures']],
            'submittedNodes': sorted(row['nodeIndex'] for row in nodes_answer['submittedNodes']),
            'submittedSurfaceCount': len({row['surfaceIndex'] for row in nodes_answer['submittedNodes']}),
            'orderedDraws': [ordered_draw(draw) for draw in order_answer['orderedDraws']],
            'queueFixtures': [queue_fixture(order_answer, scenario) for scenario in QUEUE_FIXTURE_SCENARIOS],
            'firstTrigger': {field: trigger[field] for field in KEPT_TRIGGER_FIELDS},
            'levelTail': {'packageVersion': nodes_answer['level']['packageVersion'], 'licenseeVersion': nodes_answer['level']['licenseeVersion'],
                          'claim': single(nodes_answer['claims'], lambda row: row['id'] == 'RM22-LEVEL-TAIL-LAYOUT', 'RM-22 tail claim')['statement']}}


def json_document_bytes(document):
    return (json.dumps(document, indent=1, ensure_ascii=True) + '\n').encode('utf-8')


def export_shared_sky_visibility_fixtures(nodes_path, frustum_path, frustum_manifest_path, order_path, order_manifest_path, verified_order_path,
                                          output_directory=DEFAULT_OUTPUT_DIRECTORY, project_root=REPOSITORY_ROOT):
    output = require_output_directory_inside_fixtures(output_directory)
    nodes_answer = read_pinned_json(nodes_path, SHARED_SKY_NODES_SHA256, 'the RM-22 shared sky nodes answer')
    frustum_answer = read_pinned_json(frustum_path, VIEW_FRUSTUM_SHA256, 'the RM-23 view frustum answer')
    read_pinned_bytes(frustum_manifest_path, VIEW_FRUSTUM_MANIFEST_SHA256, 'the RM-23 manifest')
    order_answer = read_pinned_json(order_path, SKY_DRAW_ORDER_SHA256, 'the RM-24 sky draw order answer')
    read_pinned_bytes(order_manifest_path, SKY_DRAW_ORDER_MANIFEST_SHA256, 'the RM-24 manifest')
    verified_order_text = read_pinned_bytes(verified_order_path, VERIFIED_SKY_DRAW_ORDER_SHA256, 'the verified RM-24 draw order').decode('utf-8')
    fixtures = json_document_bytes(shared_sky_visibility_fixtures(nodes_answer, frustum_answer, order_answer))
    rules = json_document_bytes(shared_sky_visibility_rules(nodes_answer, frustum_answer, order_answer, verified_order_text))
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(fixtures)
    (Path(project_root) / RULES_RELATIVE_PATH).write_bytes(rules)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(fixtures).hexdigest(), RULES_RELATIVE_PATH: hashlib.sha256(rules).hexdigest()}


def pinned_bundle_file(bundle_folder, manifest, name):
    pin = manifest['files'].get(name)
    require(pin is not None, f'the shared sky bundle manifest pins no {name}')
    return read_pinned_bytes(Path(bundle_folder) / name, pin['sha256'], f'the shared sky bundle {name}')


def staged_material_programs(store_root, snapshot):
    programs, listing = {}, []
    for material in snapshot['materials']:
        pin = material['program']
        require(pin is not None, f'the shared sky material {material["root"]} has no staged program')
        file_name = f'{pin["programSha256"]}.json'
        programs[file_name] = read_pinned_bytes(Path(store_root) / pin['directory'] / PROGRAM_FILE_NAME, pin['programSha256'],
                                                f'the shared sky program of {material["root"]}')
        listing.append({'root': material['root'], 'program': file_name})
    return programs, json_document_bytes({'kind': 'shared-sky-material-programs', 'materials': listing})


def export_staged_sky_visibility(bundle_manifest_path, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(Path(output_directory) / STAGED_SKY_VISIBILITY_FOLDER)
    manifest_path = Path(bundle_manifest_path)
    manifest = json.loads(manifest_path.read_bytes())
    require(manifest.get('kind') == 'native-shared-sky-bundle', f'{manifest_path} is not a shared sky bundle manifest')
    files = {name: pinned_bundle_file(manifest_path.parent, manifest, name) for name in STAGED_SKY_VISIBILITY_FILES}
    snapshot = json.loads(pinned_bundle_file(manifest_path.parent, manifest, STAGED_SKY_SNAPSHOT_NAME))
    programs, listing = staged_material_programs(manifest_path.parents[2], snapshot)
    files[STAGED_MATERIAL_PROGRAMS_LISTING_NAME] = listing
    files.update({f'{STAGED_MATERIAL_PROGRAMS_FOLDER}/{name}': payload for name, payload in programs.items()})
    (output / STAGED_MATERIAL_PROGRAMS_FOLDER).mkdir(parents=True, exist_ok=True)
    for name, payload in files.items():
        (output / name).write_bytes(payload)
    return {f'{STAGED_SKY_VISIBILITY_FOLDER}/{name}': hashlib.sha256(payload).hexdigest() for name, payload in files.items()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-22, RM-23 and RM-24 shared sky visibility rules recipe, with the RequiresSorting class '
                                                 'rules of the verified RM-24 replay, and the frustum, node and draw order fixtures into '
                                                 'tests/fixtures/environment, or copy the staged skylevel visibility payload of a converted shared sky '
                                                 'bundle there.')
    parser.add_argument('--staged-sky-bundle-manifest')
    known, _ = parser.parse_known_args(arguments)
    if known.staged_sky_bundle_manifest is not None:
        try:
            print(json.dumps(export_staged_sky_visibility(known.staged_sky_bundle_manifest), indent=2))
        except (OSError, ValueError, KeyError) as error:
            print(f'{type(error).__name__}: {error}', file=sys.stderr)
            return 1
        return 0
    parser.add_argument('--shared-sky-nodes', required=True)
    parser.add_argument('--view-frustum', required=True)
    parser.add_argument('--view-frustum-manifest', required=True)
    parser.add_argument('--sky-draw-order', required=True)
    parser.add_argument('--sky-draw-order-manifest', required=True)
    parser.add_argument('--verified-sky-draw-order', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_shared_sky_visibility_fixtures(options.shared_sky_nodes, options.view_frustum, options.view_frustum_manifest,
                                                        options.sky_draw_order, options.sky_draw_order_manifest, options.verified_sky_draw_order,
                                                        options.output_directory)
    except (OSError, ValueError, KeyError) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
