from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError, Package
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from world.lighting_payload import terrain_intensity_map_arrays
from world.lighting_step import terrain_intensity_map_outcome
from world.terrain_intensity_maps import read_terrain_intensity_maps
from ue2_package_fixture import compact, package_bytes, tag

INTEGER_PROPERTY_TYPE = 2
FLOAT_PROPERTY_TYPE = 4
ARRAY_PROPERTY_TYPE = 9
PROPERTY_NAMES = ['TIntMap', 'NumIntMap', 'Time', 'Intensity']
HEIGHTMAP_EDGE = 2
SEAMLESS_SAMPLES = (HEIGHTMAP_EDGE + 1) ** 2
MAP_TIMES = (6.0, 18.0)
MAP_INTENSITIES = (bytes(range(SEAMLESS_SAMPLES)), bytes(range(100, 100 + SEAMLESS_SAMPLES)))


def intensity_map_element(names, time, intensity):
    return (tag(names, 'Time', FLOAT_PROPERTY_TYPE, struct.pack('<f', time))
            + tag(names, 'Intensity', ARRAY_PROPERTY_TYPE, compact(len(intensity)) + intensity) + compact(names['None']))


def terrain_info_body(times=MAP_TIMES, intensities=MAP_INTENSITIES, declared_count=None):
    def body(offset, names):
        elements = compact(len(times)) + b''.join(intensity_map_element(names, time, values) for time, values in zip(times, intensities))
        count = len(times) if declared_count is None else declared_count
        return (tag(names, 'NumIntMap', INTEGER_PROPERTY_TYPE, struct.pack('<i', count))
                + tag(names, 'TIntMap', ARRAY_PROPERTY_TYPE, elements) + compact(names['None']))
    return body


def terrain_of(body):
    exports = [{'name': 'TerrainInfo0', 'class': -2, 'body': body}]
    package = Package(package_bytes(PROPERTY_NAMES, [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'TerrainInfo')], exports), '00_00.unr')
    return package, {'object': package.exports[0]['object'], 'exportIndex': 1, 'width': HEIGHTMAP_EDGE, 'height': HEIGHTMAP_EDGE}


class TerrainIntensityMapTests(unittest.TestCase):
    def test_every_map_keeps_its_authored_time_and_its_seamless_samples(self):
        intensity_maps = read_terrain_intensity_maps(*terrain_of(terrain_info_body()))
        self.assertEqual((intensity_maps.times, intensity_maps.width, intensity_maps.height), (MAP_TIMES, 3, 3))
        self.assertEqual(intensity_maps.intensities, MAP_INTENSITIES)
        named = {typed_array.name: typed_array.values for typed_array in terrain_intensity_map_arrays(intensity_maps)}
        self.assertEqual((named['TINT.time'], named['TINT.width'], named['TINT.height']), (MAP_TIMES, (3,), (3,)))
        self.assertEqual(bytes(named['TINT.intensity']), b''.join(MAP_INTENSITIES))

    def test_a_terrain_without_intensity_maps_writes_empty_arrays(self):
        package, terrain = terrain_of(lambda offset, names: compact(names['None']))
        named = {typed_array.name: typed_array.values for typed_array in terrain_intensity_map_arrays(read_terrain_intensity_maps(package, terrain))}
        self.assertEqual((named['TINT.time'], named['TINT.intensity'], named['TINT.width']), ((), (), (3,)))

    def test_a_count_a_sample_total_or_a_time_order_that_disagrees_is_refused(self):
        cases = ((terrain_info_body(declared_count=3), 'NumIntMap is 3, but TIntMap holds 2 maps'),
                 (terrain_info_body(intensities=(bytes(4), bytes(4))), 'holds 4 intensity samples, not the 9'),
                 (terrain_info_body(times=(18.0, 6.0)), 'are not strictly ascending'))
        for body, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(FormatError, message):
                read_terrain_intensity_maps(*terrain_of(body))

    def test_the_lighting_step_keeps_the_tile_and_names_a_listed_gap_when_the_intensity_maps_are_unreadable(self):
        arrays, map_count, reasons = terrain_intensity_map_outcome(*terrain_of(terrain_info_body(declared_count=3)))
        self.assertEqual((arrays, map_count), ([], 0))
        self.assertEqual(reasons, ['terrain-intensity-map-layout-unread:terrain 00_00.TerrainInfo0 NumIntMap is 3, but TIntMap holds 2 maps'])
        self.assertTrue(is_listed_reason(reasons[0], load_gap_reason_patterns()))
        arrays, map_count, reasons = terrain_intensity_map_outcome(*terrain_of(terrain_info_body()))
        self.assertEqual(([typed_array.name for typed_array in arrays], map_count, reasons), (['TINT.time', 'TINT.width', 'TINT.height', 'TINT.intensity'], 2, []))


if __name__ == '__main__':
    unittest.main()
