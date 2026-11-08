import os
from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.catalog_writer import replace_file
from native_store.store_paths import StorePathError, refuse_reparse_points, require_portable_relative_path

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
SHARED_STORE_RELATIVE_PATH = 'public/l2'


class CommittedWorldDataError(ValueError):
    pass


def require_committed_destination(relative_path, repository_root=REPOSITORY_ROOT):
    repository_root = Path(repository_root).resolve()
    expected_destination = repository_root / require_portable_relative_path(relative_path)
    try:
        destination = refuse_reparse_points(expected_destination)
    except StorePathError as error:
        raise CommittedWorldDataError(f'committed world data destination refused: {error}') from error
    if destination != expected_destination:
        raise CommittedWorldDataError(f'committed world data destination resolves to {destination}, not {expected_destination}')
    shared_store = Path(os.path.realpath(repository_root / SHARED_STORE_RELATIVE_PATH))
    if destination.is_relative_to(shared_store):
        raise CommittedWorldDataError(f'committed world data must not be written into the shared native store {shared_store}: {destination}')
    return destination


def write_committed_world_bytes(relative_path, payload, repository_root=REPOSITORY_ROOT):
    destination = require_committed_destination(relative_path, repository_root)
    replace_file(destination, payload)
    return destination
