import hashlib
import os
from pathlib import Path
import tempfile

from native_store.store_paths import require_lane_write_outside_real_lane_stores


class CatalogWriteError(ValueError):
    pass


class StorePayloadIntegrityError(Exception):
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


def require_same_immutable_file(path, expected_sha256):
    if sha256_of_file(path) != expected_sha256:
        raise CatalogWriteError('Existing immutable runtime asset is corrupt; preserved: ' + str(path))


def require_written_file_sha256(written_path, expected_sha256, path):
    written_sha256 = sha256_of_file(written_path)
    if written_sha256 != expected_sha256:
        raise StorePayloadIntegrityError(f'Written store file hashes to {written_sha256} where {expected_sha256} was verified; not published: {path}')


def immutable_write(path, payload):
    immutable_write_expecting_sha256(path, payload, sha256_hex(payload))


def immutable_write_expecting_sha256(path, payload, expected_sha256):
    require_lane_write_outside_real_lane_stores(path)
    if path.exists():
        require_same_immutable_file(path, expected_sha256)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        require_written_file_sha256(temporary, expected_sha256, path)
        os.link(temporary, path)
    except FileExistsError:
        require_same_immutable_file(path, expected_sha256)
    finally:
        temporary.unlink(missing_ok=True)
