import copy
import hashlib

from native_catalog.ue2 import FormatError, Reader

STATIC_MATERIAL_PACKAGE_VERSION = 123
STATIC_MESH_CLASS_OBJECT = 'Engine.StaticMesh'
MAX_MATERIALS = 4096
LAYOUT_EVIDENCE = {
    'repository': 'gildor2/UEViewer',
    'revision': 'a0bfb468d42be831b126632fd8a0ae6b3614f981',
    'files': {
        'Unreal/UnrealMesh/UnMesh2.h': '8557058200be31a6bd133e0a9bbd912b06360475dd10f7fcf085f311eb38dfcb',
        'Unreal/UnrealMesh/UnMesh2.cpp': 'c1c2778392b39aad168fe7a31893ea9f64b90e34945868d00b7bd948b373df46',
        'Unreal/UnObject.cpp': '9c8447f35a3fab058879e2547f0cf206a1242826cd727e30994d35b6783a44b2',
    },
    'records': ['UStaticMesh::Materials', 'FStaticMeshMaterial', 'CTypeInfo::SerializeUnrealProps',
                'UStaticMesh::ConvertMesh'],
    'slotRule': 'Native Sections[i] uses Materials[i].Material; source array order is preserved without deduplication.',
    'omissionPolicy': 'Omitted tags stay omitted; no native constructor/default values are synthesized.',
}
STATIC_MATERIAL_REAL_CLIENT_CASES_PATH = 'tests/pipeline/fixtures/static-material-versions.json'
STATIC_MATERIAL_CROSS_CHECKS_PATH = 'tests/fixtures/static-materials/cross-checks.json'
LAYOUT_EVIDENCE_SOURCE = 'LAYOUT_EVIDENCE'
LAYOUT_REVIEWED_LICENSEES = (16, 19, 20, 22, 23, 25, 28, 30, 31)
ELBERA_CROSS_CHECK_TOOL = {
    'tool': 'Elbera l2lib',
    'commit': '12c9656',
    'pins': {'tools/l2lib/ue2package.py': '18fc5bf7b6e5a8758a426a7264b103f34ddbdad6fb9b784319ef7ba6bfe050fe'},
}
BOOL_PROPERTIES = {'EnableCollision', 'EnableCollisionforShadow', 'bNoDynamicShadowCast'}


def layout_reviewed_version_evidence():
    return {'layoutSource': LAYOUT_EVIDENCE_SOURCE,
            'review': 'Original package bytes read against the pinned FStaticMeshMaterial tagged layout',
            'realClientCases': STATIC_MATERIAL_REAL_CLIENT_CASES_PATH}


def cross_checked_version_evidence(package, compared_exports, references_sha256):
    return {'layoutSource': LAYOUT_EVIDENCE_SOURCE,
            'realClientCases': STATIC_MATERIAL_REAL_CLIENT_CASES_PATH,
            'crossCheck': {**copy.deepcopy(ELBERA_CROSS_CHECK_TOOL),
                           'result': {'package': package, 'comparedExports': compared_exports,
                                      'referencesSha256': references_sha256, 'equal': True,
                                      'record': STATIC_MATERIAL_CROSS_CHECKS_PATH}}}


REVIEWED_VERSION_EVIDENCE = {
    **{(STATIC_MATERIAL_PACKAGE_VERSION, licensee): layout_reviewed_version_evidence() for licensee in LAYOUT_REVIEWED_LICENSEES},
    (STATIC_MATERIAL_PACKAGE_VERSION, 12): cross_checked_version_evidence(
        'staticmeshes/cruma_s.usx', 31, '9fdcdc8b31385eec4b0b0d14e9f7da1113fd009a6133e94a6ca3217e09dfedef'),
    (STATIC_MATERIAL_PACKAGE_VERSION, 18): cross_checked_version_evidence(
        'staticmeshes/dion_punish_s.usx', 77, 'ac4eeeb77ecf8ff74ea42e618f8600c7b18a5c1f81dd716f1ece511348b66791'),
    (STATIC_MATERIAL_PACKAGE_VERSION, 0): cross_checked_version_evidence(
        'staticmeshes/L2_Lobby_Classic.usx', 28, '2aba1ab0562bf5d76c53368292a96cd14257555a50d2f3ef8b6f7ee50f10b33e'),
    (STATIC_MATERIAL_PACKAGE_VERSION, 14): cross_checked_version_evidence(
        'staticmeshes/dion_curumadungeon_boss_s.usx', 7, '6582779888b8ed53f7c948d9666de07b139ac614036abc12f6f182fc56ad6579'),
}
REVIEWED_VERSIONS = frozenset(REVIEWED_VERSION_EVIDENCE)


def static_material_layout_unreviewed_reason(package_version, licensee):
    return f'static-material-layout-unreviewed:{package_version}/{licensee}'


def reviewed_versions_text():
    return ', '.join(f'{package_version}/{licensee}' for package_version, licensee in sorted(REVIEWED_VERSIONS))


def require_static_material_format(condition, message):
    if not condition:
        raise FormatError(message)


def source_byte_range_record(package, start, end):
    require_static_material_format(0 <= start <= end <= len(package.data), 'Static material bytes exceed package bounds')
    value = package.data[start:end]
    return {'offset': start, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'hex': value.hex()}


def slot_property_values_keeping_unknown_payloads(tags):
    result = {}
    for tag in tags:
        require_static_material_format(tag['arrayIndex'] is None, 'Static material struct contains an unsupported indexed property')
        name = tag['name']
        require_static_material_format(name not in result, 'Duplicate static material property: ' + name)
        if name in BOOL_PROPERTIES:
            require_static_material_format(tag['type'] == 3 and type(tag.get('value')) is bool,
                                           'Static material boolean has an unexpected type: ' + name)
        result[name] = copy.deepcopy(tag['value']) if tag['status'] == 'decoded' else {
            'unparsedHex': tag['payloadHex'], 'type': tag['type'], 'struct': tag['structName']}
    return result


def package_static_material_version(package):
    return package.summary['version'], package.summary['licenseeVersion']


def require_reviewed_static_material_version(package):
    version = package_static_material_version(package)
    require_static_material_format(version in REVIEWED_VERSIONS,
                                   f'Static material reader supports reviewed versions {reviewed_versions_text()} only, '
                                   f'not {version[0]}/{version[1]}')


def native_static_materials(package, item):
    require_reviewed_static_material_version(package)
    return read_static_material_slots(package, item)


def read_static_material_slots(package, item):
    version = package_static_material_version(package)
    require_static_material_format(item.get('classObject') == STATIC_MESH_CLASS_OBJECT and item.get('className') == 'StaticMesh',
                                   'Native material slots require exact Engine.StaticMesh class')
    tags, tail = package.properties(item)
    materials = [tag for tag in tags if tag['name'] == 'Materials']
    require_static_material_format(len(materials) <= 1, 'Duplicate StaticMesh Materials property')
    source_bytes = package.data[item['offset']:item['offset'] + item['size']]
    result = {
        'source': {'package': package.filename, 'packageSha256': package.source_hash,
                   'object': item['object'], 'exportIndex': item['exportIndex'],
                   'sourceOffset': item['offset'], 'sourceBytes': item['size'],
                   'sourceExportSha256': hashlib.sha256(source_bytes).hexdigest()},
        'layout': {'packageVersion': version[0], 'licenseeVersion': version[1],
                   'evidence': copy.deepcopy(LAYOUT_EVIDENCE)},
        'meshPropertyTags': copy.deepcopy(tags),
        'materialsStatus': 'authored' if materials else 'omitted',
        'materialsProperty': copy.deepcopy(materials[0]) if materials else None,
        'slots': [],
    }
    if not materials:
        return result
    tag = materials[0]
    require_static_material_format(tag['type'] == 9 and tag['arrayIndex'] is None,
                                   'StaticMesh Materials must be a scalar ArrayProperty of tagged structs')
    payload = bytes.fromhex(tag['payloadHex'])
    start, end = tag['payloadOffset'], tag['payloadOffset'] + len(payload)
    require_static_material_format(item['offset'] <= start <= end <= tail.position <= item['offset'] + item['size'],
                                   'StaticMesh Materials payload exceeds the native property block')
    require_static_material_format(package.data[start:end] == payload, 'StaticMesh Materials tag bytes differ from source')
    reader = Reader(package.data, start, end)
    count = reader.count(MAX_MATERIALS)
    for slot in range(count):
        begin = reader.position
        slot_tags, after = package.properties({'offset': begin, 'size': end - begin})
        reader.position = after.position
        properties = slot_property_values_keeping_unknown_payloads(slot_tags)
        binding = [entry for entry in slot_tags if entry['name'] == 'Material']
        index, reference, source_class = None, None, None
        status = 'omitted'
        if binding:
            material = binding[0]
            require_static_material_format(material['type'] == 5 and material['status'] == 'decoded',
                                           'Static material reference must be a decoded ObjectProperty')
            index = material['value']['index']
            require_static_material_format(type(index) is int, 'Static material object index must be an integer')
            reference = package.object_name(index)
            require_static_material_format(reference == material['value']['object'],
                                           'Static material identity differs from its native object index')
            if index:
                native_object = package.exports[index - 1] if index > 0 else package.imports[-index - 1]
                source_class = native_object['className']
                status = 'exact-native-object-index'
            else:
                status = 'explicit-null'
        result['slots'].append({'slot': slot, 'sourceReference': reference,
            'nativeObjectIndex': index, 'sourceClass': source_class, 'referenceStatus': status,
            'properties': properties, 'propertyTags': copy.deepcopy(slot_tags),
            'raw': source_byte_range_record(package, begin, reader.position)})
    require_static_material_format(reader.position == end, 'Unconsumed StaticMesh Materials array bytes')
    result['materialsPayload'] = source_byte_range_record(package, start, end)
    return result
