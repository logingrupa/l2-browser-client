from pathlib import Path
import struct
import subprocess
import tempfile
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_program import derive_material_program, read_material_class_defaults
from native_assets_lib.material_resources import write_native_material_resources
from world.bsp_chunk_geometry import BspSurfaceMaterial
from world.static_mesh_step import conversion_failure_reason

OPAQUE_BLEND_MEMBERS_OF_CLASS = {'Engine.Shader': ('OutputBlending', frozenset({'OB_Normal', 'OB_Masked'})),
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


def program_blend_is_translucent(program):
    root = root_program_node(program)
    blend = OPAQUE_BLEND_MEMBERS_OF_CLASS.get(root['class'])
    if blend is None:
        return False
    field_name, opaque_members = blend
    field = next((field for field in root['fields'] if field['field'].casefold() == field_name.casefold()), None)
    if field is None or not isinstance(field['value'], dict) or not isinstance(field['value'].get('name'), str):
        return False
    return field['value']['name'] not in opaque_members


def unbound_surface_material(identity, program_record, gap_reasons, store_outputs):
    return SurfaceMaterialOutcome(BspSurfaceMaterial(identity, None, None, None, False, program_record), gap_reasons, store_outputs)


def material_program_record(store_root, graph, program):
    written = write_native_material_resources(store_root, graph, program)
    program_file = next(record for record in written['files'] if record['path'].endswith('program.json'))
    return {'directory': written['directory'], 'programSha256': program_file['sha256']}, written['files']


def convert_surface_material(identity, map_sources, converter, class_work_root, class_scripts, store_root):
    try:
        package, item = resolve_material_export(map_sources, identity)
        graph = read_material_graph(package, item)
        program = derive_material_program(graph, read_material_class_defaults(graph, class_work_root, class_scripts))
        program_record, store_outputs = material_program_record(store_root, graph, program)
    except MATERIAL_CONVERSION_ERRORS as error:
        return unbound_surface_material(identity, None, [conversion_failure_reason(error)], [])
    gap_reasons = list(program['gapReasons'])
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
