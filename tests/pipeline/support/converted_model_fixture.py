import json
import struct


def converted_model_glb(slot_flags):
    positions = struct.pack('<9f', 0.0, 0.0, 0.0, 0.01, 0.0, 0.0, 0.0, 0.02, 0.0)
    indices = struct.pack('<3H', 0, 1, 2) + b'\0\0'
    document = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(positions) + len(indices)}],
                'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(positions)}, {'buffer': 0, 'byteOffset': len(positions), 'byteLength': 6}],
                'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3'}, {'bufferView': 1, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'}],
                'materials': [{'extras': {'nativeSectionIndex': slot, 'nativeSlotProperties': {'EnableCollision': flag}}} for slot, flag in enumerate(slot_flags)],
                'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1, 'material': slot} for slot in range(len(slot_flags))]}],
                'nodes': [{'mesh': 0, 'name': 'Fixture'}], 'scenes': [{'nodes': [0]}]}
    text = json.dumps(document).encode('ascii')
    text += b' ' * (-len(text) % 4)
    binary = positions + indices
    return struct.pack('<III', 0x46546c67, 2, 28 + len(text) + len(binary)) + struct.pack('<I4s', len(text), b'JSON') + text + \
        struct.pack('<I4s', len(binary), b'BIN\0') + binary
