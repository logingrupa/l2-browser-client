from __future__ import annotations

import json
from types import MappingProxyType
from typing import NamedTuple

from native_store.catalog_index_keys import read_manifest_bytes, store_root_candidates, validated_slice_records
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number
from native_store.coverage_denominators import CoverageReportError, locked_tile_keys, repository_relative_text, require_catalog_key
from native_store.tile_manifest_validation import TileManifestError, load_tile_manifest_vocabulary, validate_tile_manifest
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

TILE_KEY_KIND = 'tile'
SOURCE_ANCHOR_STEP = 'census'
STEP_PENDING_REASON_PREFIX = 'step-pending:'
MINIMAP_RESOURCE_KIND = 'minimap'


class DerivedPart(NamedTuple):
    part: str
    source_part: str
    source_key_kind: str
    source_step: str
    tile_resource_kind: str


DERIVED_PARTS = MappingProxyType({
    'minimap': DerivedPart('minimap', 'world', TILE_KEY_KIND, 'minimap', MINIMAP_RESOURCE_KIND),
})
DERIVED_KEY_KIND_PARTS = MappingProxyType({kind: derived_part.part for kind, derived_part in DERIVED_PARTS.items()})
DERIVED_SOURCE_PARTS = frozenset(derived_part.source_part for derived_part in DERIVED_PARTS.values())


def key_kind(key):
    return key.split(':', 1)[0]


def key_suffix(key):
    return key.split(':', 1)[1]


def derived_tile_denominator(kind, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    tile_keys = locked_tile_keys(lock_path)
    keys = tuple(sorted(require_catalog_key(f'{kind}:{key_suffix(tile_key)}', kind, 'locked tile map') for tile_key in tile_keys))
    return {'count': len(keys), 'keys': keys,
            'source': f'{repository_relative_text(lock_path)} maps/XX_YY.unr ({len(keys)} tiles as {kind}:XX_YY keys)'}


def strict_json_document(payload, label):
    try:
        return json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise CoverageReportError(f'{label} is not strict JSON: {error}') from error


def pinned_tile_manifest(record, store_roots, vocabulary):
    label = f'catalog tiles record {record["id"]} manifest'
    manifest = strict_json_document(read_manifest_bytes(record, store_roots, label), label)
    try:
        validate_tile_manifest(manifest, vocabulary)
    except TileManifestError as error:
        raise CoverageReportError(f'{label} is not a tile manifest: {error}') from error
    if manifest['tileId'] != record['id']:
        raise CoverageReportError(f'{label} belongs to tile {manifest["tileId"]}, not {record["id"]}')
    return manifest


def minimap_join_is_resolved(resource, tile_id, store_roots):
    label = f'tile {tile_id} minimap resource {resource["manifest"]}'
    minimap_manifest = strict_json_document(read_manifest_bytes(resource, store_roots, label), label)
    if not (isinstance(minimap_manifest, dict) and minimap_manifest.get('tileId') == tile_id and isinstance(minimap_manifest.get('gaps'), list)):
        raise CoverageReportError(f'{label} must name tile {tile_id} and list its join gaps')
    return not minimap_manifest['gaps']


def tile_resource_is_converted(resource, tile_id, store_roots):
    if resource['kind'] == MINIMAP_RESOURCE_KIND:
        return minimap_join_is_resolved(resource, tile_id, store_roots)
    return True


def converted_tile_derived_keys(tile_id, manifest, store_roots):
    converted_kinds = {resource['kind'] for resource in manifest['resources'] if tile_resource_is_converted(resource, tile_id, store_roots)}
    return {f'{kind}:{tile_id}' for kind, derived_part in DERIVED_PARTS.items()
            if derived_part.source_key_kind == TILE_KEY_KIND and derived_part.tile_resource_kind in converted_kinds}


def derived_converted_keys(store_root, catalog, shared_store_root=None):
    store_roots = store_root_candidates(store_root, shared_store_root)
    tile_records = validated_slice_records(catalog, 'tiles')
    vocabulary = load_tile_manifest_vocabulary() if tile_records else None
    return {key for record in tile_records
            for key in converted_tile_derived_keys(record['id'], pinned_tile_manifest(record, store_roots, vocabulary), store_roots)}


def rows_by_source_key(source_rows):
    rows_by_key = {}
    for row in source_rows:
        if row['part'] in DERIVED_SOURCE_PARTS:
            rows_by_key.setdefault((row['part'], row['key']), []).append(row)
    return rows_by_key


def rekeyed_row(row, key, part):
    return {**row, 'key': key, 'part': part}


def step_pending_row(key, part, step, anchor_row):
    return {'key': key, 'part': part, 'step': step, 'status': 'pending', 'reason': f'{STEP_PENDING_REASON_PREFIX}{step}',
            'sourceIdentity': dict(anchor_row['sourceIdentity']), 'evidence': anchor_row['evidence']}


def source_anchor_row(source_rows, source_key, derived_key):
    anchor_rows = [row for row in source_rows if row['step'] == SOURCE_ANCHOR_STEP]
    if len(anchor_rows) != 1:
        raise CoverageReportError(f'{derived_key} needs exactly one {SOURCE_ANCHOR_STEP} row of {source_key} to state a pending step; '
                                  f'found {len(anchor_rows)}')
    return anchor_rows[0]


def derived_key_rows(key, derived_part, source_rows_by_key):
    source_key = f'{derived_part.source_key_kind}:{key_suffix(key)}'
    source_rows = source_rows_by_key.get((derived_part.source_part, source_key), [])
    step_rows = [rekeyed_row(row, key, derived_part.part) for row in source_rows if row['step'] == derived_part.source_step]
    if step_rows:
        return step_rows
    return [step_pending_row(key, derived_part.part, derived_part.source_step, source_anchor_row(source_rows, source_key, key))]


def derived_part_rows(denominators, source_rows):
    source_rows_by_key = rows_by_source_key(source_rows)
    rows = []
    for kind, derived_part in DERIVED_PARTS.items():
        denominator = denominators.get(derived_part.part)
        if denominator is None or denominator['keys'] is None:
            continue
        for key in denominator['keys']:
            if key_kind(key) == kind:
                rows.extend(derived_key_rows(key, derived_part, source_rows_by_key))
    return rows
