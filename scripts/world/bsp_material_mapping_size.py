from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.class_default_reads import kept_class_default_values
from world.static_mesh_step import conversion_failure_reason
from world.surface_material_programs import MATERIAL_CONVERSION_ERRORS, resolve_material_export

INTEGER_PROPERTY_TYPE = 2
OBJECT_PROPERTY_TYPE = 5
UNSIGNED_32_BIT_MASK = 0xFFFFFFFF
SIGNED_32_BIT_SIGN = 0x80000000
UNSIGNED_32_BIT_RANGE = 0x100000000
SHIFT_COUNT_MASK = 31
MATERIAL_CLASS = 'Engine.Material'
DEFAULT_MATERIAL_FIELD = 'DefaultMaterial'
MAPPING_SIZE_ZERO_REASON = 'material-mapping-size-zero'
MAPPING_SIZE_CLASS_UNPORTED_REASON_PREFIX = 'material-mapping-size-class-unported:'
BITMAP_MAPPING_SIZE_CLASSES = ('Engine.BitmapMaterial', 'Engine.Texture', 'Engine.Cubemap', 'Engine.ScriptedTexture', 'Engine.ShadowBitmapMaterial')
MODIFIER_MAPPING_SIZE_CLASSES = ('Engine.Modifier', 'Engine.ColorModifier', 'Engine.FinalBlend', 'Engine.GlowModifier', 'Engine.L2ColorModifier',
                                 'Engine.MaterialSequence', 'Engine.MaterialSwitch', 'Engine.OpacityModifier', 'Engine.TexModifier',
                                 'Engine.TexCoordSource', 'Engine.TexEnvMap', 'Engine.TexMatrix', 'Engine.TexOscillator',
                                 'Engine.TexOscillatorTriggered', 'Engine.TexPanner', 'Engine.TexPannerTriggered', 'Engine.TexRotator',
                                 'Engine.TexScaler')
ZERO_MAPPING_SIZE_CLASSES = ('Engine.Material', 'Engine.RenderedMaterial', 'Engine.ConstantMaterial', 'Engine.ConstantColor', 'Engine.FadeColor',
                             'Engine.VertexColor', 'Engine.ParticleMaterial', 'Engine.ProjectorMaterial', 'Engine.TerrainMaterial')


class MaterialMappingSize(NamedTuple):
    u: int
    v: int


ZERO_MAPPING_SIZE = MaterialMappingSize(0, 0)


class MaterialMappingSizeGap(FormatError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def signed_32_bit(value):
    unsigned = value & UNSIGNED_32_BIT_MASK
    return unsigned - UNSIGNED_32_BIT_RANGE if unsigned & SIGNED_32_BIT_SIGN else unsigned


def bitmap_mapping_size(reader, package, item, path):
    shift = reader.integer_field(package, item, 'LossDetail') & SHIFT_COUNT_MASK
    return MaterialMappingSize(*(signed_32_bit(reader.integer_field(package, item, field) << shift) for field in ('USize', 'VSize')))


def child_mapping_size(reader, package, item, field, path):
    child = reader.object_field(package, item, field)
    return ZERO_MAPPING_SIZE if child is None else reader.mapping_size(child, path)


def modifier_mapping_size(reader, package, item, path):
    return child_mapping_size(reader, package, item, 'Material', path)


def bump_shader_mapping_size(reader, package, item, path):
    return child_mapping_size(reader, package, item, 'Diffuse', path)


def shader_mapping_size(reader, package, item, path):
    diffuse = reader.object_field(package, item, 'Diffuse')
    if diffuse is not None:
        return reader.mapping_size(diffuse, path)
    return child_mapping_size(reader, package, item, 'SelfIllumination', path)


def combiner_mapping_size(reader, package, item, path):
    first = child_mapping_size(reader, package, item, 'Material1', path)
    second = child_mapping_size(reader, package, item, 'Material2', path)
    return MaterialMappingSize(max(first.u, second.u), max(first.v, second.v))


def zero_mapping_size(reader, package, item, path):
    return ZERO_MAPPING_SIZE


MAPPING_SIZE_RULE_OF_CLASS = {
    **{class_object: bitmap_mapping_size for class_object in BITMAP_MAPPING_SIZE_CLASSES},
    **{class_object: modifier_mapping_size for class_object in MODIFIER_MAPPING_SIZE_CLASSES},
    **{class_object: zero_mapping_size for class_object in ZERO_MAPPING_SIZE_CLASSES},
    'Engine.Shader': shader_mapping_size,
    'Engine.BumpShader': bump_shader_mapping_size,
    'Engine.Combiner': combiner_mapping_size,
}


NULL_OBJECT_REFERENCE = {'index': 0, 'object': None}


def reference_object_name(value, owner):
    if value is None or value == NULL_OBJECT_REFERENCE:
        return None
    if not (isinstance(value, dict) and isinstance(value.get('object'), str) and value['object']):
        raise FormatError(f'{owner} is not an object reference: {value!r}')
    return value['object']


class MaterialMappingSizeReader:
    def __init__(self, map_sources, class_default_value):
        self.map_sources, self.class_default_value = map_sources, class_default_value

    def authored_tag(self, package, item, field, property_type):
        tags = [tag for tag in package.properties(item)[0] if tag['name'].casefold() == field.casefold()]
        if not tags:
            return None
        if len(tags) != 1 or tags[0]['arrayIndex'] is not None or tags[0]['type'] != property_type or tags[0]['status'] != 'decoded':
            raise FormatError(f'{item["object"]}.{field} is not one decoded scalar property of type {property_type}')
        return tags[0]

    def integer_field(self, package, item, field):
        tag = self.authored_tag(package, item, field, INTEGER_PROPERTY_TYPE)
        value = self.class_default_value(item['classObject'], field) if tag is None else tag['value']
        if value is None:
            return 0
        if type(value) is not int:
            raise FormatError(f'{item["object"]}.{field} is not an integer: {value!r}')
        return value

    def object_field(self, package, item, field):
        tag = self.authored_tag(package, item, field, OBJECT_PROPERTY_TYPE)
        value = self.class_default_value(item['classObject'], field) if tag is None else tag['value']
        return reference_object_name(value, f'{item["object"]}.{field}')

    def mapping_size(self, reference, path=()):
        if reference.casefold() in path:
            raise FormatError(f'material mapping size reference cycle through {reference}')
        package, item = resolve_material_export(self.map_sources, reference)
        rule = MAPPING_SIZE_RULE_OF_CLASS.get(item['classObject'])
        if rule is None:
            raise MaterialMappingSizeGap(MAPPING_SIZE_CLASS_UNPORTED_REASON_PREFIX + item['classObject'],
                                         f'no native mapping size rule for {item["classObject"]} of {item["object"]}')
        return rule(self, package, item, (*path, reference.casefold()))


def reference_client_class_default_value(class_work_root, class_scripts):
    def class_default_value(class_object, field):
        [value] = kept_class_default_values(class_object, [field], class_work_root, class_scripts)
        return value.value
    return class_default_value


def default_material_identity(class_default_value):
    owner = f'{MATERIAL_CLASS}.{DEFAULT_MATERIAL_FIELD}'
    identity = reference_object_name(class_default_value(MATERIAL_CLASS, DEFAULT_MATERIAL_FIELD), owner)
    if identity is None:
        raise FormatError(f'the class default {owner} names no material')
    return identity


def surface_material_identities(package, model, class_work_root, class_scripts):
    identities = [package.object_name(surface.material) for surface in model.surfs]
    if None not in identities:
        return identities
    default_identity = default_material_identity(reference_client_class_default_value(class_work_root, class_scripts))
    return [default_identity if identity is None else identity for identity in identities]


def mapping_size_outcome(identity, map_sources, class_default_value):
    try:
        size = MaterialMappingSizeReader(map_sources, class_default_value).mapping_size(identity)
    except MaterialMappingSizeGap as gap:
        return None, [gap.reason]
    except MATERIAL_CONVERSION_ERRORS as error:
        return None, [conversion_failure_reason(error)]
    if size.u == 0 or size.v == 0:
        return None, [MAPPING_SIZE_ZERO_REASON]
    return size, []
