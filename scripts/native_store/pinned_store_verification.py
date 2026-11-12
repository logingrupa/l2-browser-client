from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from itertools import repeat

from native_store.catalog_writer import (catalog_pinned_file_references, pinned_file_child_references, read_pinned_file,
                                         require_one_sha256_per_store_file, store_file_key)

POOLED_LEVEL_MINIMUM_REFERENCE_COUNT = 512


def verified_file_child_references(store_root, reference):
    payload = read_pinned_file(store_root, reference)
    store_file_key(reference.relative)
    return pinned_file_child_references(reference, payload)


def unverified_level_references(level_references, verified_sha256_by_store_file_key):
    first_reference_by_store_file_key = {}
    for reference in level_references:
        key = reference.relative.casefold()
        if key not in verified_sha256_by_store_file_key:
            first_reference_by_store_file_key.setdefault(key, reference)
    return list(first_reference_by_store_file_key.values())


def next_level_references(level_references, child_reference_lists, verified_sha256_by_store_file_key):
    next_level = []
    for reference in level_references:
        key = reference.relative.casefold()
        if key in verified_sha256_by_store_file_key:
            require_one_sha256_per_store_file(verified_sha256_by_store_file_key[key], reference)
            continue
        next_level.extend(next(child_reference_lists))
        verified_sha256_by_store_file_key[key] = reference.sha256
    return next_level


def verify_pinned_store_files(store_root, catalog, worker_count):
    verified_sha256_by_store_file_key = {}
    level_references = catalog_pinned_file_references(catalog)
    process_pool = None
    try:
        while level_references:
            unverified_references = unverified_level_references(level_references, verified_sha256_by_store_file_key)
            verify_level = map
            if len(unverified_references) >= POOLED_LEVEL_MINIMUM_REFERENCE_COUNT:
                process_pool = process_pool or ProcessPoolExecutor(max_workers=worker_count)
                verify_level = process_pool.map
            child_reference_lists = verify_level(verified_file_child_references, repeat(store_root), unverified_references)
            level_references = next_level_references(level_references, child_reference_lists, verified_sha256_by_store_file_key)
    finally:
        if process_pool is not None:
            process_pool.shutdown(cancel_futures=True)
    return verified_sha256_by_store_file_key
