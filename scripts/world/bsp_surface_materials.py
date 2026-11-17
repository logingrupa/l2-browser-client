from pathlib import Path
import tempfile
from typing import NamedTuple

from world.bsp_chunk_geometry import BspSurfaceMaterial
from world.bsp_material_mapping_size import mapping_size_outcome, reference_client_class_default_value
from world.error_detail import conversion_failure_reason
from world.surface_material_programs import MATERIAL_CONVERSION_ERRORS, material_program_outcome, program_root_is_ported, root_program_node

SHADER_CLASS = 'Engine.Shader'
SHADER_OPACITY_FIELD = 'Opacity'
OPACITY_BLENDED_SHADER_MEMBER = 'OB_Normal'
PROGRAM_REFERENCE_KEYS = ('node', 'externalObject')
OPAQUE_BLEND_MEMBERS_OF_CLASS = {SHADER_CLASS: ('OutputBlending', frozenset({'OB_Normal', 'OB_Masked'})),
                                 'Engine.FinalBlend': ('FrameBufferBlending', frozenset({'FB_Overwrite'}))}


class SurfaceMaterialOutcome(NamedTuple):
    material: BspSurfaceMaterial
    gap_reasons: list
    store_outputs: list


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


def unbound_surface_material(identity, mapping_size, program_record, gap_reasons, store_outputs):
    return SurfaceMaterialOutcome(BspSurfaceMaterial(identity, None, mapping_size, False, program_record), sorted(set(gap_reasons)), store_outputs)


def convert_surface_material(identity, map_sources, converter, class_work_root, class_scripts, store_root):
    outcome = material_program_outcome(identity, map_sources, converter, class_work_root, class_scripts, store_root)
    if outcome.program is None:
        return unbound_surface_material(identity, None, None, outcome.gap_reasons, [])
    mapping_size, mapping_gap_reasons = mapping_size_outcome(identity, map_sources,
                                                             reference_client_class_default_value(class_work_root, class_scripts))
    gap_reasons = [*outcome.gap_reasons, *mapping_gap_reasons]
    if mapping_size is None or not program_root_is_ported(outcome.program):
        return unbound_surface_material(identity, mapping_size, outcome.program_record, gap_reasons, outcome.store_outputs)
    try:
        with tempfile.TemporaryDirectory(dir=converter.output) as work:
            png, _, _, _ = converter.material_texture(Path(work), identity)
    except MATERIAL_CONVERSION_ERRORS as error:
        return unbound_surface_material(identity, mapping_size, outcome.program_record, [*gap_reasons, conversion_failure_reason(error)],
                                        outcome.store_outputs)
    material = BspSurfaceMaterial(identity, png, mapping_size, program_blend_is_translucent(outcome.program), outcome.program_record)
    return SurfaceMaterialOutcome(material, sorted(set(gap_reasons)), outcome.store_outputs)
