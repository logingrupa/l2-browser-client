import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.character_conversion import CharacterSources
from actors.character_requests import (CHARACTER_CLASS_SOURCES_RELATIVE_PATH, CLASS_SOURCES_ROUTE, CLASS_TEMPLATE_MAPPING_UNDECODED_REASON,
                                       build_character_request, chargrp_row_at, resolve_character_actor_class)

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SYNTHETIC_CHARGRP_SHA256 = 'a' * 64
BODY_MESH_COUNT = 4


def synthetic_chargrp_row(body_mesh_count=BODY_MESH_COUNT, mesh_package='Fighter', texture_package='MFighter', face_mesh='Fighter.Face_m000_f',
                          face_textures=('MFighter.Face_m000_t00_f',)):
    numbers = list(range(1, body_mesh_count + 1))
    return {'body_mesh': {f'body_mesh{number}': f'{mesh_package}.Body_m001_{number}' for number in reversed(numbers)},
            'body_texture': {f'body_texture{number}': f'{texture_package}.Body_m001_t02_{number}' for number in numbers},
            'face_mesh': [{'param_face_mesh': face_mesh}] if face_mesh is not None else [],
            'face_texture': [{'param_face_texture': texture} for texture in face_textures],
            'hair_mesh': [{'param_hair_mesh': 'DarkElf.FDarkElf_m000_m00_ah'}],
            'hair_texture': [{'param_hair_texture': 'FdarkElf.FDarkElf_m000_t00_m00_ah'}]}


def synthetic_chargrp_table(rows):
    return {'source': 'system/chargrp.dat', 'sourceSha256': SYNTHETIC_CHARGRP_SHA256, 'data': {'Char': rows}}


def decoded_shape_classinfo():
    return {'sourceSha256': 'b' * 64, 'records': {'class': [{'class': 0, 'description': 'Select a race and occupation.'},
                                                             {'class': 1, 'description': 'Fighters'}]}}


HAIR_PARTS_RECIPE_PATH = 'recipes/actors/character-hair-parts.json'
HAIR_PARTS_RECIPE_SHA256 = '8' * 64
BACK_HAIR_MESH, FRONT_HAIR_MESH = 'Fighter.Hair_m000_m00_bh', 'Fighter.Hair_m000_m00_ah'


def resolved_hair_half(half, pawn_slot, mesh, route='ordinary'):
    material = f'MFighter.Hair.Hair_m000_t00_m00{mesh[-3:]}'
    return {'half': half, 'pawnSlot': pawn_slot, 'mappedStyle': 0, 'status': 'resolved', 'requestedMesh': mesh,
            'requestedMaterial': material.replace('.Hair.', '.'), 'mesh': {'object': mesh, 'exportIndex': 661, 'class': 'Engine.SkeletalMesh'},
            'material': {'object': material, 'exportIndex': 309, 'class': 'Engine.Texture'}, 'meshMode': 4 if route == 'ordinary' else 7,
            'route': route}


def default_hair_halves():
    return [resolved_hair_half('back', 4, BACK_HAIR_MESH), resolved_hair_half('front', 5, FRONT_HAIR_MESH)]


def synthetic_hair_parts(halves=None, rows=range(4)):
    return {'path': HAIR_PARTS_RECIPE_PATH, 'sha256': HAIR_PARTS_RECIPE_SHA256, 'limitations': [],
            'defaultAppearance': {'hairStyle': 0, 'hairColor': 0, 'face': 0},
            'byChargrpRow': {row: {'meshType': row, 'chargrpRow': row, 'defaultHalves': halves or default_hair_halves()} for row in rows}}


CLASS_SOURCES_RESULT_SHA256 = '9' * 64
SOURCED_CLASS_PACKAGE_SHA256 = '7' * 64


def class_sources_result(verdict, rows):
    return {'path': CHARACTER_CLASS_SOURCES_RELATIVE_PATH, 'sha256': CLASS_SOURCES_RESULT_SHA256, 'document': {'verdict': verdict, 'rows': rows}}


def not_decided_class_sources():
    return class_sources_result('not-decided', {'0': {'candidateCount': 0, 'actorClass': None, 'classPackageSha256': None}})


def refusing_class_reader(reference):
    raise AssertionError(f'no class may be read without a source join: {reference}')


ANIMATION_FAMILIES_RECIPE_SHA256 = '6' * 64
ANIMATION_FAMILIES_RECIPE_PATH = 'recipes/actors/character-animation-families.json'
SYNTHETIC_FAMILY_SOURCE = {'path': 'system/lineagewarrior.int', 'sha256': '5' * 64}
SYNTHETIC_HAND_VALUES = {'WaitAnimName': 'wait_Hand_SyntheticFighter', 'RunAnimName': 'run_Hand_SyntheticFighter',
                         'Atk01AnimName': 'Atk01_Hand_SyntheticFighter', 'DeathAnimName': 'Death_SyntheticFighter', 'DamageFlyAnimName': None}
SYNTHETIC_GETTERS = {family: {'family': family, 'getter': f'APawn::Get{family}', 'address': f'0x1034{index:04x}', 'selectorOffset': '0x71d'}
                     for index, family in enumerate(SYNTHETIC_HAND_VALUES)}


def synthetic_animation_families(class_reference=None, hand_values=None):
    values = SYNTHETIC_HAND_VALUES if hand_values is None else hand_values
    by_class = {class_reference: {'class': class_reference, 'meshType': 0, 'section': 'SyntheticFighter', 'weaponTypes': [
        {'weaponType': 'WT_HAND', 'index': 0, 'values': dict(values),
         'lines': {family: line for line, (family, value) in enumerate(values.items(), 3) if value is not None}},
        {'weaponType': 'WT_THROW', 'index': 1, 'values': {family: None for family in values}, 'lines': {}}]}}
    return {'path': ANIMATION_FAMILIES_RECIPE_PATH, 'sha256': ANIMATION_FAMILIES_RECIPE_SHA256, 'source': SYNTHETIC_FAMILY_SOURCE,
            'getters': SYNTHETIC_GETTERS, 'byClass': by_class if class_reference else {}}


def character_sources(rows, classinfo=None, hair_parts=None, read_class_definition=refusing_class_reader, class_sources=None,
                      animation_families=None):
    return CharacterSources(synthetic_chargrp_table(rows), classinfo or decoded_shape_classinfo(), hair_parts or synthetic_hair_parts(),
                            read_class_definition, class_sources or not_decided_class_sources(), animation_families or synthetic_animation_families())


class CharacterRequestTracerTests(unittest.TestCase):
    def setUp(self):
        self.sources = character_sources([synthetic_chargrp_row()])
        self.generated = build_character_request(self.sources.chargrp['data']['Char'][0], 0, None, self.sources)

    def test_body_parts_follow_field_order_with_chargrp_source_binding_paths(self):
        parts = self.generated['request']['parts']
        self.assertEqual([part['object'] for part in parts], [f'Body_m001_{number}' for number in range(1, BODY_MESH_COUNT + 1)])
        for number, part in enumerate(parts, 1):
            self.assertEqual(part['package'], 'Fighter')
            self.assertEqual(part['materials'], [f'0=MFighter.Body_m001_t02_{number}'])
            self.assertEqual(part['sourceBinding'], {'table': 'chargrp', 'sourceSha256': SYNTHETIC_CHARGRP_SHA256,
                                                     'meshPath': ['Char', 0, 'body_mesh', f'body_mesh{number}'],
                                                     'texturePath': ['Char', 0, 'body_texture', f'body_texture{number}']})

    def test_without_a_class_the_hair_halves_are_class_gaps_and_the_helmet_mappings_wait_for_equipment(self):
        self.assertEqual((self.generated['hair']['status'], self.generated['hair']['reason']), ('gap', CLASS_TEMPLATE_MAPPING_UNDECODED_REASON))
        self.assertEqual(self.generated['helmet'], {'status': 'decoded', 'reason': None, 'appliedBy': 'equipment-03-30'})
        self.assertNotIn('DarkElf', json.dumps(self.generated['request']))
        self.assertNotIn('hairSelection', json.dumps(self.generated['request']))

    def test_the_face_is_a_class_template_gap_without_a_class_join_and_the_body_still_requests(self):
        self.assertEqual(len(self.generated['request']['parts']), BODY_MESH_COUNT)
        self.assertIn({'field': 'face', 'reason': CLASS_TEMPLATE_MAPPING_UNDECODED_REASON}, self.generated['gaps'])
        self.assertEqual(self.generated['profileFields']['reason'], CLASS_TEMPLATE_MAPPING_UNDECODED_REASON)
        self.assertIsNone(self.generated['request']['animation'])

    def test_decoded_classinfo_fields_name_no_class_for_any_row(self):
        resolution = resolve_character_actor_class(decoded_shape_classinfo(), not_decided_class_sources(), 0)
        self.assertIsNone(resolution['class'])
        self.assertEqual(resolution['reason'], CLASS_TEMPLATE_MAPPING_UNDECODED_REASON)
        self.assertEqual(resolution['evidence']['classinfo']['fields'], ['class', 'description'])


CLASS_PACKAGE_SHA256 = 'e' * 64
JOINED_CLASS = 'LineageWarrior.SyntheticFighter'


def joined_classinfo(actor_class=JOINED_CLASS):
    return {'sourceSha256': 'b' * 64, 'records': {'class': [{'chargrp_index': 0, 'actor_class': actor_class}]}}


def class_definitions(definitions):
    def read_class_definition(reference):
        return definitions[reference]
    return read_class_definition


def joined_actor_class(properties):
    return {'class': JOINED_CLASS, 'packageSha256': CLASS_PACKAGE_SHA256, 'properties': properties,
            'joinSource': {'source': 'classinfo-e', 'sha256': 'b' * 64}}


def joined_class_reader(actor_class):
    return class_definitions({JOINED_CLASS: {'properties': actor_class['properties'] if actor_class else {}, 'nativeSuperClass': None}})


def joined_layout_manifest(records):
    return {'sourceSha256': 'f' * 64, 'records': records}


def hair_record(join_value, textures=('MFighter.Hair_m000_t00_ah',), mesh='Fighter.Hair_m000_ah'):
    return {'template_key': join_value, 'hair_mesh': [{'param_hair_mesh': mesh}],
            'hair_texture': [{'param_hair_texture': texture} for texture in textures]}


class CharacterClassJoinTests(unittest.TestCase):
    def test_a_decoded_classinfo_join_names_the_class_and_a_bare_class_name_does_not(self):
        self.assertEqual(resolve_character_actor_class(joined_classinfo(), not_decided_class_sources(), 0)['class'], JOINED_CLASS)
        self.assertIsNone(resolve_character_actor_class(joined_classinfo(), not_decided_class_sources(), 1)['class'])
        self.assertIsNone(resolve_character_actor_class(joined_classinfo('SyntheticFighter'), not_decided_class_sources(), 0)['class'])

    def test_a_joined_class_gives_the_face_a_head_bone_attachment_that_the_converter_accepts(self):
        from native_assets import Converter
        row = synthetic_chargrp_row()
        actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'}})
        face = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
        face = next(part for part in face['request']['parts'] if part['object'] == 'Face_m000_f')
        self.assertEqual(face['rigidAttachment'], {'bone': 'Bip01_head', 'source': {'class': JOINED_CLASS, 'packageSha256': CLASS_PACKAGE_SHA256,
                                                                                    'bonePath': ['HeadBone'], 'meshPath': ['Mesh']}})
        self.assertEqual(face['sourceBinding']['meshPath'], ['Char', 0, 'face_mesh', 0, 'param_face_mesh'])
        converter = type('ConverterDouble', (), {'class_cache': {JOINED_CLASS: {'properties': actor_class['properties'], 'source': {},
                                                                               'sourceScriptSha256': '', 'uelibSha256': '', 'helperSha256': '',
                                                                               'limitations': []}},
                                                 'package': lambda self, name: (name, None),
                                                 'recorded_source_sha256': lambda self, path: CLASS_PACKAGE_SHA256})()
        evidence = Converter.verify_actor_attachment(converter, None, {**face, 'object': face['object']})
        self.assertEqual((evidence['bone'], evidence['class']), ('Bip01_head', JOINED_CLASS))

    def test_several_face_textures_bind_the_default_appearance_face_entry(self):
        row = synthetic_chargrp_row(face_textures=('MFighter.Face_t00', 'MFighter.Face_t01'))
        actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'}})
        generated = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
        face = next(part for part in generated['request']['parts'] if part['object'] == 'Face_m000_f')
        self.assertEqual(face['materials'], ['0=MFighter.Face_t00'])
        self.assertEqual(face['sourceBinding']['texturePath'], ['Char', 0, 'face_texture', 0, 'param_face_texture'])
        self.assertEqual(face['rigidAttachment']['source']['meshPath'], ['Mesh'])
        self.assertTrue(any('Face 0' in limitation for limitation in generated['request']['limitations']))

    def test_a_face_without_an_entry_for_the_default_face_stays_unbound(self):
        row = synthetic_chargrp_row(face_textures=())
        actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'}})
        generated = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
        face = next(part for part in generated['request']['parts'] if part['object'] == 'Face_m000_f')
        self.assertEqual(face['materials'], [])
        self.assertIn(f'The face mesh is chargrp Char/0/face_mesh/0, checked against the {JOINED_CLASS} Mesh default; its 0 face_texture entries '
                      'hold no entry for Face 0, so slot 0 stays unbound.', generated['request']['limitations'])

    def test_the_face_takes_the_class_mesh_spelling_and_a_class_mesh_that_is_not_the_row_face_is_a_face_gap(self):
        row = synthetic_chargrp_row()
        for class_mesh, expected in (('fighter.FACE_m000_f', 'FACE_m000_f'), ('Fighter.Other_m000_f', None)):
            with self.subTest(class_mesh=class_mesh):
                actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': class_mesh}})
                generated = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
                face = generated['request']['parts'][-1]
                if expected:
                    self.assertEqual((face['package'], face['object']), ('fighter', expected))
                    self.assertEqual(face['sourceBinding']['meshPath'], ['Char', 0, 'face_mesh', 0, 'param_face_mesh'])
                else:
                    self.assertNotIn('rigidAttachment', face)
                    self.assertIn({'field': 'face', 'reason': 'actor-default-unresolved:Mesh'}, generated['gaps'])

    def test_every_generated_table_binding_passes_the_converter_binding_check(self):
        from native_assets_lib.source_table_binding import verify_source_table_binding
        for face_textures in (('MFighter.Face_m000_t00_f',), ('MFighter.Face_t00', 'MFighter.Face_t01')):
            row = synthetic_chargrp_row(face_textures=face_textures)
            row['body_texture']['body_texture2'] = ''
            actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'}})
            generated = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
            decoded_table = {**synthetic_chargrp_table([row]), 'schema': {}, 'decodedSha256': 'a' * 64}
            for part in generated['request']['parts']:
                if 'sourceBinding' in part:
                    with self.subTest(part=part['object'], faceTextures=len(face_textures)):
                        verify_source_table_binding(part, decoded_table)


SOURCED_CLASS = 'LineageWarrior.SourcedFighter'


def adopted_class_sources(actor_class=SOURCED_CLASS):
    return class_sources_result('adopted', {'0': {'candidateCount': 1, 'actorClass': actor_class, 'classPackageSha256': SOURCED_CLASS_PACKAGE_SHA256},
                                            '1': {'candidateCount': 1, 'actorClass': 'LineageWarrior.SourcedMystic',
                                                  'classPackageSha256': SOURCED_CLASS_PACKAGE_SHA256}})


def sourced_class_reader():
    properties = {'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'}}
    return class_definitions({SOURCED_CLASS: {'properties': properties, 'nativeSuperClass': None,
                                              'source': {'packageSha256': SOURCED_CLASS_PACKAGE_SHA256}}})


def sourced_actor_class(sources):
    from actors.character_conversion import CharacterConversionRun
    run = type('RunDouble', (), {'sources': sources})()
    return CharacterConversionRun.actor_class(run, resolve_character_actor_class(sources.classinfo, sources.class_sources, 0))


class CharacterClassSourcesRouteTests(unittest.TestCase):
    def test_an_adopted_result_names_the_class_after_classinfo_with_the_result_path_and_hashes(self):
        resolution = resolve_character_actor_class(decoded_shape_classinfo(), adopted_class_sources(), 0)
        self.assertEqual((resolution['class'], resolution['reason'], resolution['route']), (SOURCED_CLASS, None, CLASS_SOURCES_ROUTE))
        self.assertEqual(resolution['evidence']['classSources'], {'path': CHARACTER_CLASS_SOURCES_RELATIVE_PATH, 'resultSha256': CLASS_SOURCES_RESULT_SHA256,
                                                                  'verdict': 'adopted', 'candidateCount': 1,
                                                                  'classPackageSha256': SOURCED_CLASS_PACKAGE_SHA256})
        self.assertEqual(resolve_character_actor_class(joined_classinfo(), adopted_class_sources(), 0)['class'], JOINED_CLASS)

    def test_the_request_of_an_adopted_row_carries_the_class_with_the_result_path_and_sha256(self):
        row = synthetic_chargrp_row()
        sources = character_sources([row], read_class_definition=sourced_class_reader(), class_sources=adopted_class_sources())
        actor_class = sourced_actor_class(sources)
        self.assertEqual(actor_class['joinSource'], {'source': CHARACTER_CLASS_SOURCES_RELATIVE_PATH, 'sha256': CLASS_SOURCES_RESULT_SHA256})
        generated = build_character_request(row, 0, actor_class, sources)
        limitation = [line for line in generated['request']['limitations'] if SOURCED_CLASS in line and 'is joined to this chargrp row' in line]
        self.assertEqual(len(limitation), 1)
        for cited in (CHARACTER_CLASS_SOURCES_RELATIVE_PATH, CLASS_SOURCES_RESULT_SHA256, SOURCED_CLASS_PACKAGE_SHA256):
            self.assertIn(cited, limitation[0])
        self.assertEqual(generated['request']['parts'][BODY_MESH_COUNT]['rigidAttachment']['source']['class'], SOURCED_CLASS)

    def test_a_class_package_other_than_the_searched_one_is_refused(self):
        from actors.character_requests import CharacterRequestError
        sources = character_sources([synthetic_chargrp_row()], read_class_definition=sourced_class_reader(),
                                    class_sources=class_sources_result('adopted', {'0': {'candidateCount': 1, 'actorClass': SOURCED_CLASS,
                                                                                         'classPackageSha256': '6' * 64}}))
        with self.assertRaisesRegex(CharacterRequestError, 'rerun the class source search'):
            sourced_actor_class(sources)

    def test_a_not_decided_result_keeps_the_gap_with_the_result_file_as_evidence_even_for_a_single_candidate(self):
        single = class_sources_result('not-decided', {'0': {'candidateCount': 1, 'actorClass': SOURCED_CLASS,
                                                            'classPackageSha256': SOURCED_CLASS_PACKAGE_SHA256}})
        for class_sources in (not_decided_class_sources(), single):
            with self.subTest(candidates=class_sources['document']['rows']['0']['candidateCount']):
                resolution = resolve_character_actor_class(decoded_shape_classinfo(), class_sources, 0)
                self.assertEqual((resolution['class'], resolution['reason'], resolution['route']), (None, CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, None))
                self.assertEqual(resolution['evidence']['classSources']['path'], CHARACTER_CLASS_SOURCES_RELATIVE_PATH)

    def converted_with_root_mesh_animation(self, root_mesh_animation):
        from unittest import mock
        from actors import character_conversion
        from actors.character_conversion import CharacterConversionRun
        row = synthetic_chargrp_row()
        sources = character_sources([row], read_class_definition=sourced_class_reader(), class_sources=adopted_class_sources())
        generated = build_character_request(row, 0, sourced_actor_class(sources), sources)
        converter = mock.Mock()
        converter.package.return_value = (None, type('PackageDouble', (), {'package_name': 'Fighter'})())
        converter.convert.return_value = {'file': 'converted.l2asset'}
        run = type('RunDouble', (), {'converter': converter, 'client_access': None})()
        with mock.patch.object(character_conversion, 'serialized_animation_reference', return_value=root_mesh_animation):
            return generated, converter, CharacterConversionRun.converted_model_reason(run, generated)

    def test_the_animation_set_is_the_one_the_class_mesh_default_root_mesh_serializes(self):
        generated, converter, outcome = self.converted_with_root_mesh_animation('Fighter.MFighter_anim')
        self.assertEqual(generated['rootMesh'], {'reason': None, 'package': 'Fighter', 'object': 'Face_m000_f', 'class': SOURCED_CLASS,
                                                 'classPackageSha256': SOURCED_CLASS_PACKAGE_SHA256, 'meshPath': ['Mesh']})
        self.assertIsNone(generated['request']['animation'])
        self.assertEqual(converter.package.call_args.args, ('Fighter',))
        self.assertEqual(converter.select.call_args.args[1:], ('Face_m000_f', 'SkeletalMesh'))
        self.assertEqual(converter.convert.call_args.args[0]['animation'], 'Fighter.MFighter_anim')
        self.assertEqual(outcome, (None, {'file': 'converted.l2asset'}))
        self.assertIn(f'The animation set is the Animation that the {SOURCED_CLASS} Mesh default Fighter.Face_m000_f serializes, the root mesh '
                      f'binding recorded in {ANIMATION_FAMILIES_RECIPE_PATH} (sha256 {ANIMATION_FAMILIES_RECIPE_SHA256}).',
                      generated['request']['limitations'])

    def test_a_root_mesh_without_an_animation_stays_animation_reference_missing_and_nothing_converts(self):
        from actors.npc_requests import ANIMATION_REFERENCE_MISSING_REASON
        _, converter, outcome = self.converted_with_root_mesh_animation(None)
        self.assertEqual(outcome, (ANIMATION_REFERENCE_MISSING_REASON, None))
        converter.convert.assert_not_called()

    def test_without_a_joined_class_no_root_mesh_is_read_and_the_model_names_the_class_gap(self):
        from actors.character_conversion import CharacterConversionRun
        row = synthetic_chargrp_row()
        generated = build_character_request(row, 0, None, character_sources([row]))
        run = type('RunDouble', (), {'converter': None, 'client_access': None})()
        self.assertEqual(CharacterConversionRun.converted_model_reason(run, generated), (CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, None))


HAIR_CLASS_PROPERTIES = {'HeadBone': 'Bip01_head', 'Mesh': {'class': 'SkeletalMesh', 'object': 'Fighter.Face_m000_f'},
                         'SubMeshes': [None, None, None, None, {'class': 'SkeletalMesh', 'object': BACK_HAIR_MESH},
                                       {'class': 'SkeletalMesh', 'object': FRONT_HAIR_MESH}]}


class CharacterHairPartTests(unittest.TestCase):
    def generated_with_hair(self, halves=None, properties=None, row=None):
        row = row or synthetic_chargrp_row()
        actor_class = joined_actor_class(properties or HAIR_CLASS_PROPERTIES)
        return build_character_request(row, 0, actor_class, character_sources([row], hair_parts=synthetic_hair_parts(halves),
                                                                              read_class_definition=joined_class_reader(actor_class)))

    def hair_parts(self, generated):
        return [part for part in generated['request']['parts'] if 'hairSelection' in part]

    def test_resolved_halves_attach_to_the_head_bone_in_pawn_slot_order_with_their_selection(self):
        generated = self.generated_with_hair()
        back, front = self.hair_parts(generated)
        self.assertEqual((back['package'], back['object'], back['materials']), ('Fighter', 'Hair_m000_m00_bh', ['0=MFighter.Hair.Hair_m000_t00_m00_bh']))
        self.assertEqual(back['hairSelection'], {'recipe': HAIR_PARTS_RECIPE_PATH, 'recipeSha256': HAIR_PARTS_RECIPE_SHA256, 'meshType': 0, 'half': 'back',
                                                 'pawnSlot': 4, 'mappedStyle': 0, 'hairColor': 0, 'route': 'ordinary'})
        self.assertEqual([(part['rigidAttachment']['bone'], part['rigidAttachment']['source']['meshPath']) for part in (back, front)],
                         [('Bip01_head', ['SubMeshes', 4]), ('Bip01_head', ['SubMeshes', 5])])
        self.assertEqual((generated['hair']['status'], generated['hair']['reason'], generated['hair']['appearance']),
                         ('bound', None, {'hairStyle': 0, 'hairColor': 0, 'face': 0}))
        self.assertEqual(generated['hair']['halves'][1], {'half': 'front', 'pawnSlot': 5, 'mappedStyle': 0, 'status': 'resolved',
                                                          'mesh': FRONT_HAIR_MESH, 'material': 'MFighter.Hair.Hair_m000_t00_m00_ah',
                                                          'route': 'ordinary'})

    def test_a_mapped_none_half_adds_no_part(self):
        halves = [resolved_hair_half('back', 4, BACK_HAIR_MESH), {'half': 'front', 'pawnSlot': 5, 'mappedStyle': -1, 'status': 'none'}]
        generated = self.generated_with_hair(halves)
        self.assertEqual([part['object'] for part in self.hair_parts(generated)], ['Hair_m000_m00_bh'])
        self.assertEqual(generated['hair']['status'], 'bound')

    def test_a_resolved_mesh_missing_from_the_class_sub_meshes_adds_no_part_and_names_the_half(self):
        properties = {**HAIR_CLASS_PROPERTIES, 'SubMeshes': HAIR_CLASS_PROPERTIES['SubMeshes'][:5]}
        generated = self.generated_with_hair(properties=properties)
        self.assertEqual([part['object'] for part in self.hair_parts(generated)], ['Hair_m000_m00_bh'])
        self.assertEqual((generated['hair']['status'], generated['hair']['reason']), ('gap', 'hair-submesh-unlisted:front'))
        self.assertIn({'field': 'hair', 'reason': 'hair-submesh-unlisted:front'}, generated['gaps'])

    def test_an_unresolved_export_gaps_only_its_half(self):
        halves = [{'half': 'back', 'pawnSlot': 4, 'mappedStyle': 0, 'status': 'unresolved', 'requestedMesh': BACK_HAIR_MESH,
                   'requestedMaterial': 'MFighter.Hair_m000_t00_m00_bh', 'reason': 'Object missing or ambiguous'},
                  resolved_hair_half('front', 5, FRONT_HAIR_MESH)]
        generated = self.generated_with_hair(halves)
        self.assertEqual([part['object'] for part in self.hair_parts(generated)], ['Hair_m000_m00_ah'])
        self.assertEqual(generated['hair']['reason'], 'hair-export-unresolved:back')

    def test_a_dynamic_half_leaves_the_request_with_the_dynamic_hair_gap_and_the_front_half_stays(self):
        halves = [resolved_hair_half('back', 4, BACK_HAIR_MESH, 'dynamic'), resolved_hair_half('front', 5, FRONT_HAIR_MESH)]
        generated = self.generated_with_hair(halves)
        self.assertEqual([part['object'] for part in self.hair_parts(generated)], ['Hair_m000_m00_ah'])
        self.assertEqual((generated['hair']['status'], generated['hair']['reason']), ('gap', 'dynamic-hair-simulation-unported:back'))
        self.assertEqual(generated['hair']['halves'][0]['route'], 'dynamic')
        self.assertIn({'field': 'hair', 'reason': 'dynamic-hair-simulation-unported:back'}, generated['gaps'])

    def test_the_chargrp_hair_fields_do_not_change_the_parts(self):
        other = synthetic_chargrp_row()
        other['hair_mesh'], other['hair_texture'] = [{'param_hair_mesh': 'Orc.MOrc_m000_m00_ah'}], [{'param_hair_texture': 'MOrc.Other'}]
        self.assertEqual(self.hair_parts(self.generated_with_hair()), self.hair_parts(self.generated_with_hair(row=other)))

    def test_the_hair_gap_reasons_are_listed(self):
        from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
        patterns = load_gap_reason_patterns()
        self.assertTrue(all(is_listed_reason(reason, patterns) for reason in ('hair-export-unresolved:back', 'hair-submesh-unlisted:front',
                                                                              'dynamic-hair-simulation-unported:back')))


class CharacterEdgeTests(unittest.TestCase):
    def generated(self, row, row_index=0, rows=None):
        return build_character_request(row, row_index, None, character_sources(rows or [row]))

    def test_sixteen_parts_request_and_seventeen_are_an_assembly_part_limit_gap_without_truncation(self):
        self.assertEqual(len(self.generated(synthetic_chargrp_row(body_mesh_count=16))['request']['parts']), 16)
        over = self.generated(synthetic_chargrp_row(body_mesh_count=17))
        self.assertIsNone(over['request'])
        self.assertEqual(over['gaps'][0], {'field': 'parts', 'reason': 'assembly-part-limit-exceeded:17'})

    def test_two_rows_sharing_a_mesh_keep_separate_requests(self):
        row = synthetic_chargrp_row()
        first, second = self.generated(row, 0, [row, row]), self.generated(row, 1, [row, row])
        self.assertEqual((first['request']['name'], second['request']['name']), ('character-0', 'character-1'))
        self.assertEqual(second['request']['parts'][0]['sourceBinding']['meshPath'][1], 1)

    def test_an_empty_face_mesh_is_a_face_gap_and_an_empty_texture_leaves_the_slot_unbound(self):
        row = synthetic_chargrp_row(face_mesh='')
        row['body_texture']['body_texture2'] = ''
        generated = self.generated(row)
        self.assertIn({'field': 'face', 'reason': 'no-mesh-in-row'}, generated['gaps'])
        self.assertEqual(generated['request']['parts'][1]['materials'], [])
        self.assertEqual(generated['request']['parts'][1]['sourceBinding']['texturePath'], ['Char', 0, 'body_texture', 'body_texture2'])
        self.assertEqual(generated['parts'][1], {'field': 'body_mesh2', 'status': 'requested-unbound', 'reason': None})

    def test_an_unqualified_reference_is_an_actor_default_gap_never_a_bare_name_fallback(self):
        row = synthetic_chargrp_row()
        row['body_mesh']['body_mesh1'] = 'Body_m001_1'
        generated = self.generated(row)
        self.assertEqual(generated['parts'][0], {'field': 'body_mesh1', 'status': 'gap', 'reason': 'actor-default-unresolved:body_mesh1'})
        self.assertNotIn('Body_m001_1', [part['object'] for part in generated['request']['parts']])

    def test_requests_are_byte_identical_across_runs_and_body_fields_sort_numerically(self):
        row = synthetic_chargrp_row(body_mesh_count=10)
        self.assertEqual(json.dumps(self.generated(row), sort_keys=True), json.dumps(self.generated(row), sort_keys=True))
        self.assertEqual([part['sourceBinding']['meshPath'][3] for part in self.generated(row)['request']['parts']],
                         [f'body_mesh{number}' for number in range(1, 11)])

    def test_a_row_without_body_mesh_is_padding_with_its_field_evidence_and_no_key(self):
        from actors.character_census import padding_census_row
        from actors.character_requests import is_padding_row
        row = {**synthetic_chargrp_row(), 'body_mesh': {'body_mesh1': '', 'body_mesh2': ''}}
        self.assertTrue(is_padding_row(row))
        census_row = padding_census_row(14, row)
        self.assertEqual((census_row['key'], census_row['padding']), (None, True))
        self.assertEqual(census_row['gaps'], [{'field': 'body_mesh1', 'reason': 'no-mesh-in-row'}, {'field': 'body_mesh2', 'reason': 'no-mesh-in-row'}])

    def test_a_census_gap_such_as_the_skeletal_gate_wins_before_any_conversion_attempt(self):
        from actors.character_conversion import model_gap_reason
        generated = self.generated(synthetic_chargrp_row())
        self.assertEqual(model_gap_reason('skeletal-licensee-unsupported:123/27', generated), 'skeletal-licensee-unsupported:123/27')
        self.assertIsNone(model_gap_reason(None, generated))

    def test_the_key_is_an_unpadded_index(self):
        from actors.character_requests import character_key
        self.assertEqual((character_key(0), character_key(14)), ('character:0', 'character:14'))


class ReferenceClientRowZeroCrossCheckTests(unittest.TestCase):
    def setUp(self):
        if not (REFERENCE_CLIENT / 'system' / 'chargrp.dat').is_file():
            self.skipTest('E:/Lineage2-client is absent; the row 0 cross-check needs the decoded chargrp table')

    def test_generated_row_zero_body_parts_equal_the_hand_written_male_fighter_body_parts(self):
        from native_catalog.tables import decode_table
        chargrp = decode_table(REFERENCE_CLIENT, 'chargrp')
        sources = CharacterSources(chargrp, decoded_shape_classinfo(), synthetic_hair_parts(rows=range(15)), refusing_class_reader,
                                   not_decided_class_sources(), synthetic_animation_families())
        generated = build_character_request(chargrp_row_at(chargrp, 0), 0, None, sources)
        recipe_parts = json.loads((ROOT / 'recipes' / 'native-mfighter.json').read_bytes())[0]['parts']
        recipe_body_parts = [{key: part[key] for key in ('package', 'object', 'materials', 'sourceBinding')}
                             for part in recipe_parts if 'sourceBinding' in part and part['sourceBinding']['meshPath'][2] == 'body_mesh']
        self.assertEqual(generated['request']['parts'], recipe_body_parts)


if __name__ == '__main__':
    unittest.main()
