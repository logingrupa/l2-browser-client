import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from world.lighting_payload import static_mesh_ambient_zone_arrays
from world.raw_map_step import read_tile_map_lock_record
from world.static_mesh_ambient_zones import (AmbientActorFields, StaticMeshAmbientZones, actor_ambient_zones, ambient_field_refusal,
                                             static_mesh_ambient_zones_unresolved_reasons, transformed_box)

REFERENCE_CLIENT = Path('E:/Lineage2-client')
RM20_FIXTURES_PATH = ROOT / 'tests/fixtures/environment/static-mesh-ambient-rm20-fixtures.json'
RM20_FIXTURES = json.loads(RM20_FIXTURES_PATH.read_text(encoding='utf-8'))['fixtures']
PLAIN_FIELDS = AmbientActorFields(0, 8, None, 0, None, False, 0, False)


def arrays_by_name(arrays):
    return {typed_array.name: typed_array.values for typed_array in arrays}


class TransformedBoxTests(unittest.TestCase):
    def test_every_rm20_fixture_box_transforms_to_the_native_world_box(self):
        for fixture in RM20_FIXTURES:
            with self.subTest(actor=fixture['actorExportIndex']):
                self.assertEqual(list(transformed_box(fixture['localBox'], fixture['localToWorld'])), fixture['worldBox'])


class AmbientFieldRefusalTests(unittest.TestCase):
    def test_a_plain_static_mesh_actor_is_not_refused(self):
        self.assertIsNone(ambient_field_refusal(PLAIN_FIELDS))
        self.assertIsNone(ambient_field_refusal(PLAIN_FIELDS._replace(forced_region_tag='None', ambient_glow=40, unlit=True)))

    def test_each_field_the_native_producer_reads_beyond_the_box_is_a_named_refusal(self):
        for fields, detail in ((PLAIN_FIELDS._replace(physics=5), 'Physics 5 widens the render box'),
                               (PLAIN_FIELDS._replace(draw_type=10), 'DrawType 10 widens the render box'),
                               (PLAIN_FIELDS._replace(forced_region_tag='hall'), 'ForcedRegionTag or ForcedRegion filters BoxLeaves'),
                               (PLAIN_FIELDS._replace(forced_region=2), 'ForcedRegionTag or ForcedRegion filters BoxLeaves'),
                               (PLAIN_FIELDS._replace(forced_visibility_zone_tag='hall'), 'ForcedVisibilityZoneTag filters the touched zones'),
                               (PLAIN_FIELDS._replace(use_lighting_from_base=True), 'bUseLightingFromBase reads the AmbientGlow of the Base actor'),
                               (PLAIN_FIELDS._replace(ambient_glow=255), 'AmbientGlow 255 pulses with the level time')):
            with self.subTest(detail=detail):
                self.assertEqual(ambient_field_refusal(fields), detail)


class ActorAmbientZonesTests(unittest.TestCase):
    def actor_zones(self, requests_by_reference, load_mesh_package, fields=(PLAIN_FIELDS, None), local_to_world=((1.0,) * 16, None)):
        actor = {'exportIndex': 7, 'staticMesh': {'object': 'pkg.mesh'}}
        with (mock.patch('world.static_mesh_ambient_zones.read_ambient_actor_fields', return_value=fields),
              mock.patch('world.static_mesh_ambient_zones.native_local_to_world', return_value=local_to_world)):
            return actor_ambient_zones(None, None, actor, None, requests_by_reference, load_mesh_package)

    def test_an_unresolved_field_a_missing_request_a_transform_refusal_or_an_unreadable_box_keeps_its_detail(self):
        def unreadable(_):
            raise FormatError('pkg.usx holds 0 StaticMesh exports named pkg.mesh\nsecond line')
        request = {'pkg.mesh': {'package': 'staticmeshes/pkg.usx', 'object': 'pkg.mesh'}}
        cases = ((self.actor_zones(request, unreadable, fields=(None, 'AmbientGlow unresolved')), 'AmbientGlow unresolved'),
                 (self.actor_zones({}, unreadable), 'StaticMesh reference has no static mesh request'),
                 (self.actor_zones(request, unreadable, local_to_world=(None, 'Singular static actor scale')), 'Singular static actor scale'),
                 (self.actor_zones(request, unreadable), 'pkg.usx holds 0 StaticMesh exports named pkg.mesh'))
        for row, detail in cases:
            with self.subTest(detail=detail):
                self.assertEqual(row, StaticMeshAmbientZones(7, (), 0, False, detail))
        self.assertEqual(static_mesh_ambient_zones_unresolved_reasons([row for row, _ in cases]),
                         sorted(f'static-mesh-ambient-zones-unresolved:{detail}' for _, detail in cases))


class AmbientZoneArrayTests(unittest.TestCase):
    def test_each_static_mesh_actor_stages_its_touched_zones_glow_and_unlit_flag_and_an_unresolved_actor_stages_none(self):
        rows = (StaticMeshAmbientZones(950, (1, 24), 0, False, None), StaticMeshAmbientZones(951, (), 0, False, 'AmbientGlow unresolved'),
                StaticMeshAmbientZones(952, (5,), 40, True, None))
        self.assertEqual(arrays_by_name(static_mesh_ambient_zone_arrays(rows)),
                         {'SMAZ.actorExportIndex': (950, 951, 952), 'SMAZ.resolved': (1, 0, 1), 'SMAZ.ambientGlow': (0, 0, 40), 'SMAZ.unlit': (0, 0, 1),
                          'SMAZ.zoneStart': (0, 2, 2, 3), 'SMAZ.zone': (1, 24, 5)})


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class RealClientAmbientZonesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from world.level_model import read_level_model
        from world.tile_chunk_plan import read_locked_map_package
        cls.package = read_locked_map_package(REFERENCE_CLIENT, '20_20', read_tile_map_lock_record('20_20'))
        cls.model = read_level_model(cls.package).model

    def reference_class_defaults(self):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from synthetic_class_scripts import scratch_work_root_with_world_class_default_cache
        from world.static_placement import ClassDefaults
        return ClassDefaults(scratch_work_root_with_world_class_default_cache(self.addCleanup, 'ambient-zones-reference-class-defaults-'),
                             ReferenceClientClassScripts(REFERENCE_CLIENT))

    def fixture_actor(self, fixture):
        from world.map_actor_properties import TRANSFORMS, actor_properties, decode_property, explicit_properties
        export = self.package.exports[fixture['actorExportIndex'] - 1]
        properties = [decode_property(self.package, tag, 'raw/map.unwrapped.bin') for tag in actor_properties(self.package, export)[0]]
        return {'exportIndex': export['exportIndex'], 'classObject': export['classObject'], 'staticMesh': {'object': fixture['mesh']},
                'sourceTransform': explicit_properties(properties, TRANSFORMS)}

    def test_the_native_box_leaves_of_each_rm20_world_box_reach_the_listed_leaves(self):
        from world.bsp_leaf_membership import leaves_for_box
        for fixture in RM20_FIXTURES:
            with self.subTest(actor=fixture['actorExportIndex']):
                world_box = fixture['worldBox']
                center = tuple((world_box[axis] + world_box[3 + axis]) * 0.5 for axis in range(3))
                half_extent = tuple((world_box[3 + axis] - world_box[axis]) * 0.5 for axis in range(3))
                self.assertEqual(leaves_for_box(self.model, center, half_extent), tuple(sorted(fixture['leafIndices'])))

    def test_each_rm20_actor_stages_the_zones_its_mesh_bounding_box_touches_and_an_authored_forced_region_tag_is_refused(self):
        from reference_client_guard import require_reference_client
        from world.static_mesh_step import StaticMeshPackages
        class_defaults = self.reference_class_defaults()
        load_mesh_package = StaticMeshPackages(require_reference_client(REFERENCE_CLIENT))
        forced_region_tag_actors = {950: 'ForcedRegionTag or ForcedRegion filters BoxLeaves'}
        for fixture in RM20_FIXTURES:
            actor_export_index = fixture['actorExportIndex']
            with self.subTest(actor=actor_export_index):
                package_name = fixture['mesh'].split('.')[0].lower()
                requests = {fixture['mesh']: {'package': f'staticmeshes/{package_name}.usx', 'object': fixture['mesh']}}
                row = actor_ambient_zones(self.package, self.model, self.fixture_actor(fixture), class_defaults, requests, load_mesh_package)
                expected = (StaticMeshAmbientZones(actor_export_index, (), 0, False, forced_region_tag_actors[actor_export_index])
                            if actor_export_index in forced_region_tag_actors
                            else StaticMeshAmbientZones(actor_export_index, tuple(fixture['zoneIndices']), fixture['ambientGlow'], False, None))
                self.assertEqual(row, expected)


if __name__ == '__main__':
    unittest.main()
