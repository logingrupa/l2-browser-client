import hashlib
import os
from pathlib import Path
import tempfile

from native_store.store_paths import require_lane_write_outside_real_lane_stores


class CatalogWriteError(ValueError):
    pass


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def sha256_of_file(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def replace_file(path, payload):
    require_lane_write_outside_real_lane_stores(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_of_file(path) != sha256_hex(payload):
        raise CatalogWriteError('Runtime copy hash differs: ' + str(path))


def require_same_immutable_file(path, payload):
    if sha256_of_file(path) != sha256_hex(payload):
        raise CatalogWriteError('Existing immutable runtime asset is corrupt; preserved: ' + str(path))


def immutable_write(path, payload):
    require_lane_write_outside_real_lane_stores(path)
    if path.exists():
        require_same_immutable_file(path, payload)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        os.link(temporary, path)
    except FileExistsError:
        require_same_immutable_file(path, payload)
        return
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_of_file(path) != sha256_hex(payload):
        raise CatalogWriteError('Runtime copy hash differs: ' + str(path))
