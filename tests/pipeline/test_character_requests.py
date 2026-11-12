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


def decoded_shape_hairgrp():
    return {'sourceSha256': 'c' * 64, 'records': [[[0, 0], [1, 1], [-1, -1]], [[0, 0], [-1, 2], [-1, -1]]]}


def decoded_shape_helmetgrp():
    return {'sourceSha256': 'd' * 64, 'records': [{'key': 1, 'pairs': [[[0, 0], [1, 1]]]}, {'key': 2, 'pairs': [[[0, 0], [1, 1]]]}]}


CLASS_SOURCES_RESULT_SHA256 = '9' * 64
SOURCED_CLASS_PACKAGE_SHA256 = '7' * 64


def class_sources_result(verdict, rows):
    return {'path': CHARACTER_CLASS_SOURCES_RELATIVE_PATH, 'sha256': CLASS_SOURCES_RESULT_SHA256, 'document': {'verdict': verdict, 'rows': rows}}


def not_decided_class_sources():
    return class_sources_result('not-decided', {'0': {'candidateCount': 0, 'actorClass': None, 'classPackageSha256': None}})


def refusing_class_reader(reference):
    raise AssertionError(f'no class may be read without a source join: {reference}')


def character_sources(rows, classinfo=None, hairgrp=None, helmetgrp=None, read_class_definition=refusing_class_reader, class_sources=None):
    return CharacterSources(synthetic_chargrp_table(rows), classinfo or decoded_shape_classinfo(), hairgrp or decoded_shape_hairgrp(),
                            helmetgrp or decoded_shape_helmetgrp(), read_class_definition, class_sources or not_decided_class_sources())


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

    def test_hair_and_helmet_are_gaps_when_no_decoded_record_joins_the_row(self):
        self.assertEqual((self.generated['hair']['status'], self.generated['hair']['reason'], self.generated['hair']['joinField']),
                         ('gap', 'hair-layout-undecoded', None))
        self.assertEqual((self.generated['helmet']['status'], self.generated['helmet']['reason'], self.generated['helmet']['joinField']),
                         ('gap', 'helmet-layout-undecoded', None))
        self.assertEqual(self.generated['helmet']['recordFields'], ['key', 'pairs'])
        self.assertNotIn('DarkElf', json.dumps(self.generated['request']))

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
        face = face['request']['parts'][-1]
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

    def test_several_face_textures_leave_the_face_slot_unbound_instead_of_choosing_one(self):
        row = synthetic_chargrp_row(face_textures=('MFighter.Face_t00', 'MFighter.Face_t01'))
        actor_class = joined_actor_class({'HeadBone': 'Bip01_head'})
        generated = build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class)))
        face = generated['request']['parts'][-1]
        self.assertEqual(face['materials'], [])
        self.assertNotIn('sourceBinding', face)
        self.assertEqual(face['rigidAttachment']['source']['meshPath'], ['Mesh'])
        self.assertIn(f'The face mesh is chargrp Char/0/face_mesh/0, checked against the {JOINED_CLASS} Mesh default; its 2 face_texture entries '
                      'leave slot 0 unbound until a source selects one.', generated['request']['limitations'])

    def test_every_generated_table_binding_passes_the_converter_binding_check(self):
        from native_assets_lib.source_table_binding import verify_source_table_binding
        for face_textures in (('MFighter.Face_m000_t00_f',), ('MFighter.Face_t00', 'MFighter.Face_t01')):
            row = synthetic_chargrp_row(face_textures=face_textures)
            row['body_texture']['body_texture2'] = ''
            actor_class = joined_actor_class({'HeadBone': 'Bip01_head'})
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
        limitation = [line for line in generated['request']['limitations'] if SOURCED_CLASS in line]
        self.assertEqual(len(limitation), 1)
        for cited in (CHARACTER_CLASS_SOURCES_RELATIVE_PATH, CLASS_SOURCES_RESULT_SHA256, SOURCED_CLASS_PACKAGE_SHA256):
            self.assertIn(cited, limitation[0])
        self.assertEqual(generated['request']['parts'][-1]['rigidAttachment']['source']['class'], SOURCED_CLASS)

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

    def test_an_adopted_class_borrows_no_animation_and_a_mesh_without_one_stays_animation_reference_missing(self):
        from unittest import mock
        from actors import character_conversion
        from actors.character_conversion import CharacterConversionRun
        from actors.npc_requests import ANIMATION_REFERENCE_MISSING_REASON
        row = synthetic_chargrp_row()
        sources = character_sources([row], read_class_definition=sourced_class_reader(), class_sources=adopted_class_sources())
        request = build_character_request(row, 0, sourced_actor_class(sources), sources)['request']
        self.assertIsNone(request['animation'])
        converter = mock.Mock()
        converter.package.return_value = (None, type('PackageDouble', (), {'package_name': 'Fighter'})())
        run = type('RunDouble', (), {'converter': converter, 'client_access': None})()
        with mock.patch.object(character_conversion, 'serialized_animation_reference', return_value=None):
            self.assertEqual(CharacterConversionRun.converted_model_reason(run, request), (ANIMATION_REFERENCE_MISSING_REASON, None))
        converter.convert.assert_not_called()


class CharacterLayoutJoinTests(unittest.TestCase):
    def generated_with_hair(self, records, actor_class=None, table='hairgrp'):
        row = {**synthetic_chargrp_row(), 'template_key': 0}
        manifests = {'hairgrp': joined_layout_manifest(records) if table == 'hairgrp' else None,
                     'helmetgrp': joined_layout_manifest(records) if table == 'helmetgrp' else None}
        return build_character_request(row, 0, actor_class, character_sources([row], read_class_definition=joined_class_reader(actor_class),
                                                                              **manifests))

    def test_one_joined_record_binds_the_hair_texture_with_its_citation_and_the_field_proof(self):
        from data.hair_table_adapter import HAIR_TABLE_FIELD_PROOF
        generated = self.generated_with_hair([hair_record(1), hair_record(0)])
        hair_part = generated['request']['parts'][-1]
        self.assertEqual((hair_part['package'], hair_part['object'], hair_part['materials']), ('Fighter', 'Hair_m000_ah', ['0=MFighter.Hair_m000_t00_ah']))
        self.assertEqual(hair_part['layoutBinding'], {'table': 'hairgrp', 'sourceSha256': 'f' * 64, 'recordOrdinal': 1,
                                                      'fieldPath': ['hair_texture', 0, 'param_hair_texture']})
        self.assertEqual((generated['hair']['joinField'], generated['hair']['candidateCount']), ('template_key', 1))
        self.assertTrue(any(HAIR_TABLE_FIELD_PROOF in limitation for limitation in generated['request']['limitations']))

    def test_a_joined_hair_mesh_in_the_class_sub_meshes_attaches_to_the_head_bone(self):
        actor_class = joined_actor_class({'HeadBone': 'Bip01_head', 'SubMeshes': [None, {'class': 'SkeletalMesh', 'object': 'Fighter.Hair_m000_ah'}]})
        hair_part = self.generated_with_hair([hair_record(0)], actor_class)['request']['parts'][-1]
        self.assertEqual(hair_part['rigidAttachment']['source']['meshPath'], ['SubMeshes', 1])

    def test_several_colour_records_or_no_joined_record_stay_hair_gaps_with_the_candidate_count(self):
        for records, count in (([hair_record(0, ('MFighter.Hair_t00', 'MFighter.Hair_t01'))], 2), ([hair_record(0), hair_record(0)], 2),
                               ([hair_record(5)], 0)):
            with self.subTest(count=count):
                generated = self.generated_with_hair(records)
                self.assertEqual((generated['hair']['status'], generated['hair']['reason'], generated['hair']['candidateCount']),
                                 ('gap', 'hair-layout-undecoded', count))
                self.assertNotIn('Hair', json.dumps(generated['request']['parts']))

    def test_the_same_rules_on_helmetgrp_give_helmet_gaps(self):
        generated = self.generated_with_hair([hair_record(0, ('MFighter.Hair_t00', 'MFighter.Hair_t01'))], table='helmetgrp')
        self.assertEqual((generated['helmet']['reason'], generated['helmet']['candidateCount']), ('helmet-layout-undecoded', 2))


class CharacterCollisionChainTests(unittest.TestCase):
    def profile(self, definitions):
        from actors.character_requests import character_profile_fields
        return character_profile_fields(joined_actor_class(definitions[JOINED_CLASS]['properties']), class_definitions(definitions))

    def test_declared_values_are_copied_exactly_and_an_omitted_value_comes_from_the_declared_parent(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 23.0001}, 'nativeSuperClass': 'LineageWarrior.LineagePawn'},
                                'LineageWarrior.LineagePawn': {'properties': {'CollisionRadius': 9.999}, 'nativeSuperClass': None}})
        self.assertEqual(profile['collision'], {'collisionRadius': {'value': 9.999, 'class': 'LineageWarrior.LineagePawn'},
                                                'collisionHeight': {'value': 23.0001, 'class': JOINED_CLASS}})
        self.assertEqual(profile['reason'], 'actor-default-unresolved:WaitAnimName')
        self.assertEqual(profile['actorClassDefaults'], {'class': JOINED_CLASS, 'classPackageSha256': CLASS_PACKAGE_SHA256,
                                                         'HeadBone': None, 'RightHandBone': None})

    def test_a_value_absent_through_the_whole_ancestry_stays_actor_default_unresolved(self):
        profile = self.profile({JOINED_CLASS: {'properties': {'CollisionHeight': 22.5}, 'nativeSuperClass': 'Engine.Pawn'},
                                'Engine.Pawn': {'properties': {}, 'nativeSuperClass': None}})
        self.assertEqual(profile['reason'], 'actor-default-unresolved:CollisionRadius')
        self.assertEqual(profile['collision']['collisionRadius']['classChain'], [JOINED_CLASS, 'Engine.Pawn'])

    def test_the_female_fighter_row_is_compared_with_the_audit_values_and_never_adjusted(self):
        stage = json.loads((ROOT / 'recipes' / 'native-player-ffighter-stage.json').read_bytes())
        audit_values = {field: entry['previousValue'] for field, entry in stage['profiles'][0]['unresolved'].items()}
        row = synthetic_chargrp_row()
        generated = build_character_request(row, 1, None, character_sources([row, row]))
        self.assertEqual((generated['profileFields']['reason'], generated['profileFields']['collision']), (CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, None))
        self.assertEqual(audit_values, {'collisionRadius': 8, 'collisionHeight': 23.5})
        for module in ('character_requests.py', 'character_conversion.py', 'character_census.py', 'convert_actors.py'):
            self.assertNotIn('previousValue', (ROOT / 'scripts' / 'actors' / module).read_text(encoding='utf-8'))


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
        sources = CharacterSources(chargrp, decoded_shape_classinfo(), decoded_shape_hairgrp(), decoded_shape_helmetgrp(), refusing_class_reader,
                                   not_decided_class_sources())
        generated = build_character_request(chargrp_row_at(chargrp, 0), 0, None, sources)
        recipe_parts = json.loads((ROOT / 'recipes' / 'native-mfighter.json').read_bytes())[0]['parts']
        recipe_body_parts = [{key: part[key] for key in ('package', 'object', 'materials', 'sourceBinding')}
                             for part in recipe_parts if 'sourceBinding' in part and part['sourceBinding']['meshPath'][2] == 'body_mesh']
        self.assertEqual(generated['request']['parts'], recipe_body_parts)


if __name__ == '__main__':
    unittest.main()
