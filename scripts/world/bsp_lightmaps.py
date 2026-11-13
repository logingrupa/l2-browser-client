import math
import struct
from typing import NamedTuple

from native_catalog.ue2 import FormatError, Reader
from world.bsp_model_licensee_rules import read_bsp_model_licensee_rules

RENDER_VERTEX_LIGHTMAP_UV_OFFSET = 20
LIGHTMAP_ATLAS_EDGE = 512
LIGHTMAP_PROJECTION_FLOAT_COUNT = 25
LIGHTMAP_SHADOW_MASK_TRAILER_INTEGERS = 7
LIGHTMAP_RECORD_TRAILER_BYTES = 5
LIGHTMAP_PAGE_HEADER_INTEGERS = 3
LIGHTMAP_PAGE_MIPS = ((512, 131072), (256, 32768))
LIGHTMAP_PAGE_FOOTER_BYTES = 13
MAXIMUM_LIGHTMAP_PAGES_PER_TEXTURE = 8
MAXIMUM_RENDER_SECTIONS = 100_000
MAXIMUM_RENDER_VERTICES = 4_000_000
MAXIMUM_LIGHTMAP_RECORDS = 200_000
MAXIMUM_SHADOW_MASKS = 100_000
MAXIMUM_SHADOW_MASK_BYTES = 1 << 22
NO_LIGHTMAP = -1
LIGHTMAP_INDEX_INVALID_REASON_PREFIX = 'lighting-lightmap-index-invalid:'


class RenderSection(NamedTuple):
    vertex_count: int
    vertex_offset: int
    revision: int
    material_reference: int
    node_count: int
    poly_flags: int
    lightmap_texture: int


class LightmapRecord(NamedTuple):
    surface: int
    atlas_field: int
    rectangle: tuple
    projection: tuple
    shadow_mask_count: int
    tag: int
    trailer: bytes


class LightmapPage(NamedTuple):
    texture: int
    slot: int
    slot_count: int
    header: tuple
    mips: tuple
    footer: bytes


class LightmapTexture(NamedTuple):
    first_record: int
    record_count: int
    pages: tuple


class BspLightmaps(NamedTuple):
    sections: tuple
    records: tuple
    textures: tuple
    lead_byte: int | None
    unwalked_tail_bytes: int

    @property
    def pages(self):
        return tuple(page for texture in self.textures for page in texture.pages)


def lightmap_index_invalid_reason(index):
    return f'{LIGHTMAP_INDEX_INVALID_REASON_PREFIX}{index}'


def model_tail_bounds(model):
    end = model.export.serial_offset + model.export.serial_size
    return end - model.lightmap_tail, end


def render_vertex_bytes(package_version):
    vertex_layout = read_bsp_model_licensee_rules()['document']['layouts']['renderVertex']
    trailing_members = vertex_layout['trailingMembers'] if package_version >= vertex_layout['trailingMinimumPackageVersion'] else []
    return vertex_layout['memberBytes'] * (len(vertex_layout['wireOrder']) + len(trailing_members))


def assigned_section_totals(nodes):
    totals = {}
    for node in nodes:
        if node.num_vertices > 0:
            node_count, vertex_count = totals.get(node.i_section, (0, 0))
            totals[node.i_section] = (node_count + 1, vertex_count + node.num_vertices)
    return totals


def read_render_sections(reader, nodes, package_version):
    section_count = reader.compact()
    if not 0 <= section_count <= MAXIMUM_RENDER_SECTIONS:
        raise FormatError(f'render section count {section_count} is outside 0..{MAXIMUM_RENDER_SECTIONS}')
    vertex_bytes, totals = render_vertex_bytes(package_version), assigned_section_totals(nodes)
    sections = []
    for section_index in range(section_count):
        vertex_count = reader.compact()
        if not 0 <= vertex_count <= MAXIMUM_RENDER_VERTICES:
            raise FormatError(f'render section {section_index} declares {vertex_count} vertices')
        vertex_offset = reader.position
        reader.take(vertex_bytes * vertex_count)
        revision, material_reference, node_count = reader.number('i'), reader.compact(), reader.number('i')
        poly_flags, lightmap_texture = reader.number('I'), reader.number('i')
        assigned_nodes, assigned_vertices = totals.get(section_index, (0, 0))
        if vertex_count != assigned_vertices:
            raise FormatError(f'render section {section_index} holds {vertex_count} vertices, but its assigned nodes hold {assigned_vertices}')
        if node_count != assigned_nodes:
            raise FormatError(f'render section {section_index} declares {node_count} nodes, but {assigned_nodes} nodes with vertices are assigned to it')
        sections.append(RenderSection(vertex_count, vertex_offset, revision, material_reference, node_count, poly_flags, lightmap_texture))
    return tuple(sections)


def skip_shadow_masks(reader, record_index, rectangle):
    mask_count = reader.compact()
    if not 0 <= mask_count <= MAXIMUM_SHADOW_MASKS:
        raise FormatError(f'lightmap record {record_index} declares {mask_count} shadow masks')
    _, _, record_width, record_height = rectangle
    for mask_index in range(mask_count):
        reader.compact()
        byte_count = reader.compact()
        if not 0 < byte_count <= MAXIMUM_SHADOW_MASK_BYTES:
            raise FormatError(f'lightmap record {record_index} mask {mask_index} declares {byte_count} bytes')
        reader.take(byte_count)
        width, height, row_bytes, pad_u, pad_v, clamp_u, clamp_v = (reader.number('i') for _ in range(LIGHTMAP_SHADOW_MASK_TRAILER_INTEGERS))
        if (clamp_u != width + pad_u - 1 or clamp_v != height + pad_v - 1 or row_bytes != (width + 7) // 8 or byte_count != row_bytes * height
                or width + pad_u > record_width or height + pad_v > record_height):
            raise FormatError(f'lightmap record {record_index} mask {mask_index} does not fit its {record_width}x{record_height} rectangle')
    return mask_count


def read_lightmap_record(reader, record_index, surface_count):
    surface, atlas_field = reader.compact(), reader.compact()
    rectangle = tuple(reader.compact() for _ in range(4))
    x, y, width, height = rectangle
    if not 0 <= surface < surface_count:
        raise FormatError(f'lightmap record {record_index} names surface {surface} outside {surface_count} surfaces')
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > LIGHTMAP_ATLAS_EDGE or y + height > LIGHTMAP_ATLAS_EDGE:
        raise FormatError(f'lightmap record {record_index} rectangle {rectangle} leaves the {LIGHTMAP_ATLAS_EDGE} atlas')
    projection = struct.unpack(f'<{LIGHTMAP_PROJECTION_FLOAT_COUNT}f', reader.take(4 * LIGHTMAP_PROJECTION_FLOAT_COUNT))
    shadow_mask_count = skip_shadow_masks(reader, record_index, rectangle)
    tag = reader.compact()
    return LightmapRecord(surface, atlas_field, rectangle, projection, shadow_mask_count, tag, bytes(reader.take(LIGHTMAP_RECORD_TRAILER_BYTES)))


def read_record_index_array(reader, record_count, label):
    count = reader.compact()
    if not 0 <= count <= record_count:
        raise FormatError(f'{label} lists {count} records of {record_count}')
    values = [reader.number('i') for _ in range(count)]
    if any(not 0 <= value < record_count for value in values) or any(second <= first for first, second in zip(values, values[1:])):
        raise FormatError(f'{label} is not a strictly ascending record index list')
    return values


def read_lightmap_page(reader, texture_index, slot, slot_count, record_count):
    tag = reader.compact()
    members = read_record_index_array(reader, record_count, f'lightmap texture {texture_index} page {slot}')
    header = tuple(reader.number('i') for _ in range(LIGHTMAP_PAGE_HEADER_INTEGERS))
    mips = []
    for edge, byte_count in LIGHTMAP_PAGE_MIPS:
        skip_position, declared_bytes = reader.number('i'), reader.compact()
        if declared_bytes != byte_count:
            raise FormatError(f'lightmap texture {texture_index} page {slot} mip {edge} holds {declared_bytes} bytes, not {byte_count}')
        mips.append(bytes(reader.take(declared_bytes)))
        if reader.position != skip_position:
            raise FormatError(f'lightmap texture {texture_index} page {slot} mip {edge} ends at {reader.position}, not its skip position {skip_position}')
    footer = bytes(reader.take(LIGHTMAP_PAGE_FOOTER_BYTES))
    return tag, members, LightmapPage(texture_index, slot, slot_count, header, tuple(mips), footer)


def read_lightmap_texture(reader, texture_index, first_record, record_count):
    slot_count = reader.compact()
    if not 1 <= slot_count <= MAXIMUM_LIGHTMAP_PAGES_PER_TEXTURE:
        raise FormatError(f'lightmap texture {texture_index} declares {slot_count} pages')
    tags, member_lists, pages = set(), [], []
    for slot in range(slot_count):
        tag, members, page = read_lightmap_page(reader, texture_index, slot, slot_count, record_count)
        tags.add(tag)
        member_lists.append(members)
        pages.append(page)
    read_record_index_array(reader, record_count, f'lightmap texture {texture_index} trailing list')
    members = member_lists[0]
    if members != list(range(first_record, first_record + len(members))):
        raise FormatError(f'lightmap texture {texture_index} does not cover the record run from {first_record}')
    return tags, LightmapTexture(first_record, len(members), tuple(pages))


def read_lightmap_textures(reader, end, records):
    textures, tags, first_record = [], {record.tag for record in records}, 0
    while reader.position < end:
        texture_tags, texture = read_lightmap_texture(reader, len(textures), first_record, len(records))
        tags |= texture_tags
        textures.append(texture)
        first_record += texture.record_count
    if first_record != len(records):
        raise FormatError(f'lightmap textures cover {first_record} records of {len(records)}')
    if len(tags) > 1:
        raise FormatError(f'lightmap records and pages disagree on the tile tag: {sorted(tags)}')
    return tuple(textures)


def read_bsp_lightmaps(package, model):
    start, end = model_tail_bounds(model)
    reader = Reader(package.data, start, end)
    sections = read_render_sections(reader, model.nodes, package.summary['version'])
    record_count = reader.compact()
    if not 0 <= record_count <= MAXIMUM_LIGHTMAP_RECORDS:
        raise FormatError(f'lightmap record count {record_count} is outside 0..{MAXIMUM_LIGHTMAP_RECORDS}')
    if record_count == 0:
        if any(node.i_light_map != NO_LIGHTMAP for node in model.nodes):
            raise FormatError('the model holds no lightmap records but a node points at one')
        return BspLightmaps(sections, (), (), None, end - reader.position)
    lead_byte = reader.number('B')
    records = tuple(read_lightmap_record(reader, index, len(model.surfs)) for index in range(record_count))
    textures = read_lightmap_textures(reader, end, records)
    return BspLightmaps(sections, records, textures, lead_byte, 0)


def node_lightmap_texture(lightmaps, node):
    if node.i_light_map == NO_LIGHTMAP:
        return NO_LIGHTMAP, None
    if not 0 <= node.i_light_map < len(lightmaps.records):
        return None, lightmap_index_invalid_reason(node.i_light_map)
    if not 0 <= node.i_section < len(lightmaps.sections):
        return None, lightmap_index_invalid_reason(node.i_section)
    texture = lightmaps.sections[node.i_section].lightmap_texture
    if not 0 <= texture < len(lightmaps.textures):
        return None, lightmap_index_invalid_reason(texture)
    texture_record = lightmaps.textures[texture]
    if not texture_record.first_record <= node.i_light_map < texture_record.first_record + texture_record.record_count:
        return None, lightmap_index_invalid_reason(node.i_light_map)
    return texture, None


def lightmap_texture_of_record(lightmaps, model):
    textures = {}
    for node in model.nodes:
        texture, reason = node_lightmap_texture(lightmaps, node)
        if reason is None and texture != NO_LIGHTMAP:
            textures[node.i_light_map] = texture
    return textures


def node_lightmap_uvs(package, lightmaps, node):
    section = lightmaps.sections[node.i_section]
    if node.i_vert_offset < 0 or node.i_vert_offset + node.num_vertices > section.vertex_count:
        raise FormatError(f'node vertex offset {node.i_vert_offset} leaves render section {node.i_section}')
    uvs, vertex_bytes = [], render_vertex_bytes(package.summary['version'])
    for vertex in range(node.i_vert_offset, node.i_vert_offset + node.num_vertices):
        position = section.vertex_offset + vertex_bytes * vertex + RENDER_VERTEX_LIGHTMAP_UV_OFFSET
        uv = struct.unpack_from('<2f', package.data, position)
        if not all(math.isfinite(value) for value in uv):
            raise FormatError(f'render vertex {vertex} of section {node.i_section} holds a non-finite lightmap UV')
        uvs.append(uv)
    return uvs
