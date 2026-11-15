"""Native float influence parity, unchanged geometry and glTF constraints."""
import base64
from collections import defaultdict
import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import Document
from native_assets_lib.weights import (
    NATIVE_JOINTS, NATIVE_WEIGHTS, _rows, aggregate, gltf_sum_compatibility,
    native_vertices, restore_native_weights,
)
from native_catalog.skeletal import SkeletalReader, decode_skeletal_source
from native_catalog.ue2 import FormatError, Package, Reader

CLIENT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
MIGRATION = Path(os.environ.get('L2_MIGRATION_TEST_OUTPUT', str(ROOT / 'artifacts/native-parity/migration'))).resolve()
OBJECTS = {
    'LineageMonsters': ['field_stalker_m00'],
    'Fighter': ['MFighter_m001_u', 'MFighter_m001_l', 'MFighter_m001_g', 'MFighter_m001_b',
                'MFighter_m000_f', 'MFighter_m000_m00_ah', 'MFighter_m000_m00_bh'],
    'LineageWeapons': ['small_sword_m00_wp'],
}


class NativeWeightBoundsTests(unittest.TestCase):
    def test_unreviewed_package_layout_is_rejected_before_property_read(self):
        for version, licensee in ((123, 27), (123, 29), (124, 30), (118, 0)):
            package = type('PackageStub', (), {'summary': {'version': version, 'licenseeVersion': licensee}})()
            with self.subTest(version=version, licensee=licensee), self.assertRaisesRegex(FormatError, 'reviewed UE2'):
                SkeletalReader(package, {'className': 'SkeletalMesh'})

    def test_native_lazy_array_requires_exact_end_and_bounded_payload(self):
        for payload in (struct.pack('<i', 99) + b'\1' + struct.pack('<fHH', 1, 0, 0), struct.pack('<i', 13) + b'\1\0'):
            reader = object.__new__(SkeletalReader)
            reader.reader = Reader(payload)
            reader.package = type('PackageStub', (), {'data': payload})()
            reader.records = []
            with self.subTest(payload=payload), self.assertRaises(FormatError):
                reader.array('weights', 'fHH', lazy=True, retain=True)

    def test_duplicate_addition_is_float32_without_renormalization(self):
        exact, combined = aggregate([(2, .25), (2, .25), (3, .49997)])
        self.assertEqual(exact[2], .5)
        self.assertEqual(combined[2], .5)
        self.assertLess(sum(combined.values()), 1)
        self.assertFalse(gltf_sum_compatibility(combined.values())['passed'])
        self.assertTrue(gltf_sum_compatibility([.5, .5])['passed'])
        with self.assertRaises(FormatError):
            aggregate([(0, float('nan'))])


@unittest.skipUnless((CLIENT / 'animations/LineageMonsters.ukx').is_file() and MIGRATION.is_dir(), 'Staged source and retained migration exports unavailable')
class NativeWeightSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = {}
        for package_name, objects in OBJECTS.items():
            path = CLIENT / 'animations' / (package_name + '.ukx')
            package = Package(path.read_bytes(), path.name)
            for name in objects:
                matches = sorted(MIGRATION.glob('assets/*/evidence/**/' + name + '.gltf'))
                if not matches:
                    raise unittest.SkipTest('Retained export unavailable: ' + name)
                item = next(item for item in package.exports if item['name'] == name)
                cls.fixtures[name] = (package, item, matches[-1])

    def test_sequential_serializer_consumes_all_current_sources_without_offsets(self):
        for name, (package, item, _) in self.fixtures.items():
            with self.subTest(name=name):
                source = decode_skeletal_source(package, item)
                self.assertEqual(source['bytesConsumed'], item['size'])
                self.assertEqual(source['records'][-1]['end'] + 4, item['offset'] + item['size'])
                self.assertIn(source['licenseeVersion'], (28, 30))
                self.assertEqual(len(source['bones']), 49 if name.startswith('field_') else 1 if name.startswith('small_') else 70)
        # Independent source audit offsets are test evidence only; production
        # discovers these by sequential serialized fields and lazy boundaries.
        source = decode_skeletal_source(*self.fixtures['field_stalker_m00'][:2])
        self.assertEqual(source['boneRecord']['offset'], 93297913)
        self.assertEqual(source['lods'][0]['influences']['record']['offset'], 93356252)
        self.assertEqual(source['lods'][0]['wedges']['record']['offset'], 93370682)
        self.assertEqual(source['lods'][0]['points']['record']['offset'], 93405452)

    def test_every_original_buffer_and_geometry_rig_accessor_remains_unchanged(self):
        expected = {'field_stalker_m00': 1591, 'MFighter_m001_u': 313, 'MFighter_m001_l': 347,
                    'MFighter_m001_g': 224, 'MFighter_m001_b': 188, 'MFighter_m000_f': 207,
                    'MFighter_m000_m00_ah': 135, 'MFighter_m000_m00_bh': 168, 'small_sword_m00_wp': 81}
        for name, (package, item, path) in self.fixtures.items():
            with self.subTest(name=name):
                document = Document(path)
                original = bytes(document.binary)
                before = copy.deepcopy(document.data)
                report, sidecar = restore_native_weights(document, package, item)
                self.assertEqual(bytes(document.binary[:len(original)]), original)
                self.assertEqual(document.data['accessors'][:len(before['accessors'])], before['accessors'])
                for key in ('nodes', 'skins', 'scenes'):
                    self.assertEqual(document.data[key], before[key])
                for primitive, previous in zip(document.data['meshes'][0]['primitives'], before['meshes'][0]['primitives']):
                    for key, value in previous['attributes'].items():
                        if key not in ('WEIGHTS_0', 'JOINTS_0'):
                            self.assertEqual(primitive['attributes'][key], value)
                    self.assertEqual(primitive['indices'], previous['indices'])
                self.assertEqual(report['exportedVertexCount'], expected[name])
                self.assertEqual(report['matchedSourceVertices'], expected[name])
                self.assertFalse(report['normalizationApplied'])
                self.assertEqual(sidecar['bytesConsumed'], item['size'])
                for source_array in sidecar['lod0'].values():
                    raw = base64.b64decode(source_array['base64'])
                    self.assertEqual(raw, package.data[source_array['dataOffset']:source_array['end']])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), source_array['sha256'])

    def test_musveren_exact_slots_match_independent_native_float_rows_for_all_1591_vertices(self):
        package, item, path = self.fixtures['field_stalker_m00']
        document = Document(path)
        report, sidecar = restore_native_weights(document, package, item)
        # Independent bounded research audit establishes these two raw array
        # offsets/counts. No production decoder/helper supplies these values.
        rows = list(struct.iter_unpack('<fHH', package.data[93356258:93356258 + 1803 * 8]))
        wedges = list(struct.iter_unpack('<Hff', package.data[93370688:93370688 + 1591 * 10]))
        by_point = defaultdict(list)
        for weight, point, bone in rows:
            by_point[point].append((bone, weight))
        mapping = {row['sourceBoneIndex']: row['paletteIndex'] for row in report['boneMapping']}
        checked = 0
        for primitive, evidence in zip(document.data['meshes'][0]['primitives'], report['primitives']):
            weights = _rows(document, primitive['attributes'][NATIVE_WEIGHTS])
            joints = _rows(document, primitive['attributes'][NATIVE_JOINTS])
            for actual_weights, actual_joints, sources in zip(weights, joints, evidence['sourceVertexMapping']):
                source_rows = by_point[wedges[sources[0]][0]]
                original_weights = tuple([weight for _, weight in source_rows] + [0.0] * (4 - len(source_rows)))
                original_joints = tuple([mapping[bone] for bone, _ in source_rows] + [0] * (4 - len(source_rows)))
                self.assertEqual(struct.pack('<4f', *actual_weights), struct.pack('<4f', *original_weights))
                self.assertEqual(actual_joints, original_joints)
                checked += 1
        self.assertEqual(checked, 1591)
        self.assertTrue(all(row['standardWeightsRestored'] for row in report['primitives']))
        self.assertEqual(sum(row['duplicateJointVertices'] for row in report['primitives']), 109)
        self.assertLessEqual(max(row['maxSameBoneFloat32AggregationError'] for row in report['primitives']), 6e-8)
        self.assertAlmostEqual(max(row['maxAbsoluteWeightChangeBeforeRestoration'] for row in report['primitives']), .0026092944776310856)
        self.assertEqual(report['sourceRepresentations']['differentWeightVertices'], 684)
        self.assertEqual(report['sourceRepresentations']['maxAbsolutePerBoneWeightDifference'], 3.0517578125e-5)
        self.assertIn('source-selection-unverified', report['nativeWeightSourceSelection'])

    def test_fighter_incompatible_sums_keep_standard_derivative_and_exact_custom_slots(self):
        for name in ('MFighter_m001_u', 'MFighter_m001_l', 'MFighter_m001_g', 'MFighter_m001_b'):
            with self.subTest(name=name):
                package, item, path = self.fixtures[name]
                document = Document(path)
                old = document.data['meshes'][0]['primitives'][0]['attributes']['WEIGHTS_0']
                report, sidecar = restore_native_weights(document, package, item)
                primitive = document.data['meshes'][0]['primitives'][0]
                self.assertEqual(primitive['attributes']['WEIGHTS_0'], old)
                self.assertEqual(report['mode'], 'native-attributes-with-standard-derivative')
                self.assertFalse(report['primitives'][0]['gltfSumCompatibility']['passed'])
                self.assertTrue(report['primitives'][0]['nativeRuntimeOverrideRequired'])
                source_rows = sidecar['lod0']['lineageWedges']['rows']
                exact = _rows(document, primitive['attributes'][NATIVE_WEIGHTS])
                for actual, candidates in zip(exact, report['primitives'][0]['sourceVertexMapping']):
                    self.assertEqual(actual, source_rows[candidates[0]][12:16])
                self.assertLess(report['primitives'][0]['sourceWeightSumMin'], .999999)

    def test_duplicate_native_bone_names_resolve_by_authored_parent_paths(self):
        package, item, path = self.fixtures['MFighter_m001_l']
        document = Document(path)
        report, _ = restore_native_weights(document, package, item)
        rows = [row for row in report['boneMapping'] if row['name'] == 'Bip01_L_Finger01']
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['parentNamePath'], rows[1]['parentNamePath'])
        self.assertNotEqual(rows[0]['paletteIndex'], rows[1]['paletteIndex'])
        self.assertEqual([document.data['nodes'][document.data['skins'][0]['joints'][row['paletteIndex']]]['name'] for row in rows], ['Bip01_L_Finger01'] * 2)

    def test_ambiguous_weights_fail_before_mutating_export(self):
        package, item, path = self.fixtures['field_stalker_m00']
        source = decode_skeletal_source(package, item)
        vertices, representation, alternatives, lod = native_vertices(source)
        duplicate = copy.deepcopy(vertices[0])
        duplicate['influences'] = [(duplicate['influences'][0][0], .75)]
        document = Document(path)
        binary, data = bytes(document.binary), copy.deepcopy(document.data)
        with patch('native_assets_lib.weights.native_vertices', return_value=(vertices + [duplicate], representation, alternatives, lod)):
            with self.assertRaisesRegex(FormatError, 'Ambiguous native vertices'):
                restore_native_weights(document, package, item)
        self.assertEqual(bytes(document.binary), binary)
        self.assertEqual(document.data, data)

    @unittest.skipUnless((ROOT / 'node_modules/gltf-validator').is_dir(), 'Pinned validator unavailable')
    def test_all_current_custom_attribute_glbs_validate_and_exact_fighter_weights_exceed_standard_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = []
            for name, (package, item, path) in self.fixtures.items():
                document = Document(path)
                restore_native_weights(document, package, item)
                target = root / (name + '.glb')
                target.write_bytes(document.glb())
                files.append(str(target))
                if name == 'MFighter_m001_u':
                    attributes = document.data['meshes'][0]['primitives'][0]['attributes']
                    attributes['WEIGHTS_0'] = attributes[NATIVE_WEIGHTS]
                    attributes['JOINTS_0'] = attributes[NATIVE_JOINTS]
                    invalid = root / 'exact-fighter-as-standard.glb'
                    invalid.write_bytes(document.glb())
            script = "const fs=require('fs'),v=require('gltf-validator');(async()=>{const rows=[];for(const p of process.argv.slice(1)){const r=await v.validateBytes(new Uint8Array(fs.readFileSync(p)));rows.push(r.issues);}process.stdout.write(JSON.stringify(rows));})().catch(e=>{console.error(e);process.exit(1)});"
            completed = subprocess.run(['node', '-e', script, *files, str(invalid)], cwd=ROOT, capture_output=True, text=True, timeout=120, check=True)
            issues = json.loads(completed.stdout)
            for name, result in zip(files, issues[:-1]):
                self.assertEqual((result['numErrors'], result['numWarnings']), (0, 0), (name, result))
            self.assertGreater(issues[-1]['numErrors'], 0)
            self.assertIn('ACCESSOR_WEIGHTS_NON_NORMALIZED', {issue['code'] for issue in issues[-1]['messages']})


if __name__ == '__main__':
    unittest.main()
