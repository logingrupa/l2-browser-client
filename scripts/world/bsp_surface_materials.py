from pathlib import Path
import struct
import tempfile
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.bsp_chunk_geometry import BspSurfaceMaterial
from world.static_mesh_step import conversion_failure_reason
from world.surface_material_programs import MATERIAL_CONVERSION_ERRORS, material_program_outcome, program_root_is_ported, root_program_node

SHADER_CLASS = 'Engine.Shader'
SHADER_OPACITY_FIELD = 'Opacity'
OPACITY_BLENDED_SHADER_MEMBER = 'OB_Normal'
PROGRAM_REFERENCE_KEYS = ('node', 'externalObject')
OPAQUE_BLEND_MEMBERS_OF_CLASS = {SHADER_CLASS: ('OutputBlending', frozenset({'OB_Normal', 'OB_Masked'})),
                                 'Engine.FinalBlend': ('FrameBufferBlending', frozenset({'FB_Overwrite'}))}
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PNG_DIMENSIONS_OFFSET = 16


class SurfaceMaterialOutcome(NamedTuple):
    material: BspSurfaceMaterial
    gap_reasons: list
    store_outputs: list


def surface_material_identities(package, model):
    return [package.object_name(surface.material) for surface in model.surfs]


def png_dimensions(png):
    if not png.startswith(PNG_SIGNATURE):
        raise FormatError('surface texture is not a PNG')
    return struct.unpack_from('>II', png, PNG_DIMENSIONS_OFFSET)


def root_field_value(root, field_name):
    field = next((field for field in root['fields'] if field['field'].casefold() == field_name.casefold()), None)
    return None if field is None else field['value']


def shader_has_opacity_input(root):
    value = root_field_value(root, SHADER_OPACITY_FIELD)
    return isinstance(value, dict) and any(isinstance(value.get(key), str) for key in PROGRAM_REFERENCE_KEYS)


def program_blend_is_translucent(program):
    root = root_program_node(program)
    blend = OPAQUE_BLEND_MEMBERS_OF_CLASS.get(root['class'])
    if blend is None:
        return False
    field_name, opaque_members = blend
    value = root_field_value(root, field_name)
    if not isinstance(value, dict) or not isinstance(value.get('name'), str):
        return False
    if root['class'] == SHADER_CLASS and value['name'] == OPACITY_BLENDED_SHADER_MEMBER and shader_has_opacity_input(root):
        return True
    return value['name'] not in opaque_members


def unbound_surface_material(identity, program_record, gap_reasons, store_outputs):
    return SurfaceMaterialOutcome(BspSurfaceMaterial(identity, None, None, None, False, program_record), gap_reasons, store_outputs)


def convert_surface_material(identity, map_sources, converter, class_work_root, class_scripts, store_root):
    outcome = material_program_outcome(identity, map_sources, converter, class_work_root, class_scripts, store_root)
    if outcome.program is None:
        return unbound_surface_material(identity, None, outcome.gap_reasons, [])
    if not program_root_is_ported(outcome.program):
        return unbound_surface_material(identity, outcome.program_record, outcome.gap_reasons, outcome.store_outputs)
    try:
        with tempfile.TemporaryDirectory(dir=converter.output) as work:
            png, _, _, _ = converter.material_texture(Path(work), identity)
        width, height = png_dimensions(png)
    except MATERIAL_CONVERSION_ERRORS as error:
        return unbound_surface_material(identity, outcome.program_record, [*outcome.gap_reasons, conversion_failure_reason(error)],
                                        outcome.store_outputs)
    material = BspSurfaceMaterial(identity, png, width, height, program_blend_is_translucent(outcome.program), outcome.program_record)
    return SurfaceMaterialOutcome(material, outcome.gap_reasons, outcome.store_outputs)
