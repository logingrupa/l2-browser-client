import hashlib

from native_assets_lib.gltf import safe_name
from native_catalog.ue2 import FormatError, Package
from reference_client_guard import require_reference_client

REPARSE_POINT_ATTRIBUTE = 0x400
MAP_SOURCE_FOLDERS = ('maps', 'staticmeshes', 'textures', 'systextures', 'system', 'animations', 'sounds')
MAP_SOURCE_PACKAGE_SUFFIXES = ('.unr', '.usx', '.utx', '.u', '.ukx', '.uax', '.usk')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_path(root, relative):
    safe_name(relative)
    if any(part.rstrip(' .') != part for part in relative.split('/')):
        raise ValueError('Non-canonical map artifact path')
    target = root.joinpath(*relative.split('/'))
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Map path escapes its root')
    current = root.resolve()
    for part in relative.split('/'):
        current = current / part
        if current.exists() and (current.is_symlink() or getattr(current.lstat(), 'st_file_attributes', 0) & REPARSE_POINT_ATTRIBUTE):
            raise ValueError('Map paths must not contain reparse points')
    return target


def require_lock_equal_client_path(client, relative):
    path = safe_path(client, relative)
    require_reference_client(client).require_equal_file(relative)
    return path


class MapSources:
    def __init__(self, client):
        require_reference_client(client)
        self.client, self.dependencies, self.loaded, self.paths = client, {}, {}, {}
        for folder in MAP_SOURCE_FOLDERS:
            if not (client / folder).is_dir():
                continue
            for path in sorted((client / folder).iterdir()):
                if path.is_file() and path.suffix.lower() in MAP_SOURCE_PACKAGE_SUFFIXES:
                    self.paths.setdefault(path.stem.casefold(), []).append(path.relative_to(client).as_posix())

    def get(self, relative):
        if relative not in self.loaded:
            path = require_lock_equal_client_path(self.client, relative)
            data = path.read_bytes()
            self.dependencies[relative] = {'sha256': sha(data), 'bytes': len(data)}
            self.loaded[relative] = Package(data, path.name)
        return self.loaded[relative]

    def resolve(self, reference, expected):
        candidates = self.paths.get(reference.split('.')[0].casefold(), [])
        if len(candidates) != 1:
            raise FormatError('Package missing/ambiguous: ' + reference)
        package = self.get(candidates[0])
        matches = [item for item in package.exports if item['object'].casefold() == reference.casefold()]
        if len(matches) != 1 or matches[0]['className'] != expected:
            raise FormatError('Exact qualified object/class unresolved: ' + reference)
        return candidates[0], package, matches[0]


def static_mesh_request(relative, item):
    return {'kind': 'model', 'package': relative, 'object': item['object']}
