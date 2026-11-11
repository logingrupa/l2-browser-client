import copy
import hashlib
import math

from native_catalog.ue2 import FormatError
from world.map_actor_properties import TRANSFORMS, actor_properties, decode_property, source_range
from world.static_placement import gltf_placement, static_matrix

MOVER_FIXED_ARRAYS = {'KeyPos': ('Vector', 8), 'KeyRot': ('Rotator', 8), 'MeshGrade': ('StaticMesh', 7), 'RangeDelta': ('Vector', 4)}
MOVER_KEY_SLOTS = 8
SUPPORTED_KEY_COUNT = 2
SUPPORTED_INITIAL_KEY = 0
MOVER_SCALAR_FIELDS = (('BasePos', 'Vector'), ('BaseRot', 'Rotator'), ('KeyNum', 'byte'), ('NumKeys', 'byte'), ('MoveTime', 'float'),
                       ('StayOpenTime', 'float'), ('bClosed', 'bool'), ('L2ServerObjectRealID', 'int'), ('L2ServerObjectID', 'int'),
                       ('L2ServerObjectType', 'Actor.EL2ObjectType'))
MOVER_UNSUPPORTED_TOKENS = ('unconsumed-native-tail', 'key-count:<n>', 'initial-key:<n>', 'not-initially-closed', 'field-unresolved:<fieldName>',
                            'invalid-move-time', 'saved-placement-differs-from-initial-key', 'no-static-mesh', 'mesh-unresolved',
                            'non-rigid-key-transform', 'actor-scale')
MOVER_UNSUPPORTED_REASON_PREFIX = 'mover-unsupported:'
UNIT_SCALE_VALUES = {'DrawScale': 1.0, 'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}}
RIGID_TOLERANCE = 1e-5
SAVED_PLACEMENT_TOLERANCE = 1e-8


class MoverUnsupportedError(ValueError):
    def __init__(self, token):
        stem = token.split(':', 1)[0]
        if not any(listed.split(':', 1)[0] == stem and (':' in listed) == (':' in token) for listed in MOVER_UNSUPPORTED_TOKENS):
            raise ValueError(f'mover qualification token is not listed in MOVER_UNSUPPORTED_TOKENS: {token!r}')
        super().__init__(token)
        self.token = token

    @property
    def reason(self):
        return MOVER_UNSUPPORTED_REASON_PREFIX + self.token


def sha256_hex(value):
    return hashlib.sha256(value).hexdigest()


def source_record(relative, package, item):
    raw = package.data[item['offset']:item['offset'] + item['size']]
    return {'package': relative, 'packageSha256': package.source_hash, 'object': item['object'], 'classObject': item['classObject'],
            'exportIndex': item['exportIndex'], 'exportOffset': item['offset'], 'exportBytes': len(raw), 'exportSha256': sha256_hex(raw)}


def indexed_properties(tags):
    result = {}
    for tag in tags:
        index = tag['arrayIndex']
        if index is None and tag['name'] in MOVER_FIXED_ARRAYS:
            index = 0
        key = tag['name'], index
        if key in result:
            raise FormatError('Duplicate native mover property path: ' + str(key))
        if tag['name'] in MOVER_FIXED_ARRAYS and not (type(index) is int and 0 <= index < MOVER_FIXED_ARRAYS[tag['name']][1]):
            raise FormatError('Native mover fixed array index outside declaration')
        result[key] = tag
    return result


def numeric_struct(value, kind):
    axes = ('Pitch', 'Yaw', 'Roll') if kind == 'Rotator' else tuple('XYZ')
    if not (isinstance(value, dict) and set(value) == set(axes) and
            all(type(value[axis]) in (int, float) and math.isfinite(value[axis]) for axis in axes)):
        raise FormatError('Invalid native mover numeric struct: ' + kind)
    if kind == 'Rotator' and not all(type(value[axis]) is int for axis in axes):
        raise FormatError('Noninteger native mover rotator')
    return value


def endpoint_source_rows(base_pos, base_rot, key_pos, key_rot, transforms):
    values = copy.deepcopy(transforms)
    values['Location']['value'] = {axis: numeric_struct(base_pos, 'Vector')[axis] + numeric_struct(key_pos, 'Vector')[axis] for axis in 'XYZ'}
    values['Rotation']['value'] = {axis: numeric_struct(base_rot, 'Rotator')[axis] + numeric_struct(key_rot, 'Rotator')[axis]
                                   for axis in ('Pitch', 'Yaw', 'Roll')}
    return static_matrix(values)


def endpoint_matrix(base_pos, base_rot, key_pos, key_rot, transforms):
    return gltf_placement(endpoint_source_rows(base_pos, base_rot, key_pos, key_rot, transforms))


def is_rigid_rows(rows):
    basis = [row[:3] for row in rows[:3]]
    unit = all(abs(math.fsum(value * value for value in row) - 1) <= RIGID_TOLERANCE for row in basis)
    orthogonal = all(abs(math.fsum(basis[first][axis] * basis[second][axis] for axis in range(3))) <= RIGID_TOLERANCE
                     for first, second in ((0, 1), (0, 2), (1, 2)))
    determinant = (basis[0][0] * (basis[1][1] * basis[2][2] - basis[1][2] * basis[2][1]) - basis[0][1] * (basis[1][0] * basis[2][2] - basis[1][2] * basis[2][0])
                   + basis[0][2] * (basis[1][0] * basis[2][1] - basis[1][1] * basis[2][0]))
    return unit and orthogonal and determinant > 0


def with_unit_scale(transforms):
    return {**transforms, **{name: {**transforms[name], 'value': value} for name, value in UNIT_SCALE_VALUES.items()}}


def non_rigid_key_token(base_pos, base_rot, key_pos, key_rot, transforms):
    unscaled_rows = endpoint_source_rows(base_pos, base_rot, key_pos, key_rot, with_unit_scale(transforms))
    return 'actor-scale' if is_rigid_rows(unscaled_rows) else 'non-rigid-key-transform'


def resolved_field(defaults, properties, name, kind, index=None, count=None):
    try:
        return defaults.resolve(properties, name, kind, index, count)
    except FormatError as error:
        raise MoverUnsupportedError(f'field-unresolved:{name}') from error


def qualified_motion(resolved):
    num_keys, initial = resolved['NumKeys']['value'], resolved['KeyNum']['value']
    if num_keys != SUPPORTED_KEY_COUNT:
        raise MoverUnsupportedError(f'key-count:{num_keys}')
    if initial != SUPPORTED_INITIAL_KEY:
        raise MoverUnsupportedError(f'initial-key:{initial}')
    if resolved['bClosed']['value'] is not True:
        raise MoverUnsupportedError('not-initially-closed')
    duration = resolved['MoveTime']['value']
    if not (type(duration) in (int, float) and math.isfinite(duration) and duration > 0):
        raise MoverUnsupportedError('invalid-move-time')
    return num_keys, initial, duration


def mover_keys(defaults, properties, resolved, num_keys):
    keys = []
    for index in range(MOVER_KEY_SLOTS):
        position = resolved_field(defaults, properties, 'KeyPos', 'Vector', index, MOVER_KEY_SLOTS)
        rotation = resolved_field(defaults, properties, 'KeyRot', 'Rotator', index, MOVER_KEY_SLOTS)
        try:
            rows = endpoint_source_rows(resolved['BasePos']['value'], resolved['BaseRot']['value'], position['value'], rotation['value'], resolved)
        except FormatError as error:
            raise MoverUnsupportedError('non-rigid-key-transform') from error
        if index < num_keys and not is_rigid_rows(rows):
            raise MoverUnsupportedError(non_rigid_key_token(resolved['BasePos']['value'], resolved['BaseRot']['value'], position['value'],
                                                            rotation['value'], resolved))
        keys.append(({'index': index, 'active': index < num_keys, 'position': position, 'rotation': rotation, 'matrix': gltf_placement(rows)}, rows))
    return keys


def saved_placement_matrix(resolved):
    try:
        return gltf_placement(static_matrix(resolved))
    except FormatError as error:
        raise MoverUnsupportedError('non-rigid-key-transform') from error


def mover_mesh(sources, properties):
    reference = properties.get(('StaticMesh', None), {}).get('value', {}).get('object')
    if not isinstance(reference, str):
        raise MoverUnsupportedError('no-static-mesh')
    try:
        return sources.resolve(reference, 'StaticMesh')
    except FormatError as error:
        raise MoverUnsupportedError('mesh-unresolved') from error


def read_mover_actor(package, item, sources, defaults, map_path, raw_path):
    tags, tail, state, prefix_end = actor_properties(package, item)
    if tail.position != tail.end:
        raise MoverUnsupportedError('unconsumed-native-tail')
    raw = [decode_property(package, tag, raw_path) for tag in tags]
    properties = indexed_properties(raw)
    resolved = {}
    for name in TRANSFORMS:
        resolved[name] = resolved_field(defaults, properties, name, 'Rotator' if name == 'Rotation' else 'float' if name == 'DrawScale' else 'Vector')
    for name, kind in MOVER_SCALAR_FIELDS:
        resolved[name] = resolved_field(defaults, properties, name, kind)
    num_keys, initial, duration = qualified_motion(resolved)
    keys_with_rows = mover_keys(defaults, properties, resolved, num_keys)
    keys = [key for key, _ in keys_with_rows]
    if not all(abs(first - second) < SAVED_PLACEMENT_TOLERANCE for first, second in zip(keys[initial]['matrix'], saved_placement_matrix(resolved))):
        raise MoverUnsupportedError('saved-placement-differs-from-initial-key')
    relative, mesh_package, mesh = mover_mesh(sources, properties)
    model_id = 'interlude:' + mesh['object']
    record = {'id': 'interlude:' + item['object'], 'actorName': item['name'], 'modelId': model_id,
              'serverObject': {'realId': resolved['L2ServerObjectRealID']['value'], 'id': resolved['L2ServerObjectID']['value'],
                               'type': resolved['L2ServerObjectType']['value']},
              'closedMatrix': keys[0]['matrix'], 'openMatrix': keys[1]['matrix'], 'moveTimeSeconds': duration, 'initialKey': initial,
              'initiallyClosed': True, 'keys': keys, 'resolvedProperties': resolved,
              'meshGrades': [{'index': index, **copy.deepcopy(tag)} for (name, index), tag in properties.items() if name == 'MeshGrade'],
              'sounds': [copy.deepcopy(tag) for tag in raw if tag['name'].endswith('Sound') or tag['name'].endswith('Sounds')],
              'rawProperties': raw,
              'source': {**source_record(map_path, package, item), 'nativePayload': source_range(package.data, raw_path, item['offset'], item['offset'] + item['size']),
                         'stateFrame': state, 'stateFrameBytes': prefix_end - item['offset'], 'nativeTailBytes': 0}}
    source_rows = {'closed': keys_with_rows[0][1], 'open': keys_with_rows[1][1]}
    return record, source_record(relative, mesh_package, mesh), source_rows
