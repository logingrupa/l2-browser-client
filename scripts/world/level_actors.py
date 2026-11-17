from native_catalog.ue2 import FormatError

LEVEL_ACTORS_NATIVE_FIELD = '0x38'


def level_actor_references(level):
    arrays = [array for array in level.binding['actorArrays'] if array['nativeField'] == LEVEL_ACTORS_NATIVE_FIELD]
    if len(arrays) != 1:
        raise FormatError(f'Level names {len(arrays)} Actors arrays at {LEVEL_ACTORS_NATIVE_FIELD}')
    return arrays[0]['references']


def level_actor_exports(package, level):
    return [package.exports[reference - 1] for reference in level_actor_references(level) if reference > 0]
