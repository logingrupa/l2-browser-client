"""Read-only, source-hash-specific Musveren weight research probe.

This is not a production skeletal-package parser. Its fixed offsets were
independently located by TLazyArray end/count boundaries and verified against
four consecutive typed arrays, index bounds, face counts and all 1,591 exported
LOD0 vertices. Unknown source bytes are rejected before those offsets are used.

Example: python scripts/audit_musveren_weights.py --client <staged-client>
    --asset-directory <content-addressed-asset-directory> --output <report.json>
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

from native_catalog.ue2 import Package, Reader
from reference_client_guard import require_reference_client

EXPECTED_SOURCE = '157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9'
MESH = 'LineageMonsters.field_stalker_m00'
SOURCE_REVISION = 'a0bfb468d42be831b126632fd8a0ae6b3614f981'
RECORDED_REVIEWED_FORMAT_SOURCE_PINS = {
    'Unreal/UnrealMesh/UnMesh2.h': '8557058200be31a6bd133e0a9bbd912b06360475dd10f7fcf085f311eb38dfcb',
    'Unreal/UnrealMesh/UnMesh2.cpp': 'c1c2778392b39aad168fe7a31893ea9f64b90e34945868d00b7bd948b373df46',
    'Unreal/Mesh/SkeletalMesh.cpp': 'e89dedb27660c014c78e27fada0841cf12536ade578afd44be201e34fea25517',
    'Exporters/ExportGLTF.cpp': '299f649d1d037b173fd150063f80653767ff512ee58e00802875b34d60a45e2c',
}
LOD_OFFSETS = (93356252, 93541284, 93666828, 93732662)
BONE_FLAGS_FORMAT = 'I'
JOINT_QUATERNION_POSITION_LENGTH_AND_SIZE_BYTES = 44


def require(condition, message):
    if not condition:
        raise ValueError(message)


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def source_package(client):
    path = require_reference_client(client).require_equal_file('animations/LineageMonsters.ukx')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == EXPECTED_SOURCE, 'Research probe requires the exact reviewed LineageMonsters.ukx source hash')
    return path, Package(raw, path.name)


def source_bones(package, end):
    reader = Reader(package.data, 93297913, end)
    require(reader.count() == 49, 'Native bone count differs')
    bones = []
    for _ in range(49):
        name = package.name(reader.compact())
        reader.number(BONE_FLAGS_FORMAT)
        reader.take(JOINT_QUATERNION_POSITION_LENGTH_AND_SIZE_BYTES)
        children, parent = reader.number('i'), reader.number('i')
        require(0 <= parent < 49 and 0 <= children < 49, 'Native bone hierarchy exceeds bounds')
        bones.append({'name': name, 'parent': parent})
    require(reader.position == 93300756, 'Native bone array end differs')
    require(len({bone['name'] for bone in bones}) == 49, 'Native bone names are ambiguous')
    return bones


def source_arrays(package, end, offset):
    reader = Reader(package.data, offset, end)
    result = []
    for kind, fmt in [('influences', 'fHH'), ('wedges', 'Hff'), ('faces', '4H'), ('points', '3f')]:
        start = reader.position
        limit = reader.number('i')
        count = reader.count(100000)
        data_offset = reader.position
        data = reader.take(count * struct.calcsize('<' + fmt))
        require(reader.position == limit, 'Native lazy-array end differs: ' + kind)
        result.append({'kind': kind, 'offset': start, 'dataOffset': data_offset, 'count': count,
                       'end': limit, 'sha256': hashlib.sha256(data).hexdigest(),
                       'values': list(struct.iter_unpack('<' + fmt, data))})
    influences, wedges, faces, points = [entry['values'] for entry in result]
    require(all(math.isfinite(weight) and 0 <= weight <= 1 and point < len(points) and bone < 49 for weight, point, bone in influences), 'Invalid native influence')
    require(all(point < len(points) and math.isfinite(u) and math.isfinite(v) for point, u, v in wedges), 'Invalid native wedge')
    require(all(max(a, b, c) < len(wedges) and material < 2 for a, b, c, material in faces), 'Invalid native face')
    require(all(math.isfinite(value) for row in points for value in row), 'Invalid native point')
    return result


def umodel_convert_wedges_and_finalize_mesh_packed_weights(influences):
    require(1 <= len(influences) <= 4, 'Native influence count is outside the reviewed range')
    entries = [[bone, round(f32(weight * 255))] for bone, weight in influences]
    cleanup, duplicate, zeros = False, False, 0
    for i, entry in enumerate(entries):
        if entry[1] == 0:
            cleanup = True
            zeros += 1
            continue
        for k in range(i):
            if entries[k][0] == entry[0]:
                entry[1] = min(255, entry[1] + entries[k][1])
                entries[k][1] = 0
                cleanup = duplicate = True
    entries = [entry for entry in entries if entry[1] != 0]
    total = sum(weight for _, weight in entries)
    renormalized = total != 255
    require(total > 0, 'Packed native weights have a zero sum')
    if renormalized:
        scale = f32(255 / total)
        for entry in entries:
            entry[1] = round(f32(entry[1] * scale))
        entries[0][1] += 255 - sum(entry[1] for entry in entries)
    require(sum(entry[1] for entry in entries) == 255, 'Replayed packed weights do not sum to 255')
    return entries, {'cleanup': cleanup, 'duplicate': duplicate, 'zeroInfluences': zeros,
                     'renormalized': renormalized, 'sumBeforeRenormalization': total}


def audit_lods(package, end):
    lods, reports = [], []
    for lod, offset in enumerate(LOD_OFFSETS):
        records = source_arrays(package, end, offset)
        influences, wedges, faces, points = [entry['values'] for entry in records]
        by_point = defaultdict(list)
        for weight, point, bone in influences:
            by_point[point].append((bone, weight))
        require(set(by_point) == set(range(len(points))), 'Native influences do not cover every point')
        require(max(len(entries) for entries in by_point.values()) <= 4, 'Native point has more than four influences')
        sums = [sum(weight for _, weight in by_point[point]) for point in range(len(points))]
        counts, max_error, max_l1 = Counter(), 0, 0
        changed_points, merged_points, renormalized_points = set(), set(), set()
        max_detail, converted = None, {}
        for wedge, (point, u, v) in enumerate(wedges):
            entries, info = umodel_convert_wedges_and_finalize_mesh_packed_weights(by_point[point])
            converted[wedge] = entries
            counts.update(key for key in ('cleanup', 'duplicate', 'renormalized') if info[key])
            counts['zeroInfluencesRemoved'] += info['zeroInfluences']
            source = defaultdict(float)
            for bone, weight in by_point[point]:
                source[bone] += weight
            target = {bone: weight / 255 for bone, weight in entries}
            error = max(abs(source[bone] - target.get(bone, 0)) for bone in source)
            l1 = sum(abs(source[bone] - target.get(bone, 0)) for bone in source)
            if error > 0:
                counts['changedFromSourceFloat'] += 1
                changed_points.add(point)
            if error > 1e-6:
                counts['changedByMoreThanOneMillionth'] += 1
            if info['duplicate']:
                merged_points.add(point)
            if info['renormalized']:
                renormalized_points.add(point)
            if error > max_error:
                max_error = error
                max_detail = {'wedge': wedge, 'point': point, 'sourceWeights': dict(source),
                              'exportedWeights': target, 'absoluteError': error}
            max_l1 = max(max_l1, l1)
        reports.append({'lod': lod, 'arrays': [{k: v for k, v in row.items() if k != 'values'} for row in records],
                        'points': len(points), 'wedges': len(wedges), 'faces': len(faces),
                        'sourceWeightSumMin': min(sums), 'sourceWeightSumMax': max(sums),
                        'maxSourceSumDeviationFromOne': max(abs(value - 1) for value in sums),
                        'maxInfluences': max(len(entries) for entries in by_point.values()),
                        'counts': dict(counts), 'maxAbsoluteWeightChange': max_error,
                        'uniqueSourcePoints': {'changedWeights': len(changed_points), 'duplicateInfluenceMerge': len(merged_points), 'packedWeightRenormalization': len(renormalized_points)},
                        'maxPerVertexWeightL1Change': max_l1, 'largestChange': max_detail})
        lods.append((by_point, wedges, faces, points, converted))
    return lods, reports


def read_gltf(path):
    document = json.loads(path.read_text(encoding='utf-8'))
    buffers, pins = [], {path.name: hashlib.sha256(path.read_bytes()).hexdigest()}
    for entry in document['buffers']:
        file = (path.parent / entry['uri']).resolve(strict=True)
        require(file.is_relative_to(path.parent.resolve()), 'glTF buffer escapes evidence directory')
        data = file.read_bytes()
        require(len(data) == entry['byteLength'], 'glTF buffer length differs')
        buffers.append(data)
        pins[file.relative_to(path.parent).as_posix()] = hashlib.sha256(data).hexdigest()
    return document, buffers, pins


def accessor(document, buffers, index):
    access = document['accessors'][index]
    view = document['bufferViews'][access['bufferView']]
    component = {5126: 'f', 5123: 'H', 5121: 'B'}[access['componentType']]
    width = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[access['type']]
    size = struct.calcsize('<' + component * width)
    data = buffers[view['buffer']]
    local = access.get('byteOffset', 0)
    offset = view.get('byteOffset', 0) + local
    stride, count = view.get('byteStride', size), access['count']
    require(0 < count <= 100000 and stride >= size and local >= 0 and offset >= 0, 'Invalid bounded glTF accessor')
    require(local + (count - 1) * stride + size <= view['byteLength'], 'glTF accessor exceeds its buffer view')
    require(offset + (count - 1) * stride + size <= len(data), 'glTF accessor exceeds its buffer')
    return [struct.unpack_from('<' + component * width, data, offset + row * stride) for row in range(count)]


def audit(client, asset_directory):
    native_path, package = source_package(client)
    asset_directory = Path(asset_directory).resolve(strict=True)
    asset = json.loads((asset_directory / 'asset.json').read_text(encoding='utf-8'))
    require(asset.get('source', {}).get('object') == MESH and asset['source']['sha256'] == EXPECTED_SOURCE, 'Selected asset does not cite the reviewed native Musveren source')
    mesh = next(item for item in package.exports if item['object'] == MESH)
    end = mesh['offset'] + mesh['size']
    bones = source_bones(package, end)
    lods, reports = audit_lods(package, end)
    gltf_path = asset_directory / 'evidence/export/LineageMonsters/field_stalker_m00.gltf'
    document, buffers, export_pins = read_gltf(gltf_path)
    native, wedges, faces, points, converted = lods[0]
    source_lookup = defaultdict(list)
    for i, (point, u, v) in enumerate(wedges):
        position = tuple(f32(points[point][axis] * f32(.01)) for axis in (0, 2, 1))
        source_lookup[(*position, u, v)].append(i)
    joint_names = [document['nodes'][index]['name'] for index in document['skins'][0]['joints']]
    matched, source_wedges = 0, set()
    require(len(document['meshes']) == 1 and len(joint_names) == 49, 'Export mesh/rig layout differs')
    for primitive in document['meshes'][0]['primitives']:
        attrs = primitive['attributes']
        weight_accessor = document['accessors'][attrs['WEIGHTS_0']]
        require(weight_accessor['componentType'] == 5121 and weight_accessor.get('normalized') is True, 'Probe expects the reviewed normalized-byte weight derivative')
        columns = [accessor(document, buffers, attrs[key]) for key in ('POSITION', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')]
        require(len({len(column) for column in columns}) == 1, 'Export attribute counts differ')
        for position, uv, joints, weights in zip(*columns):
            candidates = source_lookup[(*position, *uv)]
            require(candidates, 'No bit-exact native point/UV match for an exported vertex')
            expected = [{bones[bone]['name']: weight for bone, weight in converted[index]} for index in candidates]
            require(all(0 <= joint < len(joint_names) for joint in joints), 'Export joint index exceeds source rig')
            actual = {joint_names[joint]: weight for joint, weight in zip(joints, weights) if weight}
            require(actual in expected, 'Export weight/bone differs from independently replayed packing')
            require(all(entry == expected[0] for entry in expected), 'Ambiguous native point/UV candidates have different influences')
            source_wedges.update(candidates)
            matched += 1
    require(matched == len(wedges) == len(source_wedges) == 1591, 'Probe did not compare all 1,591 native/exported wedges')
    require(sum(row['counts'].get('cleanup', 0) for row in reports) == 109, 'Observed cleanup count differs from retained UModel evidence')
    return {'schemaVersion': 1, 'nativeSourceSha256': EXPECTED_SOURCE, 'nativeSourcePath': str(native_path), 'mesh': MESH,
            'meshExportOffset': mesh['offset'], 'meshExportBytes': mesh['size'],
            'boneArrayOffset': 93297913, 'boneArrayEnd': 93300756,
            'formatSourceRevision': SOURCE_REVISION, 'formatSourcePins': RECORDED_REVIEWED_FORMAT_SOURCE_PINS,
            'probeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'probeScope': 'Exact source-hash-specific bounded lazy-array research probe, not a production geometry decoder.',
            'lods': reports,
            'exportComparison': {'gltf': str(gltf_path), 'filePins': export_pins, 'sourceWedgesCompared': matched,
                                 'allExportedWeightsExactlyMatchAuditedPacking': True,
                                 'positionAndUVMatching': 'bit-exact after float32 source-to-glTF coordinate conversion',
                                 'boneCorrespondence': 'original source bone names, independent of sorted exported indices'},
            'finding': 'UModel NumFixedVerts=109 counts zero-byte/duplicate-influence cleanup across all four LODs. It does not count all vertices whose packed weights are renormalized. ExportGLTF stores normalized UNSIGNED_BYTE weights, so native float influence precision is not retained.',
            'smallestFollowup': 'A source-hash-guarded native influence reader plus wedge/bone mapping can replace only GLB WEIGHTS_0 with float32 source weights, preserving original float rows as a sidecar. Audit how the native runtime handles tiny source sum deviations before choosing normalization; do not infer it from this UModel export.',
            'limits': ['No source or converter modified. No native rendered deformation comparison performed.',
                       'Four arrays were read directly from pinned decrypted source bytes with exact boundaries and cross-checked against export geometry; the surrounding skeletal serializer is not a general production adapter.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--asset-directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require_reference_client(args.client)
    output = args.output.resolve()
    require(output.suffix.lower() == '.json', 'Audit output must be a JSON report')
    for source in (args.client, args.asset_directory, Path(__file__).parent):
        require(not output.is_relative_to(source.resolve()), 'Read-only audit output must be outside source, asset and script directories')
    report = audit(args.client, args.asset_directory)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'report': str(output), 'matchedExportVertices': report['exportComparison']['sourceWedgesCompared'],
                      'lod0ChangedWeightVectors': report['lods'][0]['counts']['changedFromSourceFloat'],
                      'lod0MaxAbsoluteWeightChange': report['lods'][0]['maxAbsoluteWeightChange']}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, IndexError, StopIteration, struct.error) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        raise SystemExit(1)
