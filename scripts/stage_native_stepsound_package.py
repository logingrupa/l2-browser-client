from __future__ import annotations

import argparse
import copy
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points
from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_assets_lib.strict_json import decode_strict_json
from stage_native_players import ID
from native_store.catalog_writer import immutable_write, replace_file

STEPSOUND_PACKAGE_STAGE_DESCRIPTION = (
    'Stage a verified stepsound package bundle as an additive catalog record.\n'
    '\n'
    'Dedicated, independently runnable staging for an already produced bundle. It\n'
    'adds one `animationAudio` entry with kind `native-stepsound-package` and the\n'
    'immutable manifest/WAV resources under public/l2/step-sounds/<manifest>/.\n'
    'No extraction, native execution, Editor save or playback-policy change.'
)

ROOT = Path(__file__).resolve().parent.parent
KIND = 'native-stepsound-package'


def stage(bundle, manifest_sha256, expected_catalog_sha256, *, bundle_id='stepsound-surfaces',
          plan=False, verify_only=False, root=ROOT):
    require_condition(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    require_condition(isinstance(bundle_id, str) and ID.fullmatch(bundle_id), 'Invalid stepsound bundle identity')
    require_condition(SHA256_HEX_PATTERN.fullmatch(manifest_sha256) and SHA256_HEX_PATTERN.fullmatch(expected_catalog_sha256), 'Invalid staging hash')
    root, bundle = refuse_reparse_points(root), refuse_reparse_points(bundle)
    require_condition(bundle.is_relative_to(root) and bundle != root, 'Bundle must be a project child')
    public = refuse_reparse_points(root / 'public/l2')
    catalog_path = confined_child_path(public, 'catalog.json')
    before = catalog_path.read_bytes()
    require_condition(sha256_hex_digest(before) == expected_catalog_sha256, 'Catalog changed; preserve it and inspect the new baseline')
    catalog = decode_strict_json(before)
    require_condition(catalog.get('schemaVersion') == 1 and isinstance(catalog.get('models'), list), 'Invalid native catalog')
    manifest_bytes = confined_child_path(bundle, 'manifest.json').read_bytes()
    require_condition(sha256_hex_digest(manifest_bytes) == manifest_sha256, 'Stepsound manifest hash differs')
    manifest = decode_strict_json(manifest_bytes)
    require_condition(manifest.get('schemaVersion') == 1 and manifest.get('kind') == KIND, 'Unsupported stepsound bundle')
    sounds = manifest.get('sounds')
    require_condition(isinstance(sounds, list) and 0 < len(sounds) <= 4096 and isinstance(manifest.get('surfaces'), list) and
            manifest['coverage']['sounds'] == len(sounds), 'Invalid stepsound coverage')
    prefix = 'step-sounds/' + manifest_sha256 + '/'
    files = {prefix + 'manifest.json': manifest_bytes}
    identities = set()
    for sound in sounds:
        require_condition(isinstance(sound, dict) and isinstance(sound.get('sha256'), str) and SHA256_HEX_PATTERN.fullmatch(sound['sha256']) and
                sound.get('mime') == 'audio/wav' and sound.get('file') == 'audio/' + sound['sha256'] + '.wav' and
                type(sound.get('bytes')) is int and 0 < sound['bytes'] <= 8_000_000, 'Invalid audio payload descriptor')
        identity = sound.get('dependencyId')
        require_condition(isinstance(identity, str) and identity not in identities, 'Duplicate/missing source sound identity')
        identities.add(identity)
        payload = confined_child_path(bundle, sound['file']).read_bytes()
        require_condition(len(payload) == sound['bytes'] and sha256_hex_digest(payload) == sound['sha256'] and
                payload[:4] == b'RIFF' and payload[8:12] == b'WAVE', 'Original audio payload differs')
        name = prefix + sound['file']
        require_condition(name not in files or files[name] == payload, 'Conflicting audio content identity')
        files[name] = payload
    entry = {'id': bundle_id, 'kind': KIND, 'manifest': '/l2/' + prefix + 'manifest.json',
             'manifestBytes': len(manifest_bytes), 'manifestSha256': manifest_sha256}
    updated = copy.deepcopy(catalog)
    records = updated.setdefault('animationAudio', [])
    require_condition(isinstance(records, list) and len(records) <= 16, 'Invalid animation-audio catalog')
    matching = [item for item in records if item.get('id') == bundle_id]
    require_condition(len(matching) <= 1 and (not matching or matching[0] == entry), 'Existing stepsound identity differs; preserved')
    if not matching:
        require_condition(len(records) < 16, 'Invalid animation-audio catalog capacity')
        records.append(entry)
    after = before if matching else json_bytes(updated)
    new_files = []
    for name, payload in files.items():
        target = confined_child_path(public, name)
        if target.exists():
            require_condition(target.read_bytes() == payload, 'Existing immutable audio resource differs; preserved: ' + name)
        else:
            new_files.append(name)
    if verify_only:
        require_condition(not new_files and before == after, 'Bundle is not completely staged')
    require_condition(catalog_path.read_bytes() == before, 'Catalog changed during staging')
    written = 0
    if not plan and not verify_only:
        for name, payload in files.items():
            immutable_write(confined_child_path(public, name), payload)
        require_condition(catalog_path.read_bytes() == before, 'Catalog changed during resource staging')
        if before != after:
            replace_file(catalog_path, after)
        written = len(new_files) + int(before != after)
    return {'schemaVersion': 1, 'kind': 'native-stepsound-package-stage', 'mode': 'plan' if plan else 'verify' if verify_only else 'stage',
            'bundle': str(bundle.relative_to(root)).replace('\\', '/'), 'entry': entry,
            'sourceCatalogSha256': sha256_hex_digest(before), 'resultingCatalogSha256': sha256_hex_digest(after),
            'newResources': new_files, 'resourceCount': len(files), 'filesWritten': written,
            'soundDependencies': len(identities),
            'scope': 'Additive stepsound package staging only; actor/model/Editor assets and playback policy unchanged'}


def main():
    parser = argparse.ArgumentParser(description=STEPSOUND_PACKAGE_STAGE_DESCRIPTION)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected-catalog-sha256', required=True)
    parser.add_argument('--id', default='stepsound-surfaces')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    print(json_bytes(stage(args.bundle, args.manifest_sha256, args.expected_catalog_sha256,
                           bundle_id=args.id, plan=args.plan, verify_only=args.verify_only)).decode(), end='')


if __name__ == '__main__':
    main()
