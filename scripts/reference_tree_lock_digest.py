import hashlib

from hash_reference_client_tree import canonical_json_bytes


def reference_tree_lock_sha256(lock_document):
    return hashlib.sha256(canonical_json_bytes(lock_document)).hexdigest()
