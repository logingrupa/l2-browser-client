#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import re
import struct
import sys
import wave
import zipfile

import native_assets
from native_assets import Converter, verify_archive
from native_assets_lib.conversion_evidence import EXPORT_MANIFEST_NAME, EXPORT_MANIFEST_SCHEMA_VERSION
from native_assets_lib.footstep_config import sound_payload
from native_assets_lib.sound_export_guards import (HASH, REFERENCE, Sources, canonical, child, clean_adapter_work, digest, files_receipt,
                                                   load_json, reject_links, relative_name, require, write_exact)
from native_audio import decode_native_audio
from native_catalog.ue2 import FormatError
from reference_client_guard import require_reference_client

SOUND_EXPORT_DESCRIPTION = (
    "Batch every exact Sound export in the recipe's locked UAX packages, offline.\n"
    '\n'
    'python -B scripts/export-native-sounds.py --output artifacts/<fresh-destination>\n'
    'Repeat for verified Converter cache hits; --verify-only performs no writes.\n'
    'Use --reuse-from <completed-old-output> only with a fresh destination to import\n'
    "verified unchanged conversions across this wrapper's name-policy correction.\n"
    'Exit 0: complete selected coverage; 2: retained unsupported/partial coverage;\n'
    '1: integrity, ownership or execution failure. No catalog/runtime staging occurs.'
)

ROOT = Path(__file__).resolve().parent.parent
SELECTION = 'all-Sound-exports-in-all-locked-uax-packages'
FULL_OBJECT = re.compile(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+')
RUNTIME = {'worldPlaybackConnected': False, 'nativePlaybackVerified': False,
           'eventSelection': 'not-inferred', 'nativeAudioParity': 'unverified'}
CODEC_ERRORS = (ValueError, EOFError, wave.Error, struct.error)


def implementation():
    scripts = Path(__file__).resolve().parent
    return {'files': {name: digest((scripts/name).read_bytes()) for name in
            ('export-native-sounds.py', 'native_assets_lib/sound_export_guards.py', 'native_assets_lib/footstep_config.py')},
            'converterSha256': native_assets.implementation_hash(),
            'tool': {'name': 'UEViewer UModel build1590 (pinned; Sound adapter does not execute it)',
                     'sha256': native_assets.UMODEL_SHA256}}


def output_path(output, protected):
    output = output.absolute()
    reject_links(output)
    output = output.resolve()
    require(any(output != base.resolve() and output.is_relative_to(base.resolve())
                for base in (ROOT/'artifacts', ROOT/'scratch', ROOT/'.scratch')),
            'Output must be a named subdirectory of project artifacts or scratch')
    for source in protected:
        source = source.resolve()
        require(not output.is_relative_to(source) and not source.is_relative_to(output),
                'Output overlaps protected input: ' + str(source))
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        for path in output.rglob('*'):
            reject_links(path)
    return output


def recipe_packages(recipe, lock, sources):
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-sound-packages' and
            recipe.get('source') == {'host': lock.get('sourceHost'), 'root': lock.get('sourceRoot')} and
            recipe.get('selection') == SELECTION and isinstance(recipe.get('packages'), list),
            'Unsupported recipe source or selection')
    selected = {}
    for row in recipe['packages']:
        name = relative_name(row['file'])
        require(name.casefold().endswith('.uax') and name.casefold() not in selected,
                'Duplicate or non-UAX recipe package')
        pin = sources.pins.get(name.casefold())
        require(pin is not None and pin['relativePath'] == name and
                pin['bytes'] == row['bytes'] and pin['sha256'] == row['sha256'], 'Recipe package identity differs from source lock')
        require(type(row.get('expectedSounds')) is int and row['expectedSounds'] >= 0, 'Invalid expected Sound count')
        selected[name.casefold()] = row
    locked = {name for name in sources.pins if name.endswith('.uax')}
    require(set(selected) == locked and bool(selected), 'Recipe must enumerate every locked UAX package exactly')
    require(recipe.get('expectedInventory') == {'packages': len(selected),
            'sounds': sum(row['expectedSounds'] for row in selected.values())}, 'Recipe inventory totals differ')
    return [selected[name] for name in sorted(selected)]


def inventory(sources, recipe, packages):
    package_rows, sounds = [], []
    for expected in packages:
        name = expected['file']
        print('Inventory ' + name, file=sys.stderr, flush=True)
        sources.read(name)
        row = {'source': sources.identity(name), 'expectedSounds': expected['expectedSounds']}
        package_rows.append(row)
        try:
            package = sources.package(name)
        except (FormatError, EOFError, struct.error) as error:
            row.update(status='unsupported-package', error=str(error))
            continue
        entries = [item for item in package.exports if item['className'] == 'Sound']
        row.update(status='enumerated', format=package.summary, soundCount=len(entries))
        counts = Counter(item['object'].casefold() for item in package.exports)
        for item in entries:
            identity = sources.identity(name)
            stable_id = identity['sourceHost'] + ':' + identity['sha256'] + ':' + str(item['exportIndex'])
            key = digest(stable_id.encode('utf-8'))
            raw = package.data[item['offset']:item['offset'] + item['size']]
            sound = {'stableId': stable_id, 'id': 'interlude:' + item['object'], 'sourcePackage': identity,
                'export': {key: item[key] for key in ('object', 'className', 'classObject', 'exportIndex', 'offset', 'size')},
                'serializedExport': {'path': 'source/' + key + '/serialized.bin', 'offsetUnwrapped': item['offset'],
                                     'bytes': len(raw), 'sha256': digest(raw)}, 'status': 'unsupported-source-record'}
            sounds.append(sound)
            try:
                require(item['classObject'] == 'Engine.Sound', 'Unsupported class-qualified Sound layout')
                require(FULL_OBJECT.fullmatch(item['object']) is not None, 'Unsupported full object identifier')
                require(counts[item['object'].casefold()] == 1, 'Ambiguous full object identifier')
                payload, native = sound_payload(package, item)
                sound.update(status='source-ready', nativeSound=native,
                    nativePayload={'path': 'source/' + key + '/native-payload.bin', 'bytes': len(payload), 'sha256': digest(payload)})
            except (FormatError, EOFError, struct.error) as error:
                sound['error'] = str(error)
    counts = {'packages': len(package_rows), 'sounds': len(sounds),
              'unsupportedPackages': sum(row['status'] == 'unsupported-package' for row in package_rows),
              'unsupportedSourceRecords': sum(row['status'] != 'source-ready' for row in sounds)}
    expected_match = (counts['sounds'] == recipe['expectedInventory']['sounds'] and
        all(row.get('soundCount') == row['expectedSounds'] for row in package_rows))
    return {'schemaVersion': 1, 'kind': 'native-staged-sound-inventory', 'selection': SELECTION,
            'counts': counts, 'expectedInventory': recipe['expectedInventory'], 'expectedInventoryMatch': expected_match,
            'packages': package_rows, 'sounds': sounds, 'runtime': RUNTIME,
            'limitations': ['Only locked staged UAX packages are covered, not the complete native client.',
                'Exact table identities are exported without resolving group-less configuration references.',
                'Native event binding, defaults, random/loop/transition/spatial rules and audible parity remain unproved.']}


def source_bytes(sources, row):
    package = sources.package(row['sourcePackage']['relativePath'])
    item = package.exports[row['export']['exportIndex'] - 1]
    require(all(item[key] == value for key, value in row['export'].items()), 'Source export identity changed')
    raw = package.data[item['offset']:item['offset'] + item['size']]
    require(len(raw) == row['serializedExport']['bytes'] and digest(raw) == row['serializedExport']['sha256'], 'Source span differs')
    if row['status'] != 'source-ready':
        return raw, None
    payload, native = sound_payload(package, item)
    require(native == row['nativeSound'] and digest(payload) == row['nativePayload']['sha256'], 'Source payload differs')
    return raw, payload


def decoded_audio_or_expected_codec_error(output, row):
    path = child(output, row['nativePayload']['path'])
    try:
        decoded, mime, metadata = decode_native_audio(path)
        return (decoded, mime, metadata), None
    except CODEC_ERRORS as error:
        return None, str(error)


def request_for(row):
    return {'kind': 'audio', 'package': row['sourcePackage']['relativePath'], 'object': row['export']['object']}


def cache_key(row, impl):
    return digest(native_assets.json_bytes({'request': request_for(row),
        'implementation': impl['converterSha256'], 'umodel': native_assets.UMODEL_SHA256}))


def verify_product(output, row, result, impl, decoded):
    content = result['contentSha256']
    require(isinstance(content, str) and HASH.fullmatch(content), 'Unsafe cache content directory')
    folder_name = 'cache/' + content
    folder = child(output, folder_name)
    archive_path = child(folder, 'asset.l2asset')
    checked = verify_archive(archive_path)
    require(checked['sha256'] == content, 'Content directory/archive hash differs')
    audio_bytes, mime, decoder_metadata = decoded
    expected_paths = set()
    with zipfile.ZipFile(archive_path) as archive:
        asset = load_json(archive.read('asset.json'))
        provenance = load_json(archive.read('provenance.json'))
        require(asset['kind'] == 'audio' and asset['id'] == row['id'] and asset['source']['object'] == row['export']['object'] and
                asset['source']['sha256'] == row['sourcePackage']['sha256'], 'Converted source identity differs')
        require(provenance['source'] == asset['source'] and provenance['request'] == request_for(row) and
                provenance['dependencies'] == {row['sourcePackage']['relativePath']: row['sourcePackage']['sha256']} and
                provenance['converterSha256'] == impl['converterSha256'] and
                provenance['tool']['sha256'] == native_assets.UMODEL_SHA256, 'Converted provenance differs')
        metadata = provenance['metadata']
        require(metadata == {**decoder_metadata, 'nativeFormat': row['nativeSound']['nativeFormat'],
                'nativePayloadSha256': row['nativePayload']['sha256'], 'nativeExportIndex': row['export']['exportIndex']},
                'Converted metadata differs from source/decoder')
        audio_name = relative_name(asset['audio']['file'])
        require(archive.read(audio_name) == audio_bytes, 'Converted audio differs from decoded original')
        require(set(archive.namelist()) == {'asset.json', 'provenance.json', audio_name}, 'Unexpected audio archive members')
        product_hashes = {}
        for member in archive.namelist():
            data = archive.read(member)
            require(child(folder, member).read_bytes() == data, 'Loose cache member differs from archive')
            product_hashes[member] = digest(data)
            expected_paths.add(folder_name + '/' + member)
        product_hashes['asset.l2asset'] = content
        expected_paths.add(folder_name + '/asset.l2asset')
    evidence_name = 'evidence/sound-' + row['export']['object'] + ('.ogg' if row['nativeSound']['nativeFormat'].casefold() == 'ogg' else '.wav')
    evidence_payload = child(folder, evidence_name).read_bytes()
    require(evidence_payload == child(output, row['nativePayload']['path']).read_bytes(), 'Original converter evidence differs')
    expected_paths.add(folder_name + '/' + evidence_name)
    export_manifest_name = 'evidence/' + EXPORT_MANIFEST_NAME
    require(load_json(child(folder, export_manifest_name).read_bytes()) == {
        'schemaVersion': EXPORT_MANIFEST_SCHEMA_VERSION, 'umodelSha256': native_assets.UMODEL_SHA256,
        'files': [{'path': evidence_name.removeprefix('evidence/'), 'sha256': digest(evidence_payload), 'bytes': len(evidence_payload), 'retained': True}]},
        'Converter export manifest differs')
    expected_paths.add(folder_name + '/' + export_manifest_name)
    index_name = 'cache/index/' + cache_key(row, impl) + '.json'
    index = load_json(child(output, index_name).read_bytes())
    require(index == {'directory': content, 'dependencies': provenance['dependencies'], 'outputs': product_hashes}, 'Converter cache index differs')
    expected_paths.add(index_name)
    products = {'archive': {'path': folder_name + '/asset.l2asset', 'bytes': checked['bytes'], 'sha256': content},
                'audio': {'path': folder_name + '/' + audio_name, 'bytes': len(audio_bytes), 'sha256': digest(audio_bytes),
                          'mime': mime, 'metadata': metadata}}
    return products, expected_paths


def coverage_document(document, results):
    statuses = dict(sorted(Counter(row['status'] for row in results).items()))
    good = statuses.get('exported-and-verified', 0)
    complete = document['expectedInventoryMatch'] and not document['counts']['unsupportedPackages'] and good == len(results)
    return {'schemaVersion': 1, 'kind': 'native-staged-sound-coverage', 'inventorySha256': digest(canonical(document)),
            'counts': {**document['counts'], 'exportedSounds': good, 'unsupportedSounds': len(results) - good,
                       'soundStatuses': statuses}, 'expectedInventoryMatch': document['expectedInventoryMatch'],
            'status': 'selected-staged-sounds-exported' if complete else 'partial-unsupported-coverage',
            'runtime': RUNTIME, 'sounds': results}


def verify_output(output, owner, document, sources, allow_lock=False):
    require(allow_lock or not (output/'.run.lock').exists(), 'Another export is active or interrupted; use a fresh output')
    require((output/'run.json').is_file(), 'Existing output is not owned by this exporter')
    require((output/'run.json').read_bytes() == canonical(owner), 'Existing output belongs to different inputs/settings/tools')
    require((output/'inventory.json').read_bytes() == canonical(document), 'Inventory differs from current sources')
    coverage = load_json((output/'coverage.json').read_bytes())
    require(coverage == coverage_document(document, coverage['sounds']), 'Coverage counters/status differ')
    require(len(coverage['sounds']) == len(document['sounds']), 'Coverage count differs')
    allowed = {'run.json', 'inventory.json', 'coverage.json', 'SHA256-MANIFEST.json'}
    for row, result in zip(document['sounds'], coverage['sounds']):
        require(result['stableId'] == row['stableId'], 'Coverage identity differs')
        raw, payload = source_bytes(sources, row)
        require(child(output, row['serializedExport']['path']).read_bytes() == raw, 'Serialized source export differs')
        allowed.add(row['serializedExport']['path'])
        if payload is None:
            require(result == {'stableId': row['stableId'], 'status': 'unsupported-source-record', 'error': row['error']}, 'Unsupported source result differs')
            continue
        require(child(output, row['nativePayload']['path']).read_bytes() == payload, 'Native payload differs')
        allowed.add(row['nativePayload']['path'])
        decoded, error = decoded_audio_or_expected_codec_error(output, row)
        if error is not None:
            require(result == {'stableId': row['stableId'], 'status': 'unsupported-codec', 'error': error}, 'Unsupported codec result differs')
            continue
        require(result['status'] == 'exported-and-verified', 'Supported source has no export')
        products, product_paths = verify_product(output, row, result, owner['implementation'], decoded)
        require(result == {'stableId': row['stableId'], 'status': 'exported-and-verified',
                'contentSha256': products['archive']['sha256'], 'products': products}, 'Coverage product receipt differs')
        allowed.update(product_paths)
    actual = {path.relative_to(output).as_posix() for path in output.rglob('*')
              if path.is_file() and path.relative_to(output).as_posix() != '.run.lock'}
    require(actual == allowed, 'Unexpected or missing output file paths')
    manifest = load_json((output/'SHA256-MANIFEST.json').read_bytes())
    require(manifest == {'schemaVersion': 1, 'files': files_receipt(output)}, 'Output manifest/file/hash closure differs')
    return coverage


def readonly_snapshot(root):
    result = {}
    for path in sorted(root.rglob('*')):
        reject_links(path)
        if path.is_file():
            data = path.read_bytes()
            result[path.relative_to(root).as_posix()] = {'bytes': len(data), 'sha256': digest(data),
                                                       'mtimeNs': path.stat().st_mtime_ns}
    return result


def validate_previous_output_for_name_policy_reuse(previous, output, protected, owner, document, sources):
    require(not output.exists(), 'Cache import requires a fresh nonexistent destination')
    previous = output_path(previous, (*protected, output))
    require(previous.is_dir() and (previous/'run.json').is_file(), 'Reuse source is not a completed owned output')
    require(not (previous/'.run.lock').exists(), 'Reuse source is active or interrupted')
    before = readonly_snapshot(previous)
    old_owner = load_json((previous/'run.json').read_bytes())
    old_wrapper = old_owner['implementation']['files']['export-native-sounds.py']
    require(isinstance(old_wrapper, str) and HASH.fullmatch(old_wrapper), 'Invalid previous wrapper hash')
    compatible = load_json(canonical(old_owner))
    compatible['implementation']['files']['export-native-sounds.py'] = owner['implementation']['files']['export-native-sounds.py']
    require(compatible == owner, 'Reuse inputs/settings/tool or non-wrapper implementation differs')
    old_document = load_json((previous/'inventory.json').read_bytes())
    require(len(old_document['sounds']) == len(document['sounds']), 'Reuse inventory Sound count differs')
    reconciled = load_json(canonical(document))
    promotions = []
    for index, (old, current) in enumerate(zip(old_document['sounds'], document['sounds'])):
        if old == current:
            continue
        require(old.get('status') == 'unsupported-source-record' and current.get('status') == 'source-ready' and
                old.get('error') == 'Unsupported full object identifier' and
                REFERENCE.fullmatch(current['export']['object']) is None and
                FULL_OBJECT.fullmatch(current['export']['object']) is not None,
                'Reuse inventory change is not a qualified name-policy promotion')
        previous_row = {key: value for key, value in current.items() if key not in ('nativeSound', 'nativePayload')}
        previous_row.update(status='unsupported-source-record', error='Unsupported full object identifier')
        require(previous_row == old, 'Reuse promoted source identity or raw span differs')
        reconciled['sounds'][index] = old
        promotions.append(current['stableId'])
    reconciled['counts']['unsupportedSourceRecords'] += len(promotions)
    require(reconciled == old_document, 'Reuse inventory differs beyond qualified source promotions')
    coverage = verify_output(previous, old_owner, old_document, sources)
    require(readonly_snapshot(previous) == before, 'Reuse source changed during validation')
    cache_paths = [name for name in sorted(before) if name.startswith('cache/')]
    return {'root': previous, 'before': before, 'cachePaths': cache_paths,
            'reusedIds': {row['stableId'] for row in coverage['sounds'] if row['status'] == 'exported-and-verified'},
            'promotions': promotions, 'manifestSha256': before['SHA256-MANIFEST.json']['sha256']}


def copy_verified_cache_files(reuse, output):
    for name in reuse['cachePaths']:
        data = child(reuse['root'], name).read_bytes()
        expected = reuse['before'][name]
        require(len(data) == expected['bytes'] and digest(data) == expected['sha256'], 'Reuse cache changed before copy')
        write_exact(output, name, data)


def run(args):
    for path in (args.client_snapshot, args.input_lock, args.recipe, args.umodel):
        reject_links(path.absolute())
    snapshot = args.client_snapshot.resolve()
    protected = (snapshot, args.input_lock.parent, args.recipe.parent, args.umodel,
                 ROOT/'public', ROOT/'assets', ROOT/'scripts', ROOT/'tests')
    output = output_path(args.output, protected)
    reuse_from = getattr(args, 'reuse_from', None)
    require(not reuse_from or not args.verify_only, 'Cache import cannot be combined with verify-only')
    require(not reuse_from or not output.exists(), 'Cache import requires a fresh nonexistent destination')
    recipe_bytes, lock_bytes = args.recipe.read_bytes(), args.input_lock.read_bytes()
    recipe, lock = load_json(recipe_bytes), load_json(lock_bytes)
    sources = Sources(snapshot, lock)
    packages = recipe_packages(recipe, lock, sources)
    require(digest(args.umodel.read_bytes()) == native_assets.UMODEL_SHA256, 'Pinned converter tool hash mismatch')
    document = inventory(sources, recipe, packages)
    owner = {'schemaVersion': 1, 'kind': 'native-staged-sound-products', 'recipeSha256': digest(recipe_bytes),
             'inputLockSha256': digest(lock_bytes), 'source': recipe['source'], 'implementation': implementation(),
             'settings': {'selection': SELECTION, 'audioAdapter': 'native_assets.Converter',
                          'matching': 'exact-export-table-identity-no-configuration-resolution', 'runtimeStaging': False}}
    reuse = validate_previous_output_for_name_policy_reuse(reuse_from, output, protected, owner, document, sources) if reuse_from else None
    prior = verify_output(output, owner, document, sources) if output.exists() else None
    require(not args.verify_only or prior is not None, 'Verify-only requires completed existing output')
    hits = 0
    if args.verify_only:
        coverage = prior
    else:
        output.mkdir(parents=True, exist_ok=True)
        with (output/'.run.lock').open('xb') as stream:
            stream.write(b'Exclusive native Sound export; do not remove while running.\n')
        try:
            write_exact(output, 'run.json', canonical(owner))
            write_exact(output, 'inventory.json', canonical(document))
            if reuse:
                print('Importing %d verified cached Sounds' % len(reuse['reusedIds']), file=sys.stderr, flush=True)
                copy_verified_cache_files(reuse, output)
            converter = Converter(snapshot, output/'cache', args.umodel, project_root=ROOT)
            results = []
            for index, row in enumerate(document['sounds'], 1):
                if index == 1 or index % 100 == 0 or index == len(document['sounds']):
                    print('Sound %d/%d: %s' % (index, len(document['sounds']), row['export']['object']), file=sys.stderr, flush=True)
                raw, payload = source_bytes(sources, row)
                write_exact(output, row['serializedExport']['path'], raw)
                result = {'stableId': row['stableId']}
                results.append(result)
                if payload is None:
                    result.update(status='unsupported-source-record', error=row['error'])
                    continue
                write_exact(output, row['nativePayload']['path'], payload)
                decoded, error = decoded_audio_or_expected_codec_error(output, row)
                if error is not None:
                    result.update(status='unsupported-codec', error=error)
                    continue
                converted = converter.convert(request_for(row))
                require(not prior or converted.get('cacheHit') is True, 'Unchanged repeat missed converter cache')
                require(not reuse or row['stableId'] not in reuse['reusedIds'] or converted.get('cacheHit') is True,
                        'Verified imported conversion missed converter cache')
                hits += int(converted.get('cacheHit') is True)
                archive_path = Path(converted['file']).resolve()
                require(archive_path.is_relative_to((output/'cache').resolve()) and archive_path.name == 'asset.l2asset', 'Converter output escapes owned cache')
                result.update(status='exported-and-verified', contentSha256=converted['sha256'])
                products, _ = verify_product(output, row, result, owner['implementation'], decoded)
                result['products'] = products
                clean_adapter_work(output/'cache')
            coverage = coverage_document(document, results)
            sources.verify_unchanged()
            write_exact(output, 'coverage.json', canonical(coverage))
            write_exact(output, 'SHA256-MANIFEST.json', canonical({'schemaVersion': 1, 'files': files_receipt(output)}))
            verify_output(output, owner, document, sources, allow_lock=True)
        finally:
            (output/'.run.lock').unlink()
    sources.verify_unchanged()
    if reuse:
        require(readonly_snapshot(reuse['root']) == reuse['before'], 'Reuse source changed during export')
    require(args.recipe.read_bytes() == recipe_bytes and args.input_lock.read_bytes() == lock_bytes and
            digest(args.umodel.read_bytes()) == native_assets.UMODEL_SHA256 and implementation() == owner['implementation'],
            'Input or implementation changed during export/verification')
    return {'output': str(output), 'status': coverage['status'], 'counts': coverage['counts'],
            'coverageSha256': digest(canonical(coverage)), 'cacheHits': hits, 'verifyOnly': bool(args.verify_only),
            'importedCacheSounds': len(reuse['reusedIds']) if reuse else 0,
            'reuseSourceManifestSha256': reuse['manifestSha256'] if reuse else None,
            'sourceInputsUnchanged': len(sources.checked), 'runtime': RUNTIME,
            'success': coverage['status'] == 'selected-staged-sounds-exported'}


def main():
    parser = argparse.ArgumentParser(description=SOUND_EXPORT_DESCRIPTION)
    parser.add_argument('--client-snapshot', type=Path, default=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--input-lock', type=Path, default=ROOT/'recipes/native-inputs.lock.json')
    parser.add_argument('--recipe', type=Path, default=ROOT/'recipes/native-sounds-staged.json')
    parser.add_argument('--umodel', type=Path, default=native_assets.UMODEL)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--reuse-from', type=Path, help='Read-only verified cache import from a completed owned output; fresh target only')
    args = parser.parse_args()
    try:
        require_reference_client(args.client_snapshot)
        result = run(args)
    except (ValueError, OSError, KeyError, TypeError, EOFError, wave.Error, struct.error) as error:
        print(canonical({'status': 'failed', 'error': str(error)}).decode('utf-8'), file=sys.stderr)
        return 1
    print(canonical(result).decode('utf-8'))
    return 0 if result['success'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
