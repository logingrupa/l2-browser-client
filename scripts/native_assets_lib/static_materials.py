"""Read exact UE2 StaticMesh material slots without exporter name matching.

FStaticMeshMaterial is a tagged struct inside a compact-count ArrayProperty.
Only the reviewed Lineage UE123 variants are accepted. Native material indices,
property tags and complete per-slot bytes remain available to the caller.
"""
import copy
import hashlib

from native_catalog.ue2 import FormatError, Reader


# Exact title variants reviewed against the pinned FStaticMeshMaterial tagged
# layout and original package bytes. New16/22/23/25/31 cases cover20 objects /
#280 slots; this does not enable unreviewed versions or native geometry tails.
REVIEWED_VERSIONS = {(123, version) for version in (16, 19, 20, 22, 23, 25, 28, 30, 31)}
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
BOOL_PROPERTIES = {'EnableCollision', 'EnableCollisionforShadow', 'bNoDynamicShadowCast'}


def _require(condition, message):
    if not condition:
        raise FormatError(message)


def _raw(package, start, end):
    _require(0 <= start <= end <= len(package.data), 'Static material bytes exceed package bounds')
    value = package.data[start:end]
    return {'offset': start, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'hex': value.hex()}


def _properties(tags):
    """Preserve unknown values; a duplicate path is never silently collapsed."""
    result = {}
    for tag in tags:
        _require(tag['arrayIndex'] is None, 'Static material struct contains an unsupported indexed property')
        name = tag['name']
        _require(name not in result, 'Duplicate static material property: ' + name)
        if name in BOOL_PROPERTIES:
            _require(tag['type'] == 3 and type(tag.get('value')) is bool,
                     'Static material boolean has an unexpected type: ' + name)
        result[name] = copy.deepcopy(tag['value']) if tag['status'] == 'decoded' else {
            'unparsedHex': tag['payloadHex'], 'type': tag['type'], 'struct': tag['structName']}
    return result


def native_static_materials(package, item):
    """Return ``slots`` plus exact source/layout/property provenance.

    Each slot has sourceReference, nativeObjectIndex, sourceClass and
    referenceStatus. Explicit null and omitted Material are distinct and
    remain unresolved; neither falls back to a suffix or leaf-name search.
    """
    version = (package.summary['version'], package.summary['licenseeVersion'])
    _require(version in REVIEWED_VERSIONS, 'Static material reader supports reviewed UE123 licensee16/19/20/22/23/25/28/30/31 only')
    _require(item.get('classObject') == 'Engine.StaticMesh' and item.get('className') == 'StaticMesh',
             'Native material slots require exact Engine.StaticMesh class')
    tags, tail = package.properties(item)
    materials = [tag for tag in tags if tag['name'] == 'Materials']
    _require(len(materials) <= 1, 'Duplicate StaticMesh Materials property')
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
    _require(tag['type'] == 9 and tag['arrayIndex'] is None,
             'StaticMesh Materials must be a scalar ArrayProperty of tagged structs')
    payload = bytes.fromhex(tag['payloadHex'])
    start, end = tag['payloadOffset'], tag['payloadOffset'] + len(payload)
    _require(item['offset'] <= start <= end <= tail.position <= item['offset'] + item['size'],
             'StaticMesh Materials payload exceeds the native property block')
    _require(package.data[start:end] == payload, 'StaticMesh Materials tag bytes differ from source')
    reader = Reader(package.data, start, end)
    count = reader.count(MAX_MATERIALS)
    for slot in range(count):
        begin = reader.position
        slot_tags, after = package.properties({'offset': begin, 'size': end - begin})
        reader.position = after.position
        properties = _properties(slot_tags)
        binding = [entry for entry in slot_tags if entry['name'] == 'Material']
        index, reference, source_class = None, None, None
        status = 'omitted'
        if binding:
            material = binding[0]
            _require(material['type'] == 5 and material['status'] == 'decoded',
                     'Static material reference must be a decoded ObjectProperty')
            index = material['value']['index']
            _require(type(index) is int, 'Static material object index must be an integer')
            reference = package.object_name(index)
            _require(reference == material['value']['object'], 'Static material identity differs from its native object index')
            if index:
                native_object = package.exports[index - 1] if index > 0 else package.imports[-index - 1]
                source_class = native_object['className']
                status = 'exact-native-object-index'
            else:
                status = 'explicit-null'
        result['slots'].append({'slot': slot, 'sourceReference': reference,
            'nativeObjectIndex': index, 'sourceClass': source_class, 'referenceStatus': status,
            'properties': properties, 'propertyTags': copy.deepcopy(slot_tags),
            'raw': _raw(package, begin, reader.position)})
    _require(reader.position == end, 'Unconsumed StaticMesh Materials array bytes')
    result['materialsPayload'] = _raw(package, start, end)
    return result
