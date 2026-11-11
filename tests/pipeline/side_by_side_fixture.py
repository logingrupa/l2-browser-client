from __future__ import annotations

import copy
import hashlib

from catalog_store_fixture import write_store_catalog

CATALOG_SHA256 = 'c' * 64
SANDBOX_PNG_SHA256 = 'd' * 64
CAPTURED_AT_RIGA = '2026-11-11T09:00:00+02:00'
SANDBOX_CAPTURED_BY = 'executor:03-07'
DESKTOP_VIEWPORT = {'width': 1440, 'height': 900}


def pinned_manifest_record(record_id, folder, file_name, extra_fields=None):
    manifest_sha256 = hashlib.sha256(f'{folder}:{record_id}'.encode()).hexdigest()
    return {'id': record_id, 'manifest': f'/l2/{folder}/{manifest_sha256}/{file_name}', 'manifestSha256': manifest_sha256,
            'manifestBytes': 10, **(extra_fields or {})}


def tile_record(tile_id):
    return pinned_manifest_record(tile_id, 'tiles', 'tile.json')


def window_record(window_id):
    return pinned_manifest_record(window_id, 'windows', 'window.json')


def table_record(table_id):
    return pinned_manifest_record(table_id, 'tables', f'{table_id}.json', {'recordCount': 1, 'sourceSha256': 'e' * 64})


def single_record_catalog():
    return {'schemaVersion': 1, 'models': [], 'tiles': [tile_record('20_20')], 'windows': [window_record('StatusWnd')],
            'tables': [table_record('itemname-e')]}


def write_single_record_store(store_root):
    catalog = single_record_catalog()
    write_store_catalog(store_root, catalog)
    return catalog


def tile_native_selection():
    return {'route': 'offline-debug-startup', 'map': '20_20'}


def image_sandbox_half(part, key, key_content_sha256='a' * 64, png_sha256=SANDBOX_PNG_SHA256, captured_at_riga=CAPTURED_AT_RIGA):
    return {'catalogSha256': CATALOG_SHA256, 'keyContentSha256': key_content_sha256,
            'pngPath': f'artifacts/side-by-side/{part}/sandbox/{key.replace(":", "_")}.png', 'pngSha256': png_sha256,
            'viewport': dict(DESKTOP_VIEWPORT), 'cameraPose': {'target': [0.0, 1.5, -2.0], 'alpha': 1.2, 'beta': 0.8, 'radius': 12.0},
            'environment': {'gameMinutes': 720, 'environmentType': 0, 'source': 'environment-event'},
            'diagnosticMaterials': None if key.startswith('window:') else [], 'capturedBy': SANDBOX_CAPTURED_BY,
            'capturedAtRiga': captured_at_riga}


def unverified_record(part, key, native_selection, reason='native-session-needs-owner', **sandbox_half_changes):
    return {'key': key, 'verdict': 'unverified', 'reason': reason, 'nativeSelection': copy.deepcopy(native_selection),
            'sandboxHalf': image_sandbox_half(part, key, **sandbox_half_changes), 'nativeHalf': None, 'difference': None,
            'suspectedStep': None, 'reviewer': None, 'judgedAtRiga': None, 'sandboxHalfHistory': [], 'displayedTableRows': []}


def unverified_tile_record(key='tile:20_20', **sandbox_half_changes):
    return unverified_record('world', key, {**tile_native_selection(), 'map': key.split(':', 1)[1]}, **sandbox_half_changes)
