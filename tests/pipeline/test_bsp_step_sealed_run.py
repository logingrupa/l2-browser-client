import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from material_graph_fixture import build_synthetic_material_package
from native_store.native_material_program_pins import NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD
from native_store.store_paths import lane_store_root
from support.mapping_size_class_defaults import use_synthetic_mapping_class_defaults
from support.synthetic_bsp_step_run import CHUNK_ID, SOURCE_IDENTITY, TILE_ID, TILE_UNIT_KEY, read_one_synthetic_bsp_node_instead_of_a_map, start_patch
from support.synthetic_map_sources import SyntheticMapSources
from synthetic_class_scripts import scratch_work_root
from test_bsp_texture_coordinates import texture_coordinates_of_primitives
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from world import surface_material_programs
from world.bsp_step import bsp_ledger, bsp_product_path, run_bsp_step
from world.world_lane_names import WORLD_LANE_NAME

SIZED_SHADER = 'SyntheticSizedMaterials.SizedShader'
SIZED_SHADER_PACKAGE_PATH = 'textures/SyntheticSizedMaterials.utx'
SIZED_TEXTURE_PACKAGE_PATH = 'textures/SyntheticSizedTextures.utx'
SQUARE_TEXTURE_COORDINATES_AT_256_BY_32 = [[0.0, -2.0], [0.390625, -2.0], [0.390625, 1.125], [0.0, 1.125]]


class SizedMaterialBspStepTests(unittest.TestCase):
    def setUp(self):
        self.project_root = scratch_work_root(self, 'bsp-project-')
        map_sources = SyntheticMapSources(build_synthetic_material_package('bsp-sized-shader.json'),
                                          build_synthetic_material_package('synthetic-sized-textures.json'))
        converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-material-'),
                                    texture=lambda work, reference: (synthetic_png_bytes(), {}, reference),
                                    material_texture=lambda work, identity: (synthetic_png_bytes(), {}, identity, []))
        start_patch(self, surface_material_programs, 'kept_material_class_defaults', mock.Mock(return_value=SYNTHETIC_CLASS_DEFAULTS))
        use_synthetic_mapping_class_defaults(self)
        read_one_synthetic_bsp_node_instead_of_a_map(self, self.project_root, SIZED_SHADER, map_sources, converter)
        self.row = run_bsp_step(self.project_root, self.project_root / 'client', TILE_ID)
        self.ledger = bsp_ledger(self.project_root)

    def chunk_glb(self):
        product = json.loads(bsp_product_path(self.ledger, TILE_UNIT_KEY).read_text(encoding='utf-8'))
        resource = product['chunks'][CHUNK_ID]['resource'].removeprefix('/l2/')
        return (lane_store_root(self.project_root, WORLD_LANE_NAME) / resource).read_bytes()

    def test_a_material_with_a_mapping_size_seals_a_pass_and_draws_its_baked_texture_at_native_texture_coordinates(self):
        self.assertEqual((self.row['status'], self.row['reason']), ('pass', None))
        self.assertEqual(self.ledger.sealed_receipt(TILE_UNIT_KEY)['gapRows'], [])
        glb = self.chunk_glb()
        self.assertEqual(texture_coordinates_of_primitives(glb), [SQUARE_TEXTURE_COORDINATES_AT_256_BY_32])
        json_length = int.from_bytes(glb[12:16], 'little')
        [material] = json.loads(glb[20:20 + json_length])['materials']
        self.assertIn('baseColorTexture', material['pbrMetallicRoughness'])
        self.assertTrue(material['extras'][NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD]['directory'].startswith('native-materials/'))

    def test_the_sealed_inputs_name_every_package_the_mapping_size_walk_read(self):
        self.assertEqual([record['path'] for record in self.ledger.sealed_receipt(TILE_UNIT_KEY)['inputs']],
                         [SOURCE_IDENTITY['path'], SIZED_SHADER_PACKAGE_PATH, SIZED_TEXTURE_PACKAGE_PATH])


if __name__ == '__main__':
    unittest.main()
