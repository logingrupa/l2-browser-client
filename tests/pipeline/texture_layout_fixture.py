import struct

from native_assets_lib.lineage_material_prefix import NO_MATERIAL_PREFIX, SHADER_BLOCK_MATERIAL_PREFIX
from ue2_package_fixture import compact, package_bytes, tag

PACKAGE_VERSION_OFFSET = 4
TEXTURE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Texture')]
TEXTURE_CLASS_REFERENCE = -2
TEXTURE_PROPERTY_NAMES = ['Format', 'USize', 'VSize']
BYTE_PROPERTY_KIND = 1
INTEGER_PROPERTY_KIND = 2
DXT1_BLOCK_BYTES = 8
SHADER_BLOCK_MATRIX_COUNT = 8
SHADER_BLOCK_MATRIX_BYTES = 128
SHADER_BLOCK_STRING_COUNT = 17
EMPTY_ANSI_STRING = compact(1) + b'\0'


def synthetic_shader_block():
    return (struct.pack('<6B3i', 1, 2, 3, 4, 5, 250, -17, 7, 9) + bytes(SHADER_BLOCK_MATRIX_COUNT * SHADER_BLOCK_MATRIX_BYTES)
            + bytes(8) + struct.pack('<3i', 0, 0, 0) + EMPTY_ANSI_STRING * SHADER_BLOCK_STRING_COUNT)


def synthetic_material_prefix(material_prefix, reserved_int32):
    if material_prefix == NO_MATERIAL_PREFIX:
        return b''
    prefix = struct.pack('<i', reserved_int32)
    return prefix + synthetic_shader_block() if material_prefix == SHADER_BLOCK_MATERIAL_PREFIX else prefix


def synthetic_mip_payload(level):
    return bytes((level * 37 + index) % 256 for index in range(DXT1_BLOCK_BYTES))


def synthetic_texture_body(fixture):
    body_spec = fixture['syntheticBody']
    mips = body_spec['mips']

    def body(offset, names):
        width, height = mips[0]
        record = (tag(names, 'Format', BYTE_PROPERTY_KIND, bytes([body_spec['formatId']]))
                  + tag(names, 'USize', INTEGER_PROPERTY_KIND, struct.pack('<i', width))
                  + tag(names, 'VSize', INTEGER_PROPERTY_KIND, struct.pack('<i', height)) + compact(names['None'])
                  + synthetic_material_prefix(fixture['materialPrefix'], body_spec['reservedInt32']) + compact(len(mips)))
        for level, (mip_width, mip_height) in enumerate(mips):
            payload, size = synthetic_mip_payload(level), compact(DXT1_BLOCK_BYTES)
            payload_end = offset + len(record) + 4 + len(size) + len(payload)
            record += (struct.pack('<i', payload_end) + size + payload + struct.pack('<ii', mip_width, mip_height)
                       + bytes([mip_width.bit_length() - 1, mip_height.bit_length() - 1]))
        return record
    return body


def synthetic_texture_layout_package_bytes(fixture):
    data = bytearray(package_bytes(TEXTURE_PROPERTY_NAMES, TEXTURE_IMPORTS,
                                   [{'name': 'Layout', 'class': TEXTURE_CLASS_REFERENCE, 'body': synthetic_texture_body(fixture)}]))
    struct.pack_into('<HH', data, PACKAGE_VERSION_OFFSET, fixture['packageVersion'], fixture['licensee'])
    return bytes(data)


def decoded_texture_layout_projection(metadata):
    return {'nativePrefixBytes': metadata['nativePrefix']['sourceBytes'],
            'mipRecordOffsets': [mip['recordOffset'] for mip in metadata['mips']],
            'mipSourceOffsets': [mip['sourceOffset'] for mip in metadata['mips']],
            'mipSha256': [mip['sha256'] for mip in metadata['mips']],
            'nativeMipBytes': metadata['nativeMipBytes'],
            'sourceExportSha256': metadata['source']['sourceExportSha256']}
