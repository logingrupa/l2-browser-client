from __future__ import annotations

import copy
import ntpath
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path
from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_assets_lib.strict_json import decode_strict_json

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


class Inputs:
    def __init__(self, root):
        self.root, self.records = refuse_reparse_points(root), {}

    def read(self, name, sha256, size=None):
        name = require_portable_relative_path(name)
        require_condition(isinstance(sha256, str) and SHA256_HEX_PATTERN.fullmatch(sha256) is not None, 'Invalid input SHA256: ' + name)
        data = confined_child_path(self.root, name).read_bytes()
        require_condition(sha256_hex_digest(data) == sha256 and (size is None or len(data) == size), 'Input hash/size differs: ' + name)
        record = {'path': name, 'bytes': len(data), 'sha256': sha256}
        require_condition(self.records.get(name, record) == record, 'Input changed while reading: ' + name)
        self.records[name] = record
        return data

    def pin(self, name):
        data = confined_child_path(self.root, require_portable_relative_path(name)).read_bytes()
        return self.read(name, sha256_hex_digest(data))

    def unchanged(self):
        for record in list(self.records.values()):
            self.read(record['path'], record['sha256'], record['bytes'])


def lock_pins(document, label):
    require_condition(document.get('schemaVersion') == 1 and isinstance(document.get('files'), list) and
            isinstance(document.get('sourceHost'), str) and isinstance(document.get('sourceRoot'), str), 'Invalid source lock: ' + label)
    pins = {}
    for row in document['files']:
        name = require_portable_relative_path(row['relativePath'])
        require_condition(name.casefold() not in pins and type(row.get('bytes')) is int and row['bytes'] > 0 and
                isinstance(row.get('sha256'), str) and SHA256_HEX_PATTERN.fullmatch(row['sha256']), 'Invalid/duplicate lock row: ' + name)
        pins[name.casefold()] = row
    return pins


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


def prepare(root, recipe_path, encoder=None):
    inputs = Inputs(root)
    recipe_path = refuse_reparse_points(recipe_path)
    require_condition(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within the project root')
    recipe_bytes = inputs.pin(recipe_path.relative_to(inputs.root).as_posix())
    recipe = decode_strict_json(recipe_bytes)
    require_condition(recipe.get('schemaVersion') == 1 and recipe.get('kind') == KIND and
            recipe.get('selection') == 'all-exact-Engine.MusicVolume-exports', 'Unsupported music recipe')
    snapshot = 'artifacts/native-parity/inputs/IMPORTA-PC'
    map_lock_bytes, music_lock_bytes = inputs.pin(recipe['map']['lock']), inputs.pin(recipe['musicLock'])
    map_lock, music_lock = decode_strict_json(map_lock_bytes), decode_strict_json(music_lock_bytes)
    for lock in (map_lock, music_lock):
        require_condition({'host': lock.get('sourceHost'), 'root': lock.get('sourceRoot')} == recipe['source'], 'Lock source differs from recipe')
    map_pins, music_pins = lock_pins(map_lock, 'map'), lock_pins(music_lock, 'music')
    pin = map_pins.get(recipe['map']['file'].casefold())
    require_condition(pin and pin['sha256'] == recipe['map']['sha256'] and pin['bytes'] == recipe['map']['bytes'], 'Map identity differs from its lock')
    map_data = inputs.read(snapshot + '/' + pin['relativePath'], pin['sha256'], pin['bytes'])
    join_spec = recipe['musicIdJoin']
    join = decode_strict_json(inputs.read(join_spec['path'], join_spec['sha256']))
    require_condition(music_lock.get('joinEvidence') == {'path': join_spec['path'], 'sha256': join_spec['sha256']}, 'Music lock was not derived from this join')
    volumes = music_volumes(map_data, pin['relativePath'])
    expected = [(v['object'], v['exportIndex'], v['musicId']) for v in recipe['expectedVolumes']]
    require_condition([(v['object'], v['exportIndex'], v['musicId']) for v in volumes] == expected, 'MusicVolume census differs from the recipe')
    derivative = recipe['derivative']
    identity = encoder_identity(encoder, derivative['encoder'])
    tracks, payloads, used = {}, {}, set()
    for volume in volumes:
        joins = [row for row in join['joins'] if row['volumeEvidence']['object'] == volume['object']]
        require_condition(len(joins) == 1, 'Missing/ambiguous music join: ' + volume['object'])
        row = joins[0]
        evidence = row['volumeEvidence']
        require_condition(evidence['exportIndex'] == volume['exportIndex'] and evidence['nMusicID'] == volume['musicId'] and
                evidence['payloadSha256'] == volume['nativePayload']['sha256'] and evidence['payloadBytes'] == volume['nativePayload']['bytes'] and
                bool(evidence.get('bForcePlayMusic')) == bool(volume['forcePlayMusic']), 'Join evidence differs from the map declaration')
        info = row['musicinfo']
        require_condition(info['id'] == volume['musicId'] and info['cnt'] == len(info['orderedStrings']) == len(row['filenameJoins']) and info['cnt'] > 0,
                'musicinfo row/count differs')
        order = []
        for index, (stored, match) in enumerate(zip(info['orderedStrings'], row['filenameJoins'])):
            require_condition(match['arrayIndex'] == index and match['storedString'] == stored and len(match['filenameMatches']) == 1, 'Ambiguous music filename join')
            native = match['filenameMatches'][0]
            name = 'music/' + ntpath.basename(native['path'])
            require_condition(ntpath.splitext(ntpath.basename(native['path']))[0].casefold() == stored.casefold(), 'Music basename differs from musicinfo string')
            locked = music_pins.get(name.casefold())
            require_condition(locked and locked['sha256'] == native['sha256'] and locked['bytes'] == native['bytes'], 'Music file is not locked: ' + name)
            key = 'music:' + stored
            if key not in tracks:
                original = inputs.read(snapshot + '/' + locked['relativePath'], locked['sha256'], locked['bytes'])
                restored, facts = restore_l2_ogg(original)
                require_condition(unpatch(restored, facts['patch']) == original, 'Restoration is not exactly reversible')
                require_condition((facts['channels'], facts['sampleRate']) == (2, 44100), 'Derivative args assume 44.1 kHz stereo sources')
                derived = encode(encoder, derivative['args'], restored)
                file, derived_file = 'audio/' + sha256_hex_digest(restored) + '.ogg', 'derived/' + sha256_hex_digest(derived) + '.m4a'
                for name_, data in ((file, restored), (derived_file, derived)):
                    require_condition(payloads.get(name_, data) == data, 'Conflicting music payload')
                    payloads[name_] = data
                tracks[key] = {'key': key, 'storedString': stored, 'file': file, 'bytes': len(restored), 'sha256': sha256_hex_digest(restored),
                               'mime': 'audio/ogg; codecs=vorbis', 'durationSeconds': facts['durationSeconds'],
                               'channels': facts['channels'], 'sampleRate': facts['sampleRate'], 'oggPages': facts['pages'],
                               'original': {'relativePath': locked['relativePath'], 'sourceHost': music_lock['sourceHost'],
                                            'sourcePath': music_lock['sourceRoot'] + '/' + locked['relativePath'],
                                            'bytes': len(original), 'sha256': sha256_hex_digest(original), 'patch': facts['patch']},
                               'derivative': {'file': derived_file, 'bytes': len(derived), 'sha256': sha256_hex_digest(derived),
                                              'mime': derivative['mime'], 'kind': derivative['kind'], 'label': derivative['label'],
                                              'encoder': identity, 'args': list(derivative['args'])}}
            used.add(key)
            order.append(key)
        volume['musicInfo'] = {'line': info['line'], 'rawLine': info['rawLine'], 'cnt': info['cnt'], 'orderedStrings': list(info['orderedStrings'])}
        volume['tracks'] = order
    require_condition(used == set(tracks), 'Unreferenced music track')
    inputs.unchanged()
    files = [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data),
              'mime': 'audio/mp4' if name.endswith('.m4a') else 'audio/ogg'} for name, data in sorted(payloads.items())]
    manifest = {'schemaVersion': 1, 'kind': KIND, 'source': recipe['source'],
                'map': {'relativePath': pin['relativePath'], 'bytes': pin['bytes'], 'sha256': pin['sha256'],
                        'sourcePath': map_lock['sourceRoot'] + '/' + pin['relativePath']},
                'inputs': [copy.deepcopy(v) for v in sorted(inputs.records.values(), key=lambda r: r['path'])],
                'coordinates': {'space': 'native Unreal world units (X, Y, Z-up)', 'browser': 'browser = (X, Z, Y) * 0.01, as section placements'},
                'volumes': volumes, 'tracks': [tracks[key] for key in sorted(tracks)], 'files': files,
                'coverage': {'volumes': len(volumes), 'tracks': len(tracks), 'files': len(files), 'runtimeConnected': False},
                'limits': ['Ordered musicinfo strings are source facts; sequential/random selection, looping and transitions are unverified.',
                           'bForcePlayMusic is retained authored metadata; its priority/interruption consumer is unresolved.',
                           'Point-in-volume uses the brush BSP planes with identity Rotation/DrawScale assumed; native Encompasses is unverified.',
                           'The restored Ogg differs from the original only by the documented capture/trailer patch; the AAC file is a lossy derivative.',
                           'Native music gain (historical l2.ini MusicVolume=0.1), default/no-volume music and native audible parity remain unverified.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def write_bundle(root, output, payloads, inputs, *, plan=False, verify_only=False):
    output = refuse_reparse_points(output)
    require_condition(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        source = confined_child_path(inputs.root, name)
        require_condition(not source.is_relative_to(output) and not output.is_relative_to(source.parent), 'Output overlaps an input')
    exists = output.exists()
    if exists:
        require_condition(output.is_dir(), 'Output is not a directory')
        actual = set()
        for path in output.rglob('*'):
            refuse_reparse_points(path)
            if path.is_file():
                actual.add(path.relative_to(output).as_posix())
        require_condition(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, value in payloads.items():
            require_condition(confined_child_path(output, name).read_bytes() == value, 'Existing immutable output differs; preserved: ' + name)
    require_condition(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = confined_child_path(output, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            refuse_reparse_points(path.parent)
            with path.open('xb') as handle:
                handle.write(payloads[name])
            written += 1
    inputs.unchanged()
    return status, written


def run(root, recipe_path, output, *, encoder=None, plan=False, verify_only=False):
    require_condition(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    encoder = encoder or shutil.which('ffmpeg')
    manifest, payloads, inputs = prepare(root, recipe_path, encoder)
    status, written = write_bundle(root, output, payloads, inputs, plan=plan, verify_only=verify_only)
    return {'status': status, 'manifestSha256': sha256_hex_digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'volumes': [{'id': v['id'], 'musicId': v['musicId'], 'forcePlayMusic': v['forcePlayMusic'], 'tracks': v['tracks']}
                        for v in manifest['volumes']],
            'files': [{'path': name, 'bytes': len(value), 'sha256': sha256_hex_digest(value)} for name, value in sorted(payloads.items())]}
