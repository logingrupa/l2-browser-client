import argparse
import io
import json
import math
from pathlib import Path
import re
import zipfile

from native_assets import verify_archive
from native_assets_lib.gltf import json_bytes, safe_name
from native_actor_profiles import UNMATCHED_ACTOR_CLASS_MESSAGE, UNMATCHED_NPC_MESH_MESSAGE
from native_assets_lib.qualified_export_names import ROOT_OBJECT_CLASS, is_actor_class_chain, unique_qualified_export_match
from native_catalog.cli import json_bytes as profile_json_bytes
from native_store.catalog_writer import add_store_file, decode_store_catalog, read_current_catalog_bytes, sha256_hex, write_store

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_STAGE_DESCRIPTION = 'Stage verified migration models and textures for this local browser, keeping every other catalog record.'


def contained(root, relative):
    path = root / safe_name(relative)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Runtime resource path escapes its root: ' + relative)
    return path


def checked_payload(root, relative, expected_hash, expected_bytes=None):
    if not isinstance(expected_hash, str) or not re.fullmatch('[a-f0-9]{64}', expected_hash):
        raise ValueError('Invalid runtime resource hash: ' + str(relative))
    payload = contained(root, relative).read_bytes()
    if sha256_hex(payload) != expected_hash or expected_bytes is not None and (type(expected_bytes) is not int or len(payload) != expected_bytes):
        raise ValueError('Runtime resource hash/length differs: ' + relative)
    return payload


def verified_archive(path, expected_hash):
    result = verify_archive(path)
    payload = path.read_bytes()
    if result['sha256'] != expected_hash or sha256_hex(payload) != expected_hash:
        raise ValueError('Migration catalog archive hash differs')
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    return result, payload, json.loads(files['asset.json']), files


def npc_profile_files(migration, job, files):
    identity = job['id']
    if not isinstance(identity, str) or not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', identity):
        raise ValueError('Invalid NPC profile bundle identity')
    base = 'npc-profiles/' + identity
    if job.get('path') != base + '/manifest.json':
        raise ValueError('NPC profile coverage path differs from the declared adapter')
    if job.get('support') != 'source-profile-fields-ready' or job.get('errors') or job.get('unsupported'):
        raise ValueError('NPC profile coverage is incomplete')
    root = contained(migration, base)
    receipt_bytes = contained(root, 'receipt.json').read_bytes()
    receipt = json.loads(receipt_bytes)
    if receipt.get('schemaVersion') != 1 or receipt.get('kind', 'native-npc-profiles') != 'native-npc-profiles':
        raise ValueError('Invalid NPC profile receipt version/kind')
    manifest_bytes = checked_payload(root, 'manifest.json', receipt['manifestSha256'])
    manifest = json.loads(manifest_bytes)
    if (manifest.get('schemaVersion') != 1 or manifest.get('kind') != 'native-npc-profiles' or
        manifest.get('support') != 'source-profile-fields-ready' or manifest.get('errors') or manifest.get('unsupported')):
        raise ValueError('NPC profile manifest is incomplete or unsupported')
    recipe = manifest['recipe']
    if (recipe.get('schemaVersion') != 1 or manifest.get('id') != recipe.get('id') or
        recipe.get('sourceUnitsPerMetre') != 100 or receipt.get('recipeSha256') != sha256_hex(profile_json_bytes(recipe)) or
        manifest.get('tools') != receipt.get('tools') or not isinstance(manifest.get('tools'), dict) or
        manifest.get('sourceFiles') != receipt.get('sourceFiles') or manifest.get('files') != receipt.get('files')):
        raise ValueError('NPC profile receipt differs from manifest metadata')
    payloads = {}
    for record in receipt['files']:
        name = safe_name(record['file'])
        if name.casefold() in {key.casefold() for key in payloads} or name.casefold() in ('manifest.json', 'receipt.json', '.native-npc-profiles-owner.json'):
            raise ValueError('Duplicate/reserved NPC profile artifact path')
        if type(record.get('bytes')) is not int or record['bytes'] < 0:
            raise ValueError('Invalid NPC profile artifact byte length')
        payloads[name] = checked_payload(root, name, record['sha256'], record['bytes'])
    sources = {}
    for record in receipt['sourceFiles']:
        name = safe_name(record['path'])
        if (name.casefold() in {key.casefold() for key in sources} or type(record['bytes']) is not int or record['bytes'] < 0 or
            not isinstance(record['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', record['sha256'])):
            raise ValueError('Invalid/duplicate NPC source package metadata')
        sources[name] = record['sha256']
    if not sources or manifest.get('sourceSelections') not in payloads:
        raise ValueError('NPC profile source selection evidence is missing')
    selections = json.loads(payloads[manifest['sourceSelections']])
    for table_name, filename in (('npcname', recipe['nameTable']), ('npcgrp', 'npcgrp.dat')):
        table = selections['tables'][table_name]
        if table.get('source') != 'system/' + filename or table['source'] not in sources or sources[table['source']] != table.get('sourceSha256'):
            raise ValueError('NPC profile table source identity differs')
    classes = {}
    for name in manifest['classDefinitions']:
        if not isinstance(name, str) or not re.fullmatch(r'\w+(?:\.\w+)+', name) or name in classes:
            raise ValueError('Invalid/duplicate NPC actor class identity')
        path = 'source/classes/' + name + '.json'
        if path not in payloads:
            raise ValueError('NPC actor class definition is missing')
        definition = json.loads(payloads[path])
        source = definition['source']
        if (definition.get('object') != name or source.get('object') != name or source['package'] not in sources or
            sources[source['package']] != source.get('packageSha256')):
            raise ValueError('NPC actor class source identity differs')
        classes[name] = definition
    profiles = manifest['profiles']
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 128:
        raise ValueError('NPC profile bundle requires bounded nonempty profiles')
    ids = [profile['id'] for profile in profiles]
    npc_ids = [profile['npcId'] for profile in profiles]
    if len(set(ids)) != len(ids) or len(set(npc_ids)) != len(npc_ids):
        raise ValueError('Duplicate NPC profile identity')
    selected = selections['selections']
    selected_ids = [row['id'] for row in selected]
    expected = recipe['profiles']
    expected_ids = [row['npcId'] for row in expected]
    if (len(set(selected_ids)) != len(selected_ids) or set(ids) != set(selected_ids) or
        len(set(expected_ids)) != len(expected_ids) or set(npc_ids) != set(expected_ids) or
        manifest['coverage'].get('requestedProfiles') != len(profiles) or manifest['coverage'].get('resolvedProfiles') != len(profiles)):
        raise ValueError('NPC profile selection/coverage identities differ')
    for profile in profiles:
        npc_id = profile['npcId']
        if type(npc_id) is not int or npc_id < 1 or profile['id'] != 'npc:' + str(npc_id):
            raise ValueError('Invalid NPC profile identity')
        selection = next(row for row in selected if row['id'] == profile['id'])
        expectation = next(row for row in expected if row['npcId'] == npc_id)
        group, localized, mesh = selection['groupRow']['row'], selection['nameRow']['row'], selection['meshSource']
        requested_mesh = expectation['expectedMesh']
        if (profile['name'] != expectation['expectedName'] or
            profile['actorClass'] != expectation['expectedActorClass'] or profile.get('sourceUnitsPerMetre') != 100 or
            group.get('npc_id') != npc_id or group.get('mesh_name') != requested_mesh or group.get('class_name') != profile['actorClass'] or
            localized.get('id') != npc_id or localized.get('name') != profile['name'] or not isinstance(mesh.get('object'), str) or
            mesh.get('reference') != requested_mesh or mesh.get('class') != 'SkeletalMesh' or
            mesh.get('resolution') != 'exact-qualified-object' or mesh['package'] not in sources or sources[mesh['package']] != mesh.get('packageSha256')):
            raise ValueError('NPC profile source/name/mesh identity differs')
        if profile['mesh'] != unique_qualified_export_match([mesh['object']], requested_mesh, UNMATCHED_NPC_MESH_MESSAGE).export:
            raise ValueError('NPC profile mesh differs from the mesh export its requested mesh resolves to')
        actor_class_export = unique_qualified_export_match(classes, profile['actorClass'], UNMATCHED_ACTOR_CLASS_MESSAGE).export
        chain = selection['classChain']
        if (not chain or chain[0] != actor_class_export or chain[-1].casefold() != ROOT_OBJECT_CLASS.casefold() or not is_actor_class_chain(chain) or
            len({name.casefold() for name in chain}) != len(chain) or any(name not in classes for name in chain)):
            raise ValueError('NPC profile actor inheritance is incomplete')
        if any(classes[name].get('nativeSuperClass') != (chain[index + 1] if index + 1 < len(chain) else None) for index, name in enumerate(chain)):
            raise ValueError('NPC profile actor inheritance differs from class definitions')
        properties = classes[actor_class_export]['effectiveProperties']
        for field, native in (('drawScale', 'DrawScale'), ('collisionRadius', 'CollisionRadius'), ('collisionHeight', 'CollisionHeight')):
            value = profile.get(field)
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0 or value != properties.get(native):
                raise ValueError('NPC profile scalar differs from native class: ' + field)
        for field, native in (('drawScale3D', 'DrawScale3D'), ('prePivot', 'PrePivot')):
            if field == 'prePivot' and field not in profile and native not in properties:
                gaps = profile.get('unsupportedFields', [])
                if any(gap.get('field') == field and isinstance(gap.get('reason'), str) and gap['reason'].strip() for gap in gaps):
                    continue
            value, vector = profile.get(field), properties.get(native)
            if (not isinstance(value, list) or len(value) != 3 or not isinstance(vector, dict) or set(vector) != set('XYZ') or
                any(type(v) not in (int, float) or not math.isfinite(v) or field == 'drawScale3D' and v <= 0 for v in value) or
                value != [vector[key] for key in 'XYZ']):
                raise ValueError('NPC profile vector differs from native class: ' + field)
    prefix = 'npc-profiles/' + sha256_hex(manifest_bytes) + '/'
    add_store_file(files, prefix + 'manifest.json', manifest_bytes)
    add_store_file(files, prefix + 'receipt.json', receipt_bytes)
    for name, payload in payloads.items():
        add_store_file(files, prefix + name, payload)
    return {'id': identity, 'manifest': '/l2/' + prefix + 'manifest.json',
            'manifestSha256': sha256_hex(manifest_bytes), 'manifestBytes': len(manifest_bytes)}


def build_runtime_store_files(migration):
    coverage = json.loads((migration / 'coverage.json').read_text(encoding='utf-8'))
    validation = json.loads((migration / 'validation.json').read_text(encoding='utf-8'))
    if validation.get('passed') is not True or validation.get('errors') or any(job['support'] == 'failed' or job.get('unsupported') for job in coverage['jobs']):
        raise ValueError('Migration validation must pass before local staging')
    models, textures, npc_profiles, files = [], [], [], {}
    if len({job['id'] for job in coverage['jobs']}) != len(coverage['jobs']):
        raise ValueError('Duplicate migration coverage identity')
    for job in coverage['jobs']:
        if (job.get('adapter') == 'npc-profiles' or job.get('support') == 'source-profile-fields-ready' or
            isinstance(job.get('path'), str) and job['path'].startswith('npc-profiles/')):
            try:
                npc_profiles.append(npc_profile_files(migration, job, files))
            except (KeyError, TypeError, AttributeError) as error:
                raise ValueError('Malformed NPC profile bundle metadata') from error
            continue
        if job['support'] != 'converted':
            continue
        path = contained(migration, job['path'])
        result, archive_bytes, manifest, payloads = verified_archive(path, job['sha256'])
        if result['kind'] == 'texture':
            image_path = safe_name(manifest['image']['file'])
            image = payloads[image_path]
            add_store_file(files, result['sha256'] + '/asset.l2asset', archive_bytes)
            add_store_file(files, result['sha256'] + '/' + image_path, image)
            textures.append({'id': job['id'], 'assetId': manifest['id'], 'source': manifest['source'],
                             'archive': '/l2/' + result['sha256'] + '/asset.l2asset', 'archiveSha256': result['sha256'],
                             'image': '/l2/' + result['sha256'] + '/' + image_path,
                             'imageSha256': sha256_hex(image), 'imageBytes': len(image)})
            continue
        if result['kind'] != 'model':
            continue
        model = payloads[manifest['model']['file']]
        add_store_file(files, result['sha256'] + '/asset.l2asset', archive_bytes)
        add_store_file(files, result['sha256'] + '/model.glb', model)
        models.append({'id': job['id'], 'assetId': manifest['id'], 'source': manifest['source'],
                       'archive': '/l2/' + result['sha256'] + '/asset.l2asset', 'archiveSha256': result['sha256'],
                       'model': '/l2/' + result['sha256'] + '/model.glb', 'modelSha256': sha256_hex(model),
                       'nativeSkinAdapter': manifest['model'].get('nativeSkinAdapter'), 'limitations': manifest['limitations']})
    catalog = {'schemaVersion': 1, 'sourceHost': coverage['sourceHost'], 'models': models, 'textures': textures,
               'sourceManifestSha256': coverage['sourceManifestSha256'], 'acceptanceSha256': coverage['acceptanceSha256'],
               'scope': 'Local native model and texture staging. This catalog does not assert playable/world/visual/performance acceptance.'}
    if npc_profiles:
        catalog['npcProfiles'] = npc_profiles
    return files, catalog


def slice_keeping_unstaged_records(current_records, staged_records):
    staged_by_id = {record['id']: record for record in staged_records}
    current_ids = {record['id'] for record in current_records}
    kept = [staged_by_id.get(record['id'], record) for record in current_records]
    return kept + [record for record in staged_records if record['id'] not in current_ids]


def catalog_keeping_unstaged_records(current_catalog, staged_catalog):
    catalog = {**current_catalog, **staged_catalog}
    for slice_name, staged_records in staged_catalog.items():
        current_records = current_catalog.get(slice_name)
        if isinstance(staged_records, list) and isinstance(current_records, list):
            catalog[slice_name] = slice_keeping_unstaged_records(current_records, staged_records)
    return catalog


def stage_runtime(migration, destination=ROOT / 'public/l2'):
    migration = Path(migration).resolve(strict=True)
    if Path(destination).absolute() != (ROOT / 'public/l2').absolute():
        raise ValueError('Local runtime staging writes only to this project public/l2 directory')
    files, staged_catalog = build_runtime_store_files(migration)
    before = read_current_catalog_bytes(destination)
    current_catalog = decode_store_catalog(before) if before is not None else {}
    write_store(destination, files, before, json_bytes(catalog_keeping_unstaged_records(current_catalog, staged_catalog)))
    result = {'models': len(staged_catalog['models']), 'textures': len(staged_catalog['textures']),
              'catalog': str(Path(destination).resolve() / 'catalog.json')}
    if 'npcProfiles' in staged_catalog:
        result['npcProfiles'] = len(staged_catalog['npcProfiles'])
    return result


def main():
    parser = argparse.ArgumentParser(description=RUNTIME_STAGE_DESCRIPTION)
    parser.add_argument('--migration', type=Path, default=ROOT / 'artifacts/native-parity/migration')
    args = parser.parse_args()
    print(json.dumps(stage_runtime(args.migration)))


if __name__ == '__main__':
    main()
