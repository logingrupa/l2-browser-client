import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import UMODEL, Converter, UnsupportedMaterialAdapter, sha
from native_assets_lib.gltf import Document
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from reference_client_lock_fixture import lock_client_as_reference_root
from world.static_collision_sources import ENABLE_COLLISION_FIELD, model_slot_properties, static_mesh_collision_triangles

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
DIAGNOSTIC_SLOT_OUTPUT = ROOT / 'artifacts' / 'lane-store' / 'integration' / 'work' / 'diagnostic-slots'
FIXTURE_TEXTURE = 'FixtureTex.Stone'
FIXTURE_COMBINER = 'FixtureFx.GlowCombiner'
ONE_PIXEL_PNG = b'\x89PNG\r\n\x1a\n' + b'fixture one-pixel payload'
COLLIDING_SLOT_PROPERTIES = {ENABLE_COLLISION_FIELD: True}
PASSING_SLOT_PROPERTIES = {ENABLE_COLLISION_FIELD: False}
FLAME_STATIC_MESH_REQUEST = {'kind': 'model', 'package': 'staticmeshes/FX_E_S.usx', 'object': 'FX_E_S.Flameset.Default_Flame01'}
ORC_DUNGEON_STATIC_MESH_REQUEST = {'kind': 'model', 'package': 'staticmeshes/rhion_orc_dungeon_s.usx', 'object': 'rhion_orc_dungeon_s.rhion_orc_dungeon48'}


def two_material_document(root):
    payload = struct.pack('<6f', 0, 0, 0, 1, 1, 1)
    (root / 'mesh.bin').write_bytes(payload)
    (root / 'mesh.gltf').write_text(json.dumps({'asset': {'version': '2.0'}, 'buffers': [{'uri': 'mesh.bin', 'byteLength': len(payload)}],
        'bufferViews': [{'buffer': 0, 'byteLength': len(payload)}],
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 2, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1, 1, 1]}],
        'materials': [{}, {}], 'nodes': [{'name': 'mesh'}], 'scenes': [{'nodes': [0]}]}))
    return Document(root / 'mesh.gltf')


def native_static_material_slots(references_and_properties):
    return {'slots': [{'slot': index, 'sourceReference': reference, 'referenceStatus': 'resolved', 'properties': properties}
                      for index, (reference, properties) in enumerate(references_and_properties)]}


def texture_or_unsupported_adapter(work_directory, reference):
    if reference == FIXTURE_COMBINER:
        raise UnsupportedMaterialAdapter('Combiner', FIXTURE_COMBINER)
    return ONE_PIXEL_PNG, {}, reference, []


class PackageStub:
    imports = []
    exports = []


class DiagnosticSlotTests(unittest.TestCase):
    def converter_on_temporary_client(self, root):
        client = root / 'source'
        client.mkdir()
        lock_client_as_reference_root(self, client)
        tool = root / 'tool.exe'
        tool.write_bytes(b'not executed by the material slot writer')
        umodel_hash = patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes()))
        umodel_hash.start()
        self.addCleanup(umodel_hash.stop)
        return Converter(client, root / 'artifacts' / 'output', tool, project_root=root)

    def converted_materials(self, references_and_properties):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        converter = self.converter_on_temporary_client(root)
        work = root / 'work'
        work.mkdir()
        document = two_material_document(work)
        dump = 'Sections[0] = { Material = None }\nSections[1] = { Material = None }\n'
        with patch.object(Converter, 'material_texture', side_effect=texture_or_unsupported_adapter):
            slots, limitations = converter.materials(work, PackageStub(), document, dump, {}, native_materials=native_static_material_slots(references_and_properties))
        return document.data['materials'], slots, limitations

    def test_material_without_a_diffuse_adapter_raises_the_named_unsupported_adapter_error(self):
        with tempfile.TemporaryDirectory() as directory:
            converter = self.converter_on_temporary_client(Path(directory))
            combiner = {'object': FIXTURE_COMBINER, 'className': 'Combiner'}
            with patch.object(Converter, 'package', return_value=(Path('FixtureFx.utx'), PackageStub())), \
                    patch.object(Converter, 'select', return_value=combiner):
                with self.assertRaises(UnsupportedMaterialAdapter) as raised:
                    converter.material_texture(Path(directory), FIXTURE_COMBINER)
            self.assertEqual((raised.exception.class_name, raised.exception.object_name), ('Combiner', FIXTURE_COMBINER))
            self.assertEqual(str(raised.exception), f'No diffuse material adapter for Combiner: {FIXTURE_COMBINER}')

    def test_slot_without_a_diffuse_adapter_becomes_the_named_magenta_diagnostic_and_keeps_its_slot_properties(self):
        materials, slots, limitations = self.converted_materials([(FIXTURE_TEXTURE, COLLIDING_SLOT_PROPERTIES), (FIXTURE_COMBINER, PASSING_SLOT_PROPERTIES)])
        self.assertEqual(materials[1], {
            'name': 'UNSUPPORTED_MATERIAL_ADAPTER_SLOT_1',
            'pbrMetallicRoughness': {'baseColorFactor': [1, 0, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1},
            'extras': {'binding': 'native-static-material-object-index', 'nativeRuntimeStatus': 'unsupported-diagnostic',
                       'unsupportedMaterialAdapter': {'class': 'Combiner', 'object': FIXTURE_COMBINER},
                       'nativeSectionIndex': 1, 'nativeSourceReference': FIXTURE_COMBINER, 'nativeSlotProperties': PASSING_SLOT_PROPERTIES}})
        self.assertEqual(slots[1]['nativeRuntimeStatus'], 'unsupported-diagnostic')
        self.assertEqual(slots[1]['unsupportedMaterialAdapter'], {'class': 'Combiner', 'object': FIXTURE_COMBINER})
        self.assertEqual(slots[1]['sourceReference'], FIXTURE_COMBINER)
        self.assertNotIn('texture', slots[1])
        self.assertIn(f'material-adapter-unsupported:Combiner:{FIXTURE_COMBINER}', limitations)

    def test_texture_slot_beside_a_diagnostic_slot_converts_as_before(self):
        materials, slots, _ = self.converted_materials([(FIXTURE_TEXTURE, COLLIDING_SLOT_PROPERTIES), (FIXTURE_COMBINER, PASSING_SLOT_PROPERTIES)])
        self.assertEqual(materials[0], {
            'name': FIXTURE_TEXTURE,
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1},
            'extras': {'nativeProperties': {}, 'binding': 'native-static-material-object-index',
                       'nativeSectionIndex': 0, 'nativeSourceReference': FIXTURE_TEXTURE, 'nativeSlotProperties': COLLIDING_SLOT_PROPERTIES}})
        self.assertEqual(slots[0]['texture'], FIXTURE_TEXTURE)
        self.assertEqual(slots[0]['textureSha256'], sha(ONE_PIXEL_PNG))
        self.assertNotIn('nativeRuntimeStatus', slots[0])

    def test_refusals_other_than_the_missing_adapter_stay_errors(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        converter = self.converter_on_temporary_client(root)
        work = root / 'work'
        work.mkdir()
        document = two_material_document(work)
        cyclic = ValueError('Cyclic or excessive native material graph')
        with patch.object(Converter, 'material_texture', side_effect=cyclic):
            with self.assertRaisesRegex(ValueError, 'Cyclic or excessive native material graph'):
                converter.materials(work, PackageStub(), document, '', {},
                                    native_materials=native_static_material_slots([(FIXTURE_TEXTURE, {}), (FIXTURE_COMBINER, {})]))


def converted_model_glb_and_manifest(result):
    with zipfile.ZipFile(io.BytesIO(Path(result['file']).read_bytes())) as archive:
        manifest = json.loads(archive.read('asset.json'))
        return archive.read(manifest['model']['file']), manifest


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and UMODEL.is_file(),
                     'needs the conversion client E:/Lineage2-client, the committed recipes/reference-client-tree.lock.json and the pinned UModel')
class ConversionClientDiagnosticSlotTests(unittest.TestCase):
    def converted_static_mesh(self, request):
        converter = Converter(CONVERSION_CLIENT_ROOT, DIAGNOSTIC_SLOT_OUTPUT, UMODEL, project_root=ROOT)
        return converted_model_glb_and_manifest(converter.convert(dict(request)))

    def assert_collision_reads_every_slot(self, glb):
        slot_properties = model_slot_properties(glb)
        self.assertTrue(slot_properties)
        self.assertTrue(all(type(properties.get(ENABLE_COLLISION_FIELD)) is bool for properties in slot_properties))
        colliding_slots = {index for index, properties in enumerate(slot_properties) if properties[ENABLE_COLLISION_FIELD]}
        positions, indices = static_mesh_collision_triangles(glb, colliding_slots)
        if colliding_slots:
            self.assertTrue(positions)
            self.assertTrue(indices)
            self.assertEqual(len(indices) % 3, 0)
        return slot_properties, colliding_slots

    def test_combiner_flame_mesh_converts_with_diagnostic_slots_that_collision_reads(self):
        glb, manifest = self.converted_static_mesh(FLAME_STATIC_MESH_REQUEST)
        self.assertTrue(any(limitation.startswith('material-adapter-unsupported:Combiner:') for limitation in manifest['limitations']))
        self.assert_collision_reads_every_slot(glb)

    def test_combiner_orc_dungeon_mesh_converts_and_collision_returns_triangles_for_its_colliding_slots(self):
        glb, manifest = self.converted_static_mesh(ORC_DUNGEON_STATIC_MESH_REQUEST)
        self.assertTrue(any(limitation.startswith('material-adapter-unsupported:Combiner:') for limitation in manifest['limitations']))
        _, colliding_slots = self.assert_collision_reads_every_slot(glb)
        self.assertTrue(colliding_slots)


if __name__ == '__main__':
    unittest.main()
