import copy
import re

from actors.actor_unit_inventory import decoded_string_values
from actors.npc_requests import GAP_STATUS, SOUND_IDENTITY_UNRESOLVED_REASON
from actors.skill_unit_inventory import SKILL_SOUND_ROW_UNIT_KIND
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
NPC_NAMES_NO_SOUND_REASON = 'npc-names-no-sound'
SKILL_SOUND_TABLE_NAME = 'skillsoundgrp'
SKILL_SOUND_ROW_NAMES_NO_SOUND_REASON = 'skill-sound-row-names-no-sound'
SKILL_SOUND_ROW_MATCH_AMBIGUOUS_REASON_PREFIX = 'skillsound-row-match-ambiguous:'
ROLE_WORD_BOUNDARY = re.compile(r'(?<=[a-z])(?=[A-Z])')


def actor_sound_bundle_id(bundle_key):
    return ACTOR_SOUND_BUNDLE_ID_PREFIX + bundle_key


def actor_sound_selection_id(bundle_key, table):
    return f'{bundle_key.replace(":", "-")}-{table}'


def selection_role_token(role):
    return ROLE_WORD_BOUNDARY.sub('-', role).lower()


def base_actor_sound_selection(selection_id, actor_row, roles):
    selection = {'id': selection_id, 'kind': actor_row['kind'], 'table': actor_row['table'], 'match': copy.deepcopy(actor_row['match']),
                 'roles': roles}
    for field in SELECTION_IDENTITY_FIELDS:
        if field in actor_row:
            selection[field] = copy.deepcopy(actor_row[field])
    return selection


def field_names_a_sound(decoded_row, field_name):
    return any(decoded_string_values(decoded_row.get(field_name)))


def member_selection(bundle_key, actor_row, role, record):
    selection_id = f'{actor_sound_selection_id(bundle_key, actor_row["table"])}-{selection_role_token(role)}-member-{record["member"]}'
    selection = base_actor_sound_selection(selection_id, actor_row, {role: record['fieldName']})
    selection['label'] = f'{actor_row["label"]} {role} member {record["member"]}'
    return selection


def caster_indexed_selection(bundle_key, actor_row, role, record):
    selection_id = f'{actor_sound_selection_id(bundle_key, actor_row["table"])}-{selection_role_token(role)}-caster-mesh-type-{record["meshType"]}'
    selection = base_actor_sound_selection(selection_id, actor_row, {role: record['fieldName']})
    selection['label'] = f'{actor_row["label"]} {role} caster mesh type {record["meshType"]} ({record["meshClass"]})'
    selection['sourceObject'] = record['meshClass']
    return selection


def actor_sound_selections(bundle_key, actor_row, binding, decoded_row):
    routes = binding['routes']
    single_roles = {role: route['fieldName'] for role, route in routes.items() if not isinstance(route, list)}
    selections = []
    if single_roles:
        selection = base_actor_sound_selection(actor_sound_selection_id(bundle_key, actor_row['table']), actor_row, single_roles)
        if actor_row['table'] == 'npcgrp':
            selection['nativeNumeric'] = dict(NPC_NATIVE_NUMERIC_FIELDS)
        selections.append(selection)
    selections += [member_selection(bundle_key, actor_row, role, record) for role, route in routes.items() if isinstance(route, list)
                   for record in route if field_names_a_sound(decoded_row, record['fieldName'])]
    selections += [caster_indexed_selection(bundle_key, actor_row, role, record) for role, records in binding.get('casterIndexedRoutes', {}).items()
                   for record in records if field_names_a_sound(decoded_row, record['fieldName'])]
    return selections


def skill_sound_row_key(row_ordinal):
    return f'{SKILL_SOUND_ROW_UNIT_KIND}:{row_ordinal}'


def skill_sound_row_actor_row(row_ordinal, sound_row):
    skill_id, level = sound_row['skill_id'], sound_row['skill_level']
    return {'table': SKILL_SOUND_TABLE_NAME, 'kind': 'skill', 'label': f'{SKILL_SOUND_TABLE_NAME} row {row_ordinal} (skill {skill_id} level {level})',
            'skillId': skill_id, 'level': level,
            'match': [{'pointer': '/skill_id', 'value': skill_id}, {'pointer': '/skill_level', 'value': level}]}


def build_actor_sound_recipe(bundle_key, actor_rows, decoded_rows, routes_by_table, recipe_inputs):
    selections = [selection for actor_row, decoded_row in zip(actor_rows, decoded_rows, strict=True)
                  for selection in actor_sound_selections(bundle_key, actor_row, routes_by_table[actor_row['table']], decoded_row)]
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


def unrouted_field_gap_rows(bundle_key, actor_rows, decoded_rows, routes_by_table, table_identities, evidence):
    return [actor_sound_gap_row(bundle_key, entry['reason'], dict(table_identities[actor_row['table']]), evidence)
            for actor_row, decoded_row in zip(actor_rows, decoded_rows, strict=True)
            for entry in routes_by_table[actor_row['table']].get('unroutedFields', [])
            if any(field_names_a_sound(decoded_row, field['fieldName']) for field in entry['fields'])]


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
