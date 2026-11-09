import struct


def compact(value):
    negative, value = value < 0, abs(value)
    result = bytearray([(value & 63) | (128 if negative else 0)])
    value >>= 6
    if value:
        result[0] |= 64
    while value:
        byte, value = value & 127, value >> 7
        result.append(byte | (128 if value else 0))
    return bytes(result)


def package_bytes(names, imports, exports):
    names = list(dict.fromkeys(['None', *names, *(name for row in imports for name in (row[0], row[1], row[3])), *(row['name'] for row in exports)]))
    index = {name: i for i, name in enumerate(names)}
    name_bytes = b''.join(compact(len(name)+1) + name.encode('ascii') + b'\0' + struct.pack('<I', 0) for name in names)
    import_bytes = b''.join(compact(index[cp]) + compact(index[cn]) + struct.pack('<i', outer) + compact(index[name]) for cp, cn, outer, name in imports)
    table, payloads = b'', b''
    for row in exports:
        offset = 4096 + len(payloads)
        payload = row['body'](offset, index)
        table += compact(row['class']) + compact(0) + struct.pack('<i', row.get('outer', 0)) + compact(index[row['name']])
        table += struct.pack('<I', row.get('flags', 0)) + compact(len(payload)) + (compact(offset) if payload else b'')
        payloads += payload
    assert len(name_bytes) < 960 and len(import_bytes) < 1024 and len(table) < 2048
    data = bytearray(4096)
    struct.pack_into('<IHHIIIIIII', data, 0, 0x9e2a83c1, 123, 28, 0, len(names), 64, len(exports), 2048, len(imports), 1024)
    data[64:64+len(name_bytes)] = name_bytes
    data[1024:1024+len(import_bytes)] = import_bytes
    data[2048:2048+len(table)] = table
    return bytes(data) + payloads


def tag(names, name, kind, raw, struct_name=None):
    fixed = {1: 0, 2: 1, 4: 2, 12: 3, 16: 4}
    size_code = fixed.get(len(raw), 5)
    return compact(names[name]) + bytes([kind | (size_code << 4)]) + (compact(names[struct_name]) if struct_name else b'') + (bytes([len(raw)]) if size_code == 5 else b'') + raw
