from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import ClassDefaultError
from native_catalog.ue2 import FormatError
from native_store.gap_rows import load_gap_reason_patterns
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from support.lighting_actor_fixture import (ENVIRONMENT_LIGHTS, LIGHT_CLASS, LIGHTING_CLASS_DEFAULTS, SCENE_LIGHTS, SECTOR_LIGHTS,
                                            SECTOR_SHADOW_MAPS, read_synthetic_chain, synthetic_actor_rows, synthetic_lighting_package)
from support.lightmap_tail_fixture import (build_lightmap_tail, lightmap_model_and_package, lightmap_node, page_mip_bytes, render_section_bytes)
from support.water_volume_fixture import (PHYSICS_VOLUME_CLASS, SYNTHETIC_CHUNK_ID, WATER_VOLUME_CLASS, synthetic_volume_actor, synthetic_volume_context,
                                          synthetic_volume_map)
from world.collision_step import volume_records
from world.bsp_lightmaps import LIGHTMAP_ATLAS_EDGE, NO_LIGHTMAP, node_lightmap_texture, read_bsp_lightmaps
from world.tile_step_registry import TILE_STEP_NAMES
from world.light_actors import ClassChains, LightingActor, read_lighting_actors, read_static_mesh_light_lists
from world.lighting_payload import bsp_lightmap_arrays, static_mesh_light_list_arrays, terrain_lighting_arrays, typed_payload_byte_count
from world.lighting_step import (APPLIED_LIGHTING_RULES, LIGHTING_STEP_ALGORITHM_VERSION, LIGHTING_STEP_NAME, class_chain_unresolved_reasons,
                                 load_lighting_rules, water_volume_links)
from world.terrain_lighting import read_terrain_sector_lighting
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


def field_rows(actor):
    return [(field.field, field.value, field.provenance) for field in actor.fields]


class LightingActorTests(unittest.TestCase):
    def setUp(self):
        self.package = synthetic_lighting_package()
        self.class_chains = ClassChains(LIGHTING_CLASS_DEFAULTS, read_synthetic_chain)
        self.model = build_synthetic_level_model([synthetic_polygon(square_points(-64, -64, 128))])

    def test_light_and_fog_actors_keep_every_declared_field_with_its_provenance_and_level_brightness_as_declared(self):
        lights, fog_infos, level_infos, water_volumes, unresolved_classes = read_lighting_actors(self.package, self.model, synthetic_actor_rows(),
                                                                                                 self.class_chains)
        self.assertEqual((water_volumes, unresolved_classes), ((), ()))
        self.assertEqual(field_rows(lights[0]), [('LightType', 1, 'class-default'), ('LightEffect', None, 'ue-zero'),
                                                 ('LightBrightness', 56.0, 'authored'), ('Location', None, 'ue-zero'),
                                                 ('Rotation', None, 'ue-zero'), ('bDynamicLight', None, 'ue-zero'), ('bDirectional', None, 'ue-zero')])
        self.assertEqual(field_rows(fog_infos[0]), [('AffectRange', None, 'ue-zero'), ('FogRange1', None, 'ue-zero'), ('Location', None, 'ue-zero')])
        self.assertEqual(field_rows(level_infos[0]), [('Brightness', 1.0, 'class-default')])
        self.assertEqual(lights[0].to_record()['fields'][2], {'field': 'LightBrightness', 'value': 56.0, 'provenance': 'authored',
                                                               'declaringClass': 'Engine.Light'})
        self.assertIsInstance(lights[0].zone, int)

    def test_a_static_mesh_light_list_keeps_its_light_indices_and_visibility_bits_in_source_order(self):
        light_lists = read_static_mesh_light_lists(self.package, synthetic_actor_rows())
        self.assertEqual([(entry.light_reference, entry.visibility_bits, entry.applied) for entry in light_lists[0].scene_lights], list(SCENE_LIGHTS))
        self.assertEqual([(entry.light_reference, entry.visibility_bits, entry.applied) for entry in light_lists[0].environment_lights],
                         list(ENVIRONMENT_LIGHTS))
        named = arrays_by_name(static_mesh_light_list_arrays(light_lists))
        self.assertEqual((named['SMLL.actorExportIndex'].values, named['SMLL.instanceExportIndex'].values), ((9,), (4,)))
        self.assertEqual((named['SMSC.light'].values, bytes(named['SMSC.bits'].values)), ((1, 2), b'\x05\x0a\x01'))
        self.assertEqual((named['SMSC.bitStart'].values, named['SMEN.hour'].values), ((0, 1, 3), (12.0,)))

    def test_terrain_sector_shadow_maps_and_light_bits_keep_their_stored_bytes(self):
        sector = read_terrain_sector_lighting(self.package, 5)
        self.assertEqual([(light.light_reference, light.visibility_bits) for light in sector.lights], list(SECTOR_LIGHTS))
        self.assertEqual(sector.shadow_maps, SECTOR_SHADOW_MAPS)
        named = arrays_by_name(terrain_lighting_arrays([sector]))
        self.assertEqual(bytes(named['TSHM.bytes'].values), b''.join(SECTOR_SHADOW_MAPS))
        self.assertEqual((named['TSHM.hour'].values, named['TSEC.shadowMapStart'].values), ((6.0, 18.0), (0, 2)))

    def test_an_export_that_is_not_a_terrain_sector_is_refused(self):
        with self.assertRaisesRegex(FormatError, 'not a terrain sector'):
            read_terrain_sector_lighting(self.package, 4)

    def collision_volumes_of(self, actors):
        package, level, rectangles = synthetic_volume_map()
        _, records = volume_records(synthetic_volume_context(), package, level, actors, rectangles)
        return {'volumes': records}

    def water_volume_actors(self, export_indices):
        return [LightingActor(index, f'00_00.WaterVolume{index}', 'GamePlay.WaterVolume', WATER_VOLUME_CLASS, 1, ()) for index in export_indices]

    def test_a_water_volume_the_collision_step_admits_links_to_its_vols_entry_and_writes_no_unlinked_row(self):
        collision = self.collision_volumes_of([synthetic_volume_actor(WATER_VOLUME_CLASS, 7), synthetic_volume_actor(PHYSICS_VOLUME_CLASS, 9)])
        links, reasons = water_volume_links(self.water_volume_actors([7]), collision)
        self.assertEqual([(link['exportIndex'], link['zone'], link['volsChunkId'], link['volsDecision']) for link in links],
                         [(7, 1, SYNTHETIC_CHUNK_ID, 'declared-none')])
        self.assertEqual(reasons, [])

    def test_a_water_volume_missing_from_the_collision_volumes_is_a_named_gap(self):
        collision = self.collision_volumes_of([synthetic_volume_actor(WATER_VOLUME_CLASS, 7)])
        links, reasons = water_volume_links(self.water_volume_actors([7, 8]), collision)
        self.assertEqual([(link['exportIndex'], link['volsChunkId']) for link in links], [(7, SYNTHETIC_CHUNK_ID), (8, None)])
        self.assertEqual(reasons, ['lighting-water-volume-unlinked:GamePlay.WaterVolume'])

    def test_an_actor_whose_class_chain_cannot_be_read_stays_a_named_gap_instead_of_vanishing(self):
        def read_chain_refusing_lights(class_name):
            if class_name == LIGHT_CLASS:
                raise ClassDefaultError(f'decompiled class {class_name} has unparsed default properties')
            return read_synthetic_chain(class_name)
        chains = ClassChains(LIGHTING_CLASS_DEFAULTS, read_chain_refusing_lights)
        actors = read_lighting_actors(self.package, self.model, synthetic_actor_rows(), chains)
        self.assertEqual((actors.lights, len(actors.fog_infos), len(actors.level_infos)), ((), 1, 1))
        self.assertEqual(actors.unresolved_classes, (LIGHT_CLASS,))
        self.assertEqual(class_chain_unresolved_reasons(actors.unresolved_classes), ['lighting-class-chain-unresolved:Engine.Light'])

    def test_a_class_chain_matches_its_base_class_without_regard_to_case(self):
        chains = ClassChains(LIGHTING_CLASS_DEFAULTS, lambda class_name: [{'identity': {'object': 'GamePlay.WaterVolume'}, 'declaredFields': []}])
        self.assertTrue(chains.is_subclass('Gameplay.WaterVolume', 'Gameplay.WaterVolume'))


class LightingRegistrationTests(unittest.TestCase):
    def test_the_step_kind_and_reasons_are_registered(self):
        self.assertIn(LIGHTING_STEP_NAME, TILE_STEP_NAMES)
        self.assertEqual(LIGHTING_STEP_ALGORITHM_VERSION, 3)
        self.assertIn('lighting', load_tile_manifest_vocabulary().resource_kinds)
        patterns = load_gap_reason_patterns()
        for reason in ('lighting-lightmap-index-invalid:<index>', 'lighting-payload-too-large', 'environment-program-unresolved:<file>',
                       'lighting-water-volume-unlinked:<class>', 'lighting-class-chain-unresolved:<class>'):
            self.assertIn(reason, patterns)

    def test_every_rule_row_is_sourced_with_unconfirmed_or_stronger_status_and_every_applied_rule_has_a_row(self):
        rows = load_lighting_rules()['rows']
        for row in rows:
            with self.subTest(row['id']):
                self.assertEqual(set(row), RULE_FIELDS)
                self.assertTrue(row['provenance'])
                self.assertIn(row['status'], SHARED_STATUSES - {'unknown'})
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
