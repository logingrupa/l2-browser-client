import json
import struct

from native_assets_lib.gltf import json_bytes
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
