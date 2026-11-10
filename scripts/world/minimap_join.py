from collections import Counter

from native_assets_lib.texture_mips import REVIEWED_VERSIONS

MINIMAP_JOIN_ALGORITHM_VERSION = 1
TILE_ID_RULE = 'tile-id'
TILE_ID_MAP_RULE = 'tile-id-map'
ZONENAME_MAP_RULE = 'zonename-map'
ZONENAME_NAME_RULE = 'zonename-name'
HUNTINGZONE_NAME_RULE = 'huntingzone-name'
ZONE_GRID_RULE = 'zonename-grid'
HUNTING_ZONE_FRAME_RULE = 'huntingzone-start-in-frame'
JOIN_RULES = (TILE_ID_RULE, TILE_ID_MAP_RULE, ZONENAME_MAP_RULE, ZONENAME_NAME_RULE, HUNTINGZONE_NAME_RULE, ZONE_GRID_RULE, HUNTING_ZONE_FRAME_RULE)
TILE_ID_MAP_SUFFIX = '_map'
TILE_ID_MAP_CITATION = 'Elbera tools/maps/build_minimap.py at 12c9656, TOWN_MAPS rows named <tile id>_map'
PROJECTION_RULE = 'tile-frame-extent'
UNVERIFIED_STATUS = 'unverified'
JOINED_STATUS = 'joined'
GAP_STATUS = 'gap'
JOIN_UNRESOLVED_REASON_PREFIX = 'minimap-join-unresolved:'
RADAR_TEXTURE_UNRESOLVED = 'radar-texture'
RADAR_TEXTURE_CONFLICT = 'radar-texture-conflict'
ZONE_GRID_UNRESOLVED = 'zone-grid'
ZONE_ROWS_UNRESOLVED = 'zone-rows'
HUNTING_ZONE_ROWS_UNRESOLVED = 'hunting-zone-rows'
PROJECTION_UNRESOLVED = 'projection'
SOURCE_PACKAGE_ABSENT = 'source-package-absent'
RADAR_PACKAGE_ROLE = 'radar'
TOWN_MAP_PACKAGE_ROLE = 'town-map'
ZONE_NAME_PACKAGE_ROLE = 'zone-name'
ZONENAME_TABLE_ROLE = 'zonename'
HUNTINGZONE_TABLE_ROLE = 'huntingzone'
SCHEMA_FIELD_MEANING_LABEL = 'schema field name, meaning unverified on IMPORTA'
TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX = 'texture-licensee-unsupported:'


def join_unresolved_reason(what):
    return JOIN_UNRESOLVED_REASON_PREFIX + what


def unreal_name_key(name):
    return name.casefold()


def tile_grid_numbers(tile_id):
    column, row = tile_id.split('_')
    return int(column), int(row)


def locked_tile_grid(tile_ids):
    columns, rows = zip(*(tile_grid_numbers(tile_id) for tile_id in tile_ids))
    return {'minimumX': min(columns), 'maximumX': max(columns), 'minimumY': min(rows), 'maximumY': max(rows)}


def is_inside_locked_grid(row, locked_grid):
    return locked_grid['minimumX'] <= row['MapX'] <= locked_grid['maximumX'] and locked_grid['minimumY'] <= row['MapY'] <= locked_grid['maximumY']


def zone_rows_outside_grid(zonename_rows, locked_grid):
    return [index for index, row in enumerate(zonename_rows['rows']) if not is_inside_locked_grid(row, locked_grid)]


def is_inside_frame(location, frame):
    minimum, maximum = frame['frameMinimumNative'], frame['frameMaximumNative']
    return all(minimum[axis] <= location[axis] <= maximum[axis] for axis in (0, 1))


def texture_item(package, export, rule, row_index=None):
    item = {'object': export['object'], 'rule': rule, 'source': {'path': package['path'], 'sha256': package['sha256'], 'exportIndex': export['exportIndex']}}
    if rule == TILE_ID_MAP_RULE:
        item['citation'] = TILE_ID_MAP_CITATION
    return item, (-1 if row_index is None else row_index, export['exportIndex'])


def exports_named(package, name):
    if package is None or not name:
        return []
    return [export for export in package['exports'] if unreal_name_key(export['name']) == unreal_name_key(name)]


def row_source(table, row_index, field):
    return {'table': table['table'], 'path': table['path'], 'sha256': table['sha256'], 'rowIndex': row_index, 'field': field}


def joined_zone_rows(tile_id, zonename_rows):
    column, row = tile_grid_numbers(tile_id)
    return [(index, zone) for index, zone in enumerate(zonename_rows['rows']) if zone['MapX'] == column and zone['MapY'] == row]


def joined_hunting_zone_rows(frame, huntingzone_rows):
    if frame is None or huntingzone_rows is None:
        return []
    return [(index, zone) for index, zone in enumerate(huntingzone_rows['rows'])
            if is_inside_frame((zone['loc']['start_npc_x'], zone['loc']['start_npc_y']), frame)]


def minimap_projection(frame, texture_dimensions):
    if frame is None or texture_dimensions is None or texture_dimensions[0] != texture_dimensions[1]:
        return None
    return {'rule': PROJECTION_RULE, 'status': UNVERIFIED_STATUS, 'frameMinimumNative': list(frame['frameMinimumNative']),
            'frameMaximumNative': list(frame['frameMaximumNative']), 'textureWidth': texture_dimensions[0], 'textureHeight': texture_dimensions[1]}


def projection_gap_evidence(frame, texture_dimensions):
    if frame is None:
        return 'tile frame not extracted'
    if texture_dimensions is not None and texture_dimensions[0] != texture_dimensions[1]:
        return f'radar texture is not square: {texture_dimensions[0]} x {texture_dimensions[1]}'
    return None


def texture_licensee_gap_reason(package):
    version = (package['packageVersion'], package['licensee'])
    return None if version in REVIEWED_VERSIONS else f'{TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX}{version[0]}/{version[1]}'


class TileMinimapJoin:
    def __init__(self, tile_id, packages, tables):
        self.tile_id, self.packages, self.tables = tile_id, packages, tables
        self.textures_by_role = {RADAR_PACKAGE_ROLE: {}, TOWN_MAP_PACKAGE_ROLE: {}, ZONE_NAME_PACKAGE_ROLE: {}}
        self.gaps = []

    def add_gap(self, what, evidence):
        self.add_reason(join_unresolved_reason(what), evidence)

    def add_reason(self, reason, evidence):
        if all(gap['reason'] != reason for gap in self.gaps):
            self.gaps.append({'reason': reason, 'evidence': evidence})

    def add_textures(self, role, name, rule, row_index=None):
        package = self.packages[role]
        for export in exports_named(package, name):
            item, order = texture_item(package, export, rule, row_index)
            self.textures_by_role[role].setdefault((export['object'], rule), (order, item))

    def textures(self, role):
        return [item for _, item in sorted(self.textures_by_role[role].values(), key=lambda entry: (entry[0], entry[1]['rule']))]


def require_source_presence(join, packages, tables):
    for role, package in packages.items():
        if package is None:
            join.add_gap(SOURCE_PACKAGE_ABSENT, f'{role} texture package is not lock-equal in the reference client')
    for role, table in tables.items():
        if table is None:
            join.add_gap(SOURCE_PACKAGE_ABSENT, f'{role} table is not lock-equal in the reference client')


def joined_zones(join, zonename_rows, grid_outliers):
    if zonename_rows is None:
        return []
    if not zonename_rows['rows']:
        join.add_gap(ZONE_ROWS_UNRESOLVED, f'{zonename_rows["path"]} decoded zero rows')
        return []
    if grid_outliers:
        join.add_gap(ZONE_GRID_UNRESOLVED, f'{len(grid_outliers)} zonename rows hold MapX or MapY outside the locked tile grid')
        return []
    zones = []
    for row_index, zone in joined_zone_rows(join.tile_id, zonename_rows):
        zones.append({'id': zone['ID'], 'name': zone['Name'], 'map': zone['map'], 'rule': ZONE_GRID_RULE,
                      'source': row_source(zonename_rows, row_index, 'MapX,MapY')})
        for role in (RADAR_PACKAGE_ROLE, TOWN_MAP_PACKAGE_ROLE, ZONE_NAME_PACKAGE_ROLE):
            join.add_textures(role, zone['map'], ZONENAME_MAP_RULE, row_index)
        join.add_textures(ZONE_NAME_PACKAGE_ROLE, zone['Name'], ZONENAME_NAME_RULE, row_index)
    return zones


def joined_hunting_zones(join, frame, huntingzone_rows):
    if huntingzone_rows is None:
        return []
    if not huntingzone_rows['rows']:
        join.add_gap(HUNTING_ZONE_ROWS_UNRESOLVED, f'{huntingzone_rows["path"]} decoded zero rows')
        return []
    hunting_zones = []
    for row_index, zone in joined_hunting_zone_rows(frame, huntingzone_rows):
        location = zone['loc']
        hunting_zones.append({'id': zone['id'], 'name': zone['name'], 'rule': HUNTING_ZONE_FRAME_RULE,
                              'startLocation': [location['start_npc_x'], location['start_npc_y'], location['start_npc_z']],
                              'source': row_source(huntingzone_rows, row_index, 'loc')})
        join.add_textures(TOWN_MAP_PACKAGE_ROLE, zone['name'], HUNTINGZONE_NAME_RULE, row_index)
    return hunting_zones


def joined_radar_texture(join):
    radar_textures = join.textures(RADAR_PACKAGE_ROLE)
    radar_objects = sorted({item['object'] for item in radar_textures}, key=unreal_name_key)
    if len(radar_objects) > 1:
        join.add_gap(RADAR_TEXTURE_CONFLICT, f'radar exports {", ".join(radar_objects)} all join the tile')
        return None, radar_textures
    if not radar_objects:
        join.add_gap(RADAR_TEXTURE_UNRESOLVED, 'no radar export equals the tile id, <tile id>_map or a joined zone map value')
        return None, radar_textures
    licensee_gap_reason = texture_licensee_gap_reason(join.packages[RADAR_PACKAGE_ROLE])
    if licensee_gap_reason is not None:
        join.add_reason(licensee_gap_reason, f'{radar_textures[0]["object"]} lies in a package outside the reviewed texture reader versions')
        return None, radar_textures
    return radar_textures[0], radar_textures


def join_tile(tile_id, frame, packages, tables, grid_outliers, radar_texture_dimensions):
    join = TileMinimapJoin(tile_id, packages, tables)
    require_source_presence(join, packages, tables)
    join.add_textures(RADAR_PACKAGE_ROLE, tile_id, TILE_ID_RULE)
    join.add_textures(ZONE_NAME_PACKAGE_ROLE, tile_id, TILE_ID_RULE)
    for role in (RADAR_PACKAGE_ROLE, TOWN_MAP_PACKAGE_ROLE, ZONE_NAME_PACKAGE_ROLE):
        join.add_textures(role, tile_id + TILE_ID_MAP_SUFFIX, TILE_ID_MAP_RULE)
    zones = joined_zones(join, tables[ZONENAME_TABLE_ROLE], grid_outliers)
    hunting_zones = joined_hunting_zones(join, frame, tables[HUNTINGZONE_TABLE_ROLE])
    radar_texture, radar_candidates = joined_radar_texture(join)
    dimensions = None if radar_texture is None else radar_texture_dimensions.get(radar_texture['object'])
    projection = minimap_projection(frame, dimensions)
    projection_evidence = projection_gap_evidence(frame, dimensions)
    if projection_evidence is not None:
        join.add_gap(PROJECTION_UNRESOLVED, projection_evidence)
    return {'tileId': tile_id, 'status': GAP_STATUS if join.gaps else JOINED_STATUS, 'radarTexture': radar_texture,
            'radarCandidates': radar_candidates, 'zones': zones, 'huntingZones': hunting_zones,
            'townMapTextures': join.textures(TOWN_MAP_PACKAGE_ROLE), 'zoneNameTextures': join.textures(ZONE_NAME_PACKAGE_ROLE),
            'projection': projection, 'gaps': join.gaps}


def rule_match_counts(tiles):
    counts = Counter()
    for tile in tiles:
        for item in (*tile['radarCandidates'], *tile['townMapTextures'], *tile['zoneNameTextures'], *tile['zones'], *tile['huntingZones']):
            counts[item['rule']] += 1
    return {rule: counts[rule] for rule in JOIN_RULES}


def join_minimap_sources(tile_ids, tile_frames, radar_index, town_map_index, zone_name_index, zonename_rows, huntingzone_rows, locked_grid,
                         radar_texture_dimensions=None):
    packages = {RADAR_PACKAGE_ROLE: radar_index, TOWN_MAP_PACKAGE_ROLE: town_map_index, ZONE_NAME_PACKAGE_ROLE: zone_name_index}
    tables = {ZONENAME_TABLE_ROLE: zonename_rows, HUNTINGZONE_TABLE_ROLE: huntingzone_rows}
    grid_outliers = [] if zonename_rows is None else zone_rows_outside_grid(zonename_rows, locked_grid)
    tiles = [join_tile(tile_id, tile_frames.get(tile_id), packages, tables, grid_outliers, radar_texture_dimensions or {})
             for tile_id in sorted(tile_ids)]
    return {'algorithmVersion': MINIMAP_JOIN_ALGORITHM_VERSION, 'lockedGrid': dict(locked_grid), 'zoneRowsOutsideGrid': len(grid_outliers),
            'tiles': tiles, 'ruleMatchCounts': rule_match_counts(tiles)}
