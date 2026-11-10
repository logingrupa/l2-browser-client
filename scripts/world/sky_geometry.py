import math
import struct
from typing import NamedTuple

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError

NATIVE_UNIT_TO_METRE_SCALE = 0.01
GLB_MAGIC = 0x46546C67
GLB_VERSION = 2
GLB_HEADER_BYTES = 12
GLB_CHUNK_HEADER_BYTES = 8
GLTF_FLOAT_COMPONENT = 5126
GLTF_UNSIGNED_INTEGER_COMPONENT = 5125
GLTF_REPEAT_WRAP = 10497
GLTF_ACCESSOR_TYPES = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}
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


def float32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def cross(left, right):
    return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]]


def difference(left, right):
    return [left[axis] - right[axis] for axis in range(3)]


def dot(left, right):
    return sum(x * y for x, y in zip(left, right))


def sky_zone_node_indices(package, model, zone_index, material_identity):
    return [node_index for node_index, node in enumerate(model.nodes)
            if zone_index in node.i_zone and package.object_name(model.surfs[node.i_surf].material).casefold() == material_identity.casefold()]


def sky_zone_material_identities(package, model, zone_index):
    identities = []
    for node in model.nodes:
        if zone_index not in node.i_zone:
            continue
        identity = package.object_name(model.surfs[node.i_surf].material)
        if identity is not None and identity.casefold() not in {known.casefold() for known in identities}:
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
        part['positions'].extend(float32(point[axis] * NATIVE_UNIT_TO_METRE_SCALE) for axis in SOURCE_TO_BROWSER_AXES)
        part['normals'].extend(float32(normal[axis]) for axis in SOURCE_TO_BROWSER_AXES)
        relative = difference(point, base)
        part['uvs'].extend((float32(dot(relative, texture_u) / texture['width']), float32(dot(relative, texture_v) / texture['height'])))
    for corner in range(1, len(points) - 1):
        if dot(cross(difference(points[corner], points[0]), difference(points[corner + 1], points[0])), normal) <= 0:
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


class GlbBuffer:
    def __init__(self):
        self.binary, self.views, self.accessors = bytearray(), [], []

    def append(self, data):
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        offset = len(self.binary)
        self.binary.extend(data)
        self.views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
        return len(self.views) - 1

    def accessor(self, values, dimensions, integer=False, bounds=False):
        view = self.append(struct.pack('<' + str(len(values)) + ('I' if integer else 'f'), *values))
        accessor = {'bufferView': view, 'componentType': GLTF_UNSIGNED_INTEGER_COMPONENT if integer else GLTF_FLOAT_COMPONENT,
                    'count': len(values) // dimensions, 'type': GLTF_ACCESSOR_TYPES[dimensions]}
        if bounds:
            accessor.update(min=[min(values[axis::3]) for axis in range(3)], max=[max(values[axis::3]) for axis in range(3)])
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def sky_part_material(part, texture_index):
    return {'name': part['sourceMaterial'], 'extensions': {'KHR_materials_unlit': {}},
            'pbrMetallicRoughness': {'baseColorTexture': {'index': texture_index},
                                     'baseColorFactor': [value / 255 for value in part['authoredColorRGBA']], 'metallicFactor': 0, 'roughnessFactor': 1},
            'alphaMode': 'BLEND' if part['alphaBlend'] else 'OPAQUE', 'doubleSided': part['renderTwoSided'],
            'extras': {'nativeSourceReference': part['sourceMaterial'], 'sourceSnapshot': True,
                       'nativeBspTwoSidedPrecedence': 'unverified; per-node flags retained in sky.json'}}


def build_sky_glb(snapshot, files):
    buffer, meshes, materials, images, textures = GlbBuffer(), [], [], [], []
    for index, part in enumerate(snapshot['parts']):
        attributes = {'POSITION': buffer.accessor(part['positions'], 3, bounds=True), 'NORMAL': buffer.accessor(part['normals'], 3),
                      'TEXCOORD_0': buffer.accessor(part['uvs'], 2)}
        indices = buffer.accessor(part['indices'], 1, integer=True)
        images.append({'bufferView': buffer.append(files[part['texture']['png']['file']]), 'mimeType': 'image/png'})
        textures.append({'source': index, 'sampler': 0})
        materials.append(sky_part_material(part, index))
        meshes.append({'name': part['sourceMaterial'], 'primitives': [{'attributes': attributes, 'indices': indices, 'material': index}]})
    nodes = [{'name': snapshot['id'], 'translation': snapshot['rootTranslationMetres'], 'children': list(range(1, len(snapshot['parts']) + 1))}]
    nodes += [{'mesh': index, 'name': part['sourceMaterial']} for index, part in enumerate(snapshot['parts'])]
    document = {'asset': {'version': '2.0', 'generator': SKY_GLB_GENERATOR}, 'extensionsUsed': ['KHR_materials_unlit'],
                'buffers': [{'byteLength': len(buffer.binary)}], 'bufferViews': buffer.views, 'accessors': buffer.accessors, 'images': images,
                'textures': textures, 'samplers': [{'wrapS': GLTF_REPEAT_WRAP, 'wrapT': GLTF_REPEAT_WRAP}], 'materials': materials,
                'meshes': meshes, 'nodes': nodes, 'scenes': [{'nodes': [0]}], 'scene': 0}
    text = json_bytes(document)
    text += b' ' * (-len(text) % 4)
    binary = bytes(buffer.binary) + b'\0' * (-len(buffer.binary) % 4)
    total = GLB_HEADER_BYTES + 2 * GLB_CHUNK_HEADER_BYTES + len(text) + len(binary)
    return (struct.pack('<III', GLB_MAGIC, GLB_VERSION, total) + struct.pack('<I4s', len(text), b'JSON') + text
            + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
