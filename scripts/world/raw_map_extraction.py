from collections import Counter
import struct

from native_assets_lib.gltf import json_bytes
from world.map_actor_properties import (BITMAPS, COLLISION, HAS_STACK, TRANSFORMS, actor_properties, ambient_sound_object, decode_property,
                                        explicit_properties, property_value, source_range)
from world.map_sources import MapSources, static_mesh_request
from world.reader_licensee_layouts import require_reviewed_reader_layout
from world.terrain_height_texture import png16, read_g16

RAW_MAP_MANIFEST_SCHEMA_VERSION = 1
RAW_MAP_GAPS = [
    'Raw migration only: no reconstructed Babylon world or visual parity is claimed.',
    'Terrain elevation, DrawScale/Rotation composition, native axes and row direction require native validation; no guessed terrain mesh is emitted.',
    'Topology uint32 words are exact; quad indexing and edge/visibility semantics are not yet applied to triangles.',
    'Omitted actor properties remain unresolved class defaults, including collision flags; no authoritative collision or navigation is generated.',
    'BSP, terrain-sector native payloads, lighting, water, sounds and emitters remain preserved source data, not reconstructed behavior.',
    'AmbientSoundObject LevelObjects are exported separately from actors; serialized sound/position/volume/radius/random fields do not establish native playback, class defaults or audible range.',
    'Static-mesh conversion requests preserve identities; material animation, blending and browser placement still require validation.',
]


def build_map(client, recipe, write):
    sources = MapSources(client)
    package = sources.get(recipe['map'])
    if recipe.get('sourceSha256') and package.source_hash != recipe['sourceSha256']:
        raise ValueError('Map source differs from recipe SHA256')
    require_reviewed_reader_layout("raw-map", package.summary)
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
            actors.append(actor)
            if item['className'] == 'StaticMeshActor':
                ref = property_value(props, 'StaticMesh')
                actor['staticMesh'] = ref
                actor['materialOverrides'] = [prop for prop in props if prop['name'] in ('Skins', 'Texture')]
                if ref and ref['object']:
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
                'staticMeshRequests': len(requests),
                'staticMeshActorsWithMesh': sum(len(placed) for placed in static_refs.values()), 'uniqueStaticMeshes': len(static_refs)}
    manifest = {'schemaVersion': RAW_MAP_MANIFEST_SCHEMA_VERSION, 'kind': 'native-map-raw', 'id': 'interlude-map:' + package.package_name,
                'support': 'raw-data-extracted' if not errors else 'partial-raw-data-extracted',
                'recipe': recipe, 'nativePackage': package.summary, 'sourcePackageSha256': package.source_hash,
                'coordinates': {'space': 'native Unreal source units', 'rotation': 'serialized native Pitch/Yaw/Roll integers',
                                'clientTransform': None, 'elevationFormula': None},
                'coverage': coverage, 'gaps': RAW_MAP_GAPS, 'unsupported': errors,
                'files': {'actors': 'actors.json', 'exports': 'exports.json', 'terrain': 'terrain.json',
                          'ambientSounds': 'ambient-sounds.json',
                          'staticMeshRequests': 'static-mesh-requests.json', 'sectionBindings': 'section-bindings.json', 'rawMap': raw_path}}
    write('manifest.json', json_bytes(manifest))
    return manifest, sources.dependencies
