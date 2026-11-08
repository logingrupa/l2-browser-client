from __future__ import annotations

import json
import os
from pathlib import Path
import re

from native_store.catalog_writer import (MAXIMUM_CATALOG_BYTES, MAXIMUM_SAFE_INTEGER, CatalogWriteError, refuse_duplicate_json_keys,
                                         refuse_non_finite_json_number, require_byte_length, require_pinned_path, sha256_hex,
                                         validate_catalog_record)
from native_store.coverage_denominators import CoverageReportError
from native_store.gap_rows import CATALOG_KEY_PATTERNS

NATIVE_RESOURCE_PREFIX = '/l2/'
PROFILE_MANIFEST_SCHEMA_VERSION = 1
PROFILE_MANIFEST_KINDS = {'npcProfiles': 'native-npc-profiles', 'playerProfiles': 'native-player-profiles'}
PROFILE_MANIFEST_PATH_PATTERNS = {
    'npcProfiles': re.compile(r'^/l2/npc-profiles/(?P<sha256>[a-f0-9]{64})/manifest\.json$'),
    'playerProfiles': re.compile(r'^/l2/player-profiles/(?P<sha256>[a-f0-9]{64})/manifest\.json$'),
}
MODEL_CATALOG_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9:-]{0,95}$')
SKILL_EFFECT_COMPONENT_ID_PATTERN = re.compile(r'^interlude:skill:(?P<skill>\d{1,9}):level:(?P<level>[1-9]\d{0,3}):')
LEGACY_SECTION_ID_PATTERN = re.compile(r'^map-(?P<column>\d{2})-(?P<row>\d{2})-section$')


def validated_slice_records(catalog, slice_name):
    records = catalog.get(slice_name, [])
    if not isinstance(records, list):
        raise CoverageReportError(f'catalog slice {slice_name} is not a list')
    for record in records:
        try:
            validate_catalog_record(slice_name, record)
        except CatalogWriteError as error:
            raise CoverageReportError(f'catalog slice {slice_name} holds a refused record: {error}') from error
    return records


def require_safe_integer(value, description):
    if not (type(value) is int and 0 <= value <= MAXIMUM_SAFE_INTEGER):
        raise CoverageReportError(f'{description} must be a safe integer of at least 0: {value!r}')
    return value


def require_key(key, kind, description):
    if not CATALOG_KEY_PATTERNS[kind].fullmatch(key):
        raise CoverageReportError(f'{description} gives {key!r}, which is not a {kind} catalog key')
    return key


def store_root_candidates(store_root, shared_store_root):
    roots = [Path(os.path.realpath(store_root))]
    if shared_store_root is not None and Path(os.path.realpath(shared_store_root)) not in roots:
        roots.append(Path(os.path.realpath(shared_store_root)))
    return roots


def read_manifest_bytes(record, store_roots, label):
    relative_path = record['manifest'][len(NATIVE_RESOURCE_PREFIX):]
    for root in store_roots:
        candidate = Path(os.path.realpath(root / relative_path))
        if candidate.is_relative_to(root) and candidate.is_file():
            with open(candidate, 'rb') as stream:
                payload = stream.read(record['manifestBytes'] + 1)
            if len(payload) != record['manifestBytes'] or sha256_hex(payload) != record['manifestSha256']:
                raise CoverageReportError(f'{label} differs from its pinned SHA-256 or byte length: {candidate}')
            return payload
    raise CoverageReportError(f'{label} {record["manifest"]} is in neither store root: {", ".join(root.as_posix() for root in store_roots)}')


def read_profile_manifest_profiles(slice_name, record, store_roots):
    label = f'catalog {slice_name} record {record["id"]} manifest'
    require_pinned_path(record.get('manifest'), record.get('manifestSha256'), PROFILE_MANIFEST_PATH_PATTERNS[slice_name],
                        CoverageReportError, label)
    require_byte_length(record.get('manifestBytes'), MAXIMUM_CATALOG_BYTES, CoverageReportError, label)
    payload = read_manifest_bytes(record, store_roots, label)
    try:
        manifest = json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise CoverageReportError(f'{label} is not strict JSON: {error}') from error
    if not (isinstance(manifest, dict) and manifest.get('schemaVersion') == PROFILE_MANIFEST_SCHEMA_VERSION
            and manifest.get('kind') == PROFILE_MANIFEST_KINDS[slice_name] and isinstance(manifest.get('profiles'), list)
            and all(isinstance(profile, dict) for profile in manifest['profiles'])):
        raise CoverageReportError(f'{label} must be schemaVersion {PROFILE_MANIFEST_SCHEMA_VERSION} '
                                  f'{PROFILE_MANIFEST_KINDS[slice_name]} with a list of profile objects')
    return manifest['profiles']


def staged_profiles(catalog, slice_name, store_roots):
    return [profile for record in validated_slice_records(catalog, slice_name)
            for profile in read_profile_manifest_profiles(slice_name, record, store_roots)]


def model_ids_by_source_object(models):
    model_ids_by_object = {}
    for model in models:
        source = model.get('source')
        if isinstance(source, dict) and isinstance(source.get('object'), str):
            model_ids_by_object.setdefault(source['object'], []).append(model['id'])
    return model_ids_by_object


def npc_profile_key(profile, model_ids, model_ids_by_object):
    npc_id = require_safe_integer(profile.get('npcId'), 'NPC profile npcId')
    key = require_key(f'npc:{npc_id}', 'npc', f'NPC profile {npc_id}')
    if 'modelCatalogId' in profile:
        model_catalog_id = profile['modelCatalogId']
        if not (isinstance(model_catalog_id, str) and MODEL_CATALOG_ID_PATTERN.fullmatch(model_catalog_id)):
            raise CoverageReportError(f'NPC profile {npc_id} modelCatalogId must match {MODEL_CATALOG_ID_PATTERN.pattern}: {model_catalog_id!r}')
        return key if model_catalog_id in model_ids else None
    mesh = profile.get('mesh')
    if not isinstance(mesh, str):
        raise CoverageReportError(f'NPC profile {npc_id} has neither modelCatalogId nor a mesh name')
    matching_model_ids = sorted(model_ids_by_object.get(mesh, []))
    if len(matching_model_ids) > 1:
        raise CoverageReportError(f'NPC profile {npc_id} mesh {mesh} matches several models: {", ".join(matching_model_ids)}')
    return key if matching_model_ids else None


def npc_keys(catalog, models, store_roots):
    model_ids, model_ids_by_object = {model['id'] for model in models}, model_ids_by_source_object(models)
    keys = {npc_profile_key(profile, model_ids, model_ids_by_object) for profile in staged_profiles(catalog, 'npcProfiles', store_roots)}
    return keys - {None}


def player_profile_keys(profile, model_ids):
    keys = set()
    upper_items = profile.get('upperItems', [])
    if not (isinstance(upper_items, list) and all(isinstance(item, dict) for item in upper_items)):
        raise CoverageReportError(f'player profile {profile.get("id")!r} upperItems must be a list of objects')
    for item in upper_items:
        item_id = require_safe_integer(item.get('itemId'), f'player profile {profile.get("id")!r} upper item itemId')
        if item.get('catalogId') in model_ids:
            keys.add(require_key(f'item:{item_id}', 'item', f'player profile {profile.get("id")!r} upper item'))
    if 'chargrpIndex' in profile:
        chargrp_index = require_safe_integer(profile['chargrpIndex'], f'player profile {profile.get("id")!r} chargrpIndex')
        if profile.get('catalogId') in model_ids:
            keys.add(require_key(f'character:{chargrp_index}', 'character', f'player profile {profile.get("id")!r}'))
    return keys


def player_keys(catalog, models, store_roots):
    model_ids = {model['id'] for model in models}
    return {key for profile in staged_profiles(catalog, 'playerProfiles', store_roots) for key in player_profile_keys(profile, model_ids)}


def skill_keys(catalog):
    matches = (SKILL_EFFECT_COMPONENT_ID_PATTERN.match(record['id']) for record in validated_slice_records(catalog, 'effectComponents'))
    return {require_key(f'skill:{match["skill"]}:{match["level"]}', 'skill', 'effect component id') for match in matches if match}


def tile_keys(catalog):
    keys = {f'tile:{record["id"]}' for record in validated_slice_records(catalog, 'tiles')}
    section_matches = (LEGACY_SECTION_ID_PATTERN.fullmatch(record['id']) for record in validated_slice_records(catalog, 'sections'))
    return keys | {f'tile:{match["column"]}_{match["row"]}' for match in section_matches if match}


def catalog_index_keys(store_root, catalog, shared_store_root=None):
    tables = validated_slice_records(catalog, 'tables')
    windows = validated_slice_records(catalog, 'windows')
    keys = tile_keys(catalog) | {f'table:{record["id"]}' for record in tables} | {f'window:{record["id"]}' for record in windows}
    models = validated_slice_records(catalog, 'models')
    store_roots = store_root_candidates(store_root, shared_store_root)
    keys |= npc_keys(catalog, models, store_roots) | player_keys(catalog, models, store_roots) | skill_keys(catalog)
    return tuple(sorted(keys))
