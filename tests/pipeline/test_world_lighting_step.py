import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import ClassDefaultError
from native_catalog.ue2 import FormatError
from native_store.gap_rows import load_gap_reason_patterns
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from support.lighting_actor_fixture import (ENVIRONMENT_LIGHTS, INSTANCE_COLOURS, LIGHT_CLASS, LIGHTING_CLASS_DEFAULTS,
                                            SCENE_LIGHTS, SECTOR_LIGHTS, SECTOR_SHADOW_MAPS, read_synthetic_chain, synthetic_actor_rows,
                                            synthetic_lighting_package)
from native_assets_lib.texture_source_reader import DXT1_FORMAT_ID
from support.lightmap_tail_fixture import (FIXTURE_COMPRESSED_REVISION, FIXTURE_PAGE_REVISION, FIXTURE_TEXTURE_FORMAT, build_lightmap_tail,
                                           lightmap_model_and_package, lightmap_node, lightmap_zone, page_mip_bytes, render_section_bytes)
from support.water_volume_fixture import (PHYSICS_VOLUME_CLASS, SYNTHETIC_CHUNK_ID, WATER_VOLUME_CLASS, synthetic_volume_actor, synthetic_volume_context,
                                          synthetic_volume_map)
from world.collision_step import volume_records
from world.bsp_lightmaps import LIGHTMAP_ATLAS_EDGE, NO_LIGHTMAP, node_lightmap_texture, read_bsp_lightmaps
from world.bsp_node_sun_affect import NOT_SUN_AFFECTED, SUN_AFFECT_UNRESOLVED, SUN_AFFECTED
from world.tile_step_registry import TILE_STEP_NAMES
from world.light_actors import ClassChains, LightingActor, read_lighting_actors, read_static_mesh_light_lists
from world.lighting_payload import bsp_lightmap_arrays, static_mesh_light_list_arrays, terrain_lighting_arrays, typed_payload_byte_count
from world.lighting_step import (APPLIED_LIGHTING_RULES, LIGHTING_STEP_ALGORITHM_VERSION, LIGHTING_STEP_NAME, class_chain_unresolved_reasons,
                                 lighting_unit, load_lighting_rules, static_mesh_light_list_sun_affect, water_volume_links)
from world.actor_field_values import ActorField
from world.raw_map_step import read_tile_map_lock_record
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.terrain_lighting import read_terrain_sector_lighting
from world.typed_payload import typed_payload_asset

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SHARED_STATUSES = {'ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown'}
RULE_FIELDS = {'id', 'value', 'provenance', 'status', 'interludeEvidence', 'runtimeDefault'}
METADATA = {'sourceSha256': '0' * 64, 'converterVersion': 'lighting_step.py:1'}
SQUARE_UVS = ((0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25))
DB7_EXPECTATIONS_PATH = ROOT / 'tests/fixtures/environment/hourly-lighting-db7-converter-expectations.json'
RM10_STATIC_FIXTURES_PATH = ROOT / 'tests/fixtures/environment/runtime-lighting-rm10-static-fixtures.json'
SUN_ZONES = (lightmap_zone(False), lightmap_zone(True))


def node_range(node, first_index):
    return {'chunk': 0, 'node': node, 'primitive': 0, 'firstIndex': first_index, 'indexCount': 6}


def three_surface_lightmaps(section_texture=0, front_zones=(0, 0, 0)):
    vertex_uvs = [(u + 0.25 * node, v) for node in range(3) for u, v in SQUARE_UVS]
    tail = build_lightmap_tail([render_section_bytes(vertex_uvs, 3, section_texture)],
                               [(surface, (128 * surface, 0, 128, 128)) for surface in range(3)],
                               [([0, 1, 2], [page_mip_bytes(11), page_mip_bytes(97)])])
    nodes = [lightmap_node(node, 0, 4 * node, 4, front_zone) for node, front_zone in enumerate(front_zones)]
    model, package = lightmap_model_and_package(tail, nodes, 3)
    return package, model, vertex_uvs


def arrays_by_name(arrays):
    return {typed_array.name: typed_array for typed_array in arrays}


class BspLightmapPayloadTests(unittest.TestCase):
    def test_two_pages_keep_their_texels_and_hours_and_every_node_range_gets_its_uvs(self):
        package, model, vertex_uvs = three_surface_lightmaps()
        lightmaps = read_bsp_lightmaps(package, model)
        arrays, reasons, counts = bsp_lightmap_arrays(package, lightmaps, model, [node_range(node, 6 * node) for node in range(3)], SUN_ZONES)
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, [])
        self.assertEqual((named['LMPG.revision'].values, named['LMPG.compressedRevision'].values), ((FIXTURE_PAGE_REVISION,) * 2,
                                                                                                    (FIXTURE_COMPRESSED_REVISION,) * 2))
        self.assertFalse({'LMPG.format', 'LMPG.width', 'LMPG.height'} & set(named))
        self.assertNotIn('LMSC.sunAffect', named)
        self.assertEqual((named['LMNR.sunAffect'].values, counts['sunAffectedNodeRanges']), ((0, 0, 0), 0))
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
        arrays, reasons, counts = bsp_lightmap_arrays(package, lightmaps, model, [node_range(node, 6 * node) for node in range(3)], SUN_ZONES)
        named = arrays_by_name(arrays)
        self.assertEqual(reasons, ['lighting-lightmap-index-invalid:5'])
        self.assertEqual(named['LMNR.texture'].values, (NO_LIGHTMAP,) * 3)
        self.assertEqual((named['LMUV.uv'].values, counts['litNodeRanges']), ((), 0))

    def test_a_node_without_a_lightmap_keeps_none_and_a_record_past_the_list_is_named(self):
        package, model, _ = three_surface_lightmaps()
        lightmaps = read_bsp_lightmaps(package, model)
        self.assertEqual(node_lightmap_texture(lightmaps, lightmap_node(NO_LIGHTMAP, 0, 0, 4)), (NO_LIGHTMAP, None))
        self.assertEqual(node_lightmap_texture(lightmaps, lightmap_node(7, 0, 0, 4)), (None, 'lighting-lightmap-index-invalid:7'))

    def test_each_record_reads_its_texture_index_zone_level_and_revision_from_its_own_bytes(self):
        package, model, _ = three_surface_lightmaps()
        lightmaps = read_bsp_lightmaps(package, model)
        self.assertEqual([(record.texture_index, record.surface, record.zone_index, record.level_reference, record.revision)
                          for record in lightmaps.records],
                         [(0, surface, 0, 5, 0) for surface in range(3)])

    def test_a_record_that_names_another_texture_than_the_page_listing_it_is_refused(self):
        package, model, _ = three_surface_lightmaps()
        damaged = bytearray(package.data)
        damaged[package.data.index(bytes((0, 2, 0, 0x40, 4)))] = 1
        package.data = bytes(damaged)
        with self.assertRaisesRegex(FormatError, 'names texture 1'):
            read_bsp_lightmaps(package, model)

    def test_each_drawn_node_range_takes_the_sun_affect_of_its_front_zone(self):
        unresolved_zone = lightmap_zone(None, unresolved=True)
        package, model, _ = three_surface_lightmaps(front_zones=(0, 1, 2))
        drawn = [node_range(node, 6 * node) for node in range(3)]
        arrays, _, counts = bsp_lightmap_arrays(package, read_bsp_lightmaps(package, model), model, drawn, (*SUN_ZONES, unresolved_zone))
        self.assertEqual(arrays_by_name(arrays)['LMNR.sunAffect'].values, (NOT_SUN_AFFECTED, SUN_AFFECTED, SUN_AFFECT_UNRESOLVED))
        self.assertEqual((counts['sunAffectedNodeRanges'], counts['sunAffectUnresolvedNodeRanges']), (1, 1))

    def test_only_drawn_node_ranges_get_a_sun_affect_value(self):
        package, model, _ = three_surface_lightmaps(front_zones=(0, 1, 0))
        drawn = [node_range(node, 6 * node) for node in (0, 2)]
        arrays, _, counts = bsp_lightmap_arrays(package, read_bsp_lightmaps(package, model), model, drawn, SUN_ZONES)
        self.assertEqual((arrays_by_name(arrays)['LMNR.sunAffect'].values, counts['sunAffectedNodeRanges']), ((0, 0), 0))

    def test_a_node_front_zone_outside_the_level_zones_is_refused(self):
        package, model, _ = three_surface_lightmaps(front_zones=(0, 0, 9))
        with self.assertRaisesRegex(FormatError, 'zone 9 outside the 2 level zones'):
            bsp_lightmap_arrays(package, read_bsp_lightmaps(package, model), model, [node_range(node, 6 * node) for node in range(3)], SUN_ZONES)

    def test_a_page_whose_texture_format_is_not_dxt1_is_refused(self):
        package, model, _ = three_surface_lightmaps()
        footer = struct.pack('<B3i', FIXTURE_TEXTURE_FORMAT, 512, 512, FIXTURE_COMPRESSED_REVISION)
        damaged = bytearray(package.data)
        damaged[damaged.index(footer)] = FIXTURE_TEXTURE_FORMAT + 5
        package.data = bytes(damaged)
        with self.assertRaisesRegex(FormatError, 'texture format 8, not DXT1'):
            read_bsp_lightmaps(package, model)

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
                                                 ('Rotation', None, 'ue-zero'), ('bDynamicLight', None, 'ue-zero'), ('bDirectional', None, 'ue-zero'),
                                                 ('bSunAffect', None, 'ue-zero'), ('bDeleteMe', None, 'ue-zero')])
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
        named = arrays_by_name(static_mesh_light_list_arrays(light_lists, (SUN_AFFECTED,)))
        self.assertEqual((named['SMLL.actorExportIndex'].values, named['SMLL.instanceExportIndex'].values), ((9,), (4,)))
        self.assertEqual(named['SMLL.sunAffect'].values, (SUN_AFFECTED,))
        self.assertEqual(named['SMLL.colorCount'].values, (len(INSTANCE_COLOURS) // 4,))
        self.assertFalse({'SMIC.bytes', 'SMIC.revision'} & set(named))
        self.assertEqual((named['SMSC.light'].values, bytes(named['SMSC.bits'].values)), ((1, 2), b'\x05\x0a\x01'))
        self.assertEqual((named['SMSC.bitStart'].values, named['SMEN.hour'].values), ((0, 1, 3), (12.0,)))
        with self.assertRaisesRegex(ValueError, '0 sun affect values for 1 static mesh light lists'):
            static_mesh_light_list_arrays(light_lists, ())

    def test_each_light_list_takes_the_bsunaffect_of_its_actor_and_an_unread_field_stays_unresolved(self):
        package = mock.Mock(exports=[{'classObject': 'Engine.StaticMeshActor'}] * 3)
        light_lists = [mock.Mock(actor_export_index=index) for index in (1, 2, 3)]
        fields = [ActorField('bSunAffect', True, 'authored', 'Engine.Actor'), ActorField('bSunAffect', False, 'class-default', 'Engine.Actor'),
                  ActorField('bSunAffect', None, 'unresolved', None)]
        with mock.patch('world.lighting_step.serialized_actor_values'), mock.patch('world.lighting_step.resolved_actor_field', side_effect=fields):
            self.assertEqual(static_mesh_light_list_sun_affect(package, light_lists, None), (SUN_AFFECTED, NOT_SUN_AFFECTED, SUN_AFFECT_UNRESOLVED))

    def test_terrain_sector_shadow_maps_and_light_bits_keep_their_stored_bytes(self):
        sector = read_terrain_sector_lighting(self.package, 5)
        self.assertEqual([(light.light_reference, light.visibility_bits) for light in sector.lights], list(SECTOR_LIGHTS))
        self.assertEqual(sector.shadow_maps, SECTOR_SHADOW_MAPS)
        named = arrays_by_name(terrain_lighting_arrays([sector]))
        self.assertEqual(bytes(named['TSHM.bytes'].values), b''.join(SECTOR_SHADOW_MAPS))
        self.assertEqual((named['TSHM.byteStart'].values, named['TSEC.shadowMapStart'].values), ((0, 289, 578), (0, 2)))
        self.assertNotIn('TSHM.hour', named)

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
        self.assertEqual(LIGHTING_STEP_ALGORITHM_VERSION, 8)
        self.assertIn('lighting', load_tile_manifest_vocabulary().resource_kinds)
        patterns = load_gap_reason_patterns()
        for reason in ('lighting-lightmap-index-invalid:<index>', 'lighting-payload-too-large',
                       'lighting-water-volume-unlinked:<class>', 'lighting-class-chain-unresolved:<class>'):
            self.assertIn(reason, patterns)

    def test_the_unit_config_holds_the_struct_property_rules_sha256(self):
        with (mock.patch('world.lighting_step.sealed_chunk_plan', return_value=('c' * 64, ROOT, {})),
              mock.patch('world.lighting_step.sealed_bsp_chunks', return_value=('b' * 64, {})),
              mock.patch('world.lighting_step.sealed_collision', return_value=('d' * 64, {}))):
            config = lighting_unit(ROOT, '20_21', read_tile_map_lock_record('20_21')).config
        self.assertEqual(config['structPropertyRulesSha256'], read_struct_property_tag_rules().sha256)

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
    @classmethod
    def setUpClass(cls):
        from world.level_model import read_level_model
        from world.tile_chunk_plan import read_locked_map_package
        cls.package = read_locked_map_package(REFERENCE_CLIENT, '20_21', read_tile_map_lock_record('20_21'))
        cls.model = read_level_model(cls.package).model
        cls.expected = json.loads(DB7_EXPECTATIONS_PATH.read_text(encoding='utf-8'))

    def test_the_20_21_lightmap_records_and_atlas_children_match_the_db7_decode(self):
        lightmaps = read_bsp_lightmaps(self.package, self.model)
        expected = self.expected['bsp']
        records = lightmaps.records
        self.assertEqual(len(records), expected['recordCount'])
        self.assertEqual({'textureIndex': [record.texture_index for record in records], 'surface': [record.surface for record in records],
                          'zoneIndex': [record.zone_index for record in records], 'level': [record.level_reference for record in records],
                          'revision': [record.revision for record in records]}, expected['records'])
        self.assertEqual([len(texture.pages) for texture in lightmaps.textures], expected['groupCounts'])
        self.assertEqual({(child['format'], child['width'], child['height']) for child in expected['atlasChildren']}, {(DXT1_FORMAT_ID, 512, 512)})
        self.assertEqual([{'group': page.texture, 'slot': page.slot, 'revision': page.revision, 'compressedRevision': page.compressed_revision}
                          for page in lightmaps.pages],
                         [{key: child[key] for key in ('group', 'slot', 'revision', 'compressedRevision')} for child in expected['atlasChildren']])

    def test_the_20_21_intensity_maps_carry_the_db7_times_and_samples(self):
        from world.native_terrain_sectors import native_terrain
        from world.terrain_intensity_maps import read_terrain_intensity_maps
        expected = self.expected['terrain']
        intensity_maps = read_terrain_intensity_maps(self.package, native_terrain(self.package))
        self.assertEqual((list(intensity_maps.times), intensity_maps.width, intensity_maps.height),
                         (expected['times'], expected['width'], expected['height']))
        self.assertEqual([hashlib.sha256(values).hexdigest() for values in intensity_maps.intensities], expected['intensitySha256'])
        sample = expected['sample']
        self.assertEqual([values[sample['y'] * intensity_maps.width + sample['x']] for values in intensity_maps.intensities], sample['values'])

    def test_static_mesh_actor_1905_keeps_the_db7_colour_count_and_hourly_masks(self):
        from world.light_actors import read_static_mesh_light_list
        expected = self.expected['staticMesh']['instance']
        light_list = read_static_mesh_light_list(self.package, expected['actorExportIndex'], expected['instanceExportIndex'])
        self.assertEqual(light_list.color_count, expected['colourCount'])
        self.assertEqual(len(light_list.scene_lights), expected['sceneLightCount'])
        self.assertEqual([{'light': entry.light_reference, 'maskHex': entry.visibility_bits.hex(), 'flag': entry.applied}
                          for entry in light_list.environment_lights], expected['environmentLights'])

    def test_the_rm10_pillar_actor_7732_is_sun_affected(self):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from native_store.store_paths import lane_work_root
        from world.light_actors import read_static_mesh_light_list
        from world.static_placement import ClassDefaults
        from world.world_lane_names import WORLD_LANE_NAME
        pillar = json.loads(RM10_STATIC_FIXTURES_PATH.read_text(encoding='utf-8'))['pillar']
        light_list = read_static_mesh_light_list(self.package, pillar['actorExportIndex'], pillar['instanceExportIndex'])
        class_defaults = ClassDefaults(lane_work_root(ROOT, WORLD_LANE_NAME), ReferenceClientClassScripts(REFERENCE_CLIENT))
        self.assertEqual(static_mesh_light_list_sun_affect(self.package, [light_list], class_defaults), (SUN_AFFECTED,))

    def test_every_lit_node_of_20_21_has_uvs_inside_its_record_rectangle(self):
        from world.lighting_payload import lightmap_node_ranges
        package, model = self.package, self.model
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
