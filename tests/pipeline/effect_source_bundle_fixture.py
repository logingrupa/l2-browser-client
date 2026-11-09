from __future__ import annotations

import base64
import hashlib

from native_assets_lib.gltf import json_bytes

ONE_PIXEL_PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=')
SPRITE_TEXTURE_OBJECT = 'Fixture.SpriteTexture'
SOURCE_GRAPH_NAME = 'effect-source.json'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def retained_texture_asset_files(texture_object):
    archive = f'retained fixture archive: {texture_object}'.encode()
    prefix = f'assets/{sha256_hex(archive)}'
    asset_manifest = {'schemaVersion': 1, 'id': f'interlude:{texture_object}', 'kind': 'texture',
                      'source': {'object': texture_object, 'sha256': 'a' * 64}, 'image': {'file': 'texture.png'},
                      'files': [{'path': 'texture.png', 'bytes': len(ONE_PIXEL_PNG), 'sha256': sha256_hex(ONE_PIXEL_PNG)}]}
    files = {f'{prefix}/texture.png': ONE_PIXEL_PNG, f'{prefix}/asset.json': json_bytes(asset_manifest), f'{prefix}/asset.l2asset': archive}
    asset_row = {'id': f'interlude:{texture_object}', 'object': texture_object, 'kind': 'texture', 'primary': f'{prefix}/texture.png',
                 'manifest': f'{prefix}/asset.json', 'archive': f'{prefix}/asset.l2asset', 'archiveSha256': sha256_hex(archive)}
    return files, asset_row


def sprite_effect_source_graph():
    sprite_properties = {'Name': 'SpriteA', 'Texture': {'object': SPRITE_TEXTURE_OBJECT}}
    emitter_order = [{'symbol': 'SpriteA'}]
    return {'skillRow': {'skill_id': 3, 'skill_level': 1}, 'soundRow': {}, 'classDefaults': [], 'stages': [],
            'associations': [{'effectObject': 'fixture.actor', 'dispatchStages': ['init']}],
            'sourceDispatch': {'bindings': [{'stage': 'init', 'effectObject': 'fixture.actor'}]},
            'effects': [{'object': 'fixture.actor', 'properties': {'Emitters': emitter_order}, 'effectiveProperties': {'Emitters': emitter_order},
                         'children': [{'name': 'SpriteA', 'object': 'fixture.actor.SpriteA', 'class': 'Engine.SpriteEmitter',
                                       'properties': sprite_properties, 'effectiveProperties': sprite_properties}]}],
            'nativeObjects': [{'source': {'object': SPRITE_TEXTURE_OBJECT, 'class': 'Texture'}, 'properties': {}, 'effectiveProperties': {}}],
            'unresolvedDependencies': []}


def write_sprite_effect_source_bundle(bundle_root):
    asset_files, asset_row = retained_texture_asset_files(SPRITE_TEXTURE_OBJECT)
    graph = sprite_effect_source_graph()
    files = {**asset_files, SOURCE_GRAPH_NAME: json_bytes(graph)}
    manifest = {'schemaVersion': 1, 'kind': 'native-effect-bundle', 'id': 'fixture:skill-root', 'skillId': 3, 'level': 1,
                'sourceGraph': SOURCE_GRAPH_NAME, 'sourceFiles': [], 'associations': graph['associations'], 'assets': [asset_row],
                'files': [{'file': name, 'bytes': len(payload), 'sha256': sha256_hex(payload)} for name, payload in sorted(files.items())]}
    for name, payload in {**files, 'manifest.json': json_bytes(manifest)}.items():
        path = bundle_root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    return {'manifest': json_bytes(manifest), 'graph': files[SOURCE_GRAPH_NAME]}
