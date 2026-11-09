import json
from pathlib import Path
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.gltf_builder import GltfBuilder
from world.static_placement_plan import chunk_for_origin
from world.terrain_coordinates import f32

BSP_POLY_FLAGS_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'bsp-poly-flags.json'
BSP_POLY_FLAGS_SCHEMA_VERSION = 1
BSP_POLY_FLAG_FIELDS = frozenset({'name', 'value', 'sourcePath', 'sourceLine', 'visual', 'diagnostic'})
VISUAL_SKIP = 'skip'
VISUAL_DRAW = 'draw'
UNLIT_FLAG_NAME = 'PF_UNLIT'
SOURCE_FRAME_UNITS_TO_METRES = 0.01
SOURCE_FRAME_AXIS_ORDER = (0, 2, 1)
UNSIGNED_32_BIT_MASK = 0xFFFFFFFF
NO_LIGHTMAP = -1
OUTDOOR_FRONT_ZONE_SIDE = 1
MINIMUM_POLYGON_VERTICES = 3
UNBOUND_MATERIAL_COLOUR = [1, 0, 1, 1]
UNLIT_MATERIAL_EXTENSION = 'KHR_materials_unlit'
CHUNK_BSP_GLTF_GENERATOR = Path(__file__).name


class BspPolygonError(FormatError):
    pass


class BspPolyFlags(NamedTuple):
    visual_skip_mask: int
    unlit_mask: int


class BspSectionKey(NamedTuple):
    material: str
    unlit: bool
    lightmap: object
    outdoor: bool


class BspSection(NamedTuple):
    key: BspSectionKey
    nodes: list


class BspSurfaceMaterial(NamedTuple):
    identity: str
    png: object
    width: object
    height: object
    translucent: bool
    program: object


def load_bsp_poly_flags(path=BSP_POLY_FLAGS_PATH):
    document = json.loads(Path(path).read_text(encoding='utf-8'))
    if document.get('schemaVersion') != BSP_POLY_FLAGS_SCHEMA_VERSION or not isinstance(document.get('flags'), list):
        raise FormatError(f'BSP poly flag recipe must be schemaVersion {BSP_POLY_FLAGS_SCHEMA_VERSION} with a flags list: {path}')
    skip_mask, unlit_mask, names = 0, 0, set()
    for row in document['flags']:
        if not (isinstance(row, dict) and set(row) == BSP_POLY_FLAG_FIELDS and type(row['value']) is int
                and 0 < row['value'] <= UNSIGNED_32_BIT_MASK and type(row['sourceLine']) is int and row['visual'] in (VISUAL_SKIP, VISUAL_DRAW)
                and row['diagnostic'] is True and row['name'] not in names):
            raise FormatError(f'BSP poly flag row is invalid: {row!r}')
        names.add(row['name'])
        if row['visual'] == VISUAL_SKIP:
            skip_mask |= row['value']
        if row['name'] == UNLIT_FLAG_NAME:
            unlit_mask = row['value']
    if not unlit_mask:
        raise FormatError(f'BSP poly flag recipe names no {UNLIT_FLAG_NAME}: {path}')
    return BspPolyFlags(skip_mask, unlit_mask)


def unsigned_flags(value):
    return value & UNSIGNED_32_BIT_MASK


def node_source_polygon(model, node):
    return [model.points[model.verts[node.i_vert_pool + offset][0]] for offset in range(node.num_vertices)]


def polygon_centroid_xy(points):
    return sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)


def drawn_node_indices(model, flags, sky_zones):
    return [index for index, node in enumerate(model.nodes)
            if node.num_vertices >= MINIMUM_POLYGON_VERTICES and not unsigned_flags(model.surfs[node.i_surf].flags) & flags.visual_skip_mask
            and not any(zone in sky_zones for zone in node.i_zone)]


def assign_nodes_to_chunks(model, node_indices, rectangles):
    nodes_by_chunk, outside = {rectangle.chunk_id: [] for rectangle in rectangles}, []
    for index in node_indices:
        chunk_id = chunk_for_origin(rectangles, *polygon_centroid_xy(node_source_polygon(model, model.nodes[index])))
        if chunk_id is None:
            outside.append(index)
        else:
            nodes_by_chunk[chunk_id].append(index)
    return nodes_by_chunk, outside


def node_lightmap_texture(node, lightmap_texture_of_record):
    if node.i_light_map == NO_LIGHTMAP:
        return NO_LIGHTMAP
    return lightmap_texture_of_record.get(node.i_light_map)


def node_section_key(model, node, material_of_surface, flags, lightmap_texture_of_record, outdoor_zones):
    surface = model.surfs[node.i_surf]
    return BspSectionKey(material_of_surface[node.i_surf], bool(unsigned_flags(surface.flags) & flags.unlit_mask),
                         node_lightmap_texture(node, lightmap_texture_of_record), node.i_zone[OUTDOOR_FRONT_ZONE_SIDE] in outdoor_zones)


def section_order(key):
    lightmap_order = (key.lightmap is None, NO_LIGHTMAP if key.lightmap is None else key.lightmap)
    return key.material.casefold(), key.material, key.unlit, lightmap_order, key.outdoor


def build_chunk_sections(model, node_indices, material_of_surface, flags, lightmap_texture_of_record, outdoor_zones):
    nodes_by_key = {}
    for index in sorted(node_indices):
        key = node_section_key(model, model.nodes[index], material_of_surface, flags, lightmap_texture_of_record, outdoor_zones)
        nodes_by_key.setdefault(key, []).append(index)
    return [BspSection(key, nodes_by_key[key]) for key in sorted(nodes_by_key, key=section_order)]


def difference(first, second):
    return [first[axis] - second[axis] for axis in range(3)]


def dot(first, second):
    return sum(first[axis]*second[axis] for axis in range(3))


def newell_normal(points):
    normal = [0.0, 0.0, 0.0]
    for index, current in enumerate(points):
        following = points[(index + 1) % len(points)]
        normal[0] += (current[1] - following[1]) * (current[2] + following[2])
        normal[1] += (current[2] - following[2]) * (current[0] + following[0])
        normal[2] += (current[0] - following[0]) * (current[1] + following[1])
    return normal


def fan_triangle_indices(points, normal, first_vertex, node_index):
    if dot(newell_normal(points), normal) <= 0:
        raise BspPolygonError(f'node {node_index} polygon winding is reversed or degenerate against its stored plane')
    indices = []
    for corner in range(1, len(points) - 1):
        indices.extend((first_vertex, first_vertex + corner + 1, first_vertex + corner))
    return indices


def source_point_to_scene(point):
    return [f32(point[axis] * SOURCE_FRAME_UNITS_TO_METRES) for axis in SOURCE_FRAME_AXIS_ORDER]


def source_texture_uv(model, surface, point, material):
    relative = difference(point, model.points[surface.p_base])
    return [f32(dot(relative, model.vectors[surface.v_texture_u]) / material.width),
            f32(dot(relative, model.vectors[surface.v_texture_v]) / material.height)]


def section_geometry(model, section, material, primitive, node_ranges):
    positions, normals, uvs, indices = [], [], [], []
    for node_index in section.nodes:
        node = model.nodes[node_index]
        surface = model.surfs[node.i_surf]
        points = node_source_polygon(model, node)
        first_vertex, first_index = len(positions), len(indices)
        indices.extend(fan_triangle_indices(points, node.plane[:3], first_vertex, node_index))
        for point in points:
            positions.append(source_point_to_scene(point))
            normals.append([f32(node.plane[axis]) for axis in SOURCE_FRAME_AXIS_ORDER])
            if material.png is not None:
                uvs.append(source_texture_uv(model, surface, point, material))
        node_ranges.append({'node': node_index, 'primitive': primitive, 'firstIndex': first_index, 'indexCount': len(indices) - first_index})
    return positions, normals, uvs, indices


def gltf_material_record(builder, material, unlit, image_of_identity):
    record = {'name': material.identity, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1},
              'extras': {'nativeSourceReference': material.identity, 'nativeMaterialProgram': material.program,
                         'translucent': material.translucent}}
    if material.png is None:
        record['pbrMetallicRoughness']['baseColorFactor'] = list(UNBOUND_MATERIAL_COLOUR)
        record['extras']['unboundSourceMaterial'] = material.identity
    else:
        if material.identity not in image_of_identity:
            image_of_identity[material.identity] = builder.embedded_image(material.png)
            builder.data.setdefault('textures', []).append({'source': image_of_identity[material.identity], 'sampler': 0})
        record['pbrMetallicRoughness']['baseColorTexture'] = {'index': image_of_identity[material.identity]}
    if unlit:
        record['extensions'] = {UNLIT_MATERIAL_EXTENSION: {}}
    return record


def chunk_bsp_glb(model, chunk_id, sections, materials_by_identity):
    builder = GltfBuilder(CHUNK_BSP_GLTF_GENERATOR)
    meshes, nodes, gltf_materials, material_index_of_key, image_of_identity = [], [], [], {}, {}
    section_records, node_ranges = [], []
    for primitive, section in enumerate(sections):
        material = materials_by_identity[section.key.material]
        material_key = (section.key.material, section.key.unlit)
        if material_key not in material_index_of_key:
            material_index_of_key[material_key] = len(gltf_materials)
            gltf_materials.append(gltf_material_record(builder, material, section.key.unlit, image_of_identity))
        positions, normals, uvs, indices = section_geometry(model, section, material, primitive, node_ranges)
        attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'), 'NORMAL': builder.accessor(normals, len(normals), 'VEC3')}
        if uvs:
            attributes['TEXCOORD_0'] = builder.accessor(uvs, len(uvs), 'VEC2')
        index_accessor = builder.accessor(indices, len(indices), 'SCALAR', 5125)
        meshes.append({'name': f'{chunk_id}.section-{primitive}', 'primitives': [{'attributes': attributes, 'indices': index_accessor,
                                                                                  'material': material_index_of_key[material_key]}]})
        nodes.append({'name': f'{chunk_id}.section-{primitive}', 'mesh': primitive})
        section_records.append({'primitive': primitive, 'material': section.key.material, 'unlit': section.key.unlit,
                                'lightmap': section.key.lightmap, 'outdoor': section.key.outdoor, 'translucent': material.translucent})
    if image_of_identity:
        builder.data['samplers'] = [{'wrapS': 10497, 'wrapT': 10497}]
    if any(UNLIT_MATERIAL_EXTENSION in material.get('extensions', {}) for material in gltf_materials):
        builder.data['extensionsUsed'] = [UNLIT_MATERIAL_EXTENSION]
    builder.data.update(materials=gltf_materials, meshes=meshes, nodes=nodes, scenes=[{'nodes': list(range(len(nodes)))}], scene=0,
                        extras={'nativeBspChunk': chunk_id, 'nativeBspSections': section_records, 'nativeBspNodeRanges': node_ranges})
    triangle_count = sum(node_range['indexCount'] for node_range in node_ranges) // 3
    return builder.glb(), section_records, node_ranges, triangle_count


def chunk_bsp_record(chunk_id, resource, sha256, glb, node_count, section_records, node_ranges, triangle_count, gap_rows):
    return {'chunkId': chunk_id, 'resource': resource, 'sha256': sha256, 'bytes': len(glb) if glb else 0, 'nodeCount': node_count,
            'triangleCount': triangle_count, 'sections': section_records, 'nodeRanges': node_ranges, 'gapRows': gap_rows}
