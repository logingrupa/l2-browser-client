from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.zone_name_keys import zone_key_table, zone_name_key


def zone_row(identifier, color, map_x, map_y, bottom=-30000.0, top=30000.0, name='zone'):
    return {'ID': identifier, 'Color': color, 'MapX': map_x, 'MapY': map_y, 'Bottom': bottom, 'Top': top, 'Name': name}


class ZoneNameKeyTests(unittest.TestCase):
    def test_a_color_below_200_is_a_global_key_and_200_or_more_folds_the_map_pair_in(self):
        self.assertEqual(zone_name_key(1, 0, 0), 1 << 8)
        self.assertEqual(zone_name_key(199, 20, 21), 199 << 8)
        self.assertEqual(zone_name_key(200, 20, 21), ((((21 << 8) | 20) << 8) | 200) << 8)
        self.assertEqual(zone_name_key(255, 25, 19), ((((19 << 8) | 25) << 8) | 255) << 8)

    def test_the_table_groups_rows_by_key_and_counts_shared_and_global_rows(self):
        table = zone_key_table([zone_row(0, 0, 0, 0), zone_row(1, 210, 20, 21), zone_row(2, 210, 20, 21, -100.0, 100.0), zone_row(3, 220, 20, 21)])
        self.assertEqual([row['key'] for row in table['rows']][:2], [0, zone_name_key(210, 20, 21)])
        self.assertEqual([row['tileId'] for row in table['rows']], [None, '20_21', '20_21', '20_21'])
        self.assertEqual((table['keyCount'], table['sharedKeyCount'], table['rowsInSharedKeys'], table['globalRowCount']), (3, 1, 2, 1))
        self.assertEqual(table['overlappingRuns'], [{'key': zone_name_key(210, 20, 21), 'tileId': '20_21', 'rowIndices': [1, 2]}])

    def test_ranges_that_only_touch_do_not_overlap_because_the_row_rule_is_strict(self):
        stacked = [zone_row(1, 230, 25, 19, -5170.0, 30000.0), zone_row(2, 230, 25, 19, -6539.0, -5170.0)]
        self.assertEqual(zone_key_table(stacked)['overlappingRuns'], [])
        one_unit = [zone_row(1, 230, 25, 19, -6539.0, -5171.0), zone_row(2, 230, 25, 19, -30000.0, -6538.0)]
        self.assertEqual([run['rowIndices'] for run in zone_key_table(one_unit)['overlappingRuns']], [[0, 1]])


if __name__ == '__main__':
    unittest.main()
