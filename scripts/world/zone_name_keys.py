from collections import defaultdict

from world.minimap_radar_route_recipe import read_minimap_radar_route_recipe

ZONE_KEY_SHIFT = 8


def global_color_limit():
    return read_minimap_radar_route_recipe()['document']['zoneKey']['helper']['globalBelowColor']


def zone_name_key(color, map_x, map_y):
    if color < global_color_limit():
        return color << ZONE_KEY_SHIFT
    return ((((map_y << ZONE_KEY_SHIFT) | map_x) << ZONE_KEY_SHIFT) | color) << ZONE_KEY_SHIFT


def is_tile_zone_color(color):
    return color >= global_color_limit()


def zone_tile_id(row):
    return f'{row["MapX"]:02d}_{row["MapY"]:02d}' if is_tile_zone_color(row['Color']) else None


def zone_ranges_overlap(first, second):
    return max(first['Bottom'], second['Bottom']) < min(first['Top'], second['Top'])


def run_has_overlapping_ranges(rows):
    return any(zone_ranges_overlap(first, second) for index, first in enumerate(rows) for second in rows[index + 1:])


def zone_key_row(row_index, row):
    return {'rowIndex': row_index, 'id': row['ID'], 'name': row['Name'], 'key': zone_name_key(row['Color'], row['MapX'], row['MapY']),
            'color': row['Color'], 'mapX': row['MapX'], 'mapY': row['MapY'], 'bottom': row['Bottom'], 'top': row['Top'], 'tileId': zone_tile_id(row)}


def zone_key_table(rows):
    keyed_rows = [zone_key_row(row_index, row) for row_index, row in enumerate(rows)]
    rows_by_key = defaultdict(list)
    for keyed_row, row in zip(keyed_rows, rows):
        rows_by_key[keyed_row['key']].append((keyed_row, row))
    shared_runs = {key: run for key, run in rows_by_key.items() if len(run) > 1}
    overlapping_runs = [{'key': key, 'tileId': run[0][0]['tileId'], 'rowIndices': [keyed_row['rowIndex'] for keyed_row, _ in run]}
                        for key, run in sorted(shared_runs.items()) if run_has_overlapping_ranges([row for _, row in run])]
    return {'rows': keyed_rows, 'keyCount': len(rows_by_key), 'sharedKeyCount': len(shared_runs),
            'rowsInSharedKeys': sum(len(run) for run in shared_runs.values()),
            'globalRowCount': sum(1 for keyed_row in keyed_rows if keyed_row['tileId'] is None), 'overlappingRuns': overlapping_runs}
