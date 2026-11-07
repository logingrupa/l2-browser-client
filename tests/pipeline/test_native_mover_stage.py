"""Actual bundle staging, idempotence and concurrent catalog preservation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('mover_stage', ROOT / 'scripts/stage-native-movers.py')
stager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stager)
from native_map import sha

BUNDLE = ROOT / 'artifacts/native-parity/research/native-door-movers-20261107/converted'


@unittest.skipUnless((BUNDLE / 'bundle.json').is_file(), 'Actual retained-source mover bundle is not available')
class MoverStageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        section_bytes = b'{"terrain":{"sha256":"' + b'c' * 64 + b'"}}'
        identity = sha(section_bytes)
        self.catalog = {'schemaVersion': 1, 'animationAudio': [{'id': 'preserved-audio', 'manifestSha256': 'a' * 64}],
                        'textures': [{'id': 'preserved-texture'}], 'models': [{'id': 'preserved-character'}],
                        'sections': [{'id': 'map-20-20-section', 'manifestSha256': identity,
                                      'manifest': '/l2/maps/' + identity + '/map-section-runtime/manifest.json'}]}
        path = self.project / 'public/l2/maps' / identity / 'map-section-runtime/manifest.json'
        path.parent.mkdir(parents=True)
        path.write_bytes(section_bytes)
        self.catalog_path = self.project / 'public/l2/catalog.json'
        self.before = (json.dumps(self.catalog, indent=2) + '\n').encode()
        self.catalog_path.write_bytes(self.before)
        self.retained = self.project / 'assets/native-world.scene/retained.bin'
        self.retained.parent.mkdir(parents=True)
        self.retained.write_bytes(b'original authored geometry and channels')

    def test_stages_original_bundle_and_repeats_without_catalog_or_asset_changes(self):
        result = stager.stage(self.project, BUNDLE)
        after_bytes = self.catalog_path.read_bytes()
        after = json.loads(after_bytes)
        for key in self.catalog:
            self.assertEqual(after[key], self.catalog[key])
        self.assertEqual(result['status'], 'staged')
        self.assertEqual(len(after['movers']), 1)
        for name, record in result['files'].items():
            payload = (self.project / 'public/l2/movers' / result['record']['manifestSha256'] / name).read_bytes()
            self.assertEqual(sha(payload), record['sha256'])
            self.assertEqual(len(payload), record['bytes'])
        repeat = stager.stage(self.project, BUNDLE)
        self.assertEqual(repeat['status'], 'preserved')
        self.assertEqual(self.catalog_path.read_bytes(), after_bytes)
        self.assertEqual(self.retained.read_bytes(), b'original authored geometry and channels')

    def test_refuses_to_replace_a_different_catalog_owner(self):
        catalog = {**self.catalog, 'movers': [{'id': 'map-20-20-movers', 'manifestSha256': 'd' * 64}]}
        before = json.dumps(catalog).encode()
        self.catalog_path.write_bytes(before)
        with self.assertRaisesRegex(ValueError, 'different existing'):
            stager.stage(self.project, BUNDLE)
        self.assertEqual(self.catalog_path.read_bytes(), before)
        self.assertFalse((self.project / 'public/l2/movers').exists())

    def test_preserves_a_catalog_changed_during_additive_resource_copy(self):
        original = stager.immutable_write
        concurrent = json.dumps({**self.catalog, 'concurrentAddition': 'retain this'}).encode()
        changed = False

        def write(path, payload):
            nonlocal changed
            original(path, payload)
            if not changed:
                changed = True
                self.catalog_path.write_bytes(concurrent)

        with patch.object(stager, 'immutable_write', write):
            with self.assertRaisesRegex(ValueError, 'changed concurrently'):
                stager.stage(self.project, BUNDLE)
        self.assertEqual(self.catalog_path.read_bytes(), concurrent)
        self.assertEqual(self.retained.read_bytes(), b'original authored geometry and channels')


if __name__ == '__main__':
    unittest.main()
