import copy
import hashlib
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.static_materials import LAYOUT_REVIEWED_LICENSEES, MAX_MATERIALS, REVIEWED_VERSIONS, native_static_materials
from native_catalog.ue2 import FormatError, Package
from native_assets import Converter, static_section_bindings

LAYOUT_REVIEWED_VERSIONS = frozenset((123, licensee) for licensee in LAYOUT_REVIEWED_LICENSEES)
REFUSED_NEIGHBOUR_VERSIONS = [(122, 20), (123, 1), (123, 11), (123, 13), (123, 17), (123, 21), (123, 24), (123, 26), (123, 27),
                              (123, 29), (123, 32)]


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
        self.assertEqual(bytes.fromhex(raw['hex'])[-1], 0)
        self.assertTrue(result['meshPropertyTags'][-1]['value'])

    def test_null_omitted_and_missing_array_remain_distinct_for_every_reviewed_version(self):
        for version in sorted(REVIEWED_VERSIONS):
            with self.subTest(version=version):
                package, item = fixture([material(0) + b'\0', b'\x03\x03\0'], version=version)
                slots = native_static_materials(package, item)['slots']
                self.assertEqual([x['sourceReference'] for x in slots], [None, None])
                self.assertEqual([x['referenceStatus'] for x in slots], ['explicit-null', 'omitted'])
                self.assertEqual([x['nativeObjectIndex'] for x in slots], [0, None])
                self.assertNotIn('EnableCollisionforShadow', slots[1]['properties'])
                package, item = fixture(omit_array=True, version=version)
                result = native_static_materials(package, item)
                self.assertEqual(result['materialsStatus'], 'omitted')
                self.assertIsNone(result['materialsProperty'])
                self.assertEqual(result['slots'], [])
                package, item = fixture([], version=version)
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
        for version in REFUSED_NEIGHBOUR_VERSIONS:
            package, item = fixture(version=version)
            with self.subTest(version=version), self.assertRaisesRegex(FormatError, 'reviewed'):
                native_static_materials(package, item)
        package, item = fixture()
        with self.assertRaisesRegex(FormatError, 'exact Engine.StaticMesh'):
            native_static_materials(package, dict(item, classObject='Custom.StaticMesh'))
        for version in sorted(REVIEWED_VERSIONS):
            package, item = fixture(version=version)
            self.assertEqual(native_static_materials(package, item)['layout']['licenseeVersion'], version[1])

    def test_every_unreviewed_neighbour_of_a_reviewed_licensee_is_refused(self):
        neighbours = {(package_version, licensee + step) for package_version, licensee in REVIEWED_VERSIONS for step in (-1, 1)
                      if licensee + step >= 0} - REVIEWED_VERSIONS
        self.assertTrue(neighbours)
        for version in sorted(neighbours):
            with self.subTest(version=version), self.assertRaisesRegex(FormatError, 'reviewed'):
                native_static_materials(*fixture(version=version))

    def test_the_refusal_names_every_reviewed_version(self):
        package, item = fixture(version=(123, 13))
        with self.assertRaises(FormatError) as refusal:
            native_static_materials(package, item)
        for package_version, licensee in REVIEWED_VERSIONS:
            self.assertIn(f'{package_version}/{licensee}', str(refusal.exception))
        self.assertIn('not 123/13', str(refusal.exception))

    def test_licensee_12_reads_the_same_slots_as_reviewed_licensee_20_and_its_neighbours_stay_refused(self):
        slots = [material(2) + b'\0', material(-1) + b'\0', material(2) + b'\0']
        expected = native_static_materials(*fixture(slots, version=(123, 20)))['slots']
        self.assertEqual(native_static_materials(*fixture(slots, version=(123, 12)))['slots'], expected)
        for version in [(123, 11), (123, 13)]:
            with self.subTest(version=version), self.assertRaisesRegex(FormatError, 'reviewed'):
                native_static_materials(*fixture(slots, version=version))

    def test_every_cross_checked_version_reads_the_fixture_like_licensee_20(self):
        slots = [material(2) + b'\0', material(-1) + b'\0', material(0) + b'\0', b'\x03\x03\0']
        expected = native_static_materials(*fixture(slots, version=(123, 20)))['slots']
        for version in sorted(REVIEWED_VERSIONS - LAYOUT_REVIEWED_VERSIONS):
            with self.subTest(version=version):
                self.assertEqual(native_static_materials(*fixture(slots, version=version))['slots'], expected)

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


if __name__ == '__main__':
    unittest.main()
