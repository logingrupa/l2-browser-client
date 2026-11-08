import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import reference_client_guard
from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS, REFERENCE_CLIENT_LOCK_SCHEMA_VERSION, current_host_name


def use_reference_client_lock(test_case, lock_path):
    for patcher in (patch.object(reference_client_guard, 'REFERENCE_CLIENT_LOCK_PATH', Path(lock_path)),
                    patch.dict(reference_client_guard.accesses_by_root_and_lock, clear=True)):
        patcher.start()
        test_case.addCleanup(patcher.stop)


def lock_client_as_reference_root(test_case, client_root):
    lock_directory = tempfile.TemporaryDirectory()
    test_case.addCleanup(lock_directory.cleanup)
    lock_path = Path(lock_directory.name) / 'reference-client-tree.lock.json'
    lock_path.write_bytes(json.dumps({
        'schemaVersion': REFERENCE_CLIENT_LOCK_SCHEMA_VERSION,
        'referenceHost': current_host_name(),
        'referenceRoot': Path(client_root).resolve().as_posix(),
        'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
        'files': {},
    }).encode('utf-8'))
    use_reference_client_lock(test_case, lock_path)
