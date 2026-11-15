from __future__ import annotations

import json

from native_store.gap_census_denominators import load_census_denominators
from native_store.gap_rows import write_gap_rows
from native_store.store_paths import lane_load_check_path

SOURCE_SHA256 = 'b' * 64
INTERFACE_SOURCE_SHA256 = 'e' * 64
DECODE_FAILED_REASON = 'decode-failed:cp1252 codec error'
DECODE_PENDING_REASON = 'step-pending:decode'
TABLE_MANIFEST_SHA256 = 'a' * 64
CHECKED_AT_RIGA = '2026-11-08T21:00:00+02:00'


def table_gap_row(key, step, status, reason):
    return {'key': key, 'part': 'data', 'step': step, 'status': status, 'reason': reason,
            'sourceIdentity': {'path': f'system/{key.split(":", 1)[1]}.dat', 'sha256': SOURCE_SHA256},
            'evidence': 'docs/parts/data/EVIDENCE.md'}


def write_table_decode_rows(project_root, failed_table_keys=('table:npcgrp',), unlisted_table_keys=('table:itemname-e',)):
    rows = [table_gap_row(key, 'decode', 'gap', DECODE_FAILED_REASON) if key in failed_table_keys
            else table_gap_row(key, 'decode', 'pending', DECODE_PENDING_REASON)
            for key in load_census_denominators(['data-ui'])['data']['keys'] if key not in unlisted_table_keys]
    write_gap_rows(project_root, 'data-ui', 'decode', rows)


def write_window_layout_rows(project_root):
    write_gap_rows(project_root, 'data-ui', 'layout', [
        {'key': key, 'part': 'ui', 'step': 'layout', 'status': 'pending', 'reason': 'step-pending:layout',
         'sourceIdentity': {'path': 'system/interface.xdat', 'sha256': INTERFACE_SOURCE_SHA256}, 'evidence': 'docs/parts/ui/EVIDENCE.md'}
        for key in load_census_denominators(['data-ui'])['ui']['keys']])


def table_record(table_name):
    return {'id': table_name, 'manifest': f'/l2/tables/{TABLE_MANIFEST_SHA256}/{table_name}.json',
            'manifestSha256': TABLE_MANIFEST_SHA256, 'manifestBytes': 10, 'recordCount': 1, 'sourceSha256': SOURCE_SHA256}


def load_check_record(key, status='pass', reason=None):
    return {'key': key, 'status': status, 'reason': reason, 'atRiga': CHECKED_AT_RIGA, 'assetManifestSchemaVersion': None}


def write_load_check_file(project_root, lane_name, catalog_sha256, records, document_changes=None):
    path = lane_load_check_path(project_root, lane_name, catalog_sha256)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {'schemaVersion': 1, 'lane': lane_name, 'catalogSha256': catalog_sha256, 'records': records, **(document_changes or {})}
    path.write_text(json.dumps(document), encoding='utf-8')
    return path


def stage_a_counts(converted, loads_pass, unverified_by_reason, passed=0, mismatched=0, records_without_denominator=0):
    return {'converted': converted, 'loadsPass': loads_pass, 'checked': passed + mismatched, 'pass': passed, 'mismatch': mismatched,
            'unverified': sum(unverified_by_reason.values()), 'unverifiedByReason': unverified_by_reason,
            'recordsWithoutDenominator': records_without_denominator}
