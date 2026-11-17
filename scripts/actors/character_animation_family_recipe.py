import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
import re

from actors.pinned_answer_files import pinned_bytes, require_lock_equal, sha256_hex
from native_animation_families import decode_localization111
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH = 'recipes/actors/character-animation-families.json'
CHARACTER_ANIMATION_FAMILIES_KIND = 'character-animation-families'
CHARACTER_ANIMATION_FAMILIES_SCHEMA_VERSION = 1
VERIFIED_PLAYER_ANIMATIONS_FILE_NAME = 'verified-player-animations.md'
VERIFIED_PLAYER_ANIMATIONS_SHA256 = 'b3e80dc78e02152a0a6b772e8c204ec576e6cc611c9b8a8fc06a5459058f1db9'
PLAYER_ANIMATION_ANSWER_FILE_NAME = 'player-animation-name-sources.json'
PLAYER_ANIMATION_ANSWER_SHA256 = 'fca99308fd6c0f3a6815bd02270fadc835e0f0fcd914952df715ad0f372d0bab'
PLAYER_ANIMATION_MANIFEST_RELATIVE_PATH = 'player-animations-rm7/manifest.json'
PLAYER_ANIMATION_MANIFEST_SHA256 = '5e2e5ac1102f3520a723f3dc5a96368ff9bbbea0701275bcefeea705b40e9098'
VERIFIED_CHARACTERS_FACTS_FILE_NAME = 'verified-characters.md'
VERIFIED_CHARACTERS_FACTS_SHA256 = '19fc5ff025305d19e9628fcb211b206fb26d928d7c4f05cf256fdc72cf530fb6'
ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH = 'q3-phase3-replay/replay-result.json'
ROOT_MESH_ANIMATION_REPLAY_RESULT_SHA256 = 'b8c23d0eb81b966baa017aea369c69a8b5a1964c382713890a2baf76c61c7e3a'
LOCALIZATION_RELATIVE_PATH = 'system/lineagewarrior.int'
ENGINE_RELATIVE_PATH = 'system/engine.dll'
WEAPON_TYPE_SELECTOR_PROPERTY = 'Engine.Pawn.CurWeaponType'
GETTER_NAME_PREFIX = 'APawn::Get'
PASSED_VERIFICATION_STATUS = 'passed'
PROVEN_STATUS = 'proven'
ROOT_MESH_ANIMATION_FACT_PREFIX = "- The root mesh's animation is bound through "
FACTS_DATE = re.compile(r'^# .*\((\d{4}-\d{2}-\d{2})\)$', re.MULTILINE)
FACTS_WORKFLOW = re.compile(r'\bwf_[0-9a-f]{8}-[0-9a-f]{3}\b')
SECTION_HEADER = re.compile(r'^\[([A-Za-z_][A-Za-z_0-9]*)\]$')
ARRAY_ASSIGNMENT = re.compile(r'^\s*([A-Za-z_][A-Za-z_0-9]*)\[([0-9]+)\]\s*=(\S*)\s*$')
SOURCE_ROW_IDENTITY = 'line-{}'
CHARACTER_ANIMATION_FAMILY_RECIPE_DESCRIPTION = (
    'Generate recipes/actors/character-animation-families.json from the verified RM-7 player animation answer, the verified character '
    'facts with their root mesh replay, and the lock-equal system/lineagewarrior.int. --check compares and writes nothing.')


class CharacterAnimationFamilyRecipeError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CharacterAnimationFamilyRecipeError(f'{CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH}: {message}')


def replay_counts(replay, label):
    instructions, data = replay['instructions'], replay['data']
    require(instructions['checked'] == instructions['matched'] and not instructions['mismatches']
            and data['checked'] == data['matched'] and not data['mismatches'], f'the {label} replay records a mismatch')
    return {'instructions': {'checked': instructions['checked'], 'matched': instructions['matched']},
            'data': {'checked': data['checked'], 'matched': data['matched']}}


def replayed_file_sha256(replay, relative_path):
    entry = replay['files'].get(relative_path)
    require(entry is not None and entry['lockClass'] == 'equal' and entry['eMatchesLockE'] and entry['eMatchesLockImporta'],
            f'the replay read {relative_path} outside the lock')
    return entry['eSha256']


def facts_identity(file_name, facts_payload):
    text = facts_payload.decode('utf-8')
    dates = FACTS_DATE.findall(text)
    require(len(dates) == 1, f'{file_name} must name one date heading')
    return {'file': file_name, 'date': dates[0], 'workflows': sorted(set(FACTS_WORKFLOW.findall(text))), 'sha256': sha256_hex(facts_payload)}


def root_mesh_animation_fact(facts_payload):
    lines = [line for line in facts_payload.decode('utf-8').splitlines() if line.startswith(ROOT_MESH_ANIMATION_FACT_PREFIX)]
    require(len(lines) == 1, f'{VERIFIED_CHARACTERS_FACTS_FILE_NAME} must state the root mesh animation binding once')
    return lines[0][2:]


def root_mesh_animation_pairs(root_mesh_replay):
    pairs = root_mesh_replay['pairs']
    require(pairs and all(pair['boneNamesEqualInOrder'] and pair['fullExportConsumed'] and pair['rootMatchesStatedOffset']
                          and pair['bodyAnimation'] is None and pair['rootBoneCount'] == pair['bodyBoneCount'] for pair in pairs),
            'the root mesh replay holds a pair without equal bones or with a body animation')
    return [{'package': pair['package'], 'rootAnimation': pair['rootAnimation'], 'boneCount': pair['rootBoneCount']} for pair in pairs]


def answer_file_sha256(answer, file_name):
    matches = {entry['fileSha256'] for entry in answer['sources'] if entry['file'].replace('\\', '/').rsplit('/', 1)[-1].casefold() == file_name}
    require(len(matches) == 1, f'the answer names {len(matches)} hashes of {file_name}')
    return matches.pop()


def answer_mesh_types(answer):
    mesh_types = []
    for position, entry in enumerate(sorted(answer['meshTypeMapping'], key=lambda entry: entry['meshType'])):
        class_reference = entry['answer']
        require(entry['meshType'] == position and entry['status'] == PROVEN_STATUS and class_reference.count('.') == 1,
                f'mesh type entry {entry["id"]} is not a proven class in order')
        mesh_types.append({'meshType': position, 'class': class_reference, 'section': class_reference.split('.', 1)[1]})
    return mesh_types


def answer_profiles_by_slot(answer, mesh_types, weapon_types):
    profiles = {(profile['meshType'], profile['weaponType']): profile for profile in answer['perMeshTypeAndWeaponType']}
    require(len(profiles) == len(answer['perMeshTypeAndWeaponType']) == len(mesh_types) * len(weapon_types),
            'the answer profiles do not cover every mesh type and weapon type once')
    for (mesh_type, weapon_index), profile in profiles.items():
        require(profile['class'] == mesh_types[mesh_type]['class'] and profile['section'] == mesh_types[mesh_type]['section']
                and profile['weaponEnum'] == weapon_types[weapon_index], f'answer profile {mesh_type}/{weapon_index} names another class or weapon')
    return profiles


def answer_families(answer, profiles):
    family_sets = {tuple(profile['values']) for profile in profiles.values()}
    require(len(family_sets) == 1, 'the answer profiles hold different family sets')
    families = list(family_sets.pop())
    require(len(families) == answer['counts']['standardFamiliesPerProfile'], 'the answer family count differs from its stated count')
    return families


def family_getter_rows(answer, families):
    getters = {getter['name']: getter for getter in answer['getters']}
    rows = []
    for family in families:
        getter = getters.get(GETTER_NAME_PREFIX + family)
        require(getter is not None and getter['status'] == PROVEN_STATUS and getter['selector']['property'] == WEAPON_TYPE_SELECTOR_PROPERTY,
                f'the answer has no proven weapon-type getter of {family}')
        rows.append({'family': family, 'getter': getter['name'], 'address': getter['bodyVa'], 'selectorOffset': getter['selector']['offset']})
    require(len({row['selectorOffset'] for row in rows}) == 1, 'the family getters index different weapon-type offsets')
    return rows


def absent_value_rule(answer):
    throw = answer['wtThrow']
    require(throw['fallbackWeaponIndex'] is None and throw['effectiveFName'] == 'None',
            'the answer remaps an absent weapon slot; this recipe only writes the no-remap None rule')
    return {'effectiveFName': throw['effectiveFName'], 'effectiveFNameIndex': throw['effectiveFNameIndex'], 'fallbackWeaponIndex': None}


def section_family_assignments(localization_lines, section, families):
    canonical_families = {family.casefold(): family for family in families}
    assignments, active, found = {}, False, 0
    for line_number, raw_line in enumerate(localization_lines, 1):
        header = SECTION_HEADER.fullmatch(raw_line.strip())
        if header:
            active = header[1].casefold() == section.casefold()
            found += int(active)
            continue
        assignment = ARRAY_ASSIGNMENT.fullmatch(raw_line) if active else None
        family = canonical_families.get(assignment[1].casefold()) if assignment else None
        if family is None:
            continue
        key, value = (family, int(assignment[2])), assignment[3]
        require(assignments.get(key, (value,))[0] == value, f'section {section} repeats {family}[{key[1]}] with another value')
        assignments.setdefault(key, (value, line_number))
    require(found == 1, f'the localization holds {found} [{section}] sections')
    return assignments


def weapon_slot_families(assignments, families, weapon_index, weapon_type, answer_profile, absent_rule):
    values, lines = {}, {}
    for family in families:
        decoded, stated = assignments.get((family, weapon_index)), answer_profile['values'][family]
        values[family] = decoded[0] if decoded else None
        require(values[family] == stated['value'], f'{answer_profile["section"]} {family}[{weapon_index}] differs from the answer')
        if decoded:
            lines[family] = decoded[1]
            require([row['id'] for row in stated['sourceRows']] == [SOURCE_ROW_IDENTITY.format(decoded[1])],
                    f'{answer_profile["section"]} {family}[{weapon_index}] is on another line than the answer row')
        else:
            require(stated['effectiveFName'] == absent_rule['effectiveFName'], f'the answer gives absent {family}[{weapon_index}] a name')
    return {'weaponType': weapon_type, 'index': weapon_index, 'values': values, 'lines': lines}


def mesh_type_animation_families(localization_payload, answer, mesh_types, weapon_types, families, absent_rule):
    localization_lines = decode_localization111(localization_payload).decode('ascii').splitlines()
    profiles = answer_profiles_by_slot(answer, mesh_types, weapon_types)
    rows = []
    for mesh_type in mesh_types:
        assignments = section_family_assignments(localization_lines, mesh_type['section'], families)
        require(all(index < len(weapon_types) for _, index in assignments), f'section {mesh_type["section"]} holds a family key outside the weapon types')
        rows.append({**mesh_type, 'weaponTypes': [weapon_slot_families(assignments, families, index, weapon_type,
                                                                       profiles[(mesh_type['meshType'], index)], absent_rule)
                                                  for index, weapon_type in enumerate(weapon_types)]})
    absent = sum(value is None for row in rows for slot in row['weaponTypes'] for value in slot['values'].values())
    require(absent == answer['counts']['resolvedEmptyStandardValues'] and len(rows) == answer['counts']['meshTypes'],
            'the decoded family values differ from the answer counts')
    return rows


def character_animation_family_document(player_animation_facts_payload, answer_payload, manifest_payload, character_facts_payload,
                                        root_mesh_replay_payload, localization_payload, lock):
    answer, root_mesh_replay = json.loads(answer_payload), json.loads(root_mesh_replay_payload)
    require(answer['verification']['status'] == PASSED_VERIFICATION_STATUS, 'the answer verification did not pass')
    localization_sha256 = sha256_hex(localization_payload)
    require(answer['source']['fileSha256'] == localization_sha256, f'{LOCALIZATION_RELATIVE_PATH} differs from the one the answer read')
    engine_sha256 = answer_file_sha256(answer, 'engine.dll')
    require(replayed_file_sha256(root_mesh_replay, ENGINE_RELATIVE_PATH) == engine_sha256, 'the answer and the root mesh replay read different engines')
    weapon_types, mesh_types = answer['weaponTypeDefinition']['values'], answer_mesh_types(answer)
    families = answer_families(answer, answer_profiles_by_slot(answer, mesh_types, weapon_types))
    absent_rule = absent_value_rule(answer)
    return {'schemaVersion': CHARACTER_ANIMATION_FAMILIES_SCHEMA_VERSION, 'kind': CHARACTER_ANIMATION_FAMILIES_KIND,
            'verification': {'playerAnimations': facts_identity(VERIFIED_PLAYER_ANIMATIONS_FILE_NAME, player_animation_facts_payload),
                             'answer': {'file': PLAYER_ANIMATION_ANSWER_FILE_NAME, 'sha256': sha256_hex(answer_payload)},
                             'answerManifest': {'path': PLAYER_ANIMATION_MANIFEST_RELATIVE_PATH, 'sha256': sha256_hex(manifest_payload),
                                                'files': len(json.loads(manifest_payload)['files'])},
                             'characters': facts_identity(VERIFIED_CHARACTERS_FACTS_FILE_NAME, character_facts_payload),
                             'rootMeshAnimationReplay': {'path': ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH,
                                                         'sha256': sha256_hex(root_mesh_replay_payload),
                                                         **replay_counts(root_mesh_replay, 'root mesh animation')}},
            'engine': {**require_lock_equal(lock, ENGINE_RELATIVE_PATH, engine_sha256, CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH), 'imageBase': root_mesh_replay['engineImageBase']},
            'source': require_lock_equal(lock, LOCALIZATION_RELATIVE_PATH, localization_sha256, CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH),
            'weaponTypeSelector': WEAPON_TYPE_SELECTOR_PROPERTY, 'weaponTypes': weapon_types,
            'families': family_getter_rows(answer, families), 'absentValue': absent_rule,
            'meshTypes': mesh_type_animation_families(localization_payload, answer, mesh_types, weapon_types, families, absent_rule),
            'rootMeshAnimation': {'fact': root_mesh_animation_fact(character_facts_payload),
                                  'replayedPairs': root_mesh_animation_pairs(root_mesh_replay)}}


def character_animation_family_payload(verification_folder, answer_folder, client_access):
    verification, answers = Path(verification_folder), Path(answer_folder)
    return canonical_json_bytes(character_animation_family_document(
        pinned_bytes(verification / VERIFIED_PLAYER_ANIMATIONS_FILE_NAME, VERIFIED_PLAYER_ANIMATIONS_SHA256, 'verified facts'),
        pinned_bytes(answers / PLAYER_ANIMATION_ANSWER_FILE_NAME, PLAYER_ANIMATION_ANSWER_SHA256, 'answer'),
        pinned_bytes(answers / PLAYER_ANIMATION_MANIFEST_RELATIVE_PATH, PLAYER_ANIMATION_MANIFEST_SHA256, 'answer manifest'),
        pinned_bytes(verification / VERIFIED_CHARACTERS_FACTS_FILE_NAME, VERIFIED_CHARACTERS_FACTS_SHA256, 'verified facts'),
        pinned_bytes(verification / ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH, ROOT_MESH_ANIMATION_REPLAY_RESULT_SHA256, 'root mesh replay result'),
        client_access.require_equal_file(LOCALIZATION_RELATIVE_PATH).read_bytes(), client_access.lock))


def write_character_animation_families(project_root, payload, check):
    recipe_path = Path(project_root) / CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH
    if check:
        require(recipe_path.is_file() and recipe_path.read_bytes() == payload, 'differs from its generated bytes; rerun without --check')
        return payload
    replace_file(recipe_path, payload)
    return payload


def read_character_animation_families(project_root):
    path = Path(project_root) / CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH
    require(path.is_file(), 'is missing; run scripts/actors/character_animation_family_recipe.py')
    payload = path.read_bytes()
    document = json.loads(payload)
    require(document.get('schemaVersion') == CHARACTER_ANIMATION_FAMILIES_SCHEMA_VERSION and document.get('kind') == CHARACTER_ANIMATION_FAMILIES_KIND,
            'is not a character-animation-families v1 recipe')
    return {'path': CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH, 'sha256': sha256_hex(payload), 'source': document['source'],
            'getters': {row['family']: row for row in document['families']},
            'byClass': {mesh_type['class']: mesh_type for mesh_type in document['meshTypes']}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=CHARACTER_ANIMATION_FAMILY_RECIPE_DESCRIPTION)
    parser.add_argument('--verification-folder', type=Path, required=True)
    parser.add_argument('--answer-folder', type=Path, required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        payload = character_animation_family_payload(arguments.verification_folder, arguments.answer_folder,
                                                     require_reference_client(arguments.client))
        write_character_animation_families(REPOSITORY_ROOT, payload, arguments.check)
    except (OSError, ValueError, KeyError) as error:
        print(f'Character animation family recipe failed: {error}', file=sys.stderr)
        return 1
    document = json.loads(payload)
    slots = [slot for mesh_type in document['meshTypes'] for slot in mesh_type['weaponTypes']]
    print(json.dumps({'bytes': len(payload), 'sha256': sha256_hex(payload), 'meshTypes': len(document['meshTypes']), 'weaponProfiles': len(slots),
                      'families': len(document['families']),
                      'noneValues': sum(value is None for slot in slots for value in slot['values'].values())}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
