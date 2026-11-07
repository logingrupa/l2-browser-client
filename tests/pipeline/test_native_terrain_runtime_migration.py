"""UV-only runtime derivation keeps old assets and refuses stale publication."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
import test_stage_native_runtime as staging_fixture
from native_assets_lib.gltf import json_bytes
from native_map_geometry import GltfBuilder

spec = importlib.util.spec_from_file_location('terrain_runtime_migration', ROOT / 'scripts/migrate-native-terrain-runtime.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class TerrainRuntimeMigrationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = staging_fixture.RuntimeStagingTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        builder = GltfBuilder()
        points = [[float(x), 0., float(y)] for y in range(208, 256) for x in range(64, 113)]
        uv = [[(x+.5)/256, (y+.5)/256] for y in range(208, 256) for x in range(64, 113)]
        attributes = {
            'POSITION': builder.accessor(points, len(points), 'VEC3'),
            'NORMAL': builder.accessor([[0., 1., 0.]] * len(points), len(points), 'VEC3'),
            'TEXCOORD_0': builder.accessor(uv, len(points), 'VEC2'),
            'TEXCOORD_1': builder.accessor([[x*3, y*5] for x, y in uv], len(points), 'VEC2'),
        }
        indices = builder.accessor([0, 49, 1], 3, 'SCALAR', 5125)
        builder.data['meshes'] = [{'primitives': [{'attributes': attributes, 'indices': indices}], 'extras': {}}]
        self.old_files = builder.files()
        self.geometry_manifest = {'kind': 'native-terrain-section', 'recipe': {'referenceActor': '20_20.PlayerStart10'},
            'selectedRegion': {'offset': [64, 208], 'quads': [48, 47]}}
        self.old_files.update({'manifest.json': json_bytes(self.geometry_manifest), 'native-defaults/Engine.Actor.uc': b'preserved native defaults'})
        self.fixture.geometry_receipt = {'kind': 'native-terrain-section', 'sourceDependencies': {'maps/20_20.unr': migration.MAP_SHA},
            'outputs': {name: migration.digest(data) for name, data in self.old_files.items()}}
        for name, data in self.old_files.items():
            self.fixture.write(self.fixture.geometry / name, data)
        self.fixture.write_json(self.fixture.geometry / 'receipt.json', self.fixture.geometry_receipt)
        self.fixture.manifest['terrain'].update(sha256=migration.digest(self.old_files['terrain.glb']), bytes=len(self.old_files['terrain.glb']))
        self.fixture.manifest['surfaceSpawnCandidate'] = {'nativePosition': [17, 23, 42], 'unverified': True}
        self.fixture.runtime_receipt['converterImplementationSha256'] = 'd' * 64
        self.fixture.runtime_receipt['implementationSha256'] = 'e' * 64
        self.fixture.refresh_receipts()
        self.fixture.stage()
        self.base_manifest = migration.digest((self.fixture.runtime / 'manifest.json').read_bytes())
        self.base_patch = patch.object(migration, 'BASE_MANIFEST', self.base_manifest)
        self.base_patch.start()
        self.addCleanup(self.base_patch.stop)
        self.catalog = self.root / 'public/l2/catalog.json'
        catalog = json.loads(self.catalog.read_bytes())
        catalog['sections'][0]['authoredExtension'] = {'preserve': 'yes'}
        catalog['unrelated'] = {'spacingMatters': 'untouched Unicode Ā', 'nested': [1, 2, 3]}
        self.catalog.write_text(json.dumps(catalog, indent=3, ensure_ascii=False)+'\n', encoding='utf-8')
        self.before_catalog = self.catalog.read_bytes()
        self.geometry = self.root / 'artifacts/corrected/map-section'
        self.output = self.root / 'artifacts/runtime-derived'
        uv_start = builder.data['bufferViews'][builder.data['accessors'][attributes['TEXCOORD_0']]['bufferView']]['byteOffset']
        for vertex in range(2352):
            y = 208 + vertex // 49
            if y > 240:
                struct.pack_into('<f', builder.binary, uv_start + vertex*8 + 4, (y+.5)/256-(y-240)/4096)
        rule = {'id': migration.RULE, 'source': {'packageSha256': migration.MAP_SHA, 'object': '20_20.TerrainInfo0',
            'heightmapDimensions': [256, 256], 'gridMinimum': [64, 208], 'gridMaximum': [112, 255]}}
        builder.data['meshes'][0]['extras']['maskUVRule'] = rule
        self.new_files = builder.files()
        self.new_files.update({'manifest.json': json_bytes({**self.geometry_manifest, 'maskUVRule': rule}),
            'native-defaults/Engine.Actor.uc': self.old_files['native-defaults/Engine.Actor.uc']})
        self.write_new_geometry()

    def write_new_geometry(self):
        for name, data in self.new_files.items():
            self.fixture.write(self.geometry / name, data)
        receipt = {**self.fixture.geometry_receipt, 'outputs': {name: migration.digest(data) for name, data in self.new_files.items()}}
        self.fixture.write_json(self.geometry / 'receipt.json', receipt)

    def snapshot(self, root):
        return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}

    def prepare(self):
        return migration.prepare_bundle(self.root, self.geometry, self.output)

    def test_dry_bundle_retains_all_runtime_data_except_terrain_and_derivation(self):
        public_before = self.snapshot(self.root / 'public')
        plan = self.prepare()
        self.assertEqual(self.snapshot(self.root / 'public'), public_before)
        derived = json.loads((self.output / ('maps/' + plan['manifestSha256'] + '/map-section-runtime/manifest.json')).read_bytes())
        original = copy.deepcopy(derived)
        original.pop('derivation')
        original['terrain'] = self.fixture.manifest['terrain']
        self.assertEqual(original, self.fixture.manifest)
        self.assertEqual(derived['derivation']['changedVScalars'], 735)
        self.assertEqual(derived['derivation']['originalConverterProvenance']['converterImplementationSha256'], 'd' * 64)
        self.assertIn('no reconversion', derived['derivation']['modelConversion'])

    def test_stage_changes_only_selected_catalog_value_and_retains_old_resources(self):
        old_tree = self.root / ('public/l2/maps/' + self.base_manifest)
        original_files = self.snapshot(old_tree)
        plan = self.prepare()
        migration.stage_bundle(self.root, self.output)
        after = self.catalog.read_bytes()
        before_json, after_json = json.loads(self.before_catalog), json.loads(after)
        self.assertEqual(after_json['sections'][0]['authoredExtension'], {'preserve': 'yes'})
        after_json['sections'] = before_json['sections']
        self.assertEqual(before_json, after_json)
        self.assertEqual(self.snapshot(old_tree), original_files)
        before_text, after_text = self.before_catalog.decode(), after.decode()
        section_start = before_text.index('{', before_text.index('"sections"'))
        _, section_end = json.JSONDecoder().raw_decode(before_text, section_start)
        self.assertTrue(after_text.startswith(before_text[:section_start]))
        self.assertTrue(after_text.endswith(before_text[section_end:]))
        self.assertEqual(json.loads(after)['sections'][0]['manifestSha256'], plan['manifestSha256'])

    def test_repeated_prepare_and_stage_are_byte_and_mtime_idempotent(self):
        first = self.prepare()
        migration.stage_bundle(self.root, self.output)
        before = self.snapshot(self.root / 'public'), self.snapshot(self.output)
        self.assertEqual(self.prepare(), first)
        result = migration.stage_bundle(self.root, self.output)
        self.assertEqual(result['status'], 'already-staged')
        self.assertEqual((self.snapshot(self.root / 'public'), self.snapshot(self.output)), before)

    def test_changed_position_with_rehashed_receipt_is_refused(self):
        doc, binary = migration.glb_parts(self.new_files['terrain.glb'])
        altered = bytearray(binary)
        struct.pack_into('<f', altered, 0, 999.)
        text = json_bytes(doc)
        text += b' ' * (-len(text) % 4)
        self.new_files['terrain.glb'] = struct.pack('<III', 0x46546c67, 2, 28 + len(text) + len(altered)) + struct.pack('<I4s', len(text), b'JSON') + text + struct.pack('<I4s', len(altered), b'BIN\0') + altered
        self.new_files['terrain.bin'] = bytes(altered)
        self.write_new_geometry()
        with self.assertRaisesRegex(ValueError, 'outside the 735'):
            self.prepare()
        self.assertEqual(self.catalog.read_bytes(), self.before_catalog)
        self.assertFalse(self.output.exists())

    def test_stale_catalog_refuses_stage_without_new_public_resources(self):
        self.prepare()
        self.catalog.write_bytes(self.before_catalog + b' ')
        before = self.snapshot(self.root / 'public')
        with self.assertRaisesRegex(ValueError, 'Stale catalog'):
            migration.stage_bundle(self.root, self.output)
        self.assertEqual(self.snapshot(self.root / 'public'), before)

    def test_corrupt_bundle_model_refuses_stage(self):
        plan = self.prepare()
        model = next(name for name in plan['files'] if name.endswith('/model.glb'))
        (self.output / model).write_bytes(b'corrupted')
        before = self.snapshot(self.root / 'public')
        with self.assertRaisesRegex(ValueError, 'Hash/length mismatch'):
            migration.stage_bundle(self.root, self.output)
        self.assertEqual(self.snapshot(self.root / 'public'), before)

    def test_receipt_traversal_is_rejected_before_output(self):
        receipt = json.loads((self.geometry / 'receipt.json').read_bytes())
        receipt['outputs']['../outside.bin'] = '0' * 64
        self.fixture.write_json(self.geometry / 'receipt.json', receipt)
        with self.assertRaisesRegex(ValueError, 'Unsafe relative path'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_rehashed_derived_receipt_cannot_claim_another_conversion(self):
        plan = self.prepare()
        relative = 'maps/' + plan['manifestSha256'] + '/map-section-runtime/receipt.json'
        receipt = json.loads((self.output / relative).read_bytes())
        receipt['converterImplementationSha256'] = '0' * 64
        data = json_bytes(receipt)
        (self.output / relative).write_bytes(data)
        plan['files'][relative] = {'sha256': migration.digest(data), 'bytes': len(data)}
        (self.output / 'bundle.json').write_bytes(json_bytes(plan))
        before = self.snapshot(self.root / 'public')
        with self.assertRaisesRegex(ValueError, 'Derived receipt differs'):
            migration.stage_bundle(self.root, self.output)
        self.assertEqual(self.snapshot(self.root / 'public'), before)

if __name__ == '__main__':
    unittest.main()
