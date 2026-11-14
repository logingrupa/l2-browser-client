from __future__ import annotations

from pathlib import Path

from native_store.catalog_writer import sha256_of_file
from native_store.side_by_side_check_halves import IMAGE_SANDBOX_HALF_FIELDS, key_file_stem
from native_store.side_by_side_check_records import REVIEW_PENDING_REASON, read_side_by_side_records, write_side_by_side_records
from native_store.store_paths import StorePathError, confined_child_path
from side_by_side.build_pair_queue import native_selection_for_key, require_part_of_key, session_kind_for_key, stored_reason_for_session_kind
from side_by_side.pair_queue_key_facts import PairQueueKeyFacts
from side_by_side.pair_queue_union import PairQueueError, PairQueueUnion, read_strict_json_file

SIDE_BY_SIDE_ARTIFACTS_FOLDER = Path('artifacts/side-by-side')
RECEIPTS_FOLDER_NAME = 'receipts'
SANDBOX_RECEIPT_FIELDS = IMAGE_SANDBOX_HALF_FIELDS | {'key', 'part', 'displayedTableRows'}


def sandbox_receipt_file_name(receipt):
    return key_file_stem(receipt['key']) + '.json'


def receipt_folder(project_root, part):
    return Path(project_root) / SIDE_BY_SIDE_ARTIFACTS_FOLDER / part / RECEIPTS_FOLDER_NAME


def read_receipts(project_root, part):
    folder = receipt_folder(project_root, part)
    if not folder.is_dir():
        return []
    return [(path, read_strict_json_file(path, 'side-by-side receipt')) for path in sorted(folder.glob('*.json'))]


def require_receipt_fields(receipt, fields, path, expected_file_name):
    if not (isinstance(receipt, dict) and set(receipt) == fields):
        raise PairQueueError(f'side-by-side receipt must hold exactly {", ".join(sorted(fields))}: {path}')
    if path.name != expected_file_name(receipt):
        raise PairQueueError(f'side-by-side receipt file name must be {expected_file_name(receipt)}: {path}')


def require_artifact_sha256(project_root, relative_path, expected_sha256, label, receipt_path):
    try:
        artifact_path = confined_child_path(Path(project_root).resolve(), relative_path)
    except (StorePathError, TypeError) as error:
        raise PairQueueError(f'{label} {relative_path!r} is not a path inside the project: {receipt_path}') from error
    if not artifact_path.is_file():
        raise PairQueueError(f'{label} {relative_path} is missing: {receipt_path}')
    if sha256_of_file(artifact_path) != expected_sha256:
        raise PairQueueError(f'{label} {relative_path} differs from the receipt SHA-256 {expected_sha256}: {receipt_path}')


def require_current_key_content(union, receipt, receipt_path):
    current_sha256 = union.key_content_sha256_by_key.get(receipt['key'])
    if current_sha256 is None:
        raise PairQueueError(f'side-by-side receipt key {receipt["key"]} is not a converted key of union {union.catalog_sha256}: '
                             f'{receipt_path}')
    if receipt['keyContentSha256'] != current_sha256:
        raise PairQueueError(f'stale capture: receipt key content {receipt["keyContentSha256"]} of {receipt["key"]} differs from '
                             f'{current_sha256} on union {union.catalog_sha256}; capture it again: {receipt_path}')


def validated_sandbox_receipt(project_root, union, part, receipt_path, receipt):
    require_receipt_fields(receipt, SANDBOX_RECEIPT_FIELDS, receipt_path, sandbox_receipt_file_name)
    if receipt['part'] != part:
        raise PairQueueError(f'side-by-side receipt part {receipt["part"]!r} differs from {part}: {receipt_path}')
    require_part_of_key(part, receipt['key'])
    require_artifact_sha256(project_root, receipt['pngPath'], receipt['pngSha256'], 'sandbox PNG', receipt_path)
    require_current_key_content(union, receipt, receipt_path)
    return receipt


def ingested_sandbox_record(facts, part, receipt, stored_record):
    native_half = None if stored_record is None else stored_record['nativeHalf']
    reason = (REVIEW_PENDING_REASON if native_half is not None
              else stored_reason_for_session_kind(session_kind_for_key(facts, part, receipt['key'])))
    return {'key': receipt['key'], 'verdict': 'unverified', 'reason': reason,
            'nativeSelection': native_selection_for_key(facts, part, receipt['key']),
            'sandboxHalf': {field: receipt[field] for field in IMAGE_SANDBOX_HALF_FIELDS}, 'nativeHalf': native_half,
            'difference': None, 'suspectedStep': None, 'reviewer': None, 'judgedAtRiga': None, 'sandboxHalfHistory': [],
            'displayedTableRows': receipt['displayedTableRows']}


def is_unchanged_sandbox_receipt(receipt, stored_record):
    return (stored_record is not None and stored_record['displayedTableRows'] == receipt['displayedTableRows']
            and stored_record['sandboxHalf'] == {field: receipt[field] for field in IMAGE_SANDBOX_HALF_FIELDS})


def ingest_sandbox_halves(project_root, part, store_root):
    union = PairQueueUnion(project_root, store_root)
    stored_records_by_key = {record['key']: record for record in read_side_by_side_records(project_root, part)}
    receipts = [validated_sandbox_receipt(project_root, union, part, path, receipt) for path, receipt in read_receipts(project_root, part)]
    facts = PairQueueKeyFacts(union)
    records = [ingested_sandbox_record(facts, part, receipt, stored_records_by_key.get(receipt['key'])) for receipt in receipts
               if not is_unchanged_sandbox_receipt(receipt, stored_records_by_key.get(receipt['key']))]
    if records:
        write_side_by_side_records(project_root, part, records)
    return {'part': part, 'catalogSha256': union.catalog_sha256, 'receipts': len(receipts), 'written': len(records),
            'unchanged': len(receipts) - len(records)}
