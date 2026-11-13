import hashlib
import json
from pathlib import Path
import re

from actors.actor_unit_inventory import decoded_string_values
from actors.dat_field_ordinals import DESCRIPTOR_FIELD_ELEMENTS, descriptor_field_ordinal_terms, descriptor_record_collection
from native_assets_lib.combat_audio_bundle import CONFIG_TABLE, SELECTION_KINDS
from native_store.store_paths import REPOSITORY_ROOT

COMBAT_ROLE_ROUTE_PROOF = {
    'path': 'artifacts/native-parity/research/native-sound-answers-20261107/evidence/q4-hit-sounds-verify/verify_anchors.json',
    'mainCheckoutRoot': 'C:/laragon/www/l2-browser-client',
    'sha256': '03c3a03627d8c71527ef93c23f79cc574b34d27450b76a3b7a7d44810a4ab785',
}
COMBAT_ROLE_ROUTE_UNRESOLVED_REASON_PREFIX = 'combat-role-route-unresolved:'
TABLE_SELECTION_KINDS = {'chargrp': 'actor', 'npcgrp': 'actor', 'armorgrp': 'armor', 'weapongrp': 'weapon', 'skillsoundgrp': 'skill',
                         CONFIG_TABLE: 'config'}
ROLE_GETTER_ANCHOR_NAMES = {'attackItem': 'GetAttackItemSound', 'attackVoice': 'GetAttackVoiceSound', 'defense': 'GetDefenseItemSound',
                            'damage': 'GetDamageSound'}
TABLE_SERIALIZATION_ANCHOR_NAMES = {'npcgrp': 'FL2NpcData::Serialize', 'chargrp': 'char loader', 'weapongrp': 'item base serialize'}
CONFIG_ROUTE_ANCHOR_NAME = 'Action_Attack'
CONFIG_ROLE_BRANCH_TOKENS = {'critical': 'crit', 'soulshot': 'ss'}
ANCHOR_ADDRESS_SUFFIX = re.compile(r' 0x[0-9a-f]+$')
OFFSET_PAIR = re.compile(r'\+0x[0-9a-f]+/\+0x[0-9a-f]+')
SERIALIZED_SOUND_MEMBER = re.compile(r'(\+0x[0-9a-f]+/\+0x[0-9a-f]+) snd([1-9][0-9]*)')
DAT_ORDER_PHRASE = 'in DAT order'
BRANCH_CLAUSE_TOKEN = re.compile(r'^a[0-9]+ (?P<token>[a-z]+)\b')
BRANCH_CONFIG_KEY = re.compile(r'-> \[(?P<section>[A-Za-z]+)\] (?P<key>[A-Za-z_]+)')


class CombatRouteUnresolved(Exception):
    pass


class CombatRouteSourceConflict(ValueError):
    pass


def descriptor_record_field_names(layout):
    names = []
    for element in descriptor_record_collection(layout):
        name = element.get('name')
        if element.tag in DESCRIPTOR_FIELD_ELEMENTS and name and name not in names:
            names.append(name)
    return names


def is_sound_reference_field(rows, field_name, is_sound_package_reference):
    references = [reference for row in rows for reference in decoded_string_values(row.get(field_name)) if reference != '']
    return bool(references) and all(is_sound_package_reference(reference) for reference in references)


def combat_route_table_manifest(table, descriptor_sha256, layout, rows, is_sound_package_reference):
    ordinal_terms = descriptor_field_ordinal_terms(layout, rows)
    return {'table': table, 'descriptorSha256': descriptor_sha256,
            'fields': [{'name': name, 'soundReference': is_sound_reference_field(rows, name, is_sound_package_reference),
                        'ordinalTerms': ordinal_terms.get(name)} for name in descriptor_record_field_names(layout)]}


def combat_route_config_manifest(config_sha256, decoded_config_keys):
    return {'table': CONFIG_TABLE, 'descriptorSha256': config_sha256,
            'fields': [{'name': key, 'soundReference': True, 'ordinalTerms': None} for key in decoded_config_keys]}


def read_combat_role_route_proof(roots=None):
    roots = [REPOSITORY_ROOT, Path(COMBAT_ROLE_ROUTE_PROOF['mainCheckoutRoot'])] if roots is None else roots
    for root in roots:
        path = Path(root) / COMBAT_ROLE_ROUTE_PROOF['path']
        if path.is_file():
            payload = path.read_bytes()
            sha256 = hashlib.sha256(payload).hexdigest()
            native = json.loads(payload)['native'] if sha256 == COMBAT_ROLE_ROUTE_PROOF['sha256'] else None
            return {'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'sha256': sha256, 'native': native}
    return None


def unresolved_route(table, role, detail):
    return {'reason': f'{COMBAT_ROLE_ROUTE_UNRESOLVED_REASON_PREFIX}{table}/{role}', 'detail': detail}


def anchor_named(native, name):
    keys = [key for key in native if ANCHOR_ADDRESS_SUFFIX.sub('', key) == name]
    if len(keys) != 1:
        raise CombatRouteUnresolved(f'route proof has {len(keys)} {name} anchors')
    return keys[0], native[keys[0]]


def serialized_sound_members(native, table, sound_field_count):
    if table not in TABLE_SERIALIZATION_ANCHOR_NAMES:
        raise CombatRouteUnresolved(f'route proof names no serialization anchor for {table}')
    key, text = anchor_named(native, TABLE_SERIALIZATION_ANCHOR_NAMES[table])
    members = SERIALIZED_SOUND_MEMBER.findall(text)
    if DAT_ORDER_PHRASE not in text or not members:
        raise CombatRouteUnresolved(f'{key} names no sound member {DAT_ORDER_PHRASE}')
    if [int(number) for _, number in members] != list(range(1, len(members) + 1)) or len({pair for pair, _ in members}) != len(members):
        raise CombatRouteUnresolved(f'{key} sound members are not numbered once each in reading order')
    if len(members) != sound_field_count:
        raise CombatRouteUnresolved(f'{key} names {len(members)} sound members but the descriptor holds {sound_field_count} '
                                    f'sound-reference fields')
    return key, {pair: int(number) for pair, number in members}


def route_record(table_manifest, field_name, proof, anchors):
    ordinals = [index for index, field in enumerate(table_manifest['fields']) if field['name'] == field_name]
    if len(ordinals) != 1:
        raise CombatRouteUnresolved(f'decoded {table_manifest["table"]} holds {len(ordinals)} {field_name} fields')
    return {'table': table_manifest['table'], 'descriptorSha256': table_manifest['descriptorSha256'], 'fieldOrdinal': ordinals[0],
            'fieldName': field_name, 'routeProof': {'proofPath': proof['path'], 'proofSha256': proof['sha256'], 'anchors': anchors}}


def table_role_route(table_manifest, role, native, proof, serialization):
    if role not in ROLE_GETTER_ANCHOR_NAMES:
        raise CombatRouteUnresolved(f'route proof names no native getter for role {role}')
    getter_key, getter_text = anchor_named(native, ROLE_GETTER_ANCHOR_NAMES[role])
    serialization_key, member_numbers = serialization
    read_numbers = sorted({member_numbers[pair] for pair in OFFSET_PAIR.findall(getter_text) if pair in member_numbers})
    if not read_numbers:
        raise CombatRouteUnresolved(f'{getter_key} reads no sound member of {serialization_key}')
    if len(read_numbers) > 1:
        raise CombatRouteUnresolved(f'{getter_key} reads {len(read_numbers)} sound members of {serialization_key}')
    sound_fields = [field['name'] for field in table_manifest['fields'] if field['soundReference']]
    return route_record(table_manifest, sound_fields[read_numbers[0] - 1], proof, [getter_key, serialization_key])


def config_role_route(table_manifest, role, native, proof):
    anchor_key, text = anchor_named(native, CONFIG_ROUTE_ANCHOR_NAME)
    token = CONFIG_ROLE_BRANCH_TOKENS.get(role)
    clauses = [clause for clause in text.split('. ') if (match := BRANCH_CLAUSE_TOKEN.match(clause)) and match['token'] == token]
    if len(clauses) != 1:
        raise CombatRouteUnresolved(f'{anchor_key} holds {len(clauses)} branches for role {role}')
    keys = BRANCH_CONFIG_KEY.findall(clauses[0])
    if len(keys) != 1:
        raise CombatRouteUnresolved(f'{anchor_key} branch {token} names no [Section] key')
    field_name = f'{keys[0][0]}.{keys[0][1]}'
    matching = [field for field in table_manifest['fields'] if field['name'] == field_name]
    if len(matching) != 1:
        raise CombatRouteUnresolved(f'decoded ALAudio.int config holds {len(matching)} {field_name} keys')
    return route_record(table_manifest, field_name, proof, [anchor_key])


def proof_problem(proof):
    if proof is None:
        return 'route proof is missing'
    if proof['sha256'] != COMBAT_ROLE_ROUTE_PROOF['sha256'] or not isinstance(proof.get('native'), dict):
        return 'route proof hash differs from the pin'
    return None


def proof_role_routes(table_manifest, roles, route_proof):
    table = table_manifest['table']
    routes, unresolved = {}, {}
    if not roles:
        return routes, unresolved
    problem = proof_problem(route_proof)
    if problem is not None:
        return routes, {role: unresolved_route(table, role, problem) for role in roles}
    native = route_proof['native']
    serialization = None
    if table != CONFIG_TABLE:
        try:
            sound_field_count = sum(1 for field in table_manifest['fields'] if field['soundReference'])
            serialization = serialized_sound_members(native, table, sound_field_count)
        except CombatRouteUnresolved as error:
            return routes, {role: unresolved_route(table, role, str(error)) for role in roles}
    for role in roles:
        try:
            routes[role] = (config_role_route(table_manifest, role, native, route_proof) if table == CONFIG_TABLE
                            else table_role_route(table_manifest, role, native, route_proof, serialization))
        except CombatRouteUnresolved as error:
            unresolved[role] = unresolved_route(table, role, str(error))
    return routes, unresolved


def recipe_entries_of_table(route_recipe, table):
    document = route_recipe['document']
    return {entry['role']: entry for entry in document['routes'] if entry['table'] == table}


def refuse_roles_claimed_by_both_sources(table, recipe_roles):
    proof_claims = table in TABLE_SERIALIZATION_ANCHOR_NAMES or (table == CONFIG_TABLE and bool(set(recipe_roles) & set(CONFIG_ROLE_BRANCH_TOKENS)))
    if recipe_roles and proof_claims:
        raise CombatRouteSourceConflict(f'{table} roles {sorted(recipe_roles)} are claimed by both the route recipe and the route proof')


def recipe_member_field_name(table_manifest, member):
    wanted = {'ordinalConstant': member['ordinalConstant'], 'ordinalCountTerms': member['ordinalCountTerms']}
    names = [field['name'] for field in table_manifest['fields'] if field['ordinalTerms'] == wanted]
    if len(names) != 1:
        raise CombatRouteUnresolved(f'recipe member {member["member"]} at DAT field {member["datFieldOrdinal"]} matches {len(names)} '
                                    f'decoded {table_manifest["table"]} fields')
    return names[0]


def recipe_role_route(table_manifest, entry, route_recipe):
    proof = {'path': route_recipe['path'], 'sha256': route_recipe['sha256']}
    records = [{**route_record(table_manifest, recipe_member_field_name(table_manifest, member), proof, list(entry['anchors'])),
                'member': member['member']} for member in entry['members']]
    if len(records) == 1:
        return {key: value for key, value in records[0].items() if key != 'member'}
    return records


def bind_combat_role_routes(table_manifest, route_proof, route_recipe):
    table = table_manifest['table']
    roles = SELECTION_KINDS[TABLE_SELECTION_KINDS[table]]
    recipe_entries = recipe_entries_of_table(route_recipe, table)
    refuse_roles_claimed_by_both_sources(table, recipe_entries)
    proof_routes, proof_unresolved = proof_role_routes(table_manifest, [role for role in roles if role not in recipe_entries], route_proof)
    routes, unresolved = {}, {}
    for role in roles:
        if role in proof_routes:
            routes[role] = proof_routes[role]
        elif role in proof_unresolved:
            unresolved[role] = proof_unresolved[role]
        else:
            try:
                routes[role] = recipe_role_route(table_manifest, recipe_entries[role], route_recipe)
            except CombatRouteUnresolved as error:
                unresolved[role] = unresolved_route(table, role, str(error))
    return {'table': table, 'routes': routes, 'unresolved': unresolved}


def bound_route_records(binding):
    return [record for route in binding['routes'].values() for record in (route if isinstance(route, list) else [route])]
