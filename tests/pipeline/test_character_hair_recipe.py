import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.character_hair_recipe import (CHARACTER_HAIR_PARTS_RELATIVE_PATH, CHARGRP_SHA256, ENGINE_SHA256, TABLE_SOURCE_SHA256_BY_NAME,
                                          CharacterHairRecipeError, character_hair_parts_document, hair_mesh_name, read_character_hair_parts,
                                          write_character_hair_parts)
from actors.pinned_answer_files import PinnedAnswerFileError, pinned_bytes
from native_store.canonical_json import canonical_json_bytes

STYLES = range(15)
MESH_FORMATS = {'front': '%s.%s_m00%d_m00_ah', 'back': '%s.%s_m00%d_m00_bh'}
MATERIAL_FORMATS = {'front': '%s.%s_m00%d_t0%d_m00_ah', 'back': '%s.%s_m00%d_t0%d_m00_bh'}
VERIFIED_FACTS = ('# Verified: player hair and face parts (RM-11)\n\nHelmetgrp is a key map at FL2GameData+0x182c. Accessory slots read '
                  'FL2GameData+0x1830. Loader 0x104675f0 reads HairAccessarygrp.dat with key HairAccessary_index.\n').encode('utf-8')
MANIFEST = json.dumps({'files': [{'file': 'a'}, {'file': 'b'}, {'file': 'c'}]}).encode('utf-8')
LITERALS = ['Fighter', 'DarkElf', 'MFighter', 'MDarkElf', *MESH_FORMATS.values(), *MATERIAL_FORMATS.values()]
MFIGHTER_FIXTURE_PARTS = [
    {'partIndex': 4, 'meshNameRequested': 'Fighter.MFighter_m000_m00_bh', 'materialNameRequested': 'MFighter.MFighter_m000_t00_m00_bh',
     'meshExportIndex': 661, 'materialExportIndex': 309, 'materialExportPath': 'MFighter.Hair.MFighter_m000_t00_m00_bh', 'materialClass': 'Engine.Texture'},
    {'partIndex': 5, 'meshNameRequested': 'Fighter.MFighter_m000_m00_ah', 'materialNameRequested': 'MFighter.MFighter_m000_t00_m00_ah',
     'meshExportIndex': 662, 'materialExportIndex': 310, 'materialExportPath': 'MFighter.Hair.MFighter_m000_t00_m00_ah', 'materialClass': 'Engine.FinalBlend'},
    {'partIndex': 9, 'meshNameRequested': 'Fighter.MFighter_m000_f', 'materialNameRequested': 'MFighter.MFighter_m000_t00_f', 'meshExportIndex': 660,
     'materialExportIndex': 331, 'materialExportPath': 'MFighter.Face.MFighter_m000_t00_f', 'materialClass': 'Engine.Texture'}]
SYNTHETIC_EXPORTS = {
    'Fighter.MFighter_m000_m00_bh': {'object': 'Fighter.MFighter_m000_m00_bh', 'exportIndex': 661, 'class': 'Engine.SkeletalMesh'},
    'Fighter.MFighter_m000_m00_ah': {'object': 'Fighter.MFighter_m000_m00_ah', 'exportIndex': 662, 'class': 'Engine.SkeletalMesh'},
    'MFighter.MFighter_m000_t00_m00_bh': {'object': 'MFighter.Hair.MFighter_m000_t00_m00_bh', 'exportIndex': 309, 'class': 'Engine.Texture'},
    'MFighter.MFighter_m000_t00_m00_ah': {'object': 'MFighter.Hair.MFighter_m000_t00_m00_ah', 'exportIndex': 310, 'class': 'Engine.FinalBlend'},
    'DarkElf.MDarkElf_m000_m00_bh': {'object': 'DarkElf.MDarkElf_m000_m00_bh', 'exportIndex': 546, 'class': 'Engine.SkeletalMesh'},
    'MDarkElf.MDarkElf_m000_t00_m00_bh': {'object': 'mdarkelf.Hair.MDarkElf_m000_t00_m00_bh', 'exportIndex': 40, 'class': 'Engine.FinalBlend'}}


def hairgrp_rows():
    fighter = [[style if style < 5 else -1, style if style < 10 else -1] for style in STYLES]
    dark_elf = [[-1 if style in (0, 2) else style, style if style < 5 else -1] for style in STYLES]
    return [fighter, dark_elf, [[0, 0] for _ in STYLES]]


def helmet_pairs(mapped_style):
    return [[[mapped_style(style), mapped_style(style)] for style in STYLES] for _ in range(3)]


def synthetic_tables():
    tables = {'hairgrp': hairgrp_rows(),
              'helmetgrp': [{'key': key, 'pairs': helmet_pairs(lambda style: style if style < key + 3 else -1)} for key in (1, 2, 3)],
              'hairaccessarygrp': [{'key': key, 'pairs': helmet_pairs(lambda style: (9 if key >= 2 and style == 0 else style) if style < 4 else -1)}
                                   for key in range(4)]}
    return {name: {'table': name, 'sourcePath': f'system/{name}.dat', 'sourceSha256': TABLE_SOURCE_SHA256_BY_NAME[name], 'descriptorSha256': 'd' * 64,
                   'route': 'elbera-adapter', 'records': records} for name, records in tables.items()}


def synthetic_chargrp(face_meshes=('Fighter.MFighter_m000_f', 'DarkElf.MDarkElf_m000_f')):
    rows = [{'face_mesh': [{'param_face_mesh': face}]} for face in face_meshes] + [{'face_mesh': []}]
    return {'sourceSha256': CHARGRP_SHA256, 'data': {'Char': rows}}


def synthetic_answer(chargrp, tables):
    hair_rows = tables['hairgrp']['records']
    return {
        'verification': {'status': 'passed'},
        'nativeNameLiterals': [{'fileSha256': ENGINE_SHA256, 'va': f'0x1089{index:04x}', 'decodedValues': {'utf16': text}}
                               for index, text in enumerate(LITERALS)],
        'inputs': {'offsets': [{'name': 'HairStyle', 'offset': '0x240'}, {'name': 'HairColor', 'offset': '0x244'}, {'name': 'Face', 'offset': '0x248'}],
                   'meshTypeClasses': [{'meshType': 0, 'class': 'MFighter'}, {'meshType': 1, 'class': 'MDarkElf'}]},
        'selectionAndDrawing': {'parts': [{'index': 4, 'meshSuffix': '_bh'}, {'index': 5, 'meshSuffix': '_ah'}, {'index': 9}],
                                'meshFormat': {**MESH_FORMATS, 'arguments': ['mesh package family', 'mesh type name', 'mapped style']},
                                'textureFormat': {**MATERIAL_FORMATS, 'arguments': ['mesh type name', 'mesh type name', 'mapped style', 'HairColor']}},
        'hairMappings': {'rows': [{'meshType': mesh_type if mesh_type < 2 else None,
                                   'values': [{'style': style, 'first': front, 'second': back} for style, (front, back) in enumerate(row)]}
                                  for mesh_type, row in enumerate(hair_rows)]},
        'helmetMappings': {'rows': [{'key': record['key'], 'pairs': [{'meshType': mesh_type, 'style': style, 'front': front, 'back': back}
                                                                     for mesh_type, pairs in enumerate(record['pairs'])
                                                                     for style, (front, back) in enumerate(pairs)]}
                                    for record in tables['helmetgrp']['records']]},
        'chargrpRows': [{'rowIndex': index, 'meshType': index if index < 2 else None, 'meshTypeName': ['MFighter', 'MDarkElf', None][index],
                         'values': {'face_mesh': [entry['param_face_mesh'] for entry in row['face_mesh']]}}
                        for index, row in enumerate(chargrp['data']['Char'])],
        'fixtures': [{'meshType': 0, 'HairStyle': 0, 'HairColor': 0, 'Face': 0, 'parts': MFIGHTER_FIXTURE_PARTS}],
        'assets': [{'object': export['object'], 'exportIndex': export['exportIndex'], 'class': export['class']} for export in SYNTHETIC_EXPORTS.values()]}


class SyntheticLock:
    def __init__(self, records):
        self.records = records

    def record(self, relative_path):
        sha256 = self.records.get(relative_path)
        return {'class': 'equal', 'eSha256': sha256, 'importaSha256': sha256} if sha256 else None


def export_resolver(exports):
    def resolve_export(requested, class_name):
        if requested not in exports:
            raise CharacterHairRecipeError(f'Object missing or ambiguous: {requested.split(".", 1)[1]} ({class_name})')
        return exports[requested]
    return resolve_export


def lock(engine_sha256=ENGINE_SHA256):
    return SyntheticLock({'system/engine.dll': engine_sha256, 'system/chargrp.dat': CHARGRP_SHA256})


class CharacterHairRecipeTests(unittest.TestCase):
    def document(self, tables=None, chargrp=None, answer=None, exports=None, reference_lock=None):
        tables, chargrp = tables or synthetic_tables(), chargrp or synthetic_chargrp()
        answer = answer or synthetic_answer(chargrp, tables)
        return character_hair_parts_document(VERIFIED_FACTS, json.dumps(answer).encode('utf-8'), MANIFEST, tables, chargrp,
                                             reference_lock or lock(), export_resolver(SYNTHETIC_EXPORTS if exports is None else exports))

    def halves(self, document, mesh_type):
        return {half['half']: half for half in document['meshTypes'][mesh_type]['defaultHalves']}

    def test_the_male_fighter_default_halves_equal_the_answer_exports_in_pawn_slot_order(self):
        document = self.document()
        self.assertEqual([(half['half'], half['pawnSlot']) for half in document['meshTypes'][0]['defaultHalves']], [('back', 4), ('front', 5)])
        front, back = self.halves(document, 0)['front'], self.halves(document, 0)['back']
        self.assertEqual((front['requestedMesh'], front['mesh']['exportIndex'], back['requestedMesh'], back['mesh']['exportIndex']),
                         ('Fighter.MFighter_m000_m00_ah', 662, 'Fighter.MFighter_m000_m00_bh', 661))
        self.assertEqual((front['requestedMaterial'], front['material']), ('MFighter.MFighter_m000_t00_m00_ah', {
            'object': 'MFighter.Hair.MFighter_m000_t00_m00_ah', 'exportIndex': 310, 'class': 'Engine.FinalBlend'}))
        self.assertEqual((back['material']['exportIndex'], back['material']['class']), (309, 'Engine.Texture'))
        self.assertEqual((document['meshTypes'][0]['family'], document['meshTypes'][0]['familySource']), ('Fighter', 'chargrp face_mesh[0] package'))

    def test_a_front_mapped_to_none_has_no_export_and_the_back_still_resolves(self):
        halves = self.halves(self.document(), 1)
        self.assertEqual((halves['front']['status'], halves['front']['mappedStyle']), ('none', -1))
        self.assertNotIn('requestedMesh', halves['front'])
        self.assertEqual((halves['back']['status'], halves['back']['mesh']['object']), ('resolved', 'DarkElf.MDarkElf_m000_m00_bh'))

    def test_the_name_builder_leaves_the_style_unpadded(self):
        self.assertEqual(hair_mesh_name(MESH_FORMATS['front'], 'Fighter', 'MFighter', 10), 'Fighter.MFighter_m0010_m00_ah')
        self.assertEqual(hair_mesh_name(MESH_FORMATS['back'], 'Fighter', 'MFighter', 3), 'Fighter.MFighter_m003_m00_bh')

    def test_mappings_hold_the_front_and_back_table_indexes(self):
        mappings = self.document()['meshTypes'][1]['mappings']
        self.assertEqual(mappings[4], {'style': 4, 'front': 4, 'back': 4, 'frontIndex': 19, 'backIndex': 244})
        self.assertEqual(len(mappings), 15)

    def test_a_face_package_outside_the_engine_family_literals_is_refused(self):
        for face in ('Elsewhere.MDarkElf_m000_f', 'MFighter.MDarkElf_m000_f'):
            with self.subTest(face=face), self.assertRaisesRegex(CharacterHairRecipeError, 'is not an Engine.dll family literal'):
                self.document(chargrp=synthetic_chargrp(('Fighter.MFighter_m000_f', face)))

    def test_helmet_cells_keep_or_hide_and_a_replacing_helmet_cell_is_refused(self):
        helmet = self.document()['equipmentHairMappings']['helmetgrp']
        self.assertEqual([(key['key'], key['counts']) for key in helmet['keys']],
                         [(key, {'keep': 2 * 2 * (key + 3), 'hide': 2 * 2 * (12 - key), 'replace': 0}) for key in (1, 2, 3)])
        self.assertEqual(helmet['excludedRows'], [{'row': 2, 'reason': 'no chargrp mesh type 2'}])
        tables = synthetic_tables()
        tables['helmetgrp']['records'][0]['pairs'][0][1] = [7, 1]
        answer = synthetic_answer(synthetic_chargrp(), tables)
        with self.assertRaisesRegex(CharacterHairRecipeError, 'helmetgrp key 1 holds a cell outside keep, hide'):
            self.document(tables=tables, answer=answer)

    def test_accessory_cells_keep_hide_and_replace_with_the_replacement_style(self):
        accessories = self.document()['equipmentHairMappings']['hairaccessarygrp']
        self.assertEqual([key['counts']['replace'] for key in accessories['keys']], [0, 0, 4, 4])
        self.assertEqual(accessories['keys'][2]['meshTypes'][0]['cells'][0], {'style': 0, 'front': 'replace', 'frontStyle': 9, 'back': 'replace', 'backStyle': 9})
        self.assertEqual((accessories['map'], accessories['loader'], accessories['keyField']), ('FL2GameData+0x1830', '0x104675f0', 'HairAccessary_index'))
        self.assertEqual(self.document()['equipmentHairMappings']['appliedBy'], 'equipment-03-30')

    def test_table_values_that_differ_from_the_answer_rows_are_refused(self):
        for table, message in (('hairgrp', 'hairgrp manifest differs'), ('helmetgrp', 'helmetgrp manifest differs')):
            answer = synthetic_answer(synthetic_chargrp(), synthetic_tables())
            tables = synthetic_tables()
            records = tables[table]['records']
            (records[0] if table == 'hairgrp' else records[0]['pairs'][0])[3] = [-1, -1]
            with self.subTest(table=table), self.assertRaisesRegex(CharacterHairRecipeError, message):
                self.document(tables=tables, answer=answer)

    def test_an_unresolved_export_stays_a_visible_unresolved_half(self):
        exports = {name: export for name, export in SYNTHETIC_EXPORTS.items() if not name.startswith('DarkElf.')}
        back = self.halves(self.document(exports=exports), 1)['back']
        self.assertEqual((back['status'], back['reason']), ('unresolved', 'Object missing or ambiguous: MDarkElf_m000_m00_bh (SkeletalMesh)'))
        self.assertEqual(back['requestedMaterial'], 'MDarkElf.MDarkElf_m000_t00_m00_bh')

    def test_a_fixture_export_that_differs_from_the_answer_is_refused(self):
        exports = copy.deepcopy(SYNTHETIC_EXPORTS)
        exports['MFighter.MFighter_m000_t00_m00_ah']['exportIndex'] = 311
        with self.assertRaisesRegex(CharacterHairRecipeError, 'pawn slot 5 differs from the RM-11 fixture'):
            self.document(exports=exports)

    def test_pins_sources_and_the_lock_are_refused_when_they_differ(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'verified-player-hair-face.md'
            path.write_bytes(VERIFIED_FACTS)
            with self.assertRaisesRegex(PinnedAnswerFileError, 'is not the pinned'):
                pinned_bytes(path, '0' * 64, 'verified facts')
        tables = synthetic_tables()
        tables['hairgrp']['sourceSha256'] = '0' * 64
        with self.assertRaisesRegex(CharacterHairRecipeError, 'hairgrp is not decoded from its pinned source'):
            self.document(tables=tables)
        with self.assertRaisesRegex(PinnedAnswerFileError, 'system/engine.dll pin .* differs from the reference client lock'):
            self.document(reference_lock=lock('f' * 64))

    def test_the_default_appearance_names_the_user_record_offsets_and_the_limitations_name_rm13(self):
        document = self.document()
        self.assertEqual({key: document['defaultAppearance'][key] for key in ('hairStyle', 'hairColor', 'face', 'userRecordOffsets')},
                         {'hairStyle': 0, 'hairColor': 0, 'face': 0, 'userRecordOffsets': {'hairStyle': '0x240', 'hairColor': '0x244', 'face': '0x248'}})
        self.assertTrue(any('RM-13' in limitation for limitation in document['limitations']))
        self.assertEqual(document['formats']['pawnSlots'], {'back': 4, 'front': 5})

    def test_check_passes_on_equal_bytes_fails_on_one_changed_byte_and_the_reader_indexes_by_chargrp_row(self):
        payload = canonical_json_bytes(self.document())
        with tempfile.TemporaryDirectory() as directory:
            write_character_hair_parts(directory, payload, False)
            self.assertEqual(write_character_hair_parts(directory, payload, True), payload)
            hair_parts = read_character_hair_parts(directory)
            self.assertEqual((hair_parts['path'], hair_parts['sha256'], sorted(hair_parts['byChargrpRow'])),
                             (CHARACTER_HAIR_PARTS_RELATIVE_PATH, hashlib.sha256(payload).hexdigest(), [0, 1]))
            recipe_path = Path(directory) / CHARACTER_HAIR_PARTS_RELATIVE_PATH
            recipe_path.write_bytes(payload[:-2] + b' \n')
            with self.assertRaisesRegex(CharacterHairRecipeError, 'differs from its generated bytes'):
                write_character_hair_parts(directory, payload, True)


class CommittedCharacterHairRecipeTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads((ROOT / CHARACTER_HAIR_PARTS_RELATIVE_PATH).read_bytes())

    def test_fourteen_mesh_types_with_their_engine_family_and_the_mapped_none_fronts(self):
        mesh_types = self.document['meshTypes']
        self.assertEqual([mesh_type['chargrpRow'] for mesh_type in mesh_types], list(range(14)))
        fronts = [mesh_type['meshType'] for mesh_type in mesh_types if mesh_type['defaultHalves'][1]['status'] == 'none']
        self.assertEqual(fronts, [2, 4, 10, 11, 12, 13])
        self.assertEqual({mesh_type['family'] for mesh_type in mesh_types}, {'Fighter', 'DarkElf', 'Dwarf', 'Elf', 'Magic', 'Orc', 'Shaman'})

    def test_the_helmet_and_accessory_counts_equal_the_verified_note(self):
        mappings = self.document['equipmentHairMappings']
        self.assertEqual([key['counts'] for key in mappings['helmetgrp']['keys']], [{'keep': 134, 'hide': 286, 'replace': 0}] * 3)
        self.assertEqual([key['counts']['replace'] for key in mappings['hairaccessarygrp']['keys']], [0, 0, 196, 196])


if __name__ == '__main__':
    unittest.main()
