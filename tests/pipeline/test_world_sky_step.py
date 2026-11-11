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
from world.sky_geometry import SKY_GLB_GENERATOR, SkyRootSurface, build_sky_glb, build_sky_zone_parts, sky_root_translation_metres, \
    sky_zone_material_identities
from world.sky_materials import SkyTextureUnsupported, external_reference_reasons, single_graph_texture_export
from world.sky_step import SKY_STEP_ALGORITHM_VERSION, SKY_STEP_NAME, alpha_source, presentation_field_gap, sky_bundle_files, tile_sky_row
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


def object_name(index):
    return OBJECT_NAMES.get(index)


def glb_chunks(glb):
    json_length = struct.unpack_from('<I', glb, 12)[0]
    binary_length = struct.unpack_from('<I', glb, 20 + json_length)[0]
    return json.loads(glb[20:20 + json_length]), glb[28 + json_length:28 + json_length + binary_length]


def texture_receipt(name):
    return {'sourceReference': f'Sky_T.Textures.{name}', 'width': 64, 'height': 32, 'png': {'file': f'{name}.png'}}


def synthetic_sky_model():
    return build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64), material=1, zones=(SKY_ZONE, SKY_ZONE)),
                                        synthetic_polygon(square_points(100, 0, 64), material=3, zones=(0, SKY_ZONE)),
                                        synthetic_polygon(square_points(200, 0, 64), material=4, zones=(SKY_ZONE, 0)),
                                        synthetic_polygon(square_points(300, 0, 64), material=3, zones=(0, 0)),
                                        synthetic_polygon(square_points(400, 0, 64), material=0, zones=(SKY_ZONE, SKY_ZONE))],
                                       zones=(synthetic_zone(), synthetic_zone(5)))


def root_surface(identity, texture_name):
    return SkyRootSurface(identity, identity, [206, 150, 0, 255], True, 'serialized', False, texture_receipt(texture_name))


class SkyZoneGeometryTests(unittest.TestCase):
    def test_material_roots_keep_first_node_order_and_fold_case(self):
        package = SimpleNamespace(object_name=object_name)
        self.assertEqual(sky_zone_material_identities(package, synthetic_sky_model(), SKY_ZONE), ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back'])

    def test_parts_draw_every_sky_zone_node_of_their_root_with_reversed_fans_and_stored_uvs(self):
        package = SimpleNamespace(object_name=object_name)
        parts = build_sky_zone_parts(package, synthetic_sky_model(), SKY_ZONE, [root_surface('Sky_T.Shaders.Haze', 'Ring')])
        [part] = parts
        self.assertEqual([node_range['node'] for node_range in part['nodeRanges']], [0, 2])
        self.assertEqual(part['indices'][:6], [0, 2, 1, 0, 3, 2])
        self.assertEqual(part['positions'][3:6], [struct.unpack('<f', struct.pack('<f', 0.64))[0], 0.0, 0.0])
        self.assertEqual(part['uvs'][2:4], [1.0, 0.0])

    def test_a_sky_zone_node_without_a_material_is_skipped_by_every_root(self):
        package = SimpleNamespace(object_name=object_name)
        roots = [root_surface('Sky_T.Shaders.Haze', 'Ring'), root_surface('Sky_T.Shaders.Back', 'Chip')]
        parts = build_sky_zone_parts(package, synthetic_sky_model(), SKY_ZONE, roots)
        self.assertEqual([[node_range['node'] for node_range in part['nodeRanges']] for part in parts], [[0, 2], [1]])

    def test_the_root_translation_is_minus_the_sky_zone_location_in_browser_axes(self):
        self.assertEqual(sky_root_translation_metres([100.0, 200.0, 300.0]), [-1.0, -3.0, -2.0])

    def test_the_glb_holds_one_child_node_and_one_material_per_root(self):
        package = SimpleNamespace(object_name=object_name)
        roots = [root_surface('Sky_T.Shaders.Haze', 'Ring'), root_surface('Sky_T.Shaders.Back', 'Chip')]
        snapshot = {'id': f'interlude:{TILE_ID}.Model1.SkyZoneInfo0', 'rootTranslationMetres': [0.0, 0.0, 0.0],
                    'parts': build_sky_zone_parts(package, synthetic_sky_model(), SKY_ZONE, roots)}
        document, binary = glb_chunks(build_sky_glb(snapshot, {'Ring.png': b'ring-png', 'Chip.png': b'chip-png'}))
        self.assertEqual(document['nodes'][0]['children'], [1, 2])
        self.assertEqual([material['name'] for material in document['materials']], ['Sky_T.Shaders.Haze', 'Sky_T.Shaders.Back'])
        self.assertEqual(document['asset']['generator'], SKY_GLB_GENERATOR)
        self.assertIn(b'ring-png', binary)
        self.assertEqual(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'], [206 / 255, 150 / 255, 0, 1])


class SkyMaterialTests(unittest.TestCase):
    def test_a_root_without_its_color_or_with_untyped_flags_is_a_named_feature_gap(self):
        color = {'value': {'rawHex': 'ce9600ff'}}
        complete = {'Color': color, 'AlphaBlend': {'value': True}, 'RenderTwoSided': {'value': False}}
        self.assertIsNone(presentation_field_gap(complete))
        self.assertEqual(presentation_field_gap({**complete, 'Color': {'value': None}}), 'material-feature-unported:Color')
        self.assertEqual(presentation_field_gap({key: value for key, value in complete.items() if key != 'AlphaBlend'}),
                         'material-feature-unported:AlphaBlend')

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
        self.assertEqual((SKY_STEP_NAME, SKY_STEP_ALGORITHM_VERSION), ('sky', 1))
        self.assertIn('sky', load_tile_manifest_vocabulary(ROOT).resource_kinds)
        patterns = load_gap_reason_patterns(ROOT)
        for reason in ('sky-zone-ambiguous:2', 'sky-material-external:Other_T', 'sky-texture-format-unsupported:0', 'sky-material-texture-count:2'):
            self.assertTrue(is_listed_reason(reason, patterns), reason)

    def test_an_ambiguous_sky_zone_is_a_gap_row_and_a_sealed_sky_leaves_pending(self):
        gaps = TileStepGapRows(TILE_ID, SKY_STEP_NAME, SOURCE_IDENTITY, EVIDENCE)
        gaps.add('gap', 'sky-zone-ambiguous:2')
        product = {'manifest': None, 'gapRows': gaps.rows()}
        self.assertEqual(tile_sky_row(TILE_ID, SOURCE_IDENTITY, product['gapRows'], EVIDENCE)['reason'], 'sky-zone-ambiguous:2')
        self.assertEqual(tile_resources(None, None, None, None, product), [])
        self.assertNotIn('sky', pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, None, None, None, None, product))
        rows = tile_level_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, None, None, None, None, None, None, product)
        self.assertEqual([row['reason'] for row in rows if row['step'] == 'sky'], ['sky-zone-ambiguous:2'])

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
    @staticmethod
    def converted_sky_files(tile_id):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from native_store.store_paths import REPOSITORY_ROOT, lane_work_root
        from world.level_model import read_level_model
        from world.level_zones import read_level_zones, sky_zone_indices
        from world.raw_map_step import read_tile_map_lock_record
        from world.sky_step import convert_tile_sky
        from world.static_placement import ClassDefaults
        from world.tile_chunk_plan import read_locked_map_package
        lock_record = read_tile_map_lock_record(tile_id)
        package = read_locked_map_package(REFERENCE_CLIENT, tile_id, lock_record)
        level = read_level_model(package)
        zones = read_level_zones(package, level.model, ClassDefaults(lane_work_root(REPOSITORY_ROOT, 'world'), ReferenceClientClassScripts(REFERENCE_CLIENT)))
        [zone_index] = sorted(sky_zone_indices(zones))
        gaps = TileStepGapRows(tile_id, SKY_STEP_NAME, {'path': f'maps/{tile_id}.unr', 'sha256': lock_record['eSha256']}, EVIDENCE)
        converted = convert_tile_sky(REPOSITORY_ROOT, REFERENCE_CLIENT.resolve(), tile_id, lock_record, package, level, zone_index, gaps)
        return converted, gaps.rows()

    def test_the_generic_20_20_sky_glb_matches_the_served_sky_except_its_generator(self):
        served = (SERVED_SKY_FOLDER / 'sky.glb').read_bytes()
        self.assertEqual(hashlib.sha256(served).hexdigest(), SERVED_SKY_GLB_SHA256)
        converted, gap_rows = self.converted_sky_files('20_20')
        self.assertEqual(gap_rows, [])
        generic_document, generic_binary = glb_chunks(converted.files['sky.glb'])
        served_document, served_binary = glb_chunks(served)
        self.assertEqual(generic_binary, served_binary)
        self.assertEqual(generic_document['asset'].pop('generator'), SKY_GLB_GENERATOR)
        served_document['asset'].pop('generator')
        self.assertEqual(generic_document, served_document)
        self.assertEqual(converted.counts, {'nodes': 53, 'vertices': 182, 'triangles': 76, 'materialRoots': 3, 'textures': 3})

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
