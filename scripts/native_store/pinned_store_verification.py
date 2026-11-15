from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from itertools import repeat
from typing import NamedTuple

from native_store.catalog_writer import (catalog_pinned_file_references, pinned_file_child_references, read_pinned_file,
                                         require_one_sha256_per_store_file, store_file_key)

POOLED_LEVEL_MINIMUM_REFERENCE_COUNT = 512
POOLED_CHUNK_REFERENCE_COUNT = 64
PINNED_STORE_VERIFICATION_WORKER_COUNT = 12


class VerifiedStoreFile(NamedTuple):
    relative: str
    sha256: str


def verified_file_child_references(store_root, reference):
    payload = read_pinned_file(store_root, reference)
    store_file_key(reference.relative)
    return pinned_file_child_references(reference, payload)


def verified_chunk_outcomes(store_root, references):
    outcomes = []
    for reference in references:
        try:
            outcomes.append(verified_file_child_references(store_root, reference))
        except Exception as refusal:
            outcomes.append(refusal)
            break
    return outcomes


def pooled_child_reference_lists(process_pool, store_root, references):
    chunks = [references[start:start + POOLED_CHUNK_REFERENCE_COUNT] for start in range(0, len(references), POOLED_CHUNK_REFERENCE_COUNT)]
    for chunk_outcomes in process_pool.map(verified_chunk_outcomes, repeat(store_root), chunks):
        for outcome in chunk_outcomes:
            if isinstance(outcome, Exception):
                raise outcome
            yield outcome


def unverified_level_references(level_references, verified_store_file_by_key):
    first_reference_by_store_file_key = {}
    for reference in level_references:
        key = reference.relative.casefold()
        if key not in verified_store_file_by_key:
            first_reference_by_store_file_key.setdefault(key, reference)
    return list(first_reference_by_store_file_key.values())


def next_level_references(level_references, child_reference_lists, verified_store_file_by_key):
    next_level = []
    for reference in level_references:
        key = reference.relative.casefold()
        if key in verified_store_file_by_key:
            require_one_sha256_per_store_file(verified_store_file_by_key[key].sha256, reference)
            continue
        next_level.extend(next(child_reference_lists))
        verified_store_file_by_key[key] = VerifiedStoreFile(reference.relative, reference.sha256)
    return next_level


def verify_pinned_store_files(store_root, catalog, worker_count):
    verified_store_file_by_key = {}
    level_references = catalog_pinned_file_references(catalog)
    process_pool = None
    try:
        while level_references:
            unverified_references = unverified_level_references(level_references, verified_store_file_by_key)
            if len(unverified_references) >= POOLED_LEVEL_MINIMUM_REFERENCE_COUNT:
                process_pool = process_pool or ProcessPoolExecutor(max_workers=worker_count)
                child_reference_lists = pooled_child_reference_lists(process_pool, store_root, unverified_references)
            else:
                child_reference_lists = map(verified_file_child_references, repeat(store_root), unverified_references)
            level_references = next_level_references(level_references, child_reference_lists, verified_store_file_by_key)
    finally:
        if process_pool is not None:
            process_pool.shutdown(cancel_futures=True)
    return verified_store_file_by_key
