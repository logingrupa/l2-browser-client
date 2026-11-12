from __future__ import annotations

import json
import math
from pathlib import Path
import re
from types import MappingProxyType
from typing import NamedTuple

from native_store.catalog_writer import (TILE_ID_PATTERN, TILE_MANIFEST_MAXIMUM_BYTES, is_safe_integer, refuse_duplicate_json_keys,
                                         refuse_non_finite_json_number, require_byte_length, require_pinned_path)
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN as QUALIFIED_OBJECT_PATTERN
from native_store.gap_rows import GapRowError, load_gap_reason_patterns, validate_gap_row
from native_store.store_paths import REPOSITORY_ROOT, SHA256_PATTERN

TILE_MANIFEST_KIND = 'native-tile-runtime'
TILE_CHUNK_MANIFEST_KIND = 'native-tile-chunk-runtime'
TILE_MANIFEST_SCHEMA_VERSION = 1
VOCABULARY_SCHEMA_VERSION = 1
CHUNK_ID_PATTERN = re.compile(r'^chunk-(\d{1,3})-(\d{1,3})$')
CHUNK_SECTOR_SPAN = 4
MAXIMUM_TILE_CHUNKS = 256
TILE_RESOURCE_KINDS_BASE = ()
MASK_UV_RULES_BASE = ('extrapolated',)
VOCABULARY_FILE = 'recipes/world/tile-manifest-vocabulary.json'
VOCABULARY_FIELDS = ('schemaVersion', 'listVersion', 'resourceKinds', 'maskUvRules')
TILE_MANIFEST_FIELDS = ('kind', 'schemaVersion', 'tileId', 'sourceMap', 'sourceSha256', 'frame', 'anchor', 'chunks', 'resources', 'gaps')
TILE_CHUNK_MANIFEST_FIELDS = ('kind', 'schemaVersion', 'tileId', 'chunkId', 'sectorRange', 'terrain', 'models', 'bsp', 'collision', 'gaps')
FRAME_FIELDS = ('terrainInfo', 'location', 'terrainScale')
ANCHOR_FIELDS = ('playerStart', 'location')
CHUNK_RECORD_FIELDS = ('chunkId', 'manifest', 'manifestSha256', 'manifestBytes')
TILE_RESOURCE_FIELDS = ('kind', 'manifest', 'manifestSha256', 'manifestBytes')
SECTOR_RANGE_FIELDS = ('firstColumn', 'lastColumn', 'firstRow', 'lastRow')
TERRAIN_COMPONENT_FIELDS = ('resource', 'sha256', 'maskUvRule')
COMPONENT_RESOURCE_FIELDS = ('resource', 'sha256')
MODEL_FIELDS = ('id', 'archive', 'archiveSha256', 'placements')
PLACEMENT_FIELDS = ('id', 'modelId', 'sourceActor', 'exportIndex', 'sourceMesh', 'matrix', 'materialOverrides', 'collision')
NULLABLE_CHUNK_COMPONENT_STEPS = ('terrain', 'bsp', 'collision')
TILE_RESOURCE_MAXIMUM_BYTES = 128 * 1024 * 1024
SHA256_PLACEHOLDER = '<sha256>'
TILE_RESOURCE_PATH_TEMPLATES = MappingProxyType({
    'native-tile-collision': '/l2/maps/<sha256>/native-tile-collision/asset.json',
    'movers': '/l2/movers/<sha256>/tile-movers.json',
    'bsp-visibility': '/l2/maps/<sha256>/native-tile-bsp-visibility/asset.json',
    'map-emitters': '/l2/map-emitters/<sha256>/tile-emitters.json',
    'sky': '/l2/skies/<sha256>/manifest.json',
    'world-audio': '/l2/world-audio/<sha256>/manifest.json',
    'lighting': '/l2/maps/<sha256>/native-tile-lighting/asset.json',
    'minimap': '/l2/maps/<sha256>/native-tile-minimap/manifest.json',
    'surface-materials': '/l2/native-materials/surface-materials-<sha256>.json',
})
REPEATABLE_TILE_RESOURCE_KINDS = frozenset({'world-audio'})
CHUNK_MANIFEST_PATH_TEMPLATE = '/l2/maps/<sha256>/native-tile-chunk-runtime/manifest.json'
CHUNK_COMPONENT_PATH_TEMPLATES = MappingProxyType({'terrain': '/l2/maps/<sha256>/native-tile-chunk-terrain/terrain.glb',
                                                   'bsp': '/l2/maps/<sha256>/native-tile-chunk-bsp/bsp.glb',
                                                   'collision': '/l2/maps/<sha256>/native-tile-chunk-collision/asset.json'})
MODEL_ARCHIVE_PATH_TEMPLATE = '/l2/<sha256>/asset.l2asset'
MAXIMUM_CHUNK_MODELS = 1024
MAXIMUM_CHUNK_PLACEMENTS = 4096
PLACEMENT_MATRIX_LENGTH = 16
AFFINE_BOTTOM_ROW_INDICES = (3, 7, 11)
AFFINE_CORNER_INDEX = 15
MINIMUM_PLACEMENT_DETERMINANT = 1e-12


def hash_addressed_path_pattern(template):
    return re.compile('^' + re.escape(template).replace(re.escape(SHA256_PLACEHOLDER), '(?P<sha256>[a-f0-9]{64})') + '$')


TILE_RESOURCE_PATH_PATTERNS = MappingProxyType({kind: hash_addressed_path_pattern(template) for kind, template in TILE_RESOURCE_PATH_TEMPLATES.items()})
CHUNK_MANIFEST_PATH_PATTERN = hash_addressed_path_pattern(CHUNK_MANIFEST_PATH_TEMPLATE)
CHUNK_COMPONENT_PATH_PATTERNS = MappingProxyType({step: hash_addressed_path_pattern(template) for step, template in CHUNK_COMPONENT_PATH_TEMPLATES.items()})
MODEL_ARCHIVE_PATH_PATTERN = hash_addressed_path_pattern(MODEL_ARCHIVE_PATH_TEMPLATE)


class TileManifestError(ValueError):
    pass


class TileManifestVocabulary(NamedTuple):
    resource_kinds: frozenset
    mask_uv_rules: frozenset


def require_exact_keys(value, fields, label):
    if not isinstance(value, dict):
        raise TileManifestError(f'{label} must be an object holding {", ".join(fields)}: {value!r}')
    if set(value) != set(fields):
        raise TileManifestError(f'{label} must hold exactly {", ".join(fields)}: {", ".join(sorted(value))}')
    return value


def require_vector3(value, label):
    if not (isinstance(value, list) and len(value) == 3
            and all(type(component) in (int, float) and math.isfinite(component) for component in value)):
        raise TileManifestError(f'{label} must be a list of three finite numbers: {value!r}')
    return value


def require_qualified_object(value, label):
    if not (isinstance(value, str) and QUALIFIED_OBJECT_PATTERN.fullmatch(value)):
        raise TileManifestError(f'{label} must be a qualified object name: {value!r}')
    return value


def require_manifest_kind(manifest, fields, kind, label):
    require_exact_keys(manifest, fields, label)
    if manifest['kind'] != kind:
        raise TileManifestError(f'{label} kind must be {kind}: {manifest["kind"]!r}')
    if not (type(manifest['schemaVersion']) is int and manifest['schemaVersion'] == TILE_MANIFEST_SCHEMA_VERSION):
        raise TileManifestError(f'{label} schemaVersion must be {TILE_MANIFEST_SCHEMA_VERSION}: {manifest["schemaVersion"]!r}')
    if not (isinstance(manifest['tileId'], str) and TILE_ID_PATTERN.fullmatch(manifest['tileId'])):
        raise TileManifestError(f'{label} tileId must match {TILE_ID_PATTERN.pattern}: {manifest["tileId"]!r}')
    return manifest['tileId']


def require_pinned_manifest_entry(entry, path_pattern, maximum_bytes, label):
    require_pinned_path(entry['manifest'], entry['manifestSha256'], path_pattern, TileManifestError, f'{label} manifest')
    require_byte_length(entry['manifestBytes'], maximum_bytes, TileManifestError, f'{label} manifest')


def read_vocabulary_entries(document, list_name, base_entries, vocabulary_path):
    entries = document[list_name]
    if not isinstance(entries, list):
        raise TileManifestError(f'tile manifest vocabulary {list_name} must be a list: {vocabulary_path}')
    seen_entries = set()
    for entry in entries:
        if not (isinstance(entry, str) and entry):
            raise TileManifestError(f'tile manifest vocabulary {list_name} entry must be a non-empty string: {entry!r} in {vocabulary_path}')
        if entry in base_entries:
            raise TileManifestError(f'tile manifest vocabulary {list_name} entry {entry} repeats a base entry: {vocabulary_path}')
        if entry in seen_entries:
            raise TileManifestError(f'tile manifest vocabulary {list_name} entry {entry} is listed twice: {vocabulary_path}')
        seen_entries.add(entry)
    return frozenset((*base_entries, *entries))


def load_tile_manifest_vocabulary(repository_root=REPOSITORY_ROOT):
    vocabulary_path = Path(repository_root) / VOCABULARY_FILE
    if not vocabulary_path.is_file():
        raise TileManifestError(f'tile manifest vocabulary file missing: {vocabulary_path}')
    try:
        document = json.loads(vocabulary_path.read_text(encoding='utf-8'), object_pairs_hook=refuse_duplicate_json_keys,
                              parse_constant=refuse_non_finite_json_number)
    except ValueError as error:
        raise TileManifestError(f'tile manifest vocabulary is not JSON: {vocabulary_path}: {error}') from error
    require_exact_keys(document, VOCABULARY_FIELDS, f'tile manifest vocabulary {vocabulary_path}')
    if not (type(document['schemaVersion']) is int and document['schemaVersion'] == VOCABULARY_SCHEMA_VERSION):
        raise TileManifestError(f'tile manifest vocabulary schemaVersion must be {VOCABULARY_SCHEMA_VERSION}: {vocabulary_path}')
    if not (type(document['listVersion']) is int and document['listVersion'] >= 1):
        raise TileManifestError(f'tile manifest vocabulary listVersion must be an integer of at least 1: {vocabulary_path}')
    resource_kinds = read_vocabulary_entries(document, 'resourceKinds', TILE_RESOURCE_KINDS_BASE, vocabulary_path)
    untemplated_kinds = sorted(resource_kinds - set(TILE_RESOURCE_PATH_TEMPLATES))
    if untemplated_kinds:
        raise TileManifestError(f'tile manifest vocabulary resource kinds have no path template: {", ".join(untemplated_kinds)} in {vocabulary_path}')
    return TileManifestVocabulary(resource_kinds, read_vocabulary_entries(document, 'maskUvRules', MASK_UV_RULES_BASE, vocabulary_path))


def require_gap_rows(gaps, tile_id, label):
    if not isinstance(gaps, list):
        raise TileManifestError(f'{label} gaps must be a list of gap rows: {gaps!r}')
    reason_patterns = load_gap_reason_patterns() if gaps else {}
    steps = []
    for row in gaps:
        try:
            validate_gap_row(row, reason_patterns)
        except GapRowError as error:
            raise TileManifestError(f'{label} gap row is invalid: {error}') from error
        if row['key'] != f'tile:{tile_id}':
            raise TileManifestError(f'{label} gap row must be keyed tile:{tile_id}: {row["key"]}')
        steps.append(row['step'])
    if len(set(steps)) != len(steps):
        raise TileManifestError(f'{label} gap rows repeat a step: {", ".join(steps)}')
    if steps != sorted(steps):
        raise TileManifestError(f'{label} gap rows must be sorted by step: {", ".join(steps)}')
    return {row['step']: row for row in gaps}


def chunk_grid_position(chunk_id, label):
    match = CHUNK_ID_PATTERN.fullmatch(chunk_id) if isinstance(chunk_id, str) else None
    if match is None:
        raise TileManifestError(f'{label} chunkId must match {CHUNK_ID_PATTERN.pattern}: {chunk_id!r}')
    return int(match[1]), int(match[2])


def require_chunk_records(chunks, label):
    if not (isinstance(chunks, list) and chunks):
        raise TileManifestError(f'{label} needs at least one chunk; a tile without chunks is a gap row, not a manifest')
    if len(chunks) > MAXIMUM_TILE_CHUNKS:
        raise TileManifestError(f'{label} lists {len(chunks)} chunks; the bound is {MAXIMUM_TILE_CHUNKS}')
    positions = []
    for chunk in chunks:
        require_exact_keys(chunk, CHUNK_RECORD_FIELDS, f'{label} chunk record')
        position = chunk_grid_position(chunk['chunkId'], f'{label} chunk record')
        if position in positions:
            raise TileManifestError(f'{label} lists chunk {chunk["chunkId"]} twice')
        require_pinned_manifest_entry(chunk, CHUNK_MANIFEST_PATH_PATTERN, TILE_MANIFEST_MAXIMUM_BYTES, f'{label} chunk {chunk["chunkId"]}')
        positions.append(position)
    if positions != sorted(positions):
        raise TileManifestError(f'{label} chunks must be sorted by (column, row)')


def require_tile_resources(resources, resource_kinds, label):
    if not isinstance(resources, list):
        raise TileManifestError(f'{label} resources must be a list: {resources!r}')
    order_keys = []
    for resource in resources:
        require_exact_keys(resource, TILE_RESOURCE_FIELDS, f'{label} resource')
        if resource['kind'] not in resource_kinds:
            known_kinds = ', '.join(sorted(resource_kinds)) or 'none'
            raise TileManifestError(f'{label} resource kind {resource["kind"]!r} is not in the tile manifest vocabulary ({known_kinds})')
        if resource['kind'] not in REPEATABLE_TILE_RESOURCE_KINDS and any(kind == resource['kind'] for kind, _ in order_keys):
            raise TileManifestError(f'{label} lists more than one {resource["kind"]} resource')
        require_pinned_manifest_entry(resource, TILE_RESOURCE_PATH_PATTERNS[resource['kind']], TILE_RESOURCE_MAXIMUM_BYTES,
                                      f'{label} {resource["kind"]} resource')
        order_key = (resource['kind'], resource['manifest'])
        if order_key in order_keys:
            raise TileManifestError(f'{label} lists the {resource["kind"]} resource {resource["manifest"]} twice')
        order_keys.append(order_key)
    if order_keys != sorted(order_keys):
        raise TileManifestError(f'{label} resources must be sorted by (kind, manifest)')


def validate_tile_manifest(manifest, vocabulary=None):
    tile_id = require_manifest_kind(manifest, TILE_MANIFEST_FIELDS, TILE_MANIFEST_KIND, 'tile manifest')
    label = f'tile manifest {tile_id}'
    resource_kinds = (vocabulary or load_tile_manifest_vocabulary()).resource_kinds
    if manifest['sourceMap'] != f'maps/{tile_id}.unr':
        raise TileManifestError(f'{label} sourceMap must be maps/{tile_id}.unr: {manifest["sourceMap"]!r}')
    if not (isinstance(manifest['sourceSha256'], str) and SHA256_PATTERN.fullmatch(manifest['sourceSha256'])):
        raise TileManifestError(f'{label} sourceSha256 must be 64 lowercase hex characters: {manifest["sourceSha256"]!r}')
    frame = require_exact_keys(manifest['frame'], FRAME_FIELDS, f'{label} frame')
    require_qualified_object(frame['terrainInfo'], f'{label} frame terrainInfo')
    require_vector3(frame['location'], f'{label} frame location')
    require_vector3(frame['terrainScale'], f'{label} frame terrainScale')
    anchor = require_exact_keys(manifest['anchor'], ANCHOR_FIELDS, f'{label} anchor')
    require_qualified_object(anchor['playerStart'], f'{label} anchor playerStart')
    require_vector3(anchor['location'], f'{label} anchor location')
    require_chunk_records(manifest['chunks'], label)
    require_tile_resources(manifest['resources'], resource_kinds, label)
    require_gap_rows(manifest['gaps'], tile_id, label)
    return manifest


def require_sector_range(sector_range, chunk_position, label):
    require_exact_keys(sector_range, SECTOR_RANGE_FIELDS, f'{label} sectorRange')
    if not all(type(sector_range[field]) is int and sector_range[field] >= 0 for field in SECTOR_RANGE_FIELDS):
        raise TileManifestError(f'{label} sectorRange bounds must be integers of at least 0: {sector_range!r}')
    for first_field, last_field, axis_name in (('firstColumn', 'lastColumn', 'column'), ('firstRow', 'lastRow', 'row')):
        first_sector, last_sector = sector_range[first_field], sector_range[last_field]
        if first_sector % CHUNK_SECTOR_SPAN:
            raise TileManifestError(f'{label} sectorRange {first_field} must be a multiple of {CHUNK_SECTOR_SPAN}: {first_sector}')
        if not 1 <= last_sector - first_sector + 1 <= CHUNK_SECTOR_SPAN:
            raise TileManifestError(f'{label} sectorRange must span 1 to {CHUNK_SECTOR_SPAN} sectors per {axis_name}: '
                                    f'{first_field} {first_sector}, {last_field} {last_sector}')
    if (sector_range['firstColumn'] // CHUNK_SECTOR_SPAN, sector_range['firstRow'] // CHUNK_SECTOR_SPAN) != chunk_position:
        raise TileManifestError(f'{label} chunk id must be chunk-<firstColumn / {CHUNK_SECTOR_SPAN}>-<firstRow / {CHUNK_SECTOR_SPAN}>: '
                                f'{sector_range!r}')


def require_component_resource(component, fields, step, label):
    require_exact_keys(component, fields, label)
    require_pinned_path(component['resource'], component['sha256'], CHUNK_COMPONENT_PATH_PATTERNS[step], TileManifestError,
                        f'{label} resource')
    return component


def upper_left_determinant(matrix):
    a, b, c, _, d, e, f, _, g, h, i = matrix[:11]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


def is_affine_placement_matrix(matrix):
    return (isinstance(matrix, list) and len(matrix) == PLACEMENT_MATRIX_LENGTH
            and all(type(component) in (int, float) and math.isfinite(component) for component in matrix)
            and all(matrix[index] == 0 for index in AFFINE_BOTTOM_ROW_INDICES) and matrix[AFFINE_CORNER_INDEX] == 1
            and abs(upper_left_determinant(matrix)) >= MINIMUM_PLACEMENT_DETERMINANT)


def require_chunk_placement(placement, model_id, placement_ids, label):
    require_exact_keys(placement, PLACEMENT_FIELDS, f'{label} placement')
    placement_label = f'{label} placement {placement["id"]!r}'
    if not (isinstance(placement['id'], str) and placement['id']) or placement['id'] in placement_ids:
        raise TileManifestError(f'{placement_label} id must be a non-empty string listed once in the chunk')
    if placement['modelId'] != model_id:
        raise TileManifestError(f'{placement_label} modelId must be its model {model_id}: {placement["modelId"]!r}')
    require_qualified_object(placement['sourceActor'], f'{placement_label} sourceActor')
    if not is_safe_integer(placement['exportIndex'], 1):
        raise TileManifestError(f'{placement_label} exportIndex must be a safe integer of at least 1: {placement["exportIndex"]!r}')
    if not (isinstance(placement['sourceMesh'], str) and placement['sourceMesh']):
        raise TileManifestError(f'{placement_label} sourceMesh must be a non-empty string: {placement["sourceMesh"]!r}')
    if not is_affine_placement_matrix(placement['matrix']):
        raise TileManifestError(f'{placement_label} matrix must be 16 finite numbers of an invertible affine transform: {placement["matrix"]!r}')
    if placement['materialOverrides'] != []:
        raise TileManifestError(f'{placement_label} materialOverrides must be an empty list: {placement["materialOverrides"]!r}')
    if not isinstance(placement['collision'], dict):
        raise TileManifestError(f'{placement_label} collision must be an object: {placement["collision"]!r}')
    placement_ids.add(placement['id'])


def require_chunk_models(models, label):
    if not (isinstance(models, list) and len(models) <= MAXIMUM_CHUNK_MODELS):
        raise TileManifestError(f'{label} models must be a list of at most {MAXIMUM_CHUNK_MODELS} models')
    model_ids, placement_ids = set(), set()
    for model in models:
        require_exact_keys(model, MODEL_FIELDS, f'{label} model')
        if not (isinstance(model['id'], str) and model['id']):
            raise TileManifestError(f'{label} model id must be a non-empty string: {model["id"]!r}')
        if model['id'] in model_ids:
            raise TileManifestError(f'{label} lists model {model["id"]} twice')
        model_ids.add(model['id'])
        require_pinned_path(model['archive'], model['archiveSha256'], MODEL_ARCHIVE_PATH_PATTERN, TileManifestError,
                            f'{label} model {model["id"]} archive')
        if not (isinstance(model['placements'], list) and model['placements']):
            raise TileManifestError(f'{label} model {model["id"]} placements must be a non-empty list: {model["placements"]!r}')
        for placement in model['placements']:
            require_chunk_placement(placement, model['id'], placement_ids, label)
    if len(placement_ids) > MAXIMUM_CHUNK_PLACEMENTS:
        raise TileManifestError(f'{label} lists {len(placement_ids)} placements; the bound is {MAXIMUM_CHUNK_PLACEMENTS}')


def validate_tile_chunk_manifest(manifest, vocabulary=None):
    tile_id = require_manifest_kind(manifest, TILE_CHUNK_MANIFEST_FIELDS, TILE_CHUNK_MANIFEST_KIND, 'tile chunk manifest')
    chunk_position = chunk_grid_position(manifest['chunkId'], f'tile chunk manifest {tile_id}')
    label = f'tile chunk manifest {tile_id} {manifest["chunkId"]}'
    mask_uv_rules = (vocabulary or load_tile_manifest_vocabulary()).mask_uv_rules
    require_sector_range(manifest['sectorRange'], chunk_position, label)
    gap_rows_by_step = require_gap_rows(manifest['gaps'], tile_id, label)
    for step in NULLABLE_CHUNK_COMPONENT_STEPS:
        if manifest[step] is None:
            gap_row = gap_rows_by_step.get(step)
            if gap_row is None or gap_row['status'] == 'pass':
                raise TileManifestError(f'{label} has no {step}; it needs a {step} gap row whose status is not pass')
    if manifest['terrain'] is not None:
        terrain = require_component_resource(manifest['terrain'], TERRAIN_COMPONENT_FIELDS, 'terrain', f'{label} terrain')
        if terrain['maskUvRule'] not in mask_uv_rules:
            raise TileManifestError(f'{label} terrain maskUvRule {terrain["maskUvRule"]!r} is not in the tile manifest vocabulary '
                                    f'({", ".join(sorted(mask_uv_rules))})')
    for step in ('bsp', 'collision'):
        if manifest[step] is not None:
            require_component_resource(manifest[step], COMPONENT_RESOURCE_FIELDS, step, f'{label} {step}')
    require_chunk_models(manifest['models'], label)
    return manifest
