from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import struct

from world.export_day_night_fixtures import DEFAULT_OUTPUT_DIRECTORY, read_pinned_json, require, require_output_directory_inside_fixtures

SKY_TEXROTATOR_REPORT_SHA256 = '945cce254c60281ecc885bc838d867c8d1546340319bc11efaf6eaf9a9d5c601'
SKY_TEXROTATOR_MANIFEST_SHA256 = 'd6a2bdcb2c0adfb886a54225be131f03523d8a9d54e4fdf5b29e154c1e0867c3'
REPORT_FILE_NAME = 'sky-texrotator.json'
DELIVERY_FOLDER_NAME = 'sky-texrotator-rm29'
MANIFEST_RELATIVE_PATH = f'{DELIVERY_FOLDER_NAME}/manifest.json'
SINE_TABLE_RELATIVE_PATH = f'{DELIVERY_FOLDER_NAME}/matrix/gmath-sin-cw027f.bin'
CAPTURE_RELATIVE_PATH = f'{DELIVERY_FOLDER_NAME}/live/capture.jsonl'
FIXTURES_OUTPUT_NAME = 'sky-texrotator-fixtures.json'
EXPECTED_FIXTURE_COUNT = 11
FLOAT32_BYTES = 4
FIXTURE_FIELDS = ('mode', 'Rotation', 'timeBytesHex', 'offsets', 'resolvedSize', 'rate', 'amplitude', 'phase', 'effectiveRotation', 'matrixBytesHex')
CAPTURED_REPLAY_FIELDS = ('object', 'captureSequence', 'timeBytesHex', 'resolvedSize', 'matrixBytesHex', 'matchesCapturedOutput')
ROTATOR_MATRIX_EVENT_KIND = 'rotator-matrix'
GET_MATRIX_FUNCTION_ADDRESS = '0x105e0c00'
ROTATOR_COMPONENT_NAMES = ('Pitch', 'Yaw', 'Roll')
SCALAR_FORMAT_BY_LAYOUT_TYPE = {'uint8': '<B', 'uint32': '<I', 'float32': '<f'}
ROTATOR_LAYOUT_TYPE = 'int32 Pitch,Yaw,Roll'
OUTPUT_MATRIX_LAYOUT_TYPE = '16 float32, row-major'
MATRIX_BYTES_HEX_LENGTH = 16 * FLOAT32_BYTES * 2


def manifest_listed_bytes(delivery_root, manifest, relative_path):
    entries = [entry for entry in manifest.get('files', []) if entry.get('file') == relative_path]
    require(len(entries) == 1, f'the RM-29 manifest lists {len(entries)} entries for {relative_path}, not 1')
    data = (Path(delivery_root) / relative_path).read_bytes()
    actual_sha256 = hashlib.sha256(data).hexdigest()
    require(actual_sha256 == entries[0]['sha256'] and len(data) == entries[0]['sizeBytes'],
            f'{relative_path} sha256 {actual_sha256} or size {len(data)} differs from the RM-29 manifest')
    return data


def pinned_delivery(delivery_root):
    manifest = read_pinned_json(Path(delivery_root) / MANIFEST_RELATIVE_PATH, SKY_TEXROTATOR_MANIFEST_SHA256, 'the RM-29 manifest')
    report_data = manifest_listed_bytes(delivery_root, manifest, REPORT_FILE_NAME)
    require(hashlib.sha256(report_data).hexdigest() == SKY_TEXROTATOR_REPORT_SHA256, f'the RM-29 manifest does not pin {REPORT_FILE_NAME} to {SKY_TEXROTATOR_REPORT_SHA256}')
    return manifest, json.loads(report_data.decode('utf-8'))


def kept_fields(record, fields, label):
    missing = [field for field in fields if field not in record]
    require(not missing, f'{label} misses {missing}')
    return {field: record[field] for field in fields}


def native_fixtures(report):
    fixtures = report['matrix']['fixtures']
    require(isinstance(fixtures, list) and len(fixtures) == EXPECTED_FIXTURE_COUNT, f'the RM-29 report must hold {EXPECTED_FIXTURE_COUNT} matrix fixtures')
    kept = [kept_fields(fixture, FIXTURE_FIELDS, f'RM-29 matrix fixture {position}') for position, fixture in enumerate(fixtures)]
    require(all(len(fixture['matrixBytesHex']) == MATRIX_BYTES_HEX_LENGTH for fixture in kept), 'an RM-29 matrix fixture does not hold 16 float32 values')
    return kept


def decoded_layout_field(object_bytes, layout_row):
    offset = int(layout_row['offset'], 16)
    if layout_row['type'] == ROTATOR_LAYOUT_TYPE:
        return dict(zip(ROTATOR_COMPONENT_NAMES, struct.unpack_from('<3i', object_bytes, offset)))
    require(layout_row['type'] in SCALAR_FORMAT_BY_LAYOUT_TYPE, f'the RM-29 layout type {layout_row["type"]} has no decode rule')
    return struct.unpack_from(SCALAR_FORMAT_BY_LAYOUT_TYPE[layout_row['type']], object_bytes, offset)[0]


def decoded_rotator_inputs(object_bytes, layout):
    return {row['name'].split(' ')[0]: decoded_layout_field(object_bytes, row) for row in layout if row['type'] != OUTPUT_MATRIX_LAYOUT_TYPE}


def rotator_matrix_events(capture_data):
    events = [json.loads(line) for line in capture_data.decode('utf-8').splitlines() if line.strip()]
    rotator_events = [event for event in events if event.get('kind') == ROTATOR_MATRIX_EVENT_KIND]
    require(rotator_events, 'the RM-29 capture holds no rotator-matrix events')
    require(all(event['functionVa'] == GET_MATRIX_FUNCTION_ADDRESS for event in rotator_events), f'an RM-29 rotator-matrix event is not from {GET_MATRIX_FUNCTION_ADDRESS}')
    require(all(event['timeBytesHex'] == event['clocks']['timeSecondsBytesHex'] for event in rotator_events),
            'an RM-29 rotator-matrix event time differs from its LevelInfo.TimeSeconds')
    return rotator_events


def captured_rotators(rotator_events, layout, captured_replay):
    groups = {}
    for event in rotator_events:
        inputs = decoded_rotator_inputs(bytes.fromhex(event['objectBytesHex']), layout)
        key = (event['object'], json.dumps(inputs, sort_keys=True), event['timeBytesHex'], event['matrixBytesHex'])
        group = groups.setdefault(key, {'object': event['object'], 'firstCaptureSequence': event['sequence'], 'eventCount': 0,
                                        'timeBytesHex': event['timeBytesHex'], 'timeIsLevelInfoTimeSeconds': True, 'inputs': inputs,
                                        'resolvedSize': None, 'matrixBytesHex': event['matrixBytesHex']})
        group['eventCount'] += 1
    rows = sorted(groups.values(), key=lambda row: row['firstCaptureSequence'])
    for row in rows:
        if row['object'] == captured_replay['object']:
            require(row['timeBytesHex'] == captured_replay['timeBytesHex'] and row['matrixBytesHex'] == captured_replay['matrixBytesHex'],
                    'the RM-29 captured input replay differs from its live capture group')
            row['resolvedSize'] = captured_replay['resolvedSize']
        require(row['resolvedSize'] is not None or (row['inputs']['UOffset'] == 0 and row['inputs']['VOffset'] == 0),
                f'the RM-29 capture of {row["object"]} has a pivot offset but no resolved texture size')
    return rows


def float64_constants(report):
    return [{'name': constant['decodedValues']['name'], 'file': Path(constant['file'].replace('\\', '/')).name, 'fileSha256': constant['fileSha256'],
             'virtualAddress': constant['va'], 'bytesHex': constant['bytesHex'], 'float64': constant['decodedValues']['float64']}
            for constant in report['matrix']['constants']]


def sky_texrotator_fixtures_document(report, sine_table_data, capture_data):
    require(len(sine_table_data) % FLOAT32_BYTES == 0, 'the RM-29 sine table is not a float32 array')
    captured_replay = kept_fields(report['matrix']['capturedInputReplay'], CAPTURED_REPLAY_FIELDS, 'the RM-29 captured input replay')
    require(captured_replay['matchesCapturedOutput'] is True, 'the RM-29 captured input replay does not match the captured output')
    layout = report['matrix']['layout']
    return {'schemaVersion': 1, 'kind': 'sky-texrotator-rm29-fixtures',
            'source': {'report': REPORT_FILE_NAME, 'reportSha256': SKY_TEXROTATOR_REPORT_SHA256, 'manifest': MANIFEST_RELATIVE_PATH,
                       'manifestSha256': SKY_TEXROTATOR_MANIFEST_SHA256, 'question': report['question'],
                       'fixtureMethod': report['matrix']['fixtureMethod'], 'precision': report['matrix']['precision']['fixturePrecision'],
                       'controlWord': report['matrix']['precision']['fixtureControlWord']},
            'objectLayout': layout,
            'sineTable': {'file': SINE_TABLE_RELATIVE_PATH, 'sha256': hashlib.sha256(sine_table_data).hexdigest(), 'entries': len(sine_table_data) // FLOAT32_BYTES},
            'constants': float64_constants(report),
            'capturedRotators': captured_rotators(rotator_matrix_events(capture_data), layout, captured_replay),
            'fixtures': native_fixtures(report)}


def export_sky_texrotator_fixtures(delivery_root, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    manifest, report = pinned_delivery(delivery_root)
    sine_table_data = manifest_listed_bytes(delivery_root, manifest, SINE_TABLE_RELATIVE_PATH)
    capture_data = manifest_listed_bytes(delivery_root, manifest, CAPTURE_RELATIVE_PATH)
    data = (json.dumps(sky_texrotator_fixtures_document(report, sine_table_data, capture_data), indent=1, ensure_ascii=True) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-29 UTexRotator::GetMatrix native fixtures, live captures and constants into tests/fixtures/environment.')
    parser.add_argument('--delivery-root', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        written = export_sky_texrotator_fixtures(options.delivery_root, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
