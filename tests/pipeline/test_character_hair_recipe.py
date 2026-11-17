import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.character_hair_answer_checks import HairAnswerFixtureError
from actors.character_hair_recipe import (CHARACTER_HAIR_PARTS_RELATIVE_PATH, CHARGRP_SHA256, ENGINE_SHA256, TABLE_SOURCE_SHA256_BY_NAME,
                                          CharacterHairRecipeError, HairExports, PinnedAnswerPayloads, character_hair_parts_document, half_route,
                                          hair_mesh_name, read_character_hair_parts, write_character_hair_parts)
from actors.hair_export_lookup import HairExportLookupError, cached_class_chain_reader, unique_export_of_class
from actors.pinned_answer_files import PinnedAnswerFileError, pinned_bytes
from native_store.canonical_json import canonical_json_bytes

STYLES = range(15)
MESH_FORMATS = {'front': '%s.%s_m00%d_m00_ah', 'back': '%s.%s_m00%d_m00_bh'}
MATERIAL_FORMATS = {'front': '%s.%s_m00%d_t0%d_m00_ah', 'back': '%s.%s_m00%d_t0%d_m00_bh'}
VERIFIED_FACTS = {
    'RM-11': ('# Verified: player hair and face parts (RM-11)\n\nHelmetgrp is a key map at FL2GameData+0x182c. Accessory slots read '
              'FL2GameData+0x1830. Loader 0x104675f0 reads HairAccessarygrp.dat with key HairAccessary_index.\n').encode('utf-8'),
    'RM-13': b'# Verified: hair name resolution (RM-13)\n\nFamily rows at EBP-0x690. The dispatcher at 0x106def1a routes dynamic hair.\n',
    'RM-14': b'# Verified: rigid hair (RM-14)\n\nMatchRefBone first applies the mesh alias table.\n'}
MANIFEST = json.dumps({'files': [{'file': 'a'}, {'file': 'b'}, {'file': 'c'}]}).encode('utf-8')
LITERALS = ['MFighter', 'MDarkElf', *MESH_FORMATS.values(), *MATERIAL_FORMATS.values()]
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
SYNTHETIC_MESH_MODES = {661: 4, 662: 4, 546: 7}
FAMILY_ROWS = [{'meshType': 0, 'family': 'Fighter', 'meshTypeName': 'MFighter'}, {'meshType': 1, 'family': 'DarkElf', 'meshTypeName': 'MDarkElf'}]
FAMILY_ADDRESSES = {'Fighter': '0x1089d0f4', 'DarkElf': '0x108915bc'}


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


def mapping_fixture(table, key, front, back):
    return {'id': f'{table}-key{key}-mfighter-style0', 'kind': 'authored-row', 'meshType': 0, 'style': 0, 'colour': 0, 'key': key, 'table': table,
            'front': front, 'back': back, 'frontMesh': None if front == -1 else f'Fighter.MFighter_m00{front}_m00_ah',
            'backMesh': None if back == -1 else f'Fighter.MFighter_m00{back}_m00_bh'}


def linker_query_fixture(leaf, export_index):
    return {'kind': 'native-linker-query', 'input': {'requestedClass': 'Engine.Material', 'leaf': leaf, 'outerIndex': -1, 'package': 'MFighter.utx'},
            'resultExportIndex': export_index, 'expectedExportIndex': export_index, 'passed': True}


def synthetic_name_resolution_answer(family_rows=FAMILY_ROWS):
    return {'verification': {'status': 'passed'},
            'packageFamilies': {'base': 'EBP-0x690 in10482c90',
                                'values': [{**row, 'literalVa': FAMILY_ADDRESSES[row['family']]} for row in family_rows]},
            'fixtures': [{'id': 'native-family-prefix', 'passed': True, 'rows': FAMILY_ROWS},
                         mapping_fixture('hairaccessary', 2, 9, 9), mapping_fixture('helmet', 1, 0, 0),
                         linker_query_fixture('MFighter_m000_t00_m00_bh', 309), linker_query_fixture('MFighter_m000_t00_m00_ah', 310)]}


def synthetic_rigid_answer(mode_fixtures=({'mesh': 'DarkElf.MDarkElf_m000_m00_bh', 'exportIndex': 546, 'mode': 7},)):
    return {'verification': {'status': 'passed'}, 'fixtures': [{'kind': 'assetDecode', **fixture} for fixture in mode_fixtures]}


def answer_payloads(answer, name_resolution, rigid):
    return {name: PinnedAnswerPayloads(VERIFIED_FACTS[name], json.dumps(document).encode('utf-8'), MANIFEST)
            for name, document in (('RM-11', answer), ('RM-13', name_resolution), ('RM-14', rigid))}


class SyntheticLock:
    def __init__(self, records):
        self.records = records

    def record(self, relative_path):
        sha256 = self.records.get(relative_path)
        return {'class': 'equal', 'eSha256': sha256, 'importaSha256': sha256} if sha256 else None


def synthetic_hair_exports(exports, mesh_modes=None):
    requests = []

    def resolve_export(requested, class_name):
        requests.append((requested, class_name))
        if requested not in exports:
            raise CharacterHairRecipeError(f'{requested} has no {class_name} export')
        return exports[requested]
    return HairExports(resolve_export, lambda mesh: (mesh_modes or SYNTHETIC_MESH_MODES)[mesh['exportIndex']]), requests


def lock(engine_sha256=ENGINE_SHA256):
    return SyntheticLock({'system/engine.dll': engine_sha256, 'system/chargrp.dat': CHARGRP_SHA256})


class CharacterHairRecipeTests(unittest.TestCase):
    def document(self, tables=None, chargrp=None, answer=None, exports=None, reference_lock=None, name_resolution=None, rigid=None, mesh_modes=None):
        tables, chargrp = tables or synthetic_tables(), chargrp or synthetic_chargrp()
        answer = answer or synthetic_answer(chargrp, tables)
        hair_exports, self.requests = synthetic_hair_exports(SYNTHETIC_EXPORTS if exports is None else exports, mesh_modes)
        return character_hair_parts_document(answer_payloads(answer, name_resolution or synthetic_name_resolution_answer(), rigid or synthetic_rigid_answer()),
                                             tables, chargrp, reference_lock or lock(), hair_exports)

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

    def test_the_family_comes_from_the_rm13_package_families_and_its_native_prefix_fixture(self):
        mesh_types = self.document()['meshTypes']
        self.assertEqual([(mesh_type['family'], mesh_type['familyAddress'], mesh_type['familySource']) for mesh_type in mesh_types],
                         [('Fighter', '0x1089d0f4', 'RM-13 packageFamilies EBP-0x690 in10482c90'),
                          ('DarkElf', '0x108915bc', 'RM-13 packageFamilies EBP-0x690 in10482c90')])
        swapped = [{**FAMILY_ROWS[0], 'family': 'DarkElf'}, {**FAMILY_ROWS[1], 'family': 'Fighter'}]
        with self.assertRaisesRegex(HairAnswerFixtureError, 'differ from its native family prefix fixture'):
            self.document(name_resolution=synthetic_name_resolution_answer(swapped))

    def test_each_resolved_half_records_its_mesh_mode_and_the_route_the_dispatcher_takes(self):
        document = self.document()
        self.assertEqual([(half['half'], half.get('meshMode'), half.get('route')) for mesh_type in document['meshTypes'] for half in mesh_type['defaultHalves']],
                         [('back', 4, 'ordinary'), ('front', 4, 'ordinary'), ('back', 7, 'dynamic'), ('front', None, None)])
        self.assertEqual([half_route(mode) for mode in (-1, 0, 1, 2, 4, 6, 7)],
                         ['ordinary', 'ordinary', 'dynamic', 'dynamic', 'ordinary', 'dynamic', 'dynamic'])
        self.assertEqual((document['halfRouteRule']['dispatch'], document['rigidHeadBoneRule']['source']), ('0x106def1a', 'RM-14'))

    def test_meshes_resolve_as_skeletal_meshes_and_materials_through_the_material_class_chain(self):
        self.document()
        self.assertIn(('Fighter.MFighter_m000_m00_bh', 'SkeletalMesh'), self.requests)
        self.assertIn(('MFighter.MFighter_m000_t00_m00_bh', 'Material'), self.requests)

    def test_a_mesh_mode_that_differs_from_the_rm14_asset_decode_is_refused(self):
        with self.assertRaisesRegex(HairAnswerFixtureError, 'DarkElf.MDarkElf_m000_m00_bh mesh mode 4 differs'):
            self.document(mesh_modes={661: 4, 662: 4, 546: 4})

    def test_mapping_fixtures_rebuild_the_rm13_hair_mesh_names(self):
        self.document()
        answer = synthetic_name_resolution_answer()
        answer['fixtures'][1]['backMesh'] = 'Fighter.MFighter_m008_m00_bh'
        with self.assertRaisesRegex(HairAnswerFixtureError, 'hairaccessary-key2-mfighter-style0 back differs'):
            self.document(name_resolution=answer)

    def test_a_linker_query_fixture_whose_export_differs_is_refused(self):
        exports = copy.deepcopy(SYNTHETIC_EXPORTS)
        answer = synthetic_name_resolution_answer()
        answer['fixtures'][3] = linker_query_fixture('MFighter_m000_t00_m00_bh', 308)
        with self.assertRaisesRegex(HairAnswerFixtureError, 'resolves to export 309, not the linker query fixture result'):
            self.document(exports=exports, name_resolution=answer)

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
        back = self.halves(self.document(exports=exports, rigid=synthetic_rigid_answer(())), 1)['back']
        self.assertEqual((back['status'], back['reason']), ('unresolved', 'DarkElf.MDarkElf_m000_m00_bh has no SkeletalMesh export'))
        self.assertEqual(back['requestedMaterial'], 'MDarkElf.MDarkElf_m000_t00_m00_bh')

    def test_a_fixture_export_that_differs_from_the_answer_is_refused(self):
        exports = copy.deepcopy(SYNTHETIC_EXPORTS)
        exports['MFighter.MFighter_m000_t00_m00_ah']['exportIndex'] = 311
        with self.assertRaisesRegex(CharacterHairRecipeError, 'pawn slot 5 differs from the RM-11 fixture'):
            self.document(exports=exports)

    def test_pins_sources_answers_and_the_lock_are_refused_when_they_differ(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'verified-player-hair-face.md'
            path.write_bytes(VERIFIED_FACTS['RM-11'])
            with self.assertRaisesRegex(PinnedAnswerFileError, 'is not the pinned'):
                pinned_bytes(path, '0' * 64, 'verified facts')
        tables = synthetic_tables()
        tables['hairgrp']['sourceSha256'] = '0' * 64
        with self.assertRaisesRegex(CharacterHairRecipeError, 'hairgrp is not decoded from its pinned source'):
            self.document(tables=tables)
        with self.assertRaisesRegex(PinnedAnswerFileError, 'system/engine.dll pin .* differs from the reference client lock'):
            self.document(reference_lock=lock('f' * 64))
        with self.assertRaisesRegex(CharacterHairRecipeError, 'the RM-14 answer verification did not pass'):
            self.document(rigid={**synthetic_rigid_answer(), 'verification': {'status': 'failed'}})

    def test_the_source_names_every_pinned_answer_and_the_limitations_name_rm13_and_rm14(self):
        document = self.document()
        self.assertEqual(sorted(document['source']['answers']), ['RM-11', 'RM-13', 'RM-14'])
        self.assertEqual(document['source']['answers']['RM-13']['answer']['file'], 'hair-name-resolution.json')
        self.assertEqual({key: document['defaultAppearance'][key] for key in ('hairStyle', 'hairColor', 'face', 'userRecordOffsets')},
                         {'hairStyle': 0, 'hairColor': 0, 'face': 0, 'userRecordOffsets': {'hairStyle': '0x240', 'hairColor': '0x244', 'face': '0x248'}})
        self.assertTrue(any('RM-13' in limitation for limitation in document['limitations']))
        self.assertTrue(any('RM-14' in limitation for limitation in document['limitations']))
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


def synthetic_package(exports, classes):
    package_exports = [{'exportIndex': index + 1, 'name': name.rsplit('.', 1)[-1], 'object': name, 'className': class_object.rsplit('.', 1)[-1],
                        'classObject': class_object, 'superIndex': 0} for index, (name, class_object) in enumerate(exports)]
    class_names = [name for name, _ in classes]
    class_exports = [{'exportIndex': len(package_exports) + index + 1, 'name': name.rsplit('.', 1)[-1], 'object': name, 'className': 'Class',
                      'classObject': 'Core.Class', 'superIndex': len(package_exports) + class_names.index(parent) + 1 if parent else 0}
                     for index, (name, parent) in enumerate(classes)]
    names = {item['exportIndex']: item['object'] for item in package_exports + class_exports}
    return SimpleNamespace(exports=package_exports + class_exports, object_name=lambda index: names.get(index))


class HairExportLookupTests(unittest.TestCase):
    def setUp(self):
        self.package = synthetic_package(
            [('MFighter.Hair.MFighter_m000_t00_m00_bh', 'MFighter.Texture'), ('MFighter.Hair.MFighter_m000_t00_m00_ah', 'MFighter.FinalBlend'),
             ('MFighter.Face.Duplicate_t00', 'MFighter.Texture'), ('MFighter.Hair.Duplicate_t00', 'MFighter.FinalBlend'),
             ('MFighter.Mesh.MFighter_m000_m00_bh', 'Engine.SkeletalMesh')],
            [('MFighter.Material', None), ('MFighter.RenderedMaterial', 'MFighter.Material'), ('MFighter.BitmapMaterial', 'MFighter.RenderedMaterial'),
             ('MFighter.Texture', 'MFighter.BitmapMaterial'), ('MFighter.Modifier', 'MFighter.Material'), ('MFighter.FinalBlend', 'MFighter.Modifier')])
        self.class_names_of = cached_class_chain_reader(lambda name: self.package)

    def test_a_group_less_leaf_resolves_through_any_group_by_its_class_chain(self):
        export = unique_export_of_class(self.package, 'MFighter.MFighter_m000_t00_m00_ah', 'Material', self.class_names_of)
        self.assertEqual((export['object'], export['classObject']), ('MFighter.Hair.MFighter_m000_t00_m00_ah', 'MFighter.FinalBlend'))
        self.assertEqual(self.class_names_of('MFighter.Texture'), ['texture', 'bitmapmaterial', 'renderedmaterial', 'material'])

    def test_a_native_class_absent_from_its_package_matches_only_its_own_name(self):
        export = unique_export_of_class(self.package, 'Fighter.MFighter_m000_m00_bh', 'SkeletalMesh', self.class_names_of)
        self.assertEqual(export['exportIndex'], 5)
        with self.assertRaisesRegex(HairExportLookupError, 'has no Material export'):
            unique_export_of_class(self.package, 'Fighter.MFighter_m000_m00_bh', 'Material', self.class_names_of)

    def test_a_leaf_with_two_compatible_exports_is_refused_and_the_class_filter_narrows_it(self):
        with self.assertRaisesRegex(HairExportLookupError, 'has 2 Material exports with that leaf'):
            unique_export_of_class(self.package, 'MFighter.Duplicate_t00', 'Material', self.class_names_of)
        self.assertEqual(unique_export_of_class(self.package, 'MFighter.Duplicate_t00', 'FinalBlend', self.class_names_of)['object'],
                         'MFighter.Hair.Duplicate_t00')


class CommittedCharacterHairRecipeTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads((ROOT / CHARACTER_HAIR_PARTS_RELATIVE_PATH).read_bytes())

    def halves_by_mesh(self):
        return {half['mesh']['object']: half for mesh_type in self.document['meshTypes'] for half in mesh_type['defaultHalves'] if 'mesh' in half}

    def test_fourteen_mesh_types_with_the_rm13_family_table_and_the_mapped_none_fronts(self):
        mesh_types = self.document['meshTypes']
        self.assertEqual([mesh_type['chargrpRow'] for mesh_type in mesh_types], list(range(14)))
        fronts = [mesh_type['meshType'] for mesh_type in mesh_types if mesh_type['defaultHalves'][1]['status'] == 'none']
        self.assertEqual(fronts, [2, 4, 10, 11, 12, 13])
        self.assertEqual([mesh_type['family'] for mesh_type in mesh_types],
                         [family for family in ('Fighter', 'DarkElf', 'Dwarf', 'Elf', 'Magic', 'Orc', 'Shaman') for _ in range(2)])

    def test_the_rm13_mapping_fixtures_rebuild_the_replacement_back_halves(self):
        mesh_type = self.document['meshTypes'][0]
        accessories = self.document['equipmentHairMappings']['hairaccessarygrp']['keys']
        back_styles = [accessories[key]['meshTypes'][0]['cells'][0]['backStyle'] for key in range(4)]
        self.assertEqual(back_styles, [0, 0, 9, 8])
        self.assertEqual([hair_mesh_name(self.document['formats']['mesh']['back']['format'], mesh_type['family'], mesh_type['typeName'], style)
                          for style in back_styles[2:]], ['Fighter.MFighter_m009_m00_bh', 'Fighter.MFighter_m008_m00_bh'])

    def test_the_male_fighter_exports_and_the_rm14_mesh_modes(self):
        halves = self.halves_by_mesh()
        self.assertEqual([(halves[mesh]['mesh']['exportIndex'], halves[mesh]['material']['exportIndex'], halves[mesh]['material']['class'],
                           halves[mesh]['meshMode'], halves[mesh]['route']) for mesh in ('Fighter.MFighter_m000_m00_bh', 'Fighter.MFighter_m000_m00_ah')],
                         [(661, 309, 'Engine.Texture', 4, 'ordinary'), (662, 310, 'Engine.FinalBlend', 4, 'ordinary')])
        self.assertEqual([(halves[mesh]['mesh']['exportIndex'], halves[mesh]['meshMode'], halves[mesh]['route'])
                          for mesh in ('DarkElf.FDarkElf_m000_m00_bh', 'Elf.FElf_m000_m00_bh')], [(668, 7, 'dynamic'), (465, 2, 'dynamic')])
        self.assertEqual(sorted(mesh for mesh, half in halves.items() if half['route'] == 'dynamic'),
                         ['DarkElf.FDarkElf_m000_m00_bh', 'Elf.FElf_m000_m00_bh'])

    def test_the_helmet_and_accessory_counts_equal_the_verified_note(self):
        mappings = self.document['equipmentHairMappings']
        self.assertEqual([key['counts'] for key in mappings['helmetgrp']['keys']], [{'keep': 134, 'hide': 286, 'replace': 0}] * 3)
        self.assertEqual([key['counts']['replace'] for key in mappings['hairaccessarygrp']['keys']], [0, 0, 196, 196])


CONVERSION_CLIENT_ANIMATIONS = Path('E:/Lineage2-client/animations')


@unittest.skipUnless(CONVERSION_CLIENT_ANIMATIONS.is_dir(), 'needs the conversion client E:/Lineage2-client')
class NativeMeshModeDecodeTests(unittest.TestCase):
    def decoded(self, package_name, export_index):
        from native_catalog.skeletal import decode_skeletal_source
        from native_catalog.ue2 import Package
        package = Package((CONVERSION_CLIENT_ANIMATIONS / f'{package_name}.ukx').read_bytes(), f'{package_name}.ukx')
        return decode_skeletal_source(package, next(item for item in package.exports if item['exportIndex'] == export_index))

    def test_the_decoder_returns_the_mesh_mode_its_parameters_and_the_alias_pairs(self):
        face, back, front = (self.decoded('Fighter', index) for index in (660, 661, 662))
        self.assertEqual([(source['meshMode'], len(source['bones'])) for source in (face, back, front)], [(0, 70), (4, 70), (4, 70)])
        self.assertEqual(face['attachmentAliases'], [{'alias': 'e_bone', 'bone': face['attachmentAliases'][0]['bone']}])
        dark_elf, elf = self.decoded('DarkElf', 668), self.decoded('Elf', 465)
        self.assertEqual((dark_elf['meshMode'], len(dark_elf['bones'])), (7, 13))
        self.assertEqual([round(value, 2) for value in dark_elf['meshModeParameters']], [15.25, 5.71])
        self.assertEqual((elf['meshMode'], len(elf['bones']), elf['meshModeParameters']), (2, 13, []))


if __name__ == '__main__':
    unittest.main()
