from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_store.gap_rows import load_gap_reason_patterns
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.lightmap_tail_fixture import (build_lightmap_tail, lightmap_model_and_package, lightmap_node, page_mip_bytes, render_section_bytes)
from world.bsp_lightmaps import LIGHTMAP_ATLAS_EDGE, NO_LIGHTMAP, node_lightmap_texture, read_bsp_lightmaps
from world.convert_tile import TILE_STEP_NAMES
from world.lighting_payload import bsp_lightmap_arrays, typed_payload_byte_count
from world.lighting_step import APPLIED_LIGHTING_RULES, LIGHTING_STEP_ALGORITHM_VERSION, LIGHTING_STEP_NAME, load_lighting_rules
from world.typed_payload import typed_payload_asset

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SHARED_STATUSES = {'ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown'}
RULE_FIELDS = {'id', 'value', 'provenance', 'status', 'interludeEvidence', 'runtimeDefault'}
METADATA = {'sourceSha256': '0' * 64, 'converterVersion': 'lighting_step.py:1'}
SQUARE_UVS = ((0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25))


def node_range(node, first_index):
    return {'chunk': 0, 'node': node, 'primitive': 0, 'firstIndex': first_index, 'indexCount': 6}


def three_surface_lightmaps(section_texture=0):
    vertex_uvs = [(u + 0.25 * node, v) for node in range(3) for u, v in SQUARE_UVS]
    tail = build_lightmap_tail([render_section_bytes(vertex_uvs, 3, section_texture)],
                               [(surface, (128 * surface, 0, 128, 128)) for surface in range(3)],
                               [([0, 1, 2], [page_mip_bytes(11), page_mip_bytes(97)])])
    nodes = [lightmap_node(node, 0, 4 * node, 4) for node in range(3)]
    model, package = lightmap_model_and_package(tail, nodes, 3)
    return package, model, vertex_uvs


def arrays_by_name(arrays):
    return {typed_array.name: typed_array for typed_array in arrays}


class BspLightmapPayloadTests(unittest.TestCase):
    def test_two_pages_keep_their_texels_and_hours_and_every_node_range_gets_its_uvs(self):
        package, model, vertex_uvs = three_surface_lightmaps()
        lightmaps = read_bsp_lightmaps(package, model)
        arrays, reasons, counts = bsp_lightmap_arrays(package, lightmaps, model, [node_range(node, 6 * node) for node in range(3)])
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, [])
        self.assertEqual(bytes(named['LMPG.texels'].values), b''.join(page_mip_bytes(11) + page_mip_bytes(97)))
        self.assertEqual(named['LMPG.texelStart'].values, (0, 131072, 163840, 294912, 327680))
        self.assertEqual((named['LMPG.hourStart'].values, named['LMPG.hourEnd'].values), ((0.0, 12.0), (12.0, 24.0)))
        self.assertEqual(named['LMRC.surface'].values, (0, 1, 2))
        self.assertEqual(named['LMNR.texture'].values, (0, 0, 0))
        self.assertEqual(named['LMNR.uvStart'].values, (0, 4, 8, 12))
        self.assertEqual(named['LMUV.uv'].values, tuple(value for uv in vertex_uvs for value in uv))
        self.assertEqual((counts['pages'], counts['litNodeRanges'], counts['uvs']), (2, 3, 12))
        asset = typed_payload_asset(arrays, METADATA)
        self.assertEqual(len(asset.payload_bytes), typed_payload_byte_count(arrays))
        texels = next(record for record in asset.asset_record['arrays'] if record['name'] == 'LMPG.texels')
        self.assertEqual(asset.payload_bytes[texels['byteOffset']:texels['byteOffset'] + 131072], page_mip_bytes(11)[0])

    def test_a_section_texture_past_the_page_list_is_a_named_gap_with_no_uvs(self):
        package, model, _ = three_surface_lightmaps(section_texture=5)
        lightmaps = read_bsp_lightmaps(package, model)
        arrays, reasons, counts = bsp_lightmap_arrays(package, lightmaps, model, [node_range(node, 6 * node) for node in range(3)])
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, ['lighting-lightmap-index-invalid:5'])
        self.assertEqual(named['LMNR.texture'].values, (NO_LIGHTMAP,) * 3)
        self.assertEqual((named['LMUV.uv'].values, counts['litNodeRanges']), ((), 0))

    def test_a_node_without_a_lightmap_keeps_none_and_a_record_past_the_list_is_named(self):
        package, model, _ = three_surface_lightmaps()
        lightmaps = read_bsp_lightmaps(package, model)
        self.assertEqual(node_lightmap_texture(lightmaps, lightmap_node(NO_LIGHTMAP, 0, 0, 4)), (NO_LIGHTMAP, None))
        self.assertEqual(node_lightmap_texture(lightmaps, lightmap_node(7, 0, 0, 4)), (None, 'lighting-lightmap-index-invalid:7'))

    def test_a_mip_whose_skip_position_disagrees_is_refused(self):
        package, model, _ = three_surface_lightmaps()
        damaged = bytearray(package.data)
        skip_position_offset = damaged.index(page_mip_bytes(11)[0]) - 4 - 3
        damaged[skip_position_offset] ^= 1
        package.data = bytes(damaged)
        with self.assertRaisesRegex(FormatError, 'skip position'):
            read_bsp_lightmaps(package, model)


class LightingRegistrationTests(unittest.TestCase):
    def test_the_step_kind_and_reasons_are_registered(self):
        self.assertIn(LIGHTING_STEP_NAME, TILE_STEP_NAMES)
        self.assertEqual(LIGHTING_STEP_ALGORITHM_VERSION, 1)
        self.assertIn('lighting', load_tile_manifest_vocabulary().resource_kinds)
        patterns = load_gap_reason_patterns()
        for reason in ('lighting-lightmap-index-invalid:<index>', 'lighting-payload-too-large', 'environment-program-unresolved:<file>'):
            self.assertIn(reason, patterns)

    def test_every_rule_row_is_sourced_with_a_shared_status_and_every_applied_rule_has_a_row(self):
        rows = load_lighting_rules()['rows']
        for row in rows:
            with self.subTest(row['id']):
                self.assertEqual(set(row), RULE_FIELDS)
                self.assertTrue(row['provenance'])
                self.assertIn(row['status'], SHARED_STATUSES)
        self.assertLessEqual(set(APPLIED_LIGHTING_RULES), {row['id'] for row in rows})


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class RealClientLightmapTests(unittest.TestCase):
    def test_every_lit_node_of_20_21_has_uvs_inside_its_record_rectangle(self):
        from world.level_model import read_level_model
        from world.lighting_payload import lightmap_node_ranges
        from world.raw_map_step import read_tile_map_lock_record
        from world.tile_chunk_plan import read_locked_map_package
        package = read_locked_map_package(REFERENCE_CLIENT, '20_21', read_tile_map_lock_record('20_21'))
        model = read_level_model(package).model
        lightmaps = read_bsp_lightmaps(package, model)
        self.assertEqual((len(lightmaps.sections), len(lightmaps.records), len(lightmaps.textures), len(lightmaps.pages)), (43, 1888, 9, 30))
        ranges, reasons = lightmap_node_ranges(package, lightmaps, model, [node_range(index, 0) for index in range(len(model.nodes))])
        self.assertEqual(reasons, [])
        outside = 0
        for lightmap_range in ranges:
            if not lightmap_range.uvs:
                continue
            x, y, width, height = lightmaps.records[lightmap_range.record].rectangle
            outside += sum(not (x - 0.75 <= u * LIGHTMAP_ATLAS_EDGE <= x + width + 0.75 and y - 0.75 <= v * LIGHTMAP_ATLAS_EDGE <= y + height + 0.75)
                           for u, v in lightmap_range.uvs)
        self.assertEqual(outside, 0)
        self.assertEqual(sum(len(item.uvs) for item in ranges), 18599)


if __name__ == '__main__':
    unittest.main()
