from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
from pathlib import PureWindowsPath

from native_assets_lib.class_defaults import ReferenceClientClassScripts
from world.export_day_night_fixtures import DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures
from world.light_actors import read_static_mesh_light_list
from world.map_actor_properties import TRANSFORMS, actor_properties, decode_property, explicit_properties
from world.raw_map_step import read_tile_map_lock_record, tile_map_path
from world.static_mesh_light_list_fields import static_mesh_light_list_fields
from world.static_placement import ClassDefaults
from world.tile_chunk_plan import read_locked_map_package

RM19_FIXTURE_INPUTS_SHA256 = '563a54e6a1fc99862eebf24f57a7d732fb4d16ea29f80466d416081b30a0b1e1'
RM19_INTEGRATED_FIXTURES_SHA256 = '430158ac39b6520384f8fd4bc347b8279c27fc5b2036b4caf87fd61403d2e198'
RM26_REPORT_SHA256 = 'cc3da3118e1b6c025f528e25f019d23a076d586838e2c840e07b8068cee31b3c'
WALL5383_ADDENDUM_SHA256 = '403c8581b65c0853ad165527e376bfbddc76207a5669f398a1210eddc533a688'
RM27_REPORT_SHA256 = 'f1260d513110d1c8558788924615734d9ee14e3c02f45bc4cb4196117baa622a'
FIXTURES_OUTPUT_NAME = 'static-mesh-light-gate-fixtures.json'
LIGHT_CACHE_FLAG_FIELDS = ('bDynamicLight', 'bLightChanged', 'bDeleteMe')
AUTHORED_PROVENANCE = 'map-property-tag'
CLASS_DEFAULT_PROVENANCE = 'package-class-default'
MAP_PACKAGE_FOLDER = 'maps'
MAP_PACKAGE_SUFFIX = '.unr'
EXPECTED_RM26_SAMPLE_COUNT = 7
EXPECTED_RM27_VERTEX_COUNT = 3


def pinned_source(file, sha256):
    return {'file': file, 'sha256': sha256}


def light_cache_flag_defaults(fixture_inputs):
    defaults = {}
    for record in [*fixture_inputs['lights'], {**fixture_inputs['sun'], 'class': 'Engine.NMovableSunLight'}]:
        effective = record['effective']
        for field in LIGHT_CACHE_FLAG_FIELDS:
            if effective[field]['source'] != CLASS_DEFAULT_PROVENANCE:
                continue
            known = defaults.setdefault(record['class'], {}).setdefault(field, effective[field]['value'])
            require(known == effective[field]['value'], f'RM-19 lists two {record["class"]} defaults for {field}')
    return defaults


def rm19_light_cache_flag_record(record, actor_class):
    effective = record['effective']
    return {'exportIndex': record['exportIndex'], 'object': record['object'], 'actorClass': actor_class,
            'fields': [{'field': field, 'provenance': effective[field]['source'], 'value': effective[field]['value']} for field in LIGHT_CACHE_FLAG_FIELDS]}


def rm19_light_cache_flags(fixture_inputs, integrated_fixtures):
    require(integrated_fixtures.get('passed') is True, 'the RM-19 integrated fixtures did not pass')
    referenced = sorted({int(light) for fixture in integrated_fixtures['fixtures'] for light in fixture['ordinaryLightCaches']})
    lights_by_export_index = {record['exportIndex']: record for record in fixture_inputs['lights']}
    missing = [light for light in referenced if light not in lights_by_export_index]
    require(not missing, f'RM-19 fixture inputs hold no light record for {missing}')
    sun = fixture_inputs['sun']
    return ([rm19_light_cache_flag_record(sun, 'Engine.NMovableSunLight')]
            + [rm19_light_cache_flag_record(lights_by_export_index[light], lights_by_export_index[light]['class']) for light in referenced])


def is_map_package_source(source):
    path = PureWindowsPath(source['file'])
    return path.parent.name.casefold() == MAP_PACKAGE_FOLDER and path.suffix.casefold() == MAP_PACKAGE_SUFFIX


def rm26_map_source(report):
    matches = [source for source in report['sources'] if is_map_package_source(source)]
    require(len(matches) == 1, f'the RM-26 report pins {len(matches)} map packages')
    return PureWindowsPath(matches[0]['file']).stem, matches[0]['fileSha256']


def live_receiver(sample, sun_affect_field):
    return {'exportIndex': sample['exportIndex'], 'instanceExportIndex': sample['instanceExportIndex'], 'mesh': sample['mesh'],
            'bSunAffect': sample[sun_affect_field], 'ambientBGRA': sample['ambientBGRA'],
            'vertices': [{'vertexIndex': vertex['vertexIndex'], 'meshPosition': vertex['meshPosition'], 'meshNormal': vertex['meshNormal'], 'color0BGRA': vertex['color0BGRA']}
                         for vertex in sample['vertices']]}


def rm26_live_receivers(report, addendum):
    samples = report['liveSamples']
    require(len(samples) == EXPECTED_RM26_SAMPLE_COUNT, f'the RM-26 report holds {len(samples)} live samples, not {EXPECTED_RM26_SAMPLE_COUNT}')
    require(addendum['baseReport']['fileSha256'] == RM26_REPORT_SHA256, 'the wall5383 addendum extends another RM-26 report')
    wall_frames = [live_receiver(frame, 'bSunAffect') for frame in addendum['fixtures']]
    require(len(wall_frames) > 0 and all(frame == wall_frames[0] for frame in wall_frames), 'the wall5383 frames disagree on the receiver colours')
    return [live_receiver(sample, 'bSunAffectBit') for sample in samples] + [wall_frames[0]]


def light_entry_rows(entries):
    return [{'light': entry.light_reference, 'maskHex': entry.visibility_bits.hex(), 'applied': entry.applied} for entry in entries]


def addendum_entry_rows(addendum, kind):
    arrays = [array for array in addendum['packageData']['instance']['arrays'] if array['kind'] == kind]
    require(len(arrays) == 1, f'the wall5383 addendum lists {len(arrays)} {kind} light arrays')
    return [{'light': item['light']['objectIndex'], 'maskHex': item['maskHex'], 'applied': item['applied']} for item in arrays[0]['items']]


def map_light_cache_flags(package, map_file_name, light_reference, class_defaults_by_class):
    export = package.exports[light_reference - 1]
    defaults = class_defaults_by_class.get(export['classObject'])
    require(defaults is not None, f'RM-19 pins no class default flags for {export["classObject"]} (light {light_reference})')
    authored = {prop['name']: prop.get('value') for prop in (decode_property(package, tag, map_file_name) for tag in actor_properties(package, export)[0])
                if prop['name'] in LIGHT_CACHE_FLAG_FIELDS}
    fields = [{'field': field, 'provenance': AUTHORED_PROVENANCE, 'value': authored[field]} if field in authored
              else {'field': field, 'provenance': CLASS_DEFAULT_PROVENANCE, 'value': defaults[field]} for field in LIGHT_CACHE_FLAG_FIELDS]
    return {'exportIndex': light_reference, 'object': export['object'], 'actorClass': export['classObject'], 'fields': fields}


def static_mesh_actor_row(package, map_file_name, actor_export_index):
    export = package.exports[actor_export_index - 1]
    properties = [decode_property(package, tag, map_file_name) for tag in actor_properties(package, export)[0]]
    return {'exportIndex': export['exportIndex'], 'classObject': export['classObject'], 'sourceTransform': explicit_properties(properties, TRANSFORMS)}


def rm26_receivers(package, map_file_name, receivers, addendum, class_defaults, class_defaults_by_class):
    rows = []
    for receiver in receivers:
        light_list = read_static_mesh_light_list(package, receiver['exportIndex'], receiver['instanceExportIndex'])
        (fields,) = static_mesh_light_list_fields(package, [static_mesh_actor_row(package, map_file_name, receiver['exportIndex'])], [light_list], class_defaults)
        require(fields.ordinary_inputs_resolved(), f'static mesh actor {receiver["exportIndex"]} ScaleGlow or LocalToWorld is unresolved')
        ordinary, hourly = light_entry_rows(light_list.scene_lights), light_entry_rows(light_list.environment_lights)
        if receiver['exportIndex'] == addendum['packageData']['actor']['exportIndex']:
            require((ordinary, hourly) == (addendum_entry_rows(addendum, 'ordinary'), addendum_entry_rows(addendum, 'hourly')),
                    'the map light lists of wall5383 differ from the addendum')
        references = sorted({entry['light'] for entry in ordinary + hourly if entry['light'] != 0})
        rows.append({**receiver, 'vertexCount': light_list.color_count, 'scaleGlow': fields.scale_glow, 'localToWorld': list(fields.local_to_world),
                     'ordinaryEntries': ordinary, 'hourlyEntries': hourly,
                     'lights': [map_light_cache_flags(package, map_file_name, reference, class_defaults_by_class) for reference in references]})
    return rows


def rm27_normal_fixture(report):
    fixtures, actor = report['fixtures'], report['actor']
    vertices = fixtures['vertices']
    require(len(vertices) == EXPECTED_RM27_VERTEX_COUNT, f'the RM-27 report holds {len(vertices)} vertex fixtures, not {EXPECTED_RM27_VERTEX_COUNT}')
    return {'exportIndex': actor['exportIndex'], 'instanceExportIndex': actor['instanceExport'], 'mesh': actor['mesh'], 'localToWorld': report['localToWorld']['f32'],
            'vertices': [{'vertex': vertex['vertex'], **{name: vertex[name]['f32'] for name in ('localPosition', 'localNormal', 'worldPosition', 'worldNormal')}}
                         for vertex in vertices]}


def static_mesh_light_gate_fixtures_document(fixture_inputs, integrated_fixtures, report, addendum, normal_report, package, class_defaults):
    map_tile, map_sha256 = rm26_map_source(report)
    map_path = tile_map_path(map_tile)
    require(package.source_hash == map_sha256, f'{map_path} sha256 {package.source_hash} differs from the RM-26 pin {map_sha256}')
    class_defaults_by_class = light_cache_flag_defaults(fixture_inputs)
    return {'schemaVersion': 1, 'kind': 'static-mesh-light-gate-fixtures',
            'source': {'rm19FixtureInputs': pinned_source('20261113-roadmap/ordinary-static-lighting-rm19/data/fixture-inputs.json', RM19_FIXTURE_INPUTS_SHA256),
                       'rm19IntegratedFixtures': pinned_source('20261113-roadmap/ordinary-static-lighting-rm19/rebuild/integrated-native-fixtures.json',
                                                               RM19_INTEGRATED_FIXTURES_SHA256),
                       'rm26Report': pinned_source('20261113-roadmap/static-mesh-lod.json', RM26_REPORT_SHA256),
                       'rm26Map': pinned_source(map_path, map_sha256),
                       'wall5383Addendum': pinned_source('20261113-roadmap/static-mesh-lod-wall5383.json', WALL5383_ADDENDUM_SHA256),
                       'rm27Report': pinned_source('20261113-roadmap/static-mesh-normal-transform.json', RM27_REPORT_SHA256)},
            'rm19LightCacheFlags': rm19_light_cache_flags(fixture_inputs, integrated_fixtures),
            'rm26Receivers': rm26_receivers(package, PureWindowsPath(map_path).name, rm26_live_receivers(report, addendum), addendum, class_defaults, class_defaults_by_class),
            'rm27Normals': rm27_normal_fixture(normal_report)}


def read_rm26_map_package(client, report):
    map_tile, _ = rm26_map_source(report)
    return read_locked_map_package(Path(client), map_tile, read_tile_map_lock_record(map_tile))


def reference_class_defaults(client, class_default_work_root):
    return ClassDefaults(Path(class_default_work_root), ReferenceClientClassScripts(Path(client)))


def export_static_mesh_light_gate_fixtures(paths, client, class_default_work_root, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    rm26_report = read_pinned_json(paths['rm26Report'], RM26_REPORT_SHA256, 'the RM-26 report')
    document = static_mesh_light_gate_fixtures_document(
        read_pinned_json(paths['rm19FixtureInputs'], RM19_FIXTURE_INPUTS_SHA256, 'the RM-19 fixture inputs'),
        read_pinned_json(paths['rm19IntegratedFixtures'], RM19_INTEGRATED_FIXTURES_SHA256, 'the RM-19 integrated fixtures'),
        rm26_report,
        read_pinned_json(paths['wall5383Addendum'], WALL5383_ADDENDUM_SHA256, 'the wall5383 addendum'),
        read_pinned_json(paths['rm27Report'], RM27_REPORT_SHA256, 'the RM-27 report'),
        read_rm26_map_package(client, rm26_report), reference_class_defaults(client, class_default_work_root))
    data = (json.dumps(document, indent=1, ensure_ascii=True) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the static mesh light cache gate fixtures (RM-19, RM-26, RM-27) into tests/fixtures/environment.')
    for name in ('rm19-fixture-inputs', 'rm19-integrated-fixtures', 'rm26-report', 'wall5383-addendum', 'rm27-report', 'client', 'class-default-work-root'):
        parser.add_argument(f'--{name}', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    paths = {'rm19FixtureInputs': options.rm19_fixture_inputs, 'rm19IntegratedFixtures': options.rm19_integrated_fixtures, 'rm26Report': options.rm26_report,
             'wall5383Addendum': options.wall5383_addendum, 'rm27Report': options.rm27_report}
    try:
        written = export_static_mesh_light_gate_fixtures(paths, options.client, options.class_default_work_root, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
