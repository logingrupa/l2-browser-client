import math

from native_assets_lib.class_defaults import ClassDefaultError, ReferenceClientClassScripts, read_class_defaults_with_provenance
from native_catalog.ue2 import FormatError
from world.map_actor_properties import property_value
from world.terrain_coordinates import f32, xyz

STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
TERRAIN_INFO_CLASS = 'Engine.TerrainInfo'
STATIC_TRANSFORM_FIELDS = ('Location', 'Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D')
SERIALIZED_STATUS = 'serialized'
UE_ZERO_PROVENANCE = 'ue-zero'
VECTOR_ZERO = {'X': 0, 'Y': 0, 'Z': 0}
UE_ZERO_VALUE_OF_FIELD = {'Location': VECTOR_ZERO, 'Rotation': {'Pitch': 0, 'Yaw': 0, 'Roll': 0}, 'PrePivot': VECTOR_ZERO,
                          'DrawScale': 0.0, 'DrawScale3D': VECTOR_ZERO}


class TransformFieldError(FormatError):
    def __init__(self, field, message):
        super().__init__(message)
        self.field = field


class ClassDefaults:
    def __init__(self, work_root, class_scripts):
        self.work_root, self.class_scripts = work_root, class_scripts

    def values(self, class_name, fields):
        return {value.field: value for value in read_class_defaults_with_provenance(class_name, list(fields), self.work_root, self.class_scripts)}


def read_class_evidence(client, work_root):
    return ClassDefaults(work_root, ReferenceClientClassScripts(client))


def placement_provenance(class_default):
    return UE_ZERO_PROVENANCE if class_default.provenance == UE_ZERO_PROVENANCE else 'class-default'


def class_default_of_field(class_defaults, class_name, name):
    try:
        return class_defaults.values(class_name, [name])[name]
    except ClassDefaultError as error:
        raise TransformFieldError(name, f'Native default is unresolved: {name}: {error}') from error


def resolved_transform_values(actor, class_defaults, class_name):
    result = {}
    for name in STATIC_TRANSFORM_FIELDS:
        field = actor['sourceTransform'][name]
        if field['status'] == SERIALIZED_STATUS:
            result[name] = {'value': field['value'], 'provenance': 'authored', 'source': 'serialized-actor-property'}
            continue
        default = class_default_of_field(class_defaults, class_name, name)
        value = UE_ZERO_VALUE_OF_FIELD[name] if default.provenance == UE_ZERO_PROVENANCE else default.value
        if value is None:
            raise TransformFieldError(name, 'Native default is unresolved: ' + name)
        result[name] = {'value': value, 'provenance': placement_provenance(default), 'source': default.declaring_class}
    return result


def resolved_static_values(actor, class_defaults):
    if actor['classObject'] != STATIC_MESH_ACTOR_CLASS:
        raise FormatError('Only exact native Engine.StaticMeshActor placements are supported')
    return resolved_transform_values(actor, class_defaults, STATIC_MESH_ACTOR_CLASS)


def require_terrain_not_inverted(terrain_actor, class_defaults):
    inverted = property_value(terrain_actor['properties'], 'Inverted')
    if inverted is None:
        inverted = class_defaults.values(TERRAIN_INFO_CLASS, ['Inverted'])['Inverted'].value
    if inverted:
        raise FormatError('Inverted terrain requires separately verified rendering/normals')


def rotation_rows(rotation):
    def sine(value):
        index = (int(value) >> 2) & 16383
        return f32(math.sin(index*2*math.pi/16384))
    p, y, r = (rotation[name] for name in ('Pitch', 'Yaw', 'Roll'))
    sp, sy, sr, cp, cy, cr = sine(p), sine(y), sine(r), sine(p+16384), sine(y+16384), sine(r+16384)
    return [[cp*cy, cp*sy, sp], [sr*sp*cy-cr*sy, sr*sp*sy+cr*cy, -sr*cp],
            [-(cr*sp*cy+sr*sy), cy*sr-cr*sp*sy, cr*cp]]


def static_matrix(values):
    location, pivot, scale3 = (xyz(values[name]['value']) for name in ('Location', 'PrePivot', 'DrawScale3D'))
    uniform = values['DrawScale']['value']
    if not math.isfinite(uniform) or uniform == 0 or any(v == 0 for v in scale3):
        raise FormatError('Singular static actor scale')
    rotation = rotation_rows(values['Rotation']['value'])
    rows = [[rotation[i][j]*scale3[i]*uniform for j in range(3)]+[0] for i in range(3)]
    rows.append([location[j]-sum(pivot[i]*rows[i][j] for i in range(3)) for j in range(3)]+[1])
    return rows


def gltf_placement(native_rows):
    umodel_xzy_basis_permutation = (0, 2, 1)
    result = [[native_rows[umodel_xzy_basis_permutation[i]][umodel_xzy_basis_permutation[j]] for j in range(3)]+[0] for i in range(3)]
    result.append([native_rows[3][axis]*.01 for axis in umodel_xzy_basis_permutation]+[1])
    native_row_major_as_gltf_column_major = [v for row in result for v in row]
    return native_row_major_as_gltf_column_major
