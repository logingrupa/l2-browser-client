from __future__ import annotations

from native_store.catalog_index_keys import LEGACY_SECTION_ID_PATTERN, validated_slice_records
from native_store.coverage_denominators import CoverageReportError
from native_store.store_paths import SHA256_PATTERN

SINGLE_RECORD_KEY_PREFIX_BY_SLICE = {'tiles': 'tile', 'windows': 'window', 'tables': 'table'}


def require_pinned_sha256(record, slice_name, field):
    value = record.get(field)
    if not (isinstance(value, str) and SHA256_PATTERN.fullmatch(value)):
        raise CoverageReportError(f'catalog {slice_name} record {record["id"]} {field} must be 64 lowercase hex characters: {value!r}')
    return value


def single_record_manifest_sha256_by_key(catalog):
    manifest_sha256_lists_by_key = {}
    for slice_name, key_prefix in SINGLE_RECORD_KEY_PREFIX_BY_SLICE.items():
        for record in validated_slice_records(catalog, slice_name):
            manifest_sha256_lists_by_key.setdefault(f'{key_prefix}:{record["id"]}', []).append(
                require_pinned_sha256(record, slice_name, 'manifestSha256'))
    for record in validated_slice_records(catalog, 'sections'):
        match = LEGACY_SECTION_ID_PATTERN.fullmatch(record['id'])
        if match:
            manifest_sha256_lists_by_key.setdefault(f'tile:{match["column"]}_{match["row"]}', []).append(
                require_pinned_sha256(record, 'sections', 'manifestSha256'))
    for key, manifest_sha256_list in manifest_sha256_lists_by_key.items():
        if len(manifest_sha256_list) != 1:
            raise CoverageReportError(f'key {key} is attributed to {len(manifest_sha256_list)} catalog records; a {key.split(":")[0]} key needs one')
    return {key: manifest_sha256_list[0] for key, manifest_sha256_list in manifest_sha256_lists_by_key.items()}


def key_content_sha256_by_key(store_root, catalog, shared_store_root=None):
    return dict(sorted(single_record_manifest_sha256_by_key(catalog).items()))
