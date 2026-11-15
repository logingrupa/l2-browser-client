from __future__ import annotations

import struct

from native_assets_lib.guard_clauses import require_condition

KIND = 'native-map-ambience'
FIELDS = ['id', 'exportIndex', 'x', 'y', 'z', 'soundRadius', 'soundVolume', 'soundPitch', 'ambientSoundType',
          'ambientRandom', 'ambientSoundStartTime', 'sound', 'zone', 'zoneNumber', 'group']


def pe_export_f32(data, symbol):
    require_condition(data[:2] == b'MZ', 'Not a PE image')
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    require_condition(data[pe:pe + 4] == b'PE\0\0' and struct.unpack_from('<H', data, pe + 24)[0] == 0x10B, 'Not a PE32 image')
    sections, optional = struct.unpack_from('<H', data, pe + 6)[0], struct.unpack_from('<H', data, pe + 20)[0]
    base, table = pe + 24, []
    image_base = struct.unpack_from('<I', data, base + 28)[0]
    for index in range(sections):
        offset = base + optional + index * 40
        name = data[offset:offset + 8].rstrip(b'\0').decode('ascii', 'replace')
        virtual_size, address, raw_size, raw = struct.unpack_from('<IIII', data, offset + 8)
        table.append((name, address, virtual_size, raw, raw_size))

    def file_offset(rva, width=1):
        for name, address, virtual_size, raw, raw_size in table:
            if address <= rva and rva + width <= address + raw_size:
                return raw + rva - address, name
        raise ValueError('RVA is outside initialized file data: ' + hex(rva))

    export_rva = struct.unpack_from('<I', data, base + 96)[0]
    directory, _ = file_offset(export_rva, 40)
    functions, names, ordinals = (struct.unpack_from('<I', data, directory + 28 + 4 * i)[0] for i in range(3))
    count = struct.unpack_from('<I', data, directory + 24)[0]
    for index in range(count):
        name_offset, _ = file_offset(struct.unpack_from('<I', data, file_offset(names + 4 * index, 4)[0])[0])
        if data[name_offset:data.index(b'\0', name_offset)].decode('ascii', 'replace') != symbol:
            continue
        ordinal = struct.unpack_from('<H', data, file_offset(ordinals + 2 * index, 2)[0])[0]
        rva = struct.unpack_from('<I', data, file_offset(functions + 4 * ordinal, 4)[0])[0]
        offset, section = file_offset(rva, 4)
        value = struct.unpack_from('<f', data, offset)[0]
        return {'symbol': symbol, 'rva': rva, 'virtualAddress': image_base + rva, 'section': section,
                'fileOffset': offset, 'bytesHex': data[offset:offset + 4].hex(), 'value': value}
    raise ValueError('Export not found: ' + symbol)


def wav_facts(data):
    require_condition(len(data) > 44 and data[:4] == b'RIFF' and data[8:12] == b'WAVE', 'Ambient payload is not RIFF/WAVE')
    position, fmt, frames = 12, None, None
    while position + 8 <= len(data):
        tag, size = data[position:position + 4], struct.unpack_from('<I', data, position + 4)[0]
        body = data[position + 8:position + 8 + size]
        require_condition(len(body) == size, 'Truncated WAV chunk')
        if tag == b'fmt ':
            fmt = struct.unpack_from('<HHIIHH', body)
        elif tag == b'data':
            frames = size
        position += 8 + size + (size & 1)
    require_condition(fmt and frames is not None, 'WAV lacks fmt/data')
    codec, channels, rate, _, align, bits = fmt
    require_condition(codec == 1 and channels in (1, 2) and 8000 <= rate <= 96000 and bits in (8, 16) and align > 0, 'Unsupported WAV PCM format')
    return {'channels': channels, 'sampleRate': rate, 'bitsPerSample': bits, 'durationSeconds': frames / align / rate}
