"""Add verified player packages/profiles without replacing the native world catalog.

Only this project's public/l2 is writable. Conversion and Editor import are
separate operations. Existing assets and profile identities are immutable.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import stat
import struct
import sys

from native_assets_lib.gltf import json_bytes
from stage_native_runtime import immutable_write, replace_file, verified_archive

ROOT = Path(__file__).resolve().parent.parent
HASH = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
CATALOG_ID = re.compile(r'[a-z0-9][a-z0-9:-]{0,95}')
OBJECT = re.compile(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+')
BUNDLE_ID = 'native-player-profiles'
MAX_MANIFEST = 2_000_000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def browser_string(value, maximum=512):
    # JavaScript string.length counts UTF-16 units, not Unicode code points.
    return isinstance(value, str) and 0 < len(value.encode('utf-16-le')) // 2 <= maximum


def checked(path):
    path = Path(path).absolute()
    for entry in (path, *path.parents):
        if entry.exists() or entry.is_symlink():
            info = entry.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'Symlink/junction/reparse path refused: ' + str(entry))
    return path.resolve()


def relative_name(value):
    require(isinstance(value, str) and value and '\\' not in value, 'Expected a portable relative path')
    for part in value.split('/'):
        require(part and part not in ('.', '..') and not re.search(r'[:*?<>"|\x00-\x1f]', part)
                and not part.endswith(('.', ' '))
                and not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I),
                'Unsafe player staging path: ' + value)
    return value


def child(root, name):
    path = checked(root / relative_name(name))
    require(path != root and path.is_relative_to(root), 'Player staging path escapes its root')
    return path


def decode(data, max_bytes=8_000_000):
    require(0 < len(data) <= max_bytes, 'Missing/oversized player staging JSON')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON: ' + value)))


def clip_names(data):
    require(len(data) >= 28 and struct.unpack_from('<3I', data) == (0x46546c67, 2, len(data)), 'Invalid model GLB header')
    length, kind = struct.unpack_from('<2I', data, 12)
    require(kind == 0x4e4f534a and length % 4 == 0 and 20 + length + 8 <= len(data), 'Invalid model GLB JSON chunk')
    # Animation-heavy models can have large JSON chunks (the converted female
    # package has 27 MB); retain the archive verifier's 96 MiB payload bound.
    document = decode(data[20:20 + length], max_bytes=96 * 1024 * 1024)
    binary_length, binary_kind = struct.unpack_from('<2I', data, 20 + length)
    require(binary_kind == 0x004e4942 and 28 + length + binary_length == len(data), 'Invalid model GLB binary chunk')
    require(isinstance(document, dict) and document.get('asset', {}).get('version') == '2.0', 'Invalid model glTF document')
    animations = document.get('animations', [])
    require(isinstance(animations, list) and 0 < len(animations) <= 65536, 'Player model requires animation clips')
    names = [entry.get('name') if isinstance(entry, dict) else None for entry in animations]
    require(all(isinstance(name, str) and name for name in names) and len(set(names)) == len(names), 'Missing/duplicate player animation names')
    return set(names)


def model_record(catalog_id, path, expected_hash):
    result, archive, asset, payloads = verified_archive(path, expected_hash)
    asset = decode(payloads['asset.json'])
    require(result['kind'] == 'model' and asset.get('model', {}).get('file') == 'model.glb', 'Player staging requires model.glb model packages')
    require(asset.get('source', {}).get('edition') == 'interlude', 'Player model is not an Interlude source package')
    require(isinstance(asset.get('limitations'), list), 'Player model lacks coverage limitations')
    model = payloads['model.glb']
    record = {'id': catalog_id, 'assetId': asset['id'], 'source': asset['source'],
              'archive': '/l2/' + expected_hash + '/asset.l2asset', 'archiveSha256': expected_hash,
              'model': '/l2/' + expected_hash + '/model.glb', 'modelSha256': digest(model),
              'nativeSkinAdapter': asset['model'].get('nativeSkinAdapter'), 'limitations': asset['limitations']}
    files = {expected_hash + '/asset.l2asset': archive}
    for name, payload in payloads.items():
        relative_name(name)
        require(name.casefold() != 'asset.l2asset', 'Embedded archive path conflicts with staged package')
        files[expected_hash + '/' + name] = payload
    return record, asset, clip_names(model), files


def profile_shape(profile):
    fields = {'id', 'name', 'catalogId', 'assetId', 'sourceObject', 'sourceSha256', 'clips', 'forwardAxis', 'actorScale',
              'collisionRadius', 'collisionHeight', 'sourceUnitsPerMetre', 'upperItems', 'sourceEvidence', 'limitations'}
    require(isinstance(profile, dict) and set(profile) == fields, 'Invalid player profile fields')
    require(isinstance(profile['id'], str) and ID.fullmatch(profile['id']) and
            isinstance(profile['name'], str) and 0 < len(profile['name']) <= 128, 'Invalid player profile identity')
    require(profile['id'] != 'human-male-fighter', 'Built-in human-male-fighter profile cannot be replaced')
    require(isinstance(profile['catalogId'], str) and CATALOG_ID.fullmatch(profile['catalogId']) and
            browser_string(profile['assetId']) and
            browser_string(profile['sourceObject']) and OBJECT.fullmatch(profile['sourceObject']) and
            isinstance(profile['sourceSha256'], str) and HASH.fullmatch(profile['sourceSha256']), 'Invalid player source identity')
    require(type(profile['sourceUnitsPerMetre']) is int and profile['sourceUnitsPerMetre'] == 100, 'Player profile source units must be 100 per metre')
    for name in ('collisionRadius', 'collisionHeight'):
        value = profile[name]
        require(type(value) in (int, float) and math.isfinite(value) and 0 < value <= 10000, 'Invalid player collision dimension')
    axis = profile['forwardAxis']
    require(isinstance(axis, list) and len(axis) == 3 and all(type(value) in (int, float) and math.isfinite(value) for value in axis)
            and axis[1] == 0 and abs(math.hypot(axis[0], axis[2]) - 1) <= 1e-6,
            'Player facing must be a finite normalized horizontal vector')
    scale = profile['actorScale']
    require(isinstance(scale, list) and len(scale) == 3 and
            all(type(value) in (int, float) and math.isfinite(value) and 0 < value <= 100 for value in scale),
            'Player actorScale must contain three positive finite presentation-axis values')
    clips = profile['clips']
    require(isinstance(clips, dict) and set(clips) == {'idle', 'run', 'attack', 'death'} and
            all(isinstance(value, str) and 0 < len(value) <= 128 for value in clips.values()), 'Invalid player clip selection')
    require(isinstance(profile['sourceEvidence'], dict) and profile['sourceEvidence'], 'Player profile requires source evidence')
    require(isinstance(profile['limitations'], list) and 0 < len(profile['limitations']) <= 64 and
            all(browser_string(value) for value in profile['limitations']), 'Player profile requires explicit limitations')
    items = profile['upperItems']
    require(isinstance(items, list) and len(items) <= 64, 'Invalid upper-item bindings')
    ids = set()
    for item in items:
        require(isinstance(item, dict) and set(item) == {'itemId', 'catalogId', 'sourceObject', 'sourceSha256'}, 'Invalid upper-item fields')
        require(type(item['itemId']) is int and 0 < item['itemId'] <= 2**31 - 1 and item['itemId'] not in ids,
                'Invalid/duplicate upper-item identity')
        ids.add(item['itemId'])
        require(isinstance(item['catalogId'], str) and CATALOG_ID.fullmatch(item['catalogId']) and
                browser_string(item['sourceObject']) and OBJECT.fullmatch(item['sourceObject']) and
                isinstance(item['sourceSha256'], str) and HASH.fullmatch(item['sourceSha256']), 'Invalid upper-item source binding')


def stage(recipe_path, destination, expected_catalog_sha256, *, plan_only=False, verify_only=False, project_root=ROOT):
    require(not (plan_only and verify_only), 'Choose plan or verify-only, not both')
    root = checked(project_root)
    destination = checked(destination if Path(destination).is_absolute() else root / destination)
    require(destination == child(root, 'public/l2'), 'Player staging writes only this project public/l2')
    recipe_path = checked(recipe_path if Path(recipe_path).is_absolute() else root / recipe_path)
    require(recipe_path.is_relative_to(root) and not recipe_path.is_relative_to(destination), 'Recipe must be a project input outside public/l2')
    recipe_bytes = recipe_path.read_bytes()
    recipe = decode(recipe_bytes)
    require(isinstance(recipe, dict) and set(recipe) == {'schemaVersion', 'kind', 'models', 'profiles'} and
            recipe['schemaVersion'] == 1 and recipe['kind'] == 'native-player-stage', 'Invalid player staging recipe')
    require(isinstance(recipe['models'], list) and 0 < len(recipe['models']) <= 128 and
            isinstance(recipe['profiles'], list) and 0 < len(recipe['profiles']) <= 128, 'Player staging needs bounded models and profiles')
    require(isinstance(expected_catalog_sha256, str) and HASH.fullmatch(expected_catalog_sha256), 'Invalid expected catalog hash')
    catalog_path = child(destination, 'catalog.json')
    catalog_bytes = catalog_path.read_bytes()
    require(digest(catalog_bytes) == expected_catalog_sha256, 'Current catalog differs from expected hash; no files changed')
    catalog = decode(catalog_bytes)
    require(isinstance(catalog, dict) and catalog.get('schemaVersion') == 1 and isinstance(catalog.get('models'), list), 'Invalid current native catalog')
    existing_models = {}
    for row in catalog['models']:
        require(isinstance(row, dict) and isinstance(row.get('id'), str) and row['id'] and
                row['id'].casefold() not in existing_models, 'Invalid/duplicate current model identity')
        existing_models[row['id'].casefold()] = row
    updated = copy.deepcopy(catalog)
    files, source_pins, loaded, requested_ids = {}, {recipe_path: digest(recipe_bytes)}, {}, set()
    added_models = []
    for entry in recipe['models']:
        require(isinstance(entry, dict) and set(entry) == {'catalogId', 'archive', 'archiveSha256'}, 'Invalid staging model fields')
        identifier, expected = entry['catalogId'], entry['archiveSha256']
        require(isinstance(identifier, str) and CATALOG_ID.fullmatch(identifier) and identifier.casefold() not in requested_ids,
                'Invalid/duplicate requested model identity')
        require(isinstance(expected, str) and HASH.fullmatch(expected), 'Invalid model archive hash')
        requested_ids.add(identifier.casefold())
        path = child(root, entry['archive'])
        require(not path.is_relative_to(destination) and not destination.is_relative_to(path.parent), 'Model source/output overlap refused')
        record, asset, clips, payloads = model_record(identifier, path, expected)
        source_pins[path] = expected
        current = existing_models.get(identifier.casefold())
        require(current is None or current == record, 'Existing model identity conflicts; current catalog preserved: ' + identifier)
        if current is None:
            updated['models'].append(record)
            existing_models[identifier.casefold()] = record
            added_models.append(identifier)
        loaded[identifier] = (asset, clips)
        for name, payload in payloads.items():
            require(name not in files or files[name] == payload, 'Conflicting staged model resources')
            files[name] = payload

    bundles = catalog.get('playerProfiles', [])
    require(isinstance(bundles, list) and len(bundles) <= 16, 'Invalid player profile catalog')
    all_profiles, managed_profiles, bundle_ids = {}, [], set()
    managed_index, managed_bytes = None, None
    for index, bundle in enumerate(bundles):
        require(isinstance(bundle, dict) and isinstance(bundle.get('id'), str) and ID.fullmatch(bundle['id'])
                and bundle['id'] not in bundle_ids, 'Invalid/duplicate player profile bundle')
        bundle_ids.add(bundle['id'])
        expected = bundle.get('manifestSha256')
        require(isinstance(expected, str) and HASH.fullmatch(expected) and
                bundle.get('manifest') == f'/l2/player-profiles/{expected}/manifest.json' and
                type(bundle.get('manifestBytes')) is int and 0 < bundle['manifestBytes'] <= MAX_MANIFEST, 'Invalid profile manifest reference')
        path = child(destination, bundle['manifest'][4:])
        blob = path.read_bytes()
        require(digest(blob) == expected and len(blob) == bundle['manifestBytes'], 'Current profile manifest hash/length differs')
        source_pins[path] = expected
        manifest = decode(blob)
        require(isinstance(manifest, dict) and set(manifest) == {'schemaVersion', 'kind', 'profiles'} and
                manifest['schemaVersion'] == 1 and manifest['kind'] == 'native-player-profiles' and
                isinstance(manifest['profiles'], list) and 0 < len(manifest['profiles']) <= 128, 'Invalid profile manifest')
        for profile in manifest['profiles']:
            profile_shape(profile)
            require(profile['id'] not in all_profiles, 'Duplicate player identity across manifests')
            all_profiles[profile['id']] = profile
        if bundle['id'] == BUNDLE_ID:
            managed_index, managed_bytes, managed_profiles = index, blob, list(manifest['profiles'])

    def load_existing(identifier):
        if identifier in loaded:
            return loaded[identifier]
        record = existing_models.get(identifier.casefold())
        require(record is not None and record['id'] == identifier, 'Player profile references an unstaged model: ' + identifier)
        expected = record.get('archiveSha256')
        require(isinstance(expected, str) and HASH.fullmatch(expected) and
                record.get('archive') == f'/l2/{expected}/asset.l2asset', 'Invalid referenced model archive')
        path = child(destination, record['archive'][4:])
        generated, asset, clips, payloads = model_record(identifier, path, expected)
        require(generated == record, 'Referenced model record differs from its verified archive')
        for name, payload in payloads.items():
            require(name not in files or files[name] == payload, 'Conflicting staged model resources')
            files[name] = payload
        source_pins[path] = expected
        loaded[identifier] = (asset, clips)
        return asset, clips

    additions, recipe_ids = [], set()
    for profile in recipe['profiles']:
        profile_shape(profile)
        identifier = profile['id']
        require(identifier not in recipe_ids, 'Duplicate requested player profile')
        recipe_ids.add(identifier)
        old = all_profiles.get(identifier)
        require(old is None or old == profile, 'Existing player profile conflicts; no overwrite: ' + identifier)
        asset, clips = load_existing(profile['catalogId'])
        require(asset['id'] == profile['assetId'] and asset['source']['object'] == profile['sourceObject'] and
                asset['source']['sha256'] == profile['sourceSha256'], 'Profile/model source identities differ')
        require(set(profile['clips'].values()) <= clips, 'Player profile selects missing or differently cased clips')
        assembly = asset['source'].get('assembly', [asset['source']['object']])
        for item in profile['upperItems']:
            upper, upper_clips = load_existing(item['catalogId'])
            require(upper['source']['object'] == item['sourceObject'] and upper['source']['sha256'] == item['sourceSha256'] and
                    item['sourceObject'] in assembly, 'Upper item does not match its native replacement part')
            require(set(profile['clips'].values()) <= upper_clips, 'Upper item is missing selected player animation clips')
        if old is None:
            additions.append(profile)
            all_profiles[identifier] = profile
    require(len(all_profiles) <= 128, 'Too many staged player profiles')
    if additions:
        manifest_bytes = json_bytes({'schemaVersion': 1, 'kind': 'native-player-profiles', 'profiles': [*managed_profiles, *additions]})
        require(len(manifest_bytes) <= MAX_MANIFEST, 'Player manifest exceeds browser limit')
        identity = digest(manifest_bytes)
        record = {'id': BUNDLE_ID, 'manifest': f'/l2/player-profiles/{identity}/manifest.json',
                  'manifestSha256': identity, 'manifestBytes': len(manifest_bytes)}
        files[f'player-profiles/{identity}/manifest.json'] = manifest_bytes
        updated.setdefault('playerProfiles', [])
        if managed_index is None:
            updated['playerProfiles'].append(record)
        else:
            updated['playerProfiles'][managed_index] = record
    elif managed_bytes is not None:
        files[f'player-profiles/{digest(managed_bytes)}/manifest.json'] = managed_bytes

    desired = catalog_bytes if updated == catalog else json_bytes(updated)
    missing = []
    for name, payload in files.items():
        path = child(destination, name)
        if path.exists():
            require(path.is_file() and path.read_bytes() == payload, 'Existing immutable player resource differs; preserved: ' + name)
        else:
            missing.append(name)
    require(not verify_only or (not missing and desired == catalog_bytes), 'Player staging is incomplete; verify-only writes nothing')
    # Recheck every source and the catalog immediately before any mutation.
    for path, expected in source_pins.items():
        require(digest(checked(path).read_bytes()) == expected, 'Player staging input changed during preflight')
    require(checked(catalog_path).read_bytes() == catalog_bytes, 'Catalog changed during preflight; no files changed')
    if not plan_only and not verify_only:
        for name in missing:
            immutable_write(child(destination, name), files[name])
        for path, expected in source_pins.items():
            require(digest(checked(path).read_bytes()) == expected, 'Player staging input changed before catalog publication')
        require(checked(catalog_path).read_bytes() == catalog_bytes, 'Catalog changed before publication; verified immutable additions remain unreferenced')
        if desired != catalog_bytes:
            replace_file(catalog_path, desired)
        for name, payload in files.items():
            require(child(destination, name).read_bytes() == payload, 'Staged player resource verification failed')
    return {'status': 'planned' if plan_only else 'verified' if verify_only else 'staged' if missing or desired != catalog_bytes else 'unchanged',
            'catalogBeforeSha256': digest(catalog_bytes), 'resultingCatalogSha256': digest(desired),
            'recipeSha256': digest(recipe_bytes), 'addedModels': added_models, 'addedProfiles': [profile['id'] for profile in additions],
            'requestedProfiles': [profile['id'] for profile in recipe['profiles']], 'verifiedResources': len(files),
            'newResources': missing, 'filesWritten': 0 if plan_only or verify_only else len(missing) + int(desired != catalog_bytes),
            'worldCatalogEntriesPreserved': True, 'authoredSceneEdits': False,
            'scope': 'Additive local package/profile staging; gameplay and native parity require separate validation.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--public', type=Path, default=Path('public/l2'))
    parser.add_argument('--expected-catalog-sha256', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        result = stage(args.recipe, args.public, args.expected_catalog_sha256, plan_only=args.plan, verify_only=args.verify_only)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Player staging failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
