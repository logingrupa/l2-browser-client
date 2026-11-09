import json
import math
import struct

from native_catalog.ue2 import FormatError


def require(condition, message):
    if not condition:
        raise FormatError(message)


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value, minimum=0):
    return type(value) is int and value >= minimum


def parse_glb(data):
    require(isinstance(data, bytes) and 28 <= len(data) <= 96*1024*1024,
            'Invalid or oversized GLB')
    require(struct.unpack_from('<III', data) == (0x46546c67, 2, len(data)),
            'Invalid GLB header/length')
    json_size, json_kind = struct.unpack_from('<I4s', data, 12)
    require(json_kind == b'JSON' and json_size % 4 == 0 and 20+json_size+8 <= len(data),
            'Invalid GLB JSON chunk')
    doc = json.loads(data[20:20+json_size])
    bin_size, bin_kind = struct.unpack_from('<I4s', data, 20+json_size)
    require(bin_kind == b'BIN\0' and bin_size % 4 == 0 and 28+json_size+bin_size == len(data),
            'Unsupported extra/missing GLB chunks')
    binary = data[28+json_size:]
    require(doc.get('asset', {}).get('version') == '2.0' and not doc.get('extensionsUsed') and
            not doc.get('extensionsRequired') and not doc.get('extensions') and
            not doc.get('skins') and not doc.get('animations'), 'Unsupported GLB extensions/animation')
    buffers = doc.get('buffers')
    require(isinstance(buffers, list) and len(buffers) == 1 and
            set(buffers[0]) == {'byteLength'} and integer(buffers[0]['byteLength']) and
            0 <= len(binary)-buffers[0]['byteLength'] <= 3, 'Unsupported GLB buffer layout')
    binary = binary[:buffers[0]['byteLength']]
    meshes, nodes, scenes = doc.get('meshes'), doc.get('nodes'), doc.get('scenes')
    require(isinstance(meshes, list) and 0 < len(meshes) <= 1024 and
            isinstance(nodes, list) and len(nodes) == len(meshes) and
            isinstance(scenes, list) and len(scenes) == 1 and doc.get('scene', 0) == 0,
            'Unsupported GLB static scene layout')
    require(all(isinstance(n, dict) and set(n).issubset({'mesh', 'name', 'extras'}) and
                integer(n.get('mesh')) for n in nodes), 'Unsupported GLB node transform/hierarchy')
    require(sorted(n['mesh'] for n in nodes) == list(range(len(meshes))) and
            set(scenes[0]).issubset({'nodes', 'name', 'extras'}) and
            scenes[0].get('nodes') == list(range(len(nodes))),
            'GLB scene must reference each identity mesh exactly once')
    accessors, views = doc.get('accessors'), doc.get('bufferViews')
    require(isinstance(accessors, list) and isinstance(views, list), 'Missing GLB accessors/views')

    def accessor(index, positions=False):
        require(integer(index) and index < len(accessors), 'Invalid accessor index')
        a = accessors[index]
        require(isinstance(a, dict) and not a.get('sparse') and not a.get('extensions') and
                not a.get('normalized') and integer(a.get('bufferView')) and
                a['bufferView'] < len(views), 'Unsupported accessor layout')
        formats = {5126: ('f', 4)} if positions else {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4)}
        require(a.get('componentType') in formats and a.get('type') == ('VEC3' if positions else 'SCALAR') and
                integer(a.get('count'), 1) and a['count'] <= 10_000_000,
                'Unsupported position/index accessor')
        fmt, width = formats[a['componentType']]
        dimensions = 3 if positions else 1
        size = width*dimensions
        view = views[a['bufferView']]
        require(isinstance(view, dict) and view.get('buffer') == 0 and not view.get('extensions'),
                'Unsupported buffer view')
        start, length = view.get('byteOffset', 0), view.get('byteLength')
        offset, stride = a.get('byteOffset', 0), view.get('byteStride', size)
        require(all(integer(v) for v in (start, length, offset, stride)) and
                start+length <= len(binary) and stride >= size and stride % width == 0 and
                (start+offset) % width == 0 and offset+(a['count']-1)*stride+size <= length,
                'Accessor exceeds buffer view or has invalid alignment/stride')
        rows = [struct.unpack_from('<'+fmt*dimensions, binary, start+offset+i*stride)
                for i in range(a['count'])]
        if positions:
            require(all(all(finite_number(v) for v in p) for p in rows), 'Nonfinite GLB positions')
        return rows

    result = []
    for mesh_index, mesh in enumerate(meshes):
        require(isinstance(mesh, dict) and not mesh.get('weights') and not mesh.get('extensions') and
                isinstance(mesh.get('primitives'), list) and mesh['primitives'], 'Unsupported GLB mesh')
        for primitive_index, primitive in enumerate(mesh['primitives']):
            require(primitive.get('mode', 4) == 4 and not primitive.get('targets') and
                    not primitive.get('extensions') and isinstance(primitive.get('attributes'), dict) and
                    not any(k.startswith(('JOINTS_', 'WEIGHTS_')) for k in primitive['attributes']),
                    'Unsupported GLB primitive deformation/topology')
            positions = accessor(primitive['attributes'].get('POSITION'), True)
            indices = [row[0] for row in accessor(primitive.get('indices'))]
            require(len(indices) % 3 == 0 and all(i < len(positions) for i in indices),
                    'Invalid triangle indices')
            result.append({'mesh': mesh_index, 'primitive': primitive_index,
                           'positions': positions, 'indices': indices})
    return result
