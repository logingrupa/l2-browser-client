from __future__ import annotations

from pathlib import Path

from hash_reference_client_tree import canonical_json_bytes
from native_store.catalog_writer import add_store_file, merge_catalog_slice, read_store_catalog, sha256_hex, write_store
from native_store.gap_rows import read_gap_rows, write_gap_rows
from native_store.unit_ledger import RECEIPT_RECORD_NAME

DECODE_ERROR_RECORD_NAME = 'decode-error.json'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'


class LaneUnitOutcomeError(ValueError):
    pass


def lane_relative_path(ledger, path):
    try:
        return Path(path).relative_to(ledger.lane_folder).as_posix()
    except ValueError as error:
        raise LaneUnitOutcomeError(f'{path} is outside the {ledger.lane_name} lane folder {ledger.lane_folder}') from error


def replace_unit_gap_row(project_root, ledger, unit_key, gap_row):
    step_rows = [row for row in read_gap_rows(project_root, ledger.lane_name) if row['step'] == ledger.step]
    kept_rows = [row for row in step_rows if row['key'] != unit_key]
    if gap_row is None and len(kept_rows) == len(step_rows):
        return
    write_gap_rows(project_root, ledger.lane_name, ledger.step, kept_rows + ([gap_row] if gap_row else []))


def write_pinned_manifest_to_store(output_root, slice_name, record, manifest_relative, manifest_bytes, capacity):
    catalog, before = read_store_catalog(output_root)
    merged = merge_catalog_slice(catalog, slice_name, record, capacity)
    merged[slice_name] = sorted(merged[slice_name], key=lambda existing: existing['id'])
    files = {}
    add_store_file(files, manifest_relative, manifest_bytes)
    write_store(output_root, files, before, canonical_json_bytes(merged))
    return Path(output_root) / manifest_relative


def seal_unit_manifest(project_root, ledger, unit_key, fingerprint, inputs, config, manifest_path, record):
    replace_unit_gap_row(project_root, ledger, unit_key, None)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': [], 'outputs': [
        {'path': lane_relative_path(ledger, manifest_path), 'sha256': record['manifestSha256'], 'bytes': record['manifestBytes']}]})


def seal_unit_decode_failure(project_root, ledger, unit_key, fingerprint, step_directory, part_name, inputs, config, error):
    error_bytes = canonical_json_bytes({'errorClass': type(error).__name__, 'message': str(error)})
    error_path = step_directory / DECODE_ERROR_RECORD_NAME
    error_path.write_bytes(error_bytes)
    gap_row = {'key': unit_key, 'part': part_name, 'step': ledger.step, 'status': 'gap',
               'reason': DECODE_FAILED_REASON_PREFIX + type(error).__name__,
               'sourceIdentity': {'path': inputs[0]['path'], 'sha256': inputs[0]['sha256']},
               'evidence': lane_relative_path(ledger, step_directory / RECEIPT_RECORD_NAME)}
    replace_unit_gap_row(project_root, ledger, unit_key, gap_row)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': [gap_row], 'outputs': [
        {'path': lane_relative_path(ledger, error_path), 'sha256': sha256_hex(error_bytes), 'bytes': len(error_bytes)}]})
    return {'unit': unit_key, 'status': 'gap', 'reason': gap_row['reason']}
