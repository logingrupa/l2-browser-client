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
from reference_client_lock_fixture import lock_client_as_reference_root

FIXTURE_MESH = 'Fixture.mesh'
FIXTURE_FIRST_TEXTURE = 'FixtureTex.a'
FIXTURE_SECOND_TEXTURE = 'FixtureTex.b'
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


if __name__ == '__main__':
    unittest.main()
