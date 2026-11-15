from world.minimap_radar_route_recipe import JOIN_UNRESOLVED_REASON_PREFIX

HUNTING_ZONE_FRAME_RULE = 'huntingzone-start-in-frame'
ZONE_SAMPLER_TILE_RULE = 'zone-sampler-tile'
HUNTING_ZONE_ROWS_UNRESOLVED = 'hunting-zone-rows'
ZONE_KEY_RUN_UNRESOLVED = 'zone-key-run'
SOURCE_PACKAGE_ABSENT = 'source-package-absent'
ZONE_NAME_PACKAGE_ROLE = 'zone-name'
ZONENAME_TABLE_ROLE = 'zonename'
HUNTINGZONE_TABLE_ROLE = 'huntingzone'
SCHEMA_FIELD_MEANING_LABEL = 'schema field name, meaning unverified on IMPORTA'


def join_unresolved_reason(what):
    return JOIN_UNRESOLVED_REASON_PREFIX + what


def unreal_name_key(name):
    return name.casefold()


def is_inside_frame(location, frame):
    minimum, maximum = frame['frameMinimumNative'], frame['frameMaximumNative']
    return all(minimum[axis] <= location[axis] <= maximum[axis] for axis in (0, 1))


def row_source(table, row_index, field):
    return {'table': table['table'], 'path': table['path'], 'sha256': table['sha256'], 'rowIndex': row_index, 'field': field}


def joined_hunting_zone_rows(frame, huntingzone_rows):
    if frame is None or huntingzone_rows is None:
        return []
    return [(index, zone) for index, zone in enumerate(huntingzone_rows['rows'])
            if is_inside_frame((zone['loc']['start_npc_x'], zone['loc']['start_npc_y']), frame)]


def zone_key_texture_item(zone_name_package, tile_id):
    if zone_name_package is None:
        return None
    export = next((export for export in zone_name_package['exports'] if unreal_name_key(export['name']) == unreal_name_key(tile_id)), None)
    if export is None:
        return None
    return {'object': export['object'], 'rule': ZONE_SAMPLER_TILE_RULE,
            'source': {'path': zone_name_package['path'], 'sha256': zone_name_package['sha256'], 'exportIndex': export['exportIndex']}}


def hunting_zones_in_frame(frame, huntingzone_rows, gaps):
    if huntingzone_rows is None:
        return []
    if not huntingzone_rows['rows']:
        gaps.append({'reason': join_unresolved_reason(HUNTING_ZONE_ROWS_UNRESOLVED), 'evidence': f'{huntingzone_rows["path"]} decoded zero rows'})
        return []
    return [{'id': zone['id'], 'name': zone['name'], 'rule': HUNTING_ZONE_FRAME_RULE,
             'startLocation': [zone['loc']['start_npc_x'], zone['loc']['start_npc_y'], zone['loc']['start_npc_z']],
             'source': row_source(huntingzone_rows, row_index, 'loc')}
            for row_index, zone in joined_hunting_zone_rows(frame, huntingzone_rows)]


def absent_source_gaps(zone_name_package, tables):
    roles = [ZONE_NAME_PACKAGE_ROLE] if zone_name_package is None else []
    roles.extend(role for role, table in tables.items() if table is None)
    return [{'reason': join_unresolved_reason(SOURCE_PACKAGE_ABSENT), 'evidence': f'{", ".join(roles)} not lock-equal in the reference client'}] if roles else []


def join_tile_route_half(tile_id, frame, zone_name_package, tables, overlapping_run_tile_ids):
    gaps = absent_source_gaps(zone_name_package, tables)
    hunting_zones = hunting_zones_in_frame(frame, tables[HUNTINGZONE_TABLE_ROLE], gaps)
    if tile_id in overlapping_run_tile_ids:
        gaps.append({'reason': join_unresolved_reason(ZONE_KEY_RUN_UNRESOLVED), 'evidence': f'a zone key run of tile {tile_id} has overlapping Bottom-Top ranges'})
    return {'tileId': tile_id, 'zoneKeyTexture': zone_key_texture_item(zone_name_package, tile_id), 'huntingZones': hunting_zones, 'gaps': gaps}
