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
from native_store.tile_manifest_validation import validate_tile_chunk_manifest
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from synthetic_class_scripts import scratch_work_root
from world import bsp_surface_materials
from world.bsp_chunk_geometry import (BspPolyFlags, BspSurfaceMaterial, assign_nodes_to_chunks, build_chunk_sections, chunk_bsp_glb,
                                      drawn_node_indices, load_bsp_poly_flags)
from world.bsp_step import BSP_STEP_ALGORITHM_VERSION, sealed_bsp_chunks
from world.bsp_surface_materials import convert_surface_material
from world.level_model import LevelModelLayoutError, LevelModelRangeError, read_level_model, require_level_model_ranges
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement_plan import ChunkRectangle
from world.tile_manifest_step import build_tile_chunk_manifest

TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic bsp tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/bsp/receipt.json'
FLAGS = BspPolyFlags(visual_skip_mask=0x1 | 0x80 | 0x04000000, unlit_mask=0x00400000)
MATERIAL = 'SyntheticTextures.Floor'
OTHER_MATERIAL = 'syntheticTextures.Alpha'
RECTANGLES = [ChunkRectangle('chunk-0-0', (0.0, 0.0), (1024.0, 1024.0)), ChunkRectangle('chunk-1-0', (1024.0, 0.0), (2048.0, 1024.0))]
REFERENCE_CLIENT = Path('E:/Lineage2-client')
ORACLE_PATH = ROOT / 'recipes/world/oracle/20_20/expected.json'
SERVED_STORE = ROOT / 'public' / 'l2'


def textured(identity, translucent=False):
    png = b'\x89PNG\r\n\x1a\n' + struct.pack('>I4sII', 13, b'IHDR', 64, 32) + bytes(5)
    return BspSurfaceMaterial(identity, png, 64, 32, translucent, None)


def glb_document(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    return json.loads(glb[20:20 + json_length])


def two_square_model(**second):
    first = synthetic_polygon(square_points(0, 0, 100))
    other = synthetic_polygon(square_points(200, 0, 100), **second)
    return build_synthetic_level_model([first, other], zones=(synthetic_zone(), synthetic_zone(7), synthetic_zone(9)))


class LevelModelTests(unittest.TestCase):
    def test_a_package_outside_the_vendored_layout_is_a_gap_ready_refusal(self):
        for summary, reason in (({'version': 118, 'licenseeVersion': 28}, 'map-version-unsupported:118'),
                                ({'version': 123, 'licenseeVersion': 25}, 'map-licensee-unsupported:123/25')):
            with self.assertRaises(LevelModelLayoutError) as caught:
                read_level_model(SimpleNamespace(summary=summary, filename='00_00.unr'))
            self.assertEqual(caught.exception.reason, reason)

    def test_range_checks_name_the_field_that_points_outside_its_array(self):
        hulls = [5, 1073741830, -1, 0, 0, 0, 0, 0, 0]
        valid = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10), collision_bound=0, render_bound=0)],
                                            leaf_hulls=hulls, model_bounds=[(0, 0, 0, 1, 1, 1, 1)])
        require_level_model_ranges(valid)
        cases = (('iRenderBound', {'render_bound': 1}, hulls), ('iCollisionBound', {'collision_bound': 9}, hulls),
                 ('LeafHulls', {'collision_bound': 0}, [5, 6, 7]), ('LeafHulls', {'collision_bound': 0}, [5, -1, 0, 0]))
        for field, overrides, leaf_hulls in cases:
            model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10), **overrides)], leaf_hulls=leaf_hulls,
                                                model_bounds=[(0, 0, 0, 1, 1, 1, 1)])
            with self.assertRaises(LevelModelRangeError) as caught:
                require_level_model_ranges(model)
            self.assertEqual(caught.exception.field, field)


class BspSectionTests(unittest.TestCase):
    def test_the_flag_recipe_rows_are_sourced_and_skip_exactly_the_pinned_skip_set(self):
        recipe = json.loads((ROOT / 'recipes/world/bsp-poly-flags.json').read_text(encoding='utf-8'))
        self.assertTrue(all('sourceLine' in row and 'collision' not in row for row in recipe['flags']))
        self.assertEqual(load_bsp_poly_flags(), FLAGS)

    def test_skip_bits_and_sky_zones_leave_the_visual_mesh(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 10)), synthetic_polygon(square_points(20, 0, 10), surface_flags=0x80),
                                             synthetic_polygon(square_points(40, 0, 10), zones=(2, 2)),
                                             synthetic_polygon(square_points(60, 0, 10), surface_flags=0x04000000 | 0x8),
                                             synthetic_polygon(square_points(80, 0, 10), surface_flags=0x08000000)])
        self.assertEqual(drawn_node_indices(model, FLAGS, frozenset({2})), [0, 4])

    def test_a_section_never_mixes_unlit_lightmap_texture_or_outdoor_class(self):
        cases = ({'surface_flags': 0x00400000}, {'light_map': 3}, {'zones': (1, 2)})
        for second in cases:
            model = two_square_model(**second)
            sections = build_chunk_sections(model, [0, 1], [MATERIAL, MATERIAL], FLAGS, {3: 4}, frozenset({0, 1}))
            self.assertEqual(len(sections), 2, second)
        same = build_chunk_sections(two_square_model(), [0, 1], [MATERIAL, MATERIAL], FLAGS, {}, frozenset({0}))
        self.assertEqual([section.nodes for section in same], [[0, 1]])
        unresolved = build_chunk_sections(two_square_model(light_map=3), [0, 1], [MATERIAL, MATERIAL], FLAGS, {}, frozenset())
        self.assertEqual([section.key.lightmap for section in unresolved], [-1, None])

    def test_sections_order_by_casefold_material_then_nodes_by_index(self):
        model = two_square_model()
        sections = build_chunk_sections(model, [1, 0], [MATERIAL, OTHER_MATERIAL], FLAGS, {}, frozenset())
        self.assertEqual([(section.key.material, section.nodes) for section in sections], [(OTHER_MATERIAL, [1]), (MATERIAL, [0])])

    def test_node_ranges_cover_every_triangle_once_and_stay_contiguous(self):
        polygons = [synthetic_polygon(square_points(0, 0, 100)), synthetic_polygon([(200, 0, 0), (300, 0, 0), (350, 50, 0), (300, 100, 0), (200, 100, 0)]),
                    synthetic_polygon(square_points(400, 0, 100), surface_flags=0x00400000)]
        model = build_synthetic_level_model(polygons)
        sections = build_chunk_sections(model, [0, 1, 2], [MATERIAL] * 3, FLAGS, {}, frozenset())
        glb, section_records, node_ranges, triangles = chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: textured(MATERIAL)})
        document = glb_document(glb)
        self.assertEqual((document['extras']['nativeBspSections'], document['extras']['nativeBspNodeRanges']), (section_records, node_ranges))
        self.assertEqual(sorted(entry['node'] for entry in node_ranges), [0, 1, 2])
        self.assertEqual(triangles, 2 + 3 + 2)
        for primitive, mesh in enumerate(document['meshes']):
            ranges = [entry for entry in node_ranges if entry['primitive'] == primitive]
            self.assertEqual([entry['firstIndex'] for entry in ranges], [sum(entry['indexCount'] for entry in ranges[:i]) for i in range(len(ranges))])
            self.assertEqual(sum(entry['indexCount'] for entry in ranges), document['accessors'][mesh['primitives'][0]['indices']]['count'])
        self.assertEqual(chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: textured(MATERIAL)})[0], glb)
        self.assertEqual(document['materials'][1]['extensions'], {'KHR_materials_unlit': {}})

    def test_a_border_node_is_drawn_by_exactly_one_chunk(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(1000, 0, 48)), synthetic_polygon(square_points(5000, 0, 10))])
        nodes_by_chunk, outside = assign_nodes_to_chunks(model, [0, 1], RECTANGLES)
        self.assertEqual((nodes_by_chunk, outside), ({'chunk-0-0': [], 'chunk-1-0': [0]}, [1]))

    def test_an_unconverted_material_is_a_magenta_diagnostic(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        sections = build_chunk_sections(model, [0], [MATERIAL], FLAGS, {}, frozenset())
        glb, _, _, _ = chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: BspSurfaceMaterial(MATERIAL, None, None, None, False, None)})
        document = glb_document(glb)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])
        self.assertEqual(document['materials'][0]['extras']['unboundSourceMaterial'], MATERIAL)
        self.assertNotIn('TEXCOORD_0', document['meshes'][0]['primitives'][0]['attributes'])
        self.assertNotIn('images', document)


class SurfaceMaterialTests(unittest.TestCase):
    def test_an_unported_material_class_gets_its_gap_reason_and_no_substitute_texture(self):
        package = build_synthetic_material_package('unported-classes-and-features.json')
        map_sources = SimpleNamespace(paths={'syntheticunported': ['textures/SyntheticUnported.utx']}, get=lambda relative: package)
        converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-material-'),
                                    material_texture=lambda *arguments: self.fail('an unported root must not be textured'))
        store_root = scratch_work_root(self, 'bsp-store-')
        texture_declarations = [{'field': 'USize', 'declaredType': 'int', 'declaringClass': 'Engine.Texture', 'enumMembers': None,
                                 'classDefault': {'field': 'USize', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Engine.Texture'}}]
        with patch.object(bsp_surface_materials, 'read_material_class_defaults', return_value={'Engine.Texture': texture_declarations}):
            outcome = convert_surface_material('SyntheticUnported.TriggeredOscillator', map_sources, converter, store_root, None, store_root)
        self.assertIsNone(outcome.material.png)
        self.assertIn('material-class-unported:Engine.TexOscillatorTriggered', outcome.gap_reasons)
        self.assertTrue(outcome.material.program['directory'].startswith('native-materials/'))

    def test_a_missing_material_export_is_a_decode_failure(self):
        map_sources = SimpleNamespace(paths={}, get=lambda relative: None)
        outcome = convert_surface_material('Missing.Material', map_sources, None, None, None, None)
        self.assertEqual((outcome.material.png, outcome.gap_reasons), (None, ['decode-failed:FormatError:material package missing or ambiguous']))


class BspManifestTests(unittest.TestCase):
    def chunk_plan_entry(self):
        return {'chunkId': 'chunk-0-0', 'sectorRange': {'firstColumn': 0, 'lastColumn': 3, 'firstRow': 0, 'lastRow': 3},
                'sectorObjects': ['00_00.TerrainSector0']}

    def terrain_record(self):
        sha = 'b' * 64
        return {'chunkId': 'chunk-0-0', 'terrain': {'sha256': sha}, 'maskUvRule': 'extrapolated', 'gapRows': []}

    def test_the_chunk_bsp_field_holds_exactly_resource_and_sha256(self):
        sha = 'c' * 64
        bsp = {'chunks': {'chunk-0-0': {'resource': f'/l2/maps/{sha}/native-tile-chunk-bsp/bsp.glb', 'sha256': sha, 'gapRows': []}},
               'gapRows': []}
        manifest = build_tile_chunk_manifest(TILE_ID, self.terrain_record(), self.chunk_plan_entry(), SOURCE_IDENTITY, EVIDENCE, bsp=bsp)
        self.assertEqual(manifest['bsp'], {'resource': f'/l2/maps/{sha}/native-tile-chunk-bsp/bsp.glb', 'sha256': sha})
        self.assertNotIn('bsp', [row['step'] for row in manifest['gaps']])
        validate_tile_chunk_manifest(manifest)

    def test_a_chunk_without_nodes_has_no_bsp_and_a_named_gap(self):
        bsp = {'chunks': {'chunk-0-0': {'resource': None, 'sha256': None, 'gapRows': []}}, 'gapRows': []}
        manifest = build_tile_chunk_manifest(TILE_ID, self.terrain_record(), self.chunk_plan_entry(), SOURCE_IDENTITY, EVIDENCE, bsp=bsp)
        row = next(row for row in manifest['gaps'] if row['step'] == 'bsp')
        self.assertEqual((manifest['bsp'], row['status'], row['reason']), (None, 'gap', 'bsp-chunk-without-nodes'))

    def test_the_step_version_is_pinned(self):
        self.assertEqual(BSP_STEP_ALGORITHM_VERSION, 1)


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class OracleBrushSubsetTests(unittest.TestCase):
    def served_source(self, record):
        folder = SERVED_STORE / 'maps' / json.loads(ORACLE_PATH.read_text(encoding='utf-8'))['section']['manifestSha256'] / 'map-section-bsp'
        for path in sorted(folder.glob('*.json')) if folder.is_dir() else []:
            payload = path.read_bytes()
            if hashlib.sha256(payload).hexdigest() == record['sourceSha256']:
                return json.loads(payload)
        self.skipTest(f'the served store holds no source pinned by the oracle record {record["id"]}')

    def test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions(self):
        lock_record = read_tile_map_lock_record('20_20')
        _, product = sealed_bsp_chunks(ROOT, '20_20', lock_record)
        if product is None:
            self.skipTest('tile 20_20 has no sealed bsp unit; run convert_tile.py --map 20_20 --step bsp')
        from world.tile_chunk_plan import read_locked_map_package
        model = read_level_model(read_locked_map_package(REFERENCE_CLIENT, '20_20', lock_record)).model
        drawn = {entry['node'] for chunk in product['chunks'].values() for entry in chunk['nodeRanges']}
        checked = 0
        for record in json.loads(ORACLE_PATH.read_text(encoding='utf-8'))['section']['bsp']:
            for node_range in self.served_source(record)['nodeRanges']:
                node = model.nodes[node_range['node']]
                positions = [list(model.points[model.verts[node.i_vert_pool + offset][0]]) for offset in range(node.num_vertices)]
                self.assertIn(node_range['node'], drawn, record['id'])
                self.assertEqual(positions, node_range['nativePositions'], record['id'])
                checked += 1
        self.assertEqual(checked, 10 + 1 + 1 + 8)


if __name__ == '__main__':
    unittest.main()
