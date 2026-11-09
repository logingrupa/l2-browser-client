from __future__ import annotations

import copy
import struct

from native_assets_lib.gltf import json_bytes
from native_assets_lib.world_music import Inputs, write_bundle
from native_store.store_paths import refuse_reparse_points
from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_assets_lib.strict_json import decode_strict_json

KIND = 'native-map-ambience'
FIELDS = ['id', 'exportIndex', 'x', 'y', 'z', 'soundRadius', 'soundVolume', 'soundPitch', 'ambientSoundType',
          'ambientRandom', 'ambientSoundStartTime', 'sound', 'zone', 'zoneNumber', 'group']
MAX_WAV = 8_000_000


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


def properties(declaration):
    values = {}
    for prop in declaration['properties']:
        require_condition(prop['name'] not in values and prop['arrayIndex'] is None, 'Duplicate/array emitter property: ' + prop['name'])
        values[prop['name']] = prop.get('value')
    return values


def emitter_row(item, sound_keys):
    declaration = item['declaration']
    require_condition(declaration['class'] == 'AmbientSoundObject' and declaration['id'] == item['id'], 'Unexpected ambient declaration')
    values = properties(declaration)
    location = values.get('Location')
    require_condition(isinstance(location, dict) and all(isinstance(location.get(k), (int, float)) for k in 'XYZ'), 'Emitter lacks Location')
    reference = item.get('soundReference')
    sound = None
    if reference is not None:
        sound = reference.casefold()
        require_condition(sound in sound_keys, 'Emitter references an unexported sound: ' + reference)
    region = {field['name']: field.get('value') for field in values.get('Region') or []} if isinstance(values.get('Region'), list) else {}
    zone = region.get('Zone')
    row = {'id': item['object'], 'exportIndex': item['exportIndex'], 'x': location['X'], 'y': location['Y'], 'z': location['Z'],
           'soundRadius': values.get('SoundRadius'), 'soundVolume': values.get('SoundVolume'), 'soundPitch': values.get('SoundPitch'),
           'ambientSoundType': values.get('AmbientSoundType'), 'ambientRandom': values.get('AmbientRandom'),
           'ambientSoundStartTime': values.get('AmbientSoundStartTime'), 'sound': sound,
           'zone': zone.get('object') if isinstance(zone, dict) else None, 'zoneNumber': region.get('ZoneNumber'),
           'group': values.get('Group')}
    require_condition(isinstance(row['soundRadius'], (int, float)) and row['soundRadius'] > 0 and type(row['soundVolume']) is int, 'Emitter radius/volume missing')
    return [row[name] for name in FIELDS]


def prepare(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = refuse_reparse_points(recipe_path)
    require_condition(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within the project root')
    recipe = decode_strict_json(inputs.pin(recipe_path.relative_to(inputs.root).as_posix()))
    require_condition(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-map-ambience-bundle', 'Unsupported ambience recipe')
    export = recipe['export']
    base = export['path'].rstrip('/')
    receipts = {name: inputs.read(base + '/' + name, export[key]) for name, key in
                (('run.json', 'runSha256'), ('SHA256-MANIFEST.json', 'manifestSha256'))}
    run = decode_strict_json(receipts['run.json'])
    require_condition(run.get('kind') == 'native-map-ambient-audio-products' and run.get('settings', {}).get('runtimeStaging') is False, 'Unexpected ambient export owner')
    listed = {row['path']: row for row in decode_strict_json(receipts['SHA256-MANIFEST.json'])['files']}

    def product(name, max_bytes=None):
        row = listed.get(name)
        require_condition(row is not None, 'Export manifest does not list ' + name)
        return inputs.read(base + '/' + name, row['sha256'], row['bytes'])

    inventory_bytes, coverage_bytes = product('inventory.json'), product('coverage.json')
    require_condition(sha256_hex_digest(inventory_bytes) == export['inventorySha256'] and sha256_hex_digest(coverage_bytes) == export['coverageSha256'], 'Export inventory/coverage pin differs')
    inventory, coverage = decode_strict_json(inventory_bytes, 64_000_000), decode_strict_json(coverage_bytes, 64_000_000)
    require_condition(inventory.get('kind') == 'native-map-ambient-source-inventory' and inventory.get('expectedInventoryMatch') is True and
            coverage.get('status') == 'referenced-dependencies-exported-omissions-unresolved' and
            coverage.get('inventorySha256') == sha256_hex_digest(inventory_bytes), 'Ambient export is not a verified complete closure')
    results = {row['referenceKey']: row for row in coverage['sounds']}
    sounds, payloads = [], {}
    for row in inventory['sounds']:
        result = results.get(row['referenceKey'])
        require_condition(result and result['status'] == 'exported-and-verified', 'Sound not exported: ' + row['referenceKey'])
        audio = result['products']['audio']
        require_condition(audio['mime'] == 'audio/wav' and audio['metadata'].get('encodedAudioUnchanged') is True, 'Ambient sound is not an unchanged WAV')
        wav = product(audio['path'])
        require_condition(sha256_hex_digest(wav) == audio['sha256'] and len(wav) == audio['bytes'] <= MAX_WAV, 'Ambient WAV differs from coverage')
        facts = wav_facts(wav)
        name = 'audio/' + sha256_hex_digest(wav) + '.wav'
        require_condition(payloads.get(name, wav) == wav, 'Conflicting ambient payload')
        payloads[name] = wav
        sounds.append({'key': row['referenceKey'], 'object': row['export']['object'], 'id': row['id'], 'file': name,
                       'bytes': len(wav), 'sha256': sha256_hex_digest(wav), 'mime': 'audio/wav', **facts,
                       'exportIndex': row['export']['exportIndex'], 'occurrences': row['occurrences'],
                       'sourcePackage': {k: row['sourcePackage'][k] for k in ('relativePath', 'sha256', 'sourceHost', 'sourcePath')}})
    keys = {sound['key'] for sound in sounds}
    emitters = [emitter_row(item, keys) for item in inventory['objects']]
    require_condition(len(emitters) == inventory['counts']['declarations'] == len({row[0] for row in emitters}), 'Emitter census differs')
    spec = recipe['radiusMultiplier']
    image = inputs.read(spec['path'], spec['sha256'], spec['bytes'])
    multiplier = pe_export_f32(image, spec['export'])
    default_radius = pe_export_f32(image, spec['defaultRadiusExport'])
    inputs.unchanged()
    files = [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data), 'mime': 'audio/wav'} for name, data in sorted(payloads.items())]
    types = {}
    for row in emitters:
        key = 'omitted' if row[8] is None else str(row[8])
        types[key] = types.get(key, 0) + 1
    manifest = {'schemaVersion': 1, 'kind': KIND, 'source': {'host': inventory['map']['sourceHost'], 'map': copy.deepcopy(inventory['map'])},
                'export': {'path': base, 'runSha256': export['runSha256'], 'manifestSha256': export['manifestSha256'],
                           'inventorySha256': export['inventorySha256'], 'coverageSha256': export['coverageSha256'],
                           'inputLockSha256': run['inputLockSha256'], 'implementation': run['implementation']},
                'inputs': [copy.deepcopy(v) for v in sorted(inputs.records.values(), key=lambda r: r['path'])],
                'coordinates': {'space': 'native Unreal world units (X, Y, Z-up)', 'browser': 'browser = (X, Z, Y) * 0.01, as section placements'},
                'radius': {'unit': 'native Unreal units, the same space as Location',
                           'maxRadiusMultiplier': {**multiplier, 'image': {'path': spec['path'], 'sha256': spec['sha256'], 'sourceHost': spec['sourceHost'], 'sourcePath': spec['sourcePath']},
                                                   'status': 'static initializer in original Core.dll .data; runtime/INI overrides unobserved'},
                           'defaultRadius': {**default_radius, 'status': 'static initializer; consumer unverified'},
                           'evidence': 'ALAudio ambient helper compares squared distance with (SoundRadius * Core!GAudioMaxRadiusMultiplier)^2 (backend-closure/ambient-dispatch REPORT.md)'},
                'emitterFields': FIELDS, 'emitters': emitters, 'sounds': sounds, 'files': files,
                'coverage': {'emitters': len(emitters), 'emittersWithSound': sum(row[11] is not None for row in emitters),
                             'sounds': len(sounds), 'ambientSoundType': dict(sorted(types.items())), 'runtimeConnected': False},
                'limits': ['Authored fields only; omitted values are null and their class defaults are unresolved.',
                           'Native AmbientSoundType/AmbientRandom/StartTime semantics are conditional static evidence, not observed playback.',
                           'Attenuation, listener, looping and voice priority are browser presentation choices; native audible parity is unverified.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require_condition(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path)
    status, written = write_bundle(root, output, payloads, inputs, plan=plan, verify_only=verify_only)
    return {'status': status, 'manifestSha256': sha256_hex_digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'radiusMultiplier': manifest['radius']['maxRadiusMultiplier']['value'], 'filesWritten': written,
            'sourceInputsUnchanged': True, 'fileCount': len(payloads)}
