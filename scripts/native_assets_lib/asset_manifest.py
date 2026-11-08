import hashlib
import math
import re

from native_assets_lib.gltf import json_bytes
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH

SUPPORTED_ASSET_MANIFEST_VERSIONS = (1, 2)
ASSET_MANIFEST_VERSION = 2
ABSOLUTE_PATH_PATTERN = re.compile(r'^(/|[A-Za-z]:/)')
HEX_DIGEST_PATTERN = re.compile(r'^[a-f0-9]{64}$')


def upper_left_determinant(column_major_matrix):
    a, b, c = column_major_matrix[0], column_major_matrix[4], column_major_matrix[8]
    d, e, f = column_major_matrix[1], column_major_matrix[5], column_major_matrix[9]
    g, h, i = column_major_matrix[2], column_major_matrix[6], column_major_matrix[10]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


def require_finite_matrix(matrix):
    if not isinstance(matrix, list) or len(matrix) != 16 or not all(type(value) in (int, float) and math.isfinite(value) for value in matrix):
        raise ValueError('sourceToGltf must be 16 finite numbers in column-major order')


def asset_coordinates_record(source_to_gltf, source_units_per_metre):
    require_finite_matrix(source_to_gltf)
    if upper_left_determinant(source_to_gltf) >= 0:
        raise ValueError('sourceToGltf must flip handedness from the Z-up source into the right-handed glTF frame')
    if type(source_units_per_metre) not in (int, float) or not source_units_per_metre > 0:
        raise ValueError('sourceUnitsPerMetre must be a positive number')
    return {'unit': 'metre', 'sourceUnitsPerMetre': source_units_per_metre, 'handedness': 'right', 'upAxis': 'Y', 'sourceToGltf': list(source_to_gltf)}


def reference_client_build(lock):
    engine = lock.record(ENGINE_LIBRARY_RELATIVE_PATH)
    if engine is None or engine['class'] != 'equal' or not HEX_DIGEST_PATTERN.match(str(engine['importaSha256'])):
        raise ValueError(f'reference client lock does not record {ENGINE_LIBRARY_RELATIVE_PATH} as equal')
    return {'referenceTreeLockSha256': hashlib.sha256(json_bytes(lock.document)).hexdigest(), 'engineDllSha256': engine['importaSha256']}


def source_path_record(host, absolute_path):
    posix_path = str(absolute_path).replace('\\', '/')
    if not isinstance(host, str) or not host.strip():
        raise ValueError('source path needs the converting host name')
    if not ABSOLUTE_PATH_PATTERN.match(posix_path):
        raise ValueError(f'source path must be absolute: {absolute_path}')
    return {'host': host, 'absolutePath': posix_path}


def build_asset_manifest(*, identity, kind, source, source_path, client_build, converter_version, limitations, animation_events, primary_file, coordinates=None, model_extras=None, files):
    if (kind == 'model') != (coordinates is not None):
        raise ValueError('Model packages carry coordinates; audio and texture packages carry none')
    manifest = {
        'schemaVersion': ASSET_MANIFEST_VERSION, 'id': 'interlude:' + identity, 'name': identity, 'kind': kind,
        'source': {**source, 'path': source_path}, 'clientBuild': client_build, 'converterVersion': converter_version,
        'limitations': limitations, 'animationEvents': animation_events, 'files': files,
    }
    if kind == 'model':
        manifest['coordinates'] = coordinates
        manifest['model'] = {'file': primary_file, **(model_extras or {})}
    else:
        manifest['audio' if kind == 'audio' else 'image'] = {'file': primary_file}
    require_supported_asset_manifest(manifest)
    return manifest


def is_hex_digest(value):
    return isinstance(value, str) and HEX_DIGEST_PATTERN.match(value) is not None


def require_version_two_fields(manifest):
    path = manifest.get('source', {}).get('path')
    if not isinstance(path, dict) or not isinstance(path.get('host'), str) or not path['host'] or not isinstance(path.get('absolutePath'), str) or not ABSOLUTE_PATH_PATTERN.match(path['absolutePath']):
        raise ValueError('asset.json v2 needs source.path with host and absolutePath')
    client_build = manifest.get('clientBuild')
    if not isinstance(client_build, dict) or not is_hex_digest(client_build.get('referenceTreeLockSha256')) or not is_hex_digest(client_build.get('engineDllSha256')):
        raise ValueError('asset.json v2 needs clientBuild with the tree lock and Engine.dll SHA-256')
    if not is_hex_digest(manifest.get('converterVersion')):
        raise ValueError('asset.json v2 needs converterVersion as a SHA-256')
    if manifest.get('kind') != 'model':
        if 'coordinates' in manifest:
            raise ValueError('asset.json v2 records coordinates for models only')
        return
    coordinates = manifest.get('coordinates')
    if not isinstance(coordinates, dict) or coordinates.get('unit') != 'metre' or coordinates.get('handedness') != 'right' or coordinates.get('upAxis') != 'Y':
        raise ValueError('asset.json v2 model needs coordinates in metres, right-handed, Y up')
    units = coordinates.get('sourceUnitsPerMetre')
    if type(units) not in (int, float) or not units > 0:
        raise ValueError('asset.json v2 model needs a positive sourceUnitsPerMetre')
    require_finite_matrix(coordinates.get('sourceToGltf'))


def require_supported_asset_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') not in SUPPORTED_ASSET_MANIFEST_VERSIONS or type(manifest.get('schemaVersion')) is not int:
        raise ValueError(f'asset.json schemaVersion must be one of {SUPPORTED_ASSET_MANIFEST_VERSIONS}')
    if manifest['schemaVersion'] == 2:
        require_version_two_fields(manifest)
    return manifest


def asset_coordinates(manifest):
    require_supported_asset_manifest(manifest)
    if manifest['schemaVersion'] == 2:
        return manifest['coordinates']
    model = manifest['model']
    return {'unit': model['unit'], 'sourceUnitsPerMetre': model['sourceUnitsPerMetre'], 'handedness': None, 'upAxis': None, 'sourceToGltf': model['sourceToGltf']}
