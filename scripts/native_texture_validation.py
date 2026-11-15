"""Validate compressed derivatives against every retained native mip payload."""
import json
from pathlib import Path

from native_assets_lib.gltf import safe_name
from native_assets_lib.texture_dds import build_texture_dds, UnsupportedTextureDDS


def verify_texture_products(directory, metadata):
    directory = Path(directory).resolve()

    def payload(name):
        path = (directory / safe_name(name)).resolve()
        if not path.is_relative_to(directory):
            raise ValueError('Texture sidecar escapes its asset directory')
        return path.read_bytes()

    source = metadata.get('nativeTextureSource', {})
    derivative = metadata.get('nativeTextureDDS', {})
    if source.get('status') == 'unsupported':
        if derivative.get('status') != 'unsupported':
            raise ValueError('Texture derivative requires a supported native source')
        return {'nativeSource': source, 'dds': derivative}
    if source.get('status') != 'preserved':
        raise ValueError('Texture source preservation status is missing')
    raw_manifest = payload('native-texture-source.json')
    native = json.loads(raw_manifest)
    files = {entry['path']: payload(entry['path']) for entry in native['files']}
    files['native-texture-source.json'] = raw_manifest
    try:
        expected, products = build_texture_dds(native, files)
    except UnsupportedTextureDDS as error:
        if derivative != {'status': 'unsupported', 'reason': str(error)}:
            raise ValueError('Unsupported texture derivative differs from recorded coverage') from error
        if (directory / 'texture.dds').exists() or (directory / 'native-texture-dds.json').exists():
            raise ValueError('Unsupported texture has an undeclared DDS derivative')
        return {'nativeSource': source, 'dds': derivative}
    if derivative.get('status') != 'available':
        raise ValueError('Supported texture is missing its compressed derivative')
    for name, expected_bytes in products.items():
        if payload(name) != expected_bytes:
            raise ValueError('Compressed derivative differs from native source: ' + name)
    for key in ('file', 'sha256', 'mipCount', 'completeTo1x1', 'consumer'):
        if derivative.get(key) != expected[key]:
            raise ValueError('Compressed texture provenance differs: ' + key)
    return {'nativeSource': source, 'dds': derivative,
            'nativeMipPayloadsIdentical': True, 'validatedMipCount': expected['mipCount']}
