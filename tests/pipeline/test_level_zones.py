from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_catalog.ue2 import Package
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from support.actor_class_defaults import SyntheticActorClassDefaults
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from ue2_package_fixture import compact, package_bytes, tag
from world.actor_field_values import AUTHORED_PROVENANCE, UNRESOLVED_PROVENANCE
from world.bsp_step import sealed_bsp_chunks
from world.level_model import read_level_model
from world.level_zones import outdoor_zone_indices, read_level_zones, sky_zone_indices
from world.raw_map_step import read_tile_map_lock_record
from world.sky_step import sealed_sky
from world.static_placement import ClassDefaults
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import read_locked_map_package

BOOL_PROPERTY_TYPE = 3
FLOAT_PROPERTY_TYPE = 4
STRUCT_PROPERTY_TYPE = 10
BOOL_TRUE_BIT = 128
ZONE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'ZoneInfo'), ('Core', 'Class', -1, 'SkyZoneInfo')]
ZONE_INFO_CLASS_IMPORT = -2
SKY_ZONE_INFO_CLASS_IMPORT = -3
PROPERTY_NAMES = ['bSunAffect', 'DistanceFogColor', 'Color', 'DistanceFogEnd']
ZONE_INFO = 'Engine.ZoneInfo'
SKY_ZONE_INFO = 'Engine.SkyZoneInfo'
ZONE_DEFAULTS = {
    'bSunAffect': (True, 'class-default', ZONE_INFO), 'AmbientVector': (None, 'ue-zero', ZONE_INFO), 'AmbientBrightness': (None, 'ue-zero', ZONE_INFO),
    'AmbientHue': (None, 'ue-zero', ZONE_INFO), 'AmbientSaturation': (255, 'authored', ZONE_INFO), 'bDistanceFog': (None, 'ue-zero', ZONE_INFO),
    'DistanceFogColor': ({'A': 0, 'B': 128, 'G': 128, 'R': 128}, 'class-default', ZONE_INFO), 'DistanceFogStart': (3000.0, 'class-default', ZONE_INFO),
    'DistanceFogEnd': (8000.0, 'class-default', ZONE_INFO)}
CLASS_DEFAULTS = SyntheticActorClassDefaults({ZONE_INFO: ZONE_DEFAULTS, SKY_ZONE_INFO: ZONE_DEFAULTS})


def bool_tag(names, name, value):
    return compact(names[name]) + bytes([BOOL_PROPERTY_TYPE | (BOOL_TRUE_BIT if value else 0)])


def indoor_zone_body(offset, names):
    sun = bool_tag(names, 'bSunAffect', False)
    fog_color = tag(names, 'DistanceFogColor', STRUCT_PROPERTY_TYPE, bytes([10, 20, 30, 40]), 'Color')
    fog_end = tag(names, 'DistanceFogEnd', FLOAT_PROPERTY_TYPE, struct.pack('<f', 12000.0))
    return sun + fog_color + fog_end + compact(names['None'])


def synthetic_zone_package():
    exports = [{'name': 'ZoneInfo3', 'class': ZONE_INFO_CLASS_IMPORT, 'body': indoor_zone_body},
               {'name': 'SkyZoneInfo0', 'class': SKY_ZONE_INFO_CLASS_IMPORT, 'body': lambda offset, names: compact(names['None'])}]
    return Package(package_bytes(PROPERTY_NAMES, ZONE_IMPORTS, exports), '00_00.unr')


def synthetic_zone_model():
    return build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64))],
                                       zones=(synthetic_zone(0), synthetic_zone(1), synthetic_zone(2), synthetic_zone(0)))


class LevelZoneTableTests(unittest.TestCase):
    def setUp(self):
        self.zones = read_level_zones(synthetic_zone_package(), synthetic_zone_model(), CLASS_DEFAULTS)

    def field(self, zone, name):
        return next(field for field in (zone.sun_affect, *zone.ambient, *zone.distance_fog) if field.field == name)

    def test_one_row_per_zone_index_with_its_actor_and_class(self):
        self.assertEqual([(zone.zone_index, zone.actor, zone.actor_class) for zone in self.zones],
                         [(0, None, None), (1, '00_00.ZoneInfo3', ZONE_INFO), (2, '00_00.SkyZoneInfo0', SKY_ZONE_INFO), (3, None, None)])

    def test_serialized_fields_are_authored_and_omitted_fields_carry_class_default_provenance(self):
        indoor = self.zones[1]
        self.assertEqual((indoor.sun_affect.value, indoor.sun_affect.provenance), (False, AUTHORED_PROVENANCE))
        self.assertEqual(list(self.field(indoor, 'DistanceFogColor').value.items()), [('B', 10), ('G', 20), ('R', 30), ('A', 40)])
        self.assertEqual(self.field(indoor, 'DistanceFogEnd').to_record(),
                         {'field': 'DistanceFogEnd', 'value': 12000.0, 'provenance': AUTHORED_PROVENANCE, 'declaringClass': ZONE_INFO})
        self.assertEqual(self.field(indoor, 'DistanceFogStart').to_record(),
                         {'field': 'DistanceFogStart', 'value': 3000.0, 'provenance': 'class-default', 'declaringClass': ZONE_INFO})
        self.assertEqual(self.field(indoor, 'AmbientBrightness').provenance, 'ue-zero')
        self.assertEqual(self.field(indoor, 'AmbientSaturation').provenance, 'class-default')

    def test_sun_resolution_sets_the_outdoor_class_and_zone_zero_is_always_outdoor(self):
        self.assertEqual(outdoor_zone_indices(self.zones), frozenset({0, 2}))
        self.assertEqual([zone.outdoor for zone in self.zones], [True, False, True, False])

    def test_the_sky_class_comes_from_the_zone_actor_class(self):
        self.assertEqual(sky_zone_indices(self.zones), frozenset({2}))
        self.assertEqual([zone.class_bits for zone in self.zones], [1 | 4, 0, 1 | 2, 4])

    def test_a_zone_without_an_actor_is_unresolved_and_listed(self):
        actorless = self.zones[3]
        self.assertTrue(actorless.unresolved)
        self.assertEqual({field.provenance for field in (actorless.sun_affect, *actorless.ambient, *actorless.distance_fog)}, {UNRESOLVED_PROVENANCE})

    def test_an_import_or_out_of_table_zone_actor_reference_is_unresolved(self):
        model = build_synthetic_level_model([], zones=(synthetic_zone(), synthetic_zone(9), synthetic_zone(-3)))
        zones = read_level_zones(synthetic_zone_package(), model, CLASS_DEFAULTS)
        self.assertEqual([(zone.actor, zone.unresolved, zone.outdoor) for zone in zones], [(None, True, True), (None, True, False), (None, True, False)])

    def test_connectivity_and_visibility_masks_come_from_the_model_zones(self):
        self.assertEqual({(zone.connectivity, zone.visibility) for zone in self.zones}, {((1 << 64) - 1, (1 << 64) - 1)})


REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
REAL_TILE_ID = '20_21'


def real_client_skip_reason():
    if not REAL_CLIENT_ROOT.is_dir():
        return 'the conversion client E:/Lineage2-client is absent on this host'
    if not REFERENCE_CLIENT_LOCK_PATH.is_file():
        return 'the reference client lock is absent'
    return None


@unittest.skipIf(real_client_skip_reason() is not None, real_client_skip_reason() or '')
class RealMapZoneInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            require_batch_preflight(ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        except BatchPreflightRefusedError as error:
            raise unittest.SkipTest(f'the real-map zone input check waits for the batch preflight: {error}')
        run_at_below_normal_priority()

    def test_the_outdoor_and_sky_zone_sets_of_20_21_equal_the_sealed_bsp_and_sky_products(self):
        lock_record = read_tile_map_lock_record(REAL_TILE_ID)
        _, bsp = sealed_bsp_chunks(ROOT, REAL_TILE_ID, lock_record)
        _, sky = sealed_sky(ROOT, REAL_TILE_ID, lock_record)
        if bsp is None or sky is None:
            self.skipTest(f'the bsp and sky units of {REAL_TILE_ID} are not sealed in this lane')
        package = read_locked_map_package(REAL_CLIENT_ROOT, REAL_TILE_ID, lock_record)
        class_defaults = ClassDefaults(lane_work_root(ROOT, WORLD_LANE_NAME), ReferenceClientClassScripts(REAL_CLIENT_ROOT))
        zones = read_level_zones(package, read_level_model(package).model, class_defaults)
        self.assertEqual(sorted(outdoor_zone_indices(zones)), bsp['outdoorZones'])
        self.assertEqual(sorted(sky_zone_indices(zones)), bsp['skyZones'])
        self.assertEqual(sorted(sky_zone_indices(zones)), sky['skyZones'])


if __name__ == '__main__':
    unittest.main()
