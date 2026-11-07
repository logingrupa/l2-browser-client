"""Bundle authored animation sound dependencies from verified existing products.

No exporter, native client, sound decoder or runtime selector runs here. The
input recipe selects clips and array properties; raw events remain unchanged.
"""
from __future__ import annotations

import copy
import math
from pathlib import Path
import re

from native_assets_lib.gltf import json_bytes
from stage_native_players import checked, child, decode, digest, require, relative_name
from stage_native_runtime import verified_archive

HASH = re.compile(r'[a-f0-9]{64}')
OBJECT = re.compile(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+')
KIND = 'native-animation-audio-dependencies'


def pointer(document, value):
    require(isinstance(value, str) and value.startswith('/'), 'Expected a JSON pointer')
    for part in value[1:].split('/'):
        key = part.replace('~1', '/').replace('~0', '~')
        document = document[int(key)] if isinstance(document, list) else document[key]
    return document


class Inputs:
    def __init__(self, root):
        self.root, self.records = checked(root), {}

    def read(self, record):
        name = relative_name(record['path'])
        require(HASH.fullmatch(record['sha256']) is not None, 'Invalid input SHA256')
        path = child(self.root, name)
        data = path.read_bytes()
        require(digest(data) == record['sha256'], 'Input hash differs: ' + name)
        require('bytes' not in record or len(data) == record['bytes'], 'Input size differs: ' + name)
        value = {'path': name, 'sha256': digest(data), 'bytes': len(data), 'mtimeNs': path.stat().st_mtime_ns}
        require(name not in self.records or self.records[name] == value, 'Input changed while reading: ' + name)
        self.records[name] = value
        return data

    def archive(self, record):
        self.read(record)
        result, data, asset, payloads = verified_archive(child(self.root, record['path']), record['sha256'])
        require(digest(data) == record['sha256'], 'Archive changed while reading')
        # The shared verifier handles ZIP paths, manifest lengths and payloads.
        return result, decode(payloads['asset.json']), payloads

    def unchanged(self):
        for record in list(self.records.values()):
            self.read(record)


def evidence_index(rows):
    require(isinstance(rows, list), 'Event evidence must be a list')
    result = {}
    for row in rows:
        key = (row['assetManifestSha256'], row['manifestPointer'])
        require(key not in result, 'Duplicate event evidence identity')
        result[key] = row
    return result


def event_provenance(raw, row, manifest_hash, ordinal):
    require(row is not None, 'Selected event has no exact retained provenance')
    for key in ('animationSet', 'clip', 'object', 'type', 'function', 'normalizedTime',
                'timeSeconds', 'sourceFrames', 'sourceRate', 'sound'):
        require(raw.get(key) == row.get(key), 'Event provenance differs: ' + key)
    require(row['assetManifestSha256'] == manifest_hash and row['manifestPointer'] == f'/animationEvents/{ordinal}',
            'Event provenance identity differs')
    return copy.deepcopy(row)


def dependency(inputs, row):
    exported = row['existingExport']
    require(OBJECT.fullmatch(row['authoredReference']) and OBJECT.fullmatch(row['sourceObject']) and
            row['authoredReference'].casefold() == row['sourceObject'].casefold(),
            'Dependency requires an exact fully qualified object, without aliases')
    require(row['sourceObject'] == exported['sourceObject'] and
            row['sourcePackageSha256'] == exported['sourcePackageSha256'] and
            row['exportIndex'] == exported['nativeExportIndex'], 'Export/source identity differs')
    result, asset, payloads = inputs.archive({'path': exported['archivePath'], 'sha256': exported['archiveSha256']})
    require(result['kind'] == 'audio' and asset['id'] == exported['id'] and
            asset['source']['object'] == row['sourceObject'] and
            asset['source']['sha256'] == row['sourcePackageSha256'], 'Sound archive identity differs')
    wav = inputs.read({'path': exported['wavPath'], 'sha256': exported['wavSha256'], 'bytes': exported['wavBytes']})
    provenance = decode(payloads['provenance.json'])
    metadata = provenance['metadata']
    require(asset['audio']['file'] == 'audio.wav' and payloads['audio.wav'] == wav and
            wav[:4] == b'RIFF' and wav[8:12] == b'WAVE', 'Original WAV/archive payload differs')
    require(row['payload']['sha256'] == digest(wav) and row['payload']['bytes'] == len(wav) and
            metadata['nativeExportIndex'] == row['exportIndex'] and
            metadata.get('encodedAudioUnchanged') is True and metadata['nativePayloadSha256'] == digest(wav),
            'Sound is not the unchanged qualified source payload')
    key = exported['stableId']
    require(isinstance(key, str) and key.endswith(':' + row['sourcePackageSha256'] + ':' + str(row['exportIndex'])),
            'Dependency stable source identity differs')
    return {'dependencyId': key, 'file': 'audio/' + digest(wav) + '.wav', 'bytes': len(wav),
            'sha256': digest(wav), 'mime': 'audio/wav',
            'source': {'object': row['sourceObject'], 'packageSha256': row['sourcePackageSha256'],
                       'exportIndex': row['exportIndex']}, 'provenance': copy.deepcopy(row)}, wav


def prepare(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = checked(recipe_path)
    require(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    recipe_bytes = recipe_path.read_bytes()
    recipe_pin = {'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': digest(recipe_bytes)}
    recipe = decode(inputs.read(recipe_pin))
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-animation-audio-bundle', 'Unsupported bundle recipe')
    require(isinstance(recipe.get('actors'), list) and 0 < len(recipe['actors']) <= 64, 'Invalid actor selection')
    properties = recipe.get('arrayProperties')
    require(isinstance(properties, list) and 0 < len(properties) <= 64 and
            all(isinstance(v, str) and v for v in properties) and len(set(properties)) == len(properties),
            'Invalid array-property selection')
    spec = recipe['inventory']
    inventory = decode(inputs.read(spec))
    evidence = evidence_index(pointer(inventory, spec['eventsPointer']))
    rows = pointer(inventory, spec['dependenciesPointer'])
    require(isinstance(rows, list), 'Dependency inventory must be a list')
    lookup = {}
    for row in rows:
        reference = row['authoredReference']
        require(isinstance(reference, str) and OBJECT.fullmatch(reference), 'Unqualified dependency reference')
        require(reference.casefold() not in lookup, 'Ambiguous qualified dependency identity')
        lookup[reference.casefold()] = row
    actors, sounds, payloads, catalog_ids = [], {}, {}, set()
    for selection in recipe['actors']:
        catalog_id = selection['catalogId']
        require(isinstance(catalog_id, str) and catalog_id and catalog_id not in catalog_ids, 'Duplicate/invalid actor catalog ID')
        catalog_ids.add(catalog_id)
        result, asset, archive_files = inputs.archive(selection['archive'])
        require(result['kind'] == 'model' and asset['id'] == selection['assetId'] and
                asset['source']['edition'] == 'interlude', 'Actor archive identity differs')
        manifest_hash = digest(archive_files['asset.json'])
        selected = selection['clips']
        require(isinstance(selected, list) and selected and len({c['name'] for c in selected}) == len(selected) and
                all(c.get('gait') in ('walk', 'run') for c in selected), 'Invalid explicit clip/gait selection')
        names = {c['name'] for c in selected}
        events = []
        for ordinal, raw in enumerate(asset['animationEvents']):
            if raw['clip'] not in names:
                continue
            proof = event_provenance(raw, evidence.get((manifest_hash, f'/animationEvents/{ordinal}')), manifest_hash, ordinal)
            require(proof['nativeNotification']['sourcePackageSha256'] == asset['source']['sha256'],
                    'Notification source package differs')
            arrays = []
            for property_name in properties:
                if property_name not in raw.get('properties', {}):
                    continue
                values = raw['properties'][property_name]
                require(isinstance(values, list) and 0 < len(values) <= 4096, 'Invalid authored sound array')
                slots = []
                for index, reference in enumerate(values):
                    require(isinstance(reference, str) and OBJECT.fullmatch(reference), 'Unqualified/empty authored dependency')
                    row = lookup.get(reference.casefold())
                    require(row is not None, 'Missing exact dependency: ' + reference)
                    key = row['existingExport']['stableId']
                    if key not in sounds:
                        sound, wav = dependency(inputs, row)
                        sounds[key] = sound
                        require(sound['file'] not in payloads or payloads[sound['file']] == wav, 'Conflicting WAV payload')
                        payloads[sound['file']] = wav
                    else:
                        require(sounds[key]['provenance'] == row, 'Conflicting stable sound identity')
                    slots.append({'index': index, 'reference': reference, 'dependencyId': key})
                arrays.append({'property': property_name, 'slots': slots})
            # Validate any retained native property offsets against the exact raw
            # array entries; missing male offsets remain explicitly unresolved.
            for tag in proof['nativeNotification'].get('surfacePropertyTags', []):
                require(raw['properties'][tag['name']][tag['arrayIndex']] == tag['reference'],
                        'Native property provenance differs from authored array')
            direct = None
            if raw.get('sound') is not None:
                name = raw.get('resolvedFile')
                require(name in archive_files, 'Direct cue lacks its original actor payload')
                direct = {'status': 'existing-actor-only-unconsumed', 'file': name,
                          'sha256': digest(archive_files[name]), 'bytes': len(archive_files[name])}
            events.append({'ordinal': ordinal, 'manifestPointer': f'/animationEvents/{ordinal}',
                           'event': copy.deepcopy(raw), 'arrays': arrays, 'provenance': proof, 'directSound': direct})
        clips = []
        for clip in selected:
            records = [e['event'] for e in events if e['event']['clip'] == clip['name']]
            require(records, 'Selected clip has no retained event timeline: ' + clip['name'])
            frames, rate = records[0]['sourceFrames'], records[0]['sourceRate']
            require(type(frames) is int and frames > 0 and isinstance(rate, (int, float)) and
                    not isinstance(rate, bool) and math.isfinite(rate) and rate > 0 and
                    all((e['sourceFrames'], e['sourceRate']) == (frames, rate) for e in records), 'Inconsistent source clip timeline')
            clips.append({'name': clip['name'], 'frames': frames, 'rate': rate, 'durationSeconds': frames / rate, 'gait': clip['gait']})
        actors.append({'catalogId': catalog_id, 'assetId': asset['id'], 'archiveSha256': selection['archive']['sha256'],
                       'assetManifestSha256': manifest_hash, 'source': asset['source'], 'clips': clips, 'events': events})
    require(sounds, 'No selected surface-sound dependencies')
    inputs.unchanged()
    manifest = {'schemaVersion': 1, 'kind': KIND,
                'inputs': [{k: v for k, v in row.items() if k != 'mtimeNs'} for row in inputs.records.values()],
                'actors': actors, 'sounds': list(sounds.values()),
                'coverage': {'actors': len(actors), 'events': sum(len(a['events']) for a in actors),
                             'surfaceEvents': sum(bool(e['arrays']) for a in actors for e in a['events']),
                             'surfaceOnlyEvents': sum(bool(e['arrays']) and e['event'].get('sound') is None for a in actors for e in a['events']),
                             'directSoundEvents': sum(e['directSound'] is not None for a in actors for e in a['events']),
                             'arraySlots': sum(len(array['slots']) for a in actors for e in a['events'] for array in e['arrays']),
                             'dependencies': len(sounds), 'wavFiles': len(payloads), 'runtimeConnected': False,
                             'selectedArrayProperties': properties},
                'limits': ['Supplementary dependencies only; original actor/model archives are unchanged.',
                           'Ordered authored arrays and duplicate slots retained. Native effective PostLoad/surface/random selection is unproved.',
                           'Direct breath cues remain in actor archives and unconsumed; Random values are not unconditional playback rules.',
                           'Missing native property offsets remain unresolved. Packaging does not establish audible/native playback parity.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path)
    output = checked(output)
    require(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        source = child(inputs.root, name)
        require(not source.is_relative_to(output) and not output.is_relative_to(source.parent),
                'Output overlaps an input or its retained directory')
    exists = output.exists()
    if exists:
        require(output.is_dir(), 'Output is not a directory')
        actual = set()
        for path in output.rglob('*'):
            checked(path)
            if path.is_file():actual.add(path.relative_to(output).as_posix())
        require(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, value in payloads.items():
            require(child(output, name).read_bytes() == value, 'Existing immutable output differs; preserved: ' + name)
    require(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        # Manifest is the completion marker; never replace an existing file.
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = child(output, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            checked(path.parent)
            with path.open('xb') as handle:handle.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(value), 'sha256': digest(value)} for name, value in sorted(payloads.items())]}
