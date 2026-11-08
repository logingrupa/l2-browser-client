"""Audit exact ALAudio footstep text against locked source Sound objects.

Only exact object joins are extracted. Unknown references remain explicit gaps.
No client binaries, native playback, browser or production catalog are invoked.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct
import sys
import wave

from native_assets_lib.footstep_config import (
    KEYS, RUNTIME_FLAGS, SECTION, STATIC_LOOKUP_EVIDENCE, decode_config, digest,
    object_match, package_candidates, require, selected_records, sound_payload, strict_reference,
)
from native_audio import decode_native_audio
from native_catalog.ue2 import FormatError, Package
from reference_client_guard import require_reference_client


ROOT = Path(__file__).resolve().parent.parent


def reject_links(path):
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            info = part.lstat()
            require(not part.is_symlink() and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'Linked/reparse source or destination paths are unsupported: ' + str(part))


def inside(path, parent):
    return path == parent or parent in path.parents


def safe_destination(output, source_roots):
    output = output.absolute()
    reject_links(output)
    resolved = output.resolve()
    require(not resolved.exists(), 'Output must be a fresh directory')
    for source in source_roots:
        source = source.resolve()
        require(not inside(resolved, source) and not inside(source, resolved),
                'Output overlaps protected input: ' + str(source))
    return resolved


def canonical(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode('utf-8')


def run(args):
    config = args.config.absolute()
    snapshot = args.client_snapshot.absolute()
    client_access = require_reference_client(snapshot)
    lock_path = args.input_lock.absolute()
    for path in (config, snapshot, lock_path):
        reject_links(path)
    output = safe_destination(args.output, (snapshot, config.parent, lock_path.parent, ROOT/'scripts', ROOT/'tests'))
    inputs = {}

    def read(path, identity):
        path = path.resolve()
        reject_links(path)
        data = path.read_bytes()
        pin = {'identity': identity, 'bytes': len(data), 'sha256': digest(data)}
        previous = inputs.get(path)
        require(previous is None or previous == pin, 'Input changed during read: ' + identity)
        inputs[path] = pin
        return data

    raw = read(config, 'config:' + args.config_source_host + ':' + args.config_source_path)
    require(digest(raw) == args.config_sha256.lower(), 'Config source SHA256 mismatch')
    lock_bytes = read(lock_path, 'source-lock')
    lock = json.loads(lock_bytes.decode('utf-8-sig'))
    require(isinstance(lock.get('files'), list) and lock.get('sourceHost') and lock.get('sourceRoot'), 'Invalid source lock')
    for script in ('scripts/audit-native-footstep-config.py', 'scripts/native_assets_lib/footstep_config.py',
                   'scripts/native_animation_families.py', 'scripts/native_audio.py', 'scripts/native_catalog/ue2.py'):
        read(ROOT/script, script)
    result = {'schemaVersion': 1, 'scope': 'Static ALAudio L2FootStepSound file/source coverage only',
        'configSource': {'host': args.config_source_host, 'path': args.config_source_path,
                         'sha256': digest(raw), 'bytes': len(raw)},
        'staticLookupEvidence': STATIC_LOOKUP_EVIDENCE, 'section': SECTION,
        'matchingPolicy': 'Full qualified casefold equality only; no group insertion, leaf fallback or quote/space stripping',
        'runtime': dict(RUNTIME_FLAGS), 'nativeExecutionPerformed': False, 'browserOrEditorWorkPerformed': False,
        'rows': [], 'extraKeys': [], 'packages': [], 'limitations': [
            'File contents and exact source joins do not establish successful native GConfig/LoadSound/PostLoad execution.',
            'Candidate objects are diagnostic identities, never resolved mappings or extracted playback assets.',
            'Surface/move/boots selection, probabilities, loops, gain/radius and listener behavior remain unestablished.',
            'Literal package.leaf resolution requires native LoadSound group/search evidence.',
        ]}
    writes = {}
    try:
        decoded, framing = decode_config(raw)
        result['configFraming'] = framing
        writes['config/ALAudio.decoded.int'] = decoded
        records, section = selected_records(decoded)
        result['sectionSlice'] = section
        result['status'] = 'audited'
    except FormatError as error:
        records = []
        result['status'] = 'unsupported-or-invalid-config'
        result['error'] = str(error)
        result['sourceHeaderHex'] = raw[:48].hex()
    lookup = {record['key'].casefold(): record for record in records}
    result['extraKeys'] = [record for record in records if record['key'].casefold() not in {key.casefold() for key in KEYS}]
    packages = {}
    for index, key in enumerate(KEYS):
        row = {'requestedKey': key, 'staticDestinationPointerOffset': hex(0x48+index*4),
               **RUNTIME_FLAGS, 'status': 'missing-key'}
        result['rows'].append(row)
        if result['status'] != 'audited':
            row['status'] = 'config-not-decoded'
            continue
        record = lookup.get(key.casefold())
        if record is None:
            continue
        row['configRecord'] = record
        if not record['value']:
            row['status'] = 'empty-value'
            continue
        reference = strict_reference(record['value'])
        if reference is None:
            row['status'] = 'unsupported-reference-syntax'
            continue
        pins = package_candidates(lock['files'], reference)
        if len(pins) != 1:
            row['status'] = 'missing-package' if not pins else 'ambiguous-package'
            row['packageCandidates'] = pins
            continue
        pin = pins[0]
        relative_path = pin['relativePath']
        source = client_access.require_equal_file(relative_path)
        if relative_path not in packages:
            if not source.is_file():
                row['status'] = 'locked-package-not-staged'
                continue
            data = read(source, 'source:' + lock['sourceHost'] + ':' + lock['sourceRoot'] + '/' + relative_path)
            require(len(data) == pin['bytes'] and digest(data) == pin['sha256'], 'Locked source package hash/length mismatch: ' + relative_path)
            package = Package(data, source.name)
            package_identity = {'host': lock['sourceHost'], 'path': lock['sourceRoot']+'/'+relative_path,
                'relativePath': relative_path, 'sha256': digest(data), 'bytes': len(data), 'format': package.summary,
                'soundExports': sum(ex['className'] == 'Sound' for ex in package.exports)}
            packages[relative_path] = (package, package_identity)
            result['packages'].append(package_identity)
        package, package_identity = packages[relative_path]
        row['sourcePackage'] = package_identity
        status, export, candidates = object_match(package, reference)
        row['status'] = status
        if export is not None:
            row['matchedExport'] = {'object': export['object'], 'exportIndex': export['exportIndex'], 'className': export['className']}
        if candidates:
            row['unresolvedCandidates'] = candidates
            row['candidateStatus'] = 'leaf-spelling-only; native group/search behavior unproved; none selected'
        if status != 'resolved':
            continue
        payload, source_metadata = sound_payload(package, export)
        row['nativeSound'] = source_metadata
        name = 'native/'+digest(payload)+'.bin'
        writes[name] = payload
        row['nativePayloadFile'] = name
        row['status'] = 'source-extracted-pending-decode'

    output.mkdir(parents=True, exist_ok=False)
    for relative, data in writes.items():
        target = output/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for row in result['rows']:
        if row['status'] != 'source-extracted-pending-decode':
            continue
        try:
            data, mime, metadata = decode_native_audio(output/row['nativePayloadFile'])
        except (ValueError, EOFError, wave.Error, struct.error) as error:
            row['status'] = 'unsupported-audio-payload'
            row['decodeError'] = str(error)
            continue
        extension = '.wav' if mime == 'audio/wav' else '.ogg'
        name = 'audio/'+digest(data)+extension
        target = output/name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            require(target.read_bytes() == data, 'Content-addressed output collision')
        else:
            target.write_bytes(data)
        row.update({'status': 'resolved-and-extracted', 'outputFile': name, 'mime': mime, 'audio': metadata})
    resolved = [row for row in result['rows'] if row['status'] == 'resolved-and-extracted']
    result['coverage'] = {'expectedKeys': len(KEYS),
        'presentKeys': sum('configRecord' in row for row in result['rows']),
        'resolvedKeyRows': len(resolved), 'missingKeys': sum(row['status'] == 'missing-key' for row in result['rows']),
        'unsupportedKeys': sum(row['status'] in ('unsupported-reference-syntax', 'unsupported-audio-payload', 'config-not-decoded') for row in result['rows']),
        'unresolvedKeyRows': len(KEYS)-len(resolved), 'extraKeys': len(result['extraKeys']),
        'uniqueSourceObjects': len({(row['sourcePackage']['sha256'], row['nativeSound']['object'].casefold()) for row in resolved}),
        'uniquePayloadHashes': len({row['nativeSound']['embeddedPayloadSha256'] for row in resolved}),
        'statusCounts': dict(sorted(Counter(row['status'] for row in result['rows']).items()))}
    for path, pin in inputs.items():
        data = path.read_bytes()
        require(len(data) == pin['bytes'] and digest(data) == pin['sha256'], 'Source changed during audit: ' + pin['identity'])
    result['sourceInputsUnchanged'] = True
    result['inputs'] = sorted(inputs.values(), key=lambda pin: pin['identity'])
    (output/'coverage.json').write_bytes(canonical(result))
    lines = ['# Exact footstep config/source coverage', '',
        f"{result['coverage']['presentKeys']}/24 keys present; {len(resolved)}/24 exact source joins extracted.", '',
        'This is file/source coverage. Native PostLoad, world playback and native parity are unestablished.', '',
        '| Requested key | Literal value | Status | Unresolved candidates (not selected) |',
        '| --- | --- | --- | --- |']
    for row in result['rows']:
        value = row.get('configRecord', {}).get('value', '')
        candidate = ', '.join(item['object'] for item in row.get('unresolvedCandidates', []))
        lines.append(f"| {row['requestedKey']} | {value.replace('|', '&#124;')} | {row['status']} | {candidate} |")
    (output/'REPORT.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    manifest = [{'path': path.relative_to(output).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
                for path in sorted(output.rglob('*')) if path.is_file()]
    (output/'SHA256-MANIFEST.json').write_bytes(canonical({'schemaVersion': 1, 'files': manifest}))
    return {'output': str(output), 'coverageSha256': digest((output/'coverage.json').read_bytes()),
            'coverage': result['coverage'], 'sourceInputsUnchanged': len(inputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--config-sha256', required=True)
    parser.add_argument('--config-source-host', required=True)
    parser.add_argument('--config-source-path', required=True)
    parser.add_argument('--client-snapshot', type=Path, default=Path('artifacts/native-parity/inputs/IMPORTA-PC'))
    parser.add_argument('--input-lock', type=Path, default=Path('recipes/native-inputs.lock.json'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require_reference_client(args.client_snapshot)
    require(re.fullmatch('[a-fA-F0-9]{64}', args.config_sha256) is not None, 'Invalid supplied config hash')
    print(json.dumps(run(args), indent=2))


if __name__ == '__main__':
    main()
