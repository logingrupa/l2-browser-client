import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import Package
from native_map import actor_properties, bitmap_words, read_g16
from native_map_geometry import native_terrain, coords_point, native_to_gltf

SPEC = importlib.util.spec_from_file_location('native_terrain_patch', ROOT / 'scripts/extract-native-terrain-patch.py')
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)
CLIENT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
RAW = ROOT / 'artifacts/native-parity/migration/maps/map-20-20'
REFERENCE = ROOT / 'artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/runtime/bundle/map-section'


def glb_document_binary(data):
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + size]), data[28 + size:]


def accessor_bytes(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    self_size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[accessor['type']] * 4
    assert view.get('byteStride', self_size) == self_size
    return binary[start:start + accessor['count'] * self_size]


class OfflinePatchSafetyTests(unittest.TestCase):
    def test_explicit_candidate_does_not_replace_ordinary_default(self):
        self.assertEqual(PATCH.patch_mask_uv(128, 255, 256, 256, 'ordinary'), [128.5 / 256, 255.5 / 256])
        self.assertEqual(PATCH.patch_mask_uv(128, 255, 256, 256, 'conditional-corrected'), [128.5 / 256, 255.5 / 256 - 15 / 4096])
        with self.assertRaisesRegex(ValueError, 'Unknown offline'):
            PATCH.patch_mask_uv(128, 255, 256, 256, 'native-qualified')

    def test_variant_difference_refuses_u_and_unrelated_geometry(self):
        ordinary = bytes(range(64))
        changed = bytearray(ordinary)
        changed[12] ^= 1
        result = PATCH.compare_variants(ordinary, bytes(changed), 8, 2)
        self.assertEqual((result['changedBytes'], result['changedPrimaryVFields']), (1, 1))
        for index in (0, 8, 16, 24, 63):
            invalid = bytearray(ordinary)
            invalid[index] ^= 1
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'outside primary V'):
                PATCH.compare_variants(ordinary, bytes(invalid), 8, 2)
        with self.assertRaisesRegex(ValueError, 'lengths differ'):
            PATCH.compare_variants(ordinary, ordinary[:-1], 8, 2)

    def test_outputs_are_idempotent_and_conflicts_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'out'
            products = {'a/mesh.bin': b'unchanged', 'receipt.json': b'{}'}
            self.assertEqual(PATCH.write_products(output, products, []), 'created')
            self.assertEqual(PATCH.write_products(output, products, []), 'unchanged')
            (output / 'a/mesh.bin').write_bytes(b'new-authoring')
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                PATCH.write_products(output, products, [])
            self.assertEqual((output / 'a/mesh.bin').read_bytes(), b'new-authoring')
            (output / 'author.txt').write_bytes(b'retain')
            with self.assertRaisesRegex(ValueError, 'file set differs'):
                PATCH.write_products(output, products, [])
            self.assertEqual((output / 'author.txt').read_bytes(), b'retain')

    def test_source_reference_output_and_wrong_source_hash_fail_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client, raw, reference = [root / name for name in ('client', 'raw', 'reference')]
            for protected in (client, raw, reference):
                with self.subTest(protected=protected), self.assertRaisesRegex(ValueError, 'outside all source/reference'):
                    PATCH.extract(client, raw, reference, protected / 'output')
                self.assertFalse((protected / 'output').exists())
            (client / 'maps').mkdir(parents=True)
            source = client / 'maps/20_20.unr'
            source.write_bytes(b'wrong-source-do-not-modify')
            output = root / 'output'
            with self.assertRaisesRegex(ValueError, 'source hash differs'):
                PATCH.extract(client, raw, reference, output)
            self.assertFalse(output.exists())
            self.assertEqual(source.read_bytes(), b'wrong-source-do-not-modify')


class RetainedSourcePatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (CLIENT / 'maps/20_20.unr').exists() or not (REFERENCE / 'terrain.glb').exists():
            raise unittest.SkipTest('Pinned private source and corrected reference fixture are not staged')
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name) / 'patch'
        cls.result = PATCH.extract(CLIENT, RAW, REFERENCE, cls.output)
        cls.report = json.loads((cls.output / 'patch.json').read_bytes())
        cls.map = Package((CLIENT / 'maps/20_20.unr').read_bytes(), '20_20.unr')
        cls.native = native_terrain(cls.map)
        cls.props, _, _, _ = actor_properties(cls.map, cls.map.exports[cls.native['exportIndex'] - 1])
        cls.words = {name: bitmap_words(bytes.fromhex(next(prop['payloadHex'] for prop in cls.props if prop['name'] == name)))['words']
                     for name in ('QuadVisibilityBitmap', 'EdgeTurnBitmap')}
        cls.variants = {name: glb_document_binary((cls.output / name / 'terrain.glb').read_bytes()) for name in PATCH.VARIANTS}

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_actual_original_geometry_topology_has_no_extra_border_quad(self):
        self.assertEqual(self.report['sourceSector']['offset'], [112, 240])
        self.assertEqual(self.report['sourceSector']['quads'], [16, 15])
        self.assertEqual(self.report['sourceSector']['exportIndex'], 2516)
        expected, turned = [], 0
        for y in range(15):
            for x in range(16):
                global_index = (y + 240) * 256 + x + 112
                visible = (self.words['QuadVisibilityBitmap'][global_index // 32] >> (global_index % 32)) & 1
                turn = (self.words['EdgeTurnBitmap'][global_index // 32] >> (global_index % 32)) & 1
                self.assertEqual(visible, 1)
                turned += turn
                a, b, c, d = y * 17 + x, y * 17 + x + 1, (y + 1) * 17 + x, (y + 1) * 17 + x + 1
                expected.extend([a, c, b, c, d, b] if turn else [a, d, b, a, c, d])
        self.assertEqual(turned, 9)
        self.assertEqual((len(expected) // 3, min(expected), max(expected)), (480, 0, 271))
        for variant, (document, binary) in self.variants.items():
            primitive = document['meshes'][0]['primitives'][0]
            actual = accessor_bytes(document, binary, primitive['indices'])
            self.assertEqual(actual, struct.pack('<1440I', *expected), variant)
            self.assertEqual(document['accessors'][primitive['attributes']['POSITION']]['count'], 272)
            result = self.report['variants'][variant]
            self.assertEqual([result[key] for key in ('vertices', 'quads', 'hiddenQuads', 'turnedVisibleQuads', 'triangles')], [272, 240, 0, 9, 480])

    def test_exact_source_samples_to_world_are_preserved_without_cached_z_fit(self):
        package = Package((CLIENT / 'textures/T_20_20.utx').read_bytes(), 'T_20_20.utx')
        item = next(row for row in package.exports if row['object'].casefold() == 't_20_20.height.20_20')
        mip = read_g16(package, item)['mips'][0]
        expected, native_z = bytearray(), []
        for y in range(240, 256):
            for x in range(112, 129):
                sample = struct.unpack_from('<H', mip['raw'], (y * 256 + x) * 2)[0]
                xyz = coords_point(self.native['toWorld'], [x, y, sample])
                native_z.append(xyz[2])
                expected.extend(struct.pack('<3f', *native_to_gltf(xyz)))
        self.assertEqual(min(native_z), -3135.255126953125)
        self.assertEqual(self.report['sourceSector']['bounds'][2] - min(native_z), 43.34375)
        for document, binary in self.variants.values():
            primitive = document['meshes'][0]['primitives'][0]
            self.assertEqual(accessor_bytes(document, binary, primitive['attributes']['POSITION']), bytes(expected))

    def test_shared_edge_is_exact_except_documented_ordinary_mask_seam(self):
        original = PATCH.channel_rows((REFERENCE / 'terrain.glb').read_bytes())
        for variant in PATCH.VARIANTS:
            channels = PATCH.channel_rows((self.output / variant / 'terrain.glb').read_bytes())
            errors = []
            for y in range(240, 256):
                original_index, patch_index = (y - 208) * 49 + 48, (y - 240) * 17
                for name in ('POSITION', 'NORMAL', 'TEXCOORD_1'):
                    self.assertEqual(channels[name][patch_index], original[name][original_index])
                mask = struct.unpack('<2f', channels['TEXCOORD_0'][patch_index])
                old_mask = struct.unpack('<2f', original['TEXCOORD_0'][original_index])
                self.assertEqual(mask[0], old_mask[0])
                errors.append(mask[1] - old_mask[1])
            self.assertEqual(sum(error != 0 for error in errors), 15 if variant == 'ordinary' else 0)
            self.assertEqual(max(errors), 15 / 4096 if variant == 'ordinary' else 0)

    def test_variants_differ_only_in_exact_255_primary_v_fields(self):
        ordinary = (self.output / 'ordinary/terrain.bin').read_bytes()
        candidate = (self.output / 'conditional-corrected/terrain.bin').read_bytes()
        result = self.report['variantBinaryDifference']
        self.assertEqual((result['changedPrimaryVFields'], result['changedBytes']), (255, 374))
        self.assertEqual(result['changedPrimaryVVertexIndices'], list(range(17, 272)))
        offset = self.report['variants']['ordinary']['maskByteOffset']
        self.assertEqual(result, PATCH.compare_variants(ordinary, candidate, offset, 272))
        self.assertEqual(ordinary[:offset], candidate[:offset])
        self.assertEqual(ordinary[offset + 272 * 8:], candidate[offset + 272 * 8:])

    def test_nine_diffuse_layers_and_unqualified_labels_survive_both_variants(self):
        for variant, (document, binary) in self.variants.items():
            extras = document['meshes'][0]['extras']
            self.assertFalse(extras['offlineTerrainComparison']['nativeSubmittedCoordinatesQualified'])
            self.assertFalse(extras['offlineTerrainComparison']['nativeVisiblePixelsQualified'])
            self.assertEqual(extras['offlineTerrainComparison']['variant'], variant)
            self.assertEqual(len(extras['nativeLayers']), 9)
            self.assertTrue(all('unqualified' in layer['maskUVStatus'] for layer in extras['nativeLayers']))
            for layer in extras['nativeLayers']:
                self.assertEqual(document['accessors'][layer['uvAccessor']]['count'], 272)
            primitive = document['meshes'][0]['primitives'][0]
            self.assertEqual(accessor_bytes(document, binary, primitive['attributes']['TEXCOORD_1']),
                             accessor_bytes(document, binary, extras['nativeLayers'][0]['uvAccessor']))
        ordinary_layers = copy.deepcopy(self.report['variants']['ordinary']['layers'])
        candidate_layers = copy.deepcopy(self.report['variants']['conditional-corrected']['layers'])
        for layer in ordinary_layers + candidate_layers:
            del layer['maskUV']
        self.assertEqual(ordinary_layers, candidate_layers)

    def test_repeat_and_clean_extractions_are_byte_identical(self):
        repeated = PATCH.extract(CLIENT, RAW, REFERENCE, self.output)
        self.assertEqual(repeated['status'], 'unchanged')
        clean = Path(self.temporary.name) / 'clean'
        rebuilt = PATCH.extract(CLIENT, RAW, REFERENCE, clean)
        self.assertEqual(rebuilt['status'], 'created')
        original = {path.relative_to(self.output).as_posix(): path.read_bytes() for path in self.output.rglob('*') if path.is_file()}
        new = {path.relative_to(clean).as_posix(): path.read_bytes() for path in clean.rglob('*') if path.is_file()}
        self.assertEqual(len(original), 8)
        self.assertEqual(original, new)
        self.assertEqual(rebuilt['receiptSha256'], repeated['receiptSha256'])


if __name__ == '__main__':
    unittest.main()
