import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.character_conversion import CharacterSources
from actors.character_requests import (CLASS_TEMPLATE_MAPPING_UNDECODED_REASON, build_character_request, chargrp_row_at,
                                       resolve_character_actor_class)

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


def refusing_class_reader(reference):
    raise AssertionError(f'no class may be read without a source join: {reference}')


def character_sources(rows, classinfo=None, hairgrp=None, helmetgrp=None, read_class_definition=refusing_class_reader):
    return CharacterSources(synthetic_chargrp_table(rows), classinfo or decoded_shape_classinfo(), hairgrp or decoded_shape_hairgrp(),
                            helmetgrp or decoded_shape_helmetgrp(), read_class_definition)


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
        resolution = resolve_character_actor_class(decoded_shape_classinfo(), 0)
        self.assertIsNone(resolution['class'])
        self.assertEqual(resolution['reason'], CLASS_TEMPLATE_MAPPING_UNDECODED_REASON)
        self.assertEqual(resolution['evidence']['fields'], ['class', 'description'])


class ReferenceClientRowZeroCrossCheckTests(unittest.TestCase):
    def setUp(self):
        if not (REFERENCE_CLIENT / 'system' / 'chargrp.dat').is_file():
            self.skipTest('E:/Lineage2-client is absent; the row 0 cross-check needs the decoded chargrp table')

    def test_generated_row_zero_body_parts_equal_the_hand_written_male_fighter_body_parts(self):
        from native_catalog.tables import decode_table
        chargrp = decode_table(REFERENCE_CLIENT, 'chargrp')
        sources = CharacterSources(chargrp, decoded_shape_classinfo(), decoded_shape_hairgrp(), decoded_shape_helmetgrp(), refusing_class_reader)
        generated = build_character_request(chargrp_row_at(chargrp, 0), 0, None, sources)
        recipe_parts = json.loads((ROOT / 'recipes' / 'native-mfighter.json').read_bytes())[0]['parts']
        recipe_body_parts = [{key: part[key] for key in ('package', 'object', 'materials', 'sourceBinding')}
                             for part in recipe_parts if 'sourceBinding' in part and part['sourceBinding']['meshPath'][2] == 'body_mesh']
        self.assertEqual(generated['request']['parts'], recipe_body_parts)


if __name__ == '__main__':
    unittest.main()
