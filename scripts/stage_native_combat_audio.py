from __future__ import annotations

import argparse
import copy
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points
from stage_native_players import decode, digest, require, HASH, ID
from native_store.catalog_writer import immutable_write, replace_file

COMBAT_AUDIO_STAGE_DESCRIPTION = (
    'Stage a verified combat-audio dependency bundle without replacing actor assets.\n'
    '\n'
    'Additive: writes /l2/combat-audio/<manifest-sha>/ and one catalog.combatAudio\n'
    'record, guarded by the expected catalog SHA-256. A different existing record\n'
    'with the same id is replaced only when --replace-manifest-sha256 names it;\n'
    'the superseded /l2/combat-audio/<old-sha>/ directory is then removed only if\n'
    'every file in it is exactly one listed by its own manifest. No extraction,\n'
    'native execution, Editor save, model change or playback policy.'
)

ROOT = Path(__file__).resolve().parent.parent
KIND = 'native-combat-audio-dependencies'
CAPACITY = 8


def retired_files(public, old_sha256):
    folder = confined_child_path(public, 'combat-audio/' + old_sha256)
    if not folder.exists(): return []
    require(folder.is_dir(), 'Superseded combat-audio path is not a directory; preserved')
    manifest_bytes = confined_child_path(folder, 'manifest.json').read_bytes()
    require(digest(manifest_bytes) == old_sha256, 'Superseded combat-audio manifest differs; preserved')
    manifest = decode(manifest_bytes)
    require(manifest.get('kind') == KIND and isinstance(manifest.get('sounds'), list), 'Superseded combat-audio bundle is unsupported; preserved')
    listed = {'manifest.json': old_sha256}
    for sound in manifest['sounds']:
        require(isinstance(sound, dict) and isinstance(sound.get('file'), str) and HASH.fullmatch(str(sound.get('sha256'))),
                'Superseded combat-audio descriptor is invalid; preserved')
        listed[sound['file']] = sound['sha256']
    found = []
    for path in sorted(folder.rglob('*')):
        refuse_reparse_points(path)
        if path.is_dir(): continue
        name = path.relative_to(folder).as_posix()
        require(name in listed and digest(path.read_bytes()) == listed[name], 'Superseded combat-audio folder holds unlisted/changed files; preserved: ' + name)
        found.append(path)
    return found


def stage(bundle, manifest_sha256, expected_catalog_sha256, *, bundle_id='native-combat-audio',
          plan=False, verify_only=False, replace_manifest_sha256=None, root=ROOT):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    require(isinstance(bundle_id, str) and ID.fullmatch(bundle_id), 'Invalid combat-audio bundle identity')
    require(HASH.fullmatch(manifest_sha256) and HASH.fullmatch(expected_catalog_sha256), 'Invalid staging hash')
    require(replace_manifest_sha256 is None or (HASH.fullmatch(replace_manifest_sha256) and replace_manifest_sha256 != manifest_sha256),
            'Invalid replaced combat-audio manifest hash')
    root, bundle = refuse_reparse_points(root), refuse_reparse_points(bundle)
    require(bundle.is_relative_to(root) and bundle != root, 'Bundle must be a project child')
    public = refuse_reparse_points(root / 'public/l2')
    catalog_path = confined_child_path(public, 'catalog.json')
    before = catalog_path.read_bytes()
    require(digest(before) == expected_catalog_sha256, 'Catalog changed; preserve it and inspect the new baseline')
    catalog = decode(before)
    require(catalog.get('schemaVersion') == 1 and isinstance(catalog.get('models'), list), 'Invalid native catalog')
    manifest_bytes = confined_child_path(bundle, 'manifest.json').read_bytes()
    require(digest(manifest_bytes) == manifest_sha256, 'Combat-audio manifest hash differs')
    manifest = decode(manifest_bytes)
    require(manifest.get('schemaVersion') == 1 and manifest.get('kind') == KIND, 'Unsupported combat-audio bundle')
    selections, sounds = manifest.get('selections'), manifest.get('sounds')
    require(isinstance(selections, list) and 0 < len(selections) <= 64 and
            isinstance(sounds, list) and 0 < len(sounds) <= 4096, 'Invalid combat-audio coverage')
    models = {row.get('id'): row for row in catalog['models']}
    require(len(models) == len(catalog['models']), 'Duplicate catalog model identity')
    actors = []
    for selection in selections:
        if selection.get('kind') != 'actor': continue
        model = models.get(selection.get('catalogId'))
        require(model is not None, 'Combat actor is not in the catalog: ' + str(selection.get('catalogId')))
        require(isinstance(model.get('source'), dict) and model['source'].get('object') == selection.get('sourceObject'),
                'Combat actor source differs from the catalog: ' + selection['catalogId'])
        actors.append(selection['catalogId'])
    prefix = 'combat-audio/' + manifest_sha256 + '/'
    files = {prefix + 'manifest.json': manifest_bytes}
    dependencies = set()
    for sound in sounds:
        require(isinstance(sound, dict) and isinstance(sound.get('sha256'), str) and HASH.fullmatch(sound['sha256']) and
                sound.get('mime') == 'audio/wav' and sound.get('file') == 'audio/' + sound['sha256'] + '.wav' and
                type(sound.get('bytes')) is int and 0 < sound['bytes'] <= 8_000_000, 'Invalid audio payload descriptor')
        identity = sound.get('dependencyId')
        require(isinstance(identity, str) and identity not in dependencies, 'Duplicate/missing source sound identity')
        dependencies.add(identity)
        payload = confined_child_path(bundle, sound['file']).read_bytes()
        require(len(payload) == sound['bytes'] and digest(payload) == sound['sha256'], 'Original audio payload differs')
        files[prefix + sound['file']] = payload
    entry = {'id': bundle_id, 'manifest': '/l2/' + prefix + 'manifest.json',
             'manifestBytes': len(manifest_bytes), 'manifestSha256': manifest_sha256}
    updated = copy.deepcopy(catalog)
    records = updated.setdefault('combatAudio', [])
    require(isinstance(records, list) and len(records) <= CAPACITY, 'Invalid combat-audio catalog')
    matching = [index for index, item in enumerate(records) if item.get('id') == bundle_id]
    require(len(matching) <= 1, 'Duplicate combat-audio catalog identity; preserved')
    current = records[matching[0]] if matching else None
    replacing = current is not None and current != entry
    require(not replacing or (replace_manifest_sha256 is not None and current.get('manifestSha256') == replace_manifest_sha256),
            'Existing combat-audio identity differs; preserved (pass --replace-manifest-sha256 <its manifest sha>)')
    if replacing: records[matching[0]] = entry
    elif current is None:
        require(len(records) < CAPACITY, 'Combat-audio catalog capacity reached')
        records.append(entry)
    after = before if current == entry else json_bytes(updated)
    referenced = {item.get('manifestSha256') for item in updated['combatAudio']}
    retire = retired_files(public, replace_manifest_sha256) if replace_manifest_sha256 and replace_manifest_sha256 not in referenced else []
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
    written = removed = 0
    if not plan and not verify_only:
        for name, payload in files.items():
            immutable_write(confined_child_path(public, name), payload)
        require(catalog_path.read_bytes() == before, 'Catalog changed during resource staging')
        if before != after:
            replace_file(catalog_path, after)
        written = len(new_files) + int(before != after)
        for path in retire:
            path.unlink(); removed += 1
        for folder in sorted({path.parent for path in retire}, key=lambda item: len(item.parts), reverse=True):
            while folder != public and folder.is_relative_to(public / 'combat-audio') and folder.exists() and not any(folder.iterdir()):
                folder.rmdir(); folder = folder.parent
    return {'schemaVersion': 1, 'kind': 'native-combat-audio-stage', 'mode': 'plan' if plan else 'verify' if verify_only else 'stage',
            'bundle': str(bundle.relative_to(root)).replace('\\', '/'), 'entry': entry,
            'sourceCatalogSha256': digest(before), 'resultingCatalogSha256': digest(after),
            'replacedManifestSha256': replace_manifest_sha256 if replacing else None,
            'retiredResources': [path.relative_to(public).as_posix() for path in retire], 'filesRemoved': removed,
            'newResources': new_files, 'resourceCount': len(files), 'filesWritten': written,
            'actors': sorted(actors), 'soundDependencies': len(dependencies),
            'scope': 'Additive dependency staging only; model/Editor assets and playback policy unchanged'}


def main():
    parser = argparse.ArgumentParser(description=COMBAT_AUDIO_STAGE_DESCRIPTION)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected-catalog-sha256', required=True)
    parser.add_argument('--id', default='native-combat-audio')
    parser.add_argument('--replace-manifest-sha256', default=None,
                        help='Replace the existing catalog record only if it names exactly this superseded manifest')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    print(json_bytes(stage(args.bundle, args.manifest_sha256, args.expected_catalog_sha256,
                           bundle_id=args.id, plan=args.plan, verify_only=args.verify_only,
                           replace_manifest_sha256=args.replace_manifest_sha256)).decode(), end='')


if __name__ == '__main__':
    main()
