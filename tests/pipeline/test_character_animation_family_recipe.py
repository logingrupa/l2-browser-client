import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.character_animation_family_recipe import (CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH, CharacterAnimationFamilyRecipeError,
                                                      character_animation_family_document, read_character_animation_families,
                                                      write_character_animation_families)
from actors.pinned_answer_files import PinnedAnswerFileError
from native_store.canonical_json import canonical_json_bytes

WEAPON_TYPES = ['WT_HAND', 'WT_1HS', 'WT_THROW']
FAMILIES = ['RunAnimName', 'WaitAnimName']
ENGINE_SHA256 = '4' * 64
PLAYER_ANIMATION_FACTS = '# Verified player animation names, RM-7 (2026-11-16)\n\nReplay on E:.\n'.encode('utf-8')
CHARACTER_FACTS = ('# Verified character animation sources (2026-11-14)\n\nReplay on E: (wf_f33ef63c-301).\n'
                   "- The root mesh's animation is bound through 0x106b3990 -> SetSkelAnim 0x106b38f0.\n").encode('utf-8')
MANIFEST = json.dumps({'schemaVersion': 1, 'files': [{'file': 'a'}, {'file': 'b'}]}).encode('utf-8')
LOCALIZATION_TEXT = ('[MFighter]\r\nRunAnimName[0]=run_Hand_MFighter\r\nWaitAnimName[0]=wait_Hand_MFighter\r\nRunAnimName[1]=run_1HS_MFighter\r\n'
                     'WaitAnimName[1]=wait_1HS_MFighter\r\nSpAtk13AnimName[3]=atkWait_Dual_MFighter\r\nSpAtk13AnimName[3]=Atk02_Dual_MFighter\r\n'
                     '[FFighter]\r\nRunAnimName[0]=run_Hand_FFighter\r\nWaitAnimName[0]=wait_Hand_FFighter\r\nRunAnimName[1]=run_1HS_FFighter\r\n'
                     'WaitAnimName[1]=wait_1HS_FFighter\r\n')
AUTHORED_LINES = {('MFighter', 'RunAnimName', 0): 2, ('MFighter', 'WaitAnimName', 0): 3, ('MFighter', 'RunAnimName', 1): 4,
                  ('MFighter', 'WaitAnimName', 1): 5, ('FFighter', 'RunAnimName', 0): 9, ('FFighter', 'WaitAnimName', 0): 10,
                  ('FFighter', 'RunAnimName', 1): 11, ('FFighter', 'WaitAnimName', 1): 12}
AUTHORED_VALUES = {('MFighter', 'RunAnimName', 0): 'run_Hand_MFighter', ('MFighter', 'WaitAnimName', 0): 'wait_Hand_MFighter',
                   ('MFighter', 'RunAnimName', 1): 'run_1HS_MFighter', ('MFighter', 'WaitAnimName', 1): 'wait_1HS_MFighter',
                   ('FFighter', 'RunAnimName', 0): 'run_Hand_FFighter', ('FFighter', 'WaitAnimName', 0): 'wait_Hand_FFighter',
                   ('FFighter', 'RunAnimName', 1): 'run_1HS_FFighter', ('FFighter', 'WaitAnimName', 1): 'wait_1HS_FFighter'}


def encoded_localization(text):
    body = 'Lineage2Ver111'.encode('utf-16le') + text.encode('ascii').translate(bytes(value ^ 0xac for value in range(256)))
    return body + struct.pack('<5I', 0, 8, 71, zlib.crc32(body), 0)


def replay_file(sha256):
    return {'lockClass': 'equal', 'eSha256': sha256, 'eMatchesLockE': True, 'eMatchesLockImporta': True}


def root_mesh_replay():
    return {'engineImageBase': '0x10300000', 'files': {'system/engine.dll': replay_file(ENGINE_SHA256)},
            'instructions': {'checked': 339, 'matched': 339, 'mismatches': []}, 'data': {'checked': 194, 'matched': 194, 'mismatches': []},
            'pairs': [{'package': 'Fighter', 'rootAnimation': 'Fighter.FFighter_anim', 'rootBoneCount': 76, 'bodyBoneCount': 76,
                       'boneNamesEqualInOrder': True, 'fullExportConsumed': True, 'rootMatchesStatedOffset': True, 'bodyAnimation': None}]}


def answer_value(section, family, index):
    value = AUTHORED_VALUES.get((section, family, index))
    if value is None:
        return {'value': None, 'sourceRows': [], 'effectiveFName': 'None'}
    return {'value': value, 'sourceRows': [{'id': f'line-{AUTHORED_LINES[(section, family, index)]}'}], 'effectiveFName': value}


def getter(family, address):
    return {'name': f'APawn::Get{family}', 'bodyVa': address, 'status': 'proven',
            'selector': {'property': 'Engine.Pawn.CurWeaponType', 'offset': '0x71d'}}


def synthetic_answer(localization_sha256):
    sections = ['MFighter', 'FFighter']
    return {'verification': {'status': 'passed'},
            'source': {'file': 'C:\\Lineage2-client\\system\\lineagewarrior.int', 'fileSha256': localization_sha256},
            'sources': [{'file': 'C:\\Lineage2-client\\system\\Engine.dll', 'fileSha256': ENGINE_SHA256},
                        {'file': 'C:\\Lineage2-client\\system\\lineagewarrior.int', 'fileSha256': localization_sha256}],
            'weaponTypeDefinition': {'values': WEAPON_TYPES},
            'meshTypeMapping': [{'id': f'mesh-type-{index}', 'meshType': index, 'status': 'proven', 'answer': f'LineageWarrior.{section}'}
                                for index, section in enumerate(sections)],
            'perMeshTypeAndWeaponType': [{'meshType': mesh_type, 'class': f'LineageWarrior.{section}', 'section': section, 'weaponType': index,
                                          'weaponEnum': weapon_type, 'values': {family: answer_value(section, family, index) for family in FAMILIES}}
                                         for mesh_type, section in enumerate(sections) for index, weapon_type in enumerate(WEAPON_TYPES)],
            'getters': [getter('RunAnimName', '0x10341640'), getter('WaitAnimName', '0x103416e0')],
            'wtThrow': {'effectiveFName': 'None', 'effectiveFNameIndex': 0, 'fallbackWeaponIndex': None},
            'counts': {'meshTypes': 2, 'standardFamiliesPerProfile': 2, 'resolvedEmptyStandardValues': 4}}


class SyntheticLock:
    def __init__(self, records):
        self.records = records

    def record(self, relative_path):
        sha256 = self.records.get(relative_path)
        return {'class': 'equal', 'eSha256': sha256, 'importaSha256': sha256} if sha256 else None


def json_payload(value):
    return json.dumps(value).encode('utf-8')


class CharacterAnimationFamilyRecipeTests(unittest.TestCase):
    def setUp(self):
        self.localization = encoded_localization(LOCALIZATION_TEXT)
        self.localization_sha256 = hashlib.sha256(self.localization).hexdigest()
        self.lock = SyntheticLock({'system/lineagewarrior.int': self.localization_sha256, 'system/engine.dll': ENGINE_SHA256})

    def document(self, localization=None, lock=None, answer=None):
        return character_animation_family_document(PLAYER_ANIMATION_FACTS, json_payload(answer or synthetic_answer(self.localization_sha256)), MANIFEST,
                                                   CHARACTER_FACTS, json_payload(root_mesh_replay()), localization or self.localization,
                                                   lock or self.lock)

    def test_each_mesh_type_takes_every_family_by_weapon_type_with_its_line_and_an_absent_slot_is_none(self):
        document = self.document()
        self.assertEqual([(row['meshType'], row['class'], row['section']) for row in document['meshTypes']],
                         [(0, 'LineageWarrior.MFighter', 'MFighter'), (1, 'LineageWarrior.FFighter', 'FFighter')])
        self.assertEqual(document['meshTypes'][0]['weaponTypes'], [
            {'weaponType': 'WT_HAND', 'index': 0, 'values': {'RunAnimName': 'run_Hand_MFighter', 'WaitAnimName': 'wait_Hand_MFighter'},
             'lines': {'RunAnimName': 2, 'WaitAnimName': 3}},
            {'weaponType': 'WT_1HS', 'index': 1, 'values': {'RunAnimName': 'run_1HS_MFighter', 'WaitAnimName': 'wait_1HS_MFighter'},
             'lines': {'RunAnimName': 4, 'WaitAnimName': 5}},
            {'weaponType': 'WT_THROW', 'index': 2, 'values': {'RunAnimName': None, 'WaitAnimName': None}, 'lines': {}}])
        self.assertEqual(document['absentValue'], {'effectiveFName': 'None', 'effectiveFNameIndex': 0, 'fallbackWeaponIndex': None})
        self.assertEqual(document['families'], [
            {'family': 'RunAnimName', 'getter': 'APawn::GetRunAnimName', 'address': '0x10341640', 'selectorOffset': '0x71d'},
            {'family': 'WaitAnimName', 'getter': 'APawn::GetWaitAnimName', 'address': '0x103416e0', 'selectorOffset': '0x71d'}])

    def test_the_recipe_pins_the_verified_note_the_answer_the_manifest_and_the_root_mesh_facts(self):
        verification = self.document()['verification']
        self.assertEqual(verification['playerAnimations'], {'file': 'verified-player-animations.md', 'date': '2026-11-16', 'workflows': [],
                                                            'sha256': hashlib.sha256(PLAYER_ANIMATION_FACTS).hexdigest()})
        self.assertEqual(verification['answerManifest'], {'path': 'player-animations-rm7/manifest.json', 'sha256': hashlib.sha256(MANIFEST).hexdigest(),
                                                          'files': 2})
        self.assertEqual(verification['characters']['workflows'], ['wf_f33ef63c-301'])
        self.assertEqual(self.document()['engine'], {'path': 'system/engine.dll', 'sha256': ENGINE_SHA256, 'imageBase': '0x10300000'})

    def test_a_localization_pin_that_differs_from_the_lock_is_refused(self):
        with self.assertRaisesRegex(PinnedAnswerFileError, 'character-animation-families.json: system/lineagewarrior.int pin .* differs from the reference client lock'):
            self.document(lock=SyntheticLock({'system/lineagewarrior.int': 'f' * 64, 'system/engine.dll': ENGINE_SHA256}))

    def test_a_localization_other_than_the_answered_one_is_refused(self):
        with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, 'differs from the one the answer read'):
            self.document(localization=encoded_localization(LOCALIZATION_TEXT + 'RunAnimName[2]=x\r\n'))

    def test_a_value_that_differs_from_the_answer_is_refused(self):
        answer = synthetic_answer(self.localization_sha256)
        answer['perMeshTypeAndWeaponType'][0]['values']['RunAnimName']['value'] = 'Run_Hand_MFighter'
        with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, r'MFighter RunAnimName\[0\] differs from the answer'):
            self.document(answer=answer)

    def test_an_answer_that_remaps_the_absent_slot_is_refused(self):
        answer = synthetic_answer(self.localization_sha256)
        answer['wtThrow']['fallbackWeaponIndex'] = 0
        with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, 'remaps an absent weapon slot'):
            self.document(answer=answer)

    def test_a_family_key_repeated_with_another_value_is_refused_and_a_repeated_key_outside_the_families_is_not_read(self):
        self.assertEqual(len(self.document()['meshTypes']), 2)
        conflicting = encoded_localization(LOCALIZATION_TEXT + 'WaitAnimName[1]=other_1HS_FFighter\r\n')
        conflicting_sha256 = hashlib.sha256(conflicting).hexdigest()
        lock = SyntheticLock({'system/lineagewarrior.int': conflicting_sha256, 'system/engine.dll': ENGINE_SHA256})
        with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, r'repeats WaitAnimName\[1\] with another value'):
            self.document(conflicting, lock, synthetic_answer(conflicting_sha256))

    def test_decoded_values_that_differ_from_the_answer_counts_are_refused(self):
        answer = synthetic_answer(self.localization_sha256)
        answer['counts']['resolvedEmptyStandardValues'] = 5
        with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, 'differ from the answer counts'):
            self.document(answer=answer)

    def test_check_passes_on_equal_bytes_and_fails_on_one_changed_byte(self):
        payload = canonical_json_bytes(self.document())
        with tempfile.TemporaryDirectory() as directory:
            write_character_animation_families(directory, payload, False)
            self.assertEqual(write_character_animation_families(directory, payload, True), payload)
            recipe_path = Path(directory) / CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH
            recipe_path.write_bytes(payload[:-2] + b' \n')
            with self.assertRaisesRegex(CharacterAnimationFamilyRecipeError, 'differs from its generated bytes'):
                write_character_animation_families(directory, payload, True)

    def test_the_reader_indexes_mesh_types_by_class_and_getters_by_family(self):
        payload = canonical_json_bytes(self.document())
        with tempfile.TemporaryDirectory() as directory:
            write_character_animation_families(directory, payload, False)
            families = read_character_animation_families(directory)
        self.assertEqual((families['path'], families['sha256']), (CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH, hashlib.sha256(payload).hexdigest()))
        self.assertEqual(sorted(families['byClass']), ['LineageWarrior.FFighter', 'LineageWarrior.MFighter'])
        self.assertEqual(families['getters']['RunAnimName']['address'], '0x10341640')
        self.assertEqual(families['source'], {'path': 'system/lineagewarrior.int', 'sha256': self.localization_sha256})


class CommittedCharacterAnimationFamilyRecipeTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads((ROOT / CHARACTER_ANIMATION_FAMILIES_RELATIVE_PATH).read_bytes())

    def slot(self, section, weapon_type):
        mesh_type = next(row for row in self.document['meshTypes'] if row['section'] == section)
        return next(slot for slot in mesh_type['weaponTypes'] if slot['weaponType'] == weapon_type)

    def test_the_committed_recipe_holds_fourteen_classes_by_eight_weapon_slots_by_twenty_one_families(self):
        slots = [slot for row in self.document['meshTypes'] for slot in row['weaponTypes']]
        self.assertEqual((len(self.document['meshTypes']), len(slots), len(self.document['families'])), (14, 112, 21))
        self.assertEqual(sum(value is None for slot in slots for value in slot['values'].values()), 294)
        self.assertEqual({slot['weaponType'] for slot in slots if None in slot['values'].values()}, {'WT_THROW'})
        self.assertTrue(all(set(slot['values'].values()) == {None} for slot in slots if slot['weaponType'] == 'WT_THROW'))

    def test_male_fighter_one_handed_sword_names_come_from_the_answer(self):
        values = self.slot('MFighter', 'WT_1HS')['values']
        self.assertEqual((values['RunAnimName'], values['Atk01AnimName'], values['DeathAnimName'], values['WaitAnimName']),
                         ('run_1HS_MFighter', 'Atk01_1HS_MFighter', 'Death_MFighter', 'wait_1HS_MFighter'))

    def test_no_class_has_a_damage_family_and_the_female_mystic_duplicate_lies_outside_the_families(self):
        families = [row['family'] for row in self.document['families']]
        self.assertNotIn('DamageAnimName', families)
        self.assertNotIn('SpAtk13AnimName', families)
        self.assertIn('DamageFlyAnimName', families)


if __name__ == '__main__':
    unittest.main()
