from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.glb_container import glb_document_and_binary
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from world.bsp_chunk_geometry import BspPolyFlags, BspSurfaceMaterial, build_chunk_sections, chunk_bsp_glb, round_half_up_by_floor
from world.bsp_material_mapping_size import MaterialMappingSize

FLAGS = BspPolyFlags(visual_skip_mask=0x1, unlit_mask=0x00400000)
MATERIAL = 'SyntheticTextures.Floor'
SQUARE_TEXTURE_COORDINATES_AT_64_BY_32 = [[-1.0, -2.0], [0.5625, -2.0], [0.5625, 1.125], [-1.0, 1.125]]


def texture_coordinates_of_primitives(glb):
    document, binary = glb_document_and_binary(glb)
    primitives = []
    for mesh in document['meshes']:
        attributes = mesh['primitives'][0]['attributes']
        if 'TEXCOORD_0' not in attributes:
            primitives.append(None)
            continue
        accessor = document['accessors'][attributes['TEXCOORD_0']]
        view = document['bufferViews'][accessor['bufferView']]
        values = struct.unpack_from(f'<{accessor["count"] * 2}f', binary, view.get('byteOffset', 0))
        primitives.append([list(values[index:index + 2]) for index in range(0, len(values), 2)])
    return primitives


def chunk_texture_coordinates(model, mapping_size):
    sections = build_chunk_sections(model, list(range(len(model.nodes))), [MATERIAL] * len(model.nodes), FLAGS, {})
    glb, _, _, _ = chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: BspSurfaceMaterial(MATERIAL, None, mapping_size, False, None)})
    return texture_coordinates_of_primitives(glb)


class BspTextureCoordinateTests(unittest.TestCase):
    def test_each_vertex_projects_from_the_surface_base_over_the_mapping_size_then_drops_the_rounded_node_mean(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        self.assertEqual(chunk_texture_coordinates(model, MaterialMappingSize(64, 32)), [SQUARE_TEXTURE_COORDINATES_AT_64_BY_32])

    def test_the_projection_is_relative_to_the_surface_base_point(self):
        moved = build_synthetic_level_model([synthetic_polygon(square_points(200, 0, 100))])
        self.assertEqual(chunk_texture_coordinates(moved, MaterialMappingSize(64, 32)), [SQUARE_TEXTURE_COORDINATES_AT_64_BY_32])
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        model.surfs[0].p_base = 2
        self.assertEqual(chunk_texture_coordinates(model, MaterialMappingSize(64, 32)),
                         [[[-0.5625, -1.125], [1.0, -1.125], [1.0, 2.0], [-0.5625, 2.0]]])

    def test_every_node_recentres_on_its_own_mean_and_adds_no_pan(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100)), synthetic_polygon(square_points(0, 200, 100))])
        self.assertEqual(chunk_texture_coordinates(model, MaterialMappingSize(64, 32)), [SQUARE_TEXTURE_COORDINATES_AT_64_BY_32 * 2])

    def test_a_negative_mapping_size_divides_as_a_signed_value(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        self.assertEqual(chunk_texture_coordinates(model, MaterialMappingSize(-64, 32)),
                         [[[1.0, -2.0], [-0.5625, -2.0], [-0.5625, 1.125], [1.0, 1.125]]])

    def test_a_material_without_a_mapping_size_writes_no_texture_coordinates(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        self.assertEqual(chunk_texture_coordinates(model, None), [None])

    def test_the_mean_rounds_by_adding_one_half_then_taking_the_floor(self):
        self.assertEqual([round_half_up_by_floor(value) for value in (0.78125, 1.5625, 0.5, -0.5, -0.78125, -1.5625, 2.4999)],
                         [1, 2, 1, 0, -1, -2, 2])


if __name__ == '__main__':
    unittest.main()
