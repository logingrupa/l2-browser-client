from pathlib import PurePath

FAMILY_PREFIX_FIXTURE_ID = 'native-family-prefix'
AUTHORED_ROW_FIXTURE_KIND, LINKER_QUERY_FIXTURE_KIND, ASSET_DECODE_FIXTURE_KIND = 'authored-row', 'native-linker-query', 'assetDecode'
HALVES = ('back', 'front')
NONE_STYLE = -1
RESOLVED_STATUS = 'resolved'


class HairAnswerFixtureError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise HairAnswerFixtureError(message)


def package_families(answer, source_name):
    families = answer['packageFamilies']
    rows = [{'meshType': row['meshType'], 'family': row['family'], 'meshTypeName': row['meshTypeName']} for row in families['values']]
    fixtures = [fixture for fixture in answer['fixtures'] if fixture.get('id') == FAMILY_PREFIX_FIXTURE_ID]
    require(len(fixtures) == 1 and fixtures[0]['passed'] and fixtures[0]['rows'] == rows,
            f'the {source_name} package families differ from its native family prefix fixture')
    require([row['meshType'] for row in rows] == list(range(len(rows))), f'the {source_name} package families are not indexed by mesh type')
    return {row['meshType']: {'family': row['family'], 'meshTypeName': row['meshTypeName'], 'familyAddress': row['literalVa'],
                              'familySource': f'{source_name} packageFamilies {families["base"]}'}
            for row in families['values']}


def require_mapping_fixtures(answer, mesh_types, mappings_by_fixture_table, mesh_name_of):
    for fixture in (entry for entry in answer['fixtures'] if entry.get('kind') == AUTHORED_ROW_FIXTURE_KIND):
        keys = [key for key in mappings_by_fixture_table[fixture['table']]['keys'] if key['key'] == fixture['key']]
        require(len(keys) == 1, f'mapping fixture {fixture["id"]} names a missing {fixture["table"]} key')
        cell = keys[0]['meshTypes'][fixture['meshType']]['cells'][fixture['style']]
        for half in HALVES:
            mapped = cell[half + 'Style']
            mesh = None if mapped == NONE_STYLE else mesh_name_of(half, mesh_types[fixture['meshType']], mapped)
            require((mapped, mesh) == (fixture[half], fixture[half + 'Mesh']), f'mapping fixture {fixture["id"]} {half} differs from the recipe')


def require_linker_query_fixtures(answer, resolve_export):
    for fixture in (entry for entry in answer['fixtures'] if entry.get('kind') == LINKER_QUERY_FIXTURE_KIND):
        query = fixture['input']
        requested = PurePath(query['package']).stem + '.' + query['leaf']
        export = resolve_export(requested, query['requestedClass'].rsplit('.', 1)[-1])
        require(fixture['passed'] and export['exportIndex'] == fixture['expectedExportIndex'] == fixture['resultExportIndex'],
                f'{requested} resolves to export {export["exportIndex"]}, not the linker query fixture result')


def require_mode_fixtures(answer, mesh_types):
    modes = {(half['mesh']['object'].casefold(), half['mesh']['exportIndex']): half['meshMode']
             for mesh_type in mesh_types for half in mesh_type['defaultHalves'] if half['status'] == RESOLVED_STATUS}
    for fixture in (entry for entry in answer['fixtures'] if entry.get('kind') == ASSET_DECODE_FIXTURE_KIND):
        mode = modes.get((fixture['mesh'].casefold(), fixture['exportIndex']))
        require(mode == fixture['mode'], f'{fixture["mesh"]} mesh mode {mode} differs from the asset decode fixture')
