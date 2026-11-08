from __future__ import annotations

import argparse
import copy
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points
from stage_native_players import decode, digest, require, HASH, ID
from stage_native_runtime import immutable_write, replace_file

WORLD_AUDIO_STAGE_DESCRIPTION = (
    'Stage a verified world-audio bundle (map music or ambience) into public/l2.\n'
    '\n'
    "Additive and independently runnable: copies the bundle's manifest and listed\n"
    'payloads to immutable content-addressed paths and adds one catalog.worldAudio\n'
    'record. No extraction, conversion, Editor save or playback policy runs here.\n'
    'The mutable catalog is guarded by its expected SHA-256; re-read the baseline\n'
    'and rerun if another stager changed it.'
)

ROOT = Path(__file__).resolve().parent.parent
KINDS = {'native-map-music': {'audio/ogg', 'audio/mp4'}, 'native-map-ambience': {'audio/wav'}}
MAX_FILE, MAX_TOTAL, MAX_RECORDS = 8_000_000, 96_000_000, 8


def stage(bundle, manifest_sha256, expected_catalog_sha256, *, bundle_id, plan=False, verify_only=False, root=ROOT):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    require(isinstance(bundle_id, str) and ID.fullmatch(bundle_id), 'Invalid world-audio bundle identity')
    require(HASH.fullmatch(manifest_sha256) and HASH.fullmatch(expected_catalog_sha256), 'Invalid staging hash')
    root, bundle = refuse_reparse_points(root), refuse_reparse_points(bundle)
    require(bundle.is_relative_to(root) and bundle != root, 'Bundle must be a project child')
    public = refuse_reparse_points(root / 'public/l2')
    catalog_path = confined_child_path(public, 'catalog.json')
    before = catalog_path.read_bytes()
    require(digest(before) == expected_catalog_sha256, 'Catalog changed; preserve it and inspect the new baseline')
    catalog = decode(before)
    require(catalog.get('schemaVersion') == 1 and isinstance(catalog.get('models'), list), 'Invalid native catalog')
    manifest_bytes = confined_child_path(bundle, 'manifest.json').read_bytes()
    require(digest(manifest_bytes) == manifest_sha256, 'World-audio manifest hash differs')
    manifest = decode(manifest_bytes)
    kind = manifest.get('kind')
    require(manifest.get('schemaVersion') == 1 and kind in KINDS, 'Unsupported world-audio bundle')
    listed = manifest.get('files')
    require(isinstance(listed, list) and 0 < len(listed) <= 4096, 'Invalid world-audio file list')
    prefix = 'world-audio/' + manifest_sha256 + '/'
    files, total = {prefix + 'manifest.json': manifest_bytes}, len(manifest_bytes)
    for row in listed:
        name, sha = row.get('path'), row.get('sha256')
        require(isinstance(sha, str) and HASH.fullmatch(sha) and row.get('mime') in KINDS[kind] and
                type(row.get('bytes')) is int and 0 < row['bytes'] <= MAX_FILE and isinstance(name, str) and
                name.rsplit('/', 1)[-1].split('.')[0] == sha and prefix + name not in files, 'Invalid world-audio payload descriptor')
        payload = confined_child_path(bundle, name).read_bytes()
        require(len(payload) == row['bytes'] and digest(payload) == sha, 'World-audio payload differs: ' + name)
        files[prefix + name] = payload
        total += len(payload)
    require(total <= MAX_TOTAL, 'World-audio bundle exceeds the staging budget')
    entry = {'id': bundle_id, 'kind': kind, 'manifest': '/l2/' + prefix + 'manifest.json',
             'manifestBytes': len(manifest_bytes), 'manifestSha256': manifest_sha256}
    updated = copy.deepcopy(catalog)
    records = updated.setdefault('worldAudio', [])
    require(isinstance(records, list) and len(records) <= MAX_RECORDS, 'Invalid world-audio catalog')
    matching = [item for item in records if item.get('id') == bundle_id]
    require(len(matching) <= 1 and (not matching or matching[0] == entry), 'Existing world-audio identity differs; preserved')
    require(not any(item.get('kind') == kind and item.get('id') != bundle_id for item in records), 'Another bundle of this kind is staged; preserved')
    if not matching:
        require(len(records) < MAX_RECORDS, 'World-audio catalog capacity exceeded')
        records.append(entry)
    after = before if matching else json_bytes(updated)
    new_files = []
    for name, payload in files.items():
        target = confined_child_path(public, name)
        if target.exists():
            require(target.read_bytes() == payload, 'Existing immutable audio resource differs; preserved: ' + name)
        else:
            new_files.append(name)
    if verify_only:
        require(not new_files and before == after, 'Bundle is not completely staged')
    require(catalog_path.read_bytes() == before, 'Catalog changed during staging')
    written = 0
    if not plan and not verify_only:
        for name, payload in files.items():
            immutable_write(confined_child_path(public, name), payload)
        require(catalog_path.read_bytes() == before, 'Catalog changed during resource staging')
        if before != after:
            replace_file(catalog_path, after)
        written = len(new_files) + int(before != after)
    return {'schemaVersion': 1, 'kind': 'native-world-audio-stage', 'mode': 'plan' if plan else 'verify' if verify_only else 'stage',
            'bundle': str(bundle.relative_to(root)).replace('\\', '/'), 'entry': entry,
            'sourceCatalogSha256': digest(before), 'resultingCatalogSha256': digest(after),
            'newResources': len(new_files), 'resourceCount': len(files), 'resourceBytes': total, 'filesWritten': written,
            'scope': 'Additive world-audio staging only; models, sections, Editor assets and playback policy unchanged'}


def main():
    parser = argparse.ArgumentParser(description=WORLD_AUDIO_STAGE_DESCRIPTION)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected-catalog-sha256', required=True)
    parser.add_argument('--id', required=True, help='e.g. map-20-20-music or map-20-20-ambience')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    print(json_bytes(stage(args.bundle, args.manifest_sha256, args.expected_catalog_sha256,
                           bundle_id=args.id, plan=args.plan, verify_only=args.verify_only)).decode(), end='')


if __name__ == '__main__':
    main()
