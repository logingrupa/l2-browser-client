import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError, Reader
from native_map import (HAS_STACK, ambient_sound_object, build_map, explicit_properties, migrate_map, safe_path, selected_by_origin,
                        validate_recipe, verify_map)
from reference_client_lock_fixture import lock_client_as_reference_root


class DummyPackage:
    summary = {'version': 123, 'licenseeVersion': 28}

    def __init__(self, data):
        self.data = data

    def object_name(self, index):
        return 'fixture.object' if index else None

    def properties(self, item):
        reader = Reader(self.data, item['offset'], item['offset'] + item['size'])
        if reader.number('B'):
            raise FormatError('Fixture missing property terminator')
        return [], reader


def recipe():
    return {'schemaVersion': 1, 'kind': 'native-map-raw', 'map': 'maps/example.unr',
            'section': {'selection': 'serialized-origin-xy-inclusive', 'min': [0, 10], 'max': [2, 12]}}


class MapReaderTests(unittest.TestCase):
    def test_non_actor_ambient_objects_are_exported_without_inventing_actor_state(self):
        package = DummyPackage(b'\0\xaa\xbb\x01')
        package.source_hash, package.package_name = 'a' * 64, 'example'
        package.names, package.imports = [], []
        entry = {'offset': 0, 'size': 3, 'flags': 0x70001, 'object': 'example.AmbientSoundObject0',
                 'className': 'AmbientSoundObject', 'classObject': 'Engine.AmbientSoundObject', 'exportIndex': 1}
        package.exports = [entry, {**entry, 'offset': 3, 'size': 1, 'exportIndex': 2,
                                  'object': 'example.AmbientSoundObject1'}]
        files = {}
        with patch('native_map.MapSources', return_value=SimpleNamespace(get=lambda name: package, dependencies={})):
            manifest, _ = build_map(Path('unused'), recipe(), lambda name, data: files.__setitem__(name, data))
        sounds = json.loads(files['ambient-sounds.json'])['objects']
        self.assertEqual(len(sounds), 1)
        self.assertEqual(json.loads(files['actors.json']), [])
        self.assertEqual(len(json.loads(files['exports.json'])['exports']), 2)
        self.assertEqual(manifest['coverage']['ambientSoundObjectsDecoded'], 1)
        self.assertEqual(manifest['coverage']['ambientSoundObjectsWithTail'], 1)
        self.assertEqual(manifest['unsupported'][0]['stage'], 'ambient-object-tags')
        self.assertEqual(manifest['support'], 'partial-raw-data-extracted')
        sound = sounds[0]
        self.assertEqual(sound['nativeTail']['sha256'], hashlib.sha256(b'\xaa\xbb').hexdigest())
        self.assertEqual(sound['properties'], [])
        self.assertTrue(sound['authoredPropertiesOnly'])
        self.assertNotIn('sourceTransform', sound)
        self.assertNotIn('sectionOriginSelected', sound)
        self.assertEqual(sound['classDefaults'], 'not-resolved-by-raw-map-export')
        for invalid in ({**entry, 'flags': HAS_STACK}, {**entry, 'classObject': 'Other.AmbientSoundObject'}):
            with self.assertRaisesRegex(FormatError, 'ambient LevelObject'):
                ambient_sound_object(package, invalid, 'raw.bin')

    def test_section_boundary_and_omitted_defaults_are_explicit(self):
        section = recipe()['section']
        prop = {'name': 'Location', 'arrayIndex': None, 'value': {'X': 0, 'Y': 12, 'Z': -9000}}
        self.assertTrue(selected_by_origin([prop], section))
        prop['value']['X'] = -0.001
        self.assertFalse(selected_by_origin([prop], section))
        self.assertIsNone(selected_by_origin([], section))
        self.assertEqual(explicit_properties([], ['DrawScale'])['DrawScale'], {'status': 'omitted-class-default-unresolved'})
        bad = recipe()
        bad['section']['max'] = [float('nan'), 2]
        with self.assertRaises(ValueError):
            validate_recipe(bad)


class MapCacheTests(unittest.TestCase):
    def build(self, client, request, write):
        payload = (client / 'maps/example.unr').read_bytes()
        manifest = {'recipe': request, 'support': 'fixture', 'coverage': {}, 'gaps': [], 'unsupported': []}
        write('manifest.json', json.dumps(manifest).encode())
        write('raw/map.bin', payload)
        return manifest, {'maps/example.unr': {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}}

    def test_reproducible_build_cache_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client, first, second = root / 'inputs', root / 'first', root / 'second'
            (client / 'maps').mkdir(parents=True)
            lock_client_as_reference_root(self, client)
            source = client / 'maps/example.unr'
            source.write_bytes(b'native unchanged source')
            with patch('native_map.build_map', side_effect=self.build) as build:
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])
                before = (first / 'manifest.json').stat().st_mtime_ns
                self.assertTrue(migrate_map(client, recipe(), first)['cacheHit'])
                self.assertEqual(build.call_count, 1)
                self.assertEqual((first / 'manifest.json').stat().st_mtime_ns, before)
                migrate_map(client, recipe(), second)
                self.assertEqual((first / 'receipt.json').read_bytes(), (second / 'receipt.json').read_bytes())
                (first / 'raw/map.bin').write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError, 'hash/length'):
                    verify_map(client, first)
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])
                self.assertEqual((first / 'raw/map.bin').read_bytes(), source.read_bytes())
                source.write_bytes(b'updated source')
                with self.assertRaisesRegex(ValueError, 'hash/length'):
                    verify_map(client, first)
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])

    def test_rejects_source_overwrite_unowned_files_and_unsafe_receipt_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client = root / 'inputs'
            (client / 'maps').mkdir(parents=True)
            lock_client_as_reference_root(self, client)
            (client / 'maps/example.unr').write_bytes(b'source')
            with self.assertRaises(ValueError):
                migrate_map(client, recipe(), client / 'output')
            for path in ('../outside', '/outside', 'C:/outside', 'a\\b', 'a. /file'):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    safe_path(root, path)
            output = root / 'out'
            with patch('native_map.build_map', side_effect=self.build):
                migrate_map(client, recipe(), output)
                (output / 'authored-edit.json').write_text('{}')
                with self.assertRaisesRegex(ValueError, 'unowned files'):
                    migrate_map(client, recipe(), output)
                self.assertEqual((output / 'authored-edit.json').read_text(), '{}')


STAGED = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
ORACLE = ROOT / 'artifacts/native-parity/research/map-java-oracle/result/20_20'


@unittest.skipUnless((STAGED / 'maps/20_20.unr').is_file(), 'local native sources are intentionally not tracked')
class LocalMapSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name) / 'map'
        cls.result = migrate_map(STAGED, json.loads((ROOT / 'recipes/native-map-20_20.json').read_text()), cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_coverage_and_exact_terrain_samples(self):
        coverage = self.result['coverage']
        self.assertEqual(coverage['actorsDecoded'], coverage['stackActors'])
        self.assertEqual(coverage['staticMeshActorsDecoded'], 4183)
        self.assertEqual(coverage['terrainHeightsDecoded'], 1)
        self.assertEqual(coverage['exportsPreservedRaw'], 13248)
        self.assertEqual(self.result['unsupported'], [])
        terrain = json.loads((self.output / 'terrain.json').read_text())[0]
        self.assertEqual(len(terrain['layers']), 11)
        self.assertEqual(len(terrain['decoLayers']), 4)
        self.assertEqual([item['wordCount'] for item in terrain['bitmaps']], [2048] * 4)
        mip = terrain['height']['mips'][0]
        self.assertEqual(mip['sha256'], '85fff0a8c5b9fa717270180110f9a4a8711bf0818c0b153839d380c14c2abab9')
        self.assertEqual(mip['sourceBytes'], 256 * 256 * 2)
        if (ORACLE / '20_20_heightmap.raw').is_file():
            self.assertEqual((self.output / mip['rawPath']).read_bytes(), (ORACLE / '20_20_heightmap.raw').read_bytes())

    def test_all_native_ambient_levelobjects_keep_exact_payloads_and_sound_references(self):
        data = json.loads((self.output / 'ambient-sounds.json').read_text())
        raw = (self.output / 'raw/map.unwrapped.bin').read_bytes()
        self.assertEqual(data['sourcePackageSha256'], '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4')
        self.assertEqual(len(data['objects']), 2622)
        self.assertEqual(self.result['coverage']['ambientSoundObjectsDecoded'], 2622)
        self.assertEqual(self.result['coverage']['ambientSoundObjectsWithTail'], 0)
        references, missing = set(), 0
        for obj in data['objects']:
            self.assertEqual(obj['classObject'], 'Engine.AmbientSoundObject')
            self.assertFalse(obj['objectFlags'] & HAS_STACK)
            payload = obj['nativePayload']
            self.assertEqual(hashlib.sha256(raw[payload['offset']:payload['offset'] + payload['bytes']]).hexdigest(), payload['sha256'])
            sound = next((prop for prop in obj['properties'] if prop['name'] == 'AmbientSound'), None)
            if sound is None:
                missing += 1
            else:
                references.add(sound['value']['object'])
            missing_default_is_not_synthesized = 'Random' not in obj
            self.assertTrue(missing_default_is_not_synthesized)
            self.assertEqual(obj['nativePlayback'], 'unverified')
        self.assertEqual(missing, 2)
        self.assertEqual(len(references), 106)

    @unittest.skipUnless((ORACLE / 'staticmeshes.json').is_file(), 'independent pinned Java oracle output is local')
    def test_all_static_placements_match_independent_java_extraction(self):
        actors = json.loads((self.output / 'actors.json').read_text())
        index = {a['object'].rsplit('.', 1)[-1]: a for a in actors if a['class'] == 'StaticMeshActor'}
        java = json.loads((ORACLE / 'staticmeshes.json').read_text())
        self.assertEqual(len(index), java['count'])
        for row in java['staticMeshes']:
            actor = index[row['name']]
            self.assertEqual(actor['staticMesh']['object'], row['meshPath'])
            java_four_decimal_rounding_delta = 0.000051
            for axis in 'xyz':
                self.assertAlmostEqual(actor['sourceTransform']['Location']['value'][axis.upper()], row['location'][axis], delta=java_four_decimal_rounding_delta)


if __name__ == '__main__':
    unittest.main()
