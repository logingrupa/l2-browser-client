from pathlib import Path
import struct
from types import SimpleNamespace
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import ClassDefaultError, ReferenceClientClassScripts
from native_catalog.ue2 import Package
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from support.actor_class_defaults import SyntheticActorClassDefaults
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from synthetic_class_scripts import scratch_work_root_with_world_class_default_cache
from ue2_package_fixture import compact, package_bytes, tag
from world.actor_field_values import AUTHORED_PROVENANCE, UNRESOLVED_PROVENANCE
from world.bsp_step import sealed_bsp_chunks
from world.level_model import read_level_model
from world.level_zones import outdoor_zone_indices, read_level_zones, sky_zone_indices
from world.light_actors import ClassChains, reference_client_class_chains
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement import ClassDefaults
from world.world_lane_names import WORLD_LANE_NAME
from world.tile_chunk_plan import ChunkPlanStepError, read_locked_map_package

BOOL_PROPERTY_TYPE = 3
FLOAT_PROPERTY_TYPE = 4
STRUCT_PROPERTY_TYPE = 10
BOOL_TRUE_BIT = 128
ZONE_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'ZoneInfo'), ('Core', 'Class', -1, 'SkyZoneInfo'), ('Core', 'Class', -1, 'LevelInfo')]
ZONE_INFO_CLASS_IMPORT = -2
SKY_ZONE_INFO_CLASS_IMPORT = -3
LEVEL_INFO_CLASS_IMPORT = -4
PROPERTY_NAMES = ['bSunAffect', 'DistanceFogColor', 'Color', 'DistanceFogEnd', 'bTerrainZone']
ZONE_INFO = 'Engine.ZoneInfo'
SKY_ZONE_INFO = 'Engine.SkyZoneInfo'
LEVEL_INFO = 'Engine.LevelInfo'
ZONE_DEFAULTS = {
    'bSunAffect': (True, 'class-default', ZONE_INFO), 'AmbientVector': (None, 'ue-zero', ZONE_INFO), 'AmbientBrightness': (None, 'ue-zero', ZONE_INFO),
    'AmbientHue': (None, 'ue-zero', ZONE_INFO), 'AmbientSaturation': (255, 'authored', ZONE_INFO), 'bDistanceFog': (None, 'ue-zero', ZONE_INFO),
    'bTerrainZone': (None, 'ue-zero', ZONE_INFO), 'DistanceFogColor': ({'A': 0, 'B': 128, 'G': 128, 'R': 128}, 'class-default', ZONE_INFO), 'DistanceFogStart': (3000.0, 'class-default', ZONE_INFO),
    'DistanceFogEnd': (8000.0, 'class-default', ZONE_INFO), 'DistanceFogBlendTime': (None, 'ue-zero', ZONE_INFO)}
CLASS_DEFAULTS = SyntheticActorClassDefaults({ZONE_INFO: ZONE_DEFAULTS, SKY_ZONE_INFO: ZONE_DEFAULTS, LEVEL_INFO: ZONE_DEFAULTS})
ZONE_CLASS_CHAIN_NAMES = {ZONE_INFO: (ZONE_INFO,), SKY_ZONE_INFO: (SKY_ZONE_INFO, ZONE_INFO), LEVEL_INFO: (LEVEL_INFO, ZONE_INFO)}


def read_zone_class_chain(class_name):
    if class_name not in ZONE_CLASS_CHAIN_NAMES:
        raise ClassDefaultError(f'no class script for {class_name}')
    return [{'identity': {'object': name}, 'declaredFields': []} for name in ZONE_CLASS_CHAIN_NAMES[class_name]]


def zone_class_chains():
    return ClassChains(CLASS_DEFAULTS, read_zone_class_chain)


def level_with_actors(model, references):
    return SimpleNamespace(model=model, binding={'actorArrays': [{'nativeField': '0x38', 'references': list(references)}]})


def bool_tag(names, name, value):
    return compact(names[name]) + bytes([BOOL_PROPERTY_TYPE | (BOOL_TRUE_BIT if value else 0)])


def indoor_zone_body(offset, names):
    sun = bool_tag(names, 'bSunAffect', False) + bool_tag(names, 'bTerrainZone', True)
    fog_color = tag(names, 'DistanceFogColor', STRUCT_PROPERTY_TYPE, bytes([10, 20, 30, 40]), 'Color')
    fog_end = tag(names, 'DistanceFogEnd', FLOAT_PROPERTY_TYPE, struct.pack('<f', 12000.0))
    return sun + fog_color + fog_end + compact(names['None'])


def synthetic_zone_package():
    exports = [{'name': 'ZoneInfo3', 'class': ZONE_INFO_CLASS_IMPORT, 'body': indoor_zone_body},
               {'name': 'SkyZoneInfo0', 'class': SKY_ZONE_INFO_CLASS_IMPORT, 'body': lambda offset, names: compact(names['None'])},
               {'name': 'LevelInfo0', 'class': LEVEL_INFO_CLASS_IMPORT, 'body': lambda offset, names: compact(names['None'])}]
    return Package(package_bytes(PROPERTY_NAMES, ZONE_IMPORTS, exports), '00_00.unr')


def synthetic_zone_model():
    return build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64))],
                                       zones=(synthetic_zone(0), synthetic_zone(1), synthetic_zone(2), synthetic_zone(0)))


class LevelZoneTableTests(unittest.TestCase):
    def setUp(self):
        self.zones = read_level_zones(synthetic_zone_package(), level_with_actors(synthetic_zone_model(), []), CLASS_DEFAULTS, zone_class_chains())

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

    def test_the_zone_fog_fields_carry_the_terrain_zone_flag_that_routes_the_empty_fog_list(self):
        indoor, sky = self.zones[1], self.zones[2]
        self.assertEqual([field['field'] for field in indoor.to_record()['distanceFog']],
                         ['bDistanceFog', 'bTerrainZone', 'DistanceFogColor', 'DistanceFogStart', 'DistanceFogEnd', 'DistanceFogBlendTime'])
        self.assertEqual((self.field(indoor, 'bTerrainZone').value, self.field(indoor, 'bTerrainZone').provenance), (True, AUTHORED_PROVENANCE))
        self.assertEqual((self.field(sky, 'bTerrainZone').value, self.field(sky, 'bTerrainZone').provenance), (None, 'ue-zero'))

    def test_sun_resolution_sets_the_outdoor_class_and_zone_zero_is_always_outdoor(self):
        self.assertEqual(outdoor_zone_indices(self.zones), frozenset({0, 2}))
        self.assertEqual([zone.outdoor for zone in self.zones], [True, False, True, False])

    def test_the_sky_class_comes_from_the_zone_actor_class(self):
        self.assertEqual(sky_zone_indices(self.zones), frozenset({2}))
        self.assertEqual([zone.class_bits for zone in self.zones], [1 | 4, 0, 1, 4])

    def test_a_zone_without_an_actor_is_unresolved_and_listed(self):
        actorless = self.zones[3]
        self.assertTrue(actorless.unresolved)
        self.assertEqual({field.provenance for field in (actorless.sun_affect, *actorless.ambient, *actorless.distance_fog)}, {UNRESOLVED_PROVENANCE})

    def test_an_import_or_out_of_table_zone_actor_reference_is_unresolved(self):
        model = build_synthetic_level_model([], zones=(synthetic_zone(), synthetic_zone(9), synthetic_zone(-3)))
        zones = read_level_zones(synthetic_zone_package(), level_with_actors(model, []), CLASS_DEFAULTS, zone_class_chains())
        self.assertEqual([(zone.actor, zone.unresolved, zone.outdoor) for zone in zones], [(None, True, True), (None, True, False), (None, True, False)])

    def test_a_zone_with_actor_reference_zero_reads_the_level_info_as_get_zone_actor_does(self):
        zones = read_level_zones(synthetic_zone_package(), level_with_actors(synthetic_zone_model(), [3, 1, 2]), CLASS_DEFAULTS, zone_class_chains())
        self.assertEqual([(zone.actor, zone.level_info_fallback, zone.unresolved) for zone in zones],
                         [('00_00.LevelInfo0', True, False), ('00_00.ZoneInfo3', False, False), ('00_00.SkyZoneInfo0', False, False),
                          ('00_00.LevelInfo0', True, False)])
        self.assertEqual((zones[0].sun_affect.value, zones[0].sun_affect.provenance), (True, 'class-default'))
        self.assertEqual(zones[0].to_record()['levelInfoFallback'], True)
        self.assertEqual([zone.class_bits for zone in zones], [1, 0, 1, 1])

    def test_actors_zero_that_is_not_a_level_info_leaves_actorless_zones_unresolved(self):
        zones = read_level_zones(synthetic_zone_package(), level_with_actors(synthetic_zone_model(), [1, 3]), CLASS_DEFAULTS, zone_class_chains())
        self.assertEqual([(zone.actor, zone.unresolved) for zone in zones][0], (None, True))

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

    def test_the_outdoor_and_sky_zone_sets_of_20_21_equal_the_sealed_bsp_product(self):
        lock_record = read_tile_map_lock_record(REAL_TILE_ID)
        try:
            _, bsp = sealed_bsp_chunks(ROOT, REAL_TILE_ID, lock_record)
        except ChunkPlanStepError as error:
            self.skipTest(f'the raw and chunk plan units of {REAL_TILE_ID} are not sealed in this lane: {error}')
        if bsp is None:
            self.skipTest(f'the bsp unit of {REAL_TILE_ID} is not sealed in this lane')
        package = read_locked_map_package(REAL_CLIENT_ROOT, REAL_TILE_ID, lock_record)
        class_defaults = ClassDefaults(scratch_work_root_with_world_class_default_cache(self.addCleanup, 'level-zones-class-defaults-'),
                                       ReferenceClientClassScripts(REAL_CLIENT_ROOT))
        zones = read_level_zones(package, read_level_model(package), class_defaults, reference_client_class_chains(class_defaults))
        self.assertEqual(sorted(outdoor_zone_indices(zones)), bsp['outdoorZones'])
        self.assertEqual(sorted(sky_zone_indices(zones)), bsp['skyZones'])


if __name__ == '__main__':
    unittest.main()
