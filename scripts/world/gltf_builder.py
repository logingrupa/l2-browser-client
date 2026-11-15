import json
import struct

from native_assets_lib.gltf import json_bytes
from world.terrain_coordinates import f32

GLB_MAGIC = 0x46546c67
GLB_VERSION = 2
GLTF_FLOAT_COMPONENT = 5126
GLTF_UNSIGNED_INTEGER_COMPONENT = 5125


def embedded_glb_bytes(document, binary):
    text = json_bytes(document)
    text += b' '*(-len(text) % 4)
    padded_binary = bytes(binary)+b'\0'*(-len(binary) % 4)
    glb = struct.pack('<III', GLB_MAGIC, GLB_VERSION, 28+len(text)+len(padded_binary))
    return glb + struct.pack('<I4s', len(text), b'JSON')+text+struct.pack('<I4s', len(padded_binary), b'BIN\0')+padded_binary


class GltfBuilder:
    def __init__(self, generator):
        self.binary = bytearray()
        self.data = {'asset': {'version': '2.0', 'generator': generator}, 'bufferViews': [], 'accessors': []}

    def buffer_view(self, payload):
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        self.binary.extend(payload)
        self.data['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        return len(self.data['bufferViews'])-1

    def accessor(self, rows, count, kind, component=GLTF_FLOAT_COMPONENT, bounds=True):
        flat = [v for row in rows for v in row] if kind != 'SCALAR' else rows
        view = self.buffer_view(struct.pack('<'+str(len(flat))+('f' if component == GLTF_FLOAT_COMPONENT else 'I'), *flat))
        accessor = {'bufferView': view, 'componentType': component, 'count': count, 'type': kind}
        if kind == 'VEC3' and bounds:
            accessor['min'] = [f32(min(row[i] for row in rows)) for i in range(3)]
            accessor['max'] = [f32(max(row[i] for row in rows)) for i in range(3)]
        self.data['accessors'].append(accessor)
        return len(self.data['accessors'])-1

    def embedded_image(self, png):
        images = self.data.setdefault('images', [])
        images.append({'mimeType': 'image/png', 'bufferView': self.buffer_view(png)})
        return len(images)-1

    def glb(self):
        return embedded_glb_bytes({**self.data, 'buffers': [{'byteLength': len(self.binary)}]}, self.binary)

    def files(self):
        self.data['buffers'] = [{'uri': 'terrain.bin', 'byteLength': len(self.binary)}]
        gltf = json_bytes(self.data)
        embedded = json.loads(gltf)
        embedded['buffers'][0].pop('uri')
        return {'terrain.gltf': gltf, 'terrain.bin': bytes(self.binary), 'terrain.glb': embedded_glb_bytes(embedded, self.binary)}
