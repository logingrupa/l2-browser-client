import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.native_material_program_pins import NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD
from native_store.pinned_store_verification import verify_pinned_store_files
from native_store.tile_manifest_validation import validate_tile_chunk_manifest
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from synthetic_class_scripts import scratch_work_root
from test_material_program_images import synthetic_png_bytes
from test_tile_manifest_step import synthetic_tile
from world.bsp_chunk_geometry import (BspPolyFlags, BspSurfaceMaterial, assign_nodes_to_chunks, build_chunk_sections, chunk_bsp_glb,
                                      drawn_node_indices, load_bsp_poly_flags)
from world.bsp_material_mapping_size import MaterialMappingSize
from world.bsp_step import BSP_STEP_ALGORITHM_VERSION, BspGapRows, chunk_grid_nodes, drawable_chunk_nodes, sealed_bsp_chunks
from world.level_model import LevelModelLayoutError, LevelModelRangeError, read_level_model, require_level_model_ranges
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement_plan import ChunkRectangle
from world.native_material_listings import NativeMaterialListingError
from world.tile_manifest_step import build_tile_chunk_manifest, tile_store_files

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
    return BspSurfaceMaterial(identity, synthetic_png_bytes(), MaterialMappingSize(64, 32), translucent, None)


def glb_document(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    return json.loads(glb[20:20 + json_length])


def two_square_model(**second):
    first = synthetic_polygon(square_points(0, 0, 100))
    other = synthetic_polygon(square_points(200, 0, 100), **second)
    return build_synthetic_level_model([first, other], zones=(synthetic_zone(), synthetic_zone(7), synthetic_zone(9)))


class LevelModelTests(unittest.TestCase):
    def test_a_package_outside_the_vendored_layout_is_a_gap_ready_refusal(self):
        for summary, reason in (({'version': 111, 'licenseeVersion': 28}, 'map-version-unsupported:111'),
                                ({'version': 123, 'licenseeVersion': 24}, 'map-licensee-unsupported:123/24')):
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

    def test_a_section_never_mixes_unlit_lightmap_texture_or_native_render_section(self):
        cases = ({'surface_flags': 0x00400000}, {'light_map': 3}, {'section': 1})
        for second in cases:
            model = two_square_model(**second)
            sections = build_chunk_sections(model, [0, 1], [MATERIAL, MATERIAL], FLAGS, {3: 4})
            self.assertEqual(len(sections), 2, second)
        same = build_chunk_sections(two_square_model(zones=(1, 2)), [0, 1], [MATERIAL, MATERIAL], FLAGS, {})
        self.assertEqual([section.nodes for section in same], [[0, 1]])
        unresolved = build_chunk_sections(two_square_model(light_map=3), [0, 1], [MATERIAL, MATERIAL], FLAGS, {})
        self.assertEqual([section.key.lightmap for section in unresolved], [-1, None])

    def test_every_section_record_names_its_native_render_section(self):
        model = two_square_model(section=1)
        sections = build_chunk_sections(model, [0, 1], [MATERIAL, MATERIAL], FLAGS, {})
        _, section_records, _, _ = chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: textured(MATERIAL)})
        self.assertEqual([record['nativeRenderSection'] for record in section_records], [0, 1])
        self.assertTrue(all('outdoor' not in record for record in section_records))

    def test_sections_order_by_casefold_material_then_nodes_by_index(self):
        model = two_square_model()
        sections = build_chunk_sections(model, [1, 0], [MATERIAL, OTHER_MATERIAL], FLAGS, {})
        self.assertEqual([(section.key.material, section.nodes) for section in sections], [(OTHER_MATERIAL, [1]), (MATERIAL, [0])])

    def test_node_ranges_cover_every_triangle_once_and_stay_contiguous(self):
        polygons = [synthetic_polygon(square_points(0, 0, 100)), synthetic_polygon([(200, 0, 0), (300, 0, 0), (350, 50, 0), (300, 100, 0), (200, 100, 0)]),
                    synthetic_polygon(square_points(400, 0, 100), surface_flags=0x00400000)]
        model = build_synthetic_level_model(polygons)
        sections = build_chunk_sections(model, [0, 1, 2], [MATERIAL] * 3, FLAGS, {})
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
        sections = build_chunk_sections(model, [0], [MATERIAL], FLAGS, {})
        glb, _, _, _ = chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: BspSurfaceMaterial(MATERIAL, None, None, False, None)})
        document = glb_document(glb)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])
        self.assertEqual(document['materials'][0]['extras']['unboundSourceMaterial'], MATERIAL)
        self.assertNotIn('TEXCOORD_0', document['meshes'][0]['primitives'][0]['attributes'])
        self.assertNotIn('images', document)

    def test_a_baked_material_without_a_mapping_size_is_a_magenta_diagnostic_without_image_or_program(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        sections = build_chunk_sections(model, [0], [MATERIAL], FLAGS, {})
        program_pin = {'directory': f'native-materials/{"a" * 64}', 'programSha256': 'a' * 64}
        unmapped = BspSurfaceMaterial(MATERIAL, synthetic_png_bytes(), None, False, program_pin)
        document = glb_document(chunk_bsp_glb(model, 'chunk-0-0', sections, {MATERIAL: unmapped})[0])
        material = document['materials'][0]
        self.assertEqual(material['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])
        self.assertNotIn('baseColorTexture', material['pbrMetallicRoughness'])
        self.assertEqual((material['extras']['unboundSourceMaterial'], material['extras'][NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD]), (MATERIAL, None))
        self.assertNotIn('TEXCOORD_0', document['meshes'][0]['primitives'][0]['attributes'])
        self.assertNotIn('images', document)
        self.assertNotIn('textures', document)

    def test_an_unbaked_material_with_a_mapping_size_still_writes_its_texture_coordinates(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100))])
        sections = build_chunk_sections(model, [0], [MATERIAL], FLAGS, {})
        glb, _, _, _ = chunk_bsp_glb(model, 'chunk-0-0', sections,
                                     {MATERIAL: BspSurfaceMaterial(MATERIAL, None, MaterialMappingSize(64, 32), False, None)})
        document = glb_document(glb)
        attributes = document['meshes'][0]['primitives'][0]['attributes']
        self.assertEqual(document['accessors'][attributes['TEXCOORD_0']]['count'], 4)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])
        self.assertNotIn('images', document)


class BspNodeGapRowTests(unittest.TestCase):
    package = SimpleNamespace(object_name=lambda reference: {2: '00_00.Brush7', 3: '00_00.Brush9'}[reference])

    def gaps(self):
        return BspGapRows(TILE_ID, SOURCE_IDENTITY, EVIDENCE)

    def test_a_node_outside_every_chunk_rectangle_is_a_gap_row_naming_its_brush_actor(self):
        model = build_synthetic_level_model([synthetic_polygon(square_points(100, 0, 10)), synthetic_polygon(square_points(5000, 0, 10), actor=3)])
        gaps = self.gaps()
        self.assertEqual(chunk_grid_nodes(model, self.package, [0, 1], RECTANGLES, gaps), {'chunk-0-0': [0], 'chunk-1-0': []})
        self.assertEqual([(row['status'], row['reason'], row['sourceIdentity']) for row in gaps.rows()],
                         [('gap', 'bsp-node-outside-chunk-grid', {**SOURCE_IDENTITY, 'object': '00_00.Brush9'})])

    def test_a_reversed_or_edge_on_winding_drops_the_node_with_a_failed_row_naming_its_brush_actor(self):
        polygons = [synthetic_polygon(square_points(0, 0, 10)), synthetic_polygon(square_points(20, 0, 10), actor=3),
                    synthetic_polygon(square_points(40, 0, 10))]
        model = build_synthetic_level_model(polygons)
        model.nodes[1].plane = tuple(-component for component in model.nodes[1].plane)
        model.nodes[2].plane = (1.0, 0.0, 0.0, 0.0)
        gaps = self.gaps()
        self.assertEqual(drawable_chunk_nodes(model, self.package, {'chunk-0-0': [0, 1, 2]}, gaps), {'chunk-0-0': [0]})
        self.assertEqual([(row['status'], row['reason'], row['sourceIdentity']) for row in gaps.rows()],
                         [('failed', 'decode-failed:BspPolygonError:node 2 polygon winding is reversed or degenerate against its stored plane',
                           {**SOURCE_IDENTITY, 'object': '00_00.Brush7'}),
                          ('failed', 'decode-failed:BspPolygonError:node 1 polygon winding is reversed or degenerate against its stored plane',
                           {**SOURCE_IDENTITY, 'object': '00_00.Brush9'})])


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
        self.assertEqual(BSP_STEP_ALGORITHM_VERSION, 7)


def material_file(relative, payload):
    return {'path': relative, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}


class SurfaceMaterialsResourceTests(unittest.TestCase):
    def setUp(self):
        self.store_root = scratch_work_root(self, 'surface-materials-store-') / 'l2'
        program_sha256 = 'a' * 64
        graph = json.dumps({'package': {'file': 'SyntheticMaterials.utx', 'sha256': 'b' * 64}}).encode()
        self.payloads = {f'native-materials/{program_sha256}/graph.json': graph,
                         f'native-materials/{program_sha256}/program.json': b'{"kind": "ue2-material-program"}',
                         f'native-materials/textures/{"c" * 64}/texture.png': synthetic_png_bytes()}
        for relative, payload in self.payloads.items():
            (self.store_root / relative).parent.mkdir(parents=True, exist_ok=True)
            (self.store_root / relative).write_bytes(payload)
        self.records = {relative: material_file(relative, payload) for relative, payload in self.payloads.items()}
        self.plan, self.terrain_records, self.terrain_glbs = synthetic_tile(TILE_ID, 1, 1)

    def tile_files(self, bsp_files):
        bsp = {'chunks': {'chunk-0-0': {'resource': None, 'sha256': None, 'gapRows': []}}, 'gapRows': [], 'materialFiles': bsp_files}
        return tile_store_files(TILE_ID, SOURCE_IDENTITY, self.plan, self.terrain_records, self.terrain_glbs, EVIDENCE, bsp=bsp)

    def test_the_tile_manifest_pins_one_listing_the_store_walk_follows_to_every_material_file_of_its_bsp(self):
        paths = sorted(self.records)
        files, record = self.tile_files([self.records[path] for path in paths])
        tile = json.loads(files[record['manifest'].removeprefix('/l2/')])
        [resource] = [resource for resource in tile['resources'] if resource['kind'] == 'surface-materials']
        listing_payload = files[resource['manifest'].removeprefix('/l2/')]
        listing_sha256 = hashlib.sha256(listing_payload).hexdigest()
        self.assertEqual((resource['manifest'], resource['manifestSha256'], resource['manifestBytes']),
                         (f'/l2/native-materials/surface-materials-{listing_sha256}.json', listing_sha256, len(listing_payload)))
        self.assertEqual(json.loads(listing_payload)['files'],
                         {path.removeprefix('native-materials/'): {'sha256': self.records[path]['sha256'], 'bytes': self.records[path]['bytes']}
                          for path in paths})
        for relative, payload in files.items():
            (self.store_root / relative).parent.mkdir(parents=True, exist_ok=True)
            (self.store_root / relative).write_bytes(payload)
        verified = verify_pinned_store_files(self.store_root, {'schemaVersion': 1, 'models': [], 'tiles': [record]}, 1)
        self.assertTrue({path.casefold() for path in self.payloads} <= set(verified))

    def test_a_tile_without_material_files_pins_no_listing(self):
        files, record = self.tile_files([])
        tile = json.loads(files[record['manifest'].removeprefix('/l2/')])
        self.assertNotIn('surface-materials', [resource['kind'] for resource in tile['resources']])

    def test_a_material_file_named_with_two_pins_is_refused(self):
        path = sorted(self.records)[0]
        with self.assertRaisesRegex(NativeMaterialListingError, 'two different pins'):
            self.tile_files([self.records[path], {**self.records[path], 'bytes': 1}])


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
