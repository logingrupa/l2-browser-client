import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.catalog_writer import (NATIVE_RESOURCE_PATH_PATTERN, CatalogWriteError, merge_catalog_slice,
                                         validate_catalog_record)
from native_store import tile_manifest_validation
from native_store.tile_manifest_validation import (MASK_UV_RULES_BASE, TILE_RESOURCE_KINDS_BASE, VOCABULARY_FILE, TileManifestError,
                                                   load_tile_manifest_vocabulary, validate_tile_chunk_manifest, validate_tile_manifest)

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG = json.loads((GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes())
BROWSER_RESOURCE_URL_SOURCE = ROOT / 'src' / 'assets' / 'native' / 'nativeResourceUrl.ts'
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
GOLDEN_TILE_MANIFEST = golden_store_json(GOLDEN_TILE_RECORD['manifest'])
GOLDEN_CHUNK_MANIFEST = golden_store_json(GOLDEN_TILE_MANIFEST['chunks'][0]['manifest'])
SHA256_A, SHA256_B = 'a' * 64, 'b' * 64


def pinned_resource(kind, sha256):
    return {'kind': kind, 'manifest': f'/l2/{kind}/{sha256}/manifest.json', 'manifestSha256': sha256, 'manifestBytes': 10}


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
        golden_paths = [GOLDEN_TILE_RECORD['manifest'], *(chunk['manifest'] for chunk in GOLDEN_TILE_MANIFEST['chunks'])]
        for path in golden_paths:
            with self.subTest(path):
                self.assertTrue(NATIVE_RESOURCE_PATH_PATTERN.fullmatch(path))


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
            'repeated pair': (changed(GOLDEN_TILE_MANIFEST, resources=[pinned_resource('sky', SHA256_A), pinned_resource('sky', SHA256_A)]), 'twice'),
            'other tile gap': (changed(GOLDEN_TILE_MANIFEST, gaps=[changed(GOLDEN_CHUNK_MANIFEST['gaps'][0], key='tile:00_01')]),
                               'must be keyed tile:00_00'),
            'extra key': (changed(GOLDEN_TILE_MANIFEST, models=[]), 'must hold exactly'),
        }
        for label, (manifest, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(TileManifestError, message):
                validate_tile_manifest(manifest, self.four_kind_vocabulary)

    def test_chunk_manifest_refusals(self):
        sector_range = GOLDEN_CHUNK_MANIFEST['sectorRange']
        terrain = {'resource': f'/l2/{SHA256_A}/asset.l2asset', 'sha256': SHA256_A, 'maskUvRule': 'extrapolated'}
        gaps_without_terrain = [row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] != 'terrain']
        passing_terrain_gap = changed(next(row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] == 'terrain'), status='pass', reason=None)
        model = {'id': 'interlude:SyntheticFixture.Model', 'archive': f'/l2/{SHA256_A}/asset.l2asset', 'archiveSha256': SHA256_B, 'placements': []}
        cases = {
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
        terrain = {'resource': f'/l2/{SHA256_A}/asset.l2asset', 'sha256': SHA256_A, 'maskUvRule': 'extrapolated'}
        gaps = [row for row in GOLDEN_CHUNK_MANIFEST['gaps'] if row['step'] != 'terrain']
        manifest = changed(GOLDEN_CHUNK_MANIFEST, terrain=terrain, gaps=gaps)
        self.assertEqual(validate_tile_chunk_manifest(manifest, self.vocabulary)['models'], [])


if __name__ == '__main__':
    unittest.main()
