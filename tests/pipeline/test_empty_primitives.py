import copy
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.empty_primitives import repair_empty_primitives
from native_assets_lib.gltf import Document


def fixture():
    return {
        'asset': {'version': '2.0'},
        'buffers': [{'byteLength': 36}],
        'bufferViews': [{'buffer': 0, 'byteLength': 0}, {'buffer': 0, 'byteLength': 36}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 0},
            {'bufferView': 1, 'componentType': 5126, 'type': 'VEC3', 'count': 3},
        ],
        'meshes': [{'name': 'native parts', 'primitives': [
            {'attributes': {'POSITION': 0}, 'material': 0},
            {'attributes': {'POSITION': 1}, 'material': 1},
        ]}],
        'materials': [{'name': 'empty native slot'}, {'name': 'used native slot'}],
        'nodes': [{'name': 'native mesh', 'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0,
    }


class EmptyPrimitiveTests(unittest.TestCase):
    def reject_unchanged(self, document, pattern):
        original = copy.deepcopy(document)
        with self.assertRaisesRegex(ValueError, pattern):
            repair_empty_primitives(document)
        self.assertEqual(document, original)

    def test_removes_only_demonstrated_empty_sections_and_records_exact_indices(self):
        document = fixture()
        materials, nodes, buffers = copy.deepcopy((document['materials'], document['nodes'], document['buffers']))
        report = repair_empty_primitives(document)
        self.assertEqual(report['removedPrimitives'], [{'mesh': 0, 'primitive': 0, 'material': 0, 'accessors': [0]}])
        self.assertEqual(report['primitiveRemaps'], [{'mesh': 0, 'oldToNew': [None, 0]}])
        self.assertEqual(report['removedAccessors'], [0])
        self.assertEqual(report['accessorRemap'], [None, 0])
        self.assertEqual(report['removedBufferViews'], [0])
        self.assertEqual(report['bufferViewRemap'], [None, 0])
        self.assertEqual(document['meshes'][0]['primitives'], [{'attributes': {'POSITION': 0}, 'material': 1}])
        self.assertEqual(document['accessors'][0]['bufferView'], 0)
        self.assertEqual((document['materials'], document['nodes'], document['buffers']), (materials, nodes, buffers))
        self.assertEqual(report['materialSlotCount'], 2)

    def test_remaps_all_core_accessor_and_view_references_including_sparse_morph_and_image(self):
        document = fixture()
        primitive = document['meshes'][0]['primitives'][1]
        primitive.update(indices=1, targets=[{'POSITION': 2}])
        document['animations'] = [{'samplers': [{'input': 1, 'output': 2}]}]
        document['skins'] = [{'inverseBindMatrices': 1, 'joints': [0]}]
        document['bufferViews'].extend([{'buffer': 0, 'byteLength': 1}, {'buffer': 0, 'byteLength': 4}, {'buffer': 0, 'byteLength': 12}])
        document['images'] = [{'bufferView': 2, 'mimeType': 'image/png'}]
        document['accessors'].append({'componentType': 5126, 'type': 'VEC3', 'count': 3,
            'sparse': {'count': 1, 'indices': {'bufferView': 3, 'componentType': 5125}, 'values': {'bufferView': 4}}})
        report = repair_empty_primitives(document)
        primitive = document['meshes'][0]['primitives'][0]
        self.assertEqual(primitive['attributes'], {'POSITION': 0})
        self.assertEqual(primitive['indices'], 0)
        self.assertEqual(primitive['targets'], [{'POSITION': 1}])
        self.assertEqual(document['animations'][0]['samplers'], [{'input': 0, 'output': 1}])
        self.assertEqual(document['skins'][0]['inverseBindMatrices'], 0)
        self.assertEqual(document['images'][0]['bufferView'], 1)
        self.assertEqual(document['accessors'][1]['sparse']['indices']['bufferView'], 2)
        self.assertEqual(document['accessors'][1]['sparse']['values']['bufferView'], 3)
        self.assertEqual(len(report['changedReferences']), 10)

    def test_noop_is_identity_and_a_repair_is_idempotent(self):
        document = fixture()
        repair_empty_primitives(document)
        original = copy.deepcopy(document)
        meshes = document['meshes']
        self.assertIsNone(repair_empty_primitives(document))
        self.assertEqual(document, original)
        self.assertIs(document['meshes'], meshes)

    def test_rejects_partial_emptiness_of_attributes_indices_and_morphs_transactionally(self):
        for change in ('attribute', 'indices', 'morph'):
            with self.subTest(change=change):
                document = fixture()
                primitive = document['meshes'][0]['primitives'][0]
                if change == 'attribute':
                    primitive['attributes']['NORMAL'] = 1
                elif change == 'indices':
                    primitive['indices'] = 1
                else:
                    primitive['targets'] = [{'POSITION': 1}]
                self.reject_unchanged(document, 'Partially empty')

    def test_rejects_wholly_empty_mesh_without_removing_nodes_or_slots(self):
        document = fixture()
        document['meshes'][0]['primitives'].pop()
        self.reject_unchanged(document, 'Wholly empty glTF mesh')

    def test_rejects_empty_accessors_still_used_by_animation_or_skin(self):
        for use in ('animation', 'skin'):
            with self.subTest(use=use):
                document = fixture()
                if use == 'animation':
                    document['animations'] = [{'samplers': [{'input': 0, 'output': 1}]}]
                else:
                    document['skins'] = [{'inverseBindMatrices': 0}]
                self.reject_unchanged(document, 'Empty glTF accessor remains referenced')

    def test_rejects_empty_views_still_used_by_image_or_nonempty_sparse_accessor(self):
        for use in ('image', 'sparse', 'accessor'):
            with self.subTest(use=use):
                document = fixture()
                if use == 'image':
                    document['images'] = [{'bufferView': 0}]
                elif use == 'sparse':
                    document['accessors'][1]['sparse'] = {'count': 1, 'indices': {'bufferView': 0}, 'values': {'bufferView': 1}}
                else:
                    document['accessors'][1]['bufferView'] = 0
                self.reject_unchanged(document, 'Empty glTF buffer view remains referenced')

    def test_preserves_nonempty_unused_accessors_and_views_even_if_empty_section_used_the_view(self):
        document = fixture()
        document['accessors'][0]['bufferView'] = 1
        document['accessors'].append({'bufferView': 1, 'componentType': 5126, 'type': 'VEC3', 'count': 3})
        document['bufferViews'].append({'buffer': 0, 'byteLength': 4, 'byteOffset': 0})
        report = repair_empty_primitives(document)
        self.assertEqual(report['removedAccessors'], [0])
        self.assertEqual(report['removedBufferViews'], [0])
        self.assertEqual(len(document['accessors']), 2)
        self.assertEqual([view['byteLength'] for view in document['bufferViews']], [36, 4])

    def test_rejects_unknown_extensions_even_on_a_removed_primitive(self):
        document = fixture()
        document['meshes'][0]['primitives'][0]['extensions'] = {'EXAMPLE_data': {'accessor': 1}}
        self.reject_unchanged(document, 'Unreviewed glTF extension')

    def test_rejects_invalid_indices_and_sparse_data_instead_of_hiding_corruption(self):
        for invalid in (-1, 99, True):
            with self.subTest(invalid=invalid):
                document = fixture()
                document['accessors'][0]['bufferView'] = invalid
                self.reject_unchanged(document, 'Invalid glTF reference')
        document = fixture()
        document['accessors'][0]['sparse'] = {'count': 1, 'indices': {'bufferView': 1}, 'values': {'bufferView': 1}}
        self.reject_unchanged(document, 'nonempty sparse data')

    def test_real_buffer_bytes_survive_bounds_repair_and_glb_packing(self):
        document = Document.__new__(Document)
        document.data = fixture()
        payload = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
        document.binary = bytearray(payload)
        document.repairs = []
        report = repair_empty_primitives(document.data)
        self.assertTrue(report['bytesPreserved'])
        document.data['bufferViews'][0]['byteOffset'] = 0
        document.repair_bounds()
        document.repair_vertex_metadata()
        packed = document.glb()
        json_bytes = struct.unpack_from('<I', packed, 12)[0]
        self.assertEqual(packed[28 + json_bytes:], payload)
        self.assertEqual(bytes(document.binary), payload)
        self.assertEqual(json.loads(packed[20:20 + json_bytes])['materials'], fixture()['materials'])


if __name__ == '__main__':
    unittest.main()
