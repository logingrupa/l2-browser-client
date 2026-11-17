from __future__ import annotations

import hashlib
import json

PROFILE_MANIFEST_FOLDERS = {'native-npc-profiles': 'npc-profiles', 'native-player-profiles': 'player-profiles'}
RUNTIME_TILE_SOURCE_SHA256 = 'b' * 64
RUNTIME_TILE_CHUNK_ID = 'chunk-0-0'
RUNTIME_TILE_MANIFEST_PATH_TEMPLATE = '/l2/tiles/{sha256}/tile.json'
RUNTIME_TILE_CHUNK_MANIFEST_PATH_TEMPLATE = '/l2/maps/{sha256}/native-tile-chunk-runtime/manifest.json'
RUNTIME_TILE_RESOURCE_PATH_TEMPLATES = {'native-tile-collision': '/l2/maps/{sha256}/native-tile-collision/asset.json',
                                        'sky': '/l2/skies/{sha256}/manifest.json'}


def write_store_catalog(store_root, catalog):
    store_root.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(catalog, sort_keys=True).encode()
    (store_root / 'catalog.json').write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def model_record(model_id, source_object):
    archive_sha256 = hashlib.sha256(model_id.encode()).hexdigest()
    return {'id': model_id, 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256,
            'source': {'object': source_object}}


def profile_manifest_payload_and_record(kind, profiles):
    payload = json.dumps({'schemaVersion': 1, 'kind': kind, 'profiles': profiles}, sort_keys=True).encode()
    manifest_sha256 = hashlib.sha256(payload).hexdigest()
    return payload, {'id': kind, 'manifest': f'/l2/{PROFILE_MANIFEST_FOLDERS[kind]}/{manifest_sha256}/manifest.json',
                     'manifestSha256': manifest_sha256, 'manifestBytes': len(payload)}


def pinned_manifest_entry(path_template, payload):
    manifest_sha256 = hashlib.sha256(payload).hexdigest()
    return {'manifest': path_template.format(sha256=manifest_sha256), 'manifestSha256': manifest_sha256, 'manifestBytes': len(payload)}


def runtime_tile_record_and_files(tile_id, chunk_payload, resource_payloads_by_kind):
    chunk_entry = pinned_manifest_entry(RUNTIME_TILE_CHUNK_MANIFEST_PATH_TEMPLATE, chunk_payload)
    files = {chunk_entry['manifest']: chunk_payload}
    resources = []
    for kind, payload in sorted(resource_payloads_by_kind.items()):
        resource_entry = pinned_manifest_entry(RUNTIME_TILE_RESOURCE_PATH_TEMPLATES[kind], payload)
        files[resource_entry['manifest']] = payload
        resources.append({'kind': kind, **resource_entry})
    tile_manifest = {'kind': 'native-tile-runtime', 'schemaVersion': 1, 'tileId': tile_id, 'sourceMap': f'maps/{tile_id}.unr',
                     'sourceSha256': RUNTIME_TILE_SOURCE_SHA256,
                     'frame': {'terrainInfo': f'{tile_id}.TerrainInfo0', 'location': [0, 0, 0], 'terrainScale': [128, 128, 76]},
                     'anchor': {'playerStart': f'{tile_id}.PlayerStart0', 'location': [0, 0, 0]},
                     'chunks': [{'chunkId': RUNTIME_TILE_CHUNK_ID, **chunk_entry}], 'resources': resources, 'gaps': []}
    tile_payload = json.dumps(tile_manifest, sort_keys=True).encode()
    tile_entry = pinned_manifest_entry(RUNTIME_TILE_MANIFEST_PATH_TEMPLATE, tile_payload)
    files[tile_entry['manifest']] = tile_payload
    return {'id': tile_id, **tile_entry}, files


def minimal_runtime_tile_record_and_files(tile_id, pins_collision):
    chunk_payload = json.dumps({'chunkId': RUNTIME_TILE_CHUNK_ID}).encode()
    collision_payloads = {'native-tile-collision': json.dumps({'tileId': tile_id}).encode()} if pins_collision else {}
    return runtime_tile_record_and_files(tile_id, chunk_payload, collision_payloads)


def write_profile_manifest(store_root, kind, profiles):
    payload, record = profile_manifest_payload_and_record(kind, profiles)
    manifest_path = store_root / record['manifest'][len('/l2/'):]
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(payload)
    return record
