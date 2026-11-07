import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
SPEC = importlib.util.spec_from_file_location('native_map_terrain', ROOT / 'scripts/derive-native-map-terrain.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def args(output, qualified):
    return SimpleNamespace(output=output, qualified_output=qualified, candidate=ROOT / M.EXTENSION / 'sector247-extraction/conditional-corrected/terrain.glb',
                           source_xyz=ROOT / M.EXTENSION / 'source-audit/candidate-native-xyz.json',
                           qualification=ROOT / M.DEFAULT_QUALIFICATION, base_bundle=ROOT / M.DEFAULT_BASE, stage_runtime=False)


class TerrainDerivationSafetyTests(unittest.TestCase):
    def test_corrupt_checkpoint_rejected_before_reading_payloads(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'CHECKPOINT-MANIFEST.json').write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError, 'hash/length differs'):
                M.read_qualification(root, {})
            self.assertEqual({p.name for p in root.iterdir()}, {'CHECKPOINT-MANIFEST.json'})

    def test_output_protection_rejects_sources_public_and_parent_traversal(self):
        default = ROOT / M.EXTENSION / 'never-created-by-protection-test'
        for output, qualified, message in (
                (ROOT / 'public/no-write', default, 'destination artifacts'),
                (ROOT / 'artifacts/native-parity/inputs/no-write', default, 'overlaps protected'),
                (ROOT / M.DEFAULT_QUALIFICATION / 'no-write', default, 'overlaps protected'),
                (ROOT / M.EXTENSION / 'source-audit/no-write', default, 'overlaps protected'),
                (default, default / 'nested', 'outputs overlap'),
                (ROOT / 'artifacts/../../no-write', default, 'Invalid path component')):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, message):
                M.run(args(output, qualified))
            self.assertFalse(default.exists())

    def test_immutable_io_preserves_conflicts_and_link_free_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'output'
            products = {'terrain247.glb': b'original', 'terrain247.json': b'{}'}
            M.io.preflight(root, products)
            for name, value in products.items():
                M.io.immutable_write(M.io.local(root, name), value)
            M.io.preflight(root, products)
            (root / 'terrain247.glb').write_bytes(b'new-authoring')
            with self.assertRaisesRegex(ValueError, 'Immutable output differs'):
                M.io.preflight(root, products)
            self.assertEqual((root / 'terrain247.glb').read_bytes(), b'new-authoring')
            with self.assertRaisesRegex(ValueError, 'Invalid path component'):
                M.io.local(root, '../escape')

    def test_catalog_helper_changes_only_selected_tokens_and_rejects_newer_work(self):
        original = {'unrelated': M.BASE, 'sections': [{'id': M.io.SECTION, 'manifestSha256': M.BASE,
                     'manifest': '/l2/maps/' + M.BASE + '/' + M.MANIFEST, 'authored': {'retain': 'Ā'}}]}
        before = json.dumps(original, indent=3, ensure_ascii=False).encode()
        changed = M.io.catalog_replace(before, M.BASE, 'f' * 64)
        after = json.loads(changed)
        self.assertEqual(after['unrelated'], M.BASE)
        self.assertEqual(after['sections'][0]['authored'], original['sections'][0]['authored'])
        self.assertEqual(M.io.catalog_replace(changed, 'f' * 64, M.BASE), before)
        with self.assertRaisesRegex(ValueError, 'newer work'):
            M.io.catalog_replace(changed, M.BASE, 'e' * 64)


@unittest.skipUnless((ROOT / M.DEFAULT_BASE).exists(), 'Pinned private map bundle is not staged')
class QualifiedTerrainDerivationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.observations = {}
        cls.rows, cls.joined, cls.pins = M.read_qualification(ROOT / M.DEFAULT_QUALIFICATION, cls.observations)
        cls.source = json.loads(M.checked(ROOT / M.EXTENSION / 'source-audit/candidate-native-xyz.json', M.SOURCE_XYZ_SHA))
        cls.candidate = M.checked(ROOT / M.EXTENSION / 'sector247-extraction/conditional-corrected/terrain.glb', M.CANDIDATE_SHA)
        cls.base = M.base_files(ROOT / M.DEFAULT_BASE, cls.observations)
        cls.geometry = M.qualified_geometry(cls.candidate, cls.source, cls.rows, cls.joined, {'checkpoint': M.CHECKPOINT_SHA})
        cls.digest, cls.products = M.derive(cls.base, cls.geometry)

    def test_qualification_changes_only_extras_and_copies_entire_bin_chunk(self):
        before, binary, chunk = M.glb_parts(self.candidate)
        after, new_binary, new_chunk = M.glb_parts(self.geometry['terrain247.glb'])
        self.assertEqual(new_binary, binary)
        self.assertEqual(new_chunk, chunk)
        after['meshes'][0]['extras'].pop('nativeTerrainCoordinateEvidence')
        after['meshes'][0]['extras']['offlineTerrainComparison'] = before['meshes'][0]['extras']['offlineTerrainComparison']
        for old_layer, new_layer in zip(before['meshes'][0]['extras']['nativeLayers'], after['meshes'][0]['extras']['nativeLayers']):
            self.assertEqual(new_layer['maskUVStatus'], M.MASK_STATUS)
            new_layer['maskUVStatus'] = old_layer['maskUVStatus']
        self.assertEqual(after, before)
        self.assertEqual(len(before['meshes'][0]['extras']['nativeLayers']), 9)

    def test_all_272_native_pairs_positions_and_actual_bounds_are_preserved(self):
        document, binary, _ = M.glb_parts(self.geometry['terrain247.glb'])
        uv = M.channel(document, binary, 'TEXCOORD_0', 2)
        for index, native in enumerate(self.rows):
            self.assertEqual(uv[index], bytes.fromhex(native['nativeTC0Float32LEHex']))
        self.assertEqual(M.sha(b''.join(uv)), M.TC0_SHA)
        metadata = json.loads(self.geometry['terrain247.json'])
        self.assertEqual(metadata['bounds']['nativeXYZFromAllVertices'][2], -3135.255126953125)
        self.assertEqual(metadata['bounds']['cachedNativeXYZNotUsed'][2], -3091.911376953125)
        self.assertFalse(metadata['geometry']['correctionAppliedByDerivation'])
        self.assertEqual(metadata['counts']['nativeRecords'], 323)
        self.assertTrue(metadata['nativeTerrainCoordinateEvidence']['nativeSubmittedCoordinatesQualified'])
        self.assertFalse(metadata['nativeTerrainCoordinateEvidence']['nativeVisiblePixelsQualified'])

    def test_ordinary_uv_and_double_corrected_bytes_are_rejected(self):
        ordinary = (ROOT / M.EXTENSION / 'sector247-extraction/ordinary/terrain.glb').read_bytes()
        with self.assertRaisesRegex(ValueError, 'candidate hash differs'):
            M.qualified_geometry(ordinary, self.source, self.rows, self.joined, {})
        document, binary, _ = M.glb_parts(self.candidate)
        data = bytearray(self.candidate)
        json_size = struct.unpack_from('<I', data, 12)[0]
        accessor = document['accessors'][document['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0']]
        offset = 28 + json_size + document['bufferViews'][accessor['bufferView']]['byteOffset'] + 18 * 8 + 4
        current = struct.unpack_from('<f', data, offset)[0]
        struct.pack_into('<f', data, offset, current - 1 / 4096)
        corrupted = bytes(data)
        # Exercise the row proof independently of the outer candidate-hash gate.
        with patch.object(M, 'CANDIDATE_SHA', M.sha(corrupted)), self.assertRaisesRegex(ValueError, 'refuse double correction'):
            M.qualified_geometry(corrupted, self.source, self.rows, self.joined, {})

    def test_source_row_uv_and_draw_reference_forgery_fail(self):
        for field in ('sourceXYZFloat32LEHex', 'nativeTC0Float32LEHex', 'referencingDrawCalls'):
            rows = copy.deepcopy(self.rows)
            if field == 'referencingDrawCalls':
                rows[18][field] = []
            else:
                value = rows[18][field]
                rows[18][field] = ('ff' if value[:2] != 'ff' else '00') + value[2:]
            with self.subTest(field=field), self.assertRaises(ValueError):
                M.qualified_geometry(self.candidate, self.source, rows, self.joined, {})

    def test_original735_uv2_and_all_other950_base_files_are_byte_identical(self):
        self.assertEqual(len(self.base), 952)
        self.assertEqual(len(self.products), 954)
        changed = {name for name, value in self.base.items() if self.products[name] != value}
        self.assertEqual(changed, {M.MANIFEST, M.RECEIPT})
        self.assertEqual(set(self.products) - set(self.base), {'map-section/terrain247.glb', 'map-section/terrain247.json'})
        original = json.loads(self.base[M.MANIFEST])
        updated = json.loads(self.products[M.MANIFEST])
        self.assertEqual(updated.pop('terrainPatches')[0]['gridBounds'], [112, 240, 128, 255])
        self.assertEqual(updated, original)
        document, binary, _ = M.glb_parts(self.products['map-section/terrain.glb'])
        attributes = document['meshes'][0]['primitives'][0]['attributes']
        accessor = document['accessors'][attributes['TEXCOORD_0']]
        view = document['bufferViews'][accessor['bufferView']]
        uv = binary[view['byteOffset']:view['byteOffset'] + view['byteLength']]
        self.assertEqual(M.sha(uv), 'd549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d')
        self.assertIn('TEXCOORD_1', attributes)
        self.assertEqual(self.products['map-section/terrain.glb'], self.base['map-section/terrain.glb'])

    def test_mutated_base_or_repeated_patch_is_rejected(self):
        changed = dict(self.base)
        manifest = json.loads(changed[M.MANIFEST]); manifest['gaps'].append('new authored work')
        changed[M.MANIFEST] = M.json_bytes(manifest)
        with self.assertRaisesRegex(ValueError, 'Base bundle changed'):
            M.derive(changed, self.geometry)
        with self.assertRaisesRegex(ValueError, 'Base bundle changed'):
            M.derive(self.products, self.geometry)

    def test_repeat_clean_memory_derivation_and_manifest_fields_are_stable(self):
        geometry = M.qualified_geometry(self.candidate, self.source, self.rows, self.joined, {'checkpoint': M.CHECKPOINT_SHA})
        self.assertEqual(geometry, self.geometry)
        self.assertEqual(M.derive(self.base, geometry), (self.digest, self.products))
        before, after = json.loads(self.base[M.RECEIPT]), json.loads(self.products[M.RECEIPT])
        self.assertEqual(after.pop('manifestSha256'), self.digest)
        after['derivation'].pop('terrainPatch')
        before.pop('manifestSha256')
        self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main()
