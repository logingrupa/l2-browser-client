import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import Converter, sha
from native_assets_lib.gltf import Document
from native_assets_lib.source_table_binding import material_overrides_by_slot, source_slot_bindings, verify_source_table_binding
from native_catalog.tables import CRYPTO_SOURCE, SCHEMA_ROOT, decode_table
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from reference_client_lock_fixture import lock_client_as_reference_root

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
FIXTURE_MESH = 'Fixture.mesh'
FIXTURE_FIRST_TEXTURE = 'FixtureTex.a'
FIXTURE_SECOND_TEXTURE = 'FixtureTex.b'
FIXTURE_THIRD_TEXTURE = 'FixtureTex.c'
ONE_PIXEL_PNG = b'\x89PNG\r\n\x1a\n' + b'fixture one-pixel payload'
NPCGRP_SOURCE_BYTES = b'arbitrary npcgrp bytes'


def synthetic_npcgrp_table(textures):
    return {'schema': {'file': 'dats/npcgrp.xml'}, 'decodedSha256': sha(b'synthetic decoded npcgrp'),
            'data': {'npc': [{'npc_id': 1, 'mesh_name': FIXTURE_MESH,
                              'texture_name': [{'param_texture_name': texture} for texture in textures]}]}}


def texture_field_path(index):
    return ['npc', 0, 'texture_name', index, 'param_texture_name']


def slot_list_request(slots, materials):
    return {'package': 'Fixture', 'object': 'mesh', 'materials': materials,
            'sourceBinding': {'table': 'npcgrp', 'sourceSha256': sha(NPCGRP_SOURCE_BYTES), 'meshPath': ['npc', 0, 'mesh_name'],
                              'slotBindings': [{'slot': slot, 'texturePath': texture_field_path(slot)} for slot in slots]}}


def three_material_document(root):
    payload = struct.pack('<6f', 0, 0, 0, 1, 1, 1)
    (root / 'mesh.bin').write_bytes(payload)
    (root / 'mesh.gltf').write_text(json.dumps({'asset': {'version': '2.0'}, 'buffers': [{'uri': 'mesh.bin', 'byteLength': len(payload)}],
        'bufferViews': [{'buffer': 0, 'byteLength': len(payload)}],
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 2, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1, 1, 1]}],
        'materials': [{}, {}, {}], 'nodes': [{'name': 'mesh'}], 'scenes': [{'nodes': [0]}]}))
    return Document(root / 'mesh.gltf')


class PackageStub:
    imports = []
    exports = []


class ConverterSlotBindingTests(unittest.TestCase):
    def converter_on_temporary_client(self, root):
        client = root / 'source'
        (client / 'system').mkdir(parents=True)
        (client / 'system' / 'npcgrp.dat').write_bytes(NPCGRP_SOURCE_BYTES)
        lock_client_as_reference_root(self, client)
        tool = root / 'tool.exe'
        tool.write_bytes(b'not executed by the binding verifier')
        umodel_hash = patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes()))
        umodel_hash.start()
        self.addCleanup(umodel_hash.stop)
        return Converter(client, root / 'artifacts' / 'output', tool, project_root=root)

    def test_two_cited_slots_bind_from_the_table_and_the_uncited_third_slot_stays_magenta(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            converter = self.converter_on_temporary_client(root)
            request = slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE, '1=' + FIXTURE_SECOND_TEXTURE])
            table = synthetic_npcgrp_table([FIXTURE_FIRST_TEXTURE, FIXTURE_SECOND_TEXTURE])
            with patch('native_catalog.tables.decode_table', return_value=table):
                evidence = converter.verify_binding(request)
            self.assertEqual(evidence['slotBindings'], [
                {'slot': 0, 'texturePath': texture_field_path(0), 'textureReference': FIXTURE_FIRST_TEXTURE},
                {'slot': 1, 'texturePath': texture_field_path(1), 'textureReference': FIXTURE_SECOND_TEXTURE}])
            self.assertEqual(evidence['meshReference'], FIXTURE_MESH)
            work = root / 'work'
            work.mkdir()
            document = three_material_document(work)
            dump = 'Sections[0] = { Material = None }\nSections[1] = { Material = None }\nSections[2] = { Material = None }\n'
            overrides = {0: FIXTURE_FIRST_TEXTURE, 1: FIXTURE_SECOND_TEXTURE}
            with patch.object(Converter, 'material_texture', side_effect=lambda work_directory, reference: (ONE_PIXEL_PNG, {}, reference, [])):
                slots, _ = converter.materials(work, PackageStub(), document, dump, overrides, 'native-table-selection')
            materials = document.data['materials']
            self.assertEqual([slot['binding'] for slot in slots], ['native-table-selection', 'native-table-selection', 'unbound-source-slot'])
            self.assertEqual([slot.get('texture') for slot in slots[:2]], [FIXTURE_FIRST_TEXTURE, FIXTURE_SECOND_TEXTURE])
            self.assertEqual([material['extras']['binding'] for material in materials[:2]], ['native-table-selection', 'native-table-selection'])
            self.assertEqual(materials[2]['name'], 'UNBOUND_SOURCE_SLOT_2')
            self.assertEqual(materials[2]['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])


def with_slot_binding_entries(request, entries):
    request['sourceBinding']['slotBindings'] = entries
    return request


class SlotBindingRefusalTests(unittest.TestCase):
    def two_texture_request(self):
        return slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE, '1=' + FIXTURE_SECOND_TEXTURE])

    def two_texture_table(self):
        return synthetic_npcgrp_table([FIXTURE_FIRST_TEXTURE, FIXTURE_SECOND_TEXTURE])

    def test_mixing_texture_path_with_slot_bindings_is_refused(self):
        request = self.two_texture_request()
        request['sourceBinding']['texturePath'] = texture_field_path(0)
        with self.assertRaisesRegex(ValueError, 'either texturePath or slotBindings'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_empty_slot_bindings_are_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [])
        with self.assertRaisesRegex(ValueError, 'non-empty list'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_negative_slot_is_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [{'slot': -1, 'texturePath': texture_field_path(0)}])
        with self.assertRaisesRegex(ValueError, 'non-negative integer'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_boolean_slot_is_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [{'slot': True, 'texturePath': texture_field_path(1)}])
        with self.assertRaisesRegex(ValueError, 'non-negative integer'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_string_slot_is_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [{'slot': '0', 'texturePath': texture_field_path(0)}])
        with self.assertRaisesRegex(ValueError, 'non-negative integer'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_slot_listed_twice_is_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [
            {'slot': 0, 'texturePath': texture_field_path(0)},
            {'slot': 1, 'texturePath': texture_field_path(1)},
            {'slot': 1, 'texturePath': texture_field_path(1)}])
        with self.assertRaisesRegex(ValueError, 'slot twice'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_slot_binding_entry_with_extra_keys_is_refused(self):
        request = with_slot_binding_entries(self.two_texture_request(), [{'slot': 0, 'texturePath': texture_field_path(0), 'texture': FIXTURE_FIRST_TEXTURE}])
        with self.assertRaisesRegex(ValueError, 'exactly slot and texturePath'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_override_for_a_slot_no_binding_cites_is_refused(self):
        request = self.two_texture_request()
        request['materials'].append('2=' + FIXTURE_THIRD_TEXTURE)
        with self.assertRaisesRegex(ValueError, 'not cited by its native table binding'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_cited_slot_whose_table_texture_differs_from_its_override_is_refused(self):
        request = slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE, '1=' + FIXTURE_THIRD_TEXTURE])
        with self.assertRaisesRegex(ValueError, 'differs from its cited native table fields'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_cited_slot_without_an_override_is_refused(self):
        request = slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE])
        with self.assertRaisesRegex(ValueError, 'differs from its cited native table fields'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_mesh_that_differs_from_the_table_row_is_refused(self):
        request = self.two_texture_request()
        request['object'] = 'other_mesh'
        with self.assertRaisesRegex(ValueError, 'differs from its cited native table fields'):
            verify_source_table_binding(request, self.two_texture_table())

    def test_empty_table_texture_binds_no_slot_and_refuses_an_override(self):
        table = synthetic_npcgrp_table([FIXTURE_FIRST_TEXTURE, ''])
        evidence = verify_source_table_binding(slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE]), table)
        self.assertEqual(evidence['slotBindings'][1], {'slot': 1, 'texturePath': texture_field_path(1), 'textureReference': ''})
        with self.assertRaisesRegex(ValueError, 'not cited by its native table binding'):
            verify_source_table_binding(slot_list_request([0, 1], ['0=' + FIXTURE_FIRST_TEXTURE, '1=' + FIXTURE_SECOND_TEXTURE]), table)

    def test_mesh_and_texture_references_compare_case_insensitively_and_slots_as_integers(self):
        request = slot_list_request([0, 1], ['00=' + FIXTURE_FIRST_TEXTURE.upper(), '1=' + FIXTURE_SECOND_TEXTURE.upper()])
        request['object'] = 'MESH'
        evidence = verify_source_table_binding(request, self.two_texture_table())
        self.assertEqual([entry['textureReference'] for entry in evidence['slotBindings']], [FIXTURE_FIRST_TEXTURE, FIXTURE_SECOND_TEXTURE])


class SingleSlotBindingTests(unittest.TestCase):
    def test_single_slot_form_and_its_slot_list_equivalent_return_equal_evidence(self):
        table = synthetic_npcgrp_table([FIXTURE_FIRST_TEXTURE])
        slot_list = slot_list_request([0], ['0=' + FIXTURE_FIRST_TEXTURE])
        single_slot = json.loads(json.dumps(slot_list))
        single_slot['sourceBinding'].pop('slotBindings')
        single_slot['sourceBinding']['texturePath'] = texture_field_path(0)
        self.assertEqual(verify_source_table_binding(single_slot, table), verify_source_table_binding(slot_list, table))
        single_slot['sourceBinding']['slot'] = 0
        self.assertEqual(verify_source_table_binding(single_slot, table), verify_source_table_binding(slot_list, table))

    def test_single_slot_evidence_has_the_one_evidence_shape(self):
        request = slot_list_request([0], ['0=' + FIXTURE_FIRST_TEXTURE])
        evidence = verify_source_table_binding(request, synthetic_npcgrp_table([FIXTURE_FIRST_TEXTURE]))
        self.assertEqual(set(evidence), {'table', 'sourceSha256', 'meshPath', 'meshReference', 'slotBindings', 'schema', 'decodedSha256'})


def committed_recipe_parts():
    for recipe_path in sorted((ROOT / 'recipes').glob('*.json')):
        recipe = json.loads(recipe_path.read_bytes())
        if not isinstance(recipe, list):
            continue
        for request in recipe:
            for part in request.get('parts', [request]):
                yield recipe_path.name, part


class CommittedRecipeBindingTests(unittest.TestCase):
    def test_every_committed_source_binding_cites_exactly_its_override_slots(self):
        checked_parts = [(name, part) for name, part in committed_recipe_parts() if part.get('sourceBinding')]
        self.assertTrue(checked_parts)
        for name, part in checked_parts:
            with self.subTest(recipe=name, part=part.get('object')):
                self.assertIn('sourceBinding', part)
                binding_slots = {slot for slot, _ in source_slot_bindings(part['sourceBinding'])}
                self.assertEqual(binding_slots, set(material_overrides_by_slot(part.get('materials', []))))


def first_npcgrp_row_with_two_textures(table):
    for index, row in enumerate(table['data']['npc']):
        textures = [entry['param_texture_name'] for entry in row['texture_name']]
        if sum(1 for texture in textures if texture) >= 2:
            return index, row, textures
    raise AssertionError('npcgrp holds no row with two or more non-empty textures')


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(),
                     'needs the conversion client E:/Lineage2-client, the committed recipes/reference-client-tree.lock.json and the pinned dat formats')
class ConversionClientNpcgrpSlotBindingTests(unittest.TestCase):
    def test_first_multi_texture_npcgrp_row_verifies_every_texture_slot(self):
        table = decode_table(CONVERSION_CLIENT_ROOT, 'npcgrp')
        index, row, textures = first_npcgrp_row_with_two_textures(table)
        request = {'package': row['mesh_name'].split('.')[0], 'object': row['mesh_name'],
                   'materials': [f'{slot}={texture}' for slot, texture in enumerate(textures) if texture],
                   'sourceBinding': {'table': 'npcgrp', 'sourceSha256': table['sourceSha256'], 'meshPath': ['npc', index, 'mesh_name'],
                                     'slotBindings': [{'slot': slot, 'texturePath': ['npc', index, 'texture_name', slot, 'param_texture_name']}
                                                      for slot in range(len(textures))]}}
        evidence = verify_source_table_binding(request, table)
        self.assertEqual([entry['textureReference'] for entry in evidence['slotBindings']], textures)
        self.assertEqual(evidence['meshReference'], row['mesh_name'])


if __name__ == '__main__':
    unittest.main()
