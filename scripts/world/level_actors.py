from native_catalog.ue2 import FormatError
from world.light_actors import LEVEL_INFO_CLASS

LEVEL_ACTORS_NATIVE_FIELD = '0x38'


def level_actor_references(level):
    arrays = [array for array in level.binding['actorArrays'] if array['nativeField'] == LEVEL_ACTORS_NATIVE_FIELD]
    if len(arrays) != 1:
        raise FormatError(f'Level names {len(arrays)} Actors arrays at {LEVEL_ACTORS_NATIVE_FIELD}')
    return arrays[0]['references']


def level_actor_exports(package, level):
    return [package.exports[reference - 1] for reference in level_actor_references(level) if reference > 0]


def level_info_export(package, level, class_chains):
    references = level_actor_references(level)
    if not references or references[0] <= 0:
        return None
    export = package.exports[references[0] - 1]
    if class_chains.chain(export['classObject']) is None or not class_chains.is_subclass(export['classObject'], LEVEL_INFO_CLASS):
        return None
    return export
