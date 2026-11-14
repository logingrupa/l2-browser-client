from __future__ import annotations

import json
import os
from pathlib import Path
import re

from native_store.catalog_writer import (MAXIMUM_CATALOG_BYTES, MAXIMUM_SAFE_INTEGER, STORE_CATALOG_NAME, CatalogWriteError,
                                         decode_store_catalog, refuse_duplicate_json_keys, refuse_non_finite_json_number, require_byte_length,
                                         require_pinned_path, sha256_hex, validate_catalog_record)
from native_store.coverage_denominators import CoverageReportError
from native_store.gap_rows import CATALOG_KEY_PATTERNS

NATIVE_RESOURCE_PREFIX = '/l2/'
PROFILE_MANIFEST_SCHEMA_VERSION = 1
PROFILE_MANIFEST_KINDS = {'npcProfiles': 'native-npc-profiles', 'playerProfiles': 'native-player-profiles'}
PROFILE_MANIFEST_PATH_PATTERNS = {
    'npcProfiles': re.compile(r'^/l2/npc-profiles/(?P<sha256>[a-f0-9]{64})/manifest\.json$'),
    'playerProfiles': re.compile(r'^/l2/player-profiles/(?P<sha256>[a-f0-9]{64})/manifest\.json$'),
}
NPC_MODEL_CATALOG_ID_PATTERN = re.compile(r'^npc-model:[a-f0-9]{64}$')
SHARED_STORE_NPC_PROFILE_RECORD_ID = 'native-npc-profiles'
ITEM_MODEL_RECORD_ID_PATTERN = re.compile(r'^interlude:item:(?P<item>0|[1-9]\d{0,8}):body-part:(?:0|[1-9]\d{0,8}):(?:weapon|armor:(?:0|[1-9]\d{0,8}))$')
SKILL_EFFECT_COMPONENT_ID_PATTERN = re.compile(r'^interlude:skill:(?P<skill>\d{1,9}):level:(?P<level>[1-9]\d{0,3}):')
LEGACY_SECTION_ID_PATTERN = re.compile(r'^map-(?P<column>\d{2})-(?P<row>\d{2})-section$')
CHARACTER_MODEL_RECORD_ID_PREFIX = 'character-model:'
CHARACTER_MODEL_RECORD_ID_PATTERN = re.compile('^' + re.escape(CHARACTER_MODEL_RECORD_ID_PREFIX) + r'(?P<character>0|[1-9]\d{0,3})$')
SINGLE_RECORD_KEY_PREFIX_BY_SLICE = {'tiles': 'tile', 'windows': 'window', 'tables': 'table'}


def character_model_record_id(chargrp_index):
    return f'{CHARACTER_MODEL_RECORD_ID_PREFIX}{chargrp_index}'


def model_record_unit_key(record_id):
    item_match = ITEM_MODEL_RECORD_ID_PATTERN.fullmatch(record_id)
    if item_match:
        return f'item:{item_match["item"]}'
    character_match = CHARACTER_MODEL_RECORD_ID_PATTERN.fullmatch(record_id)
    return f'character:{character_match["character"]}' if character_match else None


def catalog_record_unit_key(slice_name, record_id):
    if slice_name in SINGLE_RECORD_KEY_PREFIX_BY_SLICE:
        return f'{SINGLE_RECORD_KEY_PREFIX_BY_SLICE[slice_name]}:{record_id}'
    if slice_name == 'models':
        return model_record_unit_key(record_id)
    section_match = LEGACY_SECTION_ID_PATTERN.fullmatch(record_id) if slice_name == 'sections' else None
    if section_match:
        return f'tile:{section_match["column"]}_{section_match["row"]}'
    skill_match = SKILL_EFFECT_COMPONENT_ID_PATTERN.match(record_id) if slice_name == 'effectComponents' else None
    return f'skill:{skill_match["skill"]}:{skill_match["level"]}' if skill_match else None


def read_measured_catalog(store_root):
    catalog_path = Path(store_root) / STORE_CATALOG_NAME
    if not catalog_path.is_file():
        raise CoverageReportError(f'measured store has no catalog: {catalog_path}')
    with open(catalog_path, 'rb') as stream:
        payload = stream.read(MAXIMUM_CATALOG_BYTES + 1)
    if len(payload) > MAXIMUM_CATALOG_BYTES:
        raise CoverageReportError(f'measured catalog exceeds {MAXIMUM_CATALOG_BYTES} bytes: {catalog_path}')
    try:
        return decode_store_catalog(payload), sha256_hex(payload)
    except (CatalogWriteError, ValueError) as error:
        raise CoverageReportError(f'measured catalog is not a native catalog: {catalog_path}: {error}') from error


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


def model_source_objects_by_id(models):
    source_objects_by_model_id = {}
    for model in models:
        if model['id'] in source_objects_by_model_id:
            raise CoverageReportError(f'catalog models list model {model["id"]} twice')
        source = model.get('source')
        source_objects_by_model_id[model['id']] = (source['object'] if isinstance(source, dict) and isinstance(source.get('object'), str)
                                                   else None)
    return source_objects_by_model_id


def legacy_single_mesh_candidate_model_ids_by_source_object(source_objects_by_model_id):
    model_ids_by_object = {}
    for model_id, source_object in source_objects_by_model_id.items():
        if source_object is not None and not NPC_MODEL_CATALOG_ID_PATTERN.fullmatch(model_id):
            model_ids_by_object.setdefault(source_object, []).append(model_id)
    return model_ids_by_object


def npc_profile_npc_key(profile):
    npc_id = require_safe_integer(profile.get('npcId'), 'NPC profile npcId')
    return require_key(f'npc:{npc_id}', 'npc', f'NPC profile {npc_id}')


def npc_profile_model_id(pack_record_id, profile, source_objects_by_model_id, model_ids_by_object):
    npc_id = require_safe_integer(profile.get('npcId'), 'NPC profile npcId')
    mesh = profile.get('mesh')
    if not isinstance(mesh, str):
        raise CoverageReportError(f'NPC profile {npc_id} has no mesh name')
    if 'modelCatalogId' in profile:
        model_catalog_id = profile['modelCatalogId']
        if not (isinstance(model_catalog_id, str) and NPC_MODEL_CATALOG_ID_PATTERN.fullmatch(model_catalog_id)):
            raise CoverageReportError(f'NPC profile {npc_id} modelCatalogId must match {NPC_MODEL_CATALOG_ID_PATTERN.pattern}: {model_catalog_id!r}')
        if model_catalog_id not in source_objects_by_model_id:
            return None
        model_source_object = source_objects_by_model_id[model_catalog_id]
        if model_source_object != mesh:
            raise CoverageReportError(f'NPC profile {npc_id} names model {model_catalog_id} of a different mesh: the model source object '
                                      f'is {model_source_object!r}, the profile mesh is {mesh!r}')
        return model_catalog_id
    if pack_record_id != SHARED_STORE_NPC_PROFILE_RECORD_ID:
        raise CoverageReportError(f'NPC profile {npc_id} in bundle {pack_record_id} has no model catalog id')
    matching_model_ids = model_ids_by_object.get(mesh, [])
    return matching_model_ids[0] if len(matching_model_ids) == 1 else None


def npc_keys(catalog, models, store_roots):
    source_objects_by_model_id = model_source_objects_by_id(models)
    model_ids_by_object = legacy_single_mesh_candidate_model_ids_by_source_object(source_objects_by_model_id)
    return {npc_profile_npc_key(profile)
            for pack_record in validated_slice_records(catalog, 'npcProfiles')
            for profile in read_profile_manifest_profiles('npcProfiles', pack_record, store_roots)
            if npc_profile_model_id(pack_record['id'], profile, source_objects_by_model_id, model_ids_by_object) is not None}


def require_npc_profiles_join_models_of_their_mesh(lane_store_root, lane_catalog, shared_store_root):
    shared_catalog, _ = read_measured_catalog(shared_store_root)
    served_models_by_id = {model['id']: model for catalog in (shared_catalog, lane_catalog) for model in validated_slice_records(catalog, 'models')}
    npc_keys(lane_catalog, list(served_models_by_id.values()), store_root_candidates(lane_store_root, shared_store_root))


def player_profile_model_ids_by_key(profile, model_ids):
    model_ids_by_key = {}
    upper_items = profile.get('upperItems', [])
    if not (isinstance(upper_items, list) and all(isinstance(item, dict) for item in upper_items)):
        raise CoverageReportError(f'player profile {profile.get("id")!r} upperItems must be a list of objects')
    for item in upper_items:
        item_id = require_safe_integer(item.get('itemId'), f'player profile {profile.get("id")!r} upper item itemId')
        if item.get('catalogId') in model_ids:
            key = require_key(f'item:{item_id}', 'item', f'player profile {profile.get("id")!r} upper item')
            model_ids_by_key.setdefault(key, set()).add(item['catalogId'])
    if 'chargrpIndex' in profile:
        chargrp_index = require_safe_integer(profile['chargrpIndex'], f'player profile {profile.get("id")!r} chargrpIndex')
        if profile.get('catalogId') in model_ids:
            key = require_key(f'character:{chargrp_index}', 'character', f'player profile {profile.get("id")!r}')
            model_ids_by_key.setdefault(key, set()).add(profile['catalogId'])
    return model_ids_by_key


def player_keys(catalog, models, store_roots):
    model_ids = {model['id'] for model in models}
    return {key for profile in staged_profiles(catalog, 'playerProfiles', store_roots)
            for key in player_profile_model_ids_by_key(profile, model_ids)}


def item_model_keys(models):
    matches = (ITEM_MODEL_RECORD_ID_PATTERN.fullmatch(model['id']) for model in models)
    return {require_key(f'item:{match["item"]}', 'item', 'item model record id') for match in matches if match}


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
    keys |= npc_keys(catalog, models, store_roots) | player_keys(catalog, models, store_roots) | item_model_keys(models) | skill_keys(catalog)
    return tuple(sorted(keys))
