from __future__ import annotations

from pathlib import Path
import struct
import subprocess
import tempfile

from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import sha256_hex_digest

KIND = 'native-map-music'
TRANSFORMS = ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')
MAX_TRACK_BYTES = 8_000_000
OGG_TRAILER_LIMIT = 64


def _crc_table():
    table = []
    for index in range(256):
        value = index << 24
        for _ in range(8):
            value = ((value << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if value & 0x80000000 else (value << 1) & 0xFFFFFFFF
        table.append(value)
    return table


_CRC = _crc_table()


def ogg_crc(page):
    value = 0
    for byte in page:
        value = ((value << 8) & 0xFFFFFFFF) ^ _CRC[((value >> 24) & 0xFF) ^ byte]
    return value


def restore_l2_ogg(data):
    require_condition(isinstance(data, (bytes, bytearray)) and 64 < len(data) <= MAX_TRACK_BYTES, 'Invalid music payload size')
    data = bytes(data)
    capture = data[:4]
    require_condition(capture in (b'L2SD', b'OggS'), 'Music payload is not an L2SD/Ogg stream')
    position, pages, serials, last = 0, 0, set(), None
    while position + 27 <= len(data):
        expected = capture if position == 0 else b'OggS'
        if data[position:position + 4] != expected:
            break
        require_condition(data[position + 4] == 0, 'Unsupported Ogg stream structure version')
        segments = data[position + 26]
        require_condition(position + 27 + segments <= len(data), 'Truncated Ogg lacing table')
        size = 27 + segments + sum(data[position + 27:position + 27 + segments])
        require_condition(position + size <= len(data), 'Truncated Ogg page')
        page = bytearray(data[position:position + size])
        stored = struct.unpack_from('<I', page, 22)[0]
        page[0:4], page[22:26] = b'OggS', b'\0\0\0\0'
        require_condition(ogg_crc(bytes(page)) == stored, f'Ogg page CRC differs at offset {position}')
        flags = data[position + 5]
        require_condition(bool(flags & 2) == (position == 0), 'Ogg BOS flag must mark only the first page')
        serials.add(struct.unpack_from('<I', data, position + 14)[0])
        last = {'offset': position, 'flags': flags, 'granule': struct.unpack_from('<q', data, position + 6)[0]}
        pages += 1
        position += size
        if flags & 4:
            break
    require_condition(pages > 2 and last and last['flags'] & 4 and len(serials) == 1, 'Ogg stream lacks one logical EOS stream')
    trailer = data[position:]
    require_condition(len(trailer) <= OGG_TRAILER_LIMIT and b'OggS' not in trailer, 'Unexpected data after the Ogg EOS page')
    segments = data[26]
    header = data[27 + segments:27 + segments + 30]
    require_condition(header[:7] == b'\x01vorbis' and struct.unpack_from('<I', header, 7)[0] == 0, 'First packet is not a Vorbis identification header')
    channels, rate = header[11], struct.unpack_from('<I', header, 12)[0]
    require_condition(channels in (1, 2) and 8000 <= rate <= 96000 and last['granule'] > 0, 'Unsupported Vorbis channel/rate/granule')
    restored = b'OggS' + data[4:position]
    facts = {'container': 'ogg', 'codec': 'vorbis', 'channels': channels, 'sampleRate': rate, 'pages': pages,
             'finalGranule': last['granule'], 'durationSeconds': last['granule'] / rate,
             'patch': {'captureOffset': 0, 'originalCapture': capture.decode('ascii'), 'restoredCapture': 'OggS',
                       'trailerOffset': position, 'trailerHex': trailer.hex(),
                       'rule': 'original = original capture + restored[4:] + trailer; every page CRC validated with OggS'}}
    return restored, facts


def unpatch(restored, patch):
    return patch['originalCapture'].encode('ascii') + restored[4:] + bytes.fromhex(patch['trailerHex'])


def music_volumes(map_data, map_label):
    from native_catalog.ue2 import Package
    from world.bsp_reader_binding import PackageAdapter, reviewed_reader
    from world.map_actor_properties import actor_properties, decode_property, explicit_properties, property_value, source_range
    package = Package(map_data, Path(map_label).name)
    adapter, reader = PackageAdapter(package), reviewed_reader()
    volumes = []
    for item in package.exports:
        if item['classObject'] != 'Engine.MusicVolume':
            continue
        props, tail, state, _ = actor_properties(package, item)
        require_condition(tail.position == tail.end, 'MusicVolume has unconsumed tagged bytes: ' + item['object'])
        decoded = [decode_property(package, prop, map_label + '#unwrapped') for prop in props]
        value = lambda name: property_value(decoded, name)
        music_id, brush = value('nMusicID'), value('Brush')
        require_condition(type(music_id) is int and music_id > 0 and isinstance(brush, dict) and brush.get('index', 0) > 0,
                'MusicVolume lacks nMusicID or Brush: ' + item['object'])
        transform = explicit_properties(decoded, TRANSFORMS)
        for name in ('Rotation', 'DrawScale', 'DrawScale3D'):
            require_condition(transform[name]['status'] == 'omitted-class-default-unresolved', 'Unsupported serialized brush transform: ' + name)
        location = transform['Location'].get('value') or {'X': 0.0, 'Y': 0.0, 'Z': 0.0}
        pivot = transform['PrePivot'].get('value') or {'X': 0.0, 'Y': 0.0, 'Z': 0.0}
        offset = [location[k] - pivot[k] for k in ('X', 'Y', 'Z')]
        model_export = adapter.exports[brush['index'] - 1]
        model = reader._read_model(adapter, model_export, True)
        require_condition(not model.zones and 4 <= len(model.nodes) <= 64, 'MusicVolume brush is not a small non-level BSP')
        planes = []
        for index, node in enumerate(model.nodes):
            require_condition(node.i_front == -1 and node.i_plane == -1 and node.i_back == (index + 1 if index + 1 < len(model.nodes) else -1),
                    'MusicVolume brush BSP is not a convex back-chain: ' + item['object'])
            nx, ny, nz, w = node.plane
            planes.append([nx, ny, nz, w + nx * offset[0] + ny * offset[1] + nz * offset[2]])
        points = [[p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]] for p in model.points]
        raw = package.data[model_export.serial_offset:model_export.serial_offset + model_export.serial_size]
        volumes.append({
            'id': 'interlude:' + item['object'], 'object': item['object'], 'exportIndex': item['exportIndex'],
            'musicId': music_id,
            'forcePlayMusic': value('bForcePlayMusic') if any(p['name'] == 'bForcePlayMusic' for p in decoded) else None,
            'group': value('Group'), 'tag': value('Tag'), 'stateFrame': state,
            'nativePayload': source_range(package.data, map_label + '#unwrapped', item['offset'], item['offset'] + item['size']),
            'transform': transform,
            'transformPolicy': 'world = local - PrePivot + Location; omitted Rotation/DrawScale/DrawScale3D assumed identity (class defaults unresolved)',
            'brush': {'object': brush['object'], 'exportIndex': brush['index'], 'bytes': len(raw), 'sha256': sha256_hex_digest(raw),
                      'nodes': len(model.nodes), 'points': len(model.points), 'serializedBounds': [list(model.bounds[0]), list(model.bounds[1]), model.bounds[2]],
                      'reader': 'scripts/vendor/lineage2elbera_bsp (pinned by world/bsp_reader_binding.py READER_SHA)'},
            'worldPlanes': planes,
            'worldBounds': {'min': [min(p[i] for p in points) for i in range(3)], 'max': [max(p[i] for p in points) for i in range(3)]},
            'insideRule': 'native point P is inside when nx*X + ny*Y + nz*Z - W <= 0 for every world plane (convex brush BSP chain)'})
    return volumes


def encoder_identity(encoder, spec):
    require_condition(encoder is not None, 'No local AAC encoder: install the pinned ffmpeg or pass --ffmpeg')
    path = Path(encoder)
    require_condition(path.is_file(), 'Encoder executable is missing: ' + str(path))
    require_condition(sha256_hex_digest(path.read_bytes()) == spec['sha256'], 'Encoder executable hash differs from the recipe pin')
    banner = subprocess.run([str(path), '-hide_banner', '-version'], capture_output=True, check=True, timeout=60).stdout
    first = banner.decode('utf-8', 'replace').splitlines()[0] if banner else ''
    require_condition(spec['version'] in first, 'Encoder version differs from the recipe pin')
    return {'name': spec['name'], 'version': spec['version'], 'sha256': spec['sha256'], 'banner': first.strip()}


def encode(encoder, args, restored):
    require_condition(all(isinstance(arg, str) for arg in args) and args.count('{input}') == 1 and args.count('{output}') == 1,
            'Derivative args need one {input} and one {output}')
    with tempfile.TemporaryDirectory(prefix='l2-music-derivative-') as work:
        source, target = Path(work) / 'input.ogg', Path(work) / 'output.m4a'
        source.write_bytes(restored)
        command = [str(encoder)] + [str(source) if a == '{input}' else str(target) if a == '{output}' else a for a in args]
        subprocess.run(command, capture_output=True, check=True, timeout=600)
        data = target.read_bytes()
    require_condition(8 < len(data) <= MAX_TRACK_BYTES and data[4:8] == b'ftyp', 'Derivative is not an MP4/M4A payload')
    return data
