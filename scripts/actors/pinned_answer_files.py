import hashlib
from pathlib import Path


class PinnedAnswerFileError(ValueError):
    pass


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def pinned_bytes(path, sha256, label):
    payload = Path(path).read_bytes()
    if sha256_hex(payload) != sha256:
        raise PinnedAnswerFileError(f'{label} {Path(path).name} is not the pinned {sha256}')
    return payload


def require_lock_equal(lock, relative_path, sha256, label):
    record = lock.record(relative_path)
    if not (record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == sha256):
        raise PinnedAnswerFileError(f'{label}: {relative_path} pin {sha256} differs from the reference client lock')
    return {'path': relative_path, 'sha256': sha256}
