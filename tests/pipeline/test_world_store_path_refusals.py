from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from material_graph_fixture import build_synthetic_material_package
from native_store.store_paths import ConverterOutputRefusedError, StorePathError
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from world import bsp_step, bsp_surface_materials, material_texture_images, sky_step
from world.bsp_step import BSP_STEP_NAME, bsp_ledger, run_bsp_step
from world.bsp_surface_materials import convert_surface_material
from world.sky_step import SkyRootConversion
from world.static_placement_plan import ChunkRectangle
from world.tile_step_current_seals import TILE_STEP_SEAL_CHECKS
from world.tile_step_workers import TileStepRun

TEXTURED_MATERIAL_FIXTURE = 'shader-combiner-panner-texture.json'
TEXTURED_MATERIAL = 'SyntheticMaterials.SkyShader'
SKY_MATERIAL = 'Sky_T.Shaders.Haze'
TILE_ID = '00_00'
TILE_UNIT_KEY = f'tile:{TILE_ID}'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': 'a' * 64}
CHUNK_ID = 'chunk-0-0'
SURFACE_MATERIAL_REFERENCE, BRUSH_ACTOR_REFERENCE = 1, 2
PATH_ESCAPES_ITS_ROOT = StorePathError('Path escapes its root: native-materials/textures/synthetic/texture.png')
STORE_ROOT_REFUSED = ConverterOutputRefusedError('converter output must be a dedicated folder under artifacts: synthetic')
PUBLISH_REFUSALS = (('write_material_texture_images', PATH_ESCAPES_ITS_ROOT), ('write_material_program_record', STORE_ROOT_REFUSED))
PATH_ESCAPES_ITS_ROOT_ROW_REASON = 'decode-failed:StorePathError:Path escapes its root: native-materials/textures/synthetic/texture.png'


class SurfaceMaterialStorePathRefusalTests(unittest.TestCase):
    def setUp(self):
        package = build_synthetic_material_package(TEXTURED_MATERIAL_FIXTURE)
        self.map_sources = SimpleNamespace(paths={'syntheticmaterials': ['textures/SyntheticMaterials.utx']}, get=lambda relative: package)
        self.converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-material-'),
                                         texture=lambda work, reference: (synthetic_png_bytes(), {}, reference),
                                         material_texture=lambda work, identity: (synthetic_png_bytes(), {}, identity, []))
        self.start_patch(bsp_surface_materials, 'kept_material_class_defaults', mock.Mock(return_value=SYNTHETIC_CLASS_DEFAULTS))

    def start_patch(self, owner, name, replacement):
        patcher = mock.patch.object(owner, name, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)

    def read_one_synthetic_bsp_node_instead_of_a_map(self, project_root):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100), material=SURFACE_MATERIAL_REFERENCE,
                                                               actor=BRUSH_ACTOR_REFERENCE)])
        map_package = SimpleNamespace(object_name={SURFACE_MATERIAL_REFERENCE: TEXTURED_MATERIAL, BRUSH_ACTOR_REFERENCE: f'{TILE_ID}.Brush7'}.get)
        chunk_plan = {'chunks': [{'chunkId': CHUNK_ID}]}
        replacements = {
            'read_tile_map_lock_record': mock.Mock(return_value={'eSha256': SOURCE_IDENTITY['sha256']}),
            'sealed_chunk_plan': mock.Mock(return_value=('b' * 64, project_root / 'raw-products', chunk_plan)),
            'tile_level_model_layout': mock.Mock(return_value='synthetic-layout'), 'implementation_hash': mock.Mock(return_value='c' * 64),
            'read_locked_map_package': mock.Mock(return_value=map_package),
            'read_level_model': mock.Mock(return_value=SimpleNamespace(model=model, binding={'model': {'qualified': f'{TILE_ID}.Model1'}})),
            'native_terrain': mock.Mock(), 'chunk_rectangles': mock.Mock(return_value=[ChunkRectangle(CHUNK_ID, (0.0, 0.0), (1024.0, 1024.0))]),
            'read_level_zones': mock.Mock(), 'sky_zone_indices': mock.Mock(return_value=frozenset()),
            'outdoor_zone_indices': mock.Mock(return_value=frozenset()), 'ClassDefaults': mock.Mock(), 'ReferenceClientClassScripts': mock.Mock(),
            'read_bsp_lightmaps': mock.Mock(), 'lightmap_texture_of_record': mock.Mock(return_value={}),
            'Converter': mock.Mock(return_value=self.converter), 'MapSources': mock.Mock(return_value=self.map_sources),
            'locked_input_records': mock.Mock(return_value=[SOURCE_IDENTITY])}
        for name, replacement in replacements.items():
            self.start_patch(bsp_step, name, replacement)

    def test_a_store_path_refusal_while_a_surface_material_is_published_is_raised_and_is_no_gap_reason(self):
        store_root = scratch_work_root(self, 'bsp-store-') / 'l2'
        for publisher_name, refusal in PUBLISH_REFUSALS:
            with self.subTest(publisher=publisher_name), mock.patch.object(bsp_surface_materials, publisher_name, side_effect=refusal):
                with self.assertRaises(StorePathError) as raised:
                    convert_surface_material(TEXTURED_MATERIAL, self.map_sources, self.converter, store_root, None, store_root)
                self.assertIs(raised.exception, refusal)

    def test_a_store_path_refusal_while_a_surface_material_is_published_fails_the_bsp_step_instead_of_sealing_a_gap_row(self):
        project_root = scratch_work_root(self, 'bsp-project-')
        self.read_one_synthetic_bsp_node_instead_of_a_map(project_root)
        self.start_patch(material_texture_images, 'publish_store_files', mock.Mock(side_effect=PATH_ESCAPES_ITS_ROOT))
        with self.assertRaises(StorePathError) as raised:
            run_bsp_step(project_root, project_root / 'client', TILE_ID)
        self.assertIs(raised.exception, PATH_ESCAPES_ITS_ROOT)
        tile_step_run = TileStepRun(project_root, lambda step, tile_id: [run_bsp_step(project_root, project_root / 'client', tile_id)],
                                    mock.Mock(), TILE_STEP_SEAL_CHECKS)
        row = tile_step_run.step_result(TILE_ID, BSP_STEP_NAME, SOURCE_IDENTITY)
        self.assertEqual((row['status'], row['reason']), ('failed', PATH_ESCAPES_ITS_ROOT_ROW_REASON))
        ledger = bsp_ledger(project_root)
        self.assertIsNone(ledger.sealed_receipt(TILE_UNIT_KEY))
        self.assertFalse(ledger.unit_step_directory(TILE_UNIT_KEY).exists())

    def test_the_same_bsp_step_seals_without_a_gap_row_when_the_publish_is_not_refused(self):
        project_root = scratch_work_root(self, 'bsp-project-')
        self.read_one_synthetic_bsp_node_instead_of_a_map(project_root)
        row = run_bsp_step(project_root, project_root / 'client', TILE_ID)
        self.assertEqual((row['status'], row['reason']), ('pass', None))
        self.assertEqual(bsp_ledger(project_root).sealed_receipt(TILE_UNIT_KEY)['gapRows'], [])

    def test_a_conversion_refusal_that_is_no_store_path_refusal_stays_a_gap_reason(self):
        store_root = scratch_work_root(self, 'bsp-store-') / 'l2'
        with mock.patch.object(bsp_surface_materials, 'write_material_texture_images', side_effect=ValueError('synthetic conversion refusal')):
            outcome = convert_surface_material(TEXTURED_MATERIAL, self.map_sources, self.converter, store_root, None, store_root)
        self.assertEqual((outcome.material.png, outcome.gap_reasons), (None, ['decode-failed:ValueError:synthetic conversion refusal']))


class SkyMaterialStorePathRefusalTests(unittest.TestCase):
    def setUp(self):
        material = SimpleNamespace(graph={'nodes': []}, gap_reasons=[])
        packages = mock.Mock(resolve=mock.Mock(return_value=('package', {'object': SKY_MATERIAL})))
        replacements = {'SkyMaterialPackages': mock.Mock(return_value=packages), 'ReferenceClientClassScripts': mock.Mock(),
                        'read_sky_material_graph': mock.Mock(return_value=[material]), 'sky_texture_products_by_node': mock.Mock(return_value=({}, [])),
                        'sky_texture_pngs_by_node': mock.Mock(return_value={}), 'sky_material_program': mock.Mock(return_value={}),
                        'write_material_program_record': mock.Mock(return_value=({}, [])), 'write_material_texture_images': mock.Mock(return_value=[])}
        for name, replacement in replacements.items():
            patcher = mock.patch.object(sky_step, name, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.gaps = mock.Mock()
        self.conversion = SkyRootConversion('client', 'store', 'work', self.gaps)

    def test_a_store_path_refusal_while_a_sky_material_is_published_is_raised_and_adds_no_gap_row(self):
        for publisher_name, refusal in PUBLISH_REFUSALS:
            with self.subTest(publisher=publisher_name), mock.patch.object(sky_step, publisher_name, side_effect=refusal):
                with self.assertRaises(StorePathError) as raised:
                    self.conversion.convert(SKY_MATERIAL)
                self.assertIs(raised.exception, refusal)
        self.gaps.add.assert_not_called()

    def test_a_conversion_refusal_that_is_no_store_path_refusal_stays_a_failed_gap_row(self):
        with mock.patch.object(sky_step, 'write_material_program_record', side_effect=ValueError('synthetic conversion refusal')):
            self.assertIsNone(self.conversion.convert(SKY_MATERIAL))
        self.gaps.add.assert_called_once_with('failed', 'decode-failed:ValueError:synthetic conversion refusal', SKY_MATERIAL)


if __name__ == '__main__':
    unittest.main()
