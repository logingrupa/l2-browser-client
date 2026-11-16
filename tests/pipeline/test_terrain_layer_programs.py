import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import pinned_file_references
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from native_store.store_paths import lane_store_root, lane_work_root
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from test_static_mesh_materials_step import synthetic_map_sources
from world import locked_input_receipt, material_texture_images, surface_material_programs, terrain_material_step
from world.surface_material_programs import WorldMaterialSources
from world.terrain_material_step import (TERRAIN_MATERIAL_STEP_NAME, TerrainMaterialStepError, run_terrain_material_step, sealed_terrain_material,
                                         terrain_material_ledger)
from world.tile_manifest_step import (PENDING_CHUNK_STEPS, PENDING_TILE_STEPS, pending_steps_after_sealed, tile_level_gap_rows, tile_resources)
from world.tile_step_registry import TILE_STEP_NAMES

TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic terrain material tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/terrain-material/receipt.json'
TEXTURE = 'SyntheticMaterials.SkyTexture'
ALPHA_MAP = 'SyntheticUnported.PlainTexture'
MISSING_TEXTURE = 'Missing.Texture'
TERRAIN_FINGERPRINT = 't' * 64
CONVERTER_SHA256 = 'c' * 64


def layer_summary(index, texture, alpha_map, use_alpha=False):
    return {'index': index, 'texture': texture, 'alphaMap': alpha_map, 'useAlpha': use_alpha, 'emptySlot': False}


def empty_slot(index):
    return {'index': index, 'texture': None, 'alphaMap': None, 'useAlpha': False, 'emptySlot': True}


class TerrainLayerProgramTests(unittest.TestCase):
    def setUp(self):
        self.project_root = scratch_work_root(self, 'terrain-material-project-')
        self.store_root = lane_store_root(self.project_root, 'world')
        self.store_root.mkdir(parents=True)
        self.converted_textures = []

        def texture(work, reference):
            self.converted_textures.append(reference)
            return synthetic_png_bytes(), {}, reference

        converter = SimpleNamespace(output=scratch_work_root(self, 'terrain-material-converter-'), texture=texture)
        self.sources = WorldMaterialSources(synthetic_map_sources(), converter, lane_work_root(self.project_root, 'world'), None, self.store_root)
        material_texture_images.stored_texture_images_by_store_root.clear()
        self.addCleanup(material_texture_images.stored_texture_images_by_store_root.clear)

    def run_step(self, chunk_layers):
        chunks = [{'chunkId': f'chunk-0-{index}', 'layers': layers} for index, layers in enumerate(chunk_layers)]
        locked = lambda paths: [{'path': path, 'sha256': 'a' * 64} for path in paths]
        patches = (patch.object(terrain_material_step, 'read_tile_map_lock_record', return_value={'eSha256': SOURCE_IDENTITY['sha256']}),
                   patch.object(terrain_material_step, 'sealed_terrain_chunks',
                                return_value=(SimpleNamespace(fingerprint=TERRAIN_FINGERPRINT), chunks, None)),
                   patch.object(terrain_material_step, 'implementation_hash', return_value=CONVERTER_SHA256),
                   patch.object(terrain_material_step, 'world_material_sources', return_value=self.sources),
                   patch.object(terrain_material_step, 'locked_input_records', side_effect=locked),
                   patch.object(locked_input_receipt, 'locked_input_records', side_effect=locked),
                   patch.object(surface_material_programs, 'kept_material_class_defaults', return_value=SYNTHETIC_CLASS_DEFAULTS))
        for active in patches:
            active.start()
            self.addCleanup(active.stop)
        row = run_terrain_material_step(self.project_root, self.project_root / 'client', TILE_ID)
        _, product = sealed_terrain_material(self.project_root, TILE_ID, {'eSha256': SOURCE_IDENTITY['sha256']})
        return row, product

    def listing_of(self, product):
        payload = (self.store_root / product['listing']['resource'].removeprefix('/l2/')).read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), product['listing']['sha256'])
        return json.loads(payload)

    def test_each_kept_layer_gets_a_texture_and_an_alpha_map_program_in_increasing_layer_order(self):
        layers = [layer_summary(0, TEXTURE, ALPHA_MAP), empty_slot(1), layer_summary(2, ALPHA_MAP, TEXTURE, use_alpha=True)]
        row, product = self.run_step([layers, layers])
        listing = self.listing_of(product)
        self.assertEqual((listing['kind'], listing['schemaVersion'], listing['tileId']), ('native-tile-terrain-materials', 1, TILE_ID))
        self.assertEqual([layer['index'] for layer in listing['layers']], [0, 2])
        self.assertEqual([(layer['texture'], layer['alphaMap'], layer['useAlpha']) for layer in listing['layers']],
                         [(TEXTURE, ALPHA_MAP, False), (ALPHA_MAP, TEXTURE, True)])
        for layer in listing['layers']:
            self.assertTrue(layer['rootsPorted'])
            self.assertEqual(layer['gapReasons'], [])
            for program in (layer['textureProgram'], layer['alphaMapProgram']):
                self.assertTrue((self.store_root / program['directory'] / 'program.json').is_file())
        self.assertEqual(product['layerCount'], 2)
        self.assertEqual((row['step'], row['status']), (TERRAIN_MATERIAL_STEP_NAME, 'pass'))
        self.assertEqual(sorted(self.converted_textures), sorted([TEXTURE, ALPHA_MAP]))

    def test_a_layer_whose_alpha_map_does_not_convert_keeps_its_reason_and_seals_a_failed_row(self):
        _, product = self.run_step([[layer_summary(0, TEXTURE, ALPHA_MAP), layer_summary(1, TEXTURE, MISSING_TEXTURE)]])
        missing = self.listing_of(product)['layers'][1]
        self.assertEqual((missing['alphaMapProgram'], missing['rootsPorted']), (None, False))
        self.assertEqual(missing['gapReasons'], ['decode-failed:FormatError:material package missing or ambiguous'])
        self.assertEqual([(row['sourceIdentity'].get('object'), row['status']) for row in product['gapRows']], [(MISSING_TEXTURE, 'failed')])
        patterns = load_gap_reason_patterns()
        for gap_row in product['gapRows']:
            validate_gap_row(gap_row, patterns)

    def test_chunks_that_list_different_layers_are_refused(self):
        with self.assertRaisesRegex(TerrainMaterialStepError, 'list different layers'):
            self.run_step([[layer_summary(0, TEXTURE, ALPHA_MAP)], [layer_summary(0, ALPHA_MAP, TEXTURE)]])

    def test_a_terrain_without_a_drawn_layer_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'has no drawn terrain layer'):
            self.run_step([[empty_slot(0)]])

    def test_a_second_run_is_a_ledger_skip(self):
        layers = [[layer_summary(0, TEXTURE, ALPHA_MAP)]]
        first = self.run_step(layers)
        self.assertEqual(self.run_step(layers), first)
        self.assertEqual(len(self.converted_textures), 2)
        self.assertIsNotNone(terrain_material_ledger(self.project_root).sealed_receipt(f'tile:{TILE_ID}'))

    def test_the_listing_pins_every_program_and_texture_file_for_the_union_walk(self):
        _, product = self.run_step([[layer_summary(0, TEXTURE, ALPHA_MAP)]])
        listing = self.listing_of(product)
        references = pinned_file_references(listing, 'synthetic terrain listing', 'native-materials')
        self.assertEqual(sorted(reference.relative for reference in references), sorted(f'native-materials/{member}' for member in listing['files']))
        for reference in references:
            self.assertEqual(hashlib.sha256((self.store_root / reference.relative).read_bytes()).hexdigest(), reference.sha256)

    def test_the_tile_and_chunk_manifests_pin_the_listing_and_drop_the_pending_terrain_material_row(self):
        _, product = self.run_step([[layer_summary(0, TEXTURE, MISSING_TEXTURE)]])
        self.assertEqual(tile_resources(None, None, terrain_material=product),
                         [{'kind': 'terrain-materials', 'manifest': product['listing']['resource'], 'manifestSha256': product['listing']['sha256'],
                           'manifestBytes': product['listing']['bytes']}])
        self.assertIn(TERRAIN_MATERIAL_STEP_NAME, pending_steps_after_sealed(PENDING_TILE_STEPS, None, None))
        self.assertNotIn(TERRAIN_MATERIAL_STEP_NAME, pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, terrain_material=product))
        self.assertNotIn(TERRAIN_MATERIAL_STEP_NAME, pending_steps_after_sealed(PENDING_CHUNK_STEPS, None, None, terrain_material=product))
        rows = tile_level_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, None, None, None, None, terrain_material=product)
        self.assertEqual([(row['step'], row['status']) for row in rows if row['step'] == TERRAIN_MATERIAL_STEP_NAME],
                         [(TERRAIN_MATERIAL_STEP_NAME, 'gap')])

    def test_the_step_runs_after_terrain_and_before_the_manifest(self):
        self.assertLess(TILE_STEP_NAMES.index('terrain'), TILE_STEP_NAMES.index(TERRAIN_MATERIAL_STEP_NAME))
        self.assertEqual(TILE_STEP_NAMES[-1], 'manifest')


if __name__ == '__main__':
    unittest.main()
