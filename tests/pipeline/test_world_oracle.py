import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world import freeze_world_oracle as world_oracle
from world.committed_world_data import CommittedWorldDataError, require_committed_destination
from world.freeze_world_oracle import (WORLD_ORACLE_RELATIVE_PATH, WorldOracleError, freeze_world_oracle, matrix_canonical_sha256,
                                       validate_world_oracle, world_oracle_bytes)

SHARED_STORE_ROOT = ROOT / 'public' / 'l2'
COMMITTED_ORACLE_PATH = ROOT / WORLD_ORACLE_RELATIVE_PATH
IDENTITY_MATRIX = [1.0, 0.0, 0.0, 0, 0.0, 1.0, 0.0, 0, 0.0, 0.0, 1.0, 0, 1.5, -2.25, 3.0, 1]
SYNTHETIC_SKY_SOURCE_ID = 'interlude:99_99.Model1.SkyZoneInfo0'


def json_payload(document):
    return json.dumps(document, indent=1).encode('utf-8')


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def fake_hash(label):
    return sha256_hex(label.encode('utf-8'))


def resource(file_name, label, size=10):
    return {'file': file_name, 'sha256': fake_hash(label), 'bytes': size}


class SyntheticOracleStore:
    def __init__(self, test_case):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.folder = Path(temporary_directory.name)
        self.root = self.folder / 'l2'
        self.bsp_payload = json_payload({'indices': list(range(9)), 'positions': []})
        bsp_records = [self.bsp_record('synthetic:Brush2.walls', 'bsp-command-walls'), self.bsp_record('synthetic:Brush1', 'bsp-floor')]
        self.section_manifest = {
            'models': [{'id': 'interlude:pkg.Zeta', 'sourceObject': 'pkg.Zeta', 'archive': resource('a/asset.l2asset', 'zeta-archive')},
                       {'id': 'interlude:pkg.Alpha', 'sourceObject': 'pkg.Alpha', 'archive': resource('b/asset.l2asset', 'alpha-archive')}],
            'placements': [{'id': 'interlude:99_99.StaticMeshActor9', 'modelId': 'interlude:pkg.Zeta', 'sourceMesh': 'pkg.Zeta', 'matrix': IDENTITY_MATRIX},
                           {'id': 'interlude:99_99.StaticMeshActor1', 'modelId': 'interlude:pkg.Alpha', 'sourceMesh': 'pkg.Alpha',
                            'matrix': IDENTITY_MATRIX}],
            'terrain': resource('terrain.glb', 'terrain'),
            'terrainPatches': [{'id': 'interlude:99_99.TerrainInfo0.TerrainSector1', 'model': resource('terrain1.glb', 'patch-model'),
                                'source': resource('terrain1.json', 'patch-source')}],
            'bsp': bsp_records,
            'unsupportedRuntimeMaterials': [{'modelId': 'interlude:pkg.Zeta'}],
        }
        self.write_section(json_payload(self.section_manifest))
        sky_manifest = {'id': SYNTHETIC_SKY_SOURCE_ID, 'files': {'sky.json': {'sha256': fake_hash('sky-json'), 'bytes': 4},
                                                                 'sky.glb': {'sha256': fake_hash('sky-glb'), 'bytes': 8}}}
        self.sky_payload = json_payload(sky_manifest)
        self.write(f'skies/{sha256_hex(self.sky_payload)}/manifest.json', self.sky_payload)
        conversion_payload = json_payload({'kind': 'synthetic-environment-conversion'})
        self.conversion_sha256 = sha256_hex(conversion_payload)
        environment_folder = f'environments/{self.conversion_sha256}'
        self.write(f'{environment_folder}/conversion-manifest.json', conversion_payload)
        self.write(f'{environment_folder}/manifest.json', json_payload({
            'conversionManifest': {'file': 'conversion-manifest.json', 'sha256': self.conversion_sha256, 'bytes': len(conversion_payload)},
            'tables': resource('sky-tables.json', 'tables')}))
        movers_payload = json_payload({'movers': [{'id': 'interlude:99_99.Mover2'}, {'id': 'interlude:99_99.Mover1'}],
                                       'models': [{'id': 'interlude:pkg.Door'}]})
        self.movers_sha256 = sha256_hex(movers_payload)
        self.write(f'movers/{self.movers_sha256}/movers.json', movers_payload)
        self.pinned_manifest_records = {}
        self.write_pinned_manifest('worldAudio', 'map-20-20-music', 'native-map-music', 'world-audio',
                                   {'tracks': [{'file': 'music/a.ogg', 'sha256': fake_hash('a'), 'bytes': 100}]})
        self.write_pinned_manifest('worldAudio', 'map-20-20-ambience', 'native-map-ambience', 'world-audio',
                                   {'emitters': [{'sound': {'file': 'sounds/wind.wav', 'sha256': fake_hash('wind'), 'bytes': 40}},
                                                 {'sound': {'file': 'sounds/wind.wav', 'sha256': fake_hash('wind'), 'bytes': 40}},
                                                 {'sound': {'file': 'sounds/bird.wav', 'sha256': fake_hash('bird'), 'bytes': 25}}]})
        self.write_pinned_manifest('animationAudio', 'stepsound-surfaces', 'native-stepsound-package', 'step-sounds',
                                   {'surfaces': [{'file': 'grass.wav', 'sha256': fake_hash('grass'), 'bytes': 7}]})
        self.write_pinned_manifest('animationAudio', 'stepsound-deco-grass-20-20', 'native-stepsound-deco-grass', 'step-sounds',
                                   {'layers': [{'file': 'deco.bin', 'sha256': fake_hash('deco'), 'bytes': 9}]})
        self.write_catalog()
        self.write_pins(test_case)

    def write_pinned_manifest(self, slice_name, record_id, kind, folder, manifest, manifest_bytes=None):
        payload = json_payload(manifest)
        manifest_sha256 = sha256_hex(payload)
        self.write(f'{folder}/{manifest_sha256}/manifest.json', payload)
        self.pinned_manifest_records[record_id] = (slice_name, {
            'id': record_id, 'kind': kind, 'manifest': f'/l2/{folder}/{manifest_sha256}/manifest.json',
            'manifestBytes': len(payload) if manifest_bytes is None else manifest_bytes, 'manifestSha256': manifest_sha256})

    def replace_pinned_manifest(self, record_id, manifest, manifest_bytes=None):
        slice_name, record = self.pinned_manifest_records[record_id]
        folder = record['manifest'].split('/')[2]
        self.write_pinned_manifest(slice_name, record_id, record['kind'], folder, manifest, manifest_bytes)
        self.write_catalog()

    def bsp_record(self, record_id, stem):
        return {'id': record_id, 'sourceModel': '99_99.Model1', 'sourceBrush': record_id.split(':', 1)[1].split('.')[0],
                'sourceMapSha256': fake_hash('map'), 'model': resource(f'{stem}.glb', f'{stem}-model'),
                'source': {'file': f'{stem}.json', 'sha256': sha256_hex(self.bsp_payload), 'bytes': len(self.bsp_payload)},
                'supportPlacementIds': ['interlude:99_99.StaticMeshActor1']}

    def write(self, relative_path, payload):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def write_section(self, manifest_payload, catalog_sha256=None):
        self.section_sha256 = catalog_sha256 or sha256_hex(manifest_payload)
        section_folder = f'maps/{self.section_sha256}'
        self.write(f'{section_folder}/map-section-runtime/manifest.json', manifest_payload)
        for stem in ('bsp-floor', 'bsp-command-walls'):
            self.write(f'{section_folder}/map-section-bsp/{stem}.json', self.bsp_payload)

    def write_catalog(self):
        catalog = {
            'sections': [{'id': 'map-20-20-section', 'manifestSha256': self.section_sha256,
                          'manifest': f'/l2/maps/{self.section_sha256}/map-section-runtime/manifest.json'}],
            'movers': [{'id': 'map-20-20-movers', 'manifestSha256': self.movers_sha256, 'manifest': f'/l2/movers/{self.movers_sha256}/movers.json',
                        'sourceMapSha256': fake_hash('map'), 'terrainSha256': fake_hash('terrain')}],
            'worldAudio': [], 'animationAudio': []}
        for slice_name, record in self.pinned_manifest_records.values():
            catalog[slice_name].append(record)
        self.write('catalog.json', json_payload(catalog))

    def write_pins(self, test_case):
        sky_pins = self.folder / 'nativeSkyPresentation.ts'
        sky_pins.write_text(f'export const nativeSkySource = {{\n  manifestSha256: "{sha256_hex(self.sky_payload)}",\n'
                            f'  sourceId: "{SYNTHETIC_SKY_SOURCE_ID}",\n}} as const;\n', encoding='utf-8')
        environment_pins = self.folder / 'nativeEnvironmentTables.ts'
        environment_pins.write_text(f'export const nativeEnvironmentSource = {{\n  conversionManifestSha256: "{self.conversion_sha256}",\n}};\n',
                                    encoding='utf-8')
        for patcher in (patch.object(world_oracle, 'SKY_PIN_SOURCE_PATH', sky_pins), patch.object(world_oracle, 'ENVIRONMENT_PIN_SOURCE_PATH', environment_pins)):
            patcher.start()
            test_case.addCleanup(patcher.stop)


class SyntheticWorldOracleTests(unittest.TestCase):
    def setUp(self):
        self.store = SyntheticOracleStore(self)

    def test_the_freeze_gives_counts_ids_and_hashes_sorted_by_id(self):
        oracle = freeze_world_oracle(self.store.root)
        section = oracle['section']
        self.assertEqual(oracle['catalogSha256'], sha256_hex((self.store.root / 'catalog.json').read_bytes()))
        self.assertEqual((section['id'], section['manifestSha256'], section['modelCount'], section['placementCount']),
                         ('map-20-20-section', self.store.section_sha256, 2, 2))
        self.assertEqual([model['id'] for model in section['models']], ['interlude:pkg.Alpha', 'interlude:pkg.Zeta'])
        self.assertEqual(section['models'][0]['archiveSha256'], fake_hash('alpha-archive'))
        self.assertEqual([placement['id'] for placement in section['placements']],
                         ['interlude:99_99.StaticMeshActor1', 'interlude:99_99.StaticMeshActor9'])
        self.assertEqual(section['placements'][0]['matrixCanonicalSha256'], matrix_canonical_sha256(IDENTITY_MATRIX))
        self.assertEqual([(bsp['id'], bsp['triangleCount']) for bsp in section['bsp']], [('synthetic:Brush1', 3), ('synthetic:Brush2.walls', 3)])
        self.assertEqual(section['terrain'], resource('terrain.glb', 'terrain'))
        self.assertEqual(section['terrainPatches'], [{'id': 'interlude:99_99.TerrainInfo0.TerrainSector1', 'modelSha256': fake_hash('patch-model'),
                                                      'sourceSha256': fake_hash('patch-source')}])
        self.assertEqual(section['unsupportedRuntimeMaterialIds'], ['interlude:pkg.Zeta'])
        self.assertEqual((oracle['sky']['sourceId'], [file['path'] for file in oracle['sky']['files']]), (SYNTHETIC_SKY_SOURCE_ID, ['sky.glb', 'sky.json']))
        self.assertEqual([file['path'] for file in oracle['environment']['files']], ['conversion-manifest.json', 'manifest.json', 'sky-tables.json'])
        self.assertEqual(oracle['environment']['manifestSha256'], self.store.conversion_sha256)
        self.assertEqual((oracle['movers']['moverIds'], oracle['movers']['modelIds']),
                         (['interlude:99_99.Mover1', 'interlude:99_99.Mover2'], ['interlude:pkg.Door']))

    def test_the_freeze_counts_world_audio_and_step_sound_pins_sorted_by_record_id(self):
        oracle = freeze_world_oracle(self.store.root)
        self.assertEqual([(record['recordId'], record['kind'], record['pinnedFileCount'], record['pinnedFileBytes']) for record in oracle['worldAudio']],
                         [('map-20-20-ambience', 'native-map-ambience', 2, 65), ('map-20-20-music', 'native-map-music', 1, 100)])
        self.assertEqual([(record['recordId'], record['pinnedFileCount'], record['pinnedFileBytes']) for record in oracle['stepSounds']],
                         [('stepsound-deco-grass-20-20', 1, 9), ('stepsound-surfaces', 1, 7)])
        _, music_record = self.store.pinned_manifest_records['map-20-20-music']
        self.assertEqual((oracle['worldAudio'][1]['manifestSha256'], oracle['worldAudio'][1]['manifestBytes']),
                         (music_record['manifestSha256'], music_record['manifestBytes']))

    def test_a_pinned_manifest_whose_bytes_differ_from_the_catalog_pin_is_refused(self):
        _, record = self.store.pinned_manifest_records['map-20-20-music']
        self.store.write(record['manifest'][len('/l2/'):], json_payload({'tracks': []}))
        with self.assertRaisesRegex(WorldOracleError, 'not the pinned'):
            freeze_world_oracle(self.store.root)

    def test_a_pinned_manifest_whose_length_differs_from_the_catalog_is_refused(self):
        self.store.replace_pinned_manifest('stepsound-surfaces', {'surfaces': []}, manifest_bytes=1)
        with self.assertRaisesRegex(WorldOracleError, 'not the pinned 1'):
            freeze_world_oracle(self.store.root)

    def test_pins_named_twice_with_two_hashes_without_a_length_or_outside_the_bundle_are_refused(self):
        for manifest, message in (
                ({'sounds': [{'file': 'a.wav', 'sha256': fake_hash('one'), 'bytes': 1}, {'file': 'a.wav', 'sha256': fake_hash('two'), 'bytes': 1}]},
                 'twice with different'),
                ({'sounds': [{'file': 'a.wav', 'sha256': fake_hash('one')}]}, 'without a byte length'),
                ({'sounds': [{'resource': '/l2/elsewhere/a.wav', 'sha256': fake_hash('one')}]}, 'outside its bundle folder')):
            with self.subTest(message=message):
                self.store.replace_pinned_manifest('map-20-20-ambience', manifest)
                with self.assertRaisesRegex(WorldOracleError, message):
                    freeze_world_oracle(self.store.root)

    def test_an_oracle_missing_the_audio_fields_or_holding_an_extra_record_field_is_refused(self):
        oracle = freeze_world_oracle(self.store.root)
        for field_name in ('worldAudio', 'stepSounds'):
            with self.subTest(missing=field_name):
                tampered = copy.deepcopy(oracle)
                del tampered[field_name]
                with self.assertRaisesRegex(WorldOracleError, 'exactly'):
                    validate_world_oracle(tampered)
            with self.subTest(extra_record_field=field_name):
                tampered = copy.deepcopy(oracle)
                tampered[field_name][0]['pinnedPaths'] = []
                with self.assertRaisesRegex(WorldOracleError, 'records must hold exactly'):
                    validate_world_oracle(tampered)

    def test_a_section_manifest_that_does_not_hash_to_the_catalog_pin_is_refused(self):
        self.store.write_section(json_payload({**self.store.section_manifest, 'placements': []}), catalog_sha256=self.store.section_sha256)
        with self.assertRaisesRegex(WorldOracleError, 'not the pinned'):
            freeze_world_oracle(self.store.root)

    def test_a_store_file_over_the_size_bound_is_refused(self):
        with patch.object(world_oracle, 'MAXIMUM_JUNCTION_JSON_BYTES', 16):
            with self.assertRaisesRegex(WorldOracleError, 'exceeds 16 bytes'):
                freeze_world_oracle(self.store.root)

    def test_two_freezes_are_byte_identical(self):
        self.assertEqual(world_oracle_bytes(freeze_world_oracle(self.store.root)), world_oracle_bytes(freeze_world_oracle(self.store.root)))

    def test_a_long_encoded_run_outside_a_hash_field_is_refused(self):
        oracle = freeze_world_oracle(self.store.root)
        for field_path, value in ((('section', 'terrain', 'file'), 'A' * 65), (('sky', 'sourceId'), 'ab' * 40)):
            with self.subTest(field_path=field_path):
                tampered = copy.deepcopy(oracle)
                container = tampered
                for key in field_path[:-1]:
                    container = container[key]
                container[field_path[-1]] = value
                with self.assertRaisesRegex(WorldOracleError, 'encoded run longer than 64'):
                    validate_world_oracle(tampered)


class CommittedDestinationTests(unittest.TestCase):
    def test_a_destination_inside_the_shared_store_is_refused(self):
        with tempfile.TemporaryDirectory() as repository_root:
            (Path(repository_root) / 'public' / 'l2').mkdir(parents=True)
            with self.assertRaisesRegex(CommittedWorldDataError, 'shared native store'):
                require_committed_destination('public/l2/expected.json', repository_root)

    def test_a_destination_behind_a_reparse_point_is_refused(self):
        if not SHARED_STORE_ROOT.is_junction():
            self.skipTest('public/l2 is not a junction in this checkout')
        with self.assertRaisesRegex(CommittedWorldDataError, 'reparse'):
            require_committed_destination('public/l2/catalog.json')

    def test_the_oracle_destination_resolves_inside_this_repository(self):
        self.assertEqual(require_committed_destination(WORLD_ORACLE_RELATIVE_PATH), COMMITTED_ORACLE_PATH.resolve())


def string_fields(value, field_name='oracle'):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from string_fields(item, key)
    elif isinstance(value, list):
        for item in value:
            yield from string_fields(item, field_name)
    elif isinstance(value, str):
        yield field_name, value


class CommittedWorldOracleTests(unittest.TestCase):
    def setUp(self):
        self.oracle = json.loads(COMMITTED_ORACLE_PATH.read_text(encoding='utf-8'))

    def test_the_committed_oracle_validates_and_holds_the_frozen_20_20_facts(self):
        validate_world_oracle(self.oracle)
        section = self.oracle['section']
        self.assertEqual((section['manifestSha256'][:8], section['modelCount'], section['placementCount'], len(section['terrainPatches']),
                          len(section['unsupportedRuntimeMaterialIds'])), ('2e73654e', 62, 157, 1, 1))
        self.assertEqual([bsp['id'] for bsp in section['bsp']], ['interlude:20_20.Model798.Brush397', 'interlude:20_20.Model798.Brush610.ceiling',
                                                                 'interlude:20_20.Model798.Brush610.floor', 'interlude:20_20.Model798.Brush610.walls'])
        self.assertEqual((self.oracle['sky']['manifestSha256'][:8], self.oracle['environment']['manifestSha256'][:8],
                          self.oracle['movers']['manifestSha256'][:8], len(self.oracle['movers']['moverIds']), len(self.oracle['movers']['modelIds'])),
                         ('f7a0b5ef', 'e10827c4', '0de5d083', 8, 2))
        pinned_manifests = self.oracle['worldAudio'] + self.oracle['stepSounds']
        self.assertEqual([(record['recordId'], record['manifestSha256'][:8], record['manifestBytes'], record['pinnedFileCount'], record['pinnedFileBytes'])
                          for record in pinned_manifests],
                         [('map-20-20-ambience', 'e2fe18be', 584627, 106, 21664812), ('map-20-20-music', 'd4fca6b8', 25749, 18, 19414492),
                          ('stepsound-deco-grass-20-20', 'ff4528e1', 9877, 1, 130050), ('stepsound-surfaces', 'a1e6b3ed', 323386, 93, 1936384)])

    def test_the_committed_oracle_holds_no_long_encoded_run_outside_hash_fields(self):
        for field_name, value in string_fields(self.oracle):
            if field_name != 'sha256' and not field_name.endswith('Sha256'):
                self.assertNotRegex(value, r'[A-Za-z0-9+/=]{65,}', field_name)

    def test_a_fresh_freeze_of_the_shared_store_equals_the_committed_oracle(self):
        catalog_path = SHARED_STORE_ROOT / 'catalog.json'
        if not catalog_path.is_file() or sha256_hex(catalog_path.read_bytes()) != self.oracle['catalogSha256']:
            self.skipTest('junction catalog changed since freeze')
        self.assertEqual(freeze_world_oracle(SHARED_STORE_ROOT), self.oracle)


if __name__ == '__main__':
    unittest.main()
