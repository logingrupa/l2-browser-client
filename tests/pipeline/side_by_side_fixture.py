from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from catalog_store_fixture import model_record, write_profile_manifest, write_store_catalog
from reference_client_guard import (ENGINE_LIBRARY_RELATIVE_PATH, REFERENCE_CLIENT_LOCK_FILE_FIELDS, REFERENCE_CLIENT_LOCK_PATH,
                                    REFERENCE_CLIENT_LOCK_SCHEMA_VERSION, REPOSITORY_ROOT)

FIRST_NPC_ID = 1001
SECOND_NPC_ID = 1002
FIRST_NPC_MESH = 'LineageMonsters.first_mesh'
SECOND_NPC_MESH = 'LineageMonsters.second_mesh'
TWO_PART_ITEM_ID = 57
ONE_PART_ITEM_ID = 58
SKILL_ID = 1011
CHARACTER_CHARGRP_INDEX = 0
UPPER_ITEM_ID = 1146
CATALOG_SHA256 = 'c' * 64
SANDBOX_PNG_SHA256 = 'd' * 64
CAPTURED_AT_RIGA = '2026-11-11T09:00:00+02:00'
SANDBOX_CAPTURED_BY = 'executor:03-07'
NATIVE_CAPTURED_BY = 'executor:03-17'
FRESH_REVIEWER = 'reviewer:agent-7f3a'
JUDGED_AT_RIGA = '2026-11-11T10:00:00+02:00'
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


def effect_component_record(component_id):
    return {**pinned_manifest_record(component_id, 'effects', 'manifest.json'), 'bundleId': f'interlude:skill-root:{component_id}'}


def npc_profile(npc_id, mesh, name):
    return {'id': f'npc:{npc_id}', 'npcId': npc_id, 'name': name, 'mesh': mesh}


def actor_store_catalog(store_root, first_npc_name='First', models=None, effect_components=None):
    npc_profiles_record = write_profile_manifest(store_root, 'native-npc-profiles', [npc_profile(FIRST_NPC_ID, FIRST_NPC_MESH, first_npc_name),
                                                                                       npc_profile(SECOND_NPC_ID, SECOND_NPC_MESH, 'Second')])
    return {**single_record_catalog(), 'models': actor_models() if models is None else models, 'npcProfiles': [npc_profiles_record],
            'effectComponents': skill_effect_components() if effect_components is None else effect_components}


def actor_models():
    return [model_record('npc-model:first', FIRST_NPC_MESH), model_record('npc-model:second', SECOND_NPC_MESH),
            model_record(f'interlude:item:{TWO_PART_ITEM_ID}:body-part:0:weapon', 'LineageWeapons.first_blade'),
            model_record(f'interlude:item:{TWO_PART_ITEM_ID}:body-part:1:armor:3', 'LineageWeapons.first_guard'),
            model_record(f'interlude:item:{ONE_PART_ITEM_ID}:body-part:0:weapon', 'LineageWeapons.second_blade')]


def skill_effect_components():
    return [effect_component_record(f'interlude:skill:{SKILL_ID}:level:10:cast'),
            effect_component_record(f'interlude:skill:{SKILL_ID}:level:10:impact'),
            effect_component_record(f'interlude:skill:{SKILL_ID}:level:11:cast')]


def with_changed_pin(records, record_id, field):
    changed = copy.deepcopy(records)
    for record in changed:
        if record['id'] == record_id:
            record[field] = hashlib.sha256(f'changed:{record[field]}'.encode()).hexdigest()
    return changed


def write_actor_store(store_root, **catalog_changes):
    catalog = actor_store_catalog(store_root, **catalog_changes)
    write_store_catalog(store_root, catalog)
    return catalog


def write_player_store(store_root, character_model_id='character-model:0', upper_item_model_id='character-equipment:0'):
    player_profiles_record = write_profile_manifest(store_root, 'native-player-profiles', [
        {'id': 'player:human-male-fighter', 'chargrpIndex': CHARACTER_CHARGRP_INDEX, 'catalogId': character_model_id,
         'upperItems': [{'itemId': UPPER_ITEM_ID, 'catalogId': upper_item_model_id}]}])
    catalog = {'schemaVersion': 1, 'playerProfiles': [player_profiles_record],
               'models': [model_record('character-model:0', 'LineageFighter.human_male'),
                          model_record('character-equipment:0', 'LineageFighter.human_male_tunic')]}
    write_store_catalog(store_root, catalog)
    return catalog


def tile_native_selection():
    return {'route': 'offline-debug-startup', 'map': '20_20'}


def image_sandbox_half(part, key, key_content_sha256='a' * 64, png_sha256=SANDBOX_PNG_SHA256, captured_at_riga=CAPTURED_AT_RIGA,
                       png_path=None):
    return {'catalogSha256': CATALOG_SHA256, 'keyContentSha256': key_content_sha256,
            'pngPath': png_path or f'artifacts/side-by-side/{part}/sandbox/{key.replace(":", "_")}.png', 'pngSha256': png_sha256,
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


def write_reference_client_lock(project_root):
    lock_path = Path(project_root) / REFERENCE_CLIENT_LOCK_PATH.relative_to(REPOSITORY_ROOT)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    engine_library_sha256 = hashlib.sha256(b'synthetic engine library').hexdigest()
    lock_path.write_bytes(json.dumps({
        'schemaVersion': REFERENCE_CLIENT_LOCK_SCHEMA_VERSION, 'referenceHost': 'IMPORTA-PC', 'referenceRoot': 'C:/Lineage2-client',
        'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
        'files': {ENGINE_LIBRARY_RELATIVE_PATH: ['equal', 24, engine_library_sha256, 24, engine_library_sha256, 0]},
    }).encode('utf-8'))
    return lock_path


def native_half(part, key, reference_tree_lock_sha256, captured_by=NATIVE_CAPTURED_BY):
    return {'referenceTreeLockSha256': reference_tree_lock_sha256,
            'receiptPath': f'artifacts/side-by-side/{part}/native/{key.replace(":", "_")}.json', 'receiptSha256': '1' * 64,
            'pngSha256': '2' * 64, 'windowSize': {'width': 1024, 'height': 768}, 'l2IniSha256Before': '3' * 64,
            'l2IniSha256After': '3' * 64, 'controllerSha256': '4' * 64, 'controlDocumentSha256': '5' * 64, 'capturedBy': captured_by,
            'capturedAtRiga': CAPTURED_AT_RIGA}


def judged_tile_record(verdict, reference_tree_lock_sha256, reviewer=FRESH_REVIEWER, key='tile:20_20'):
    record = unverified_tile_record(key)
    record.update({'verdict': verdict, 'reason': None, 'nativeHalf': native_half('world', key, reference_tree_lock_sha256),
                   'reviewer': reviewer, 'judgedAtRiga': JUDGED_AT_RIGA})
    if verdict == 'mismatch':
        record.update({'difference': 'The sandbox sky is darker than the native sky.', 'suspectedStep': 'environment-program'})
    return record


def audio_record(key='npc:1001', role='combat', source_sha256='6' * 64, clip_sha256='7' * 64):
    return {'key': key, 'role': role, 'sourcePackage': 'SyntheticSounds', 'sourceObject': 'synthetic.attack', 'sourceSha256': source_sha256,
            'verdict': 'unverified', 'reason': 'listen-needs-owner', 'nativeSelection': {'route': 'listen', 'role': role},
            'sandboxHalf': {'catalogSha256': CATALOG_SHA256, 'keyContentSha256': 'a' * 64,
                            'clipPath': f'artifacts/side-by-side/audio/clips/{key.replace(":", "_")}-{role}.wav', 'clipSha256': clip_sha256,
                            'durationSeconds': 1.5, 'peakAboveZero': True, 'capturedBy': 'executor:03-10', 'capturedAtRiga': CAPTURED_AT_RIGA},
            'nativeHalf': None, 'difference': None, 'suspectedStep': None, 'reviewer': None, 'judgedAtRiga': None,
            'sandboxHalfHistory': [], 'displayedTableRows': []}
