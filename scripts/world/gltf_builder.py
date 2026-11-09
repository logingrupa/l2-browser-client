import json
import struct

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from world.terrain_coordinates import f32


class GltfBuilder:
    def __init__(self, generator):
        self.binary = bytearray()
        self.data = {'asset': {'version': '2.0', 'generator': generator}, 'bufferViews': [], 'accessors': []}

    def accessor(self, rows, count, kind, component=5126):
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        flat = [v for row in rows for v in row] if kind != 'SCALAR' else rows
        payload = struct.pack('<'+str(len(flat))+('f' if component == 5126 else 'I'), *flat)
        self.binary.extend(payload)
        view = len(self.data['bufferViews'])
        self.data['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        accessor = {'bufferView': view, 'componentType': component, 'count': count, 'type': kind}
        if kind == 'VEC3':
            accessor['min'] = [f32(min(row[i] for row in rows)) for i in range(3)]
            accessor['max'] = [f32(max(row[i] for row in rows)) for i in range(3)]
        self.data['accessors'].append(accessor)
        return len(self.data['accessors'])-1

    def files(self):
        self.data['buffers'] = [{'uri': 'terrain.bin', 'byteLength': len(self.binary)}]
        gltf = json_bytes(self.data)
        embedded = json.loads(gltf)
        embedded['buffers'][0].pop('uri')
        text = json_bytes(embedded)
        text += b' '*(-len(text)%4)
        binary = bytes(self.binary)+b'\0'*(-len(self.binary)%4)
        glb = struct.pack('<III', 0x46546c67, 2, 28+len(text)+len(binary))
        glb += struct.pack('<I4s', len(text), b'JSON')+text+struct.pack('<I4s', len(binary), b'BIN\0')+binary
        return {'terrain.gltf': gltf, 'terrain.bin': bytes(self.binary), 'terrain.glb': glb}


def glb_structure(path):
    payload = path.read_bytes()
    if len(payload) < 28 or struct.unpack_from('<III', payload) != (0x46546c67, 2, len(payload)):
        raise FormatError('Invalid section model GLB header')
    size, kind = struct.unpack_from('<I4s', payload, 12)
    if kind != b'JSON' or 20+size+8 > len(payload):
        raise FormatError('Invalid section model GLB JSON chunk')
    document = json.loads(payload[20:20+size])
    binary_size, binary_kind = struct.unpack_from('<I4s', payload, 20+size)
    if binary_kind != b'BIN\0' or 28+size+binary_size != len(payload):
        raise FormatError('Invalid section model GLB binary chunk')
    if any(buffer.get('uri') for buffer in document.get('buffers', [])):
        raise FormatError('Section model GLB has an external buffer')
    triangles, vertices, primitives = 0, 0, 0
    for mesh in document.get('meshes', []):
        for primitive in mesh['primitives']:
            if primitive.get('mode', 4) != 4:
                raise FormatError('Section mesh is not a triangle primitive')
            count = document['accessors'][primitive['indices']]['count']
            if count % 3:
                raise FormatError('Section mesh index count is not divisible by three')
            triangles += count//3
            vertices += document['accessors'][primitive['attributes']['POSITION']]['count']
            primitives += 1
    return {'meshes': len(document.get('meshes', [])), 'primitives': primitives, 'vertices': vertices,
            'triangles': triangles, 'materials': len(document.get('materials', [])),
            'scope': 'GLB structure and archive payload hashes verified; rendering/alpha/collision parity remains separate'}
