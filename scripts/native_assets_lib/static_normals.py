"""Restore proven original StaticMesh normal floats, never renormalizing them.

The byte-preserving mapping primitive is reusable. Native source decoding is
currently admitted only by the retained, hash-pinned Dion tree stream proof;
this is not a new general StaticMesh-tail layout gate.
"""
import hashlib
import json
import math
import struct
from types import SimpleNamespace

from native_catalog.ue2 import Reader


TREE_PROOF_SHA256 = '56fa4c10449ad60e51ed9225442918c2354c354f6b230db5e0b01cd46aba6153'


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def read_proven_normal_streams(package, item, proof_bytes):
    """Recheck identities and exact spans before interpreting the proven streams."""
    _require(_sha(proof_bytes) == TREE_PROOF_SHA256, 'Unqualified native normal source proof')
    proof = json.loads(proof_bytes)
    source = proof['source']
    _require(package.source_hash == source['packageSha256'], 'Native normal package hash differs')
    _require([package.summary['version'], package.summary['licenseeVersion']] == source['version'] == [123, 22],
             'Unqualified native normal source version')
    _require(item['className'] == 'StaticMesh' and item['classObject'] == 'Engine.StaticMesh',
             'Native normals require exact Engine.StaticMesh')
    _require(item['exportIndex'] == source['exportIndex'] and item['object'].casefold() == source['sourceObject'].casefold(),
             'Native normal object identity differs')
    source_end = item['offset'] + item['size']
    _require(_sha(package.data[item['offset']:source_end]) == source['exportSha256'], 'Native normal export hash differs')
    fields = {}
    for row in proof['sourceFieldRanges']:
        _require(row['field'] not in fields, 'Duplicate native source field')
        start, end = row['offset'], row['offset'] + row['bytes']
        _require(item['offset'] <= start <= end <= source_end, 'Native normal field escapes export')
        _require(_sha(package.data[start:end]) == row['sha256'], 'Native normal source field hash differs')
        fields[row['field']] = row

    stream_trailers = {}
    def rows(name, fmt, trailing_bytes=0):
        field = fields[name]
        reader = Reader(package.data, field['offset'], field['offset'] + field['bytes'])
        count = reader.count(1000000)
        width = struct.calcsize('<' + fmt)
        _require(reader.end - reader.position == count * width + trailing_bytes, 'Native normal stream count/size differs')
        result = [struct.unpack('<' + fmt, reader.take(width)) for _ in range(count)]
        if trailing_bytes:
            stream_trailers[name] = reader.take(trailing_bytes).hex()
        return result

    sections = rows('sections', 'i5H')
    _require([list(row) for row in sections] == proof['sections'], 'Native normal section records differ')
    native = {'sections': sections, 'vertices': rows('vertices', '6f'), 'uvs': rows('uv0', '2f', 8),
              'indices': [row[0] for row in rows('indexStream1', 'H')]}
    _require(len(native['vertices']) == source['nativeVertexCount'], 'Native normal vertex count differs')
    return native, {'sourceObject': item['object'], 'packageSha256': package.source_hash,
                    'exportIndex': item['exportIndex'], 'exportSha256': source['exportSha256'],
                    'proofSha256': TREE_PROOF_SHA256, 'sourceFieldRanges': proof['sourceFieldRanges'],
                    'preservedSourceStreamTrailingHex': stream_trailers}


def _span(data, binary, index, kind, component=5126):
    _require(type(index) is int and 0 <= index < len(data['accessors']), 'Missing native normal mapping accessor')
    entry = data['accessors'][index]
    _require(entry.get('componentType') == component and entry.get('type') == kind and
             not entry.get('normalized', False) and 'sparse' not in entry,
             'Unsupported native normal mapping accessor layout')
    view_index = entry.get('bufferView')
    _require(type(view_index) is int and 0 <= view_index < len(data['bufferViews']), 'Missing native normal buffer view')
    view = data['bufferViews'][view_index]
    widths = {'SCALAR': {5123: 2, 5125: 4}, 'VEC2': {5126: 8}, 'VEC3': {5126: 12}}
    width = widths[kind][component]
    count = entry['count']
    _require(type(count) is int and 0 < count <= 1000000, 'Invalid native normal accessor count')
    _require(view.get('buffer') == 0 and view.get('byteStride', width) == width,
             'Native normal restoration requires noninterleaved source buffers')
    view_start, local = view.get('byteOffset', 0), entry.get('byteOffset', 0)
    _require(type(view_start) is int and type(local) is int and view_start >= 0 and local >= 0 and
             local + count * width <= view['byteLength'] and view_start + view['byteLength'] <= len(binary),
             'Native normal mapping accessor exceeds binary')
    return entry, view_index, view_start + local, count * width


def restore_mapped_static_normals(document, native):
    """Validate an exact index/position/UV mapping, then atomically replace normals.

    This lower-level routine does not certify native source identity; use
    restore_native_static_normals with the qualified source proof in production.
    """
    data, binary = document.data, bytes(document.binary)
    _require(len(data.get('buffers', [])) == 1 and data['buffers'][0]['byteLength'] <= len(binary),
             'Native normal restoration requires one complete buffer')
    _require(len(data.get('meshes', [])) == 1 and not data.get('skins') and not data.get('animations'),
             'Native normal restoration requires one unskinned static mesh')
    primitives = data['meshes'][0]['primitives']
    _require(len(primitives) == len(native['sections']), 'Native normal section count differs')
    vertices, uvs, indices = native['vertices'], native['uvs'], native['indices']
    _require(len(vertices) == len(uvs) and all(len(v) == 6 and all(math.isfinite(n) for n in v) for v in vertices),
             'Native normal vertex stream is malformed')
    _require(all(len(v) == 2 and all(math.isfinite(n) for n in v) for v in uvs), 'Native normal UV stream is malformed')
    plans, used_accessors, rows = [], set(), []
    scale = struct.unpack('<f', struct.pack('<f', .01))[0]
    for section_index, (primitive, section) in enumerate(zip(primitives, native['sections'])):
        _require(primitive.get('mode', 4) == 4 and not primitive.get('targets') and not primitive.get('extensions'),
                 'Unsupported native normal primitive topology')
        _require(primitive.get('material') == section_index and
                 primitive.get('extras', {}).get('nativeSectionIndex', section_index) == section_index,
                 'Native normal section/material order differs')
        first, count = section[1], section[5] * 3
        _require(first >= 0 and count > 0 and first + count <= len(indices), 'Native normal source indices exceed stream')
        source_indices = indices[first:first + count]
        _require(all(type(index) is int and 0 <= index < len(vertices) for index in source_indices),
                 'Native normal source index exceeds vertices')
        first_use = list(dict.fromkeys(source_indices))
        remap = {source: local for local, source in enumerate(first_use)}
        index_entry = data['accessors'][primitive['indices']]
        component = index_entry['componentType']
        _require(component in (5123, 5125), 'Unsupported native normal index component')
        entry, _, start, size = _span(data, binary, primitive['indices'], 'SCALAR', component)
        actual_indices = [row[0] for row in struct.iter_unpack('<H' if component == 5123 else '<I', binary[start:start + size])]
        _require(actual_indices == [remap[index] for index in source_indices], 'Native normal first-use index mapping differs')
        attributes = primitive['attributes']
        for name, kind, expected in (
            ('POSITION', 'VEC3', b''.join(struct.pack('<3f', *(vertices[index][axis] * scale for axis in (0, 2, 1))) for index in first_use)),
            ('TEXCOORD_0', 'VEC2', b''.join(struct.pack('<2f', *uvs[index]) for index in first_use)),
        ):
            entry, _, start, size = _span(data, binary, attributes[name], kind)
            _require(entry['count'] == len(first_use) and binary[start:start + size] == expected,
                     'Native normal ' + name + ' mapping differs')
        normal_index = attributes['NORMAL']
        _require(normal_index not in used_accessors, 'Native normal accessor is shared between sections')
        used_accessors.add(normal_index)
        entry, view_index, start, size = _span(data, binary, normal_index, 'VEC3')
        _require(entry['count'] == len(first_use) and 'min' not in entry and 'max' not in entry,
                 'Native normal count or bounds metadata differs')
        for other_index, view in enumerate(data['bufferViews']):
            if other_index == view_index:
                continue
            other_start = view.get('byteOffset', 0)
            _require(view.get('buffer') != 0 or start + size <= other_start or other_start + view['byteLength'] <= start,
                     'Native normal target overlaps another buffer view')
        _require(sum(accessor.get('bufferView') == view_index for accessor in data['accessors']) == 1,
                 'Native normal target buffer view is shared')
        _require(not any(image.get('bufferView') == view_index for image in data.get('images', [])),
                 'Native normal target aliases image bytes')
        _require(sum(value == normal_index for mesh in data['meshes'] for prim in mesh['primitives']
                     for value in prim.get('attributes', {}).values()) == 1,
                 'Native normal accessor aliases another attribute')
        replacement = b''.join(struct.pack('<3f', *(vertices[index][axis] for axis in (3, 5, 4))) for index in first_use)
        before = binary[start:start + size]
        plans.append((start, replacement))
        rows.append({'section': section_index, 'normalAccessor': normal_index, 'byteOffset': start, 'bytes': size,
                     'vertices': len(first_use), 'sourceVertexFirstUse': first_use,
                     'beforeSha256': _sha(before), 'afterSha256': _sha(replacement),
                     'changedBytes': sum(a != b for a, b in zip(before, replacement)),
                     'changedFloatFields': sum(a != b for a, b in zip(struct.iter_unpack('<I', before), struct.iter_unpack('<I', replacement)))})
    # All sections/alias guards pass before the first byte can be changed.
    result = bytearray(binary)
    for start, replacement in plans:
        result[start:start + len(replacement)] = replacement
    document.binary[:] = result
    return {'kind': 'restore-original-static-normal-floats', 'coordinateTransform': '(nx,ny,nz) -> (nx,nz,ny)',
            'normalizationApplied': False, 'sections': rows, 'vertices': sum(row['vertices'] for row in rows),
            'changedBytes': sum(row['changedBytes'] for row in rows),
            'changedFloatFields': sum(row['changedFloatFields'] for row in rows),
            'binaryBeforeSha256': _sha(binary), 'binaryAfterSha256': _sha(result),
            'allNonNormalBytesUnchanged': True, 'jsonMetadataUnchanged': True}


def restore_native_static_normals(document, package, item, proof_bytes):
    native, source = read_proven_normal_streams(package, item, proof_bytes)
    return {**restore_mapped_static_normals(document, native), 'source': source}


def restore_glb_static_normals(original, package, item, proof_bytes):
    """Patch only existing GLB BIN normal spans, retaining original JSON bytes."""
    _require(len(original) >= 28 and struct.unpack_from('<III', original) == (0x46546c67, 2, len(original)), 'Invalid source GLB header')
    json_size, json_type = struct.unpack_from('<I4s', original, 12)
    binary_header = 20 + json_size
    _require(json_type == b'JSON' and json_size % 4 == 0 and binary_header + 8 <= len(original), 'Invalid source GLB JSON chunk')
    binary_size, binary_type = struct.unpack_from('<I4s', original, binary_header)
    start = binary_header + 8
    _require(binary_type == b'BIN\0' and binary_size % 4 == 0 and start + binary_size == len(original), 'Invalid source GLB BIN chunk')
    document = SimpleNamespace(data=json.loads(original[20:binary_header]), binary=bytearray(original[start:]))
    report = restore_native_static_normals(document, package, item, proof_bytes)
    result = original[:start] + document.binary
    return bytes(result), {**report, 'glbBeforeSha256': _sha(original), 'glbAfterSha256': _sha(result), 'glbBinaryOffset': start}
