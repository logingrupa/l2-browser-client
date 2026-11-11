import math
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.gltf_builder import GLTF_UNSIGNED_INTEGER_COMPONENT, GltfBuilder
from world.terrain_coordinates import cross, dot, f32, subtract

NATIVE_UNIT_TO_METRE_SCALE = 0.01
GLTF_REPEAT_WRAP = 10497
SKY_GLB_GENERATOR = 'scripts/world/sky_geometry.py'
SOURCE_TO_BROWSER_AXES = (0, 2, 1)
SKY_COORDINATE_RULE = ('positions=sourceXYZ→XZY*0.01; exactly one root translation=-SkyZoneXYZ→XZY*0.01; no pre-subtraction; '
                       'reverse fan indices once')
SKY_UV_RULE = 'stored BSP dot(position-base, textureU/V) divided by original texture dimensions; no panner transform applied'


class SkyRootSurface(NamedTuple):
    source_material: str
    map_reference: str
    authored_color_rgba: list
    alpha_blend: bool
    alpha_source: str
    render_two_sided: bool
    texture: dict


def sky_zone_material_nodes(package, model, zone_index):
    for node_index, node in enumerate(model.nodes):
        if zone_index not in node.i_zone:
            continue
        identity = package.object_name(model.surfs[node.i_surf].material)
        if identity is not None:
            yield node_index, identity


def sky_zone_node_indices(package, model, zone_index, material_identity):
    return [node_index for node_index, identity in sky_zone_material_nodes(package, model, zone_index)
            if identity.casefold() == material_identity.casefold()]


def sky_zone_material_identities(package, model, zone_index):
    identities = []
    for _, identity in sky_zone_material_nodes(package, model, zone_index):
        if identity.casefold() not in {known.casefold() for known in identities}:
            identities.append(identity)
    return identities


def node_polygon(model, node, node_index):
    points = [list(model.points[model.verts[node.i_vert_pool + corner][0]]) for corner in range(node.num_vertices)]
    if len(points) < 3:
        raise FormatError(f'sky node {node_index} is a degenerate polygon with {len(points)} points')
    if not all(math.isfinite(value) for point in points for value in point):
        raise FormatError(f'sky node {node_index} has a non-finite point')
    return points


def append_node(part, package, model, node_index, texture):
    node = model.nodes[node_index]
    surface = model.surfs[node.i_surf]
    points = node_polygon(model, node, node_index)
    normal = list(node.plane[:3])
    start, first_index = len(part['positions']) // 3, len(part['indices'])
    base, texture_u, texture_v = model.points[surface.p_base], model.vectors[surface.v_texture_u], model.vectors[surface.v_texture_v]
    for point in points:
        part['positions'].extend(f32(point[axis] * NATIVE_UNIT_TO_METRE_SCALE) for axis in SOURCE_TO_BROWSER_AXES)
        part['normals'].extend(f32(normal[axis]) for axis in SOURCE_TO_BROWSER_AXES)
        relative = subtract(point, base)
        part['uvs'].extend((f32(dot(relative, texture_u) / texture['width']), f32(dot(relative, texture_v) / texture['height'])))
    for corner in range(1, len(points) - 1):
        if dot(cross(subtract(points[corner], points[0]), subtract(points[corner + 1], points[0])), normal) <= 0:
            raise FormatError(f'sky node {node_index} fan triangle {corner} is degenerate or wound against its plane')
        part['indices'].extend((start, start + corner + 1, start + corner))
    part['nodeRanges'].append({'node': node_index, 'surface': node.i_surf, 'vertexStart': start, 'vertexCount': len(points),
                               'indexStart': first_index, 'indexCount': len(part['indices']) - first_index, 'nativePositions': points,
                               'nativePlane': list(node.plane), 'nativeTextureBase': list(base), 'nativeTextureU': list(texture_u),
                               'nativeTextureV': list(texture_v), 'nodeFlags': node.flags, 'surfaceFlags': surface.flags,
                               'zoneSides': list(node.i_zone), 'sourceActor': package.object_name(surface.actor), 'renderSection': node.i_section,
                               'renderVertexOffset': node.i_vert_offset, 'lightMap': node.i_light_map})


def build_sky_zone_parts(package, model, zone_index, root_surfaces):
    parts = []
    for root in root_surfaces:
        part = {'sourceMaterial': root.source_material, 'mapReference': root.map_reference, 'positions': [], 'normals': [], 'uvs': [],
                'indices': [], 'nodeRanges': [], 'texture': root.texture, 'authoredColorRGBA': root.authored_color_rgba,
                'alphaBlend': root.alpha_blend, 'renderTwoSided': root.render_two_sided, 'alphaSource': root.alpha_source}
        for node_index in sky_zone_node_indices(package, model, zone_index, root.map_reference):
            append_node(part, package, model, node_index, root.texture)
        parts.append(part)
    return parts


def sky_root_translation_metres(location):
    return [-location[axis] * NATIVE_UNIT_TO_METRE_SCALE for axis in SOURCE_TO_BROWSER_AXES]


def vector_rows(values, dimensions):
    return [values[start:start + dimensions] for start in range(0, len(values), dimensions)]


def sky_part_attributes(builder, part):
    positions, normals, uvs = vector_rows(part['positions'], 3), vector_rows(part['normals'], 3), vector_rows(part['uvs'], 2)
    return {'POSITION': builder.accessor(positions, len(positions), 'VEC3'), 'NORMAL': builder.accessor(normals, len(normals), 'VEC3', bounds=False),
            'TEXCOORD_0': builder.accessor(uvs, len(uvs), 'VEC2')}


def sky_part_material(part, texture_index):
    return {'name': part['sourceMaterial'], 'extensions': {'KHR_materials_unlit': {}},
            'pbrMetallicRoughness': {'baseColorTexture': {'index': texture_index},
                                     'baseColorFactor': [value / 255 for value in part['authoredColorRGBA']], 'metallicFactor': 0, 'roughnessFactor': 1},
            'alphaMode': 'BLEND' if part['alphaBlend'] else 'OPAQUE', 'doubleSided': part['renderTwoSided'],
            'extras': {'nativeSourceReference': part['sourceMaterial'], 'sourceSnapshot': True,
                       'nativeBspTwoSidedPrecedence': 'unverified; per-node flags retained in sky.json'}}


def build_sky_glb(snapshot, files):
    builder, meshes, materials, textures = GltfBuilder(SKY_GLB_GENERATOR), [], [], []
    for index, part in enumerate(snapshot['parts']):
        attributes = sky_part_attributes(builder, part)
        indices = builder.accessor(part['indices'], len(part['indices']), 'SCALAR', GLTF_UNSIGNED_INTEGER_COMPONENT)
        textures.append({'source': builder.embedded_image(files[part['texture']['png']['file']]), 'sampler': 0})
        materials.append(sky_part_material(part, index))
        meshes.append({'name': part['sourceMaterial'], 'primitives': [{'attributes': attributes, 'indices': indices, 'material': index}]})
    nodes = [{'name': snapshot['id'], 'translation': snapshot['rootTranslationMetres'], 'children': list(range(1, len(snapshot['parts']) + 1))}]
    nodes += [{'mesh': index, 'name': part['sourceMaterial']} for index, part in enumerate(snapshot['parts'])]
    builder.data.update({'extensionsUsed': ['KHR_materials_unlit'], 'textures': textures,
                         'samplers': [{'wrapS': GLTF_REPEAT_WRAP, 'wrapT': GLTF_REPEAT_WRAP}], 'materials': materials, 'meshes': meshes,
                         'nodes': nodes, 'scenes': [{'nodes': [0]}], 'scene': 0})
    return builder.glb()
