import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors.character_head_part_routes import is_resolved_head_bone_index, match_reference_bone, skeleton_summary
from native_assets import apply_native_mesh_transform
from native_assets_lib.animation import GLTF_METRES_PER_NATIVE_UNIT, gltf_rotation_from_native, gltf_translation_from_native
from native_assets_lib.gltf import Document
from native_assets_lib.rigid import attach_rigid_head_parts

RM14_FIXTURE = json.loads((ROOT / 'tests/pipeline/fixtures/rm14-rigid-hair-vertex.json').read_text(encoding='utf-8'))
FLOAT32_ULP_AT_320 = 3.0517578125e-05
CONVERSION_CLIENT_ANIMATIONS = Path('E:/Lineage2-client/animations')
IDENTITY = [[1.0 if row == column else 0.0 for column in range(4)] for row in range(4)]


def multiply(left, right):
    return [[sum(left[row][k] * right[k][column] for k in range(4)) for column in range(4)] for row in range(4)]


def transform_point(matrix, point):
    return [sum(matrix[row][k] * value for k, value in enumerate((*point, 1.0))) for row in range(3)]


def column_major(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


def from_column_major(values):
    return [[values[column * 4 + row] for column in range(4)] for row in range(4)]


def rigid_matrix(translation, quaternion):
    x, y, z, w = quaternion
    rotation = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]]
    return [[*rotation[row], translation[row]] for row in range(3)] + [[0.0, 0.0, 0.0, 1.0]]


def rigid_inverse(matrix):
    rotation = [[matrix[column][row] for column in range(3)] for row in range(3)]
    translation = [-sum(rotation[row][k] * matrix[k][3] for k in range(3)) for row in range(3)]
    return [[*rotation[row], translation[row]] for row in range(3)] + [[0.0, 0.0, 0.0, 1.0]]


def fcoords_matrix(fcoords):
    origin, axes = fcoords[:3], [fcoords[3:6], fcoords[6:9], fcoords[9:12]]
    return [[*axes[row], origin[row]] for row in range(3)] + [[0.0, 0.0, 0.0, 1.0]]


def gltf_point(native_point):
    return list(gltf_translation_from_native(native_point))


def native_point(gltf_values, location):
    x, y, z = (value / GLTF_METRES_PER_NATIVE_UNIT for value in gltf_values)
    return [x + location[0], z + location[1], y + location[2]]


def chain_matrix(local_bones):
    matrix = IDENTITY
    for bone in local_bones:
        matrix = multiply(matrix, rigid_matrix(gltf_translation_from_native(bone['position']),
                                               gltf_rotation_from_native(bone['quaternion'], bone['boneIndex'] == 0)))
    return matrix


def mesh_transform_parent(scale, origin, rotation):
    dump = (f'MeshOrigin = {{ X={origin[0]!r} Y={origin[1]!r} Z={origin[2]!r} }}\n'
            f'MeshScale = {{ X={scale[0]!r} Y={scale[1]!r} Z={scale[2]!r} }}\n'
            f'RotOrigin = {{ Pitch={rotation["Pitch"]} Yaw={rotation["Yaw"]} Roll={rotation["Roll"]} }}\n')
    document = SimpleNamespace(data={'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'mesh', 'skin': 0, 'children': [1]}, {'name': 'Bip01'}]})
    return from_column_major(apply_native_mesh_transform(document, dump)['gltfParentMatrix'])


def world_vertex(parent, joint_world, inverse_bind, vertex, location):
    return native_point(transform_point(multiply(multiply(parent, joint_world), inverse_bind), gltf_point(vertex)), location)


class RootHeadBoneIndexTests(unittest.TestCase):
    def skeleton(self, names, aliases=()):
        return {'bones': [{'name': name} for name in names], 'aliases': [{'alias': alias, 'bone': bone} for alias, bone in aliases]}

    def test_the_alias_table_applies_before_the_case_insensitive_name_search(self):
        skeleton = self.skeleton(['Bip01', 'Bip01_Spine', 'Bip01_head'], [('bip01_HEAD', 'Bip01_spine')])
        self.assertEqual(match_reference_bone(skeleton, 'Bip01_head'), 1)
        self.assertEqual(match_reference_bone(self.skeleton(['Bip01', 'BIP01_HEAD'], [('e_bone', 'Bip01')]), 'Bip01_head'), 1)

    def test_a_missing_bone_is_minus_one_and_minus_one_or_an_index_past_the_bones_is_unresolved(self):
        skeleton = self.skeleton(['Bip01', 'Bip01 head'])
        self.assertEqual(match_reference_bone(skeleton, 'Bip01_head'), -1)
        self.assertEqual([is_resolved_head_bone_index(index, skeleton) for index in (-1, 0, 1, 2)], [False, True, True, False])
        self.assertFalse(is_resolved_head_bone_index(0, None))

    @unittest.skipUnless(CONVERSION_CLIENT_ANIMATIONS.is_dir(), 'needs the conversion client E:/Lineage2-client')
    def test_the_root_face_head_index_is_6_for_mfighter_and_morc_and_16_for_fmagic(self):
        from native_catalog.skeletal import decode_skeletal_source
        from native_catalog.ue2 import Package
        indexes = {}
        for package_name, export_name in (('Fighter', 'MFighter_m000_f'), ('Orc', 'MOrc_m000_f'), ('Magic', 'FMagic_m000_f')):
            package = Package((CONVERSION_CLIENT_ANIMATIONS / f'{package_name}.ukx').read_bytes(), f'{package_name}.ukx')
            item = next(item for item in package.exports if item['name'] == export_name and item['className'] == 'SkeletalMesh')
            indexes[export_name] = match_reference_bone(skeleton_summary(decode_skeletal_source(package, item)), 'Bip01_head')
        self.assertEqual(indexes, {'MFighter_m000_f': 6, 'MOrc_m000_f': 6, 'FMagic_m000_f': 16})


class NativeHeadPaletteFixtureTests(unittest.TestCase):
    def test_rm13_the_head_palette_with_the_inverse_reference_gives_1_5_21_not_1_5_31_and_lands_at_the_world_point(self):
        pose = fcoords_matrix([3, 4, 20, 0, -1, 0, 1, 0, 0, 0, 0, 1])
        inverse_reference = fcoords_matrix([0, 0, -10, 1, 0, 0, 0, 1, 0, 0, 0, 1])
        vertex = [1, 2, 11]
        self.assertEqual(transform_point(multiply(pose, inverse_reference), vertex), [1, 5, 21])
        self.assertEqual(transform_point(pose, vertex), [1, 5, 31])
        parent = mesh_transform_parent([1.0299999713897705] * 3, [0.0, 0.0, 25.200000762939453], {'Yaw': 49152, 'Pitch': 0, 'Roll': 0})
        landed = native_point(transform_point(parent, gltf_point([1, 5, 21])), [100, 200, 300])
        for value, expected in zip(landed, (105.1500015, 198.9700012, 295.6740112)):
            self.assertAlmostEqual(value, expected, delta=FLOAT32_ULP_AT_320)

    def test_rm14_character_0_hair_vertex_0_lands_on_the_fixture_at_frames_0_and_5_and_in_the_bind_pose(self):
        parent = mesh_transform_parent(RM14_FIXTURE['meshScale'], RM14_FIXTURE['meshOrigin'], RM14_FIXTURE['rotOrigin'])
        bind = next(pose for pose in RM14_FIXTURE['poses'] if pose['bindReferenceComparison'])
        inverse_bind = rigid_inverse(chain_matrix(bind['localBones']))
        landed = {}
        for pose in RM14_FIXTURE['poses']:
            label = 'bind' if pose['bindReferenceComparison'] else pose['frame']
            landed[label] = world_vertex(parent, chain_matrix(pose['localBones']), inverse_bind, RM14_FIXTURE['vertex0'], RM14_FIXTURE['actorLocation'])
            for value, expected in zip(landed[label], pose['worldVertex']):
                self.assertAlmostEqual(value, expected, delta=FLOAT32_ULP_AT_320, msg=f'pose {label}')
        self.assertEqual(sorted(landed, key=str), [0, 5, 'bind'])


def write_skinned_part(folder, name, joint_names, inverse_binds, with_clip):
    payload = struct.pack('<3f', 0.0, 0.0, 0.02) + bytes([0, 0, 0, 0, 255, 0, 0, 0])
    payload += b''.join(struct.pack('<16f', *column_major(matrix)) for matrix in inverse_binds)
    views = [{'buffer': 0, 'byteOffset': 0, 'byteLength': 12}, {'buffer': 0, 'byteOffset': 12, 'byteLength': 4},
             {'buffer': 0, 'byteOffset': 16, 'byteLength': 4}, {'buffer': 0, 'byteOffset': 20, 'byteLength': 64 * len(inverse_binds)}]
    accessors = [{'bufferView': 0, 'componentType': 5126, 'count': 1, 'type': 'VEC3'}, {'bufferView': 1, 'componentType': 5121, 'count': 1, 'type': 'VEC4'},
                 {'bufferView': 2, 'componentType': 5121, 'count': 1, 'type': 'VEC4', 'normalized': True},
                 {'bufferView': 3, 'componentType': 5126, 'count': len(inverse_binds), 'type': 'MAT4'}]
    joints = list(range(2, 2 + len(joint_names)))
    nodes = [{'name': name, 'mesh': 0, 'skin': 0}, {'name': 'NativeMeshOriginRotationScale', 'matrix': column_major(IDENTITY), 'children': [2]}]
    nodes += [{'name': joint, 'translation': [0.0, 0.0, 0.01], **({'children': [index + 3]} if index + 1 < len(joint_names) else {})}
              for index, joint in enumerate(joint_names)]
    data = {'asset': {'version': '2.0'}, 'buffers': [{'uri': name + '.bin', 'byteLength': 0}], 'bufferViews': views, 'accessors': accessors,
            'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'JOINTS_0': 1, 'WEIGHTS_0': 2}}]}],
            'nodes': nodes, 'skins': [{'joints': joints, 'inverseBindMatrices': 3, 'skeleton': 2}], 'scenes': [{'nodes': [0, 1]}]}
    if with_clip:
        times = struct.pack('<2f', 0.0, 1.0) + struct.pack('<8f', 0, 0, 0, 1, 0, 0, 0.7071068, 0.7071068)
        views += [{'buffer': 0, 'byteOffset': len(payload), 'byteLength': 8}, {'buffer': 0, 'byteOffset': len(payload) + 8, 'byteLength': 32}]
        accessors += [{'bufferView': 4, 'componentType': 5126, 'count': 2, 'type': 'SCALAR', 'min': [0.0], 'max': [1.0]},
                      {'bufferView': 5, 'componentType': 5126, 'count': 2, 'type': 'VEC4'}]
        payload += times
        data['animations'] = [{'name': 'Wait', 'samplers': [{'input': 4, 'output': 5}], 'channels': [{'sampler': 0, 'target': {'node': joints[-1], 'path': 'rotation'}}]}]
    data['buffers'][0]['byteLength'] = len(payload)
    (folder / (name + '.bin')).write_bytes(payload)
    (folder / (name + '.gltf')).write_text(json.dumps(data), encoding='utf-8')
    return Document(folder / (name + '.gltf'))


def part_layout(request, name, skin, node_start, node_count, bone_count, parent_matrix):
    return {'request': request, 'object': name, 'skin': skin, 'nodeStart': node_start, 'nodeCount': node_count,
            'weights': {'boneMapping': [{'sourceBoneIndex': index, 'paletteIndex': index} for index in range(bone_count)]},
            'meshTransform': {'gltfParentMatrix': parent_matrix}}


def head_inverse_bind(height):
    return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, -height], [0.0, 0.0, 0.0, 1.0]]


class RigidHeadPartAssemblyTests(unittest.TestCase):
    def assembled(self, hair_attachment=None, hair_parent=None):
        self.directory = tempfile.TemporaryDirectory()
        folder = Path(self.directory.name)
        face = write_skinned_part(folder, 'Face', ['Bip01', 'Bip01_head'], [IDENTITY, head_inverse_bind(0.02)], True)
        hair = write_skinned_part(folder, 'Hair', ['Bip01', 'Bip01 head'], [IDENTITY, head_inverse_bind(5.0)], False)
        parent = column_major(IDENTITY)
        face_request = {'package': 'Fighter', 'object': 'Face', 'rigidAttachment': {'bone': 'Bip01_head', 'rootHeadBoneIndex': 1, 'rootPart': 0}}
        hair_request = {'package': 'Fighter', 'object': 'Hair',
                        'rigidAttachment': hair_attachment or {'bone': 'Bip01_head', 'rootHeadBoneIndex': 1, 'rootPart': 0}}
        layouts = [part_layout(face_request, 'Face', 0, 0, len(face.data['nodes']), 2, parent),
                   part_layout(hair_request, 'Hair', 1, len(face.data['nodes']), len(hair.data['nodes']), 2, hair_parent or parent)]
        face.merge(hair)
        return face, attach_rigid_head_parts(face, layouts)

    def tearDown(self):
        self.directory.cleanup()

    def test_a_rigid_part_points_its_single_joint_at_the_root_head_node_with_the_root_inverse_bind_and_loses_its_own_skeleton(self):
        document, records = self.assembled()
        face_skin, hair_skin = document.data['skins']
        self.assertEqual((face_skin['joints'], hair_skin['joints']), ([3], [3]))
        root_inverse_bind = struct.pack('<16f', *column_major(head_inverse_bind(0.02)))
        for skin in (face_skin, hair_skin):
            accessor = document.data['accessors'][skin['inverseBindMatrices']]
            start = document.data['bufferViews'][accessor['bufferView']]['byteOffset']
            self.assertEqual(bytes(document.binary[start:start + 64]), root_inverse_bind)
        self.assertEqual([node.get('name') for node in document.data['nodes']], ['Face', 'NativeMeshOriginRotationScale', 'Bip01', 'Bip01_head', 'Hair'])
        self.assertEqual(document.data['scenes'][0]['nodes'], [0, 1, 4])
        self.assertEqual([channel['target']['node'] for channel in document.data['animations'][0]['channels']], [3])
        self.assertEqual({index: (record['bone'], record['rootHeadBoneIndex'], record['removedOwnSkeletonNodes']) for index, record in records.items()},
                         {0: ('Bip01_head', 1, 0), 1: ('Bip01_head', 1, 3)})

    def test_the_hair_vertex_follows_the_root_head_joint(self):
        document, _ = self.assembled()
        head_world = multiply(multiply(from_column_major(document.data['nodes'][1]['matrix']), rigid_matrix([0, 0, 0.01], [0, 0, 0, 1])),
                              rigid_matrix([0, 0, 0.01], [0, 0, 0, 1]))
        self.assertEqual([round(value, 6) for value in transform_point(multiply(head_world, head_inverse_bind(0.02)), [0.0, 0.0, 0.02])], [0, 0, 0.02])

    def test_a_missing_root_part_and_a_different_mesh_transform_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'lacks its root part and root head bone index'):
            self.assembled(hair_attachment={'bone': 'Bip01_head'})
        self.directory.cleanup()
        with self.assertRaisesRegex(ValueError, 'Hair mesh transform differs from its root Face'):
            self.assembled(hair_parent=column_major([[2.0 if row == column else 0.0 for column in range(4)] for row in range(4)]))


if __name__ == '__main__':
    unittest.main()
