import hashlib
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

import reference_client_guard
from reference_client_guard import (ENGINE_LIBRARY_RELATIVE_PATH, REFERENCE_CLIENT_LOCK_FILE_FIELDS, REFERENCE_CLIENT_LOCK_SCHEMA_VERSION,
    current_host_name)

SYNTHETIC_ENGINE_LIBRARY_BYTES = b'synthetic engine library of a locked reference root'


def use_reference_client_lock(test_case, lock_path):
    for patcher in (patch.object(reference_client_guard, 'REFERENCE_CLIENT_LOCK_PATH', Path(lock_path)),
                    patch.dict(reference_client_guard.accesses_by_root_and_lock, clear=True),
                    patch.dict(reference_client_guard.sha256_by_file_identity, clear=True)):
        patcher.start()
        test_case.addCleanup(patcher.stop)


def equal_lock_record(path):
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    return ['equal', len(payload), digest, len(payload), digest, os.stat(path).st_mtime_ns]


def write_synthetic_engine_library(client_root):
    engine_library = Path(client_root) / ENGINE_LIBRARY_RELATIVE_PATH
    if not engine_library.is_file():
        engine_library.parent.mkdir(parents=True, exist_ok=True)
        engine_library.write_bytes(SYNTHETIC_ENGINE_LIBRARY_BYTES)
    return engine_library


def use_synthetic_reference_client_lock(test_case, reference_root, files):
    lock_directory = tempfile.TemporaryDirectory()
    test_case.addCleanup(lock_directory.cleanup)
    lock_path = Path(lock_directory.name) / 'reference-client-tree.lock.json'
    lock_path.write_bytes(json.dumps({
        'schemaVersion': REFERENCE_CLIENT_LOCK_SCHEMA_VERSION,
        'referenceHost': current_host_name(),
        'referenceRoot': Path(reference_root).resolve().as_posix(),
        'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
        'files': files,
    }).encode('utf-8'))
    use_reference_client_lock(test_case, lock_path)
    return lock_path


def lock_client_as_reference_root(test_case, client_root):
    engine_library = write_synthetic_engine_library(client_root)
    return use_synthetic_reference_client_lock(test_case, client_root, {ENGINE_LIBRARY_RELATIVE_PATH: equal_lock_record(engine_library)})


def lock_client_as_checked_conversion_root(test_case, client_root, reference_root, equal_relative_paths):
    write_synthetic_engine_library(client_root)
    files = {relative_path: equal_lock_record(Path(client_root) / relative_path)
        for relative_path in (ENGINE_LIBRARY_RELATIVE_PATH, *equal_relative_paths)}
    return use_synthetic_reference_client_lock(test_case, reference_root, files)
