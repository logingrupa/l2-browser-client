import copy

from actors.npc_requests import GAP_STATUS, SOUND_IDENTITY_UNRESOLVED_REASON
from native_assets_lib.combat_audio_bundle import ADMITTED, POLICY, RECIPE_KIND
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN

ACTOR_SOUND_BUNDLE_ID_PREFIX = 'actor-sounds:'
ACTOR_SOUND_STEP = 'actor-sounds'
AUDIO_PART_NAME = 'audio'
EMPTY_REFERENCE_STATUS = 'empty'
NPC_NATIVE_NUMERIC_FIELDS = {'soundRadius': 'sound_vol', 'soundVolume': 'sound_radius', 'soundRandom': 'sound_random'}
ACTOR_SOUND_RECIPE_DESCRIPTION = ('Generated actor sound bundle: every role routes to a decoded column only through a route bound from the '
                                  'decoded table descriptor and the pinned static route proof; unbound roles stay out and are gap rows.')
SELECTION_IDENTITY_FIELDS = ('label', 'catalogId', 'sourceObject', 'itemId', 'skillId', 'level')
REFERENCE_COUNT_NAMES = {'exact-identity': 'exactIdentity', 'unique-package-leaf-candidate': 'uniquePackageLeafCandidate'}
NO_EXACT_SKILL_SOUND_ROW_REASON = 'no-exact-skillsound-row'
NPC_NAMES_NO_SOUND_REASON = 'npc-names-no-sound'
SKILL_SOUND_TABLE_NAME = 'skillsoundgrp'


def actor_sound_bundle_id(bundle_key):
    return ACTOR_SOUND_BUNDLE_ID_PREFIX + bundle_key


def actor_sound_selection_id(bundle_key, table):
    return f'{bundle_key.replace(":", "-")}-{table}'


def actor_sound_selection(bundle_key, actor_row, routes):
    roles = {role: route['fieldName'] for role, route in routes.items()}
    if not roles:
        return None
    selection = {'id': actor_sound_selection_id(bundle_key, actor_row['table']), 'kind': actor_row['kind'], 'table': actor_row['table'],
                 'match': copy.deepcopy(actor_row['match']), 'roles': roles}
    for field in SELECTION_IDENTITY_FIELDS:
        if field in actor_row:
            selection[field] = copy.deepcopy(actor_row[field])
    if actor_row['table'] == 'npcgrp':
        selection['nativeNumeric'] = dict(NPC_NATIVE_NUMERIC_FIELDS)
    return selection


def skill_actor_row(binding_row, sound_rows):
    ordinal = binding_row['soundRowOrdinal']
    if ordinal is None:
        return None
    sound_row = sound_rows[ordinal]
    if (sound_row['skill_id'], sound_row['skill_level']) != (binding_row['skillId'], binding_row['level']):
        raise ValueError(f'skillsoundgrp row {ordinal} does not belong to {binding_row["key"]}')
    return {'table': SKILL_SOUND_TABLE_NAME, 'kind': 'skill', 'label': f'{binding_row["key"]} ({SKILL_SOUND_TABLE_NAME} row {ordinal})',
            'skillId': binding_row['skillId'], 'level': binding_row['level'],
            'match': [{'pointer': '/skill_id', 'value': binding_row['skillId']}, {'pointer': '/skill_level', 'value': binding_row['level']}]}


def build_actor_sound_recipe(bundle_key, actor_rows, routes_by_table, recipe_inputs):
    selections = []
    for actor_row in actor_rows:
        selection = actor_sound_selection(bundle_key, actor_row, routes_by_table[actor_row['table']]['routes'])
        if selection is not None:
            selections.append(selection)
    if not selections:
        return None
    tables = sorted({selection['table'] for selection in selections})
    return {'schemaVersion': 1, 'kind': RECIPE_KIND, 'description': ACTOR_SOUND_RECIPE_DESCRIPTION, 'bundleKey': bundle_key,
            'referencePolicy': copy.deepcopy(POLICY), 'corpus': copy.deepcopy(recipe_inputs['corpus']),
            'tables': {table: copy.deepcopy(recipe_inputs['tables'][table]) for table in tables}, 'selections': selections,
            'routes': {table: copy.deepcopy(routes_by_table[table]['routes']) for table in tables}}


def actor_sound_gap_row(bundle_key, reason, source_identity, evidence):
    return {'key': bundle_key, 'part': AUDIO_PART_NAME, 'step': ACTOR_SOUND_STEP, 'status': GAP_STATUS, 'reason': reason,
            'sourceIdentity': source_identity, 'evidence': evidence}


def reference_source_identity(table_identity, reference):
    if isinstance(reference, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(reference):
        return {**table_identity, 'object': reference}
    return dict(table_identity)


def slot_is_admitted(slot):
    return slot['status'] in ADMITTED and slot['dependencyId'] is not None


def unresolved_reference_entries(manifest, converter_reasons):
    entries = []
    for selection in manifest['selections'] if manifest else []:
        for role, role_record in selection['roles'].items():
            for slot in role_record['slots']:
                if slot['status'] == EMPTY_REFERENCE_STATUS or slot_is_admitted(slot):
                    continue
                candidate_reasons = [converter_reasons[candidate['stableId']] for candidate in slot['candidates']
                                     if candidate['stableId'] in converter_reasons]
                reason = candidate_reasons[0] if slot['status'] in ADMITTED and len(candidate_reasons) == 1 else SOUND_IDENTITY_UNRESOLVED_REASON
                entries.append({'table': selection['table'], 'rowOrdinal': selection['rowOrdinal'], 'role': role, 'field': role_record['field'],
                                'slot': slot['index'], 'reference': slot['reference'], 'status': slot['status'], 'reason': reason})
    return entries


def actor_sound_gap_rows(bundle_key, actor_rows, routes_by_table, manifest, table_identities, evidence, converter_reasons):
    rows = [actor_sound_gap_row(bundle_key, entry['reason'], dict(table_identities[actor_row['table']]), evidence)
            for actor_row in actor_rows for entry in routes_by_table[actor_row['table']]['unresolved'].values()]
    rows += [actor_sound_gap_row(bundle_key, entry['reason'], reference_source_identity(table_identities[entry['table']], entry['reference']), evidence)
             for entry in unresolved_reference_entries(manifest, converter_reasons)]
    return rows


def actor_sound_reference_counts(manifest):
    counts = {'exactIdentity': 0, 'uniquePackageLeafCandidate': 0, 'unresolved': 0, 'empty': 0}
    for selection in manifest['selections'] if manifest else []:
        for role_record in selection['roles'].values():
            for slot in role_record['slots']:
                if slot['status'] == EMPTY_REFERENCE_STATUS:
                    counts['empty'] += 1
                elif slot_is_admitted(slot):
                    counts[REFERENCE_COUNT_NAMES[slot['status']]] += 1
                else:
                    counts['unresolved'] += 1
    return counts
