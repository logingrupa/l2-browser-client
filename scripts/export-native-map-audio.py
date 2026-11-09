#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct
import sys
import wave
import zipfile

import native_assets
from native_assets import Converter, verify_archive
from native_assets_lib.footstep_config import sound_payload
from native_assets_lib.sound_export_guards import (HASH, REFERENCE, Sources, canonical, child, clean_adapter_work, digest, files_receipt,
                                                   load_json, reject_links, relative_name, require, write_exact)
from native_audio import decode_native_audio
from reference_client_guard import require_reference_client
from world.map_actor_properties import ambient_sound_object, property_value

MAP_AUDIO_EXPORT_DESCRIPTION = (
    'Inventory, export and verify all exact AmbientSoundObject dependencies offline.\n'
    '\n'
    'python scripts/export-native-map-audio.py --output artifacts/<fresh-run>\n'
    'Repeat the command to verify/reuse unchanged products; add --verify-only for a\n'
    'read-only source/product closure check. This never stages a browser catalog.'
)

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = {'worldPlaybackConnected': False, 'nativePlaybackVerified': False,
           'nativeLoopPolicy': 'unresolved', 'nativeActivationAndRange': 'unresolved',
           'nativeAudioParity': 'unverified'}


def output_path(output, protected):
    output = output.absolute()
    reject_links(output)
    output = output.resolve()
    require(any(output != base.resolve() and output.is_relative_to(base.resolve())
                for base in (ROOT/'artifacts', ROOT/'scratch', ROOT/'.scratch')),
            'Output must be an explicitly named subdirectory of project artifacts or scratch')
    for source in protected:
        source = source.resolve()
        require(not output.is_relative_to(source) and not source.is_relative_to(output),
                'Output overlaps protected input: ' + str(source))
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        for path in output.rglob('*'):
            reject_links(path)
    return output


def implementation():
    scripts = Path(__file__).resolve().parent
    paths = ['export-native-map-audio.py', 'native_assets_lib/sound_export_guards.py', 'world/map_actor_properties.py',
             'native_assets_lib/footstep_config.py']
    return {'files': {name: digest((scripts/name).read_bytes()) for name in paths},
            'converterSha256': native_assets.implementation_hash(),
            'tool': {'name': 'UEViewer UModel build1590 (pinned; audio adapter does not execute it)',
                     'sha256': native_assets.UMODEL_SHA256}}


def exact_sound(package, reference):
    require(isinstance(reference, str) and REFERENCE.fullmatch(reference), 'Unsupported qualified sound reference')
    matches = [item for item in package.exports if item['object'].casefold() == reference.casefold()]
    require(len(matches) == 1, 'Missing or ambiguous exact qualified sound object: ' + reference)
    require(matches[0]['className'] == 'Sound', 'Exact referenced object is not Sound: ' + reference)
    return matches[0]


def inventory(sources, recipe):
    map_name = relative_name(recipe['map']['file'])
    pin = sources.pins.get(map_name.casefold())
    require(pin is not None and pin['sha256'] == recipe['map']['sha256'] and pin['bytes'] == recipe['map']['bytes'],
            'Recipe map identity differs from source lock')
    package = sources.package(map_name)
    map_identity = sources.identity(map_name)
    raw_path = 'native/map.unwrapped.bin'
    products = {raw_path: package.data}
    rows, references = [], {}
    for item in package.exports:
        if item['classObject'] != 'Engine.AmbientSoundObject':
            continue
        raw = package.data[item['offset']:item['offset'] + item['size']]
        row = {'id': 'interlude:' + item['object'], 'object': item['object'], 'exportIndex': item['exportIndex'],
               'sourcePackage': map_identity, 'serializedExport': {'path': raw_path, 'offset': item['offset'],
               'bytes': len(raw), 'sha256': digest(raw)}, 'status': 'declaration-decode-error'}
        rows.append(row)
        try:
            declaration = ambient_sound_object(package, item, raw_path)
            row['declaration'] = declaration
            fields = [prop for prop in declaration['properties'] if prop['name'] == 'AmbientSound']
            if not fields:
                row['status'] = 'omitted-reference-unresolved'
                continue
            require(len(fields) == 1 and fields[0]['arrayIndex'] in (None, 0), 'Ambiguous AmbientSound property')
            reference = property_value(declaration['properties'], 'AmbientSound')
            require(isinstance(reference, dict) and 'object' in reference, 'AmbientSound reference is undecoded')
            if reference['object'] is None:
                row['status'] = 'serialized-null-reference'
                continue
            name = reference['object']
            require(isinstance(name, str) and REFERENCE.fullmatch(name), 'Unsupported qualified sound reference')
            key = name.casefold()
            references.setdefault(key, {'references': set(), 'declarations': []})
            references[key]['references'].add(name)
            references[key]['declarations'].append(row['id'])
            row.update(status='authored-reference', soundReference=name)
        except (ValueError, KeyError, TypeError) as error:
            row['error'] = str(error)
    sounds, resolved = [], {}
    for key, use in sorted(references.items()):
        reference = sorted(use['references'])[0]
        sound_key = digest(key.encode('utf-8'))
        prefix = 'sounds/' + sound_key
        row = {'referenceKey': key, 'authoredReferences': sorted(use['references']), 'declarationIds': use['declarations'],
               'occurrences': len(use['declarations']), 'directory': prefix, 'status': 'unresolved-source-object'}
        sounds.append(row)
        matches = [pin['relativePath'] for pin in sources.pins.values()
                   if Path(pin['relativePath']).suffix.casefold() == '.uax' and
                   Path(pin['relativePath']).stem.casefold() == reference.split('.')[0].casefold()]
        if len(matches) != 1:
            row['error'] = 'Missing or ambiguous locked UAX package'
            row['packageCandidates'] = sorted(matches)
            continue
        name = matches[0]
        try:
            if name not in sources.checked:
                sources.read(name)
        except FileNotFoundError:
            row.update(error='Locked sound package is not staged', sourcePackage=sources.identity(name))
            continue
        try:
            sound_package = sources.package(name)
            item = exact_sound(sound_package, reference)
            row.update(id='interlude:' + item['object'], sourcePackage=sources.identity(name),
                       export={field: item[field] for field in ('object', 'className', 'classObject', 'exportIndex', 'offset', 'size')})
            raw = sound_package.data[item['offset']:item['offset'] + item['size']]
            row['serializedExport'] = {'path': prefix + '/serialized.bin', 'offsetUnwrapped': item['offset'],
                                       'bytes': len(raw), 'sha256': digest(raw)}
            products[row['serializedExport']['path']] = raw
            properties, _ = sound_package.properties(item)
            row['properties'] = properties
            payload, native = sound_payload(sound_package, item)
            row.update(status='exact-source-resolved', nativeSound=native, nativePayloadFile=prefix + '/native-payload.bin')
            products[row['nativePayloadFile']] = payload
            resolved[key] = (name, item, payload)
        except (ValueError, KeyError, TypeError) as error:
            row['error'] = str(error)
        products[prefix + '/source.json'] = canonical(row)
    counts = {'declarations': len(rows), 'authoredReferences': sum(row['status'] == 'authored-reference' for row in rows),
              'distinctReferences': len(sounds), 'omittedReferences': sum(row['status'] == 'omitted-reference-unresolved' for row in rows)}
    document = {'schemaVersion': 1, 'kind': 'native-map-ambient-source-inventory', 'map': map_identity,
                'mapFormat': package.summary, 'unwrappedMap': {'path': raw_path, 'bytes': len(package.data), 'sha256': digest(package.data)},
                'selection': 'all-exact-Engine.AmbientSoundObject-exports-no-spatial-filter',
                'matching': 'full-qualified-casefold-equality-and-Sound-class-before-converter-no-leaf-fallback',
                'runtime': RUNTIME, 'counts': counts, 'expectedInventory': recipe['expectedInventory'],
                'expectedInventoryMatch': counts == recipe['expectedInventory'], 'objects': rows, 'sounds': sounds,
                'limitations': ['Authored properties and unknown ranges are retained without inferred class defaults.',
                    'Omitted references, activation/type, looping, random selection, gain/range and listener rules remain unresolved.',
                    'Inventory and playable media do not establish world playback or native audio parity.']}
    return document, products, resolved


def verify_sound(output, row, source, recipe_implementation):
    folder = child(output, row['directory'])
    archive_path = folder/'asset.l2asset'
    checked = verify_archive(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        asset = load_json(archive.read('asset.json'))
        provenance = load_json(archive.read('provenance.json'))
        require(asset['kind'] == 'audio' and asset['id'] == row['id'] and asset['source']['object'] == row['export']['object'] and
                asset['source']['sha256'] == row['sourcePackage']['sha256'], 'Converted archive source identity differs')
        name, item, payload = source
        require(provenance['request'] == {'kind': 'audio', 'package': name, 'object': item['object']} and
                provenance['dependencies'] == {name: row['sourcePackage']['sha256']} and
                provenance['converterSha256'] == recipe_implementation['converterSha256'] and
                provenance['tool']['sha256'] == native_assets.UMODEL_SHA256, 'Converted provenance or dependency closure differs')
        metadata = provenance['metadata']
        require(metadata['nativePayloadSha256'] == digest(payload) and metadata['nativeExportIndex'] == item['exportIndex'] and
                metadata['nativeFormat'] == row['nativeSound']['nativeFormat'], 'Converted native payload join differs')
        audio_file = relative_name(asset['audio']['file'])
        decoded, mime, decoded_metadata = decode_native_audio(child(output, row['nativePayloadFile']))
        require(archive.read(audio_file) == decoded and all(metadata.get(key) == value for key, value in decoded_metadata.items()),
                'Decoded audio bytes or RIFF/container metadata differ from original payload')
        for member in archive.namelist():
            require(child(folder, member).read_bytes() == archive.read(member), 'Loose product differs from archive: ' + member)
    return {'archive': {'path': row['directory'] + '/asset.l2asset', 'bytes': checked['bytes'], 'sha256': checked['sha256']},
            'audio': {'path': row['directory'] + '/' + audio_file, 'bytes': len(decoded), 'sha256': digest(decoded),
                      'mime': mime, 'metadata': metadata}}


def coverage_document(document, results):
    failed = sum(row['status'] != 'exported-and-verified' for row in results)
    decode_errors = sum(row['status'] == 'declaration-decode-error' for row in document['objects'])
    return {'schemaVersion': 1, 'kind': 'native-map-ambient-export-coverage', 'runtime': RUNTIME,
            'inventorySha256': digest(canonical(document)), 'sounds': results,
            'counts': {**document['counts'], 'exportedSounds': len(results)-failed,
                       'failedReferencedDependencies': failed, 'declarationDecodeErrors': decode_errors,
                       'expectedInventoryMatch': document['expectedInventoryMatch'],
                       'soundStatuses': dict(sorted(Counter(row['status'] for row in results).items()))},
            'status': 'failed-referenced-dependency-closure' if failed or decode_errors or not document['expectedInventoryMatch']
                      else 'referenced-dependencies-exported-omissions-unresolved'}


def verify_cache_paths(output):
    index = child(output, 'cache/index')
    if not index.exists():
        return
    for path in index.iterdir():
        require(path.is_file() and re.fullmatch(r'[a-f0-9]{64}\.json', path.name), 'Unexpected converter cache index')
        record = load_json(path.read_bytes())
        require(isinstance(record.get('directory'), str) and HASH.fullmatch(record['directory']), 'Unsafe cache content directory')
        for name, sha256 in record['outputs'].items():
            child(output/'cache'/record['directory'], name)
            require(isinstance(sha256, str) and HASH.fullmatch(sha256), 'Invalid cache output hash')
        for name, sha256 in record['dependencies'].items():
            relative_name(name)
            require(isinstance(sha256, str) and HASH.fullmatch(sha256), 'Invalid cache source hash')


def verify_output(output, owner, inventory_document, products, resolved):
    require(not (output/'.run.lock').exists(), 'Another export is active or an interrupted run needs a fresh output')
    require((output/'run.json').is_file(), 'Existing output is not owned by this exporter')
    require((output/'run.json').read_bytes() == canonical(owner), 'Existing output belongs to different inputs/settings/tools')
    require((output/'inventory.json').read_bytes() == canonical(inventory_document), 'Inventory differs from current locked source')
    for name, payload in products.items():
        require(child(output, name).read_bytes() == payload, 'Raw source product differs: ' + name)
    manifest = load_json((output/'SHA256-MANIFEST.json').read_bytes())
    require(manifest == {'schemaVersion': 1, 'files': files_receipt(output)}, 'Output manifest/file/hash closure differs')
    coverage = load_json((output/'coverage.json').read_bytes())
    require(coverage == coverage_document(inventory_document, coverage['sounds']), 'Coverage counters/status differ from source closure')
    require(len(coverage['sounds']) == len(inventory_document['sounds']), 'Coverage count differs from source inventory')
    for source_row, result in zip(inventory_document['sounds'], coverage['sounds']):
        require(result['referenceKey'] == source_row['referenceKey'], 'Coverage object identity differs')
        if result['status'] == 'exported-and-verified':
            require(source_row['referenceKey'] in resolved, 'Unresolved source was exported')
            require(result['products'] == verify_sound(output, source_row, resolved[source_row['referenceKey']], owner['implementation']),
                    'Coverage products differ from verified archive')
        else:
            require(result['status'] == ('unsupported-export' if source_row['referenceKey'] in resolved else 'unresolved-source-object')
                    and isinstance(result.get('error'), str) and 'products' not in result, 'Invalid unsupported coverage row')
    verify_cache_paths(output)
    return coverage


def run(args):
    for path in (args.client_snapshot, args.input_lock, args.recipe, args.umodel):
        reject_links(path.absolute())
    snapshot = args.client_snapshot.resolve()
    output = output_path(args.output, (snapshot, args.input_lock.parent, args.recipe.parent, args.umodel,
                                       ROOT/'public', ROOT/'assets', ROOT/'scripts', ROOT/'tests'))
    recipe_bytes, lock_bytes = args.recipe.read_bytes(), args.input_lock.read_bytes()
    recipe, lock = load_json(recipe_bytes), load_json(lock_bytes)
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-map-ambient-audio' and
            recipe.get('source') == {'host': lock.get('sourceHost'), 'root': lock.get('sourceRoot')} and
            recipe.get('selection') == 'all-exact-Engine.AmbientSoundObject-exports-no-spatial-filter' and
            recipe.get('referenceProperty') == 'AmbientSound', 'Unsupported recipe identity or selection policy')
    require(digest(args.umodel.read_bytes()) == native_assets.UMODEL_SHA256, 'Pinned converter tool hash mismatch')
    sources = Sources(snapshot, lock)
    document, products, resolved = inventory(sources, recipe)
    owner = {'schemaVersion': 1, 'kind': 'native-map-ambient-audio-products', 'recipeSha256': digest(recipe_bytes),
             'inputLockSha256': digest(lock_bytes), 'source': recipe['source'], 'implementation': implementation(),
             'settings': {'audioAdapter': 'native_assets.Converter', 'selection': document['selection'],
                          'matching': document['matching'], 'runtimeStaging': False}}
    prior = None
    if output.exists():
        prior = verify_output(output, owner, document, products, resolved)
    require(not args.verify_only or prior is not None, 'Verify-only requires a completed existing output')
    hits = 0
    if args.verify_only:
        coverage = prior
    else:
        output.mkdir(parents=True, exist_ok=True)
        with (output/'.run.lock').open('xb') as run_lock:
            run_lock.write(b'Exclusive offline ambient export; do not remove while running.\n')
        try:
            write_exact(output, 'run.json', canonical(owner))
            write_exact(output, 'inventory.json', canonical(document))
            for name, payload in products.items():
                write_exact(output, name, payload)
            converter = Converter(snapshot, output/'cache', args.umodel, project_root=ROOT)
            results = []
            for row in document['sounds']:
                result = {'referenceKey': row['referenceKey'], 'status': 'unresolved-source-object'}
                results.append(result)
                if row['referenceKey'] not in resolved:
                    result['error'] = row.get('error', 'Source object unresolved')
                    continue
                name, item, _ = resolved[row['referenceKey']]
                try:
                    converted = converter.convert({'kind': 'audio', 'package': name, 'object': item['object']})
                    require(not prior or converted.get('cacheHit') is True, 'Unchanged repeat did not reuse the verified converter cache')
                    hits += int(converted.get('cacheHit') is True)
                    archive_path = Path(converted['file']).resolve()
                    require(archive_path.is_relative_to((output/'cache').resolve()), 'Converter output escapes owned cache')
                    verify_archive(archive_path)
                    with zipfile.ZipFile(archive_path) as archive:
                        for member in archive.namelist():
                            write_exact(output, row['directory'] + '/' + relative_name(member), archive.read(member))
                    write_exact(output, row['directory'] + '/asset.l2asset', archive_path.read_bytes())
                    result.update(status='exported-and-verified', products=verify_sound(output, row, resolved[row['referenceKey']], owner['implementation']))
                except (ValueError, OSError, KeyError, TypeError, EOFError, wave.Error, struct.error) as error:
                    if prior:
                        raise
                    result.update(status='unsupported-export', error=str(error).replace(str(output), '<output>'))
                finally:
                    clean_adapter_work(output/'cache')
            coverage = coverage_document(document, results)
            sources.verify_unchanged()
            write_exact(output, 'coverage.json', canonical(coverage))
            write_exact(output, 'SHA256-MANIFEST.json', canonical({'schemaVersion': 1, 'files': files_receipt(output)}))
        finally:
            (output/'.run.lock').unlink()
        verify_output(output, owner, document, products, resolved)
    sources.verify_unchanged()
    require(args.recipe.read_bytes() == recipe_bytes and args.input_lock.read_bytes() == lock_bytes and
            digest(args.umodel.read_bytes()) == native_assets.UMODEL_SHA256 and implementation() == owner['implementation'],
            'Inputs or implementation changed during export/verification')
    return {'output': str(output), 'status': coverage['status'], 'counts': coverage['counts'],
            'coverageSha256': digest(canonical(coverage)), 'cacheHits': hits, 'verifyOnly': bool(args.verify_only),
            'sourceInputsUnchanged': len(sources.checked), 'runtime': RUNTIME,
            'success': coverage['status'] == 'referenced-dependencies-exported-omissions-unresolved'}


def main():
    parser = argparse.ArgumentParser(description=MAP_AUDIO_EXPORT_DESCRIPTION)
    parser.add_argument('--client-snapshot', type=Path, default=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--input-lock', type=Path, default=ROOT/'recipes/native-inputs.lock.json')
    parser.add_argument('--recipe', type=Path, default=ROOT/'recipes/native-ambient-20_20.json')
    parser.add_argument('--umodel', type=Path, default=native_assets.UMODEL)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        require_reference_client(args.client_snapshot)
        result = run(args)
    except (ValueError, OSError, KeyError, TypeError, EOFError, wave.Error, struct.error) as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0 if result['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
