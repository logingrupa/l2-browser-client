import copy
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import (NATIVE_RESOURCE_PATH_PATTERN, TABLE_ID_PATTERN, TABLE_MANIFEST_MAXIMUM_BYTES, CatalogWriteError,
                                         merge_catalog_slice, merge_catalog_slice_records, validate_catalog_record)
from native_store import tile_manifest_validation
from native_store.data_ui_table_manifest import DECODED_TABLE_KIND, DECODED_TABLE_RECORDS_TYPE_BY_ROUTE, DECODED_TABLE_SCHEMA_VERSION
from native_store.tile_manifest_validation import (CHUNK_COMPONENT_PATH_TEMPLATES, CHUNK_MANIFEST_PATH_TEMPLATE, MASK_UV_RULES_BASE,
                                                   MAXIMUM_CHUNK_MODELS, MAXIMUM_CHUNK_PLACEMENTS, MODEL_ARCHIVE_PATH_TEMPLATE,
                                                   REPEATABLE_TILE_RESOURCE_KINDS, TILE_RESOURCE_KINDS_BASE, TILE_RESOURCE_PATH_TEMPLATES, VOCABULARY_FILE,
                                                   TileManifestError, load_tile_manifest_vocabulary, validate_tile_chunk_manifest, validate_tile_manifest)

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG = json.loads((GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes())
BROWSER_RESOURCE_URL_SOURCE = ROOT / 'src' / 'assets' / 'native' / 'nativeResourceUrl.ts'
BROWSER_TILE_MANIFEST_SOURCES = tuple(ROOT / 'src' / 'scene' / 'world' / name
                                      for name in ('nativeTileManifest.ts', 'nativeTileChunkManifest.ts', 'nativeBspResources.ts'))
CATALOG_INDEX_KEYS_PATH = ROOT / 'tests' / 'fixtures' / 'catalog-index-keys.json'
TABLE_INVENTORY_PATH = ROOT / 'docs' / 'parts' / 'data' / 'dat-table-inventory.json'
SKILL_EFFECT_COMPONENT_PATTERN = re.compile(r'^interlude:skill:(\d+):level:(\d+):')
LEGACY_SECTION_TILE_PATTERN = re.compile(r'^map-(\d{2})-(\d{2})-section$')
FIRST_WORLD_VOCABULARY = {'schemaVersion': 1, 'listVersion': 1, 'resourceKinds': [], 'maskUvRules': []}
MOVERS_VOCABULARY = {'schemaVersion': 1, 'listVersion': 2, 'resourceKinds': ['movers'], 'maskUvRules': []}
FOUR_KIND_VOCABULARY = {'schemaVersion': 1, 'listVersion': 5, 'resourceKinds': ['movers', 'sky', 'world-audio', 'minimap'], 'maskUvRules': []}
FILE_IMPORT_REFUSAL_SCRIPT = '''
import builtins, io, pathlib, sys
import copy, hashlib, json, math, os, re, stat, tempfile, typing
sys.path.insert(0, sys.argv[1])
def refuse_file_read(*arguments, **keywords):
    raise AssertionError('file read at import time: ' + repr(arguments))
builtins.open = io.open = refuse_file_read
pathlib.Path.open = pathlib.Path.read_text = pathlib.Path.read_bytes = refuse_file_read
import native_store.tile_manifest_validation
print('imported')
'''


def golden_store_json(resource_path):
    return json.loads((GOLDEN_ROOT / resource_path[len('/'):]).read_bytes())


GOLDEN_TILE_RECORD = GOLDEN_CATALOG['tiles'][0]
GOLDEN_TABLE_RECORD = GOLDEN_CATALOG['tables'][0]
GOLDEN_WINDOW_RECORD = GOLDEN_CATALOG['windows'][0]
GOLDEN_TILE_MANIFEST = golden_store_json(GOLDEN_TILE_RECORD['manifest'])
GOLDEN_CHUNK_MANIFEST = golden_store_json(GOLDEN_TILE_MANIFEST['chunks'][0]['manifest'])
SHA256_A, SHA256_B = 'a' * 64, 'b' * 64


def pinned_resource(kind, sha256):
    return {'kind': kind, 'manifest': TILE_RESOURCE_PATH_TEMPLATES[kind].replace('<sha256>', sha256), 'manifestSha256': sha256, 'manifestBytes': 10}


def chunk_terrain(sha256):
    return {'resource': f'/l2/maps/{sha256}/native-tile-chunk-terrain/terrain.glb', 'sha256': sha256, 'maskUvRule': 'extrapolated'}


def chunk_placement(model_id, placement_id='placement-1', **fields):
    return {'id': placement_id, 'modelId': model_id, 'sourceActor': 'SyntheticFixture.StaticMeshActor0', 'exportIndex': 1,
            'sourceMesh': 'SyntheticFixture.Mesh', 'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'materialOverrides': [],
            'collision': {}, **fields}


def chunk_model(placements, model_id='interlude:SyntheticFixture.Model'):
    return {'id': model_id, 'archive': f'/l2/{SHA256_A}/asset.l2asset', 'archiveSha256': SHA256_A, 'placements': placements}


def write_vocabulary_root(test_case, document):
    temporary_directory = tempfile.TemporaryDirectory()
    test_case.addCleanup(temporary_directory.cleanup)
    vocabulary_path = Path(temporary_directory.name) / VOCABULARY_FILE
    vocabulary_path.parent.mkdir(parents=True)
    vocabulary_path.write_text(document if isinstance(document, str) else json.dumps(document), encoding='utf-8')
    return Path(temporary_directory.name)


def changed(document, **fields):
    copied = copy.deepcopy(document)
    copied.update(fields)
    return copied


class CatalogRecordShapeTests(unittest.TestCase):
    def test_golden_tiles_record_passes(self):
        self.assertEqual(validate_catalog_record('tiles', GOLDEN_TILE_RECORD), GOLDEN_TILE_RECORD)

    def test_tiles_record_refusals(self):
        other_sha256 = SHA256_A if GOLDEN_TILE_RECORD['manifestSha256'] != SHA256_A else SHA256_B
        cases = {
            'path SHA differs': (changed(GOLDEN_TILE_RECORD, manifestSha256=other_sha256), 'differs from its pin'),
            'maps path': (changed(GOLDEN_TILE_RECORD, manifest=f'/l2/maps/{GOLDEN_TILE_RECORD["manifestSha256"]}/tile.json'), 'path must match'),
            'short id': (changed(GOLDEN_TILE_RECORD, id='0_00'), 'id must match'),
            'zero bytes': (changed(GOLDEN_TILE_RECORD, manifestBytes=0), 'byte length'),
            'over the bound': (changed(GOLDEN_TILE_RECORD, manifestBytes=8_000_001), 'byte length'),
            'extra key': (changed(GOLDEN_TILE_RECORD, recordCount=1), 'must hold exactly'),
        }
        for label, (record, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(CatalogWriteError, message):
                validate_catalog_record('tiles', record)

    def test_merge_validates_the_record_before_merging(self):
        catalog = {'schemaVersion': 1, 'models': []}
        with self.assertRaisesRegex(CatalogWriteError, 'id must match'):
            merge_catalog_slice(catalog, 'tiles', changed(GOLDEN_TILE_RECORD, id='0_00'), 1)
        self.assertEqual(catalog, {'schemaVersion': 1, 'models': []})
        self.assertEqual(merge_catalog_slice(catalog, 'tiles', GOLDEN_TILE_RECORD, 1)['tiles'], [GOLDEN_TILE_RECORD])

    def test_python_path_pattern_matches_browser_regex(self):
        self.assertIn('/' + NATIVE_RESOURCE_PATH_PATTERN.pattern + '/', BROWSER_RESOURCE_URL_SOURCE.read_text(encoding='utf-8'))
        golden_paths = [GOLDEN_TILE_RECORD['manifest'], GOLDEN_TABLE_RECORD['manifest'], GOLDEN_WINDOW_RECORD['manifest'],
                        *(chunk['manifest'] for chunk in GOLDEN_TILE_MANIFEST['chunks'])]
        for path in golden_paths:
            with self.subTest(path):
                self.assertTrue(NATIVE_RESOURCE_PATH_PATTERN.fullmatch(path))

    def test_golden_tables_record_passes_and_an_empty_table_is_representable(self):
        self.assertEqual(validate_catalog_record('tables', GOLDEN_TABLE_RECORD), GOLDEN_TABLE_RECORD)
        self.assertEqual(validate_catalog_record('tables', changed(GOLDEN_TABLE_RECORD, recordCount=0))['recordCount'], 0)

    def test_golden_table_manifest_holds_records_in_the_shape_its_route_writes(self):
        manifest = golden_store_json(GOLDEN_TABLE_RECORD['manifest'])
        self.assertEqual((manifest['kind'], manifest['schemaVersion'], manifest['table']),
                         (DECODED_TABLE_KIND, DECODED_TABLE_SCHEMA_VERSION, GOLDEN_TABLE_RECORD['id']))
        self.assertIsInstance(manifest['records'], DECODED_TABLE_RECORDS_TYPE_BY_ROUTE[manifest['route']])
        record_lists = [value for value in manifest['records'].values() if isinstance(value, list)]
        self.assertEqual(len(record_lists), 1)
        self.assertEqual(manifest['recordCount'], len(record_lists[0]))
        self.assertEqual(GOLDEN_TABLE_RECORD['recordCount'], manifest['recordCount'])

    def test_tables_record_refusals(self):
        other_manifest = GOLDEN_TABLE_RECORD['manifest'].rsplit('/', 1)[0] + '/other.json'
        cases = {
            'upper case id': (changed(GOLDEN_TABLE_RECORD, id='NpcGrp'), 'id must match'),
            'two-letter suffix': (changed(GOLDEN_TABLE_RECORD, id='npcgrp-ee'), 'id must match'),
            'other file name': (changed(GOLDEN_TABLE_RECORD, manifest=other_manifest), 'file name must be the record id'),
            'zero bytes': (changed(GOLDEN_TABLE_RECORD, manifestBytes=0), 'byte length'),
            'over the bound': (changed(GOLDEN_TABLE_RECORD, manifestBytes=TABLE_MANIFEST_MAXIMUM_BYTES + 1), 'byte length'),
            'negative count': (changed(GOLDEN_TABLE_RECORD, recordCount=-1), 'recordCount must be a safe integer'),
            'fractional count': (changed(GOLDEN_TABLE_RECORD, recordCount=1.5), 'recordCount must be a safe integer'),
            'short source hash': (changed(GOLDEN_TABLE_RECORD, sourceSha256='x'), 'sourceSha256 must be 64'),
            'inlined records': (changed(GOLDEN_TABLE_RECORD, records=[{'id': 0}]), 'must hold exactly'),
        }
        self.assertEqual(TABLE_MANIFEST_MAXIMUM_BYTES, 32 * 1024 * 1024)
        for label, (record, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(CatalogWriteError, message):
                validate_catalog_record('tables', record)

    def test_golden_windows_record_and_an_ordinal_window_pass(self):
        self.assertEqual(validate_catalog_record('windows', GOLDEN_WINDOW_RECORD), GOLDEN_WINDOW_RECORD)
        self.assertEqual(validate_catalog_record('windows', changed(GOLDEN_WINDOW_RECORD, id='StatusWnd#2'))['id'], 'StatusWnd#2')

    def test_windows_record_refusals(self):
        cases = {
            'ordinal zero': (changed(GOLDEN_WINDOW_RECORD, id='StatusWnd#0'), 'id must match'),
            'ordinal only': (changed(GOLDEN_WINDOW_RECORD, id='#2'), 'id must match'),
            'space': (changed(GOLDEN_WINDOW_RECORD, id='Status Wnd'), 'id must match'),
            'outside windows': (changed(GOLDEN_WINDOW_RECORD, manifest=f'/l2/tiles/{GOLDEN_WINDOW_RECORD["manifestSha256"]}/window.json'),
                                'path must match'),
        }
        for label, (record, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(CatalogWriteError, message):
                validate_catalog_record('windows', record)

    def test_every_inventory_table_name_passes_the_table_id_pattern(self):
        table_names = [row['table'] for row in json.loads(TABLE_INVENTORY_PATH.read_text(encoding='utf-8'))['rows']]
        self.assertEqual(len(table_names), 40)
        self.assertEqual(len(set(table_names)), len(table_names))
        for table_name in table_names:
            with self.subTest(table_name):
                self.assertTrue(TABLE_ID_PATTERN.fullmatch(table_name))

    def test_tables_merge_is_idempotent_and_refuses_a_differing_record(self):
        catalog = merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'tables', GOLDEN_TABLE_RECORD, 40)
        catalog_bytes = json_bytes(catalog)
        self.assertEqual(json_bytes(merge_catalog_slice(catalog, 'tables', copy.deepcopy(GOLDEN_TABLE_RECORD), 40)), catalog_bytes)
        with self.assertRaisesRegex(CatalogWriteError, 'record syntheticfixture differs; preserved'):
            merge_catalog_slice(catalog, 'tables', changed(GOLDEN_TABLE_RECORD, recordCount=2), 40)

    def test_a_batch_merge_writes_the_bytes_of_one_record_merges_and_keeps_their_refusals(self):
        records = [{'id': f'interlude:model:{index}'} for index in range(3)]
        sequential = {'schemaVersion': 1, 'models': [{'id': 'interlude:model:0'}]}
        for record in records:
            sequential = merge_catalog_slice(sequential, 'models', record, 3)
        batch = merge_catalog_slice_records({'schemaVersion': 1, 'models': [{'id': 'interlude:model:0'}]}, 'models', [*records, records[2]], 3)
        self.assertEqual(json_bytes(batch), json_bytes(sequential))
        with self.assertRaisesRegex(CatalogWriteError, 'record interlude:model:1 differs; preserved'):
            merge_catalog_slice_records(batch, 'models', [{'id': 'interlude:model:1', 'archive': 'changed'}], 3)
        with self.assertRaisesRegex(CatalogWriteError, 'capacity 2 exceeded'):
            merge_catalog_slice_records({'schemaVersion': 1, 'models': []}, 'models', records, 2)

    def test_catalog_index_keys_match_the_golden_catalog(self):
        key_contract = json.loads(CATALOG_INDEX_KEYS_PATH.read_bytes())
        self.assertEqual(sorted(key_contract), ['catalog', 'keys', 'schemaVersion'])
        self.assertEqual((key_contract['schemaVersion'], key_contract['catalog']), (1, 'tests/fixtures/golden/l2/catalog.json'))
        keys = key_contract['keys']
        self.assertEqual(keys, sorted(set(keys)))
        section_matches = (LEGACY_SECTION_TILE_PATTERN.fullmatch(section['id']) for section in GOLDEN_CATALOG['sections'])
        section_tiles = [f'{match[1]}_{match[2]}' for match in section_matches if match]
        component_matches = (SKILL_EFFECT_COMPONENT_PATTERN.match(component['id']) for component in GOLDEN_CATALOG['effectComponents'])
        skill_levels = [f'{match[1]}:{match[2]}' for match in component_matches if match]
        expected_keys = {
            'skill': set(skill_levels),
            'table': {record['id'] for record in GOLDEN_CATALOG['tables']},
            'tile': {record['id'] for record in GOLDEN_CATALOG['tiles']} | set(section_tiles),
            'window': {record['id'] for record in GOLDEN_CATALOG['windows']},
        }
        for kind, identities in expected_keys.items():
            with self.subTest(kind):
                self.assertEqual({key.split(':', 1)[1] for key in keys if key.startswith(kind + ':')}, identities)
        self.assertEqual(sum(map(len, expected_keys.values())), len(keys))


class TileManifestVocabularyTests(unittest.TestCase):
    def test_missing_file_is_refused_naming_the_path(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TileManifestError) as refusal:
                load_tile_manifest_vocabulary(directory)
        self.assertIn('tile manifest vocabulary file missing', str(refusal.exception))
        self.assertIn(str(Path(directory) / VOCABULARY_FILE), str(refusal.exception))

    def test_import_reads_no_file(self):
        result = subprocess.run([sys.executable, '-B', '-c', FILE_IMPORT_REFUSAL_SCRIPT, str(SCRIPTS_ROOT)],
                                capture_output=True, text=True, check=False)
        self.assertEqual((result.returncode, result.stdout.strip()), (0, 'imported'), result.stderr)

    def test_first_world_shape_gives_the_base_sets_and_refuses_movers(self):
        vocabulary = load_tile_manifest_vocabulary(write_vocabulary_root(self, FIRST_WORLD_VOCABULARY))
        self.assertEqual((vocabulary.resource_kinds, vocabulary.mask_uv_rules), (frozenset(TILE_RESOURCE_KINDS_BASE), frozenset(MASK_UV_RULES_BASE)))
        self.assertEqual((TILE_RESOURCE_KINDS_BASE, MASK_UV_RULES_BASE), ((), ('extrapolated',)))
        with self.assertRaisesRegex(TileManifestError, "resource kind 'movers' is not in the tile manifest vocabulary"):
            validate_tile_manifest(changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('movers', SHA256_A)]), vocabulary)

    def test_movers_shape_accepts_a_movers_resource(self):
        vocabulary = load_tile_manifest_vocabulary(write_vocabulary_root(self, MOVERS_VOCABULARY))
        manifest = changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('movers', SHA256_A)])
        self.assertEqual(validate_tile_manifest(manifest, vocabulary), manifest)

    def test_four_kind_shape_accepts_every_kind_in_kind_and_manifest_order(self):
        vocabulary = load_tile_manifest_vocabulary(write_vocabulary_root(self, FOUR_KIND_VOCABULARY))
        resources = [pinned_resource('minimap', SHA256_A), pinned_resource('movers', SHA256_A), pinned_resource('sky', SHA256_A),
                     pinned_resource('world-audio', SHA256_A), pinned_resource('world-audio', SHA256_B)]
        manifest = changed(GOLDEN_TILE_MANIFEST, resources=resources)
        self.assertEqual(validate_tile_manifest(manifest, vocabulary), manifest)

    def test_vocabulary_file_refusals(self):
        cases = {
            'listVersion 0': (changed(FIRST_WORLD_VOCABULARY, listVersion=0), 'listVersion must be an integer'),
            'listVersion 1.5': (changed(FIRST_WORLD_VOCABULARY, listVersion=1.5), 'listVersion must be an integer'),
            'schemaVersion 2': (changed(FIRST_WORLD_VOCABULARY, schemaVersion=2), 'schemaVersion must be 1'),
            'extra key': (changed(FIRST_WORLD_VOCABULARY, extra=[]), 'must hold exactly'),
            'missing maskUvRules': ({'schemaVersion': 1, 'listVersion': 1, 'resourceKinds': []}, 'must hold exactly'),
            'repeated kind': (changed(FIRST_WORLD_VOCABULARY, resourceKinds=['movers', 'movers']), 'entry movers is listed twice'),
            'base mask rule repeated': (changed(FIRST_WORLD_VOCABULARY, maskUvRules=['extrapolated']), 'entry extrapolated repeats a base entry'),
            'empty string': (changed(FIRST_WORLD_VOCABULARY, resourceKinds=['']), 'non-empty string'),
            'non-list kinds': (changed(FIRST_WORLD_VOCABULARY, resourceKinds='movers'), 'resourceKinds must be a list'),
            'duplicate JSON key': ('{"schemaVersion": 1, "schemaVersion": 1, "listVersion": 1, "resourceKinds": [], "maskUvRules": []}', 'not JSON'),
        }
        for label, (document, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(TileManifestError, message):
                load_tile_manifest_vocabulary(write_vocabulary_root(self, document))


class TileManifestValidationTests(unittest.TestCase):
    def setUp(self):
        self.vocabulary = load_tile_manifest_vocabulary(write_vocabulary_root(self, FIRST_WORLD_VOCABULARY))
        self.four_kind_vocabulary = load_tile_manifest_vocabulary(write_vocabulary_root(self, FOUR_KIND_VOCABULARY))

    def test_golden_tile_and_chunk_manifests_pass(self):
        self.assertEqual(validate_tile_manifest(GOLDEN_TILE_MANIFEST, self.vocabulary), GOLDEN_TILE_MANIFEST)
        self.assertEqual(validate_tile_chunk_manifest(GOLDEN_CHUNK_MANIFEST, self.vocabulary), GOLDEN_CHUNK_MANIFEST)

    def test_validation_without_a_vocabulary_loads_the_repository_file(self):
        missing_file = TileManifestError('tile manifest vocabulary file missing: ' + str(ROOT / VOCABULARY_FILE))
        for validate, manifest in ((validate_tile_manifest, GOLDEN_TILE_MANIFEST), (validate_tile_chunk_manifest, GOLDEN_CHUNK_MANIFEST)):
            with (self.subTest(validate.__name__),
                  patch.object(tile_manifest_validation, 'load_tile_manifest_vocabulary', side_effect=missing_file) as loader,
                  self.assertRaisesRegex(TileManifestError, 'tile manifest vocabulary file missing')):
                validate(manifest)
            loader.assert_called_once_with()

    def test_tile_manifest_refusals(self):
        chunk = GOLDEN_TILE_MANIFEST['chunks'][0]
        later_chunk = changed(chunk, chunkId='chunk-1-0')
        cases = {
            'other kind': (changed(GOLDEN_TILE_MANIFEST, kind='map-section-runtime'), 'kind must be native-tile-runtime'),
            'schemaVersion 2': (changed(GOLDEN_TILE_MANIFEST, schemaVersion=2), 'schemaVersion must be 1'),
            'other source map': (changed(GOLDEN_TILE_MANIFEST, sourceMap='maps/00_01.unr'), 'sourceMap must be maps/00_00.unr'),
            'two-number vector': (changed(GOLDEN_TILE_MANIFEST, frame=changed(GOLDEN_TILE_MANIFEST['frame'], location=[0, 0])), 'three finite numbers'),
            'NaN vector': (changed(GOLDEN_TILE_MANIFEST, frame=changed(GOLDEN_TILE_MANIFEST['frame'], terrainScale=[1, float('nan'), 1])),
                           'three finite numbers'),
            'zero chunks': (changed(GOLDEN_TILE_MANIFEST, chunks=[]), 'needs at least one chunk'),
            'duplicate chunk': (changed(GOLDEN_TILE_MANIFEST, chunks=[chunk, chunk]), 'lists chunk chunk-0-0 twice'),
            'chunk order': (changed(GOLDEN_TILE_MANIFEST, chunks=[later_chunk, chunk]), r'sorted by \(column, row\)'),
            'unknown kind': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('lighting', SHA256_A)]), 'not in the tile manifest vocabulary'),
            'kind order': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('world-audio', SHA256_B), pinned_resource('world-audio', SHA256_A)]),
                           r'sorted by \(kind, manifest\)'),
            'repeated pair': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('world-audio', SHA256_A), pinned_resource('world-audio', SHA256_A)]),
                              'twice'),
            'two minimap resources': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('minimap', SHA256_A), pinned_resource('minimap', SHA256_B)]),
                                      'lists more than one minimap resource'),
            'two sky resources': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('sky', SHA256_A), pinned_resource('sky', SHA256_A)]),
                                  'lists more than one sky resource'),
            'sky outside its template': (changed(GOLDEN_TILE_MANIFEST, resources=[changed(pinned_resource('sky', SHA256_A), manifest=f'/l2/{SHA256_A}/x.json')]),
                                         r'sky resource manifest path must match \^/l2/skies/'),
            'sky under another kind folder': (changed(GOLDEN_TILE_MANIFEST, resources=[
                changed(pinned_resource('sky', SHA256_A), manifest=pinned_resource('minimap', SHA256_A)['manifest'])]), 'sky resource manifest path must match'),
            'other tile gap': (changed(GOLDEN_TILE_MANIFEST, gaps=[changed(GOLDEN_CHUNK_MANIFEST['gaps'][0], key='tile:00_01')]),
                               'must be keyed tile:00_00'),
            'extra key': (changed(GOLDEN_TILE_MANIFEST, models=[]), 'must hold exactly'),
        }
        for label, (manifest, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(TileManifestError, message):
                validate_tile_manifest(manifest, self.four_kind_vocabulary)

    def test_chunk_manifest_refusals(self):
        sector_range = GOLDEN_CHUNK_MANIFEST['sectorRange']
        terrain = chunk_terrain(SHA256_A)
        gaps_without_terrain = [row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] != 'terrain']
        passing_terrain_gap = changed(next(row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] == 'terrain'), status='pass', reason=None)
        model_id = 'interlude:SyntheticFixture.Model'
        model = changed(chunk_model([chunk_placement(model_id)]), archiveSha256=SHA256_B)
        one_placement_per_model = [chunk_model([chunk_placement(f'model-{index}', f'placement-{index}')], f'model-{index}')
                                   for index in range(MAXIMUM_CHUNK_MODELS + 1)]
        too_many_placements = [chunk_model([chunk_placement(model_id, f'placement-{index}') for index in range(MAXIMUM_CHUNK_PLACEMENTS + 1)])]
        cases = {
            'terrain archive path': (changed(GOLDEN_CHUNK_MANIFEST, terrain=changed(terrain, resource=f'/l2/{SHA256_A}/asset.l2asset')),
                                     'terrain resource path must match'),
            'collision in the terrain folder': (changed(GOLDEN_CHUNK_MANIFEST, collision={'resource': terrain['resource'], 'sha256': SHA256_A}),
                                                'collision resource path must match'),
            'bsp at a hash path': (changed(GOLDEN_CHUNK_MANIFEST, bsp={'resource': f'/l2/maps/{SHA256_A}/x.glb', 'sha256': SHA256_A}),
                                   'bsp resource path must match'),
            'model without placements': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([])]), 'placements must be a non-empty list'),
            'placement of another model': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement('other')])]), 'modelId must be its model'),
            'placement without a qualified actor': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id, sourceActor='Actor')])]),
                                                    'sourceActor must be a qualified object name'),
            'placement export index zero': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id, exportIndex=0)])]),
                                            'exportIndex must be a safe integer of at least 1'),
            'placement singular matrix': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id, matrix=[0] * 15 + [1])])]),
                                          'invertible affine transform'),
            'placement material overrides': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id, materialOverrides=[{}])])]),
                                             'materialOverrides must be an empty list'),
            'placement listed twice': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id), chunk_placement(model_id)])]),
                                       'listed once in the chunk'),
            'placement without collision object': (changed(GOLDEN_CHUNK_MANIFEST, models=[chunk_model([chunk_placement(model_id, collision=None)])]),
                                                   'collision must be an object'),
            'models over the bound': (changed(GOLDEN_CHUNK_MANIFEST, models=one_placement_per_model), f'at most {MAXIMUM_CHUNK_MODELS} models'),
            'placements over the bound': (changed(GOLDEN_CHUNK_MANIFEST, models=too_many_placements), f'the bound is {MAXIMUM_CHUNK_PLACEMENTS}'),
            'chunk id off the range': (changed(GOLDEN_CHUNK_MANIFEST, chunkId='chunk-1-0'), 'chunk id must be chunk-'),
            'unaligned first column': (changed(GOLDEN_CHUNK_MANIFEST, sectorRange=changed(sector_range, firstColumn=2)), 'multiple of 4'),
            'five sectors wide': (changed(GOLDEN_CHUNK_MANIFEST, sectorRange=changed(sector_range, lastColumn=4)), 'span 1 to 4 sectors'),
            'terrain without gap row': (changed(GOLDEN_CHUNK_MANIFEST, gaps=gaps_without_terrain), 'has no terrain'),
            'terrain with passing gap row': (changed(GOLDEN_CHUNK_MANIFEST, gaps=[*gaps_without_terrain, passing_terrain_gap]), 'has no terrain'),
            'captured mask rule': (changed(GOLDEN_CHUNK_MANIFEST, terrain=changed(terrain, maskUvRule='captured')), "maskUvRule 'captured'"),
            'model archive SHA differs': (changed(GOLDEN_CHUNK_MANIFEST, models=[model]), 'differs from its pin'),
            'bsp short sha256': (changed(GOLDEN_CHUNK_MANIFEST, bsp={'resource': f'/l2/{SHA256_A}/asset.l2asset', 'sha256': 'abc'}),
                                 'SHA-256 must be 64 lowercase hex'),
        }
        for label, (manifest, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(TileManifestError, message):
                validate_tile_chunk_manifest(manifest, self.vocabulary)

    def test_chunk_with_terrain_and_no_models_passes(self):
        gaps = [row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] != 'terrain']
        manifest = changed(GOLDEN_CHUNK_MANIFEST, terrain=chunk_terrain(SHA256_A), gaps=gaps)
        self.assertEqual(validate_tile_chunk_manifest(manifest, self.vocabulary)['models'], [])

    def test_chunk_with_a_placed_model_and_every_component_passes(self):
        gaps = [row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] not in ('terrain', 'bsp', 'collision')]
        model_id = 'interlude:SyntheticFixture.Model'
        manifest = changed(GOLDEN_CHUNK_MANIFEST, terrain=chunk_terrain(SHA256_A), gaps=gaps, models=[chunk_model([chunk_placement(model_id)])],
                           bsp={'resource': f'/l2/maps/{SHA256_B}/native-tile-chunk-bsp/bsp.glb', 'sha256': SHA256_B},
                           collision={'resource': f'/l2/maps/{SHA256_B}/native-tile-chunk-collision/asset.json', 'sha256': SHA256_B})
        self.assertEqual(validate_tile_chunk_manifest(manifest, self.vocabulary), manifest)

    def test_a_vocabulary_kind_without_a_path_template_is_refused(self):
        with self.assertRaisesRegex(TileManifestError, 'resource kinds have no path template: weather'):
            load_tile_manifest_vocabulary(write_vocabulary_root(self, changed(FIRST_WORLD_VOCABULARY, resourceKinds=['weather'])))


def browser_path_regex_text(template):
    return '/^' + template.replace('/', '\\/').replace('.', '\\.').replace('<sha256>', '([a-f0-9]{64})') + '$/'


class TileManifestBrowserParityTests(unittest.TestCase):
    def setUp(self):
        self.tile_source = BROWSER_TILE_MANIFEST_SOURCES[0].read_text(encoding='utf-8')
        self.browser_sources = '\n'.join(path.read_text(encoding='utf-8') for path in BROWSER_TILE_MANIFEST_SOURCES)

    def test_tile_resource_path_templates_and_repeatable_kinds_match_the_browser_reader(self):
        template_block = re.search(r'const tileResourcePathTemplates = \{\n(?P<body>.*?)\n\} as const;', self.tile_source, re.DOTALL)
        browser_templates = dict(re.findall(r'^\s*"?([a-z][a-z-]*)"?: "([^"]+)",$', template_block['body'], re.MULTILINE))
        self.assertEqual(browser_templates, dict(TILE_RESOURCE_PATH_TEMPLATES))
        repeatable_kinds = re.search(r'repeatableTileResourceKinds[^=]*= new Set\(\[(?P<kinds>[^\]]*)\]\)', self.tile_source)['kinds']
        self.assertEqual(frozenset(re.findall(r'"([^"]+)"', repeatable_kinds)), REPEATABLE_TILE_RESOURCE_KINDS)

    def test_chunk_paths_and_bounds_match_the_browser_reader(self):
        for template in (CHUNK_MANIFEST_PATH_TEMPLATE, MODEL_ARCHIVE_PATH_TEMPLATE, *CHUNK_COMPONENT_PATH_TEMPLATES.values()):
            with self.subTest(template):
                self.assertIn(browser_path_regex_text(template), self.browser_sources)
        self.assertIn(f'const maximumChunkModels = {MAXIMUM_CHUNK_MODELS};', self.browser_sources)
        self.assertIn(f'const maximumChunkPlacements = {MAXIMUM_CHUNK_PLACEMENTS};', self.browser_sources)


if __name__ == '__main__':
    unittest.main()
