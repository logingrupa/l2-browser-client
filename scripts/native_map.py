#!/usr/bin/env python3
"""Lossless, bounded UE123/28 map migration; deliberately no guessed world mesh.

Usage: python scripts/native_map.py --client <staged-root> --recipe
recipes/native-map-20_20.json --output <destination-job> [--verify]

Extracts actor tags, exact native G16 samples, terrain layer/deco tags and bitmap
words. The source package payload remains available for unsupported native data.
Generated static-mesh requests feed the existing native_assets.py converter.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import platform
import shutil
import struct
import sys
import tempfile
import zlib

from native_assets_lib.gltf import json_bytes, safe_name
from native_catalog.ue2 import FormatError, Package, Reader

SCHEMA = 1
HAS_STACK = 0x02000000
FORMAT_REFERENCES = {
    'UEViewer': 'a0bfb468d42be831b126632fd8a0ae6b3614f981',
    'UEViewerSources': ['Unreal/UnrealMaterial/UnMaterial2.h:UMaterial::Serialize/FMipmap',
                        'Unreal/UnrealMaterial/UnTexture2.cpp:UTexture::Serialize',
                        'Unreal/UnCoreSerialize.cpp:SerializeLazyArray'],
    'UnrealLibrary': 'e26cdc471bbf81cdcadd6ccffbf2d68fbe0a6236',
    'UnrealLibrarySource': 'src/Core/UStateFrame.cs',
}
GAPS = [
    'Raw migration only: no reconstructed Babylon world or visual parity is claimed.',
    'Terrain elevation, DrawScale/Rotation composition, native axes and row direction require native validation; no guessed terrain mesh is emitted.',
    'Topology uint32 words are exact; quad indexing and edge/visibility semantics are not yet applied to triangles.',
    'Omitted actor properties remain unresolved class defaults, including collision flags; no authoritative collision or navigation is generated.',
    'BSP, terrain-sector native payloads, lighting, water, sounds and emitters remain preserved source data, not reconstructed behavior.',
    'AmbientSoundObject LevelObjects are exported separately from actors; serialized sound/position/volume/radius/random fields do not establish native playback, class defaults or audible range.',
    'Section selection uses serialized actor origins, not geometry intersections; overlapping meshes with origins outside the bounds can be excluded.',
    'Static-mesh conversion requests preserve identities; material animation, blending and browser placement still require validation.',
]
TRANSFORMS = ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')
COLLISION = ('bCollideActors', 'bBlockActors', 'bBlockPlayers', 'bBlockKarma',
             'bBlockZeroExtentTraces', 'bBlockNonZeroExtentTraces', 'bUseCylinderCollision',
             'CollisionRadius', 'CollisionHeight')
BITMAPS = ('QuadVisibilityBitmap', 'EdgeTurnBitmap', 'QuadVisibilityBitmapOrig', 'EdgeTurnBitmapOrig')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_path(root, relative):
    safe_name(relative)
    if any(part.rstrip(' .') != part for part in relative.split('/')):
        raise ValueError('Non-canonical map artifact path')
    target = root.joinpath(*relative.split('/'))
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Map path escapes its root')
    current = root.resolve()
    for part in relative.split('/'):
        current = current / part
        if current.exists() and (current.is_symlink() or getattr(current.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError('Map paths must not contain reparse points')
    return target


def implementation():
    scripts = Path(__file__).parent
    files = ('native_map.py', 'native_catalog/ue2.py', 'native_assets_lib/gltf.py')
    return {'sha256': sha(json_bytes({name: file_hash(scripts / name) for name in files})),
            'python': platform.python_version(), 'zlib': zlib.ZLIB_RUNTIME_VERSION,
            'formatReferences': FORMAT_REFERENCES}


def source_range(data, path, start, end):
    if not 0 <= start <= end <= len(data):
        raise FormatError('Raw map range exceeds source')
    return {'path': path, 'offset': start, 'bytes': end - start, 'sha256': sha(data[start:end])}


def actor_properties(package, item):
    """UE123 state frame precedes UObject properties when RF_HasStack is set."""
    if package.summary['version'] != 123 or package.summary['licenseeVersion'] != 28:
        raise FormatError('Map actor layout supports only verified UE123/licensee28')
    reader = Reader(package.data, item['offset'], item['offset'] + item['size'])
    state = None
    if item['flags'] & HAS_STACK:
        state = {'nodeIndex': reader.compact(), 'stateNodeIndex': reader.compact(),
                 'probeMaskHex': f'{reader.number("Q"):016x}', 'latentAction': reader.number('I')}
        state['offset'] = reader.compact() if state['nodeIndex'] else None
        package.object_name(state['nodeIndex'])
        package.object_name(state['stateNodeIndex'])
    prefix_end = reader.position
    props, tail = package.properties({**item, 'offset': reader.position, 'size': reader.end - reader.position})
    return props, tail, state, prefix_end


def bitmap_words(raw):
    reader = Reader(raw)
    count = reader.count(1_048_576)
    offset = reader.position
    words = [reader.number('I') for _ in range(count)]
    if reader.position != reader.end:
        raise FormatError('Bitmap contains bytes beyond its declared uint32 count')
    return {'wordCount': count, 'bitCapacity': count * 32, 'setBitCount': sum(word.bit_count() for word in words),
            'dataOffset': offset, 'words': words}


def decode_property(package, prop, raw_path, depth=0):
    if depth > 8:
        raise FormatError('Map property nesting exceeds eight levels')
    raw = bytes.fromhex(prop['payloadHex'])
    result = {key: prop[key] for key in ('name', 'type', 'arrayIndex', 'structName', 'offset', 'status')}
    result['payload'] = source_range(package.data, raw_path, prop['payloadOffset'], prop['payloadOffset'] + len(raw))
    if 'value' in prop:
        result['value'] = prop['value']
    elif prop['type'] == 10 and prop['structName'] in ('Vector', 'Rotator'):
        kind = prop['structName']
        labels = {'Vector': ('X', 'Y', 'Z'), 'Rotator': ('Pitch', 'Yaw', 'Roll')}
        count = 3
        reader = Reader(raw)
        values = [reader.number('i' if kind == 'Rotator' else 'f') for _ in range(count)]
        if reader.position != reader.end or not all(math.isfinite(value) for value in values):
            raise FormatError('Invalid map numeric struct: ' + kind)
        result['value'] = dict(zip(labels[kind], values))
        result['status'] = 'decoded'
    elif prop['type'] == 10 and prop['structName'] in ('TerrainLayer', 'Matrix', 'Plane', 'Range', 'RangeVector', 'PointRegion'):
        nested, tail = package.properties({'offset': prop['payloadOffset'], 'size': len(raw)})
        if tail.position != tail.end:
            raise FormatError(prop['structName'] + ' has unconsumed tagged bytes')
        result.update(status='decoded-tags', value=[decode_property(package, field, raw_path, depth + 1) for field in nested])
    elif prop['type'] == 9 and prop['name'] == 'DecoLayers':
        reader = Reader(package.data, prop['payloadOffset'], prop['payloadOffset'] + len(raw))
        values = []
        for _ in range(reader.count(4096)):
            nested, tail = package.properties({'offset': reader.position, 'size': reader.end - reader.position})
            reader.position = tail.position
            values.append([decode_property(package, field, raw_path, depth + 1) for field in nested])
        if reader.position != reader.end:
            raise FormatError('DecoLayers has trailing bytes')
        result.update(status='decoded-tags', value=values)
    elif prop['type'] == 9 and prop['name'] in BITMAPS:
        result.update(status='decoded-uint32-array', value=bitmap_words(raw))
    elif prop['type'] == 9 and prop['name'] == 'Skins':
        reader = Reader(raw)
        references = [reader.compact() for _ in range(reader.count(4096))]
        if reader.position != reader.end:
            raise FormatError('Skins has trailing bytes')
        result.update(status='decoded', value=[{'index': ref, 'object': package.object_name(ref)} for ref in references])
    return result


def property_value(properties, name):
    matches = [prop for prop in properties if prop['name'] == name and prop['arrayIndex'] in (None, 0)]
    if len(matches) > 1:
        raise FormatError('Ambiguous scalar map property: ' + name)
    return matches[0].get('value') if matches else None


def explicit_properties(properties, names):
    return {name: {'status': 'serialized', 'value': property_value(properties, name)}
            if any(prop['name'] == name for prop in properties) else {'status': 'omitted-class-default-unresolved'}
            for name in names}


def ambient_sound_object(package, item, raw_path):
    """Interlude Engine.AmbientSoundObject extends LevelObject, not Actor.

    Its property list has no Actor state frame. Preserve authored tags and raw
    spans, including unknown fields/tail, without inventing defaults or audio
    dispatch. Do not apply Actor collision, transform or section/Z policies.
    """
    if item['classObject'] != 'Engine.AmbientSoundObject' or item['flags'] & HAS_STACK:
        raise FormatError('Unsupported ambient LevelObject class/state-frame layout')
    props, tail, state, prefix_end = actor_properties(package, item)
    if state is not None or prefix_end != item['offset']:
        raise FormatError('Ambient LevelObject unexpectedly has an Actor prefix')
    return {'id': 'interlude:' + item['object'], 'object': item['object'],
            'class': item['className'], 'classObject': item['classObject'],
            'exportIndex': item['exportIndex'], 'objectFlags': item['flags'],
            'authoredPropertiesOnly': True,
            'properties': [decode_property(package, prop, raw_path) for prop in props],
            'nativePayload': source_range(package.data, raw_path, item['offset'], item['offset'] + item['size']),
            'nativeTail': source_range(package.data, raw_path, tail.position, tail.end),
            'classDefaults': 'not-resolved-by-raw-map-export', 'nativePlayback': 'unverified'}


def selected_by_origin(properties, section):
    position = property_value(properties, 'Location')
    if position is None:
        return None
    return all(section['min'][index] <= position[axis] <= section['max'][index]
               for index, axis in enumerate('XY'))


def read_g16(package, item):
    """Verified Lineage UE123/28 UMaterial prefix + FMipmap TLazyArray layout."""
    if package.summary['version'] != 123 or package.summary['licenseeVersion'] != 28:
        raise FormatError('G16 texture layout supports only verified UE123/licensee28')
    properties, reader = package.properties(item)
    if property_value(properties, 'Format') != 10:
        raise FormatError('Terrain height texture must be native TEXF_G16 (10)')
    reserved = reader.number('i')
    mips = []
    for level in range(reader.count(32)):
        skip = reader.number('i')
        length = reader.count(128 * 1024 * 1024)
        start = reader.position
        raw = reader.take(length)
        if skip != reader.position:
            raise FormatError('G16 lazy array end differs from its declared skip position')
        width, height = reader.number('i'), reader.number('i')
        ubits, vbits = reader.number('B'), reader.number('B')
        if not 1 <= width <= 16384 or not 1 <= height <= 16384 or length != width * height * 2:
            raise FormatError('G16 sample dimensions/bytes disagree')
        if ubits > 14 or vbits > 14 or width != 1 << ubits or height != 1 << vbits:
            raise FormatError('G16 mip dimensions/bits disagree')
        mips.append({'level': level, 'width': width, 'height': height, 'uBits': ubits, 'vBits': vbits,
                     'sourceOffset': start, 'sourceBytes': length, 'sha256': sha(raw), 'raw': raw})
    if reader.position != reader.end or not mips:
        raise FormatError('Missing G16 mips or unconsumed texture bytes')
    if (mips[0]['width'], mips[0]['height']) != (property_value(properties, 'USize'), property_value(properties, 'VSize')):
        raise FormatError('G16 mip0 dimensions differ from texture tags')
    return {'format': 'TEXF_G16', 'reservedNativeInt': reserved, 'mips': mips}


def png16(raw, width, height):
    """16-bit grayscale PNG, exact samples/order; no normalization or palette."""
    if len(raw) != width * height * 2:
        raise ValueError('PNG dimensions disagree with G16 bytes')
    big = bytearray(len(raw))
    big[0::2], big[1::2] = raw[1::2], raw[0::2]
    scanlines = b''.join(b'\0' + big[row * width * 2:(row + 1) * width * 2] for row in range(height))

    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b'')


def validate_recipe(recipe):
    if recipe.get('schemaVersion') != SCHEMA or recipe.get('kind') != 'native-map-raw':
        raise ValueError('Expected schemaVersion 1 native-map-raw recipe')
    safe_name(recipe['map'])
    section = recipe['section']
    if section.get('selection') != 'serialized-origin-xy-inclusive':
        raise ValueError('Unsupported map section selection')
    for key in ('min', 'max'):
        if len(section[key]) != 2 or not all(type(v) in (int, float) and math.isfinite(v) for v in section[key]):
            raise ValueError('Map section must have finite XY bounds')
    if any(section['min'][i] >= section['max'][i] for i in range(2)):
        raise ValueError('Map section has empty/reversed bounds')


class MapSources:
    def __init__(self, client):
        self.client, self.dependencies, self.loaded, self.paths = client, {}, {}, {}
        for folder in ('maps', 'staticmeshes', 'textures', 'systextures', 'system', 'animations', 'sounds'):
            if not (client / folder).is_dir():
                continue
            for path in sorted((client / folder).iterdir()):
                if path.is_file() and path.suffix.lower() in ('.unr', '.usx', '.utx', '.u', '.ukx', '.uax', '.usk'):
                    self.paths.setdefault(path.stem.casefold(), []).append(path.relative_to(client).as_posix())

    def get(self, relative):
        if relative not in self.loaded:
            path = safe_path(self.client, relative)
            data = path.read_bytes()
            self.dependencies[relative] = {'sha256': sha(data), 'bytes': len(data)}
            self.loaded[relative] = Package(data, path.name)
        return self.loaded[relative]

    def resolve(self, reference, expected):
        candidates = self.paths.get(reference.split('.')[0].casefold(), [])
        if len(candidates) != 1:
            raise FormatError('Package missing/ambiguous: ' + reference)
        package = self.get(candidates[0])
        matches = [item for item in package.exports if item['object'].casefold() == reference.casefold()]
        if len(matches) != 1 or matches[0]['className'] != expected:
            raise FormatError('Exact qualified object/class unresolved: ' + reference)
        return candidates[0], package, matches[0]


def static_mesh_request(relative, item):
    # Converter resolves native materials automatically. Its optional `materials`
    # field is a list of explicit slot=object overrides, never an enable flag.
    return {'kind': 'model', 'package': relative, 'object': item['object']}


def build_map(client, recipe, write):
    sources = MapSources(client)
    package = sources.get(recipe['map'])
    if recipe.get('sourceSha256') and package.source_hash != recipe['sourceSha256']:
        raise ValueError('Map source differs from recipe SHA256')
    if (package.summary['version'], package.summary['licenseeVersion']) != (123, 28):
        raise FormatError('Raw map adapter supports only verified UE123/licensee28')
    raw_path = 'raw/map.unwrapped.bin'
    write(raw_path, package.data)
    exports, actors, terrains, errors, ambient_objects = [], [], [], [], []
    static_refs = {}
    for item in package.exports:
        exports.append({**item, 'id': 'interlude:' + item['object'],
                        'nativePayload': source_range(package.data, raw_path, item['offset'], item['offset'] + item['size'])})
        if item['classObject'] == 'Engine.AmbientSoundObject':
            try:
                ambient_objects.append(ambient_sound_object(package, item, raw_path))
            except (ValueError, KeyError) as error:
                errors.append({'object': item['object'], 'class': item['className'], 'stage': 'ambient-object-tags', 'error': str(error)})
            continue
        if not item['flags'] & HAS_STACK:
            continue
        try:
            props, tail, state, prefix_end = actor_properties(package, item)
            props = [decode_property(package, prop, raw_path) for prop in props]
            actor = {'id': 'interlude:' + item['object'], 'object': item['object'], 'class': item['className'],
                     'classObject': item['classObject'], 'exportIndex': item['exportIndex'],
                     'stateFrame': state, 'stateFrameBytes': source_range(package.data, raw_path, item['offset'], prefix_end),
                     'properties': props, 'sourceTransform': explicit_properties(props, TRANSFORMS),
                     'collision': explicit_properties(props, COLLISION),
                     'nativeTail': source_range(package.data, raw_path, tail.position, tail.end),
                     'sectionOriginSelected': selected_by_origin(props, recipe['section'])}
            actors.append(actor)
            if item['className'] == 'StaticMeshActor':
                ref = property_value(props, 'StaticMesh')
                actor['staticMesh'] = ref
                actor['materialOverrides'] = [prop for prop in props if prop['name'] in ('Skins', 'Texture')]
                if ref and ref['object'] and actor['sectionOriginSelected']:
                    static_refs.setdefault(ref['object'], []).append(actor['id'])
            if item['className'] == 'TerrainInfo':
                terrains.append(actor)
        except (ValueError, KeyError) as error:
            errors.append({'object': item['object'], 'class': item['className'], 'stage': 'actor-tags', 'error': str(error)})
    terrain_output = []
    for terrain_index, actor in enumerate(terrains):
        props = actor['properties']
        terrain = {'id': actor['id'], 'sourceTransform': actor['sourceTransform'],
                   'terrainScale': property_value(props, 'TerrainScale'),
                   'layers': [{'index': prop['arrayIndex'] or 0, 'properties': prop['value']} for prop in props if prop['name'] == 'Layers'],
                   'decoLayers': property_value(props, 'DecoLayers'),
                   'nativeTail': actor['nativeTail'], 'bitmaps': []}
        for prop in props:
            if prop['name'] in BITMAPS:
                name = f'terrain/{terrain_index}/{prop["name"]}.uint32le'
                words = prop['value']['words']
                write(name, struct.pack('<' + str(len(words)) + 'I', *words))
                terrain['bitmaps'].append({'name': prop['name'], 'path': name,
                    **{key: value for key, value in prop['value'].items() if key not in ('words', 'dataOffset')},
                    'indexing': 'native serialized uint32 word order; quad indexing not applied'})
        try:
            ref = property_value(props, 'TerrainMap')['object']
            relative, height_package, height_item = sources.resolve(ref, 'Texture')
            height = read_g16(height_package, height_item)
            native_name = f'terrain/{terrain_index}/height-texture-export.bin'
            write(native_name, height_package.data[height_item['offset']:height_item['offset'] + height_item['size']])
            height['source'] = {'package': relative, 'object': ref, 'exportIndex': height_item['exportIndex'],
                                'exportOffset': height_item['offset'], 'nativeExport': native_name}
            for mip in height['mips']:
                raw = mip.pop('raw')
                mip['rawPath'] = f'terrain/{terrain_index}/height-mip{mip["level"]}.uint16le'
                mip['pngPath'] = f'terrain/{terrain_index}/height-mip{mip["level"]}.png'
                write(mip['rawPath'], raw)
                write(mip['pngPath'], png16(raw, mip['width'], mip['height']))
                samples = struct.unpack('<' + str(len(raw) // 2) + 'H', raw)
                mip.update(minSample=min(samples), maxSample=max(samples), units='native unsigned samples; no elevation transform',
                           pngEncoding='16-bit grayscale; exact values and serialized row order; not normalized')
            terrain['height'] = height
        except (ValueError, KeyError, TypeError) as error:
            errors.append({'object': actor['object'], 'stage': 'height-texture', 'error': str(error)})
        terrain_output.append(terrain)
    requests, bindings = [], []
    for reference, placed in sorted(static_refs.items()):
        try:
            relative, _, item = sources.resolve(reference, 'StaticMesh')
            requests.append(static_mesh_request(relative, item))
            bindings.append({'sourceObject': reference, 'assetId': 'interlude:' + reference, 'actors': placed})
        except (ValueError, KeyError) as error:
            errors.append({'object': reference, 'stage': 'static-mesh-request', 'error': str(error)})
    write('exports.json', json_bytes({'exports': exports, 'imports': package.imports, 'names': package.names}))
    write('actors.json', json_bytes(actors))
    write('ambient-sounds.json', json_bytes({'schemaVersion': 1, 'kind': 'native-ambient-object-metadata',
        'sourcePackageSha256': package.source_hash, 'objects': ambient_objects,
        'scope': 'Full map serialized LevelObjects; no Actor section filter, resolved class defaults, exported sound payloads or playback policy.'}))
    write('terrain.json', json_bytes(terrain_output))
    write('static-mesh-requests.json', json_bytes(requests))
    write('section-bindings.json', json_bytes(bindings))
    class_counts = dict(sorted(Counter(item['className'] for item in package.exports).items()))
    coverage = {'exports': len(package.exports), 'exportsPreservedRaw': len(exports), 'byClass': class_counts,
                'stackActors': sum(bool(item['flags'] & HAS_STACK) for item in package.exports),
                'actorsDecoded': len(actors), 'staticMeshActorsDecoded': sum(actor['class'] == 'StaticMeshActor' for actor in actors),
                'ambientSoundObjectsDecoded': len(ambient_objects),
                'ambientSoundObjectsWithTail': sum(obj['nativeTail']['bytes'] > 0 for obj in ambient_objects),
                'terrainInfosDecoded': len(terrains), 'terrainHeightsDecoded': sum('height' in terrain for terrain in terrain_output),
                'sectionActors': sum(actor['sectionOriginSelected'] is True for actor in actors),
                'sectionStaticMeshActors': sum(len(placed) for placed in static_refs.values()),
                'sectionUniqueStaticMeshes': len(static_refs), 'staticMeshRequests': len(requests),
                'sectionActorsWithoutSerializedLocation': sum(actor['sectionOriginSelected'] is None for actor in actors)}
    manifest = {'schemaVersion': SCHEMA, 'kind': 'native-map-raw', 'id': 'interlude-map:' + package.package_name,
                'support': 'raw-data-extracted' if not errors else 'partial-raw-data-extracted',
                'recipe': recipe, 'nativePackage': package.summary, 'sourcePackageSha256': package.source_hash,
                'coordinates': {'space': 'native Unreal source units', 'rotation': 'serialized native Pitch/Yaw/Roll integers',
                                'clientTransform': None, 'elevationFormula': None},
                'coverage': coverage, 'gaps': GAPS, 'unsupported': errors,
                'files': {'actors': 'actors.json', 'exports': 'exports.json', 'terrain': 'terrain.json',
                          'ambientSounds': 'ambient-sounds.json',
                          'staticMeshRequests': 'static-mesh-requests.json', 'sectionBindings': 'section-bindings.json', 'rawMap': raw_path}}
    write('manifest.json', json_bytes(manifest))
    return manifest, sources.dependencies


def verify_map(client, output):
    client, output = Path(client).resolve(), Path(output).resolve()
    receipt = json.loads(safe_path(output, 'receipt.json').read_text(encoding='utf-8'))
    if receipt.get('schemaVersion') != SCHEMA or receipt.get('kind') != 'native-map-raw':
        raise ValueError('Invalid map receipt')
    if receipt['implementation'] != implementation():
        raise ValueError('Map implementation/runtime differs from receipt; rebuild required')
    for root, table in ((client, receipt['dependencies']), (output, receipt['outputs'])):
        for relative, expected in table.items():
            path = safe_path(root, relative)
            if not path.is_file() or path.stat().st_size != expected['bytes'] or file_hash(path) != expected['sha256']:
                raise ValueError('Map hash/length mismatch: ' + relative)
    actual = {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()}
    if actual != {'receipt.json', *receipt['outputs']}:
        raise ValueError('Map output file set differs from receipt')
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    if sha(json_bytes(manifest['recipe'])) != receipt['recipeSha256']:
        raise ValueError('Map recipe differs from receipt')
    return {'cacheHit': True, 'verified': True, 'support': manifest['support'], 'coverage': manifest['coverage'],
            'gaps': manifest['gaps'], 'unsupported': manifest['unsupported'], 'outputs': len(receipt['outputs'])}


def migrate_map(client, recipe, output):
    client, output = Path(client).resolve(), Path(output).resolve()
    validate_recipe(recipe)
    if not client.is_dir() or output.is_relative_to(client) or client.is_relative_to(output):
        raise ValueError('Map output and read-only source must be separate, non-overlapping roots')
    prior = None
    receipt_path = output / 'receipt.json'
    if receipt_path.exists():
        prior = json.loads(receipt_path.read_text(encoding='utf-8'))
        if prior.get('schemaVersion') != SCHEMA or prior.get('kind') != 'native-map-raw':
            raise ValueError('Refuse to replace output with an invalid map receipt')
        owned = {'receipt.json', *prior['outputs']}
        for relative in owned:
            safe_path(output, relative)
        actual = {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()}
        if actual - owned:
            raise ValueError('Refuse to replace map output containing unowned files')
        if prior.get('recipeSha256') == sha(json_bytes(recipe)):
            try:
                return verify_map(client, output)
            except ValueError:
                pass
    elif output.exists() and any(output.iterdir()):
        raise ValueError('Refuse to replace nonempty map output without its receipt')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='native-map-', dir=output.parent) as temporary:
        work = Path(temporary)
        files = {}

        def write(relative, data):
            path = safe_path(work, relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            files[relative] = {'bytes': len(data), 'sha256': sha(data)}

        manifest, dependencies = build_map(client, recipe, write)
        receipt = {'schemaVersion': SCHEMA, 'kind': 'native-map-raw', 'recipeSha256': sha(json_bytes(recipe)),
                   'implementation': implementation(), 'dependencies': dependencies, 'outputs': files}
        (work / 'receipt.json').write_bytes(json_bytes(receipt))
        # Check that input files remained unchanged during extraction.
        for relative, entry in dependencies.items():
            if file_hash(safe_path(client, relative)) != entry['sha256']:
                raise ValueError('Map source changed during extraction: ' + relative)
        output.mkdir(parents=True, exist_ok=True)
        for path in sorted(work.rglob('*')):
            if path.is_file():
                target = safe_path(output, path.relative_to(work).as_posix())
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        # Remove only stale files explicitly owned by an earlier map receipt.
        for relative in (prior or {}).get('outputs', {}):
            if relative not in files:
                safe_path(output, relative).unlink(missing_ok=True)
    return {**verify_map(client, output), 'cacheHit': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        result = verify_map(args.client, args.output)
    else:
        if not args.recipe:
            parser.error('--recipe is required unless --verify is used')
        result = migrate_map(args.client, json.loads(args.recipe.read_text(encoding='utf-8-sig')), args.output)
    print(json_bytes(result).decode('utf-8'))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
