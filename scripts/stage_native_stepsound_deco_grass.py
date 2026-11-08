from __future__ import annotations

import argparse
import copy
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points
from stage_native_players import decode, digest, require, HASH, ID
from native_store.catalog_writer import immutable_write, replace_file

STEPSOUND_DECO_GRASS_STAGE_DESCRIPTION = (
    'Stage a verified deco-grass footstep bundle as an additive catalog record.\n'
    '\n'
    'Adds one `animationAudio` entry with kind `native-stepsound-deco-grass` and the\n'
    'immutable manifest/grid under public/l2/step-sounds/<manifest>/. The grid is an\n'
    'approximation of the native deco instance count (the browser does not render\n'
    'decorations). No extraction, native execution, Editor save or policy change.'
)

ROOT = Path(__file__).resolve().parent.parent
KIND = 'native-stepsound-deco-grass'


def stage(bundle, manifest_sha256, expected_catalog_sha256, *, bundle_id='stepsound-deco-grass-20-20',
          plan=False, verify_only=False, root=ROOT):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    require(isinstance(bundle_id, str) and ID.fullmatch(bundle_id), 'Invalid deco-grass bundle identity')
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
    require(digest(manifest_bytes) == manifest_sha256, 'Deco-grass manifest hash differs')
    manifest = decode(manifest_bytes)
    require(manifest.get('schemaVersion') == 1 and manifest.get('kind') == KIND, 'Unsupported deco-grass bundle')
    grid, terrain = manifest.get('grid'), manifest.get('terrain')
    require(isinstance(grid, dict) and isinstance(terrain, dict) and isinstance(grid.get('sha256'), str) and
            HASH.fullmatch(grid['sha256']) and grid.get('file') == 'grid/' + grid['sha256'] + '.bin' and
            type(grid.get('bytes')) is int and isinstance(terrain.get('quads'), list) and len(terrain['quads']) == 2 and
            grid['bytes'] == terrain['quads'][0] * terrain['quads'][1] * 2, 'Invalid deco-grass grid descriptor')
    payload = confined_child_path(bundle, grid['file']).read_bytes()
    require(len(payload) == grid['bytes'] and digest(payload) == grid['sha256'], 'Deco-grass grid payload differs')
    prefix = 'step-sounds/' + manifest_sha256 + '/'
    files = {prefix + 'manifest.json': manifest_bytes, prefix + grid['file']: payload}
    entry = {'id': bundle_id, 'kind': KIND, 'manifest': '/l2/' + prefix + 'manifest.json',
             'manifestBytes': len(manifest_bytes), 'manifestSha256': manifest_sha256}
    updated = copy.deepcopy(catalog)
    records = updated.setdefault('animationAudio', [])
    require(isinstance(records, list) and len(records) <= 16, 'Invalid animation-audio catalog')
    matching = [item for item in records if item.get('id') == bundle_id]
    require(len(matching) <= 1 and (not matching or matching[0] == entry), 'Existing deco-grass identity differs; preserved')
    require(not [item for item in records if item.get('kind') == KIND and item.get('id') != bundle_id],
            'Another deco-grass bundle is already staged; preserved')
    if not matching:
        require(len(records) < 16, 'Invalid animation-audio catalog capacity')
        records.append(entry)
    after = before if matching else json_bytes(updated)
    new_files = []
    for name, data in files.items():
        target = confined_child_path(public, name)
        if target.exists():
            require(target.read_bytes() == data, 'Existing immutable resource differs; preserved: ' + name)
        else:
            new_files.append(name)
    if verify_only:
        require(not new_files and before == after, 'Bundle is not completely staged')
    require(catalog_path.read_bytes() == before, 'Catalog changed during staging')
    written = 0
    if not plan and not verify_only:
        for name, data in files.items():
            immutable_write(confined_child_path(public, name), data)
        require(catalog_path.read_bytes() == before, 'Catalog changed during resource staging')
        if before != after:
            replace_file(catalog_path, after)
        written = len(new_files) + int(before != after)
    return {'schemaVersion': 1, 'kind': 'native-stepsound-deco-grass-stage', 'mode': 'plan' if plan else 'verify' if verify_only else 'stage',
            'bundle': str(bundle.relative_to(root)).replace('\\', '/'), 'entry': entry,
            'sourceCatalogSha256': digest(before), 'resultingCatalogSha256': digest(after),
            'newResources': new_files, 'resourceCount': len(files), 'filesWritten': written,
            'scope': 'Additive deco-grass footstep staging only; actor/model/Editor assets and playback policy unchanged'}


def main():
    parser = argparse.ArgumentParser(description=STEPSOUND_DECO_GRASS_STAGE_DESCRIPTION)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected-catalog-sha256', required=True)
    parser.add_argument('--id', default='stepsound-deco-grass-20-20')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    print(json_bytes(stage(args.bundle, args.manifest_sha256, args.expected_catalog_sha256,
                           bundle_id=args.id, plan=args.plan, verify_only=args.verify_only)).decode(), end='')


if __name__ == '__main__':
    main()
