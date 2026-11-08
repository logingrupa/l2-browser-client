import hashlib
import json
import os
from pathlib import Path, PurePosixPath

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATABASE_PC_CONVERSION_ROOT = Path('E:/Lineage2-client')
REFERENCE_CLIENT_LOCK_PATH = REPOSITORY_ROOT / 'recipes' / 'reference-client-tree.lock.json'
REFERENCE_CLIENT_LOCK_SCHEMA_VERSION = 1
REFERENCE_CLIENT_LOCK_FILE_FIELDS = ['class', 'importaBytes', 'importaSha256', 'eBytes', 'eSha256', 'eModifiedNanoseconds']
ENGINE_LIBRARY_RELATIVE_PATH = 'system/Engine.dll'
MISSING_LOCK_MESSAGE = ('reference client lock missing: recipes/reference-client-tree.lock.json; '
    'the integration thread runs the hash lock before any E: read')


class ReferenceClientLockError(ValueError):
    pass


def require_confined_relative_path(relative_path):
    if not isinstance(relative_path, str) or not relative_path:
        raise ReferenceClientLockError(f'reference client path must be a non-empty string: {relative_path!r}')
    if '\\' in relative_path or ':' in relative_path:
        raise ReferenceClientLockError(f'reference client path must use plain forward slashes: {relative_path!r}')
    if PurePosixPath(relative_path).is_absolute() or any(part in ('', '.', '..') for part in relative_path.split('/')):
        raise ReferenceClientLockError(f'reference client path escapes its root: {relative_path!r}')
    return relative_path


def sha256_of_file(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_reference_client_lock(lock_path):
    if not lock_path.is_file():
        raise ReferenceClientLockError(MISSING_LOCK_MESSAGE)
    lock = json.loads(lock_path.read_bytes().decode('utf-8'))
    if not isinstance(lock, dict) or lock.get('schemaVersion') != REFERENCE_CLIENT_LOCK_SCHEMA_VERSION:
        raise ReferenceClientLockError(f'reference client lock schemaVersion must be {REFERENCE_CLIENT_LOCK_SCHEMA_VERSION}: {lock_path}')
    if lock.get('fileFields') != REFERENCE_CLIENT_LOCK_FILE_FIELDS or not isinstance(lock.get('files'), dict):
        raise ReferenceClientLockError(f'reference client lock has an unexpected file table: {lock_path}')
    records_by_casefolded_path = {}
    for path, values in lock['files'].items():
        if not isinstance(values, list) or len(values) != len(REFERENCE_CLIENT_LOCK_FILE_FIELDS):
            raise ReferenceClientLockError(f'reference client lock record is malformed: {path}')
        record = dict(zip(REFERENCE_CLIENT_LOCK_FILE_FIELDS, values))
        if path.casefold() in records_by_casefolded_path:
            raise ReferenceClientLockError(f'reference client lock repeats a casefolded path: {path}')
        records_by_casefolded_path[path.casefold()] = record
    return records_by_casefolded_path


class ReferenceClientAccess:
    def __init__(self, root, lock_records_by_casefolded_path):
        self.root = root
        self.requires_lock = lock_records_by_casefolded_path is not None
        self.lock_records_by_casefolded_path = lock_records_by_casefolded_path

    def require_equal_file(self, relative_path):
        require_confined_relative_path(relative_path)
        path = (self.root / relative_path).resolve()
        if not path.is_relative_to(self.root):
            raise ReferenceClientLockError(f'reference client path escapes its root: {relative_path}')
        if self.requires_lock:
            self.require_lock_equal_record(relative_path, path)
        return path

    def require_lock_equal_record(self, relative_path, path):
        record = self.lock_records_by_casefolded_path.get(relative_path.casefold())
        if record is None or record['class'] != 'equal':
            lock_class = 'absent' if record is None else record['class']
            raise ReferenceClientLockError(f'reference client lock class of {relative_path} is {lock_class}, not equal; conversion may not read it')
        try:
            status = os.stat(path)
        except OSError as error:
            raise ReferenceClientLockError(f'reference client lock is stale for {relative_path}; re-lock ordered ({type(error).__name__})')
        if (status.st_size, status.st_mtime_ns) == (record['eBytes'], record['eModifiedNanoseconds']):
            return
        if sha256_of_file(path) != record['eSha256']:
            raise ReferenceClientLockError(f'reference client lock is stale for {relative_path}; re-lock ordered')


accesses_by_root_and_lock = {}


def lock_file_identity(lock_path):
    try:
        status = os.stat(lock_path)
    except FileNotFoundError:
        raise ReferenceClientLockError(MISSING_LOCK_MESSAGE) from None
    return (status.st_size, status.st_mtime_ns)


def require_reference_client(root, *, lock_path=None, conversion_root=None):
    resolved_root = Path(root).resolve()
    resolved_conversion_root = Path(DATABASE_PC_CONVERSION_ROOT if conversion_root is None else conversion_root).resolve()
    if str(resolved_root).casefold() != str(resolved_conversion_root).casefold():
        cache_key = (str(resolved_root), None, None)
        if cache_key not in accesses_by_root_and_lock:
            accesses_by_root_and_lock[cache_key] = ReferenceClientAccess(resolved_root, None)
        return accesses_by_root_and_lock[cache_key]
    resolved_lock_path = Path(REFERENCE_CLIENT_LOCK_PATH if lock_path is None else lock_path).resolve()
    cache_key = (str(resolved_root).casefold(), str(resolved_lock_path), lock_file_identity(resolved_lock_path))
    if cache_key not in accesses_by_root_and_lock:
        access = ReferenceClientAccess(resolved_root, read_reference_client_lock(resolved_lock_path))
        access.require_equal_file(ENGINE_LIBRARY_RELATIVE_PATH)
        accesses_by_root_and_lock[cache_key] = access
    return accesses_by_root_and_lock[cache_key]
