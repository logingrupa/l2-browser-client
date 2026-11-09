#!/usr/bin/env python3
import argparse
from collections import Counter
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
from native_catalog.ue2 import FormatError
from reference_client_guard import require_reference_client
from world.map_actor_properties import (BITMAPS, COLLISION, HAS_STACK, TRANSFORMS, actor_properties, ambient_sound_object,
                                        decode_property, explicit_properties, property_value, selected_by_origin, source_range)
from world.map_sources import MapSources, file_hash, require_lock_equal_client_path, safe_path, sha, static_mesh_request
from world.terrain_height_texture import png16, read_g16

MAP_MIGRATION_DESCRIPTION = ('Lossless, bounded UE123/28 map migration; deliberately no guessed world mesh. '
    'Usage: python scripts/native_map.py --client <staged-root> --recipe recipes/native-map-20_20.json '
    '--output <destination-job> [--verify]. Extracts actor tags, exact native G16 samples, terrain layer/deco tags '
    'and bitmap words. The source package payload remains available for unsupported native data. '
    'Generated static-mesh requests feed the existing native_assets.py converter.')
SCHEMA = 1
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


def implementation():
    scripts = Path(__file__).parent
    files = ('native_map.py', 'world/map_actor_properties.py', 'world/map_sources.py', 'world/terrain_height_texture.py',
             'native_catalog/ue2.py', 'native_assets_lib/gltf.py')
    return {'sha256': sha(json_bytes({name: file_hash(scripts / name) for name in files})),
            'python': platform.python_version(), 'zlib': zlib.ZLIB_RUNTIME_VERSION,
            'formatReferences': FORMAT_REFERENCES}


def validate_recipe(recipe):
    if recipe.get('schemaVersion') != SCHEMA or recipe.get('kind') != 'native-map-raw':
        raise ValueError('Expected schemaVersion 1 native-map-raw recipe')
    safe_name(recipe['map'])
    section = recipe.get('section')
    if section is None:
        return
    if section.get('selection') != 'serialized-origin-xy-inclusive':
        raise ValueError('Unsupported map section selection')
    for key in ('min', 'max'):
        if len(section[key]) != 2 or not all(type(v) in (int, float) and math.isfinite(v) for v in section[key]):
            raise ValueError('Map section must have finite XY bounds')
    if any(section['min'][i] >= section['max'][i] for i in range(2)):
        raise ValueError('Map section has empty/reversed bounds')


def build_map(client, recipe, write):
    sources = MapSources(client)
    package = sources.get(recipe['map'])
    if recipe.get('sourceSha256') and package.source_hash != recipe['sourceSha256']:
        raise ValueError('Map source differs from recipe SHA256')
    if (package.summary['version'], package.summary['licenseeVersion']) != (123, 28):
        raise FormatError('Raw map adapter supports only verified UE123/licensee28')
    section = recipe.get('section')
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
                     'nativeTail': source_range(package.data, raw_path, tail.position, tail.end)}
            if section is not None:
                actor['sectionOriginSelected'] = selected_by_origin(props, section)
            actors.append(actor)
            if item['className'] == 'StaticMeshActor':
                ref = property_value(props, 'StaticMesh')
                actor['staticMesh'] = ref
                actor['materialOverrides'] = [prop for prop in props if prop['name'] in ('Skins', 'Texture')]
                if ref and ref['object'] and (section is None or actor['sectionOriginSelected']):
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
                'staticMeshRequests': len(requests)}
    if section is None:
        coverage.update(staticMeshActorsWithMesh=sum(len(placed) for placed in static_refs.values()), uniqueStaticMeshes=len(static_refs))
    else:
        coverage.update(sectionActors=sum(actor['sectionOriginSelected'] is True for actor in actors),
                        sectionStaticMeshActors=sum(len(placed) for placed in static_refs.values()),
                        sectionUniqueStaticMeshes=len(static_refs),
                        sectionActorsWithoutSerializedLocation=sum(actor['sectionOriginSelected'] is None for actor in actors))
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
    recorded_files = [(require_lock_equal_client_path(client, relative), relative, expected) for relative, expected in receipt['dependencies'].items()]
    recorded_files += [(safe_path(output, relative), relative, expected) for relative, expected in receipt['outputs'].items()]
    for path, relative, expected in recorded_files:
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
        for relative, entry in dependencies.items():
            if file_hash(require_lock_equal_client_path(client, relative)) != entry['sha256']:
                raise ValueError('Map source changed during extraction: ' + relative)
        output.mkdir(parents=True, exist_ok=True)
        for path in sorted(work.rglob('*')):
            if path.is_file():
                target = safe_path(output, path.relative_to(work).as_posix())
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        for relative in (prior or {}).get('outputs', {}):
            if relative not in files:
                safe_path(output, relative).unlink(missing_ok=True)
    return {**verify_map(client, output), 'cacheHit': False}


def main():
    parser = argparse.ArgumentParser(description=MAP_MIGRATION_DESCRIPTION)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    require_reference_client(args.client)
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
