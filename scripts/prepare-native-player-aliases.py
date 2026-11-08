#!/usr/bin/env python3
"""Prepare the native animation-alias update for the four staged Human player profiles.

Inputs (all verified, nothing hand-copied):
- the alias-coverage report of scripts/report-native-animation-aliases.py, which
  is re-verified here (rebuilt from the staged packages and the pinned
  LineageWarrior.int; every report output must match its bytes on disk);
- the current managed player-profile manifest named by public/l2/catalog.json
  (hash/length verified) for the FFighter/MMagic/FMagic rows;
- recipes/native-player-mfighter-base.json, the browser's built-in male fighter
  profile (kept equal to the TypeScript default by a unit test).

Output: a scripts/stage_native_players.py recipe that supersedes each profile
with its WT_HAND alias map (clips) and per-alias native key/status/reason
(aliasEvidence). Only optional aliases and their evidence change; package,
source, scale, collision, facing, equipment and the four core clips must equal
the current profile, and the core clips must equal the native family values.

Modes: default writes the recipe when missing (refusing different existing
bytes; an unchanged repeat writes nothing), --plan writes nothing, --verify-only
requires the recipe to exist and match.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
from reference_client_guard import require_reference_client
from stage_native_players import (
    BOUND_STATUSES, BUILT_IN, BUNDLE_ID, PLAYER_ALIASES, REQUIRED_ALIASES, UNBOUND_STATUSES, decode, profile_shape)

REPORT_DIRECTORY = 'artifacts/native-parity/research/dev-sheet-audio-20261107/models'
GENERATOR = 'scripts/prepare-native-player-aliases.py'
PROFILE_ALIASES_BY_DIFFERENTLY_NAMED_REPORT_ALIAS = {'wait': 'idle', 'atk01': 'attack', 'picItem': 'pickup'}
FAMILY = 'WT_HAND'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def portable(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def load_report_module():
    spec = importlib.util.spec_from_file_location('native_animation_alias_report', ROOT / 'scripts/report-native-animation-aliases.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def profile_alias(name):
    if name.startswith('social[') and name.endswith(']'):
        return 'social' + str(int(name[7:-1]))
    return PROFILE_ALIASES_BY_DIFFERENTLY_NAMED_REPORT_ALIAS.get(name, name)


def profile_with_core_clips_and_no_alias_evidence(profile):
    base = copy.deepcopy(profile)
    base['clips'] = {alias: profile['clips'][alias] for alias in REQUIRED_ALIASES}
    base.pop('aliasEvidence', None)
    return base


def managed_profiles(catalog_path, public):
    catalog = decode(catalog_path.read_bytes())
    for bundle in catalog.get('playerProfiles', []):
        if bundle.get('id') != BUNDLE_ID:
            continue
        expected = bundle['manifestSha256']
        require(bundle['manifest'] == f'/l2/player-profiles/{expected}/manifest.json', 'Unexpected player manifest reference')
        blob = (public / 'player-profiles' / expected / 'manifest.json').read_bytes()
        require(digest(blob) == expected and len(blob) == bundle['manifestBytes'], 'Player manifest hash/length differs')
        manifest = decode(blob)
        require(manifest.get('kind') == 'native-player-profiles', 'Invalid player manifest')
        return manifest['profiles']
    return []


def alias_update(package, report_path, report_sha, report_directory):
    family = package['familySource']
    if family['kind'] == 'staged-package':
        family_path = family['path']
    else:
        family_path = portable(report_directory / family['path'])
    clips, rows = {}, []
    for row in package['aliases']:
        alias = profile_alias(row['alias'])
        if alias not in PLAYER_ALIASES:
            continue
        require(row['alias'] == 'rebirth' or row.get('family') in (FAMILY, None), 'Unexpected report family for ' + row['alias'])
        status = row['status']
        require(status in BOUND_STATUSES or status in UNBOUND_STATUSES, 'Unexpected report status: ' + status)
        require(isinstance(row.get('key'), str), 'Report alias lacks a native key: ' + row['alias'])
        entry = {'alias': alias, 'key': row['key'], 'status': status}
        for name in ('reference', 'line', 'selectionPath', 'reason'):
            if row.get(name) is not None:
                entry[name] = row[name]
        if alias == 'damage' and status != 'exact':
            entry['reason'] = package['damage']['answer']
        if status in BOUND_STATUSES:
            require(isinstance(row.get('clip'), str) and row['clip'] in package['clips'], 'Report binds an unexported clip: ' + row['alias'])
            clips[alias] = row['clip']
        else:
            require(row.get('clip') is None and row.get('reason'), 'Unbound report alias lacks its reason: ' + row['alias'])
        rows.append(entry)
    require(sorted(entry['alias'] for entry in rows) == sorted(PLAYER_ALIASES), 'Report does not cover every player alias for ' + package['class'])
    order = {alias: index for index, alias in enumerate(PLAYER_ALIASES)}
    rows.sort(key=lambda entry: order[entry['alias']])
    evidence = {'generator': GENERATOR, 'report': report_path, 'reportSha256': report_sha, 'family': FAMILY,
                'familySource': family_path, 'familySourceSha256': family['sha256'], 'rows': rows}
    return clips, evidence


def build(report_directory, catalog_path, public, client, base_path):
    report_module = load_report_module()
    verified = report_module.run(report_directory, catalog_path, client, public, verify_only=True)
    require(verified['status'] == 'verified', 'Alias report is not verified')
    report_file = report_directory / 'ALIAS_COVERAGE.json'
    report_bytes = report_file.read_bytes()
    require(digest(report_bytes) == verified['outputs']['ALIAS_COVERAGE.json'], 'Alias report changed during verification')
    report = json.loads(report_bytes)
    base_document = decode(base_path.read_bytes())
    require(isinstance(base_document, dict) and set(base_document) == {'schemaVersion', 'kind', 'description', 'profile'} and
            base_document['schemaVersion'] == 1 and base_document['kind'] == 'native-player-base-profile', 'Invalid base profile recipe')
    built_in = base_document['profile']
    profile_shape(built_in)
    require(built_in['id'] == BUILT_IN and 'aliasEvidence' not in built_in and set(built_in['clips']) == set(REQUIRED_ALIASES),
            'Base recipe must hold the built-in male fighter without aliases')
    current = managed_profiles(catalog_path, public)
    profiles, supersedes = [], {}
    for package in report['packages']:
        if package['catalogId'] == built_in['catalogId']:
            existing = [row for row in current if row['id'] == BUILT_IN]
            base = built_in
            if existing:
                require(profile_with_core_clips_and_no_alias_evidence(existing[0]) == built_in, 'Staged male fighter row differs from the built-in base recipe')
        else:
            existing = [row for row in current if row['catalogId'] == package['catalogId']]
            require(len(existing) == 1, 'Expected one managed profile for ' + package['catalogId'])
            base = profile_with_core_clips_and_no_alias_evidence(existing[0])
        require(base['assetId'] == package['assetId'] and base['sourceObject'] == package['sourceObject'] and
                base['sourceSha256'] == package['sourceSha256'], 'Profile/report package identity differs: ' + package['catalogId'])
        clips, evidence = alias_update(package, portable(report_file), digest(report_bytes), report_directory)
        for alias in REQUIRED_ALIASES:
            require(clips.get(alias) == base['clips'][alias],
                    f'{base["id"]} core clip {alias} {base["clips"][alias]} differs from the native family value {clips.get(alias)}')
        updated = copy.deepcopy(base)
        updated['clips'] = {alias: clips[alias] for alias in PLAYER_ALIASES if alias in clips}
        updated['aliasEvidence'] = evidence
        profile_shape(updated)
        profiles.append(updated)
        if existing and existing[0] == updated:
            supersedes[updated['id']] = 'built-in' if updated['id'] == BUILT_IN else digest(json_bytes(base))
        elif existing:
            supersedes[updated['id']] = digest(json_bytes(existing[0]))
        else:
            require(updated['id'] == BUILT_IN, 'Only the built-in male fighter may be added by an alias update')
            supersedes[updated['id']] = 'built-in'
    recipe = {'schemaVersion': 1, 'kind': 'native-player-stage', 'models': [], 'profiles': profiles, 'supersedes': supersedes}
    coverage = {profile['id']: f'{len(profile["clips"])} of {len(PLAYER_ALIASES)}' for profile in profiles}
    return (json.dumps(recipe, indent=2, ensure_ascii=False) + '\n').encode('utf-8'), coverage


def run(output, report_directory, catalog, public, client, base, *, plan_only=False, verify_only=False):
    require(not (plan_only and verify_only), 'Choose plan or verify-only, not both')
    output, report_directory, catalog, public, client, base = (Path(value).resolve() for value in (output, report_directory, catalog, public, client, base))
    require(output.is_relative_to(ROOT / 'recipes'), 'The alias recipe is written under recipes/ only')
    data, coverage = build(report_directory, catalog, public, client, base)
    exists = output.exists()
    if exists:
        require(output.read_bytes() == data, 'Existing alias recipe differs; refusing to overwrite: ' + str(output))
    require(not verify_only or exists, 'Alias recipe is missing: ' + str(output))
    if not exists and not plan_only and not verify_only:
        with output.open('xb') as stream:
            stream.write(data)
    return {'status': 'planned' if plan_only else 'verified' if verify_only else 'written' if not exists else 'unchanged',
            'recipe': portable(output), 'recipeSha256': digest(data), 'coverage': coverage,
            'filesWritten': 0 if plan_only or verify_only or exists else 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, default=ROOT / 'recipes/native-player-aliases-stage.json')
    parser.add_argument('--report-dir', type=Path, default=ROOT / REPORT_DIRECTORY)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'public/l2/catalog.json')
    parser.add_argument('--public', type=Path, default=ROOT / 'public/l2')
    parser.add_argument('--client', type=Path, default=ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--base', type=Path, default=ROOT / 'recipes/native-player-mfighter-base.json')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        require_reference_client(args.client)
        result = run(args.output, args.report_dir, args.catalog, args.public, args.client, args.base,
                     plan_only=args.plan, verify_only=args.verify_only)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Alias recipe preparation failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
