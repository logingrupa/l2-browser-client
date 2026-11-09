from __future__ import annotations

from native_store.gap_census_denominators import load_census_denominators
from native_store.gap_rows import write_gap_rows

SOURCE_SHA256 = 'b' * 64
INTERFACE_SOURCE_SHA256 = 'e' * 64
DECODE_FAILED_REASON = 'decode-failed:cp1252 codec error'
DECODE_PENDING_REASON = 'step-pending:decode'


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
