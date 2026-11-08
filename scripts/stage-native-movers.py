#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from native_assets import verify_archive
from native_assets_lib.gltf import json_bytes
from native_map import safe_path, sha
from native_map_movers import MAP_SHA
from native_store.catalog_writer import immutable_write, replace_file

MOVER_STAGE_DESCRIPTION = 'Stage an additive, verified mover bundle without reimporting the Editor world.'


def stage(project, bundle_root, receipt_path=None):
    project, bundle_root = Path(project).resolve(), Path(bundle_root).resolve()
    bundle_bytes = (bundle_root / 'bundle.json').read_bytes()
    bundle = json.loads(bundle_bytes)
    if bundle.get('kind') != 'native-map-movers-bundle' or bundle.get('schemaVersion') != 1:
        raise ValueError('Expected a native mover bundle')
    files = {}
    for name, record in bundle['files'].items():
        payload = safe_path(bundle_root, name).read_bytes()
        if sha(payload) != record['sha256'] or len(payload) != record['bytes']:
            raise ValueError('Mover bundle file changed: ' + name)
        files[name] = payload
    descriptor_record = bundle['descriptor']
    descriptor_bytes = files[descriptor_record['file']]
    if sha(descriptor_bytes) != descriptor_record['sha256'] or descriptor_record['file'] != 'movers.json':
        raise ValueError('Mover descriptor identity differs')
    descriptor = json.loads(descriptor_bytes)
    if descriptor.get('kind') != 'native-map-movers' or descriptor['sourceMap']['packageSha256'] != MAP_SHA:
        raise ValueError('Mover source map is unsupported')
    for model in descriptor['models']:
        for key in ('model', 'archive'):
            record = model[key]
            if sha(files[record['file']]) != record['sha256'] or len(files[record['file']]) != record['bytes']:
                raise ValueError('Mover model resource differs')
        archive = verify_archive(safe_path(bundle_root, model['archive']['file']))
        if archive['sha256'] != model['archive']['sha256']:
            raise ValueError('Mover archive identity differs')
    public = project / 'public/l2'
    catalog_path = public / 'catalog.json'
    before_bytes = catalog_path.read_bytes()
    before = json.loads(before_bytes)
    section = [row for row in before['sections'] if row['id'] == 'map-20-20-section']
    if len(section) != 1:
        raise ValueError('Selected native section is missing or ambiguous')
    section = section[0]
    if section['manifest'] != '/l2/maps/' + section['manifestSha256'] + '/map-section-runtime/manifest.json':
        raise ValueError('Native section path differs from its identity')
    section_bytes = safe_path(public, section['manifest'][4:]).read_bytes()
    if sha(section_bytes) != section['manifestSha256']:
        raise ValueError('Native section manifest hash differs')
    terrain_sha = json.loads(section_bytes)['terrain']['sha256']
    identity = sha(descriptor_bytes)
    record = {'id': 'map-20-20-movers', 'manifest': '/l2/movers/' + identity + '/movers.json',
              'manifestSha256': identity, 'terrainSha256': terrain_sha, 'sourceMapSha256': MAP_SHA}
    after = json.loads(before_bytes)
    existing = [row for row in after.get('movers', []) if row['id'] == record['id']]
    if existing and existing != [record]:
        raise ValueError('Refuse to replace a different existing mover catalog entry')
    if not existing:
        after.setdefault('movers', []).append(record)
    for key, value in before.items():
        if key != 'movers' and after[key] != value:
            raise ValueError('Unrelated catalog field changed: ' + key)
    for name, payload in files.items():
        immutable_write(safe_path(public, 'movers/' + identity + '/' + name), payload)
    immutable_write(safe_path(public, 'movers/' + identity + '/bundle.json'), bundle_bytes)
    if catalog_path.read_bytes() != before_bytes:
        raise ValueError('Catalog changed concurrently; additive files retained, catalog not replaced')
    after_bytes = before_bytes if existing else json_bytes(after)
    if after_bytes != before_bytes:
        replace_file(catalog_path, after_bytes)
    result = {'schemaVersion': 1, 'kind': 'native-mover-stage', 'status': 'preserved' if existing else 'staged',
              'record': record, 'bundleSha256': sha(bundle_bytes), 'files': bundle['files'],
              'catalogBefore': {'sha256': sha(before_bytes), 'bytes': len(before_bytes)},
              'catalogAfter': {'sha256': sha(after_bytes), 'bytes': len(after_bytes)},
              'sectionManifestSha256': section['manifestSha256'],
              'preservation': 'All existing catalog fields and records preserved; no Editor assets, section manifests, terrain or audio changed.'}
    if receipt_path:
        immutable_write(Path(receipt_path), json_bytes(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=MOVER_STAGE_DESCRIPTION)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    print(json.dumps(stage(args.project, args.bundle, args.receipt), indent=2))
