from __future__ import annotations

from pathlib import Path

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.store_paths import SHA256_PATTERN
from side_by_side.pair_queue_union import PairQueueError, PairQueueUnion

PAIR_QUEUE_SCHEMA_VERSION = 1
CENSUS_KEYS_PER_KIND = 25
PAIR_QUEUE_FOLDER = Path('artifacts/side-by-side/queue')
PART_BY_KIND = {'tile': 'world', 'window': 'ui', 'npc': 'npcs', 'item': 'items', 'skill': 'skills-effects'}
QUEUE_KINDS = ('window',)
SERVER_SESSION_KIND = 'server'
STORED_REASON_BY_SESSION_KIND = {'offline-debug': 'native-session-needs-owner', SERVER_SESSION_KIND: 'native-needs-server',
                                 'listen': 'listen-needs-owner'}
SERVER_WORLD_ROUTE = 'server-world'
CENSUS_STEP = 'census'
NOT_CONVERTED_REASON = 'not-converted'
CENSUS_GAP_REASON = 'census-gap'
LOADS_UNRECORDED_REASON = 'loads-unrecorded'
LOADS_FAILED_REASON = 'loads-failed'


def key_kind(key):
    return key.split(':', 1)[0]


def key_suffix(key):
    return key.split(':', 1)[1]


def queue_file_path(project_root, catalog_sha256):
    if not (isinstance(catalog_sha256, str) and SHA256_PATTERN.fullmatch(catalog_sha256)):
        raise PairQueueError(f'pair queue catalog SHA-256 must be 64 lowercase hex characters: {catalog_sha256!r}')
    return Path(project_root) / PAIR_QUEUE_FOLDER / f'{catalog_sha256}.json'


def require_part_of_key(part, key):
    kind = key_kind(key)
    if PART_BY_KIND.get(kind) != part:
        raise PairQueueError(f'key {key} does not belong to part {part}')
    return kind


def session_kind_for_key(union, part, key):
    kind = require_part_of_key(part, key)
    if kind == 'window':
        return SERVER_SESSION_KIND
    raise PairQueueError(f'no session kind rule covers {kind} keys yet')


def native_selection_for_key(union, part, key):
    kind = require_part_of_key(part, key)
    if kind == 'window':
        return {'route': SERVER_WORLD_ROUTE, 'window': key_suffix(key)}
    raise PairQueueError(f'no native selection rule covers {kind} keys yet')


def stored_reason_for_session_kind(session_kind):
    return STORED_REASON_BY_SESSION_KIND[session_kind]


def ineligibility_reason(union, part, key):
    if key not in union.converted_keys:
        return NOT_CONVERTED_REASON
    if union.is_census_gap(part, key):
        return CENSUS_GAP_REASON
    load_status = union.load_status_by_key.get(key)
    if load_status is None:
        return LOADS_UNRECORDED_REASON
    return None if load_status == 'pass' else LOADS_FAILED_REASON


def census_step_keys(union, kind):
    part = PART_BY_KIND[kind]
    eligible_keys = [key for key in union.census_ordered_keys(part, kind) if ineligibility_reason(union, part, key) is None]
    return eligible_keys[:CENSUS_KEYS_PER_KIND]


def queue_entry(union, order, key, part, step):
    return {'order': order, 'key': key, 'part': part, 'step': step, 'keyContentSha256': union.key_content_sha256_by_key[key],
            'nativeSelection': native_selection_for_key(union, part, key), 'sessionKind': session_kind_for_key(union, part, key)}


def build_pair_queue(project_root, store_root):
    union = PairQueueUnion(project_root, store_root)
    entries = []
    for kind in QUEUE_KINDS:
        for key in census_step_keys(union, kind):
            entries.append(queue_entry(union, len(entries) + 1, key, PART_BY_KIND[kind], CENSUS_STEP))
    return {'schemaVersion': PAIR_QUEUE_SCHEMA_VERSION, 'catalogSha256': union.catalog_sha256, 'censusKeysPerKind': CENSUS_KEYS_PER_KIND,
            'entries': entries}


def write_pair_queue(project_root, store_root):
    document = build_pair_queue(project_root, store_root)
    path = queue_file_path(project_root, document['catalogSha256'])
    replace_file(path, canonical_json_bytes(document))
    return path, document


def queue_entry_counts(document):
    counts = {}
    for entry in document['entries']:
        steps = counts.setdefault(entry['part'], {})
        steps[entry['step']] = steps.get(entry['step'], 0) + 1
    return counts
