from __future__ import annotations

from native_store.side_by_side_check_halves import AUDIO_PART, AUDIO_SANDBOX_HALF_FIELDS, key_file_stem
from native_store.side_by_side_check_records import (LISTEN_NEEDS_OWNER_REASON, record_identity, read_side_by_side_records,
                                                     write_side_by_side_records)
from side_by_side.pair_queue_union import PairQueueUnion
from side_by_side.side_by_side_receipts import read_receipts, require_artifact_sha256, require_current_key_content, require_receipt_fields

AUDIO_IDENTITY_FIELDS = ('role', 'sourcePackage', 'sourceObject', 'sourceSha256')
AUDIO_RECEIPT_FIELDS = AUDIO_SANDBOX_HALF_FIELDS | {'key', *AUDIO_IDENTITY_FIELDS}
LISTEN_ROUTE = 'listen'


def audio_receipt_file_name(receipt):
    return f'{key_file_stem(receipt["key"])}-{receipt["role"]}-{receipt["sourceSha256"]}.json'


def validated_audio_receipt(project_root, union, receipt_path, receipt):
    require_receipt_fields(receipt, AUDIO_RECEIPT_FIELDS, receipt_path, audio_receipt_file_name)
    require_artifact_sha256(project_root, receipt['clipPath'], receipt['clipSha256'], 'audio clip', receipt_path)
    require_current_key_content(union, receipt, receipt_path)
    return receipt


def ingested_audio_record(receipt):
    return {'key': receipt['key'], **{field: receipt[field] for field in AUDIO_IDENTITY_FIELDS}, 'verdict': 'unverified',
            'reason': LISTEN_NEEDS_OWNER_REASON, 'nativeSelection': {'route': LISTEN_ROUTE, 'role': receipt['role']},
            'sandboxHalf': {field: receipt[field] for field in AUDIO_SANDBOX_HALF_FIELDS}, 'nativeHalf': None, 'difference': None,
            'suspectedStep': None, 'reviewer': None, 'judgedAtRiga': None, 'sandboxHalfHistory': [], 'displayedTableRows': []}


def ingest_audio_clips(project_root, store_root):
    union = PairQueueUnion(project_root, store_root)
    stored_records_by_identity = {record_identity(record, AUDIO_PART): record for record in read_side_by_side_records(project_root, AUDIO_PART)}
    receipts = [validated_audio_receipt(project_root, union, path, receipt) for path, receipt in read_receipts(project_root, AUDIO_PART)]
    records = [ingested_audio_record(receipt) for receipt in receipts
               if stored_records_by_identity.get(record_identity(receipt, AUDIO_PART), {}).get('sandboxHalf')
               != {field: receipt[field] for field in AUDIO_SANDBOX_HALF_FIELDS}]
    if records:
        write_side_by_side_records(project_root, AUDIO_PART, records)
    return {'part': AUDIO_PART, 'catalogSha256': union.catalog_sha256, 'receipts': len(receipts), 'written': len(records),
            'unchanged': len(receipts) - len(records)}
