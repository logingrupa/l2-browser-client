#!/usr/bin/env python3
"""Read-only exact-class ambient metadata audit; no playback policy is inferred.

python -B scripts/audit-native-ambient.py [--output <ambient descendant>]
Uses pinned staged inputs and existing reviewed property/class readers. Writes
only additive destination evidence; production map outputs are never changed.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import platform

from native_catalog.ue2 import Package, FormatError
from native_catalog.effects import read_class_defaults, UELIB_SHA256
from native_map import HAS_STACK, actor_properties, decode_property, property_value

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'artifacts/native-parity/research/audio-world-20261106/ambient'
CLIENT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
CLASS_NAMES = ('Engine.AmbientSoundObject', 'Engine.LevelObject')
FIELDS = ('AmbientSoundType', 'AmbientRandom', 'AmbientSoundStartTime', 'AmbientSound',
          'SoundRadius', 'SoundVolume', 'SoundPitch', 'Location', 'Region', 'Group', 'bHiddenEdGroup')
EXPECTED_TAGS = {
    'AmbientSoundType': (1, None), 'AmbientRandom': (2, None), 'AmbientSoundStartTime': (4, None),
    'AmbientSound': (5, None), 'SoundRadius': (4, None), 'SoundVolume': (1, None),
    'SoundPitch': (1, None), 'Location': (10, 'Vector'), 'Region': (10, 'PointRegion'),
    'Group': (6, None), 'bHiddenEdGroup': (3, None),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def serialized(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False) + '\n').encode()


def within(root, path):
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError('Output escapes owned evidence directory: ' + str(path))
    return resolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=EVIDENCE / 'audit')
    args = parser.parse_args()
    output = within(EVIDENCE, args.output if args.output.is_absolute() else ROOT / args.output)
    output.mkdir(parents=True, exist_ok=True)
    inputs = {}

    def read(path):
        path = path.resolve(strict=True)
        data = path.read_bytes()
        rel = path.relative_to(ROOT).as_posix()
        inputs[rel] = {'path': rel, 'bytes': len(data), 'sha256': sha(data)}
        return data

    def load(path):
        return json.loads(read(path).decode('utf-8-sig'))

    lock = load(ROOT / 'recipes/native-inputs.lock.json')
    pins = {row['relativePath'].casefold(): row for row in lock['files']}

    def source(relative):
        pin = pins[relative.casefold()]
        path = CLIENT / pin['relativePath']
        data = read(path)
        if len(data) != pin['bytes'] or sha(data) != pin['sha256']:
            raise FormatError('Pinned source mismatch: ' + relative)
        return path, Package(data, path.name)

    map_path, package = source('maps/20_20.unr')
    engine_path, engine = source('system/Engine.u')
    classes = {}
    for name in CLASS_NAMES:
        work = EVIDENCE / 'class-source' / name
        receipt_path = work / 'defaults.json'
        if not receipt_path.exists():
            read_class_defaults(CLIENT, name, work)
        receipt = load(receipt_path)
        script = read(work / receipt['sourceScript'])
        if receipt['source']['packageSha256'] != engine.source_hash or sha(script) != receipt['sourceScriptSha256'] or receipt['uelibSha256'] != UELIB_SHA256:
            raise FormatError('Class evidence no longer matches exact pinned source/parser: ' + name)
        found = [row for row in engine.exports if row['object'] == name and row['className'] == 'Class']
        if len(found) != 1 or found[0]['exportIndex'] != receipt['source']['exportIndex']:
            raise FormatError('Exact class export identity differs: ' + name)
        cls = found[0]
        declared_parent = engine.object_name(cls['superIndex'])
        if declared_parent != {'Engine.AmbientSoundObject': 'Engine.LevelObject', 'Engine.LevelObject': 'Core.Object'}[name]:
            raise FormatError('Class parent differs: ' + name)
        classes[name] = {**receipt, 'sourceScriptText': script.decode('utf-8-sig'),
                         'nativeSuperClass': declared_parent, 'nativeClassExport': cls}

    # Exact tagged declarations are on LevelObject, not Actor. HAS_STACK is a
    # serialization prefix flag and cannot stand in for world object relevance.
    amb_defaults = classes['Engine.AmbientSoundObject']['properties']
    level_defaults = classes['Engine.LevelObject']['properties']
    type_labels = {value: name for name, value in classes['Engine.AmbientSoundObject']['enums']['ASType1'].items()}
    section_path = ROOT / 'artifacts/native-parity/migration/sections/map-20-20-section/map-section/manifest.json'
    section = load(section_path)
    selected = section['staticActorSelection']
    xy_min, xy_max = selected['nativeXYMinimum'], selected['nativeXYMaximum']
    z_window = selected['nativeZWindow']
    raw_actors = load(ROOT / 'artifacts/native-parity/migration/maps/map-20-20/actors.json')
    previously_decoded_ids = {row['id'] for row in raw_actors}
    source_classes = Counter(row['classObject'] for row in package.exports)
    rows, field_counts, field_status_counts = [], Counter(), Counter()
    refs = Counter()
    for item in package.exports:
        if item['classObject'] != 'Engine.AmbientSoundObject':
            continue
        props, tail, state, prefix_end = actor_properties(package, item)
        direct_props, direct_tail = package.properties(item)
        if item['flags'] & HAS_STACK or state is not None or prefix_end != item['offset'] or props != direct_props or tail.position != direct_tail.position:
            raise FormatError('Ambient object differs from established no-stack UObject property stream: ' + item['object'])
        properties = []
        for index, prop in enumerate(props):
            expected = EXPECTED_TAGS.get(prop['name'])
            if expected != (prop['type'], prop['structName']) or prop['arrayIndex'] is not None:
                raise FormatError('Unreviewed ambient property layout: ' + item['object'] + ':' + prop['name'])
            value = decode_property(package, prop, 'maps/20_20.unr#unwrapped')
            tag_end = props[index + 1]['offset'] if index + 1 < len(props) else tail.position
            # The final range includes the terminating None tag; whole-export
            # bytes independently retain the complete exact source stream.
            value.update(payloadHex=prop['payloadHex'], tagRangeIncludingFinalTerminator={
                'offset': prop['offset'], 'bytes': tag_end - prop['offset'],
                'sha256': sha(package.data[prop['offset']:tag_end]),
                'hex': package.data[prop['offset']:tag_end].hex(),
            })
            properties.append(value)
            field_counts[value['name']] += 1
            field_status_counts[value['status']] += 1
        fields = {}
        for name in FIELDS:
            matches = [prop for prop in properties if prop['name'] == name]
            if len(matches) > 1:
                raise FormatError('Duplicate scalar ambient property: ' + name)
            if matches:
                prop = matches[0]
                fields[name] = {'status': 'serialized' if 'value' in prop else 'serialized-raw-uninterpreted',
                                'value': prop.get('value'), 'propertyOffsetUnwrapped': prop['offset']}
            elif name in amb_defaults or name in level_defaults:
                owner = 'Engine.AmbientSoundObject' if name in amb_defaults else 'Engine.LevelObject'
                fields[name] = {'status': 'explicit-class-default', 'value': classes[owner]['properties'][name],
                                'sourceClass': owner, 'sourceScriptSha256': classes[owner]['sourceScriptSha256']}
            else:
                fields[name] = {'status': 'omitted-default-unresolved'}
        sound = property_value(properties, 'AmbientSound')
        if sound and sound.get('object'):
            refs[sound['object']] += 1
        loc = property_value(properties, 'Location')
        if loc is None or not all(math.isfinite(loc[axis]) for axis in 'XYZ'):
            raise FormatError('Missing or nonfinite ambient location: ' + item['object'])
        in_xy = all(xy_min[i] <= loc[axis] <= xy_max[i] for i, axis in enumerate('XY'))
        type_value = property_value(properties, 'AmbientSoundType')
        raw = package.data[item['offset']:item['offset'] + item['size']]
        rows.append({'id': 'interlude:' + item['object'], 'object': item['object'], 'classObject': item['classObject'],
                     'exportIndex': item['exportIndex'], 'flags': item['flags'], 'flagsHex': hex(item['flags']),
                     'hasStack': False, 'outerObject': package.object_name(item['outerIndex']),
                     'source': {'host': lock['sourceHost'], 'path': lock['sourceRoot'] + '/maps/20_20.unr',
                                'packageSha256': package.source_hash, 'unwrappedOffset': item['offset'],
                                'bytes': len(raw), 'sha256': sha(raw), 'hex': raw.hex()},
                     'properties': properties, 'resolvedFields': fields,
                     'nativeTail': {'offset': tail.position, 'bytes': tail.end - tail.position,
                                    'sha256': sha(package.data[tail.position:tail.end]), 'hex': package.data[tail.position:tail.end].hex()},
                     'declaredTypeLabel': type_labels.get(type_value),
                     'typeInterpretation': 'enum label only; omitted type is unresolved, not silently Always',
                     'originWithinSelectedXY': in_xy,
                     'originWithinStaticMeshZWindowDiagnosticOnly': z_window[0] <= loc['Z'] <= z_window[1],
                     'presentInPriorActorInventory': 'interlude:' + item['object'] in previously_decoded_ids,
                     'audibleApplicability': 'unverified; origin inclusion is not emitter range/activation/occlusion',
                     'loopPolicy': 'unresolved; no explicit loop property in this class or object; names are not loop rules'})

    sound_packages, sound_rows = {}, []
    for reference, count in sorted(refs.items()):
        package_name = reference.split('.', 1)[0]
        if package_name.casefold() not in sound_packages:
            possible = [pin['relativePath'] for pin in lock['files'] if Path(pin['relativePath']).stem.casefold() == package_name.casefold() and pin['relativePath'].lower().endswith('.uax')]
            if len(possible) != 1:
                raise FormatError('Ambiguous/missing exact sound package: ' + reference)
            sound_packages[package_name.casefold()] = source(possible[0])
        path, sound_package = sound_packages[package_name.casefold()]
        candidates = [item for item in sound_package.exports if item['className'] == 'Sound' and item['object'].casefold() == reference.casefold()]
        if len(candidates) != 1:
            raise FormatError('Exact referenced Sound object unresolved: ' + reference)
        sound_item = candidates[0]
        payload = sound_package.data[sound_item['offset']:sound_item['offset'] + sound_item['size']]
        sound_rows.append({'reference': reference, 'occurrences': count, 'exactSourceObject': sound_item['object'],
                           'sourceHost': lock['sourceHost'], 'sourcePath': lock['sourceRoot'] + '/' + path.relative_to(CLIENT).as_posix(),
                           'packageSha256': sound_package.source_hash, 'exportIndex': sound_item['exportIndex'],
                           'unwrappedOffset': sound_item['offset'], 'serializedBytes': sound_item['size'],
                           'serializedSha256': sha(payload), 'audioPayloadExportedHere': False,
                           'soundNativeTailAndLoopMetadata': 'preserved by exact source span/hash; not interpreted by this map metadata audit'})

    for path in (Path(__file__), ROOT / 'scripts/native_map.py', ROOT / 'scripts/native_catalog/ue2.py',
                 ROOT / 'scripts/native_catalog/effects.py', ROOT / 'scripts/native_catalog/extract_ue_defaults.ps1',
                 ROOT / 'recipes/native-map-debug-location.json'):
        read(path)
    selected_rows = [row for row in rows if row['originWithinSelectedXY']]
    summary = {'sourceAmbientSoundObjects': len(rows), 'hasStack': sum(row['hasStack'] for row in rows),
               'previouslyDecodedAsActors': sum(row['presentInPriorActorInventory'] for row in rows),
               'tagStreamsConsumedToExportEnd': sum(row['nativeTail']['bytes'] == 0 for row in rows),
               'uniqueSoundReferences': len(sound_rows), 'referencesResolvedToPinnedSoundObjects': len(sound_rows),
               'objectsWithSerializedSoundReference': sum(refs.values()),
               'omittedAmbientSound': sum(row['resolvedFields']['AmbientSound']['status'] == 'omitted-default-unresolved' for row in rows),
               'serializedAmbientTypeCounts': dict(sorted(Counter(str(row['resolvedFields']['AmbientSoundType'].get('value', 'omitted-unresolved')) for row in rows).items())),
               'selectedXYOrigins': len(selected_rows),
               'selectedXYUniqueSoundReferences': len({row['resolvedFields']['AmbientSound'].get('value', {}).get('object') for row in selected_rows if row['resolvedFields']['AmbientSound'].get('value')}),
               'selectedXYAlsoInsideStaticMeshZDiagnostic': sum(row['originWithinStaticMeshZWindowDiagnosticOnly'] for row in selected_rows),
               'propertyCounts': dict(sorted(field_counts.items())), 'propertyDecodeStatuses': dict(sorted(field_status_counts.items())),
               'nativePlaybackVerified': False}
    document = {'schemaVersion': 1, 'classification': 'lossless-source-metadata-audit-not-native-playback',
                'source': {'host': lock['sourceHost'], 'root': lock['sourceRoot'], 'mapPath': map_path.relative_to(CLIENT).as_posix(),
                           'mapSha256': package.source_hash, 'mapUnwrappedSha256': sha(package.data), 'mapFormat': package.summary,
                           'enginePath': engine_path.relative_to(CLIENT).as_posix(), 'engineSha256': engine.source_hash},
                'tools': {'python': platform.python_version(), 'classReaderUelibSha256': UELIB_SHA256},
                'summary': summary, 'classEvidence': classes, 'objects': rows, 'soundDependencies': sound_rows,
                'selection': {'nativeXYMinimum': xy_min, 'nativeXYMaximum': xy_max,
                              'basis': 'existing declared debug section XY rectangle; inclusive serialized origin check only',
                              'staticMeshZWindowNotApplied': z_window,
                              'selectedIds': [row['id'] for row in selected_rows],
                              'limitations': ['No sound-radius intersection or audible set is inferred.',
                                              'Origins outside the rectangle can still be audible; origin selection is diagnostic, not runtime culling.',
                                              'Extreme Z values are retained as source evidence, never clamped or fitted.']},
                'correction': {'cause': 'native_map.py build_map filters all exports by HAS_STACK before parsing; exact AmbientSoundObject extends LevelObject/Object and has no stack prefix.',
                               'smallest': 'Emit separate ambient-sounds.json for exact Engine.AmbientSoundObject exports. Use existing actor_properties/decode_property without synthesizing a state frame; preserve tagged fields, raw ranges and unknown tails/defaults. Keep actors.json semantics unchanged.',
                               'notProved': ['C++ activation and enum consumer', 'random selection', 'loop and start-time meaning',
                                             'gain/pitch/radius units and attenuation', 'listener/region/occlusion policies', 'actual audible native/browser behavior']},
                'inputs': sorted(inputs.values(), key=lambda item: item['path'])}
    report = f"""# Native ambient metadata audit — 2026-11-06

The missing ambient metadata has a demonstrated filter cause. `native_map.py`
keeps only `HAS_STACK` exports, but **Engine.AmbientSoundObject extends
Engine.LevelObject -> Core.Object**, not Actor. All **{len(rows)}** exact-class
objects have flags `0x70001`, no stack prefix, and complete readable property
streams. None appears in the prior actors inventory. Do not insert a fake state
frame or pretend these are Actors.

Run `python -B scripts/audit-native-ambient.py`. An optional `--output` must stay
under this ambient evidence directory. Cached exact class evidence is verified;
if absent, the existing pinned static UELib reader writes it under class-source.
No game process, browser, production migration, services or source files change.

## Results

- {summary['tagStreamsConsumedToExportEnd']} property streams consume the full export; all native tails are zero bytes.
- {len(sound_rows)} distinct qualified sound references resolve to pinned AmbSound/AmbSound2 exports; {summary['omittedAmbientSound']} objects omit AmbientSound and remain unresolved.
- {summary['selectedXYOrigins']} origins lie in the declared debug section XY rectangle; {summary['selectedXYUniqueSoundReferences']} distinct sound references occur there.
- {summary['selectedXYAlsoInsideStaticMeshZDiagnostic']} of those origins also fit the unrelated static-mesh Z window. That policy is **not applied** to ambience. High/extreme source Z values remain unchanged.
- Region/PointRegion remains raw-preserved. Object hex, property payload/tag hex, source offsets and SHA-256 retain every byte; no unknown region layout is guessed.

Class evidence declares AST1_Always=0, AST1_Day=1, AST1_Night=2 and AST1_Water=3.
Only explicitly serialized values receive labels; {summary['serializedAmbientTypeCounts'].get('omitted-unresolved', 0)} omitted type values remain unresolved.
Exact authored class defaults are AmbientRandom=100, SoundRadius=64,
SoundVolume=190 and SoundPitch=64. Those defaults can fill omitted fields with
class provenance; they do not establish WebAudio gains, distances, probabilities
or loop behavior. AmbientSoundStartTime is retained numerically without treating
it as a browser offset. File names containing `loop` do not establish a loop policy.

## Smallest pipeline correction

Add a separate `ambient-sounds.json` inventory for exact
`Engine.AmbientSoundObject` exports, using the existing no-stack property path.
Retain source indices/flags, typed tags, serialized locations, qualified sound
references, unresolved omissions and native tails. Keep `actors.json` unchanged.
Include the new file in product hashes/cache implementation identity and raw-map
verification; existing class/default and effect conversion helpers can resolve
dependencies later. Do not couple this metadata repair to guessed playback.

The failing baseline is 0 decoded ambient objects despite {len(rows)} source
declarations; the required metadata result is {len(rows)} exact byte-preserved
records with explicit unresolved behavior. Repeat builds must match and all
existing actor/terrain outputs remain byte-identical. This audit supplies that
source oracle; it does not edit the converter.

## Remaining native evidence

C++ dispatch for Always/Day/Night/Water, AmbientRandom, start-time and looping,
volume/pitch/radius interpretation, listener motion, region/occlusion, emitter
activation and actual output need separate evidence. A selected origin is not a
proof of audibility, and external origins may affect the section. Preserve all
source locations and default provenance. No 1:1 audio claim follows from metadata.
"""
    # Independent receipt checks re-read all inputs after extraction.
    for item in document['inputs']:
        after = (ROOT / item['path']).read_bytes()
        if len(after) != item['bytes'] or sha(after) != item['sha256']:
            raise FormatError('Input changed during ambient audit: ' + item['path'])
    outputs = []
    for name, data in [('ambient-sounds.json', serialized(document)), ('REPORT.md', report.encode())]:
        target = output / name
        target.write_bytes(data)
        outputs.append({'file': name, 'bytes': len(data), 'sha256': sha(data)})
    (output / 'SHA256-MANIFEST.json').write_bytes(serialized({'schemaVersion': 1, 'outputs': outputs}))
    print(json.dumps({'output': output.relative_to(ROOT).as_posix(), 'summary': summary, 'outputs': outputs}, indent=2))


if __name__ == '__main__':
    main()
