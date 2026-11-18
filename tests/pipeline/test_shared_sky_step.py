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
from native_store.catalog_writer import validate_catalog_record
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from native_store.step_source_modules import step_source_modules
from native_store.verified_file_writes import CatalogWriteError
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from support.mapping_size_class_defaults import SYNTHETIC_DEFAULT_MATERIAL, use_synthetic_mapping_class_defaults
from synthetic_class_scripts import scratch_work_root
from world.actor_field_values import ActorField
from world.bsp_chunk_geometry import BspPolygonError, load_bsp_poly_flags
from world.bsp_material_mapping_size import MaterialMappingSize, surface_material_identities
from world.shared_sky_step import (SHARED_SKY_STEP_ALGORITHM_VERSION, SHARED_SKY_UNIT_KEY, shared_sky_ledger, shared_sky_product_path,
                                   shared_sky_summary_row, sky_zone_rotation_gap)
from world.sky_geometry import SKY_GLB_GENERATOR, SkyRootSurface, build_sky_glb, build_sky_zone_parts, sky_root_translation_metres, \
    sky_zone_material_identities
from world.sky_materials import SkyTextureUnsupported, external_reference_reasons, single_graph_texture_export
from world.shared_sky_visibility_rules import material_requires_sorting
from world.sky_root_conversion import alpha_source, presentation_field_gap, root_colour_rgba
from world.terrain_coordinates import f32

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SHARED_SKY_FIXTURES = json.loads((ROOT / 'tests/fixtures/environment/shared-sky-rm21-fixtures.json').read_text(encoding='utf-8'))['sharedSkyLevel']
SKYLEVEL_LEVEL_MODEL_FIXTURE = json.loads((ROOT / 'tests/fixtures/world-readers/level-model-118-0.json').read_text(encoding='utf-8'))
STAGED_SKY_VISIBILITY_FIXTURE = ROOT / 'tests/fixtures/environment/skylevel-visibility'
TILE_ID = '00_00'
SKY_ZONE = 1
OBJECT_NAMES = {1: 'Sky_T.Shaders.Haze', 3: 'Sky_T.Shaders.Back', 4: 'SKY_T.SHADERS.HAZE', 2: f'{TILE_ID}.BrushActor0'}
TEXTURE_SIZED_MAPPING = MaterialMappingSize(64, 32)
REMOVED_TILE_SKY_REASONS = ('sky-zone-detail-mode-unresolved', 'sky-zone-detail-field-unresolved:Map.SkyZoneInfo0.bHighDetail',
                            'sky-zone-actor-zone-count:0', 'sky-zone-distance-fog-unresolved')


def object_name(index):
    return OBJECT_NAMES.get(index)


def glb_chunks(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    binary_length = struct.unpack_from('<I', glb, 20 + json_length)[0]
    return json.loads(glb[20:20 + json_length]), glb[28 + json_length:28 + json_length + binary_length]


def texture_receipt(name):
    return {'sourceReference': f'Sky_T.Textures.{name}', 'width': 64, 'height': 32, 'png': {'file': f'{name}.png'}}


def synthetic_sky_model(collinear_haze=False):
    haze_points = [*square_points(0, 0, 64), (0.0, 32.0, 0.0)] if collinear_haze else square_points(0, 0, 64)
    return build_synthetic_level_model([synthetic_polygon(haze_points, material=1, zones=(SKY_ZONE, SKY_ZONE)),
                                        synthetic_polygon(square_points(100, 0, 64), material=3, zones=(0, SKY_ZONE)),
                                        synthetic_polygon(square_points(200, 0, 64), material=4, zones=(SKY_ZONE, 0)),
                                        synthetic_polygon(square_points(300, 0, 64), material=3, zones=(0, 0)),
                                        synthetic_polygon(square_points(400, 0, 64), material=0, zones=(SKY_ZONE, SKY_ZONE))],
                                       zones=(synthetic_zone(), synthetic_zone(5)))


def root_surface(identity, texture_name, mapping_size=TEXTURE_SIZED_MAPPING):
    return SkyRootSurface(identity, identity, [206, 150, 0, 255], True, 'serialized', False, texture_receipt(texture_name), mapping_size)


def synthetic_material_of_surface(test_case, model):
    use_synthetic_mapping_class_defaults(test_case)
    return surface_material_identities(SimpleNamespace(object_name=object_name), model, None, None)


def sky_zone_parts(test_case, roots, model=None):
    model = model or synthetic_sky_model()
    package = SimpleNamespace(object_name=object_name)
    return build_sky_zone_parts(package, synthetic_material_of_surface(test_case, model), model, SKY_ZONE, load_bsp_poly_flags(), roots)


class SkyZoneGeometryTests(unittest.TestCase):
    def test_material_roots_keep_first_node_order_and_fold_case(self):
        model = synthetic_sky_model()
        self.assertEqual(sky_zone_material_identities(synthetic_material_of_surface(self, model), model, SKY_ZONE, load_bsp_poly_flags()),
                         ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back', SYNTHETIC_DEFAULT_MATERIAL])

    def test_parts_draw_every_sky_zone_node_of_their_root_with_reversed_fans_and_recentred_uvs(self):
        [part] = sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')])
        self.assertEqual([node_range['node'] for node_range in part['nodeRanges']], [0, 2])
        self.assertEqual(part['indices'][:6], [0, 2, 1, 0, 3, 2])
        self.assertEqual(part['positions'][3:6], [struct.unpack('<f', struct.pack('<f', 0.64))[0], 0.0, 0.0])
        self.assertEqual(part['mappingSize'], [64, 32])
        self.assertEqual(part['uvs'][:8], [-1.0, -1.0, 0.0, -1.0, 0.0, 1.0, -1.0, 1.0])

    def test_a_fan_with_a_collinear_corner_keeps_every_fan_triangle_like_the_bsp_polygon_rule(self):
        [part] = sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')], synthetic_sky_model(collinear_haze=True))
        self.assertEqual(part['nodeRanges'][0]['indexCount'], 9)
        self.assertEqual(part['indices'][:9], [0, 2, 1, 0, 3, 2, 0, 4, 3])

    def test_a_sky_zone_node_without_three_vertices_is_not_drawn(self):
        model = synthetic_sky_model()
        model.nodes[2].num_vertices = 0
        [part] = sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')], model)
        self.assertEqual([node_range['node'] for node_range in part['nodeRanges']], [0])

    def test_a_polygon_wound_against_its_plane_is_refused(self):
        model = synthetic_sky_model()
        model.nodes[0].plane = tuple(-value for value in model.nodes[0].plane)
        with self.assertRaisesRegex(BspPolygonError, 'node 0 polygon winding is reversed or degenerate against its stored plane'):
            sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')], model)

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
        snapshot = {'id': 'interlude:skylevel.Model1.SkyZoneInfo0', 'rootTranslationMetres': [0.0, 0.0, 0.0], 'parts': sky_zone_parts(self, roots)}
        document, binary = glb_chunks(build_sky_glb(snapshot, {'Ring.png': b'ring-png', 'Chip.png': b'chip-png'}))
        self.assertEqual(document['nodes'][0]['children'], [1, 2])
        self.assertEqual([material['name'] for material in document['materials']], ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back'])
        self.assertEqual(document['asset']['generator'], SKY_GLB_GENERATOR)
        self.assertIn(b'ring-png', binary)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [206 / 255, 150 / 255, 0, 1])

    def test_only_the_position_accessor_carries_bounds(self):
        snapshot = {'id': 'interlude:skylevel.Model1.SkyZoneInfo0', 'rootTranslationMetres': [0.0, 0.0, 0.0],
                    'parts': sky_zone_parts(self, [root_surface('Sky_T.Shaders.Haze', 'Ring')])}
        document, _ = glb_chunks(build_sky_glb(snapshot, {'Ring.png': b'ring-png'}))
        attributes = document['meshes'][0]['primitives'][0]['attributes']
        accessors = document['accessors']
        self.assertEqual(accessors[attributes['POSITION']]['min'], [0.0, 0.0, 0.0])
        self.assertEqual(accessors[attributes['POSITION']]['max'], [struct.unpack('<f', struct.pack('<f', metres))[0] for metres in (2.64, 0.0, 0.64)])
        self.assertNotIn('min', accessors[attributes['NORMAL']])
        self.assertEqual(accessors[document['meshes'][0]['primitives'][0]['indices']]['componentType'], 5125)


class SkyMaterialTests(unittest.TestCase):
    def test_a_root_without_its_color_or_with_untyped_flags_is_a_named_feature_gap(self):
        complete = {'Color': {'value': {'rawHex': 'ce9600ff'}}, 'AlphaBlend': {'value': True}, 'RenderTwoSided': {'value': False}}
        self.assertIsNone(presentation_field_gap(complete))
        self.assertIsNone(presentation_field_gap({**complete, 'Color': {'value': {'R': 255, 'G': 255, 'B': 255, 'A': 255}}}))
        self.assertEqual(presentation_field_gap({**complete, 'Color': {'value': None}}), 'material-feature-unported:Color')
        self.assertEqual(presentation_field_gap({**complete, 'Color': {'value': {'R': 256, 'G': 0, 'B': 0, 'A': 0}}}), 'material-feature-unported:Color')
        self.assertEqual(presentation_field_gap({key: value for key, value in complete.items() if key != 'AlphaBlend'}),
                         'material-feature-unported:AlphaBlend')

    def test_the_root_colour_reads_serialized_bytes_as_b_g_r_a_and_a_class_default_colour_as_named_channels(self):
        self.assertEqual(root_colour_rgba({'rawHex': '01020304'}), [3, 2, 1, 4])
        self.assertEqual(root_colour_rgba({'rawHex': 'ce9600ff', 'structName': 'Color'}), [0, 150, 206, 255])
        self.assertEqual(root_colour_rgba({'A': 255, 'B': 3, 'G': 2, 'R': 1}), [1, 2, 3, 255])

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


class SharedSkyStepRecordTests(unittest.TestCase):
    def test_the_step_is_one_world_unit_with_its_own_converter_closure(self):
        self.assertEqual((SHARED_SKY_UNIT_KEY, SHARED_SKY_STEP_ALGORITHM_VERSION), ('shared-sky:skylevel', 2))
        self.assertEqual(step_source_modules('world', 'shared-sky'), ('world.shared_sky_step',))

    def test_the_sky_reasons_it_can_write_are_listed_and_the_tile_detail_mode_reasons_are_gone(self):
        patterns = load_gap_reason_patterns(ROOT)
        for reason in ('sky-zone-class-unresolved:Engine.Foo', 'sky-zone-rotation-unported', 'sky-zone-rotation-unresolved',
                       'sky-material-external:Other_T', 'sky-texture-format-unsupported:0', 'sky-material-texture-count:2'):
            self.assertTrue(is_listed_reason(reason, patterns), reason)
        for reason in REMOVED_TILE_SKY_REASONS:
            self.assertFalse(is_listed_reason(reason, patterns), reason)

    def test_a_zero_or_unserialized_rotation_is_ported_and_any_other_is_a_named_gap(self):
        def rotation(value, provenance='authored'):
            return ActorField('Rotation', value, provenance, 'Engine.SkyZoneInfo')
        self.assertIsNone(sky_zone_rotation_gap(rotation(None, 'ue-zero')))
        self.assertIsNone(sky_zone_rotation_gap(rotation({'Pitch': 0, 'Yaw': 0, 'Roll': 0})))
        self.assertEqual(sky_zone_rotation_gap(rotation({'Pitch': 0, 'Yaw': 16384, 'Roll': 0})), 'sky-zone-rotation-unported')
        self.assertEqual(sky_zone_rotation_gap(rotation(None, 'unresolved')), 'sky-zone-rotation-unresolved')

    def test_the_summary_row_is_keyed_by_the_skylevel_census_row(self):
        gap_row = {'status': 'gap', 'reason': 'sky-zone-rotation-unported'}
        self.assertEqual({key: value for key, value in shared_sky_summary_row([gap_row], 'evidence').items() if key != 'sourceIdentity'},
                         {'key': 'map:skylevel', 'part': 'world', 'step': 'shared-sky', 'status': 'gap', 'reason': 'sky-zone-rotation-unported',
                          'evidence': 'evidence'})
        self.assertEqual(shared_sky_summary_row([], 'evidence')['status'], 'pass')

    def test_the_skies_catalog_record_holds_only_the_skylevel_bundle_manifest(self):
        record = {'id': 'skylevel', 'manifest': f'/l2/skies/{"a" * 64}/manifest.json', 'manifestSha256': 'a' * 64, 'manifestBytes': 10}
        self.assertEqual(validate_catalog_record('skies', record), record)
        for changed in ({**record, 'id': '20_21'}, {**record, 'manifest': f'/l2/skies/{"a" * 64}/sky.json'}):
            with self.subTest(changed=changed), self.assertRaises(CatalogWriteError):
                validate_catalog_record('skies', changed)


@unittest.skipUnless((REFERENCE_CLIENT / 'maps/skylevel.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
class SharedSkyConversionRefusalTests(unittest.TestCase):
    def run_step_with_convert_refusal(self, refusal):
        from unittest import mock
        from world import shared_sky_step
        scratch = scratch_work_root(self, 'shared-sky-refusal-')
        with mock.patch.object(shared_sky_step, 'convert_shared_sky', side_effect=refusal):
            return shared_sky_step.run_shared_sky_step(scratch, REFERENCE_CLIENT)

    def test_a_geometry_refusal_while_converting_is_a_failed_skylevel_row(self):
        from world.error_detail import conversion_failure_reason
        refusal = BspPolygonError('node 0 polygon winding is reversed or degenerate against its stored plane')
        row = self.run_step_with_convert_refusal(refusal)
        self.assertEqual((row['key'], row['step'], row['status'], row['reason']),
                         ('map:skylevel', 'shared-sky', 'failed', conversion_failure_reason(refusal)))

    def test_a_store_path_refusal_while_converting_is_raised(self):
        from native_store.store_paths import StorePathError
        with self.assertRaisesRegex(StorePathError, 'synthetic store path refusal'):
            self.run_step_with_convert_refusal(StorePathError('synthetic store path refusal'))


@unittest.skipUnless((REFERENCE_CLIENT / 'maps/skylevel.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
class RealClientSharedSkyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from native_store.unit_ledger import run_at_below_normal_priority
        from world.shared_sky_step import run_shared_sky_step
        run_at_below_normal_priority()
        cls.scratch = scratch_work_root(cls(), 'shared-sky-project-')
        cls.row = run_shared_sky_step(cls.scratch, REFERENCE_CLIENT)
        cls.product = json.loads(shared_sky_product_path(shared_sky_ledger(cls.scratch)).read_text(encoding='utf-8'))
        cls.store_root = cls.scratch / 'artifacts' / 'lane-store' / 'world' / 'l2'
        bundle_folder = (cls.store_root / cls.product['manifest']['resource'].removeprefix('/l2/')).parent
        cls.snapshot = json.loads((bundle_folder / 'sky.json').read_text(encoding='utf-8'))
        cls.parts = {part['sourceMaterial'].casefold(): part for part in cls.snapshot['parts']}

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.scratch, True)

    def program_root_node(self, material_root):
        material = next(material for material in self.snapshot['materials'] if material['root'].casefold() == material_root.casefold())
        directory = self.store_root / material['program']['directory']
        return json.loads((directory / 'program.json').read_text(encoding='utf-8')), json.loads((directory / 'graph.json').read_text(encoding='utf-8'))

    def test_the_skylevel_unit_passes_and_writes_its_catalog_record(self):
        self.assertEqual((self.row['key'], self.row['step'], self.row['status'], self.row['reason']), ('map:skylevel', 'shared-sky', 'pass', None))
        self.assertEqual(self.product['catalogRecord']['id'], 'skylevel')
        self.assertEqual(self.product['catalogRecord']['manifest'], self.product['manifest']['resource'])

    def test_the_118_0_level_gives_the_model_export_counts_and_zones_of_the_rm18_decode(self):
        binding = self.snapshot['levelModelBinding']
        self.assertEqual((binding['level']['reference'], binding['model']['reference']),
                         (SHARED_SKY_FIXTURES['levelExportIndex'], SHARED_SKY_FIXTURES['modelExportIndex']))
        self.assertEqual(binding['tail'], SKYLEVEL_LEVEL_MODEL_FIXTURE['levelBinding']['tail'])
        source = self.snapshot['source']
        self.assertEqual((source['modelSha256'], source['modelBytes']), (SKYLEVEL_LEVEL_MODEL_FIXTURE['exportSha256'], SKYLEVEL_LEVEL_MODEL_FIXTURE['exportBytes']))
        counts = SKYLEVEL_LEVEL_MODEL_FIXTURE['counts']
        self.assertEqual((counts['surfaces'], counts['nodes']), (SHARED_SKY_FIXTURES['surfaceCount'], SHARED_SKY_FIXTURES['nodeCount']))
        self.assertEqual(self.snapshot['skyZoneIndex'], SHARED_SKY_FIXTURES['skyZone']['zoneIndex'])

    def test_the_sky_zone_actor_is_skyzoneinfo0_at_the_rm21_eye_with_drawscale_unused_and_its_class_default_rotation(self):
        sky_zone = SHARED_SKY_FIXTURES['skyZone']
        self.assertEqual(self.snapshot['sourceSkyZone'], sky_zone['actor'])
        self.assertEqual(self.snapshot['sourceSkyZonePosition'], sky_zone['location'])
        x, y, z = sky_zone['location']
        self.assertEqual(self.snapshot['rootTranslationMetres'], [-x * 0.01, -z * 0.01, -y * 0.01])
        self.assertFalse(SHARED_SKY_FIXTURES['usesSkyDrawScale'])
        self.assertFalse(sky_zone['serializesRotation'])
        self.assertEqual((self.snapshot['sourceSkyZoneRotation']['provenance'], self.snapshot['sourceSkyZoneRotation']['value']), ('ue-zero', None))

    def test_every_sky_actor_property_payload_names_the_skylevel_map(self):
        self.assertTrue(self.snapshot['skyActorProperties'])
        self.assertEqual({prop['payload']['path'] for prop in self.snapshot['skyActorProperties']}, {'maps/skylevel.unr'})

    def test_the_rm21_pixel_node_keeps_its_surface_and_native_points(self):
        pixel_node = SHARED_SKY_FIXTURES['pixelNode']
        node_range = next(node_range for part in self.snapshot['parts'] for node_range in part['nodeRanges']
                          if node_range['node'] == pixel_node['nodeIndex'])
        self.assertEqual(node_range['surface'], pixel_node['surfaceIndex'])
        self.assertEqual(node_range['nativePositions'], [point['position'] for point in pixel_node['points']])

    def test_the_seven_roots_draw_every_surface_of_their_material_from_the_sky_zone(self):
        expected = {material.casefold(): count for material, count in SHARED_SKY_FIXTURES['surfaceCountsByMaterial'].items()}
        self.assertEqual({material: len({node_range['surface'] for node_range in part['nodeRanges']}) for material, part in self.parts.items()}, expected)
        self.assertEqual(self.product['counts']['materialRoots'], len(expected))
        drawn_nodes = sum(len(part['nodeRanges']) for part in self.parts.values())
        self.assertEqual((drawn_nodes, self.product['counts']['nodes']), (SHARED_SKY_FIXTURES['skyZonePolygonNodeCount'],) * 2)

    def test_skylevel_imports_starfield_final01_but_not_starfield_final02_or_cloud_final(self):
        from world.raw_map_step import read_map_lock_record
        from world.tile_chunk_plan import read_locked_map_package_by_path
        package = read_locked_map_package_by_path(REFERENCE_CLIENT, 'maps/skylevel.unr', read_map_lock_record('maps/skylevel.unr'))
        imported = {item['object'].casefold() for item in package.imports}
        self.assertIn('l2_skies.shaders.starfield_final01', imported)
        self.assertNotIn('l2_skies.shaders.starfield_final02', imported)
        self.assertNotIn('l2_skies.shaders.cloud_final', imported)

    def test_every_root_colour_alpha_and_blending_follows_the_rm21_material_rows(self):
        materials = {material['object'].casefold(): material for material in SHARED_SKY_FIXTURES['materials'] if material['referencedBySharedSkyBSP']}
        self.assertEqual(sorted(materials), sorted(self.parts))
        for material_root, material in materials.items():
            with self.subTest(material=material_root):
                blue, green, red, alpha = material['authoredOrDefaultColorBGRA']
                self.assertEqual(self.parts[material_root]['authoredColorRGBA'], [red, green, blue, alpha])
                self.assertEqual(self.parts[material_root]['alphaBlend'], material['AlphaBlend'])
                program, graph = self.program_root_node(material_root)
                self.assertEqual(graph['root'].casefold(), material_root)
                self.assertIn(material['exportIndex'], [node['exportIndex'] for node in graph['nodes']])
                if material['shaderOutputBlending'] is not None:
                    shader = next(node for node in program['nodes'] if node['class'] == 'Engine.Shader')
                    fields = {field['field']: field for field in shader['fields']}
                    self.assertEqual(fields['OutputBlending']['value']['ordinal'], material['shaderOutputBlending'])
                    self.assertEqual(fields['Opacity']['value'] is not None, material['hasOpacity'])

    def test_every_sh_cloud_keeps_the_one_authored_colour_of_the_rm21_sh_rows(self):
        sh_colours = {tuple(material['authoredOrDefaultColorBGRA']) for material in SHARED_SKY_FIXTURES['materials']
                      if material['referencedBySharedSkyBSP'] and material['object'].casefold().endswith('_sh')}
        self.assertEqual(len(sh_colours), 1)
        [(blue, green, red, alpha)] = sh_colours
        sh_parts = {material_root: part for material_root, part in self.parts.items() if material_root.endswith('_sh')}
        self.assertTrue(sh_parts)
        for material_root, part in sh_parts.items():
            with self.subTest(material=material_root):
                self.assertEqual(part['authoredColorRGBA'], [red, green, blue, alpha])

    def test_the_bundle_pins_its_glb_and_snapshot(self):
        bundle_folder = (self.store_root / self.product['manifest']['resource'].removeprefix('/l2/')).parent
        manifest = json.loads((bundle_folder / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual((manifest['kind'], manifest['map'], manifest['counts']['materialRoots']),
                         ('native-shared-sky-bundle', 'skylevel', len(SHARED_SKY_FIXTURES['surfaceCountsByMaterial'])))
        for name in ('sky.glb', 'sky.json', 'visibility.json', 'payload.bin'):
            payload = (bundle_folder / name).read_bytes()
            self.assertEqual(manifest['files'][name], {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()})

    def test_the_bundle_visibility_payload_is_the_committed_staged_fixture_and_parts_carry_the_rm24_sorting(self):
        bundle_folder = (self.store_root / self.product['manifest']['resource'].removeprefix('/l2/')).parent
        for name in ('visibility.json', 'payload.bin'):
            with self.subTest(name=name):
                self.assertEqual((bundle_folder / name).read_bytes(), (STAGED_SKY_VISIBILITY_FIXTURE / name).read_bytes())
        for part in self.snapshot['parts']:
            with self.subTest(material=part['sourceMaterial']):
                self.assertEqual(part['requiresSorting'], material_requires_sorting(part['sourceMaterial']))

    def test_every_material_file_the_step_writes_is_pinned_from_the_catalog_and_sealed_in_its_receipt(self):
        from native_store.catalog_writer import read_store_catalog
        from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER
        from native_store.pinned_store_verification import verify_pinned_store_files
        catalog, _ = read_store_catalog(self.store_root)
        pinned = {verified.relative for verified in verify_pinned_store_files(self.store_root, catalog, 1).values()}
        written = {path.relative_to(self.store_root).as_posix() for path in (self.store_root / NATIVE_MATERIALS_FOLDER).rglob('*') if path.is_file()}
        self.assertTrue(written)
        self.assertEqual(sorted(written - pinned), [])
        for material in self.snapshot['materials']:
            self.assertIn(f'{material["program"]["directory"]}/program.json', pinned)
        sealed = {output['path'] for output in shared_sky_ledger(self.scratch).sealed_receipt(SHARED_SKY_UNIT_KEY)['outputs']}
        self.assertEqual(sorted(f'{self.store_root.name}/{relative}' for relative in written if f'{self.store_root.name}/{relative}' not in sealed), [])


if __name__ == '__main__':
    unittest.main()
