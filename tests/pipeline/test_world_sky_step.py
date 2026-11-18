import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from support.mapping_size_class_defaults import SYNTHETIC_DEFAULT_MATERIAL, use_synthetic_mapping_class_defaults
from synthetic_class_scripts import link_world_class_default_cache, scratch_work_root
from world.bsp_material_mapping_size import MaterialMappingSize, surface_material_identities
from world.terrain_coordinates import f32
from world.sky_geometry import SKY_GLB_GENERATOR, SkyRootSurface, build_sky_glb, build_sky_zone_parts, sky_root_translation_metres, \
    sky_zone_material_identities
from world.sky_materials import SkyTextureUnsupported, external_reference_reasons, single_graph_texture_export
from world.sky_step import SKY_STEP_ALGORITHM_VERSION, SKY_STEP_NAME, alpha_source, authored_colour_rgba, presentation_field_gap, sky_bundle_files, \
    tile_sky_row
from world.tile_step_gap_rows import TileStepGapRows
from world.tile_manifest_step import PENDING_TILE_STEPS, pending_steps_after_sealed, tile_level_gap_rows, tile_resources

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SERVED_SKY_FOLDER = ROOT / 'public/l2/skies/f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b'
SERVED_SKY_GLB_SHA256 = 'b8c5a64fb1682fa9865c202459c7516cf2690112a34ebb33a972cc2278c7f983'
TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic sky tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/sky/receipt.json'
SKY_ZONE = 1
OBJECT_NAMES = {1: 'Sky_T.Shaders.Haze', 3: 'Sky_T.Shaders.Back', 4: 'SKY_T.SHADERS.HAZE', 2: f'{TILE_ID}.BrushActor0'}
TEXTURE_SIZED_MAPPING = MaterialMappingSize(64, 32)


def object_name(index):
    return OBJECT_NAMES.get(index)


def glb_chunks(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    binary_length = struct.unpack_from('<I', glb, 20 + json_length)[0]
    return json.loads(glb[20:20 + json_length]), glb[28 + json_length:28 + json_length + binary_length]


def without_texture_coordinate_values(document, binary):
    blanked = bytearray(binary)
    for mesh in document['meshes']:
        accessor = document['accessors'][mesh['primitives'][0]['attributes']['TEXCOORD_0']]
        view = document['bufferViews'][accessor['bufferView']]
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        blanked[start:start + accessor['count'] * 8] = bytes(accessor['count'] * 8)
    return document, bytes(blanked)


def texture_receipt(name):
    return {'sourceReference': f'Sky_T.Textures.{name}', 'width': 64, 'height': 32, 'png': {'file': f'{name}.png'}}


def synthetic_sky_model():
    return build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64), material=1, zones=(SKY_ZONE, SKY_ZONE)),
                                        synthetic_polygon(square_points(100, 0, 64), material=3, zones=(0, SKY_ZONE)),
                                        synthetic_polygon(square_points(200, 0, 64), material=4, zones=(SKY_ZONE, 0)),
                                        synthetic_polygon(square_points(300, 0, 64), material=3, zones=(0, 0)),
                                        synthetic_polygon(square_points(400, 0, 64), material=0, zones=(SKY_ZONE, SKY_ZONE))],
                                       zones=(synthetic_zone(), synthetic_zone(5)))


def root_surface(identity, texture_name, mapping_size=TEXTURE_SIZED_MAPPING):
    return SkyRootSurface(identity, identity, [206, 150, 0, 255], True, 'serialized', False, texture_receipt(texture_name), mapping_size)


def synthetic_material_of_surface(test_case):
    use_synthetic_mapping_class_defaults(test_case)
    return surface_material_identities(SimpleNamespace(object_name=object_name), synthetic_sky_model(), None, None)


def sky_zone_parts(test_case, roots):
    package = SimpleNamespace(object_name=object_name)
    return build_sky_zone_parts(package, synthetic_material_of_surface(test_case), synthetic_sky_model(), SKY_ZONE, roots)


class SkyZoneGeometryTests(unittest.TestCase):
    def test_material_roots_keep_first_node_order_and_fold_case(self):
        self.assertEqual(sky_zone_material_identities(synthetic_material_of_surface(self), synthetic_sky_model(), SKY_ZONE),
                         ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back', SYNTHETIC_DEFAULT_MATERIAL])

    def test_parts_draw_every_sky_zone_node_of_their_root_with_reversed_fans_and_recentred_uvs(self):
        [part] = sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')])
        self.assertEqual([node_range['node'] for node_range in part['nodeRanges']], [0, 2])
        self.assertEqual(part['indices'][:6], [0, 2, 1, 0, 3, 2])
        self.assertEqual(part['positions'][3:6], [struct.unpack('<f', struct.pack('<f', 0.64))[0], 0.0, 0.0])
        self.assertEqual(part['mappingSize'], [64, 32])
        self.assertEqual(part['uvs'][:8], [-1.0, -1.0, 0.0, -1.0, 0.0, 1.0, -1.0, 1.0])

    def test_a_sky_node_drops_the_rounded_non_integer_mean_of_its_mapping_size_coordinates(self):
        [part] = sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring', MaterialMappingSize(40, 256))])
        recentred_u = f32(f32(64 / 40) - 1)
        self.assertEqual(part['uvs'][:8], [-1.0, 0.0, recentred_u, 0.0, recentred_u, 0.25, -1.0, 0.25])

    def test_a_sky_zone_node_without_a_material_draws_with_the_material_class_default(self):
        roots = [root_surface('Sky_T.Shaders.Haze', 'Ring'), root_surface('Sky_T.Shaders.Back', 'Chip'),
                 root_surface(SYNTHETIC_DEFAULT_MATERIAL, 'Default')]
        parts = sky_zone_parts(self, roots)
        self.assertEqual([[node_range['node'] for node_range in part['nodeRanges']] for part in parts], [[0, 2], [1], [4]])

    def test_the_root_translation_is_minus_the_sky_zone_location_in_browser_axes(self):
        self.assertEqual(sky_root_translation_metres([100.0, 200.0, 300.0]), [-1.0, -3.0, -2.0])

    def test_the_glb_holds_one_child_node_and_one_material_per_root(self):
        roots = [root_surface('Sky_T.Shaders.Haze', 'Ring'), root_surface('Sky_T.Shaders.Back', 'Chip')]
        snapshot = {'id': f'interlude:{TILE_ID}.Model1.SkyZoneInfo0', 'rootTranslationMetres': [0.0, 0.0, 0.0],
                    'parts': sky_zone_parts(self, roots)}
        document, binary = glb_chunks(build_sky_glb(snapshot, {'Ring.png': b'ring-png', 'Chip.png': b'chip-png'}))
        self.assertEqual(document['nodes'][0]['children'], [1, 2])
        self.assertEqual([material['name'] for material in document['materials']], ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back'])
        self.assertEqual(document['asset']['generator'], SKY_GLB_GENERATOR)
        self.assertIn(b'ring-png', binary)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [206 / 255, 150 / 255, 0, 1])

    def test_only_the_position_accessor_carries_bounds_like_the_served_sky(self):
        snapshot = {'id': f'interlude:{TILE_ID}.Model1.SkyZoneInfo0', 'rootTranslationMetres': [0.0, 0.0, 0.0],
                    'parts': sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')])}
        document, _ = glb_chunks(build_sky_glb(snapshot, {'Ring.png': b'ring-png'}))
        attributes = document['meshes'][0]['primitives'][0]['attributes']
        accessors = document['accessors']
        self.assertEqual(accessors[attributes['POSITION']]['min'], [0.0, 0.0, 0.0])
        self.assertEqual(accessors[attributes['POSITION']]['max'], [struct.unpack('<f', struct.pack('<f', metres))[0] for metres in (2.64, 0.0, 0.64)])
        self.assertNotIn('min', accessors[attributes['NORMAL']])
        self.assertNotIn('max', accessors[attributes['NORMAL']])
        self.assertEqual(accessors[document['meshes'][0]['primitives'][0]['indices']]['componentType'], 5125)


class SkyMaterialTests(unittest.TestCase):
    def test_a_root_without_its_color_or_with_untyped_flags_is_a_named_feature_gap(self):
        color = {'value': {'rawHex': 'ce9600ff'}}
        complete = {'Color': color, 'AlphaBlend': {'value': True}, 'RenderTwoSided': {'value': False}}
        self.assertIsNone(presentation_field_gap(complete))
        self.assertEqual(presentation_field_gap({**complete, 'Color': {'value': None}}), 'material-feature-unported:Color')
        self.assertEqual(presentation_field_gap({key: value for key, value in complete.items() if key != 'AlphaBlend'}),
                         'material-feature-unported:AlphaBlend')

    def test_the_authored_colour_reads_the_serialized_color_bytes_as_b_g_r_a(self):
        self.assertEqual(authored_colour_rgba({'rawHex': '01020304'}), [3, 2, 1, 4])
        self.assertEqual(authored_colour_rgba({'rawHex': 'ce9600ff', 'structName': 'Color'}), [0, 150, 206, 255])

    def test_the_alpha_source_names_a_class_default_or_the_serialized_tag(self):
        self.assertEqual(alpha_source({'provenance': 'authored'}), 'serialized')
        self.assertEqual(alpha_source({'provenance': 'class-default', 'valueDeclaringClass': 'Engine.ColorModifier'}),
                         'Engine.ColorModifier class default')

    def test_an_imported_material_reference_names_its_external_package(self):
        graph = {'references': [{'target': 'import', 'to': 'Other_T.Textures.Cloud'}, {'target': 'export', 'to': 'Sky_T.Textures.Ring'}]}
        self.assertEqual(external_reference_reasons(graph), ['sky-material-external:Other_T'])

    def test_a_root_reaching_two_textures_is_a_texture_count_gap(self):
        package = SimpleNamespace(exports=[{'object': 'Sky_T.Textures.A'}, {'object': 'Sky_T.Textures.B'}])
        graph = {'root': 'Sky_T.Shaders.Haze', 'nodes': [{'exportIndex': 1, 'classObject': 'Engine.Texture'},
                                                         {'exportIndex': 2, 'classObject': 'Engine.Texture'}]}
        with self.assertRaises(SkyTextureUnsupported) as caught:
            single_graph_texture_export(package, graph)
        self.assertEqual(caught.exception.reason, 'sky-material-texture-count:2')


class SkyStepRecordTests(unittest.TestCase):
    def test_the_step_name_version_reasons_and_vocabulary_kind_are_registered(self):
        self.assertEqual((SKY_STEP_NAME, SKY_STEP_ALGORITHM_VERSION), ('sky', 6))
        self.assertIn('sky', load_tile_manifest_vocabulary(ROOT).resource_kinds)
        patterns = load_gap_reason_patterns(ROOT)
        for reason in ('sky-zone-detail-mode-unresolved', 'sky-zone-class-unresolved:Engine.Foo', 'sky-zone-detail-field-unresolved:Map.SkyZoneInfo0.bHighDetail',
                       'sky-zone-actor-zone-count:0', 'sky-zone-rotation-unported', 'sky-zone-rotation-unresolved', 'sky-zone-distance-fog-unported',
                       'sky-zone-distance-fog-unresolved', 'sky-material-external:Other_T', 'sky-texture-format-unsupported:0', 'sky-material-texture-count:2'):
            self.assertTrue(is_listed_reason(reason, patterns), reason)

    def test_an_unresolved_sky_choice_is_a_gap_row_and_a_sealed_sky_leaves_pending(self):
        gaps = TileStepGapRows(TILE_ID, SKY_STEP_NAME, SOURCE_IDENTITY, EVIDENCE)
        gaps.add('gap', 'sky-zone-detail-mode-unresolved')
        product = {'manifest': None, 'gapRows': gaps.rows()}
        self.assertEqual(tile_sky_row(TILE_ID, SOURCE_IDENTITY, product['gapRows'], EVIDENCE)['reason'], 'sky-zone-detail-mode-unresolved')
        self.assertEqual(tile_resources(None, None, None, None, product), [])
        self.assertNotIn('sky', pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, None, None, None, None, product))
        rows = tile_level_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, None, None, None, None, None, None, product)
        self.assertEqual([row['reason'] for row in rows if row['step'] == 'sky'], ['sky-zone-detail-mode-unresolved'])

    def test_a_tile_without_a_sky_zone_passes_with_no_resource(self):
        product = {'manifest': None, 'gapRows': []}
        self.assertEqual(tile_sky_row(TILE_ID, SOURCE_IDENTITY, product['gapRows'], EVIDENCE)['status'], 'pass')
        self.assertEqual([row for row in tile_level_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, None, None, None, None, None, None, product)
                          if row['step'] == 'sky'], [])

    def test_a_written_sky_bundle_is_a_pinned_sky_resource(self):
        record = {'resource': f'/l2/skies/{"a" * 64}/manifest.json', 'sha256': 'a' * 64, 'bytes': 10}
        self.assertEqual(tile_resources(None, None, None, None, {'manifest': record, 'gapRows': []}),
                         [{'kind': 'sky', 'manifest': record['resource'], 'manifestSha256': record['sha256'], 'manifestBytes': 10}])


@unittest.skipUnless(REFERENCE_CLIENT.is_dir() and (SERVED_SKY_FOLDER / 'sky.glb').is_file(),
                     'the conversion client E:/Lineage2-client or the served 20_20 sky in public/l2 is absent')
class RealClientSkyTests(unittest.TestCase):
    def converted_sky_files(self, tile_id):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from native_store.store_paths import lane_work_root
        from world.level_model import read_level_model
        from world.level_zones import read_level_zones
        from world.light_actors import reference_client_class_chains
        from world.raw_map_step import read_tile_map_lock_record
        from world.sky_step import convert_tile_sky
        from world.sky_zone_selection import select_sky_zone
        from world.static_placement import ClassDefaults
        from world.tile_chunk_plan import read_locked_map_package
        lock_record = read_tile_map_lock_record(tile_id)
        package = read_locked_map_package(REFERENCE_CLIENT, tile_id, lock_record)
        level = read_level_model(package)
        scratch_project_root = scratch_work_root(self, 'sky-project-')
        class_work_root = link_world_class_default_cache(lane_work_root(scratch_project_root, 'world'))
        class_defaults = ClassDefaults(class_work_root, ReferenceClientClassScripts(REFERENCE_CLIENT))
        class_chains = reference_client_class_chains(class_defaults)
        zones = read_level_zones(package, level, class_defaults, class_chains)
        selection = select_sky_zone(package, level, zones, class_defaults, class_chains)
        gaps = TileStepGapRows(tile_id, SKY_STEP_NAME, {'path': f'maps/{tile_id}.unr', 'sha256': lock_record['eSha256']}, EVIDENCE)
        converted = convert_tile_sky(scratch_project_root, REFERENCE_CLIENT.resolve(), tile_id, lock_record, package, level, selection.zone_index, selection.actor, gaps)
        return converted, gaps.rows()

    def test_the_generic_20_20_sky_glb_matches_the_served_sky_except_its_generator_colour_order_and_uv_values(self):
        served = (SERVED_SKY_FOLDER / 'sky.glb').read_bytes()
        self.assertEqual(hashlib.sha256(served).hexdigest(), SERVED_SKY_GLB_SHA256)
        converted, gap_rows = self.converted_sky_files('20_20')
        self.assertEqual(gap_rows, [])
        generic_document, generic_binary = without_texture_coordinate_values(*glb_chunks(converted.files['sky.glb']))
        served_document, served_binary = without_texture_coordinate_values(*glb_chunks(served))
        self.assertEqual(generic_binary, served_binary)
        self.assertEqual(generic_document['asset'].pop('generator'), SKY_GLB_GENERATOR)
        served_document['asset'].pop('generator')
        for material in served_document['materials']:
            red, green, blue, alpha = material['pbrMetallicRoughness']['baseColorFactor']
            material['pbrMetallicRoughness']['baseColorFactor'] = [blue, green, red, alpha]
        self.assertEqual(generic_document, served_document)
        self.assertEqual(converted.counts, {'nodes': 53, 'vertices': 182, 'triangles': 76, 'materialRoots': 3, 'textures': 3})
        self.assertEqual({part['mapReference']: part['mappingSize'] for part in json.loads(converted.files['sky.json'])['parts']},
                         {'L2_Skies.Shaders.Cloud_Final': [1024, 1024], 'L2_Skies.Shaders.HazeRing_Final': [512, 128],
                          'L2_Skies.Shaders.SkybackgroundColor': [32, 32]})

    def test_tile_15_22_sky_layers_take_their_colors_from_the_blue_green_red_alpha_bytes(self):
        converted, gap_rows = self.converted_sky_files('15_22')
        self.assertEqual(gap_rows, [])
        snapshot = json.loads(converted.files['sky.json'])
        colors = {part['sourceMaterial']: part['authoredColorRGBA'] for part in snapshot['parts']}
        self.assertEqual(colors, {'l2_skies.Shaders.SkybackgroundColor': [0, 150, 206, 255], 'l2_skies.Shaders.HazeRing_Final': [255, 228, 149, 255],
                                  'l2_skies.Shaders.Cloud_Final': [255, 192, 151, 255]})
        self.assertEqual(snapshot['unresolvedDynamics']['timeOfDay'], 'runtime writes the DB-4 per-hour Env.int ColorModifier colours; native parity unverified')
        self.assertFalse(any('time-of-day tint updates' in limitation for limitation in snapshot['limitations']))

    def test_tile_20_21_builds_its_own_sky_from_its_one_sky_zone(self):
        converted, gap_rows = self.converted_sky_files('20_21')
        self.assertEqual(gap_rows, [])
        manifest = json.loads(converted.files['manifest.json'])
        self.assertEqual(manifest['id'], 'interlude:20_21.Model327.SkyZoneInfo0')
        self.assertEqual(manifest['counts']['materialRoots'], 3)
        self.assertEqual(sky_bundle_files(json.loads(converted.files['sky.json']), {name: data for name, data in converted.files.items()
                                                                                    if name not in ('sky.json', 'sky.glb', 'manifest.json')})[0],
                         converted.files)


if __name__ == '__main__':
    unittest.main()
