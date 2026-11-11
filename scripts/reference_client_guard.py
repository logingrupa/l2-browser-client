import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import socket

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_CLIENT_LOCK_PATH = REPOSITORY_ROOT / 'recipes' / 'reference-client-tree.lock.json'
REFERENCE_CLIENT_LOCK_SCHEMA_VERSION = 1
REFERENCE_CLIENT_LOCK_FILE_FIELDS = ['class', 'importaBytes', 'importaSha256', 'eBytes', 'eSha256', 'eModifiedNanoseconds']
ENGINE_LIBRARY_RELATIVE_PATH = 'system/Engine.dll'
MISSING_LOCK_MESSAGE = ('reference client lock missing: recipes/reference-client-tree.lock.json; '
    'the integration thread runs the hash lock before any client read')


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


sha256_by_file_identity = {}


def sha256_of_file_cached_by_identity(path, status):
    identity = (str(path).casefold(), status.st_size, status.st_mtime_ns)
    if identity not in sha256_by_file_identity:
        sha256_by_file_identity[identity] = sha256_of_file(path)
    return sha256_by_file_identity[identity]


class ReferenceClientLock:
    def __init__(self, document, records_by_path):
        self.document = document
        self.records_by_path = records_by_path
        self.records_by_casefolded_path = {path.casefold(): record for path, record in records_by_path.items()}

    def record(self, relative_path):
        return self.records_by_casefolded_path.get(relative_path.casefold())


def read_reference_client_lock(lock_path):
    if not lock_path.is_file():
        raise ReferenceClientLockError(MISSING_LOCK_MESSAGE)
    lock = json.loads(lock_path.read_bytes().decode('utf-8'))
    if not isinstance(lock, dict) or lock.get('schemaVersion') != REFERENCE_CLIENT_LOCK_SCHEMA_VERSION:
        raise ReferenceClientLockError(f'reference client lock schemaVersion must be {REFERENCE_CLIENT_LOCK_SCHEMA_VERSION}: {lock_path}')
    for field in ('referenceHost', 'referenceRoot'):
        if not isinstance(lock.get(field), str) or not lock[field]:
            raise ReferenceClientLockError(f'reference client lock needs a {field}: {lock_path}')
    if lock.get('fileFields') != REFERENCE_CLIENT_LOCK_FILE_FIELDS or not isinstance(lock.get('files'), dict):
        raise ReferenceClientLockError(f'reference client lock has an unexpected file table: {lock_path}')
    records_by_path, casefolded_paths = {}, set()
    for path, values in lock['files'].items():
        if not isinstance(values, list) or len(values) != len(REFERENCE_CLIENT_LOCK_FILE_FIELDS):
            raise ReferenceClientLockError(f'reference client lock record is malformed: {path}')
        if path.casefold() in casefolded_paths:
            raise ReferenceClientLockError(f'reference client lock repeats a casefolded path: {path}')
        casefolded_paths.add(path.casefold())
        records_by_path[path] = dict(zip(REFERENCE_CLIENT_LOCK_FILE_FIELDS, values))
    return ReferenceClientLock(lock, records_by_path)


def current_host_name():
    return socket.gethostname().upper()


def is_locked_reference_root(resolved_root, lock):
    if current_host_name() != lock.document['referenceHost'].upper():
        return False
    return str(resolved_root).casefold() == str(Path(lock.document['referenceRoot'])).casefold()


class ReferenceClientAccess:
    def __init__(self, root, lock, requires_lock):
        self.root = root
        self.lock = lock
        self.requires_lock = requires_lock

    def confined_path(self, relative_path):
        require_confined_relative_path(relative_path)
        path = (self.root / relative_path).resolve()
        if not path.is_relative_to(self.root):
            raise ReferenceClientLockError(f'reference client path escapes its root: {relative_path}')
        return path

    def require_equal_file(self, relative_path):
        path = self.confined_path(relative_path)
        if self.requires_lock:
            self.require_lock_equal_record(relative_path, path)
        return path

    def require_equal_file_with_sha256(self, relative_path):
        path = self.confined_path(relative_path)
        if self.requires_lock:
            return path, self.require_lock_equal_record(relative_path, path)['eSha256']
        return path, self.reference_root_file_sha256(relative_path, path)

    def reference_root_file_sha256(self, relative_path, path):
        try:
            status = os.stat(path)
        except FileNotFoundError:
            raise ReferenceClientLockError(f'reference client root {self.root.as_posix()} has no {relative_path}') from None
        return sha256_of_file_cached_by_identity(path, status)

    def is_in_read_scope(self, relative_path):
        if not self.requires_lock:
            return True
        record = self.lock.record(relative_path)
        return record is not None and record['class'] == 'equal'

    def require_lock_equal_record(self, relative_path, path):
        record = self.lock.record(relative_path)
        if not self.is_in_read_scope(relative_path):
            lock_class = 'absent' if record is None else record['class']
            raise ReferenceClientLockError(f'reference client lock class of {relative_path} is {lock_class}, not equal; conversion may not read it')
        try:
            status = os.stat(path)
        except FileNotFoundError:
            raise ReferenceClientLockError(
                f'reference client root {self.root.as_posix()} has no {relative_path}; a lock-checked root must hold every file it reads') from None
        except OSError as error:
            raise ReferenceClientLockError(f'reference client lock is stale for {relative_path}; re-lock ordered ({type(error).__name__})') from error
        if status.st_size != record['eBytes'] or sha256_of_file_cached_by_identity(path, status) != record['eSha256']:
            raise ReferenceClientLockError(f'reference client lock is stale for {relative_path}; re-lock ordered')
        return record


accesses_by_root_and_lock = {}


def lock_file_identity(lock_path):
    try:
        status = os.stat(lock_path)
    except FileNotFoundError:
        raise ReferenceClientLockError(MISSING_LOCK_MESSAGE) from None
    return (status.st_size, status.st_mtime_ns)


def open_reference_client_access(resolved_root, lock):
    if is_locked_reference_root(resolved_root, lock):
        return ReferenceClientAccess(resolved_root, lock, requires_lock=False)
    access = ReferenceClientAccess(resolved_root, lock, requires_lock=True)
    access.require_equal_file(ENGINE_LIBRARY_RELATIVE_PATH)
    return access


def require_reference_client(root):
    resolved_root = Path(root).resolve()
    resolved_lock_path = REFERENCE_CLIENT_LOCK_PATH.resolve()
    cache_key = (str(resolved_root).casefold(), str(resolved_lock_path), lock_file_identity(resolved_lock_path))
    if cache_key not in accesses_by_root_and_lock:
        accesses_by_root_and_lock[cache_key] = open_reference_client_access(resolved_root, read_reference_client_lock(resolved_lock_path))
    return accesses_by_root_and_lock[cache_key]
