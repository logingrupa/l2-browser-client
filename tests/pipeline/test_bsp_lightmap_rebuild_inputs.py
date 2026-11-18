import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError, Reader
from support.lightmap_tail_fixture import (FIXTURE_PAGE_REVISION, build_lightmap_tail, lightmap_model_and_package, lightmap_node, lightmap_surface,
                                           page_mip_bytes, render_section_bytes, shadow_mask_bytes)
from world.bsp_lightmaps import ShadowMask, read_bsp_lightmaps, read_lightmap_record
from world.lightmap_rebuild_inputs import UNLISTED_SHADOW_LIGHT_INDEX, lightmap_rebuild_input_arrays
from world.typed_payload import typed_payload_asset

REFERENCE_CLIENT = Path('E:/Lineage2-client')
DB16_FIXTURES = ROOT / 'tests/fixtures/db16'
RECORD_FIXTURE_PATH = DB16_FIXTURES / 'lightmap-record-20_20-2.json'
CENSUS_FIXTURE_PATH = DB16_FIXTURES / 'lightmap-shadow-census.json'
METADATA = {'sourceSha256': '0' * 64, 'converterVersion': 'lighting_step.py:7'}
SQUARE_UVS = ((0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25))
FIRST_LIGHT_EXPORT, SECOND_LIGHT_EXPORT = 11, 12
FIRST_MASK_BITS, SECOND_MASK_BITS, UNEMITTED_MASK_BITS = bytes((0x0F, 0xF0)), bytes(range(1, 7)), bytes((0xAA,))
RECORD_SHADOW_MASKS = {0: (shadow_mask_bytes(FIRST_LIGHT_EXPORT, FIRST_MASK_BITS, 8, 2, 0, 1),
                           shadow_mask_bytes(SECOND_LIGHT_EXPORT, SECOND_MASK_BITS, 12, 3, 4, 5)),
                       2: (shadow_mask_bytes(FIRST_LIGHT_EXPORT, UNEMITTED_MASK_BITS, 3, 1, 2, 2),)}
RECORD_ZONES = (5, 6, 7)
SURFACES = (lightmap_surface((0.0, -1.0, 0.0, 3.0), 0x100), lightmap_surface((1.0, 0.0, 0.0, -2.0), 0), lightmap_surface((0.0, 0.0, 1.0, 9.0), 4))
MATCHING_PAGES, MISMATCHED_SECOND_PAGE = (FIXTURE_PAGE_REVISION, FIXTURE_PAGE_REVISION), (FIXTURE_PAGE_REVISION, FIXTURE_PAGE_REVISION - 1)
LIGHTS_BY_RECORD_ORDER = (SimpleNamespace(export_index=SECOND_LIGHT_EXPORT), SimpleNamespace(export_index=FIRST_LIGHT_EXPORT))


def two_texture_lightmaps(first_texture_pages, second_texture_pages, record_shadow_masks=RECORD_SHADOW_MASKS):
    vertex_uvs = [(u + 0.25 * node, v) for node in range(3) for u, v in SQUARE_UVS]
    tail = build_lightmap_tail([render_section_bytes(vertex_uvs, 3, 0)], [(surface, (128 * surface, 0, 128, 128)) for surface in range(3)],
                               [([0, 1], [page_mip_bytes(11), page_mip_bytes(97)]), ([2], [page_mip_bytes(5), page_mip_bytes(55)])],
                               record_shadow_masks, RECORD_ZONES, (first_texture_pages, second_texture_pages))
    model, package = lightmap_model_and_package(tail, [lightmap_node(node, 0, 4 * node, 4) for node in range(3)], 3, SURFACES)
    return read_bsp_lightmaps(package, model), model


def arrays_by_name(arrays):
    return {typed_array.name: typed_array.values for typed_array in arrays}


def load_fixture(path):
    return json.loads(path.read_text(encoding='utf-8'))


class ShadowMaskParseTests(unittest.TestCase):
    def test_record_2_of_20_20_reads_its_four_shadow_masks_as_the_rea_decode(self):
        fixture = load_fixture(RECORD_FIXTURE_PATH)
        record_bytes = bytes.fromhex(fixture['decodedRecordBytesHex'])
        reader = Reader(record_bytes, 0, len(record_bytes))
        record = read_lightmap_record(reader, fixture['recordIndex'], fixture['surfaceCount'])
        self.assertEqual(reader.position, len(record_bytes))
        expected = fixture['record']
        self.assertEqual((record.texture_index, record.surface, record.zone_index, list(record.rectangle), list(record.projection),
                          record.level_reference, record.revision),
                         (expected['textureIndex'], expected['surface'], expected['zone'], expected['rectangle'], expected['projection'],
                          expected['levelReference'], expected['revision']))
        self.assertEqual([(mask.light_reference, mask.bits.hex(), len(mask.bits),
                           [mask.width, mask.height, mask.row_bytes, mask.minimum_x, mask.minimum_y, mask.maximum_x, mask.maximum_y])
                          for mask in record.shadow_masks],
                         [(shadow['object'], shadow['bitsHex'], shadow['size'], shadow['fields']) for shadow in fixture['shadows']])

    def test_synthetic_masks_keep_their_light_reference_bits_and_trailer(self):
        lightmaps, _ = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        self.assertEqual(lightmaps.records[0].shadow_masks, (ShadowMask(FIRST_LIGHT_EXPORT, FIRST_MASK_BITS, 8, 2, 1, 0, 1, 7, 2),
                                                             ShadowMask(SECOND_LIGHT_EXPORT, SECOND_MASK_BITS, 12, 3, 2, 4, 5, 15, 7)))
        self.assertEqual((lightmaps.records[1].shadow_masks, len(lightmaps.records[2].shadow_masks)), ((), 1))
        self.assertTrue(all(texture.pages_share_records for texture in lightmaps.textures))

    def test_a_mask_whose_maximum_x_disagrees_with_its_width_is_refused(self):
        damaged_mask = shadow_mask_bytes(FIRST_LIGHT_EXPORT, FIRST_MASK_BITS, 8, 2, 0, 1)[:-8] + struct.pack('<2i', 8, 2)
        with self.assertRaisesRegex(FormatError, 'lightmap record 0 mask 0 does not fit its 128x128 rectangle'):
            two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES, {0: (damaged_mask,)})


class RebuildInputEmissionTests(unittest.TestCase):
    def test_only_the_texture_with_a_mismatched_page_emits_its_shadow_masks(self):
        lightmaps, model = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        arrays, counts, reasons = lightmap_rebuild_input_arrays(lightmaps, model, LIGHTS_BY_RECORD_ORDER)
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, [])
        self.assertEqual(named['LMTX.rebuildInputs'], (1, 0))
        self.assertEqual(named['LMRC.shadowStart'], (0, 2, 2, 2))
        self.assertEqual(named['LMSH.light'], (1, 0))
        self.assertEqual((named['LMSH.width'], named['LMSH.height'], named['LMSH.rowBytes']), ((8, 12), (2, 3), (1, 2)))
        self.assertEqual((named['LMSH.minimumX'], named['LMSH.minimumY'], named['LMSH.maximumX'], named['LMSH.maximumY']),
                         ((0, 4), (1, 5), (7, 15), (2, 7)))
        self.assertEqual((named['LMSH.byteStart'], bytes(named['LMSH.bits'])), ((0, 2, 8), FIRST_MASK_BITS + SECOND_MASK_BITS))
        self.assertEqual(counts, {'rebuildTextures': 1, 'shadows': 2, 'shadowLights': 2, 'shadowBytes': 8})

    def test_every_record_carries_its_zone_surface_normal_and_surface_poly_flags(self):
        lightmaps, model = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        named = arrays_by_name(lightmap_rebuild_input_arrays(lightmaps, model, LIGHTS_BY_RECORD_ORDER)[0])
        self.assertEqual(named['LMRC.zone'], RECORD_ZONES)
        self.assertEqual(named['LMRC.surfaceNormal'], (0.0, -1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0))
        self.assertEqual(named['LMRC.surfacePolyFlags'], (0x100, 0, 4))

    def test_textures_whose_pages_all_match_emit_empty_shadow_ranges(self):
        lightmaps, model = two_texture_lightmaps(MATCHING_PAGES, MATCHING_PAGES)
        arrays, counts, reasons = lightmap_rebuild_input_arrays(lightmaps, model, ())
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, [])
        self.assertEqual((named['LMTX.rebuildInputs'], named['LMRC.shadowStart'], named['LMSH.byteStart']), ((0, 0), (0, 0, 0, 0), (0,)))
        self.assertTrue(all(named[name] == () for name in named if name.startswith('LMSH.') and name != 'LMSH.byteStart'))
        self.assertEqual((len(named['LMRC.zone']), len(named['LMRC.surfaceNormal']), len(named['LMRC.surfacePolyFlags'])), (3, 9, 3))
        self.assertEqual(counts, {'rebuildTextures': 0, 'shadows': 0, 'shadowLights': 0, 'shadowBytes': 0})

    def test_the_arrays_write_as_one_typed_payload(self):
        lightmaps, model = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        arrays, _, _ = lightmap_rebuild_input_arrays(lightmaps, model, LIGHTS_BY_RECORD_ORDER)
        records = {record['name']: record for record in typed_payload_asset(arrays, METADATA).asset_record['arrays']}
        self.assertEqual({name: (records[name]['type'], records[name]['count']) for name in ('LMTX.rebuildInputs', 'LMRC.surfaceNormal', 'LMSH.bits')},
                         {'LMTX.rebuildInputs': ('uint8', 2), 'LMRC.surfaceNormal': ('float32', 9), 'LMSH.bits': ('uint8', 8)})

    def test_a_shadow_light_missing_from_the_light_records_stays_a_named_gap(self):
        lightmaps, model = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        arrays, _, reasons = lightmap_rebuild_input_arrays(lightmaps, model, LIGHTS_BY_RECORD_ORDER[1:])
        self.assertEqual(arrays_by_name(arrays)['LMSH.light'], (0, UNLISTED_SHADOW_LIGHT_INDEX))
        self.assertEqual(reasons, [f'bsp-rebuild-shadow-light-unlisted:{SECOND_LIGHT_EXPORT}'])

    def test_a_rebuild_texture_whose_pages_list_different_records_is_refused(self):
        lightmaps, model = two_texture_lightmaps(MISMATCHED_SECOND_PAGE, MATCHING_PAGES)
        first_texture, second_texture = lightmaps.textures
        split_lightmaps = lightmaps._replace(textures=(first_texture._replace(pages_share_records=False), second_texture))
        with self.assertRaisesRegex(FormatError, 'lightmap texture 0 needs rebuild inputs, but its pages list different records'):
            lightmap_rebuild_input_arrays(split_lightmaps, model, LIGHTS_BY_RECORD_ORDER)


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class RealClientRebuildInputTests(unittest.TestCase):
    def test_20_20_and_20_10_shadow_masks_match_the_db16_census(self):
        from world.level_model import read_level_model
        from world.raw_map_step import read_tile_map_lock_record
        from world.tile_chunk_plan import read_locked_map_package
        for census in load_fixture(CENSUS_FIXTURE_PATH)['maps']:
            with self.subTest(tile=census['tileId']):
                lock_record = read_tile_map_lock_record(census['tileId'])
                self.assertEqual(lock_record['eSha256'], census['mapSource']['fileSha256'])
                package = read_locked_map_package(REFERENCE_CLIENT, census['tileId'], lock_record)
                model = read_level_model(package).model
                lightmaps = read_bsp_lightmaps(package, model)
                masks = [mask for record in lightmaps.records for mask in record.shadow_masks]
                light_references = sorted({mask.light_reference for mask in masks})
                self.assertEqual((len(lightmaps.records), len(masks), len(light_references), sum(len(mask.bits) for mask in masks)),
                                 (census['records'], census['shadows'], census['shadowLights'], census['shadowBytes']))
                self.assertEqual([{'revision': page.revision, 'compressedRevision': page.compressed_revision} for page in lightmaps.pages],
                                 census['pages'])
                lights = [SimpleNamespace(export_index=reference) for reference in light_references]
                arrays, counts, reasons = lightmap_rebuild_input_arrays(lightmaps, model, lights)
                self.assertEqual(reasons, [])
                named = arrays_by_name(arrays)
                self.assertEqual(counts, {'rebuildTextures': 1, 'shadows': census['shadows'], 'shadowLights': census['shadowLights'],
                                          'shadowBytes': census['shadowBytes']})
                self.assertEqual((len(named['LMRC.shadowStart']), named['LMRC.shadowStart'][-1], named['LMSH.byteStart'][-1]),
                                 (census['records'] + 1, census['shadows'], census['shadowBytes']))


if __name__ == '__main__':
    unittest.main()
