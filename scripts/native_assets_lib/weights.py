"""Restore native float influences without normalizing source weights.

Standard glTF permits neither duplicate positive joints nor the non-unit sums
present in some native Lineage vertex streams. Exact source slots therefore
also travel in custom attributes for this client's explicit runtime adapter.
"""
from collections import defaultdict
import hashlib
import math
import struct

from native_catalog.skeletal import decode_skeletal_source, raw_record, require

NATIVE_WEIGHTS = '_L2_NATIVE_WEIGHTS'
NATIVE_JOINTS = '_L2_NATIVE_JOINTS'
GLTF_WEIGHT_EPSILON_PER_INFLUENCE = 2e-7
GLTF_RULE_EVIDENCE = {
    'package': 'gltf-validator', 'version': '2.0.0-dev.3.10',
    'file': 'gltf_validator.dart.js',
    'sha256': 'b73a7b2d455ac217567725138b46d826a13d7d1bb0c88c15f7c571bfb349298c',
    'rules': ['ACCESSOR_JOINTS_INDEX_DUPLICATE', 'ACCESSOR_WEIGHTS_NON_NORMALIZED'],
    'sumRule': 'Float32 ordered sum, absolute tolerance 2e-7 per positive distinct joint; reviewed eX.dY.',
}


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def _section_map(lod, kind, count, bones):
    indices = [row[0] for row in lod[kind + 'Indices']['values']]
    sections = lod[kind + 'Sections']
    mapping = {}
    for section in sections:
        start, end = section['firstFace'] * 3, (section['firstFace'] + section['numFaces']) * 3
        require(0 <= start <= end <= len(indices), 'Native section triangle range exceeds index array')
        require(all(0 <= bone < bones for bone in section['boneMap']), 'Native section bone map exceeds skeleton')
        for index in indices[start:end]:
            require(index < count, 'Native section index exceeds vertex stream')
            require(index not in mapping or mapping[index] == section, 'Native vertex belongs to conflicting sections')
            mapping[index] = section
    require(set(mapping) == set(range(count)), 'Native vertex stream contains unmapped section vertices')
    return mapping


def _stream_vertices(lod, bones):
    lineage = lod['lineageWedges']['values']
    rigid = lod['rigidVertices']['values']
    require(bool(lineage) != bool(rigid), 'Native restored LOD must have exactly one supported vertex stream')
    result = []
    if lineage:
        sections = _section_map(lod, 'soft', len(lineage), bones)
        for index, row in enumerate(lineage):
            mapped = []
            for bone, weight in zip(row[8:12], row[12:16]):
                if bone == 255:
                    require(weight == 0, 'Unassigned native bone has a nonzero weight')
                    mapped.append((0, weight))
                else:
                    require(bone < len(sections[index]['boneMap']), 'Native local bone exceeds section palette')
                    mapped.append((sections[index]['boneMap'][bone], weight))
            result.append({'wedge': index, 'point': None, 'position': row[:3], 'uv': row[6:8], 'influences': mapped})
        return result, 'LineageWedges-with-SoftSections-bone-map'
    sections = _section_map(lod, 'rigid', len(rigid), bones)
    for index, row in enumerate(rigid):
        bone = sections[index]['bone']
        require(bone < bones, 'Native rigid section bone exceeds skeleton')
        result.append({'wedge': index, 'point': None, 'position': row[:3], 'uv': row[6:8], 'influences': [(bone, 1.0)]})
    return result, 'VertexStream-with-explicit-RigidSections-bone'


def _array_vertices(lod, bones):
    points, wedges = lod['points']['values'], lod['wedges']['values']
    by_point = defaultdict(list)
    for weight, point, bone in lod['influences']['values']:
        require(point < len(points) and bone < bones, 'Native influence exceeds point or bone array')
        by_point[point].append((bone, weight))
    require(all(max(face[:3]) < len(wedges) for face in lod['faces']['values']), 'Native face exceeds wedge array')
    result = []
    for index, (point, u, v) in enumerate(wedges):
        require(point < len(points) and point in by_point, 'Native wedge has no point or influences')
        result.append({'wedge': index, 'point': point, 'position': points[point], 'uv': (u, v), 'influences': by_point[point]})
    return result


def aggregate(influences):
    """Only same-bone addition required by glTF; never rescale or close a sum."""
    exact, rounded = defaultdict(float), {}
    for bone, weight in influences:
        require(math.isfinite(weight) and 0 <= weight <= 1, 'Native influence is negative, non-finite or above one')
        if weight == 0:
            continue
        exact[bone] += weight
        rounded[bone] = f32(rounded.get(bone, 0.0) + weight)
    require(rounded and len(rounded) <= 4, 'Native vertex has no positive weights or more than four unique bones')
    return dict(exact), rounded


def gltf_sum_compatibility(weights):
    # Khronos validator 2.0.0-dev.3.10 eX.dY sums through a Float32Array,
    # allowing 2e-7 per positive distinct joint. This is a format check,
    # not a visual acceptance tolerance and never changes the native values.
    value, active = 0.0, 0
    for weight in weights:
        if weight > 0:
            value = f32(value + weight)
            active += 1
    error = abs(value - 1)
    return {'sum': value, 'positiveInfluences': active, 'absError': error,
            'passed': error <= active * GLTF_WEIGHT_EPSILON_PER_INFLUENCE}


def native_vertices(source):
    bones = len(source['bones'])
    lod = source['lods'][0] if source['lods'] else source['base']
    if lod['wedges']['values']:
        vertices = _array_vertices(lod, bones)
        representation = 'FVertInfluence-with-Wedges-and-Points'
    else:
        require(source['lods'], 'Native base mesh has no supported wedges')
        vertices, representation = _stream_vertices(lod, bones)
    require(vertices, 'Native source mesh has no vertices')
    for vertex in vertices:
        require(1 <= len(vertex['influences']) <= 4, 'Exact native custom attribute supports one to four source influence slots')
        aggregate(vertex['influences'])
    alternatives = {'selectionPolicy': 'Same serialized source representation selected by reviewed UEViewer ConvertMesh/RestoreLineageMesh; native runtime selector semantics are not assumed.',
                    'nativeUseNewWedges': lod.get('useNewWedges'), 'comparedVertices': 0,
                    'differentWeightVertices': 0, 'maxAbsolutePerBoneWeightDifference': 0.0}
    if representation.startswith('FVertInfluence') and source['lods'] and (lod['lineageWedges']['values'] or lod['rigidVertices']['values']):
        other, other_kind = _stream_vertices(lod, bones)
        alternatives['otherRepresentation'] = other_kind
        require(len(other) == len(vertices), 'Native skeletal representations disagree on wedge count')
        for selected, alternate in zip(vertices, other):
            require(selected['position'] == alternate['position'] and tuple(selected['uv']) == tuple(alternate['uv']), 'Native skeletal representations disagree on positions or UVs')
            left, _ = aggregate(selected['influences'])
            right, _ = aggregate(alternate['influences'])
            error = max(abs(left.get(bone, 0) - right.get(bone, 0)) for bone in left.keys() | right.keys())
            alternatives['comparedVertices'] += 1
            alternatives['differentWeightVertices'] += error > 0
            alternatives['maxAbsolutePerBoneWeightDifference'] = max(alternatives['maxAbsolutePerBoneWeightDifference'], error)
        alternatives['selectedWeightSumRange'] = [min(sum(w for _, w in v['influences']) for v in vertices), max(sum(w for _, w in v['influences']) for v in vertices)]
        alternatives['otherWeightSumRange'] = [min(sum(w for _, w in v['influences']) for v in other), max(sum(w for _, w in v['influences']) for v in other)]
    return vertices, representation, alternatives, lod


def _rows(document, index):
    accessor = document.data['accessors'][index]
    require('sparse' not in accessor, 'Sparse exported skin attributes are not supported')
    view = document.data['bufferViews'][accessor['bufferView']]
    formats = {5121: 'B', 5123: 'H', 5126: 'f'}
    dimensions = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    require(accessor['componentType'] in formats and accessor['type'] in dimensions, 'Unsupported exported skin accessor layout')
    fmt = '<' + formats[accessor['componentType']] * dimensions[accessor['type']]
    size = struct.calcsize(fmt)
    stride, count = view.get('byteStride', size), accessor['count']
    local = accessor.get('byteOffset', 0)
    start = view.get('byteOffset', 0) + local
    require(0 < count <= 1_000_000 and local >= 0 and stride >= size, 'Invalid exported skin accessor bounds')
    require(local + (count - 1) * stride + size <= view['byteLength'] and start + (count - 1) * stride + size <= len(document.binary), 'Exported skin accessor exceeds buffer')
    values = [struct.unpack_from(fmt, document.binary, start + index * stride) for index in range(count)]
    require(all(math.isfinite(value) for row in values for value in row), 'Non-finite exported skin attribute')
    return values


def _unsigned_accessor(document, rows):
    require(rows and all(0 <= value <= 65535 for row in rows for value in row), 'Native joint exceeds unsigned-short palette')
    payload = b''.join(struct.pack('<4H', *row) for row in rows)
    offset = document.append(payload)
    views = document.data.setdefault('bufferViews', [])
    views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload), 'target': 34962})
    accessors = document.data.setdefault('accessors', [])
    accessors.append({'bufferView': len(views) - 1, 'componentType': 5123, 'count': len(rows), 'type': 'VEC4'})
    return len(accessors) - 1


def _float_accessor(document, rows):
    index = document.accessor(rows, 4)
    document.data['bufferViews'][document.data['accessors'][index]['bufferView']]['target'] = 34962
    return index


def _range(document, index):
    accessor = document.data['accessors'][index]
    view = document.data['bufferViews'][accessor['bufferView']]
    return {'accessor': index, 'bufferView': accessor['bufferView'], 'byteOffset': view['byteOffset'],
            'byteLength': view['byteLength'], 'componentType': accessor['componentType'], 'count': accessor['count'],
            'sha256': hashlib.sha256(document.binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]).hexdigest()}


def _bone_mapping(data, source):
    """Match authored names and parent paths, preserving native duplicate typos."""
    joints = data['skins'][0]['joints']
    palette = [data['nodes'][joint]['name'] for joint in joints]
    native_cache, export_cache = {}, {}
    parents = {}
    for parent, node in enumerate(data['nodes']):
        for child in node.get('children', []):
            require(child not in parents, 'Exported joint hierarchy has multiple parents')
            parents[child] = parent
    palette_indices = {joint: index for index, joint in enumerate(joints)}
    require(len(palette_indices) == len(joints), 'Exported skin repeats a joint node')
    def native_path(index, visiting):
        require(index not in visiting, 'Native skeleton contains a parent cycle')
        if index not in native_cache:
            bone = source['bones'][index]
            prefix = native_path(bone['parent'], visiting | {index}) if index else ()
            native_cache[index] = (*prefix, bone['name'])
        return native_cache[index]
    def export_path(index, visiting):
        require(index not in visiting, 'Exported skeleton contains a parent cycle')
        if index not in export_cache:
            parent = palette_indices.get(parents.get(joints[index]))
            prefix = export_path(parent, visiting | {index}) if parent is not None else ()
            export_cache[index] = (*prefix, palette[index])
        return export_cache[index]
    native_paths = [native_path(index, set()) for index in range(len(source['bones']))]
    export_paths = [export_path(index, set()) for index in range(len(joints))]
    require(len(set(native_paths)) == len(native_paths) and len(set(export_paths)) == len(export_paths), 'Native/exported name-and-parent bone paths are ambiguous')
    require(set(native_paths) == set(export_paths), 'Exported rig does not match native bone names and hierarchy')
    by_path = {path: index for index, path in enumerate(export_paths)}
    mapping = {index: by_path[path] for index, path in enumerate(native_paths)}
    return palette, mapping, [{'sourceBoneIndex': index, 'paletteIndex': mapping[index], 'name': path[-1], 'parentNamePath': list(path[:-1])} for index, path in enumerate(native_paths)]


def restore_native_weights(document, package, item):
    """Return (report, JSON-ready source sidecar); retain all original buffers.

Call on one exported native part before an actor-level rigid attachment alters
its skin palette. All source/mapping checks finish before adding any accessors.
"""
    source = decode_skeletal_source(package, item)
    vertices, representation, alternatives, selected_lod = native_vertices(source)
    data = document.data
    require(len(data.get('skins', [])) == 1 and len(data.get('meshes', [])) == 1, 'Native weight repair requires one unassembled source mesh and skin')
    palette, source_to_palette, bone_mapping = _bone_mapping(data, source)
    palette_to_source = {palette: source for source, palette in source_to_palette.items()}
    lookup = defaultdict(list)
    for vertex in vertices:
        position = tuple(f32(vertex['position'][axis] * f32(.01)) for axis in (0, 2, 1))
        lookup[(*position, *vertex['uv'])].append(vertex)
    plans, used_source = [], set()
    for primitive_index, primitive in enumerate(data['meshes'][0]['primitives']):
        attributes = primitive['attributes']
        require(NATIVE_WEIGHTS not in attributes and NATIVE_JOINTS not in attributes, 'Native weights were already restored')
        columns = [_rows(document, attributes[key]) for key in ('POSITION', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')]
        require(len({len(column) for column in columns}) == 1, 'Exported vertex attribute counts differ')
        weights_type = data['accessors'][attributes['WEIGHTS_0']]['componentType']
        denominator = {5121: 255, 5123: 65535, 5126: 1}[weights_type]
        if denominator != 1:
            require(data['accessors'][attributes['WEIGHTS_0']].get('normalized') is True, 'Integer export weights are not normalized')
        raw_weights, raw_joints, standard_weights, standard_joints, mappings = [], [], [], [], []
        sums, compatibility, max_before, max_aggregation, duplicate_vertices = [], [], 0.0, 0.0, 0
        for vertex_index, (position, uv, old_joints, old_weights) in enumerate(zip(*columns)):
            candidates = lookup[(*position, *uv)]
            require(candidates, 'Exported vertex has no exact float32 native position/UV match')
            signatures = [tuple((bone, struct.pack('<f', weight)) for bone, weight in v['influences']) for v in candidates]
            require(all(signature == signatures[0] for signature in signatures), 'Ambiguous native vertices have distinct influence slots')
            vertex = candidates[0]
            used_source.update(v['wedge'] for v in candidates)
            mappings.append([v['wedge'] for v in candidates])
            raw = vertex['influences']
            exact, combined = aggregate(raw)
            require(all(joint < len(palette) for joint in old_joints), 'Exported joint index exceeds skin palette')
            source_joints = [source_to_palette[bone] for bone, _ in raw]
            source_weights = [weight for _, weight in raw]
            raw_joints.append(tuple(source_joints + [0] * (4 - len(raw))))
            raw_weights.append(tuple(source_weights + [0.0] * (4 - len(raw))))
            sums.append(sum(source_weights))
            joint_weights = {source_to_palette[bone]: weight for bone, weight in combined.items()}
            ordered = []
            for joint, weight in zip(old_joints, old_weights):
                if weight > 0 and joint in joint_weights and joint not in ordered:
                    ordered.append(joint)
            ordered.extend(joint for joint in joint_weights if joint not in ordered)
            standard_row = tuple([joint_weights[joint] for joint in ordered] + [0.0] * (4 - len(ordered)))
            standard_joints.append(tuple(ordered + [0] * (4 - len(ordered))))
            standard_weights.append(standard_row)
            check = gltf_sum_compatibility(standard_row)
            compatibility.append(check)
            old_by_bone = defaultdict(float)
            for joint, weight in zip(old_joints, old_weights):
                if weight:
                    old_by_bone[palette_to_source[joint]] += weight / denominator
            max_before = max(max_before, max(abs(exact.get(bone, 0) - old_by_bone.get(bone, 0)) for bone in exact.keys() | old_by_bone.keys()))
            max_aggregation = max(max_aggregation, max(abs(exact[bone] - combined[bone]) for bone in exact))
            duplicate_vertices += len([weight for _, weight in raw if weight > 0]) > len(combined)
        compatible = all(row['passed'] for row in compatibility)
        plans.append({'primitive': primitive, 'rawWeights': raw_weights, 'rawJoints': raw_joints,
                      'standardWeights': standard_weights, 'standardJoints': standard_joints, 'oldJoints': columns[2],
                      'report': {'meshIndex': 0, 'primitiveIndex': primitive_index, 'vertexCount': len(raw_weights),
                                 'standardWeightsRestored': compatible, 'nativeRuntimeOverrideRequired': not compatible or duplicate_vertices > 0,
                                 'gltfSumCompatibility': {'passed': compatible, 'tolerancePerPositiveInfluence': GLTF_WEIGHT_EPSILON_PER_INFLUENCE,
                                                          'violatingVertices': [i for i, row in enumerate(compatibility) if not row['passed']],
                                                          'maxAbsError': max(row['absError'] for row in compatibility)},
                                 'sourceWeightSumMin': min(sums), 'sourceWeightSumMax': max(sums),
                                 'duplicateJointVertices': duplicate_vertices, 'maxSameBoneFloat32AggregationError': max_aggregation,
                                 'maxAbsoluteWeightChangeBeforeRestoration': max_before, 'maxCustomAttributeWeightError': 0.0,
                                 'sourceVertexMapping': mappings}})
    original = bytes(document.binary)
    original_length = len(original)
    # No source validation/mapping can fail after this point; only append data
    # and retarget the two skinning attributes. Geometry/bind accessors stay put.
    for plan in plans:
        attributes, report = plan['primitive']['attributes'], plan['report']
        report['originalAttributes'] = {key: attributes[key] for key in ('WEIGHTS_0', 'JOINTS_0')}
        raw_weight_accessor = _float_accessor(document, plan['rawWeights'])
        raw_joint_accessor = _unsigned_accessor(document, plan['rawJoints'])
        attributes[NATIVE_WEIGHTS], attributes[NATIVE_JOINTS] = raw_weight_accessor, raw_joint_accessor
        report['nativeAttributes'] = {'weights': NATIVE_WEIGHTS, 'weightsAccessor': raw_weight_accessor,
                                      'joints': NATIVE_JOINTS, 'jointsAccessor': raw_joint_accessor}
        report['appendedBuffers'] = [_range(document, raw_weight_accessor), _range(document, raw_joint_accessor)]
        if report['standardWeightsRestored']:
            attributes['WEIGHTS_0'] = _float_accessor(document, plan['standardWeights'])
            if plan['standardJoints'] != plan['oldJoints']:
                attributes['JOINTS_0'] = _unsigned_accessor(document, plan['standardJoints'])
            report['appendedBuffers'].append(_range(document, attributes['WEIGHTS_0']))
            if attributes['JOINTS_0'] != report['originalAttributes']['JOINTS_0']:
                report['appendedBuffers'].append(_range(document, attributes['JOINTS_0']))
        report['resultAttributes'] = {key: attributes[key] for key in ('WEIGHTS_0', 'JOINTS_0')}
    require(bytes(document.binary[:original_length]) == original, 'Original mesh buffer bytes changed during source-weight restoration')
    reports = [plan['report'] for plan in plans]
    report = {'schemaVersion': 1, 'sourceObject': item['object'], 'sourceSha256': package.source_hash,
              'selectedSourceRepresentation': representation,
              'nativeWeightSourceSelection': 'float-source-restored-native-weight-source-selection-unverified' if alternatives['differentWeightVertices'] else 'export-source-representation-restored',
              'sourceRepresentations': alternatives,
              'boneMapping': bone_mapping,
              'gltfRuleEvidence': GLTF_RULE_EVIDENCE,
              'mode': 'float32-standard-and-native-attributes' if all(row['standardWeightsRestored'] for row in reports) else 'native-attributes-with-standard-derivative',
              'sourceVertexCount': len(vertices), 'matchedSourceVertices': len(used_source),
              'exportedVertexCount': sum(row['vertexCount'] for row in reports),
              'originalBufferBytes': original_length, 'originalBufferSha256': hashlib.sha256(original).hexdigest(),
              'originalBufferBytesPreserved': True, 'appendedBytes': len(document.binary) - original_length,
              'primitives': reports, 'normalizationApplied': False,
              'limits': ['Custom attributes require the client runtime adapter. Generic glTF viewers use the standard attributes, which can retain the quantized derivative when native sums violate glTF rules.',
                         'Original duplicate influence slots and exact float32 values remain in custom attributes and source sidecar. Standard glTF slots combine same-bone weights in float32 because duplicate positive joint indices are invalid.',
                         'This restores the serialized source selected by the reviewed exporter. It does not establish native runtime selection between redundant skeletal representations or visual parity.']}
    source_arrays = {}
    for key in ('influences', 'wedges', 'points', 'faces', 'lineageWedges', 'rigidVertices', 'softIndices', 'rigidIndices'):
        if key in selected_lod:
            entry = selected_lod[key]
            source_arrays[key] = {**raw_record(package, entry['record']), 'rows': entry['values']}
    sidecar = {'schemaVersion': 1, 'sourceObject': item['object'], 'sourceSha256': package.source_hash,
               'packageVersion': source['packageVersion'], 'licenseeVersion': source['licenseeVersion'],
               'meshVersion': source['meshVersion'], 'layoutEvidence': source['layoutEvidence'],
               'bytesConsumed': source['bytesConsumed'], 'serializedRecords': source['records'],
               'bones': source['bones'], 'rawBoneArray': raw_record(package, source['boneRecord']),
               'attachments': source['attachments'],
               'selectedSourceRepresentation': representation, 'sourceRepresentations': alternatives,
               'nativeUseNewWedges': selected_lod.get('useNewWedges'),
               'softSections': selected_lod.get('softSections'), 'rigidSections': selected_lod.get('rigidSections'),
               'lod0': source_arrays,
               'exportedJointPalette': palette,
               'boneMapping': bone_mapping,
               'primitiveMappings': [{'meshIndex': row['meshIndex'], 'primitiveIndex': row['primitiveIndex'],
                                       'nativeAttributes': row['nativeAttributes'], 'sourceVertexMapping': row['sourceVertexMapping']} for row in reports]}
    return report, sidecar
