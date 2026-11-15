import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from material_graph_fixture import build_synthetic_material_package
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import pinned_file_references
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from native_store.store_paths import lane_store_root, lane_work_root
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from world import locked_input_receipt, material_texture_images, static_mesh_materials_step, surface_material_programs
from world.bsp_surface_materials import convert_surface_material
from world.static_mesh_materials_step import (STATIC_MESH_MATERIALS_STEP_NAME, run_static_mesh_materials_step, sealed_static_mesh_materials,
                                              static_mesh_materials_ledger)
from world.surface_material_programs import WorldMaterialSources
from world.tile_manifest_step import PENDING_TILE_STEPS, pending_steps_after_sealed, tile_level_gap_rows, tile_resources

TILE_ID = '00_00'
OTHER_TILE_ID = '00_01'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic static mesh materials tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/static-mesh-materials/receipt.json'
TEXTURED_MATERIAL = 'SyntheticMaterials.SkyShader'
TEXTURED_MATERIAL_TEXTURE = 'SyntheticMaterials.SkyTexture'
UNPORTED_MATERIAL = 'SyntheticUnported.TriggeredOscillator'
MISSING_MATERIAL = 'Missing.Material'
TEXTURED_PROGRAM_SHA256_BEFORE_THE_SHARED_MODULE = '41d9dfc981ca17f3d6d8608a7b8e353a35a383dcf2133c7cdfa17b9dc851ed0b'
MESHES_FINGERPRINT = 'd' * 64
CONVERTER_SHA256 = 'c' * 64


def synthetic_model_glb(references):
    document = json.dumps({'asset': {'version': '2.0'},
                           'materials': [{'name': f'slot{index}', 'extras': {'nativeSectionIndex': index, 'nativeSourceReference': reference}}
                                         for index, reference in enumerate(references)]}).encode()
    document += b' ' * (-len(document) % 4)
    return b'glTF' + struct.pack('<II', 2, 20 + len(document)) + struct.pack('<II', len(document), 0x4E4F534A) + document


def synthetic_map_sources():
    packages = {'textures/SyntheticMaterials.utx': build_synthetic_material_package('shader-combiner-panner-texture.json'),
                'textures/SyntheticUnported.utx': build_synthetic_material_package('unported-classes-and-features.json')}
    return SimpleNamespace(paths={'syntheticmaterials': ['textures/SyntheticMaterials.utx'], 'syntheticunported': ['textures/SyntheticUnported.utx']},
                           get=packages.__getitem__)


class StaticMeshMaterialsStepTests(unittest.TestCase):
    def setUp(self):
        self.project_root = scratch_work_root(self, 'static-mesh-materials-project-')
        self.store_root = lane_store_root(self.project_root, 'world')
        self.store_root.mkdir(parents=True)
        self.converted_textures = []

        def texture(work, reference):
            self.converted_textures.append(reference)
            return synthetic_png_bytes(), {}, reference

        self.converter = SimpleNamespace(output=scratch_work_root(self, 'static-mesh-materials-converter-'), texture=texture)
        self.sources = WorldMaterialSources(synthetic_map_sources(), self.converter, lane_work_root(self.project_root, 'world'), None, self.store_root)
        material_texture_images.stored_texture_images_by_store_root.clear()
        self.addCleanup(material_texture_images.stored_texture_images_by_store_root.clear)

    def static_meshes_product(self, models_references):
        models = []
        for index, references in enumerate(models_references):
            glb = synthetic_model_glb(references)
            sha256 = hashlib.sha256(glb).hexdigest()
            (self.store_root / sha256).mkdir(exist_ok=True)
            (self.store_root / sha256 / 'model.glb').write_bytes(glb)
            models.append({'id': f'interlude:Synthetic_S.Mesh{index}', 'model': {'file': f'{sha256}/model.glb', 'sha256': sha256}})
        return {'tileId': TILE_ID, 'models': models}

    def run_step(self, tile_id, static_meshes):
        patches = (patch.object(static_mesh_materials_step, 'read_tile_map_lock_record', return_value={'eSha256': SOURCE_IDENTITY['sha256']}),
                   patch.object(static_mesh_materials_step, 'sealed_static_meshes', return_value=(MESHES_FINGERPRINT, static_meshes)),
                   patch.object(static_mesh_materials_step, 'implementation_hash', return_value=CONVERTER_SHA256),
                   patch.object(static_mesh_materials_step, 'world_material_sources', return_value=self.sources),
                   patch.object(static_mesh_materials_step, 'locked_input_records',
                                side_effect=lambda paths: [{'path': path, 'sha256': 'a' * 64} for path in paths]),
                   patch.object(locked_input_receipt, 'locked_input_records', side_effect=lambda paths: [{'path': path, 'sha256': 'a' * 64} for path in paths]),
                   patch.object(surface_material_programs, 'kept_material_class_defaults', return_value=SYNTHETIC_CLASS_DEFAULTS))
        for active in patches:
            active.start()
            self.addCleanup(active.stop)
        row = run_static_mesh_materials_step(self.project_root, self.project_root / 'client', tile_id)
        _, product = sealed_static_mesh_materials(self.project_root, tile_id, {'eSha256': SOURCE_IDENTITY['sha256']})
        return row, product

    def listing_of(self, product):
        payload = (self.store_root / product['listing']['resource'].removeprefix('/l2/')).read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), product['listing']['sha256'])
        return json.loads(payload)

    def test_each_distinct_slot_material_gets_one_program_and_a_null_slot_material_is_skipped(self):
        product = self.static_meshes_product([[TEXTURED_MATERIAL, None], [TEXTURED_MATERIAL.upper(), UNPORTED_MATERIAL]])
        row, sealed = self.run_step(TILE_ID, product)
        listing = self.listing_of(sealed)
        self.assertEqual((listing['kind'], listing['schemaVersion'], listing['tileId']), ('native-tile-static-mesh-materials', 1, TILE_ID))
        self.assertEqual([entry['sourceObject'] for entry in listing['materials']], [TEXTURED_MATERIAL, UNPORTED_MATERIAL])
        self.assertEqual(sealed['materialCount'], 2)
        textured = listing['materials'][0]
        self.assertEqual((textured['rootPorted'], textured['gapReasons']), (True, []))
        self.assertTrue((self.store_root / textured['program']['directory'] / 'program.json').is_file())
        self.assertEqual(row['step'], STATIC_MESH_MATERIALS_STEP_NAME)

    def test_an_unported_root_keeps_its_program_pin_and_seals_a_gap_row_with_its_reason(self):
        _, sealed = self.run_step(TILE_ID, self.static_meshes_product([[UNPORTED_MATERIAL, MISSING_MATERIAL]]))
        unported = next(entry for entry in self.listing_of(sealed)['materials'] if entry['sourceObject'] == UNPORTED_MATERIAL)
        self.assertFalse(unported['rootPorted'])
        self.assertTrue(unported['program']['directory'].startswith('native-materials/'))
        self.assertIn('material-class-unported:Engine.TexOscillatorTriggered', unported['gapReasons'])
        missing = next(entry for entry in self.listing_of(sealed)['materials'] if entry['sourceObject'] == MISSING_MATERIAL)
        self.assertEqual((missing['program'], missing['rootPorted'], missing['gapReasons']),
                         (None, False, ['decode-failed:FormatError:material package missing or ambiguous']))
        rows = {(row['sourceIdentity'].get('object'), row['status'], row['reason']) for row in sealed['gapRows']}
        self.assertIn((UNPORTED_MATERIAL, 'gap', 'material-class-unported:Engine.TexOscillatorTriggered'), rows)
        self.assertIn((MISSING_MATERIAL, 'failed', 'decode-failed:FormatError:material package missing or ambiguous'), rows)
        patterns = load_gap_reason_patterns()
        for gap_row in sealed['gapRows']:
            validate_gap_row(gap_row, patterns)
        receipt = static_mesh_materials_ledger(self.project_root).sealed_receipt(f'tile:{TILE_ID}')
        self.assertEqual(receipt['gapRows'], sealed['gapRows'])

    def test_a_texture_is_extracted_once_and_a_stored_image_is_reused_by_its_sha256(self):
        self.run_step(TILE_ID, self.static_meshes_product([[TEXTURED_MATERIAL]]))
        self.assertEqual(self.converted_textures, [TEXTURED_MATERIAL_TEXTURE])
        material_texture_images.stored_texture_images_by_store_root.clear()
        _, sealed = self.run_step(OTHER_TILE_ID, self.static_meshes_product([[TEXTURED_MATERIAL]]))
        self.assertEqual(self.converted_textures, [TEXTURED_MATERIAL_TEXTURE])
        png_sha256 = hashlib.sha256(synthetic_png_bytes()).hexdigest()
        self.assertIn(f'textures/{png_sha256}/texture.png', self.listing_of(sealed)['files'])

    def test_a_second_run_is_a_ledger_skip(self):
        product = self.static_meshes_product([[TEXTURED_MATERIAL]])
        first_row, first = self.run_step(TILE_ID, product)
        second_row, second = self.run_step(TILE_ID, product)
        self.assertEqual((second_row, second), (first_row, first))
        self.assertEqual(self.converted_textures, [TEXTURED_MATERIAL_TEXTURE])

    def test_an_unsealed_meshes_unit_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'needs a sealed meshes unit'):
            self.run_step(TILE_ID, None)

    def test_the_listing_pins_every_program_graph_and_texture_file_for_the_union_walk(self):
        _, sealed = self.run_step(TILE_ID, self.static_meshes_product([[TEXTURED_MATERIAL, UNPORTED_MATERIAL]]))
        listing = self.listing_of(sealed)
        references = pinned_file_references(listing, 'synthetic listing', 'native-materials')
        self.assertEqual(sorted(reference.relative for reference in references), sorted(f'native-materials/{member}' for member in listing['files']))
        for reference in references:
            self.assertEqual(hashlib.sha256((self.store_root / reference.relative).read_bytes()).hexdigest(), reference.sha256)
        program_directories = {entry['program']['directory'] for entry in listing['materials']}
        self.assertTrue(all(f'{directory}/program.json'.removeprefix('native-materials/') in listing['files'] for directory in program_directories))

    def test_the_tile_manifest_pins_the_listing_and_names_the_step_gap(self):
        _, sealed = self.run_step(TILE_ID, self.static_meshes_product([[UNPORTED_MATERIAL]]))
        self.assertEqual(tile_resources(None, None, static_mesh_materials=sealed),
                         [{'kind': 'static-mesh-materials', 'manifest': sealed['listing']['resource'], 'manifestSha256': sealed['listing']['sha256'],
                           'manifestBytes': sealed['listing']['bytes']}])
        rows = tile_level_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, None, None, None, None, static_mesh_materials=sealed)
        self.assertEqual([(row['step'], row['status']) for row in rows if row['step'] == STATIC_MESH_MATERIALS_STEP_NAME],
                         [(STATIC_MESH_MATERIALS_STEP_NAME, 'gap')])
        self.assertIn(STATIC_MESH_MATERIALS_STEP_NAME, PENDING_TILE_STEPS)
        self.assertNotIn(STATIC_MESH_MATERIALS_STEP_NAME, pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, static_mesh_materials=sealed))
        self.assertEqual(tile_resources(None, None, static_mesh_materials={'listing': None, 'gapRows': []}), [])


class SharedProgramPathTests(unittest.TestCase):
    def test_bsp_surface_programs_keep_the_bytes_they_had_before_the_shared_module(self):
        material_texture_images.stored_texture_images_by_store_root.clear()
        self.addCleanup(material_texture_images.stored_texture_images_by_store_root.clear)
        map_sources = synthetic_map_sources()
        converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-bytes-'), texture=lambda work, reference: (synthetic_png_bytes(), {}, reference),
                                    material_texture=lambda work, identity: (synthetic_png_bytes(), {}, identity, []))
        store_root = scratch_work_root(self, 'bsp-bytes-store-') / 'l2'
        with patch.object(surface_material_programs, 'kept_material_class_defaults', return_value=SYNTHETIC_CLASS_DEFAULTS):
            outcome = convert_surface_material(TEXTURED_MATERIAL, map_sources, converter, store_root, None, store_root)
        self.assertEqual(outcome.material.program['programSha256'], TEXTURED_PROGRAM_SHA256_BEFORE_THE_SHARED_MODULE)
        program_bytes = (store_root / outcome.material.program['directory'] / 'program.json').read_bytes()
        self.assertEqual(hashlib.sha256(program_bytes).hexdigest(), TEXTURED_PROGRAM_SHA256_BEFORE_THE_SHARED_MODULE)


if __name__ == '__main__':
    unittest.main()
