from __future__ import annotations

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_index_keys import (ITEM_MODEL_RECORD_ID_PATTERN, LEGACY_SECTION_ID_PATTERN, SINGLE_RECORD_KEY_PREFIX_BY_SLICE,
                                             SKILL_EFFECT_COMPONENT_ID_PATTERN,
                                             catalog_index_keys, legacy_single_mesh_candidate_model_ids_by_source_object,
                                             model_source_objects_by_id,
                                             npc_profile_model_id, npc_profile_npc_key, player_profile_model_ids_by_key,
                                             read_profile_manifest_profiles, require_key, store_root_candidates, validated_slice_records)
from native_store.catalog_writer import sha256_hex
from native_store.coverage_denominators import CoverageReportError
from native_store.store_paths import SHA256_PATTERN

CONTENT_PIN_FIELDS = ('manifestSha256', 'archiveSha256', 'modelSha256', 'imageSha256')


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


def attributed_record_entry(slice_name, record, profile=None):
    pins = {field: require_pinned_sha256(record, slice_name, field) for field in CONTENT_PIN_FIELDS if field in record}
    if not pins:
        raise CoverageReportError(f'catalog {slice_name} record {record["id"]} has no pinned SHA-256 among {", ".join(CONTENT_PIN_FIELDS)}')
    entry = {'slice': slice_name, 'id': record['id'], 'pins': pins}
    return entry if profile is None else {**entry, 'profile': profile}


class AttributedRecords:
    def __init__(self):
        self.entries_by_key = {}

    def add(self, key, entry):
        self.entries_by_key.setdefault(key, {})[canonical_json_bytes(entry)] = entry

    def content_sha256(self, key):
        if key not in self.entries_by_key:
            raise CoverageReportError(f'key {key} is a catalog index key, but no catalog record is attributed to it')
        entries = self.entries_by_key[key]
        return sha256_hex(canonical_json_bytes([entries[entry_bytes] for entry_bytes in sorted(entries)]))


def attribute_npc_records(attributed_records, catalog, models_by_id, store_roots):
    source_objects_by_model_id = model_source_objects_by_id(models_by_id.values())
    model_ids_by_object = legacy_single_mesh_candidate_model_ids_by_source_object(source_objects_by_model_id)
    for pack_record in validated_slice_records(catalog, 'npcProfiles'):
        for profile in read_profile_manifest_profiles('npcProfiles', pack_record, store_roots):
            model_id = npc_profile_model_id(pack_record['id'], profile, source_objects_by_model_id, model_ids_by_object)
            if model_id is not None:
                key = npc_profile_npc_key(profile)
                attributed_records.add(key, attributed_record_entry('npcProfiles', pack_record, profile))
                attributed_records.add(key, attributed_record_entry('models', models_by_id[model_id]))


def attribute_player_records(attributed_records, catalog, models_by_id, store_roots):
    for pack_record in validated_slice_records(catalog, 'playerProfiles'):
        for profile in read_profile_manifest_profiles('playerProfiles', pack_record, store_roots):
            for key, model_ids in player_profile_model_ids_by_key(profile, models_by_id).items():
                if key.startswith('character:'):
                    attributed_records.add(key, attributed_record_entry('playerProfiles', pack_record, profile))
                for model_id in model_ids:
                    attributed_records.add(key, attributed_record_entry('models', models_by_id[model_id]))


def attribute_item_model_records(attributed_records, models_by_id):
    for model in models_by_id.values():
        match = ITEM_MODEL_RECORD_ID_PATTERN.fullmatch(model['id'])
        if match:
            attributed_records.add(require_key(f'item:{match["item"]}', 'item', 'item model record id'), attributed_record_entry('models', model))


def attribute_skill_effect_component_records(attributed_records, catalog):
    for record in validated_slice_records(catalog, 'effectComponents'):
        match = SKILL_EFFECT_COMPONENT_ID_PATTERN.match(record['id'])
        if match:
            key = require_key(f'skill:{match["skill"]}:{match["level"]}', 'skill', 'effect component id')
            attributed_records.add(key, attributed_record_entry('effectComponents', record))


def models_by_record_id(catalog):
    models_by_id = {}
    for model in validated_slice_records(catalog, 'models'):
        if model['id'] in models_by_id:
            raise CoverageReportError(f'catalog models list model {model["id"]} twice')
        models_by_id[model['id']] = model
    return models_by_id


def key_content_sha256_by_key(store_root, catalog, shared_store_root=None):
    single_record_digests = single_record_manifest_sha256_by_key(catalog)
    models_by_id = models_by_record_id(catalog)
    store_roots = store_root_candidates(store_root, shared_store_root)
    attributed_records = AttributedRecords()
    attribute_npc_records(attributed_records, catalog, models_by_id, store_roots)
    attribute_player_records(attributed_records, catalog, models_by_id, store_roots)
    attribute_item_model_records(attributed_records, models_by_id)
    attribute_skill_effect_component_records(attributed_records, catalog)
    return {key: single_record_digests[key] if key in single_record_digests else attributed_records.content_sha256(key)
            for key in catalog_index_keys(store_root, catalog, shared_store_root)}
