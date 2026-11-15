import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError, Reader
from test_world_raw_step import TILE_ID, SyntheticTileTestCase, two_actors_sharing_one_mesh
from world.map_actor_properties import HAS_STACK, ambient_sound_object
from world.raw_map_extraction import RAW_MAP_GAPS, RAW_MAP_MANIFEST_SCHEMA_VERSION, build_map
from world.raw_map_step import raw_map_recipe, read_tile_map_lock_record

PLAN_START_PRODUCT_SHA256 = {
    'actors.json': 'cf3cf28eccb86894452fb279073f7a858a1fd7aa085a28f06ff5457ebb2884f7',
    'ambient-sounds.json': '0f6b6d3167f86f997b4498770020ac20dffa18bfc1e837050b2968771f85165f',
    'exports.json': '091e05ec8d7ebbf5b25d74ece8d0b5e98a399da152514eb1b25c343682af71df',
    'raw/map.unwrapped.bin': '6decd6f72fdb608b09deaaeeb15d5fdcecc03371e18dc955faec6e126be5b42a',
    'section-bindings.json': 'e95b0dfb4fa8011b5c74c07b33d6d7a9d0f2df1cf895fed855db42408c3a16aa',
    'static-mesh-requests.json': '1a3cae5d1a3b7b5728b11080c0d66fbd9aed5e893b1112e44d5e865a88fbe130',
    'terrain.json': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
}
WHOLE_TILE_MANIFEST_SHA256 = '14c169ec9cc48cb3053b58e121ffbf8205ca5ea8e4e7d6447d108bc5e8f4b40d'
STAGED_CLIENT_ROOT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
JAVA_ORACLE_FOLDER = ROOT / 'artifacts/native-parity/research/map-java-oracle/result/20_20'
JAVA_FOUR_DECIMAL_ROUNDING_DELTA = 0.000051


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


class AmbientObjectPackage:
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


class WholeTileRawMapExtractionTests(SyntheticTileTestCase):
    def test_the_whole_tile_products_equal_the_plan_start_products_and_drop_only_the_section_gap(self):
        self.write_client(two_actors_sharing_one_mesh())
        files = {}
        manifest, _ = build_map(self.client, raw_map_recipe(TILE_ID, {'eSha256': self.map_sha256}), files.__setitem__)
        self.assertEqual({name: sha256_hex(payload) for name, payload in files.items() if name != 'manifest.json'}, PLAN_START_PRODUCT_SHA256)
        self.assertEqual(sha256_hex(files['manifest.json']), WHOLE_TILE_MANIFEST_SHA256)
        self.assertEqual((manifest['schemaVersion'], manifest['gaps']), (RAW_MAP_MANIFEST_SCHEMA_VERSION, RAW_MAP_GAPS))
        self.assertFalse(any('Section selection' in gap for gap in manifest['gaps']))
        actors = json.loads(files['actors.json'])
        self.assertTrue(actors and all('sectionOriginSelected' not in actor for actor in actors))
        self.assertEqual((manifest['coverage']['staticMeshActorsWithMesh'], manifest['coverage']['uniqueStaticMeshes']), (2, 1))

    def test_non_actor_ambient_objects_are_exported_without_inventing_actor_state(self):
        package = AmbientObjectPackage(b'\0\xaa\xbb\x01')
        package.source_hash, package.package_name = 'a' * 64, 'example'
        package.names, package.imports = [], []
        entry = {'offset': 0, 'size': 3, 'flags': 0x70001, 'object': 'example.AmbientSoundObject0',
                 'className': 'AmbientSoundObject', 'classObject': 'Engine.AmbientSoundObject', 'exportIndex': 1}
        package.exports = [entry, {**entry, 'offset': 3, 'size': 1, 'exportIndex': 2,
                                  'object': 'example.AmbientSoundObject1'}]
        files = {}
        recipe = {'schemaVersion': 1, 'kind': 'native-map-raw', 'map': 'maps/example.unr'}
        with patch('world.raw_map_extraction.MapSources', return_value=SimpleNamespace(get=lambda name: package, dependencies={})):
            manifest, _ = build_map(Path('unused'), recipe, lambda name, data: files.__setitem__(name, data))
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


@unittest.skipUnless((STAGED_CLIENT_ROOT / 'maps/20_20.unr').is_file(), 'the staged IMPORTA-PC 20_20 map is not present in this checkout')
class StagedTwentyTwentyRawMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = {}
        recipe = raw_map_recipe('20_20', read_tile_map_lock_record('20_20'))
        cls.manifest, _ = build_map(STAGED_CLIENT_ROOT, recipe, cls.files.__setitem__)

    def read_json_product(self, name):
        return json.loads(self.files[name])

    def test_native_coverage_and_exact_terrain_samples(self):
        coverage = self.manifest['coverage']
        self.assertEqual(coverage['actorsDecoded'], coverage['stackActors'])
        self.assertEqual(coverage['staticMeshActorsDecoded'], 4183)
        self.assertEqual(coverage['terrainHeightsDecoded'], 1)
        self.assertEqual(coverage['exportsPreservedRaw'], 13248)
        self.assertEqual(self.manifest['unsupported'], [])
        terrain = self.read_json_product('terrain.json')[0]
        self.assertEqual(len(terrain['layers']), 11)
        self.assertEqual(len(terrain['decoLayers']), 4)
        self.assertEqual([item['wordCount'] for item in terrain['bitmaps']], [2048] * 4)
        mip = terrain['height']['mips'][0]
        self.assertEqual(mip['sha256'], '85fff0a8c5b9fa717270180110f9a4a8711bf0818c0b153839d380c14c2abab9')
        self.assertEqual(mip['sourceBytes'], 256 * 256 * 2)
        if (JAVA_ORACLE_FOLDER / '20_20_heightmap.raw').is_file():
            self.assertEqual(self.files[mip['rawPath']], (JAVA_ORACLE_FOLDER / '20_20_heightmap.raw').read_bytes())

    def test_all_native_ambient_levelobjects_keep_exact_payloads_and_sound_references(self):
        data = self.read_json_product('ambient-sounds.json')
        raw = self.files['raw/map.unwrapped.bin']
        self.assertEqual(data['sourcePackageSha256'], '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4')
        self.assertEqual(len(data['objects']), 2622)
        self.assertEqual(self.manifest['coverage']['ambientSoundObjectsDecoded'], 2622)
        self.assertEqual(self.manifest['coverage']['ambientSoundObjectsWithTail'], 0)
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
            self.assertNotIn('Random', obj)
            self.assertEqual(obj['nativePlayback'], 'unverified')
        self.assertEqual(missing, 2)
        self.assertEqual(len(references), 106)

    @unittest.skipUnless((JAVA_ORACLE_FOLDER / 'staticmeshes.json').is_file(), 'the independent pinned Java oracle output is local only')
    def test_all_static_placements_match_independent_java_extraction(self):
        actors = self.read_json_product('actors.json')
        index = {actor['object'].rsplit('.', 1)[-1]: actor for actor in actors if actor['class'] == 'StaticMeshActor'}
        java = json.loads((JAVA_ORACLE_FOLDER / 'staticmeshes.json').read_text())
        self.assertEqual(len(index), java['count'])
        for row in java['staticMeshes']:
            actor = index[row['name']]
            self.assertEqual(actor['staticMesh']['object'], row['meshPath'])
            for axis in 'xyz':
                self.assertAlmostEqual(actor['sourceTransform']['Location']['value'][axis.upper()], row['location'][axis],
                                       delta=JAVA_FOUR_DECIMAL_ROUNDING_DELTA)


if __name__ == '__main__':
    unittest.main()
