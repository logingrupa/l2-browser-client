import argparse
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bsp_derivation', ROOT / 'scripts/derive-native-map-bsp.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BspDerivationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bsp_root = self.root / 'artifacts/extraction'
        self.output = self.root / 'artifacts/derived'
        manifest = {
            'placements': [{'id': module.SUPPORT_ID, 'matrix': [1, 0, 0, 1], 'materialOverrides': []}] +
                          [{'id': f'original-{i}', 'unknown': {'preserve': True}} for i in range(155)],
            'models': [{'id': f'model-{i}'} for i in range(61)],
            'derivation': {'changedVScalars': 735, 'primaryUVSha256': 'd549356f-retained'},
            'coverage': {'existing': 1}, 'gaps': ['native pixels unverified'],
            'terrain': {'file': 'terrain.glb', 'sha256': 'existing'},
            'resourceRoots': {'terrain': '../map-section', 'models': '../map-section-models'},
            'unknown': {'keep': [1, 2, 3]},
        }
        manifest_bytes = module.json_bytes(manifest)
        self.base = module.sha(manifest_bytes)
        receipt = {'manifestSha256': self.base, 'derivation': {'changedVScalars': 735},
                   'modelArchives': {'existing': 'archive'}, 'sectionReceiptSha256': 'retained',
                   'validationScope': 'Original scope must remain byte-semantically identical',
                   'unknown': {'preserve': 17}}
        self.files = {module.MANIFEST_FILE: manifest_bytes,
                      module.RECEIPT_FILE: module.json_bytes(receipt),
                      'map-section/terrain.glb': b'corrected 735 V; preserved UV2',
                      'map-section-models/tree/model.glb': b'existing mesh untouched'}
        self.base_root = self.root / 'public/l2/maps' / self.base
        self.write_files(self.base_root, self.files)
        base_plan = module.json_bytes({'manifestSha256': self.base, 'files': self.records(self.files)})
        plan_path = self.root / 'artifacts/base.json'
        plan_path.parent.mkdir(parents=True)
        plan_path.write_bytes(base_plan)
        self.patches = [mock.patch.object(module, 'ROOT', self.root), mock.patch.object(module, 'BASE', self.base),
                        mock.patch.object(module, 'BASE_BUNDLE', plan_path),
                        mock.patch.object(module, 'BASE_BUNDLE_SHA', module.sha(base_plan)),
                        mock.patch.object(module, 'BASE_FILE_COUNT', len(self.files))]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)
        geometry = {'schemaVersion': 1, 'kind': 'native-bsp-floor-geometry',
                    **{key: module.SOURCE[key] for key in ('id', 'sourceModel', 'sourceBrush')},
                    'positions': [1, 2, 3], 'normals': [0, 1, 0], 'uvs': [0, 0], 'indices': [0]}
        self.bsp = {'bsp-floor.glb': b'GLB source-backed floor', 'bsp-floor.json': module.json_bytes(geometry),
                    'texture.png': b'original extracted texture'}
        bsp_manifest = {'schemaVersion': 1, 'kind': 'native-bsp-floor-bundle', **module.SOURCE,
                        'counts': {'nodes': 10, 'vertices': 48, 'triangles': 28},
                        'files': self.records(self.bsp), 'source': {'readerSha256': 'recorded'},
                        'limitations': ['No native pixels, lighting or collision claim']}
        self.bsp['manifest.json'] = module.json_bytes(bsp_manifest)
        self.bsp_sha = module.sha(self.bsp['manifest.json'])
        self.write_files(self.bsp_root, self.bsp)
        self.catalog_path = self.root / 'public/l2/catalog.json'
        self.catalog = ('{\n  "unknown": "keep formatting",\n  "sections": [\n'
                        '    { "id": "unrelated", "manifestSha256": "' + self.base + '" },\n'
                        '    { "manifest": "/l2/maps/' + self.base + '/' + module.MANIFEST_FILE + '",\n'
                        '      "id": "' + module.SECTION + '", "unknown": [1, 2],\n'
                        '      "manifestSha256": "' + self.base + '" }\n  ]\n}\n').encode()
        self.catalog_path.write_bytes(self.catalog)

    @staticmethod
    def records(files):
        return {name: {'sha256': module.sha(data), 'bytes': len(data)} for name, data in files.items()}

    @staticmethod
    def write_files(root, files):
        for name, data in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

    def args(self, stage=False):
        return argparse.Namespace(bsp=self.bsp_root, bsp_sha256=self.bsp_sha, output=self.output, stage=stage)

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in self.root.rglob('*') if path.is_file()}

    def test_addition_preserves_every_existing_manifest_field_and_geometry_byte(self):
        original_files = copy.deepcopy(self.files)
        digest, derived = module.derive(self.files, self.bsp, self.bsp_sha)
        manifest = json.loads(derived[module.MANIFEST_FILE])
        entry = manifest.pop('bsp')[0]
        self.assertEqual(manifest, json.loads(self.files[module.MANIFEST_FILE]))
        self.assertEqual(entry['supportPlacementIds'], [module.SUPPORT_ID])
        self.assertEqual(entry['model'], {'file': 'bsp-floor.glb', **self.records(self.bsp)['bsp-floor.glb']})
        for key, value in module.SOURCE.items():
            self.assertEqual(entry[key], value)
        self.assertEqual(module.sha(derived[module.MANIFEST_FILE]), digest)
        self.assertEqual(self.files, original_files)
        self.assertEqual(len(derived), len(self.files) + 4)
        for name, data in self.files.items():
            if name not in (module.MANIFEST_FILE, module.RECEIPT_FILE):
                self.assertEqual(derived[name], data)
        for name, data in self.bsp.items():
            self.assertEqual(derived['map-section-bsp/' + name], data)

    def test_receipt_changes_only_identity_and_additive_provenance(self):
        digest, derived = module.derive(self.files, self.bsp, self.bsp_sha)
        receipt = json.loads(derived[module.RECEIPT_FILE])
        self.assertEqual(receipt['manifestSha256'], digest)
        receipt['manifestSha256'] = self.base
        provenance = receipt['derivation'].pop('bspFloor')
        self.assertEqual(receipt, json.loads(self.files[module.RECEIPT_FILE]))
        self.assertEqual(provenance['manifestSha256'], self.bsp_sha)
        self.assertEqual(provenance['sourceMapSha256'], module.SOURCE['sourceMapSha256'])

    def test_wrong_source_manifest_payload_and_file_set_are_refused(self):
        altered = []
        for key in ('id', 'sourceModel', 'sourceBrush', 'sourceMapSha256'):
            files = dict(self.bsp)
            manifest = json.loads(files['manifest.json'])
            manifest[key] = 'wrong'
            files['manifest.json'] = module.json_bytes(manifest)
            altered.append((files, module.sha(files['manifest.json'])))
        for filename in module.BSP_FILES:
            files = dict(self.bsp)
            files[filename] += b'changed'
            altered.append((files, self.bsp_sha))
        altered += [(self.bsp, '0' * 64), ({**self.bsp, '../escape': b'no'}, self.bsp_sha)]
        for files, pin in altered:
            with self.subTest(files=set(files), pin=pin):
                with self.assertRaises(ValueError):
                    module.derive(self.files, files, pin)

    def test_base_plan_and_payload_mutations_fail_before_output(self):
        terrain = self.base_root / 'map-section/terrain.glb'
        terrain.write_bytes(b'new authored work must be preserved')
        with self.assertRaisesRegex(ValueError, 'Input hash'):
            module.run(self.args())
        self.assertFalse(self.output.exists())
        self.assertEqual(terrain.read_bytes(), b'new authored work must be preserved')
        terrain.write_bytes(self.files['map-section/terrain.glb'])
        (self.base_root / 'unexpected').write_bytes(b'new')
        with self.assertRaisesRegex(ValueError, 'file set'):
            module.run(self.args())
        self.assertFalse(self.output.exists())

    def test_prepare_and_stage_reruns_write_nothing(self):
        result = module.run(self.args())
        self.assertEqual(result['status'], 'prepared')
        self.assertFalse(result['publicChanged'])
        self.assertEqual(self.catalog_path.read_bytes(), self.catalog)
        destination = self.root / 'public/l2/maps' / result['manifestSha256']
        self.assertFalse(destination.exists())
        first = self.snapshot()
        module.run(self.args())
        self.assertEqual(self.snapshot(), first)
        staged = module.run(self.args(stage=True))
        self.assertTrue(staged['publicChanged'])
        self.assertEqual(module.file_set(destination), set(self.files) | {'map-section-bsp/' + name for name in self.bsp})
        first_stage = self.snapshot()
        again = module.run(self.args(stage=True))
        self.assertFalse(again['publicChanged'])
        self.assertEqual(self.snapshot(), first_stage)
        for name, data in self.files.items():
            self.assertEqual((self.base_root / name).read_bytes(), data)

    def test_catalog_preserves_format_unknown_fields_and_unrelated_same_hash(self):
        after = module.catalog_replace(self.catalog, self.base, '1' * 64)
        expected = self.catalog.replace(self.base.encode(), b'1' * 64)
        # The unrelated first section intentionally retains the exact same hash.
        expected = expected.replace(b'"manifestSha256": "' + b'1' * 64 + b'"',
                                    b'"manifestSha256": "' + self.base.encode() + b'"', 1)
        self.assertEqual(after, expected)
        self.assertEqual(module.catalog_replace(after, '1' * 64, self.base), self.catalog)

    def test_scratch_receipt_conflict_prevents_all_bundle_and_public_writes(self):
        self.output.mkdir(parents=True)
        (self.output / 'bundle.json').write_bytes(b'other authors receipt')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Immutable output differs'):
            module.run(self.args(stage=True))
        self.assertEqual(self.snapshot(), before)

    def test_public_conflict_is_preflighted_before_scratch_writes(self):
        digest, _ = module.derive(self.files, self.bsp, self.bsp_sha)
        conflict = self.root / 'public/l2/maps' / digest / module.MANIFEST_FILE
        conflict.parent.mkdir(parents=True)
        conflict.write_bytes(b'conflicting content')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Immutable output differs'):
            module.run(self.args(stage=True))
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.output.exists())

    def test_stale_catalog_stops_before_writes(self):
        self.catalog_path.write_bytes(module.catalog_replace(self.catalog, self.base, '2' * 64))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'newer work'):
            module.run(self.args(stage=True))
        self.assertEqual(self.snapshot(), before)

    def test_concurrent_catalog_change_is_preserved(self):
        original_write = module.immutable_write
        changed = self.catalog.replace(b'keep formatting', b'concurrent authored update')
        def concurrent_write(path, data):
            original_write(path, data)
            if Path(path).name == 'bundle.json':
                self.catalog_path.write_bytes(changed)
        with mock.patch.object(module, 'immutable_write', side_effect=concurrent_write):
            with self.assertRaisesRegex(ValueError, 'changed concurrently'):
                module.run(self.args(stage=True))
        self.assertEqual(self.catalog_path.read_bytes(), changed)

    def test_path_escape_input_overlap_and_unsafe_components_refused(self):
        for relative in ('../outside', '/absolute', 'nested/../outside', 'bad\\name', 'C:/elsewhere',
                         'name:stream', 'CON', 'name.', 'name ', 'bad\x00name'):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                module.local(self.root, relative)
        for output in (self.root / 'public/forbidden', self.root / 'artifacts',
                       self.root / 'artifacts/../public/forbidden', self.bsp_root / 'derived'):
            args = self.args()
            args.output = output
            with self.subTest(output=output), self.assertRaises(ValueError):
                module.run(args)

    def test_symlink_input_is_refused_when_platform_allows_creation(self):
        linked = self.root / 'artifacts/linked-extraction'
        try:
            linked.symlink_to(self.bsp_root, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not permit creating test symlinks')
        args = self.args()
        args.bsp = linked
        with self.assertRaisesRegex(ValueError, 'Linked'):
            module.run(args)

    def test_duplicate_catalog_key_is_refused(self):
        duplicate = self.catalog.replace(b'"sections":', b'"sections": [], "sections":')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            module.catalog_replace(duplicate, self.base, '3' * 64)


if __name__ == '__main__':
    unittest.main()
