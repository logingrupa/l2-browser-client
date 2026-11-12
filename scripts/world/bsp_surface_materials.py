from pathlib import Path
import struct
import subprocess
import tempfile
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_program import derive_material_program
from native_assets_lib.material_resources import write_material_program_record
from world.bsp_chunk_geometry import BspSurfaceMaterial
from world.class_default_reads import kept_material_class_defaults
from world.material_texture_images import material_texture_image_pins, reviewed_texture_nodes, write_material_texture_images
from world.static_mesh_step import conversion_failure_reason

SHADER_CLASS = 'Engine.Shader'
SHADER_OPACITY_FIELD = 'Opacity'
OPACITY_BLENDED_SHADER_MEMBER = 'OB_Normal'
PROGRAM_REFERENCE_KEYS = ('node', 'externalObject')
OPAQUE_BLEND_MEMBERS_OF_CLASS = {SHADER_CLASS: ('OutputBlending', frozenset({'OB_Normal', 'OB_Masked'})),
                                 'Engine.FinalBlend': ('FrameBufferBlending', frozenset({'FB_Overwrite'}))}
UNPORTED_NODE_STATUS = 'unported'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PNG_DIMENSIONS_OFFSET = 16
MATERIAL_CONVERSION_ERRORS = (ValueError, subprocess.TimeoutExpired)


class SurfaceMaterialOutcome(NamedTuple):
    material: BspSurfaceMaterial
    gap_reasons: list
    store_outputs: list


def surface_material_identities(package, model):
    return [package.object_name(surface.material) for surface in model.surfs]


def resolve_material_export(map_sources, identity):
    candidates = map_sources.paths.get(identity.split('.')[0].casefold(), [])
    if len(candidates) != 1:
        raise FormatError(f'material package missing or ambiguous: {identity}')
    package = map_sources.get(candidates[0])
    matches = [item for item in package.exports if item['object'].casefold() == identity.casefold()]
    if len(matches) != 1:
        raise FormatError(f'material export missing or ambiguous: {identity}')
    return package, matches[0]


def png_dimensions(png):
    if not png.startswith(PNG_SIGNATURE):
        raise FormatError('surface texture is not a PNG')
    return struct.unpack_from('>II', png, PNG_DIMENSIONS_OFFSET)


def root_program_node(program):
    return next(node for node in program['nodes'] if node['id'] == program['root'])


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


def converted_texture_pngs(graph, converter):
    pngs_by_node, gap_reasons = {}, []
    for node in reviewed_texture_nodes(graph):
        try:
            with tempfile.TemporaryDirectory(dir=converter.output) as work:
                pngs_by_node[node['object']], _, _ = converter.texture(Path(work), node['object'])
        except MATERIAL_CONVERSION_ERRORS as error:
            gap_reasons.append(conversion_failure_reason(error))
    return pngs_by_node, gap_reasons


def convert_surface_material(identity, map_sources, converter, class_work_root, class_scripts, store_root):
    try:
        package, item = resolve_material_export(map_sources, identity)
        graph = read_material_graph(package, item)
        pngs_by_node, texture_gap_reasons = converted_texture_pngs(graph, converter)
        program = derive_material_program(graph, kept_material_class_defaults(graph, class_work_root, class_scripts),
                                          texture_images=material_texture_image_pins(pngs_by_node))
        program_record, program_files = write_material_program_record(store_root, graph, program)
        store_outputs = [*program_files, *write_material_texture_images(store_root, pngs_by_node)]
    except MATERIAL_CONVERSION_ERRORS as error:
        return unbound_surface_material(identity, None, [conversion_failure_reason(error)], [])
    gap_reasons = sorted({*program['gapReasons'], *texture_gap_reasons})
    if root_program_node(program)['status'] == UNPORTED_NODE_STATUS:
        return unbound_surface_material(identity, program_record, gap_reasons, store_outputs)
    try:
        with tempfile.TemporaryDirectory(dir=converter.output) as work:
            png, _, _, _ = converter.material_texture(Path(work), identity)
        width, height = png_dimensions(png)
    except MATERIAL_CONVERSION_ERRORS as error:
        return unbound_surface_material(identity, program_record, [*gap_reasons, conversion_failure_reason(error)], store_outputs)
    material = BspSurfaceMaterial(identity, png, width, height, program_blend_is_translucent(program), program_record)
    return SurfaceMaterialOutcome(material, gap_reasons, store_outputs)
