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

from actors.character_idle_family_recipe import (CHARACTER_IDLE_FAMILIES_RELATIVE_PATH, UNRESOLVED_IDLE_ANIMATION_REASON,
                                                 CharacterIdleFamilyRecipeError, character_idle_family_document, read_character_idle_families,
                                                 write_character_idle_families)
from native_store.canonical_json import canonical_json_bytes

WEAPON_TYPES = ['WT_HAND', 'WT_1HS', 'WT_THROW']
ENGINE_SHA256 = '4' * 64
FACTS = ('# Verified character animation sources (2026-11-14)\n\nReplay on E: (wf_f33ef63c-301).\n'
         "- The root mesh's animation is bound through 0x106b3990 -> SetSkelAnim 0x106b38f0.\n").encode('utf-8')
LOCALIZATION_TEXT = ('[MFighter]\r\nRunAnimName[0]=run_Hand_MFighter\r\nWaitAnimName[0]=wait_Hand_MFighter\r\nWaitAnimName[1]=wait_1HS_MFighter\r\n'
                     '[FFighter]\r\nWaitAnimName[0]=wait_Hand_FFighter\r\nWaitAnimName[1]=wait_1HS_FFighter\r\n')


def encoded_localization(text):
    body = 'Lineage2Ver111'.encode('utf-16le') + text.encode('ascii').translate(bytes(value ^ 0xac for value in range(256)))
    return body + struct.pack('<5I', 0, 8, 71, zlib.crc32(body), 0)


def replay_file(sha256):
    return {'lockClass': 'equal', 'eSha256': sha256, 'eMatchesLockE': True, 'eMatchesLockImporta': True}


def idle_replay(localization_sha256, assignments=4):
    return {'imageBases': {'system/engine.dll': '0x10300000'},
            'files': {'system/lineagewarrior.int': replay_file(localization_sha256), 'system/engine.dll': replay_file(ENGINE_SHA256)},
            'instructions': {'checked': 145, 'matched': 145, 'mismatches': []}, 'data': {'checked': 187, 'matched': 187, 'mismatches': []},
            'functionNames': ["Engine.dll 0x103416e0 APawn::GetWaitAnimName: ['?GetWaitAnimName@APawn@@QAE?AVFName@@XZ']"],
            'meshJumpTable': '0x10481be8', 'meshTypes': ['0->LineageWarrior.MFighter', '1->LineageWarrior.FFighter'],
            'int': {'sectionsWithWaitAnimName': 2, 'assignments': assignments, 'indicesPerSection': [[0, 1]], 'weaponEnumOrder': WEAPON_TYPES}}


def root_mesh_replay():
    return {'files': {'system/engine.dll': replay_file(ENGINE_SHA256)},
            'instructions': {'checked': 339, 'matched': 339, 'mismatches': []}, 'data': {'checked': 194, 'matched': 194, 'mismatches': []},
            'pairs': [{'package': 'Fighter', 'rootAnimation': 'Fighter.FFighter_anim', 'rootBoneCount': 76, 'bodyBoneCount': 76,
                       'boneNamesEqualInOrder': True, 'fullExportConsumed': True, 'rootMatchesStatedOffset': True, 'bodyAnimation': None}]}


class SyntheticLock:
    def __init__(self, records):
        self.records = records

    def record(self, relative_path):
        sha256 = self.records.get(relative_path)
        return {'class': 'equal', 'eSha256': sha256, 'importaSha256': sha256} if sha256 else None


def json_payload(value):
    return json.dumps(value).encode('utf-8')


class CharacterIdleFamilyRecipeTests(unittest.TestCase):
    def setUp(self):
        self.localization = encoded_localization(LOCALIZATION_TEXT)
        self.localization_sha256 = hashlib.sha256(self.localization).hexdigest()
        self.lock = SyntheticLock({'system/lineagewarrior.int': self.localization_sha256, 'system/engine.dll': ENGINE_SHA256})

    def document(self, localization=None, lock=None, idle=None):
        return character_idle_family_document(FACTS, json_payload(idle or idle_replay(self.localization_sha256)), json_payload(root_mesh_replay()),
                                              localization or self.localization, lock or self.lock)

    def test_each_mesh_type_takes_its_wait_animation_names_by_weapon_type_from_its_class_section(self):
        document = self.document()
        self.assertEqual([(family['meshType'], family['class']) for family in document['meshTypes']],
                         [(0, 'LineageWarrior.MFighter'), (1, 'LineageWarrior.FFighter')])
        self.assertEqual(document['meshTypes'][0]['waitAnimNames'], [
            {'weaponType': 'WT_HAND', 'index': 0, 'value': 'wait_Hand_MFighter', 'line': 3},
            {'weaponType': 'WT_1HS', 'index': 1, 'value': 'wait_1HS_MFighter', 'line': 4},
            {'weaponType': 'WT_THROW', 'index': 2, 'value': None, 'unresolved': UNRESOLVED_IDLE_ANIMATION_REASON}])
        self.assertEqual(document['idleGetter'], {'function': 'APawn::GetWaitAnimName', 'address': '0x103416e0', 'meshTypeJumpTable': '0x10481be8',
                                                  'array': 'WaitAnimName', 'arrayDim': 3})

    def test_the_recipe_records_its_sources_with_their_hashes(self):
        document = self.document()
        self.assertEqual(document['source'], {'path': 'system/lineagewarrior.int', 'sha256': self.localization_sha256})
        self.assertEqual(document['engine'], {'path': 'system/engine.dll', 'sha256': ENGINE_SHA256, 'imageBase': '0x10300000'})
        self.assertEqual(document['verification']['facts'], {'file': 'verified-characters.md', 'date': '2026-11-14', 'workflow': 'wf_f33ef63c-301',
                                                              'sha256': hashlib.sha256(FACTS).hexdigest()})
        self.assertEqual(document['rootMeshAnimation'], {'fact': "The root mesh's animation is bound through 0x106b3990 -> SetSkelAnim 0x106b38f0.",
                                                         'replayedPairs': [{'package': 'Fighter', 'rootAnimation': 'Fighter.FFighter_anim', 'boneCount': 76}]})

    def test_a_localization_pin_that_differs_from_the_lock_is_refused(self):
        with self.assertRaisesRegex(CharacterIdleFamilyRecipeError, 'differs from the reference client lock'):
            self.document(lock=SyntheticLock({'system/lineagewarrior.int': 'f' * 64, 'system/engine.dll': ENGINE_SHA256}))

    def test_a_localization_other_than_the_replayed_one_is_refused(self):
        with self.assertRaisesRegex(CharacterIdleFamilyRecipeError, 'differs from the one the idle replay read'):
            self.document(localization=encoded_localization(LOCALIZATION_TEXT + 'WaitAnimName[2]=x\r\n'))

    def test_a_wait_animation_key_repeated_with_another_value_is_refused_and_other_repeated_keys_are_not_read(self):
        repeated = LOCALIZATION_TEXT.replace('[FFighter]\r\n', 'SpAtk13AnimName[0]=a\r\nSpAtk13AnimName[0]=b\r\n[FFighter]\r\n')
        repeated_localization = encoded_localization(repeated)
        repeated_sha256 = hashlib.sha256(repeated_localization).hexdigest()
        lock = SyntheticLock({'system/lineagewarrior.int': repeated_sha256, 'system/engine.dll': ENGINE_SHA256})
        self.assertEqual(len(self.document(repeated_localization, lock, idle_replay(repeated_sha256))['meshTypes']), 2)
        conflicting = encoded_localization(LOCALIZATION_TEXT + 'WaitAnimName[1]=other_1HS_FFighter\r\n')
        conflicting_sha256 = hashlib.sha256(conflicting).hexdigest()
        lock = SyntheticLock({'system/lineagewarrior.int': conflicting_sha256, 'system/engine.dll': ENGINE_SHA256})
        with self.assertRaisesRegex(CharacterIdleFamilyRecipeError, r'repeats WaitAnimName\[1\] with another value'):
            self.document(conflicting, lock, idle_replay(conflicting_sha256))

    def test_decoded_keys_that_differ_from_the_replayed_count_are_refused(self):
        with self.assertRaisesRegex(CharacterIdleFamilyRecipeError, 'differ from the replayed counts'):
            self.document(idle=idle_replay(self.localization_sha256, assignments=5))

    def test_check_passes_on_equal_bytes_and_fails_on_one_changed_byte(self):
        payload = canonical_json_bytes(self.document())
        with tempfile.TemporaryDirectory() as directory:
            write_character_idle_families(directory, payload, False)
            self.assertEqual(write_character_idle_families(directory, payload, True), payload)
            recipe_path = Path(directory) / CHARACTER_IDLE_FAMILIES_RELATIVE_PATH
            recipe_path.write_bytes(payload[:-2] + b' \n')
            with self.assertRaisesRegex(CharacterIdleFamilyRecipeError, 'differs from its generated bytes'):
                write_character_idle_families(directory, payload, True)

    def test_the_reader_indexes_mesh_types_by_class_and_records_the_recipe_hash(self):
        payload = canonical_json_bytes(self.document())
        with tempfile.TemporaryDirectory() as directory:
            write_character_idle_families(directory, payload, False)
            families = read_character_idle_families(directory)
        self.assertEqual((families['path'], families['sha256']), (CHARACTER_IDLE_FAMILIES_RELATIVE_PATH, hashlib.sha256(payload).hexdigest()))
        self.assertEqual(sorted(families['byClass']), ['LineageWarrior.FFighter', 'LineageWarrior.MFighter'])


class CommittedCharacterIdleFamilyRecipeTests(unittest.TestCase):
    def test_the_committed_recipe_names_fourteen_mesh_types_and_ninety_eight_idle_animations(self):
        document = json.loads((ROOT / CHARACTER_IDLE_FAMILIES_RELATIVE_PATH).read_bytes())
        self.assertEqual(len(document['meshTypes']), 14)
        self.assertEqual(sum(row['value'] is not None for family in document['meshTypes'] for row in family['waitAnimNames']), 98)
        self.assertEqual({row['weaponType'] for family in document['meshTypes'] for row in family['waitAnimNames'] if row['value'] is None}, {'WT_THROW'})


if __name__ == '__main__':
    unittest.main()
