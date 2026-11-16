import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import re

from native_animation_families import decode_localization111
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
CHARACTER_IDLE_FAMILIES_RELATIVE_PATH = 'recipes/actors/character-idle-families.json'
CHARACTER_IDLE_FAMILIES_KIND = 'character-idle-families'
CHARACTER_IDLE_FAMILIES_SCHEMA_VERSION = 1
VERIFIED_CHARACTERS_FACTS_FILE_NAME = 'verified-characters.md'
VERIFIED_CHARACTERS_FACTS_SHA256 = '19fc5ff025305d19e9628fcb211b206fb26d928d7c4f05cf256fdc72cf530fb6'
IDLE_REPLAY_RESULT_RELATIVE_PATH = 'q2-phase3-replay/replay-result.json'
IDLE_REPLAY_RESULT_SHA256 = '0b3e117734392bc5989f48ebf7c65d6d2a8a7ff83128d1338eff50c04a478a1b'
ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH = 'q3-phase3-replay/replay-result.json'
ROOT_MESH_ANIMATION_REPLAY_RESULT_SHA256 = 'b8c23d0eb81b966baa017aea369c69a8b5a1964c382713890a2baf76c61c7e3a'
LOCALIZATION_RELATIVE_PATH = 'system/lineagewarrior.int'
ENGINE_RELATIVE_PATH = 'system/engine.dll'
IDLE_ANIMATION_ARRAY_NAME = 'WaitAnimName'
IDLE_GETTER_NAME = 'APawn::GetWaitAnimName'
ROOT_MESH_ANIMATION_FACT_PREFIX = "- The root mesh's animation is bound through "
FACTS_DATE = re.compile(r'^# .*\((\d{4}-\d{2}-\d{2})\)$', re.MULTILINE)
FACTS_WORKFLOW = re.compile(r'\bwf_[0-9a-f]{8}-[0-9a-f]{3}\b')
FUNCTION_NAME_ENTRY = re.compile(r'^Engine\.dll (0x[0-9a-f]+) (\S+):')
MESH_TYPE_ENTRY = re.compile(r'^(\d+)->([A-Za-z_][A-Za-z_0-9]*\.([A-Za-z_][A-Za-z_0-9]*))$')
SECTION_HEADER = re.compile(r'^\[([A-Za-z_][A-Za-z_0-9]*)\]$')
IDLE_ANIMATION_ASSIGNMENT = re.compile(r'^\s*WaitAnimName\[([0-9]+)\]\s*=(\S*)\s*$', re.IGNORECASE)
UNRESOLVED_IDLE_ANIMATION_REASON = 'no WaitAnimName key of this weapon type in the class section'
CHARACTER_IDLE_FAMILY_RECIPE_DESCRIPTION = (
    'Generate recipes/actors/character-idle-families.json from the verified character facts, their two replay results and the '
    'lock-equal system/lineagewarrior.int. --check compares and writes nothing.')


class CharacterIdleFamilyRecipeError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CharacterIdleFamilyRecipeError(f'{CHARACTER_IDLE_FAMILIES_RELATIVE_PATH}: {message}')


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def pinned_bytes(path, sha256, label):
    payload = Path(path).read_bytes()
    require(sha256_hex(payload) == sha256, f'{label} {Path(path).name} is not the pinned {sha256}')
    return payload


def replay_counts(replay, label):
    instructions, data = replay['instructions'], replay['data']
    require(instructions['checked'] == instructions['matched'] and not instructions['mismatches']
            and data['checked'] == data['matched'] and not data['mismatches'], f'the {label} replay records a mismatch')
    return {'instructions': {'checked': instructions['checked'], 'matched': instructions['matched']},
            'data': {'checked': data['checked'], 'matched': data['matched']}}


def require_lock_equal(lock, relative_path, sha256):
    record = lock.record(relative_path)
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == sha256,
            f'{relative_path} pin {sha256} differs from the reference client lock')
    return {'path': relative_path, 'sha256': sha256}


def replayed_file_sha256(replay, relative_path):
    entry = replay['files'].get(relative_path)
    require(entry is not None and entry['lockClass'] == 'equal' and entry['eMatchesLockE'] and entry['eMatchesLockImporta'],
            f'the replay read {relative_path} outside the lock')
    return entry['eSha256']


def facts_identity(facts_payload):
    text = facts_payload.decode('utf-8')
    dates, workflows = FACTS_DATE.findall(text), sorted(set(FACTS_WORKFLOW.findall(text)))
    require(len(dates) == 1 and len(workflows) == 1, f'{VERIFIED_CHARACTERS_FACTS_FILE_NAME} must name one date heading and one workflow')
    return {'file': VERIFIED_CHARACTERS_FACTS_FILE_NAME, 'date': dates[0], 'workflow': workflows[0], 'sha256': sha256_hex(facts_payload)}


def root_mesh_animation_fact(facts_payload):
    lines = [line for line in facts_payload.decode('utf-8').splitlines() if line.startswith(ROOT_MESH_ANIMATION_FACT_PREFIX)]
    require(len(lines) == 1, f'{VERIFIED_CHARACTERS_FACTS_FILE_NAME} must state the root mesh animation binding once')
    return lines[0][2:]


def idle_getter(idle_replay):
    matches = [FUNCTION_NAME_ENTRY.match(entry) for entry in idle_replay['functionNames']]
    getters = [match for match in matches if match and match[2] == IDLE_GETTER_NAME]
    require(len(getters) == 1, f'the idle replay names {IDLE_GETTER_NAME} {len(getters)} times')
    return {'function': IDLE_GETTER_NAME, 'address': getters[0][1], 'meshTypeJumpTable': idle_replay['meshJumpTable'],
            'array': IDLE_ANIMATION_ARRAY_NAME, 'arrayDim': len(idle_replay['int']['weaponEnumOrder'])}


def replayed_mesh_types(idle_replay):
    mesh_types = []
    for position, entry in enumerate(idle_replay['meshTypes']):
        match = MESH_TYPE_ENTRY.fullmatch(entry)
        require(match is not None and int(match[1]) == position, f'mesh type entry {entry!r} is out of order')
        mesh_types.append({'meshType': position, 'class': match[2], 'section': match[3]})
    return mesh_types


def section_idle_animation_assignments(payload, section):
    assignments, active, found = {}, False, 0
    for line_number, raw_line in enumerate(payload.decode('ascii').splitlines(), 1):
        line = raw_line.strip()
        header = SECTION_HEADER.fullmatch(line)
        if header:
            active = header[1].casefold() == section.casefold()
            found += int(active)
            continue
        assignment = IDLE_ANIMATION_ASSIGNMENT.fullmatch(raw_line) if active else None
        if assignment:
            index, value = int(assignment[1]), assignment[2]
            require(assignments.get(index, (value,))[0] == value, f'section {section} repeats {IDLE_ANIMATION_ARRAY_NAME}[{index}] with another value')
            assignments.setdefault(index, (value, line_number))
    require(found == 1, f'the localization holds {found} [{section}] sections')
    return assignments


def idle_animation_rows(payload, section, weapon_types):
    assignments = section_idle_animation_assignments(payload, section)
    require(all(index < len(weapon_types) for index in assignments), f'section {section} holds a {IDLE_ANIMATION_ARRAY_NAME} key outside the weapon types')
    return [{'weaponType': weapon_type, 'index': index, 'value': assignments[index][0], 'line': assignments[index][1]}
            if index in assignments else {'weaponType': weapon_type, 'index': index, 'value': None, 'unresolved': UNRESOLVED_IDLE_ANIMATION_REASON}
            for index, weapon_type in enumerate(weapon_types)]


def mesh_type_idle_families(localization_payload, idle_replay):
    weapon_types = idle_replay['int']['weaponEnumOrder']
    payload = decode_localization111(localization_payload)
    families = [{**mesh_type, 'waitAnimNames': idle_animation_rows(payload, mesh_type['section'], weapon_types)}
                for mesh_type in replayed_mesh_types(idle_replay)]
    stated = idle_replay['int']
    resolved_indexes = [[row['index'] for row in family['waitAnimNames'] if row['value'] is not None] for family in families]
    require(len(families) == stated['sectionsWithWaitAnimName'] and sum(map(len, resolved_indexes)) == stated['assignments']
            and all(indexes == stated['indicesPerSection'][0] for indexes in resolved_indexes) and len(stated['indicesPerSection']) == 1,
            'the decoded WaitAnimName keys differ from the replayed counts')
    return weapon_types, families


def root_mesh_animation_pairs(root_mesh_replay):
    pairs = root_mesh_replay['pairs']
    require(pairs and all(pair['boneNamesEqualInOrder'] and pair['fullExportConsumed'] and pair['rootMatchesStatedOffset']
                          and pair['bodyAnimation'] is None and pair['rootBoneCount'] == pair['bodyBoneCount'] for pair in pairs),
            'the root mesh replay holds a pair without equal bones or with a body animation')
    return [{'package': pair['package'], 'rootAnimation': pair['rootAnimation'], 'boneCount': pair['rootBoneCount']} for pair in pairs]


def character_idle_family_document(facts_payload, idle_replay_payload, root_mesh_replay_payload, localization_payload, lock):
    idle_replay, root_mesh_replay = json.loads(idle_replay_payload), json.loads(root_mesh_replay_payload)
    localization_sha256 = sha256_hex(localization_payload)
    require(replayed_file_sha256(idle_replay, LOCALIZATION_RELATIVE_PATH) == localization_sha256,
            f'{LOCALIZATION_RELATIVE_PATH} differs from the one the idle replay read')
    engine_sha256 = replayed_file_sha256(idle_replay, ENGINE_RELATIVE_PATH)
    require(replayed_file_sha256(root_mesh_replay, ENGINE_RELATIVE_PATH) == engine_sha256, 'the two replays read different engines')
    weapon_types, families = mesh_type_idle_families(localization_payload, idle_replay)
    return {'schemaVersion': CHARACTER_IDLE_FAMILIES_SCHEMA_VERSION, 'kind': CHARACTER_IDLE_FAMILIES_KIND,
            'verification': {'facts': facts_identity(facts_payload),
                             'idleReplay': {'path': IDLE_REPLAY_RESULT_RELATIVE_PATH, 'sha256': sha256_hex(idle_replay_payload),
                                            **replay_counts(idle_replay, 'idle')},
                             'rootMeshAnimationReplay': {'path': ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH,
                                                         'sha256': sha256_hex(root_mesh_replay_payload),
                                                         **replay_counts(root_mesh_replay, 'root mesh animation')}},
            'engine': {**require_lock_equal(lock, ENGINE_RELATIVE_PATH, engine_sha256), 'imageBase': idle_replay['imageBases'][ENGINE_RELATIVE_PATH]},
            'source': require_lock_equal(lock, LOCALIZATION_RELATIVE_PATH, localization_sha256),
            'idleGetter': idle_getter(idle_replay), 'weaponTypes': weapon_types, 'meshTypes': families,
            'rootMeshAnimation': {'fact': root_mesh_animation_fact(facts_payload), 'replayedPairs': root_mesh_animation_pairs(root_mesh_replay)}}


def character_idle_family_payload(verification_folder, client_root, lock):
    folder = Path(verification_folder)
    return canonical_json_bytes(character_idle_family_document(
        pinned_bytes(folder / VERIFIED_CHARACTERS_FACTS_FILE_NAME, VERIFIED_CHARACTERS_FACTS_SHA256, 'verified facts'),
        pinned_bytes(folder / IDLE_REPLAY_RESULT_RELATIVE_PATH, IDLE_REPLAY_RESULT_SHA256, 'idle replay result'),
        pinned_bytes(folder / ROOT_MESH_ANIMATION_REPLAY_RESULT_RELATIVE_PATH, ROOT_MESH_ANIMATION_REPLAY_RESULT_SHA256, 'root mesh replay result'),
        (Path(client_root) / LOCALIZATION_RELATIVE_PATH).read_bytes(), lock))


def write_character_idle_families(project_root, payload, check):
    recipe_path = Path(project_root) / CHARACTER_IDLE_FAMILIES_RELATIVE_PATH
    if check:
        require(recipe_path.is_file() and recipe_path.read_bytes() == payload, 'differs from its generated bytes; rerun without --check')
        return payload
    replace_file(recipe_path, payload)
    return payload


def read_character_idle_families(project_root):
    path = Path(project_root) / CHARACTER_IDLE_FAMILIES_RELATIVE_PATH
    require(path.is_file(), 'is missing; run scripts/actors/character_idle_family_recipe.py')
    payload = path.read_bytes()
    document = json.loads(payload)
    require(document.get('schemaVersion') == CHARACTER_IDLE_FAMILIES_SCHEMA_VERSION and document.get('kind') == CHARACTER_IDLE_FAMILIES_KIND,
            'is not a character-idle-families v1 recipe')
    return {'path': CHARACTER_IDLE_FAMILIES_RELATIVE_PATH, 'sha256': sha256_hex(payload),
            'byClass': {family['class']: family for family in document['meshTypes']}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=CHARACTER_IDLE_FAMILY_RECIPE_DESCRIPTION)
    parser.add_argument('--verification-folder', type=Path, required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        payload = character_idle_family_payload(arguments.verification_folder, client_access.root, read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH))
        write_character_idle_families(REPOSITORY_ROOT, payload, arguments.check)
    except (OSError, ValueError, KeyError) as error:
        print(f'Character idle family recipe failed: {error}', file=sys.stderr)
        return 1
    document = json.loads(payload)
    print(json.dumps({'bytes': len(payload), 'sha256': sha256_hex(payload), 'meshTypes': len(document['meshTypes']),
                      'resolvedIdleAnimations': sum(row['value'] is not None for family in document['meshTypes'] for row in family['waitAnimNames'])},
                     sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
