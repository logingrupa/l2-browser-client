from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.character_head_part_routes import (RIGID_HEAD_BONE_UNRESOLVED_REASON_PREFIX, RIGID_HEAD_PART_ROUTE, SKINNED_HEAD_PART_ROUTE,
                                               SKINNED_PART_BONE_MISSING_REASON_PREFIX, generated_with_head_part_routes)
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns

BODY_OBJECT, FACE_OBJECT, HAIR_OBJECT = 'Body_m001_u', 'Face_m000_f', 'Hair_m000_h'
BODY_BONE_NAMES = ('Bip01', 'Bip01_spine', 'Bip01_neck', 'Bip01_head')
RIGID_ATTACHMENT = {'bone': 'Bip01_head', 'source': {'class': 'LineageWarrior.MMagic', 'bonePath': ['HeadBone'], 'meshPath': ['Mesh']}}


def chained_bones(names):
    return [{'name': name, 'parentName': names[index - 1] if index else None} for index, name in enumerate(names)]


def skeleton(object_name, bones, influenced_bone_indexes, aliases=()):
    return {'object': object_name, 'bones': bones, 'aliases': list(aliases), 'influencedBoneIndexes': influenced_bone_indexes}


def generated_request(head_parts, root_object=FACE_OBJECT):
    parts = [{'package': 'Magic', 'object': BODY_OBJECT, 'materials': ['0=MMagic.Body_t00']}] + head_parts
    return {'request': {'kind': 'model', 'name': 'character-8', 'animation': None, 'withEventAudio': True, 'parts': parts,
                        'limitations': ['synthetic request']},
            'rootMesh': {'reason': None, 'package': 'magic', 'object': root_object},
            'profileFields': {'reason': None}, 'parts': [], 'hair': {'status': 'bound', 'reason': None}, 'helmet': {}, 'gaps': [{'field': 'hair', 'reason': 'hair-submesh-unlisted:front'}]}


def face_part(object_name=FACE_OBJECT):
    return {'package': 'magic', 'object': object_name, 'materials': [], 'rigidAttachment': RIGID_ATTACHMENT}


def hair_part():
    return {'package': 'magic', 'object': HAIR_OBJECT, 'materials': ['0=MMagic.Hair.Hair_t00'], 'rigidAttachment': RIGID_ATTACHMENT,
            'hairSelection': {'recipe': 'recipes/actors/character-hair-parts.json', 'recipeSha256': 'a' * 64, 'meshType': 8, 'half': 'front',
                              'pawnSlot': 5, 'mappedStyle': 0, 'hairColor': 0}}


def skeleton_reader(skeletons_by_object):
    read_objects = []

    def read_skeleton(part):
        read_objects.append(part['object'])
        return skeletons_by_object[part['object']]
    return read_skeleton, read_objects


class SkinnedHeadPartRouteTests(unittest.TestCase):
    def test_a_skinned_face_whose_bones_all_exist_in_the_body_skeleton_converts_as_a_body_part(self):
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0, 1, 2]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES), [3])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        face = generated['request']['parts'][1]
        self.assertNotIn('rigidAttachment', face)
        self.assertEqual((face['package'], face['object'], face['materials']), ('magic', FACE_OBJECT, []))
        self.assertEqual(generated['headParts'], [{'field': 'face', 'label': 'face', 'object': FACE_OBJECT, 'route': SKINNED_HEAD_PART_ROUTE,
                                                   'boneCount': 4, 'bodyObject': BODY_OBJECT, 'missingBones': []}])
        self.assertIn(f'The face mesh {FACE_OBJECT} is skinned to 4 bones that all exist in the {BODY_OBJECT} skeleton; it converts as a body part.',
                      generated['request']['limitations'])
        self.assertEqual(generated['gaps'], [{'field': 'hair', 'reason': 'hair-submesh-unlisted:front'}])

    def test_a_root_only_rigid_face_keeps_the_rigid_path_on_its_own_head_index_found_through_the_alias_table(self):
        face_bones = chained_bones(('Bip01', 'Bip01_spine', 'Bip01_head'))
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0, 1]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, face_bones, [0], [{'alias': 'BIP01_HEAD', 'bone': 'bip01_spine'}])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        self.assertEqual(generated['request']['parts'][1]['rigidAttachment'], {**RIGID_ATTACHMENT, 'rootHeadBoneIndex': 1, 'rootPart': 1})
        self.assertEqual(generated['headParts'][0]['route'], RIGID_HEAD_PART_ROUTE)
        self.assertEqual(generated['request']['limitations'][1:], [
            f'The face mesh {FACE_OBJECT} is rigid; it follows bone 1 of the root mesh {FACE_OBJECT} with the root inverse bind at that index '
            '(RM-14) and carries no skeleton or animation of its own.'])

    def test_a_skinned_face_with_bones_outside_the_body_skeleton_is_a_gap_that_names_the_missing_bones(self):
        face_bones = chained_bones(BODY_BONE_NAMES + ('Bip01_jaw', 'Bip01_eye'))
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, face_bones, [3, 4])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        self.assertIsNone(generated['request'])
        self.assertEqual(generated['gaps'][0], {'field': 'face', 'reason': SKINNED_PART_BONE_MISSING_REASON_PREFIX + 'Bip01_jaw,Bip01_eye'})
        self.assertTrue(is_listed_reason(generated['gaps'][0]['reason'], load_gap_reason_patterns()))

    def test_a_bone_whose_name_exists_under_another_parent_is_missing(self):
        face_bones = [{'name': 'Bip01', 'parentName': None}, {'name': 'Bip01_head', 'parentName': 'Bip01'}]
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, face_bones, [1])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        self.assertEqual(generated['gaps'][0]['reason'], SKINNED_PART_BONE_MISSING_REASON_PREFIX + 'Bip01_head')

    def test_bone_names_compare_without_case(self):
        face_bones = chained_bones(tuple(name.upper() for name in BODY_BONE_NAMES))
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, face_bones, [3])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        self.assertEqual(generated['headParts'][0]['missingBones'], [])

    def test_a_part_with_a_hair_selection_routes_as_hair_and_a_root_only_hair_part_stays_rigid(self):
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            HAIR_OBJECT: skeleton(HAIR_OBJECT, chained_bones(BODY_BONE_NAMES), [0])})
        generated = generated_with_head_part_routes(generated_request([face_part(), hair_part()]), read_skeleton)
        self.assertEqual([(route['field'], route['route']) for route in generated['headParts']], [('face', 'rigid'), ('hair', 'rigid')])
        self.assertEqual(generated['request']['parts'][2]['rigidAttachment'], {**RIGID_ATTACHMENT, 'rootHeadBoneIndex': 3, 'rootPart': 1})

    def test_a_skinned_hair_part_with_a_bone_outside_the_body_skeleton_drops_only_that_hair_part(self):
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            HAIR_OBJECT: skeleton(HAIR_OBJECT, chained_bones(BODY_BONE_NAMES + ('Bip01_hair',)), [4])})
        generated = generated_with_head_part_routes(generated_request([face_part(), hair_part()]), read_skeleton)
        self.assertEqual(generated['gaps'][0], {'field': 'hair', 'reason': SKINNED_PART_BONE_MISSING_REASON_PREFIX + 'Bip01_hair'})
        self.assertEqual([part['object'] for part in generated['request']['parts']], [BODY_OBJECT, FACE_OBJECT])
        self.assertEqual((generated['hair']['status'], generated['hair']['reason']), ('gap', SKINNED_PART_BONE_MISSING_REASON_PREFIX + 'Bip01_hair'))
        self.assertEqual([route['field'] for route in generated['headParts']], ['face', 'hair'])

    def test_a_rigid_hair_part_with_spaced_bone_names_attaches_by_the_root_head_index_with_no_gap(self):
        spaced = [{'name': 'Bip01 Pelvis', 'parentName': None}, {'name': 'Bip01 head', 'parentName': 'Bip01 Pelvis'}]
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            HAIR_OBJECT: skeleton(HAIR_OBJECT, spaced, [0])})
        generated = generated_with_head_part_routes(generated_request([face_part(), hair_part()]), read_skeleton)
        self.assertEqual(generated['gaps'], [{'field': 'hair', 'reason': 'hair-submesh-unlisted:front'}])
        self.assertEqual(generated['request']['parts'][2]['rigidAttachment'], {**RIGID_ATTACHMENT, 'rootHeadBoneIndex': 3, 'rootPart': 1})
        self.assertEqual(generated['headParts'][1], {'field': 'hair', 'label': 'front', 'object': HAIR_OBJECT, 'boneCount': 2, 'route': 'rigid',
                                                     'rootObject': FACE_OBJECT, 'rootHeadBoneIndex': 3})

    def test_a_rigid_hair_part_whose_root_has_no_head_bone_is_an_unresolved_head_bone_gap(self):
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES), [3]),
                                            HAIR_OBJECT: skeleton(HAIR_OBJECT, chained_bones(BODY_BONE_NAMES), [0])})
        generated = generated_with_head_part_routes(generated_request([face_part(), hair_part()], root_object=BODY_OBJECT), read_skeleton)
        self.assertEqual(generated['gaps'][0], {'field': 'hair', 'reason': RIGID_HEAD_BONE_UNRESOLVED_REASON_PREFIX + 'front'})
        self.assertEqual([part['object'] for part in generated['request']['parts']], [BODY_OBJECT, FACE_OBJECT])
        self.assertTrue(is_listed_reason(generated['gaps'][0]['reason'], load_gap_reason_patterns()))

    def test_a_rigid_face_whose_root_lacks_the_head_bone_leaves_no_request(self):
        read_skeleton, _ = skeleton_reader({BODY_OBJECT: skeleton(BODY_OBJECT, chained_bones(BODY_BONE_NAMES), [0]),
                                            FACE_OBJECT: skeleton(FACE_OBJECT, chained_bones(BODY_BONE_NAMES[:2]), [0])})
        generated = generated_with_head_part_routes(generated_request([face_part()]), read_skeleton)
        self.assertIsNone(generated['request'])
        self.assertEqual(generated['gaps'][0], {'field': 'face', 'reason': RIGID_HEAD_BONE_UNRESOLVED_REASON_PREFIX + 'face'})

    def test_a_request_without_head_parts_reads_no_skeleton(self):
        read_skeleton, read_objects = skeleton_reader({})
        generated = generated_with_head_part_routes(generated_request([]), read_skeleton)
        self.assertEqual((generated['headParts'], read_objects), ([], []))

    def test_a_generated_row_without_a_request_is_kept(self):
        read_skeleton, read_objects = skeleton_reader({})
        generated = {**generated_request([]), 'request': None}
        self.assertEqual(generated_with_head_part_routes(generated, read_skeleton), {**generated, 'headParts': []})
        self.assertEqual(read_objects, [])


if __name__ == '__main__':
    unittest.main()
