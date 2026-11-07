import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.static_materials import native_static_materials, MAX_MATERIALS
from native_catalog.ue2 import FormatError, Package
from native_assets import Converter, static_section_bindings


def compact(value):
    negative, value = value < 0, abs(value)
    result = bytearray([(value & 63) | (128 if negative else 0)])
    value >>= 6
    if value:
        result[0] |= 64
    while value:
        byte, value = value & 127, value >> 7
        result.append(byte | (128 if value else 0))
    return bytes(result)


def material(index):
    payload = compact(index)
    return b'\x02\x55' + bytes([len(payload)]) + payload


def fixture(slots=None, payload=None, version=(123, 20), duplicate_array=False, omit_array=False):
    if payload is None:
        slots = slots if slots is not None else [b'\x03\x83\x04\x03\x05\x03' + material(-1) + b'\x00']
        payload = compact(len(slots)) + b''.join(slots)
    array = b'\x01\x59' + bytes([len(payload)]) + payload
    data = (b'' if omit_array else array * (2 if duplicate_array else 1)) + b'\x07\x83\x00geometry-tail'
    package = Package.__new__(Package)
    package.data, package.filename, package.package_name = data, 'Fixture.usx', 'Fixture'
    package.source_hash = hashlib.sha256(data).hexdigest()
    package.summary = {'version': version[0], 'licenseeVersion': version[1]}
    package.names = ['None', 'Materials', 'Material', 'EnableCollision', 'EnableCollisionforShadow',
                     'bNoDynamicShadowCast', 'UnknownColor', 'bMakeTwoSideMesh', 'Color']
    package.imports = [{'name': 'Stone', 'outerIndex': -2, 'className': 'Texture'},
                       {'name': 'TexturePackage', 'outerIndex': 0, 'className': 'Package'}]
    item = {'object': 'Fixture.Mesh', 'name': 'Mesh', 'className': 'StaticMesh', 'classObject': 'Engine.StaticMesh',
            'exportIndex': 1, 'outerIndex': 0, 'offset': 0, 'size': len(data)}
    package.exports = [item, {'object': 'Fixture.Stone', 'name': 'Stone', 'outerIndex': 0, 'className': 'Texture'}]
    return package, item


class StaticMaterialTests(unittest.TestCase):
    def test_exact_index_disambiguates_import_from_same_leaf_export(self):
        package, item = fixture()
        result = native_static_materials(package, item)
        slot = result['slots'][0]
        self.assertEqual(slot['sourceReference'], 'TexturePackage.Stone')
        self.assertEqual(slot['nativeObjectIndex'], -1)
        self.assertEqual(slot['sourceClass'], 'Texture')
        self.assertEqual(slot['referenceStatus'], 'exact-native-object-index')
        self.assertNotEqual(slot['sourceReference'], package.object_name(2))

    def test_native_slot_order_and_duplicate_materials_are_preserved(self):
        package, item = fixture([material(2) + b'\0', material(-1) + b'\0', material(2) + b'\0'])
        slots = native_static_materials(package, item)['slots']
        self.assertEqual([x['slot'] for x in slots], [0, 1, 2])
        self.assertEqual([x['nativeObjectIndex'] for x in slots], [2, -1, 2])
        self.assertEqual([x['sourceReference'] for x in slots], ['Fixture.Stone', 'TexturePackage.Stone', 'Fixture.Stone'])

    def test_false_boolean_tags_and_complete_raw_slot_bytes_survive(self):
        package, item = fixture()
        result = native_static_materials(package, item)
        slot = result['slots'][0]
        self.assertIs(slot['properties']['EnableCollision'], True)
        self.assertIs(slot['properties']['EnableCollisionforShadow'], False)
        self.assertIs(slot['properties']['bNoDynamicShadowCast'], False)
        raw = slot['raw']
        self.assertEqual(bytes.fromhex(raw['hex']), package.data[raw['offset']:raw['offset'] + raw['bytes']])
        self.assertEqual(raw['sha256'], hashlib.sha256(bytes.fromhex(raw['hex'])).hexdigest())
        self.assertEqual(bytes.fromhex(raw['hex'])[-1], 0)  # Native struct terminator retained.
        self.assertTrue(result['meshPropertyTags'][-1]['value'])

    def test_null_omitted_and_missing_array_remain_distinct(self):
        package, item = fixture([material(0) + b'\0', b'\x03\x03\0'])
        slots = native_static_materials(package, item)['slots']
        self.assertEqual([x['sourceReference'] for x in slots], [None, None])
        self.assertEqual([x['referenceStatus'] for x in slots], ['explicit-null', 'omitted'])
        self.assertEqual([x['nativeObjectIndex'] for x in slots], [0, None])
        self.assertNotIn('EnableCollisionforShadow', slots[1]['properties'])
        package, item = fixture(omit_array=True)
        result = native_static_materials(package, item)
        self.assertEqual(result['materialsStatus'], 'omitted')
        self.assertIsNone(result['materialsProperty'])
        self.assertEqual(result['slots'], [])
        package, item = fixture([])
        result = native_static_materials(package, item)
        self.assertEqual(result['materialsStatus'], 'authored')
        self.assertEqual(result['slots'], [])

    def test_unknown_typed_structure_stays_raw(self):
        package, item = fixture([b'\x06\x2a\x08\x80\x80\x80\xff' + material(-1) + b'\0'])
        slot = native_static_materials(package, item)['slots'][0]
        self.assertEqual(slot['properties']['UnknownColor'], {'unparsedHex': '808080ff', 'type': 10, 'struct': 'Color'})
        self.assertEqual(slot['propertyTags'][0]['status'], 'raw-preserved')

    def test_duplicate_array_and_duplicate_material_tags_are_rejected(self):
        for package, item in [fixture(duplicate_array=True), fixture([material(-1) + material(2) + b'\0'])]:
            with self.subTest(data=package.data), self.assertRaisesRegex(FormatError, 'Duplicate'):
                native_static_materials(package, item)

    def test_truncated_struct_and_leftover_payload_are_rejected(self):
        for payload in [b'\x01' + material(-1), b'\x00\x00', b'\x02' + material(-1) + b'\0']:
            package, item = fixture(payload=payload)
            with self.subTest(payload=payload), self.assertRaises(FormatError):
                native_static_materials(package, item)

    def test_unknown_versions_and_non_static_class_are_rejected(self):
        for version in [(122, 20), (123, 18), (123, 21), (123, 24), (123, 26), (123, 27), (123, 29), (123, 32)]:
            package, item = fixture(version=version)
            with self.subTest(version=version), self.assertRaisesRegex(FormatError, 'reviewed'):
                native_static_materials(package, item)
        package, item = fixture()
        with self.assertRaisesRegex(FormatError, 'exact Engine.StaticMesh'):
            native_static_materials(package, dict(item, classObject='Custom.StaticMesh'))
        for version in [(123, value) for value in (16, 19, 20, 22, 23, 25, 28, 30, 31)]:
            package, item = fixture(version=version)
            self.assertEqual(native_static_materials(package, item)['layout']['licenseeVersion'], version[1])

    def test_excessive_count_invalid_reference_and_wrong_boolean_type_are_rejected(self):
        for kwargs in [{'payload': compact(MAX_MATERIALS + 1)}, {'slots': [material(-99) + b'\0']},
                       {'slots': [b'\x03\x01\x01' + material(-1) + b'\0']}]:
            package, item = fixture(**kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaises(FormatError):
                native_static_materials(package, item)

    def test_result_mutation_never_changes_source_or_future_reads(self):
        package, item = fixture()
        original = bytes(package.data)
        before = native_static_materials(package, item)
        expected = copy.deepcopy(before)
        before['slots'][0]['propertyTags'][0]['value'] = 'changed'
        before['layout']['evidence']['files'].clear()
        self.assertEqual(package.data, original)
        self.assertEqual(native_static_materials(package, item), expected)


class StaticMaterialIntegrationTests(unittest.TestCase):
    def setup_materials(self, count=1, graph=None):
        selected = []
        def texture(work, reference):
            selected.append(reference)
            return b'png-fixture', {}, 'Textures.Diffuse', graph or []
        document = SimpleNamespace(data={'materials': [{} for _ in range(count)]},
                                   image=lambda payload, mime, name: 0)
        converter = SimpleNamespace(material_texture=texture)
        return converter, document, selected

    def test_converter_uses_exact_static_index_despite_ambiguous_dump(self):
        package, item = fixture()
        source = native_static_materials(package, item)
        converter, document, selected = self.setup_materials()
        dump = "Sections[0] = { Material=Texture'Stone', FirstIndex=0, NumFaces=1 }"
        slots, _ = Converter.materials(converter, Path('work'), package, document, dump, {}, native_materials=source)
        self.assertEqual(selected, ['TexturePackage.Stone'])
        self.assertEqual(slots[0]['binding'], 'native-static-material-object-index')
        self.assertEqual(slots[0]['nativeMaterialSlot'], source['slots'][0])
        self.assertEqual(slots[0]['nativeSectionIndex'], 0)
        self.assertEqual(document.data['materials'][0]['extras']['nativeSourceReference'], 'TexturePackage.Stone')

    def test_null_static_material_never_uses_exporter_name_fallback(self):
        package, item = fixture([material(0) + b'\0'])
        converter, document, selected = self.setup_materials()
        slots, limits = Converter.materials(converter, Path('work'), package, document,
            "Sections[0] = { Material=Texture'Fixture.Stone' }", {}, native_materials=native_static_materials(package, item))
        self.assertEqual(selected, [])
        self.assertEqual(slots[0]['nativeReferenceStatus'], 'explicit-null')
        self.assertEqual(document.data['materials'][0]['name'], 'UNBOUND_SOURCE_SLOT_0')

    def test_explicit_override_preserves_native_source_binding(self):
        package, item = fixture()
        converter, document, selected = self.setup_materials()
        slots, _ = Converter.materials(converter, Path('work'), package, document, '', {0: 'Override.Material'},
            native_materials=native_static_materials(package, item))
        self.assertEqual(selected, ['Override.Material'])
        self.assertEqual(slots[0]['sourceReference'], 'Override.Material')
        self.assertEqual(slots[0]['nativeMaterialSlot']['sourceReference'], 'TexturePackage.Stone')
        self.assertEqual(slots[0]['binding'], 'explicit-recipe-override')

    def test_skeletal_material_resolution_retains_existing_contract(self):
        package, _ = fixture()
        package.imports[0]['object'] = 'TexturePackage.Stone'
        package.exports = []
        converter, document, selected = self.setup_materials()
        slots, _ = Converter.materials(converter, Path('work'), package, document,
            "Sections[0] = { Material=Texture'TexturePackage.Stone' }", {})
        self.assertEqual(selected, ['TexturePackage.Stone'])
        self.assertEqual(slots[0]['binding'], 'native-section-reference')
        self.assertNotIn('nativeSectionIndex', slots[0])

    def test_shader_graph_and_unsupported_render_fields_are_retained(self):
        package, item = fixture()
        package.imports[0]['className'] = 'Shader'
        graph = [{'object': 'TexturePackage.Stone', 'class': 'Shader', 'properties': [
            {'name': 'TwoSided', 'value': True}, {'name': 'OutputBlending', 'value': 5,
             'payloadHex': '05', 'type': 1}], 'trailingHex': 'cafe'}]
        converter, document, selected = self.setup_materials(graph=graph)
        slots, limitations = Converter.materials(converter, Path('work'), package, document, '', {},
            native_materials=native_static_materials(package, item))
        self.assertEqual(slots[0]['nativeMaterialGraph'], graph)
        self.assertEqual(slots[0]['nativeMaterialSlot']['sourceClass'], 'Shader')
        self.assertTrue(document.data['materials'][0]['doubleSided'])
        self.assertTrue(any('native Shader blending' in value for value in limitations))

    def test_empty_primitive_compaction_retains_original_section_indices(self):
        document = SimpleNamespace(data={'materials': [{}, {}, {}, {}],
            'meshes': [{'primitives': [{'material': 1}, {'material': 3}]}]}, repairs=[{
                'kind': 'omit-empty-native-primitives', 'materialSlotsPreserved': True,
                'materialSlotCount': 4, 'primitiveRemaps': [{'mesh': 0, 'oldToNew': [None, 0, None, 1]}]}])
        result = static_section_bindings(document)
        self.assertEqual([row['nativeSectionIndex'] for row in result], [1, 3])
        self.assertEqual([row['primitive'] for row in result], [0, 1])
        self.assertEqual([p['extras']['nativeSectionIndex'] for p in document.data['meshes'][0]['primitives']], [1, 3])
        self.assertEqual(len(document.data['materials']), 4)

    def test_renumbered_materials_are_rejected_after_primitive_compaction(self):
        document = SimpleNamespace(data={'materials': [{}, {}, {}, {}],
            'meshes': [{'primitives': [{'material': 0}, {'material': 1}]}]}, repairs=[{
                'kind': 'omit-empty-native-primitives', 'materialSlotsPreserved': True,
                'materialSlotCount': 4, 'primitiveRemaps': [{'mesh': 0, 'oldToNew': [None, 0, None, 1]}]}])
        with self.assertRaisesRegex(ValueError, 'original native section'):
            static_section_bindings(document)


CLIENT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
VERSION_CASES = json.loads((Path(__file__).parent/'fixtures/static-material-versions.json').read_bytes())['cases']
PACKAGES = {
    'field_deco_artifact_s.usx': '7d44217266e47b85efe2958587f925a084c93c5210c60981b8b2daae9cfe247d',
    'oren_tree_s.usx': '74072d7fce630aa045870be3ccd541bbe62ca34fc382987be6851037afd8dafb',
    'field_deco_S.usx': '205b3ec267f792944d500afeacdacf6e3a7465a529d1b348ca154851c18d0838',
}


@unittest.skipUnless(all((CLIENT / 'staticmeshes' / name).is_file() for name in PACKAGES),
                     'Hash-pinned native section fixtures are local only')
class RealSectionMaterialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packages = {}
        for name, expected in PACKAGES.items():
            data = (CLIENT / 'staticmeshes' / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != expected:
                raise AssertionError('Native fixture differs from pinned source: ' + name)
            cls.packages[name] = Package(data, name)

    def read(self, package_name, object_name):
        package = self.packages[package_name]
        item = next(x for x in package.exports if x['object'] == object_name)
        return package, native_static_materials(package, item)

    def test_world_obj14_retains_import_identity_despite_real_local_name_collision(self):
        package, result = self.read('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.world_obj14')
        matching = [x['object'] for x in package.imports + package.exports if x['object'].endswith('.sk_ruins.stone_033')]
        self.assertEqual(set(matching), {'Field_Deco_Artifact_T.sk_ruins.stone_033', 'field_deco_artifact_s.sk_ruins.stone_033'})
        self.assertEqual([x['nativeObjectIndex'] for x in result['slots']], [-14, -24])
        self.assertEqual([x['sourceReference'] for x in result['slots']],
                         ['Field_Deco_Artifact_T.sk_ruins.stone_033', 'Field_Deco_Artifact_T.sk_ruins.stone_07'])

    def test_all_six_section_meshes_have_exact_ordered_slots(self):
        cases = [
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.elf_ruin02', [-37, -101, -265, -150, -144, -152, -146, -140, -37]),
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.elf_ruin03', [-37, -141, -148, -101, -37, -37, -262, -144, -146, -147]),
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.world_obj14', [-14, -24]),
            ('oren_tree_s.usx', 'oren_tree_s.Elf_Colors.Oren_elf_tree04', [-14, -15, -24]),
            ('field_deco_S.usx', 'field_deco_S.oren_stone.deco_oren_stone007', [-47, -53, -144]),
            ('field_deco_S.usx', 'field_deco_S.oren_stone.deco_oren_stone013', [-47]),
        ]
        for package_name, object_name, indices in cases:
            with self.subTest(mesh=object_name):
                package, result = self.read(package_name, object_name)
                self.assertEqual([x['slot'] for x in result['slots']], list(range(len(indices))))
                self.assertEqual([x['nativeObjectIndex'] for x in result['slots']], indices)
                self.assertEqual([x['sourceReference'] for x in result['slots']], [package.object_name(i) for i in indices])
                self.assertTrue(all(x['referenceStatus'] == 'exact-native-object-index' for x in result['slots']))
                classes = ['Texture', 'Texture', 'Shader'] if package_name == 'oren_tree_s.usx' else ['Texture'] * len(indices)
                self.assertEqual([x['sourceClass'] for x in result['slots']], classes)

    def test_tree_collision_and_shadow_flags_remain_per_slot(self):
        _, result = self.read('oren_tree_s.usx', 'oren_tree_s.Elf_Colors.Oren_elf_tree04')
        self.assertEqual([x['properties']['EnableCollision'] for x in result['slots']], [True, True, False])
        self.assertEqual([x['properties']['EnableCollisionforShadow'] for x in result['slots']], [True, True, True])
        self.assertEqual([x['properties']['bNoDynamicShadowCast'] for x in result['slots']], [False, False, True])
        self.assertIn('bSwayObject', [x['name'] for x in result['meshPropertyTags']])


@unittest.skipUnless(all((CLIENT/row['package']).is_file() for row in VERSION_CASES),
                     'Hash-pinned expanded native world fixtures are local only')
class ExpandedSectionMaterialTests(unittest.TestCase):
    def test_twenty_reviewed_objects_consume_all_280_original_ordered_slots_without_source_mutation(self):
        packages={}
        total=0
        for row in VERSION_CASES:
            with self.subTest(object=row['object'],version=row['licenseeVersion']):
                if row['package'] not in packages:
                    raw=(CLIENT/row['package']).read_bytes()
                    self.assertEqual(hashlib.sha256(raw).hexdigest(),row['packageSha256'])
                    packages[row['package']]=Package(raw,Path(row['package']).name)
                package=packages[row['package']]
                original_hash=hashlib.sha256(package.data).hexdigest()
                item=next(item for item in package.exports if item['object']==row['object'])
                result=native_static_materials(package,item)
                self.assertEqual(result['layout']['licenseeVersion'],row['licenseeVersion'])
                slots=result['slots']
                self.assertEqual([slot['nativeObjectIndex'] for slot in slots],row['materialIndices'])
                self.assertEqual([slot['sourceReference'] for slot in slots],[package.object_name(index) for index in row['materialIndices']])
                self.assertEqual([slot['raw']['sha256'] for slot in slots],row['slotByteSha256s'])
                self.assertEqual(result['materialsPayload']['sha256'],row['materialsPayloadSha256'])
                self.assertEqual([slot['slot'] for slot in slots],list(range(len(slots))))
                for first,second in zip(slots,slots[1:]):
                    self.assertEqual(first['raw']['offset']+first['raw']['bytes'],second['raw']['offset'])
                self.assertEqual(slots[-1]['raw']['offset']+slots[-1]['raw']['bytes'],
                                 result['materialsPayload']['offset']+result['materialsPayload']['bytes'])
                self.assertEqual(hashlib.sha256(package.data).hexdigest(),original_hash)
                total+=len(slots)
        self.assertEqual(total,280)


if __name__ == '__main__':
    unittest.main()
