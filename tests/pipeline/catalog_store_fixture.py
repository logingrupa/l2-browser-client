from __future__ import annotations

import hashlib
import json

PROFILE_MANIFEST_FOLDERS = {'native-npc-profiles': 'npc-profiles', 'native-player-profiles': 'player-profiles'}


def write_store_catalog(store_root, catalog):
    store_root.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(catalog, sort_keys=True).encode()
    (store_root / 'catalog.json').write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def model_record(model_id, source_object):
    archive_sha256 = hashlib.sha256(model_id.encode()).hexdigest()
    return {'id': model_id, 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256,
            'source': {'object': source_object}}


def write_profile_manifest(store_root, kind, profiles):
    payload = json.dumps({'schemaVersion': 1, 'kind': kind, 'profiles': profiles}, sort_keys=True).encode()
    manifest_sha256 = hashlib.sha256(payload).hexdigest()
    manifest_path = store_root / PROFILE_MANIFEST_FOLDERS[kind] / manifest_sha256 / 'manifest.json'
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(payload)
    return {'id': kind, 'manifest': f'/l2/{PROFILE_MANIFEST_FOLDERS[kind]}/{manifest_sha256}/manifest.json',
            'manifestSha256': manifest_sha256, 'manifestBytes': len(payload)}
