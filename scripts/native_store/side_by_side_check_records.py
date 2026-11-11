from __future__ import annotations

import json
from pathlib import Path
import re

from native_assets_lib.asset_manifest import reference_client_build
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number, replace_file
from native_store.coverage_denominators import COVERAGE_PART_ORDER
from native_store.load_check_records import is_catalog_key, is_riga_timestamp
from native_store.side_by_side_check_halves import (AUDIO_PART, OWNER_IDENTITY, RecordContext, SideBySideCheckRecordError, is_non_empty_text,
                                                    is_non_negative_integer, is_sha256, require_exact_fields, sandbox_half_history_entry,
                                                    validate_native_half, validate_sandbox_half, validate_sandbox_half_history)
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, REPOSITORY_ROOT, read_reference_client_lock

SIDE_BY_SIDE_SCHEMA_VERSION = 1
SIDE_BY_SIDE_FILE_MAXIMUM_BYTES = 32 * 1024 * 1024
SIDE_BY_SIDE_CHECKS_FILE_NAME = 'side-by-side-checks.json'
SIDE_BY_SIDE_VERDICTS = ('pass', 'mismatch', 'unverified')
STORED_UNVERIFIED_REASONS = ('native-session-needs-owner', 'native-needs-server', 'listen-needs-owner', 'native-selection-unconfirmed',
                             'framing-not-comparable', 'reviewer-uncertain', 'review-pending')
COMPUTED_UNVERIFIED_REASONS = ('sandbox-capture-failed', 'loads-failed', 'loads-unrecorded', 'stale-after-fix', 'not-yet-queued',
                               'no-pair-shows-table')
LISTEN_NEEDS_OWNER_REASON = 'listen-needs-owner'
REVIEW_PENDING_REASON = 'review-pending'
REVIEWER_UNCERTAIN_REASON = 'reviewer-uncertain'
AUDIO_ROLES = ('ambience', 'placement', 'music', 'voice', 'combat', 'skill')
SIDE_BY_SIDE_DOCUMENT_FIELDS = frozenset({'schemaVersion', 'part', 'records'})
SIDE_BY_SIDE_RECORD_FIELDS = frozenset({'key', 'verdict', 'reason', 'nativeSelection', 'sandboxHalf', 'nativeHalf', 'difference',
                                        'suspectedStep', 'reviewer', 'judgedAtRiga', 'sandboxHalfHistory', 'displayedTableRows'})
AUDIO_RECORD_FIELDS = SIDE_BY_SIDE_RECORD_FIELDS | {'role', 'sourcePackage', 'sourceObject', 'sourceSha256'}
DISPLAYED_TABLE_ROWS_FIELDS = frozenset({'tableKey', 'rowIds'})
TABLE_KEY_PREFIX = 'table:'
REVIEWER_PATTERN = re.compile(r'^(?:owner|reviewer:[A-Za-z0-9][A-Za-z0-9:._-]{0,127})$')
MINIMAP_PART = 'minimap'
NATIVE_SELECTION_FIELDS_BY_KIND = {
    'tile': frozenset({'route', 'map'}),
    'npc': frozenset({'viewer', 'searchText', 'expectedMeshText', 'expectedTextureTexts'}),
    'item': frozenset({'viewer', 'itemId', 'expectedMeshTexts'}),
    'skill': frozenset({'viewer', 'skillId', 'level'}),
    'window': frozenset({'route', 'window'}),
    'minimap': frozenset({'route', 'window', 'map'}),
    'audio': frozenset({'route', 'role'}),
}
NATIVE_SELECTION_CHOICES_BY_KIND = {
    'tile': {'route': ('offline-debug-startup', 'server-world')},
    'npc': {'viewer': ('nv',)},
    'item': {'viewer': ('pv', 'server-world')},
    'skill': {'viewer': ('sv',)},
    'window': {'route': ('server-world',)},
    'minimap': {'route': ('server-world',)},
    'audio': {'route': ('listen',), 'role': AUDIO_ROLES},
}
NATIVE_SELECTION_INTEGER_FIELDS = frozenset({'itemId', 'skillId', 'level'})
NATIVE_SELECTION_TEXT_LIST_FIELDS = frozenset({'expectedTextureTexts', 'expectedMeshTexts'})


def require_known_part(part):
    if part not in COVERAGE_PART_ORDER:
        raise SideBySideCheckRecordError(f'side-by-side part must be one of {", ".join(COVERAGE_PART_ORDER)}: {part!r}')
    return part


def side_by_side_checks_path(project_root, part):
    return Path(project_root) / 'docs' / 'parts' / require_known_part(part) / SIDE_BY_SIDE_CHECKS_FILE_NAME


def current_reference_tree_lock_sha256(project_root):
    lock_path = Path(project_root) / REFERENCE_CLIENT_LOCK_PATH.relative_to(REPOSITORY_ROOT)
    return reference_client_build(read_reference_client_lock(lock_path))['referenceTreeLockSha256']


def record_identity(record, part):
    if part == AUDIO_PART:
        return record['key'], record['role'], record['sourceSha256']
    return (record['key'],)


def describe_identity(record, part):
    if not isinstance(record, dict):
        return repr(None)
    if part == AUDIO_PART:
        return repr((record.get('key'), record.get('role'), record.get('sourceSha256')))
    return repr(record.get('key'))


def native_selection_kind(record, part):
    if part in (MINIMAP_PART, AUDIO_PART):
        return part
    return record['key'].split(':', 1)[0]


def validate_native_selection(record, part, context):
    kind = native_selection_kind(record, part)
    if kind not in NATIVE_SELECTION_FIELDS_BY_KIND:
        context.refuse(f'has no native selection shape for {kind} keys')
    selection = record['nativeSelection']
    require_exact_fields(selection, NATIVE_SELECTION_FIELDS_BY_KIND[kind], f'nativeSelection of a {kind} key', context)
    for field, value in selection.items():
        choices = NATIVE_SELECTION_CHOICES_BY_KIND[kind].get(field)
        if choices is not None:
            valid = value in choices
        elif field in NATIVE_SELECTION_INTEGER_FIELDS:
            valid = is_non_negative_integer(value)
        elif field in NATIVE_SELECTION_TEXT_LIST_FIELDS:
            valid = isinstance(value, list) and all(is_non_empty_text(text) for text in value)
        else:
            valid = is_non_empty_text(value)
        if not valid:
            context.refuse(f'nativeSelection {field} is not valid for a {kind} key: {value!r}')


def validate_audio_identity(record, context):
    if record['role'] not in AUDIO_ROLES:
        context.refuse(f'role must be one of {", ".join(AUDIO_ROLES)}, not {record["role"]!r}')
    for field in ('sourcePackage', 'sourceObject'):
        if not is_non_empty_text(record[field]):
            context.refuse(f'{field} must be non-empty text')
    if not is_sha256(record['sourceSha256']):
        context.refuse(f'sourceSha256 must be 64 lowercase hex characters, not {record["sourceSha256"]!r}')
    if record['nativeSelection']['role'] != record['role']:
        context.refuse('nativeSelection role must equal the record role')
    if record['nativeHalf'] is not None:
        context.refuse('nativeHalf must be null for an audio record; the owner listens to the native client')


def validate_reviewer(record, context):
    reviewer = record['reviewer']
    if reviewer is None:
        if record['judgedAtRiga'] is not None:
            context.refuse('judgedAtRiga must be null without a reviewer')
        return
    capturers = [half['capturedBy'] for half in (record['sandboxHalf'], record['nativeHalf']) if half is not None]
    if any(reviewer in (capturer, f'reviewer:{capturer}') for capturer in capturers):
        context.refuse(f'reviewer must differ from the capturer of either half: {reviewer!r}')
    if not (isinstance(reviewer, str) and REVIEWER_PATTERN.fullmatch(reviewer)):
        context.refuse(f'reviewer must be owner or reviewer:<agent id>, not {reviewer!r}')
    if not is_riga_timestamp(record['judgedAtRiga']):
        context.refuse(f'judgedAtRiga must be ISO 8601 with the Riga offset, not {record["judgedAtRiga"]!r}')


def validate_unverified_judgement(record, part, context):
    reason = record['reason']
    if reason in COMPUTED_UNVERIFIED_REASONS:
        context.refuse(f'reason {reason} is computed by the report and is never stored')
    if reason not in STORED_UNVERIFIED_REASONS:
        context.refuse(f'unverified reason must be one of {", ".join(STORED_UNVERIFIED_REASONS)}, not {reason!r}')
    if part == AUDIO_PART and reason != LISTEN_NEEDS_OWNER_REASON:
        context.refuse(f'audio record unverified reason must be {LISTEN_NEEDS_OWNER_REASON}, not {reason}')
    if reason in (REVIEW_PENDING_REASON, REVIEWER_UNCERTAIN_REASON) and record['nativeHalf'] is None:
        context.refuse(f'{reason} needs a nativeHalf')
    if reason == REVIEWER_UNCERTAIN_REASON:
        if record['reviewer'] is None:
            context.refuse(f'{reason} needs a reviewer')
    elif record['reviewer'] is not None or record['judgedAtRiga'] is not None:
        context.refuse(f'reviewer and judgedAtRiga must be null for reason {reason}')


def validate_judged_verdict(record, part, context):
    verdict = record['verdict']
    if record['reason'] is not None:
        context.refuse(f'{verdict} record must have reason null')
    if part != AUDIO_PART and record['nativeHalf'] is None:
        context.refuse(f'{verdict} needs a nativeHalf')
    if record['reviewer'] is None:
        context.refuse(f'{verdict} needs a reviewer')
    if part == AUDIO_PART and record['reviewer'] != OWNER_IDENTITY:
        context.refuse(f'audio pass or mismatch is accepted only from reviewer {OWNER_IDENTITY}, not {record["reviewer"]!r}')
    if verdict == 'mismatch':
        for field in ('difference', 'suspectedStep'):
            if not is_non_empty_text(record[field]):
                context.refuse(f'mismatch needs a {field} text')


def validate_judgement(record, part, context):
    verdict = record['verdict']
    if verdict not in SIDE_BY_SIDE_VERDICTS:
        context.refuse(f'verdict must be one of {", ".join(SIDE_BY_SIDE_VERDICTS)}, not {verdict!r}')
    if verdict != 'mismatch' and (record['difference'] is not None or record['suspectedStep'] is not None):
        context.refuse('difference must be null unless the verdict is mismatch, and so must suspectedStep')
    if verdict == 'unverified':
        validate_unverified_judgement(record, part, context)
    else:
        validate_judged_verdict(record, part, context)
    validate_reviewer(record, context)


def is_sorted_unique_row_id_list(row_ids):
    if not (isinstance(row_ids, list) and row_ids):
        return False
    if not (all(is_non_negative_integer(row_id) for row_id in row_ids) or all(is_non_empty_text(row_id) for row_id in row_ids)):
        return False
    return all(earlier < later for earlier, later in zip(row_ids, row_ids[1:]))


def validate_displayed_table_rows(displayed_table_rows, context):
    if not isinstance(displayed_table_rows, list):
        context.refuse('displayedTableRows must be a list')
    for entry in displayed_table_rows:
        require_exact_fields(entry, DISPLAYED_TABLE_ROWS_FIELDS, 'displayedTableRows entry', context)
        if not (is_catalog_key(entry['tableKey']) and entry['tableKey'].startswith(TABLE_KEY_PREFIX)):
            context.refuse(f'displayedTableRows tableKey must be a table: catalog key, not {entry["tableKey"]!r}')
        if not is_sorted_unique_row_id_list(entry['rowIds']):
            context.refuse(f'displayedTableRows {entry["tableKey"]} rowIds must be a non-empty sorted list of unique row ids, '
                           'all integers or all texts')
    table_keys = [entry['tableKey'] for entry in displayed_table_rows]
    if table_keys != sorted(set(table_keys)):
        context.refuse('displayedTableRows must be sorted by tableKey with no repeated tableKey')


def validate_side_by_side_record(record, part, path, reference_tree_lock_sha256):
    require_known_part(part)
    context = RecordContext(part, describe_identity(record, part), path)
    require_exact_fields(record, AUDIO_RECORD_FIELDS if part == AUDIO_PART else SIDE_BY_SIDE_RECORD_FIELDS, 'record', context)
    if not is_catalog_key(record['key']):
        context.refuse('key must be a catalog key')
    validate_native_selection(record, part, context)
    if part == AUDIO_PART:
        validate_audio_identity(record, context)
    validate_sandbox_half(record['key'], record['sandboxHalf'], part, context)
    if record['nativeHalf'] is not None:
        validate_native_half(record['nativeHalf'], part, reference_tree_lock_sha256, context)
    validate_judgement(record, part, context)
    validate_sandbox_half_history(record['sandboxHalfHistory'], part, context)
    validate_displayed_table_rows(record['displayedTableRows'], context)
    return record


def validate_side_by_side_document(document, part, path):
    if not (isinstance(document, dict) and set(document) == SIDE_BY_SIDE_DOCUMENT_FIELDS):
        raise SideBySideCheckRecordError(f'side-by-side document must hold exactly {", ".join(sorted(SIDE_BY_SIDE_DOCUMENT_FIELDS))}: {path}')
    if document['schemaVersion'] != SIDE_BY_SIDE_SCHEMA_VERSION:
        raise SideBySideCheckRecordError(f'side-by-side document schemaVersion must be {SIDE_BY_SIDE_SCHEMA_VERSION}: {path}')
    if document['part'] != part:
        raise SideBySideCheckRecordError(f'side-by-side document part {document["part"]!r} differs from its path part {part}: {path}')
    if not isinstance(document['records'], list):
        raise SideBySideCheckRecordError(f'side-by-side document records must be a list: {path}')
    identities = [record_identity(validate_side_by_side_record(record, part, path, None), part) for record in document['records']]
    if len(set(identities)) != len(identities):
        raise SideBySideCheckRecordError(f'side-by-side document of part {part} repeats a record identity: {path}')
    if identities != sorted(identities):
        raise SideBySideCheckRecordError(f'side-by-side document of part {part} records must be sorted by identity: {path}')
    return document


def decode_side_by_side_document(path):
    with open(path, 'rb') as stream:
        payload = stream.read(SIDE_BY_SIDE_FILE_MAXIMUM_BYTES + 1)
    if len(payload) > SIDE_BY_SIDE_FILE_MAXIMUM_BYTES:
        raise SideBySideCheckRecordError(f'side-by-side document exceeds {SIDE_BY_SIDE_FILE_MAXIMUM_BYTES} bytes: {path}')
    try:
        return json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise SideBySideCheckRecordError(f'side-by-side document is not strict JSON: {path}: {error}') from error


def read_side_by_side_records(project_root, part):
    path = side_by_side_checks_path(project_root, part)
    if not path.is_file():
        return []
    return validate_side_by_side_document(decode_side_by_side_document(path), part, path)['records']


def record_with_writer_history(record, stored_record, part, path):
    stored_history = [] if stored_record is None else stored_record['sandboxHalfHistory']
    if record['sandboxHalfHistory'] not in ([], stored_history):
        raise SideBySideCheckRecordError(f'side-by-side record {describe_identity(record, part)} of part {part} sandboxHalfHistory is kept by '
                                         f'the writer and must be empty or equal the stored history: {path}')
    history = list(stored_history)
    if stored_record is not None and stored_record['sandboxHalf'] != record['sandboxHalf']:
        history.append(sandbox_half_history_entry(stored_record['sandboxHalf'], part))
    return {**record, 'sandboxHalfHistory': history}


def write_side_by_side_records(project_root, part, records):
    path = side_by_side_checks_path(project_root, part)
    has_native_half = any(isinstance(record, dict) and record.get('nativeHalf') is not None for record in records)
    reference_tree_lock_sha256 = current_reference_tree_lock_sha256(project_root) if has_native_half else None
    for record in records:
        validate_side_by_side_record(record, part, path, reference_tree_lock_sha256)
    incoming_identities = [record_identity(record, part) for record in records]
    if len(set(incoming_identities)) != len(incoming_identities):
        raise SideBySideCheckRecordError(f'side-by-side records written for part {part} repeat a record identity: {path}')
    stored_records_by_identity = {record_identity(record, part): record for record in read_side_by_side_records(project_root, part)}
    records_by_identity = dict(stored_records_by_identity)
    for identity, record in zip(incoming_identities, records):
        records_by_identity[identity] = record_with_writer_history(record, stored_records_by_identity.get(identity), part, path)
    document = {'schemaVersion': SIDE_BY_SIDE_SCHEMA_VERSION, 'part': part,
                'records': [records_by_identity[identity] for identity in sorted(records_by_identity)]}
    validate_side_by_side_document(document, part, path)
    replace_file(path, canonical_json_bytes(document))
    return document
