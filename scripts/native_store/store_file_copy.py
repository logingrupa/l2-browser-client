from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import tempfile
from typing import NamedTuple

from native_store.catalog_writer import (STORE_CATALOG_NAME, CatalogWriteError, replace_file, require_catalog_unchanged,
                                         require_catalog_within_byte_limit, sha256_hex, sha256_of_file, store_file_key)
from native_store.store_paths import confined_child_path, refuse_reparse_points
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, nearest_existing_ancestor

STORE_FILE_COPY_CHUNK_BYTES = 1024 * 1024


class StoreFileSource(NamedTuple):
    relative: str
    source_path: Path
    sha256: str


def add_store_file_source(store_file_sources, relative, source_path, verified_store_file_by_key):
    key = store_file_key(relative)
    verified_store_file = verified_store_file_by_key.get(key)
    sha256 = sha256_of_file(source_path) if verified_store_file is None else verified_store_file.sha256
    first_source = store_file_sources.setdefault(key, StoreFileSource(relative, source_path, sha256))
    if (first_source.relative, first_source.sha256) != (relative, sha256):
        raise CatalogWriteError('Conflicting store file paths: ' + relative)


def missing_store_file_sources(target_root, store_file_sources):
    missing_sources = []
    for store_file_source in store_file_sources.values():
        destination = confined_child_path(target_root, store_file_source.relative)
        if not destination.exists():
            missing_sources.append(store_file_source)
        elif sha256_of_file(destination) != store_file_source.sha256:
            raise CatalogWriteError('Existing immutable store file differs; preserved: ' + str(destination))
    return missing_sources


def require_free_bytes_for_missing_store_files(target_root, missing_sources, disk_usage):
    if not missing_sources:
        return
    missing_bytes = sum(store_file_source.source_path.stat().st_size for store_file_source in missing_sources)
    free_bytes = disk_usage(nearest_existing_ancestor(target_root)).free
    if missing_bytes + BATCH_MINIMUM_FREE_BYTES > free_bytes:
        raise CatalogWriteError(f'Missing store files of {missing_bytes} bytes plus the floor of {BATCH_MINIMUM_FREE_BYTES} bytes exceed the '
                                f'{free_bytes} free bytes of the volume of {target_root}; nothing was written')


def require_existing_destination_holds_expected_sha256(destination, sha256):
    if sha256_of_file(destination) != sha256:
        raise CatalogWriteError('Existing immutable runtime asset is corrupt; preserved: ' + str(destination))


def write_hashed_source_chunks(source_path, temporary_file):
    copied_bytes_digest = hashlib.sha256()
    with open(source_path, 'rb') as source_file:
        while chunk := source_file.read(STORE_FILE_COPY_CHUNK_BYTES):
            copied_bytes_digest.update(chunk)
            temporary_file.write(chunk)
    return copied_bytes_digest.hexdigest()


def write_temporary_copy_of_expected_source(store_file_source, temporary_file):
    with temporary_file:
        copied_sha256 = write_hashed_source_chunks(store_file_source.source_path, temporary_file)
    if copied_sha256 != store_file_source.sha256:
        raise CatalogWriteError(f'Store file source no longer has its expected SHA-256 {store_file_source.sha256}; '
                                f'copy stopped: {store_file_source.source_path}')


def copy_source_to_absent_destination(store_file_source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = tempfile.NamedTemporaryFile(dir=destination.parent, prefix=destination.name + '.', suffix='.tmp', delete=False)
    temporary = Path(temporary_file.name)
    try:
        write_temporary_copy_of_expected_source(store_file_source, temporary_file)
        if destination.exists():
            require_existing_destination_holds_expected_sha256(destination, store_file_source.sha256)
            return
        temporary.rename(destination)
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_of_file(destination) != store_file_source.sha256:
        raise CatalogWriteError('Runtime copy hash differs: ' + str(destination))


def copy_immutable_store_file(target_root, store_file_source):
    destination = confined_child_path(target_root, store_file_source.relative)
    if destination.exists():
        require_existing_destination_holds_expected_sha256(destination, store_file_source.sha256)
        return
    copy_source_to_absent_destination(store_file_source, destination)


def copy_store_files(target_root, store_file_sources, before, after, *, disk_usage=shutil.disk_usage):
    root = refuse_reparse_points(target_root)
    missing_sources = missing_store_file_sources(root, store_file_sources)
    require_catalog_unchanged(root, before)
    catalog_path = confined_child_path(root, STORE_CATALOG_NAME)
    require_catalog_within_byte_limit(catalog_path, after)
    require_free_bytes_for_missing_store_files(root, missing_sources, disk_usage)
    for store_file_source in store_file_sources.values():
        copy_immutable_store_file(root, store_file_source)
    require_catalog_unchanged(root, before)
    catalog_replaced = after != before
    if catalog_replaced:
        replace_file(catalog_path, after)
    return {'filesWritten': len(missing_sources) + int(catalog_replaced), 'catalogSha256': sha256_hex(after)}
