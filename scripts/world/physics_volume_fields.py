from native_assets_lib.class_defaults import ClassDefaultError
from world.static_collision_sources import UE_ZERO_PROVENANCE, serialized_actor_value

AUTHORED_PROVENANCE = 'authored'
CLASS_DEFAULT_PROVENANCE = 'class-default'
UNRESOLVED_PROVENANCE = 'unresolved'
VECTOR_AXES = ('X', 'Y', 'Z')


def is_number(value):
    return type(value) in (int, float)


def ue_zero_value(declared_type):
    return typed_declared_value(declared_type, {'bool': False, 'int': 0, 'float': 0.0, 'vector': {axis: 0.0 for axis in VECTOR_AXES}}.get(declared_type.casefold()))


def typed_declared_value(declared_type, value):
    match declared_type.casefold():
        case 'bool':
            return value if type(value) is bool else None
        case 'int':
            return value if type(value) is int else None
        case 'float':
            return float(value) if is_number(value) else None
        case 'vector':
            if isinstance(value, dict) and all(is_number(value.get(axis)) for axis in VECTOR_AXES):
                return {axis: float(value[axis]) for axis in VECTOR_AXES}
            return None
    return None


def declared_field_type(class_chains, class_name, field):
    for definition in class_chains.chain(class_name) or ():
        for declared in definition['declaredFields']:
            if declared['name'].casefold() == field.casefold():
                return declared['type']
    return None


def resolved_field(field, value, provenance):
    return {'field': field, 'value': value, 'provenance': provenance}


def resolve_physics_volume_field(actor, class_chains, class_evidence, field_rule):
    unresolved = resolved_field(field_rule.field, None, UNRESOLVED_PROVENANCE)
    declared_type = declared_field_type(class_chains, actor['classObject'], field_rule.field)
    if declared_type is None or declared_type.casefold() != field_rule.declared_type.casefold():
        return unresolved
    serialized, value = serialized_actor_value(actor, field_rule.field)
    if serialized:
        typed = typed_declared_value(declared_type, value)
        return unresolved if typed is None else resolved_field(field_rule.field, typed, AUTHORED_PROVENANCE)
    try:
        default = class_evidence.values(actor['classObject'], [field_rule.field])[field_rule.field]
    except ClassDefaultError:
        return unresolved
    is_ue_zero = default.provenance == UE_ZERO_PROVENANCE
    typed = ue_zero_value(declared_type) if is_ue_zero else typed_declared_value(declared_type, default.value)
    return unresolved if typed is None else resolved_field(field_rule.field, typed, UE_ZERO_PROVENANCE if is_ue_zero else CLASS_DEFAULT_PROVENANCE)


def read_physics_volume_fields(actor, class_chains, class_evidence, rules):
    return {field_rule.payload_field: resolve_physics_volume_field(actor, class_chains, class_evidence, field_rule)
            for field_rule in rules.physics_volume_fields}
