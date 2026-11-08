import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.static_normals import restore_mapped_static_normals, restore_glb_static_normals, read_proven_normal_streams
from native_catalog.ue2 import Package
from reference_client_lock_fixture import lock_client_as_reference_root
cli_spec = importlib.util.spec_from_file_location('static_normal_cli', ROOT / 'scripts/restore-native-static-normals.py')
normal_cli = importlib.util.module_from_spec(cli_spec)
cli_spec.loader.exec_module(normal_cli)


def fixture():
    native = {'vertices': [(0., 0., 0., .2, -0., .6), (100., 0., 0., 1., .1, 0.), (0., 100., 0., 0., 1., .4)],
              'uvs': [(0., 0.), (1., 0.), (0., 1.)], 'indices': [2, 0, 1, 1, 0, 2],
              'sections': [(0, 0, 0, 2, 1, 1), (0, 3, 0, 2, 1, 1)]}
    data = {'buffers': [{'byteLength': 0}], 'bufferViews': [], 'accessors': [], 'meshes': [{'primitives': []}]}
    binary = bytearray()
    def accessor(values, fmt, kind, component):
        while len(binary) % 4:
            binary.extend(b'\0')
        payload = b''.join(struct.pack('<' + fmt, *value) for value in values)
        view = len(data['bufferViews'])
        data['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(payload)})
        index = len(data['accessors'])
        data['accessors'].append({'bufferView': view, 'componentType': component, 'count': len(values), 'type': kind})
        binary.extend(payload)
        return index
    scale = struct.unpack('<f', struct.pack('<f', .01))[0]
    for section_index, source_indices in enumerate(([2, 0, 1], [1, 0, 2])):
        indices = accessor([(0,), (1,), (2,)], 'H', 'SCALAR', 5123)
        positions = accessor([tuple(native['vertices'][i][axis] * scale for axis in (0, 2, 1)) for i in source_indices], '3f', 'VEC3', 5126)
        normals = accessor([(0., 0., 1.) for _ in source_indices], '3f', 'VEC3', 5126)
        uv = accessor([native['uvs'][i] for i in source_indices], '2f', 'VEC2', 5126)
        data['meshes'][0]['primitives'].append({'indices': indices, 'material': section_index,
                                               'attributes': {'POSITION': positions, 'NORMAL': normals, 'TEXCOORD_0': uv}})
    data['buffers'][0]['byteLength'] = len(binary)
    return SimpleNamespace(data=data, binary=binary), native


class StaticNormalTests(unittest.TestCase):
    def test_exact_float_bits_signed_zero_and_nonunit_normals_are_preserved(self):
        document, native = fixture()
        before, json_before = bytes(document.binary), copy.deepcopy(document.data)
        report = restore_mapped_static_normals(document, native)
        self.assertEqual(document.data, json_before)
        touched = set()
        for row in report['sections']:
            start, size = row['byteOffset'], row['bytes']
            expected = b''.join(struct.pack('<3f', *(native['vertices'][i][axis] for axis in (3, 5, 4))) for i in row['sourceVertexFirstUse'])
            self.assertEqual(bytes(document.binary[start:start + size]), expected)
            touched.update(range(start, start + size))
        self.assertTrue(all(a == b for index, (a, b) in enumerate(zip(before, document.binary)) if index not in touched))
        self.assertFalse(report['normalizationApplied'])
        self.assertEqual(restore_mapped_static_normals(document, native)['changedBytes'], 0)

    def test_late_mapping_failure_does_not_partially_write_prior_section(self):
        for attribute in ('POSITION', 'TEXCOORD_0'):
            document, native = fixture()
            index = document.data['meshes'][0]['primitives'][1]['attributes'][attribute]
            view = document.data['bufferViews'][document.data['accessors'][index]['bufferView']]
            document.binary[view['byteOffset']] ^= 1
            before = bytes(document.binary)
            with self.subTest(attribute=attribute), self.assertRaisesRegex(ValueError, 'mapping differs'):
                restore_mapped_static_normals(document, native)
            self.assertEqual(bytes(document.binary), before)

    def test_wrong_index_order_and_nonfinite_source_rejected(self):
        document, native = fixture()
        native['indices'][0:3] = [0, 0, 1]
        with self.assertRaisesRegex(ValueError, 'index mapping differs'):
            restore_mapped_static_normals(document, native)
        document, native = fixture()
        native['vertices'][0] = (0., 0., 0., float('nan'), 0., 1.)
        with self.assertRaisesRegex(ValueError, 'malformed'):
            restore_mapped_static_normals(document, native)

    def test_shared_normal_attribute_and_overlapping_views_rejected(self):
        for mode in ('attribute', 'view', 'accessor', 'image'):
            document, native = fixture()
            normal = document.data['meshes'][0]['primitives'][0]['attributes']['NORMAL']
            view = document.data['accessors'][normal]['bufferView']
            if mode == 'attribute':
                document.data['meshes'][0]['primitives'][0]['attributes']['EXTRA'] = normal
            elif mode == 'view':
                document.data['bufferViews'].append(copy.deepcopy(document.data['bufferViews'][view]))
            elif mode == 'accessor':
                document.data['accessors'].append(copy.deepcopy(document.data['accessors'][normal]))
            else:
                document.data['images'] = [{'bufferView': view}]
            before = bytes(document.binary)
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                restore_mapped_static_normals(document, native)
            self.assertEqual(bytes(document.binary), before)

    def test_unknown_source_proof_is_rejected_before_any_native_read(self):
        with self.assertRaisesRegex(ValueError, 'Unqualified'):
            read_proven_normal_streams(None, None, b'{}')

    def test_cli_refuses_source_output_and_wrong_archive_identity_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'client'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            archive = root / 'original.l2asset'
            archive.write_bytes(b'untouched-input')
            with self.assertRaisesRegex(ValueError, 'outside the source'):
                normal_cli.derive(archive, 'bad', client, root / 'absent-proof.json', client / 'output')
            output = root / 'output'
            with self.assertRaisesRegex(ValueError, 'archive hash differs'):
                normal_cli.derive(archive, 'bad', client, root / 'absent-proof.json', output)
            self.assertFalse(output.exists())
            self.assertFalse((client / 'output').exists())
            self.assertEqual(archive.read_bytes(), b'untouched-input')

    def test_actual_derived_archive_repeat_preserves_outputs_and_refuses_conflicts(self):
        root = ROOT / 'artifacts/native-parity/research/map-overlap-expansion-20261106'
        archive = root / 'new-tree-conversion/conversion/3333e47c45901dc8ddd9308f635d0d50fbc45bd5e76935e3539477af0f002165/asset.l2asset'
        if not archive.exists():
            self.skipTest('Retained private original tree fixture is not staged')
        client = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
        proof = root / 'bounds-scout/candidate-native-triangle-check.json'
        with tempfile.TemporaryDirectory() as directory:
            result = normal_cli.derive(archive, archive.parent.name, client, proof, directory)
            self.assertEqual(result['status'], 'created')
            again = normal_cli.derive(archive, archive.parent.name, client, proof, directory)
            self.assertEqual(again['status'], 'unchanged')
            self.assertEqual(result['archiveSha256'], again['archiveSha256'])
            model = Path(result['archive']).parent / 'model.glb'
            original = model.read_bytes()
            model.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            conflicted = model.read_bytes()
            with self.assertRaisesRegex(ValueError, 'output bytes differ'):
                normal_cli.derive(archive, archive.parent.name, client, proof, directory)
            self.assertEqual(model.read_bytes(), conflicted)

    def test_retained_tree_exact_native_source_and_all_other_glb_bytes(self):
        root = ROOT / 'artifacts/native-parity/research/map-overlap-expansion-20261106'
        original_path = root / 'new-tree-conversion/conversion/3333e47c45901dc8ddd9308f635d0d50fbc45bd5e76935e3539477af0f002165/model.glb'
        if not original_path.exists():
            self.skipTest('Retained private original tree fixture is not staged')
        package_path = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC/staticmeshes/dion_tree_s.usx'
        package = Package(package_path.read_bytes(), package_path.name)
        item = next(row for row in package.exports if row['exportIndex'] == 56)
        proof = (root / 'bounds-scout/candidate-native-triangle-check.json').read_bytes()
        original = original_path.read_bytes()
        changed, report = restore_glb_static_normals(original, package, item, proof)
        self.assertEqual(report['vertices'], 533)
        self.assertEqual(report['changedFloatFields'], 1599)
        self.assertEqual(report['changedBytes'], 4120)
        self.assertEqual(hashlib.sha256(changed).hexdigest(), 'aac78048d33b492052393816d4614ac7bced576b3a36924c3ad5d0452a105ebf')
        spans = set()
        source = json.loads(proof)
        vertex_field = next(row for row in source['sourceFieldRanges'] if row['field'] == 'vertices')
        compact_vertex_count_bytes = 2
        for row in report['sections']:
            start = report['glbBinaryOffset'] + row['byteOffset']
            for index, source_index in enumerate(row['sourceVertexFirstUse']):
                base = vertex_field['offset'] + compact_vertex_count_bytes + source_index * 24
                original_source_float_bytes = b''.join(package.data[base + axis * 4:base + axis * 4 + 4] for axis in (3, 5, 4))
                self.assertEqual(changed[start + index * 12:start + (index + 1) * 12], original_source_float_bytes)
            spans.update(range(start, start + row['bytes']))
        self.assertEqual(len(changed), len(original))
        self.assertTrue(all(a == b for index, (a, b) in enumerate(zip(original, changed)) if index not in spans))
        same, repeated = restore_glb_static_normals(changed, package, item, proof)
        self.assertEqual(same, changed)
        self.assertEqual(repeated['changedBytes'], 0)


if __name__ == '__main__':
    unittest.main()
