import struct
from types import SimpleNamespace

from world.bsp_lightmaps import LIGHTMAP_PAGE_MIPS, LIGHTMAP_PROJECTION_FLOAT_COUNT, LIGHTMAP_RECORD_TRAILER_BYTES
from world.reader_licensee_layouts import REVIEWED_PACKAGE_VERSION

RENDER_VERTEX_PREFIX_BYTES = 20
RENDER_VERTEX_NORMAL = (0.0, 0.0, 1.0)
FIXTURE_TILE_TAG = 5
FIXTURE_FOOTER = bytes((3, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0))


def compact_index_bytes(value):
    magnitude = abs(value)
    first = (0x80 if value < 0 else 0) | (magnitude & 0x3F)
    magnitude >>= 6
    encoded = bytearray([first | (0x40 if magnitude else 0)])
    while magnitude:
        byte = magnitude & 0x7F
        magnitude >>= 7
        encoded.append(byte | (0x80 if magnitude else 0))
    return bytes(encoded)


def render_section_bytes(vertex_uvs, node_count, lightmap_texture, material_reference=1, poly_flags=0, revision=None):
    vertices = b''.join(bytes(RENDER_VERTEX_PREFIX_BYTES) + struct.pack('<2f', *uv) + struct.pack('<3f', *RENDER_VERTEX_NORMAL) for uv in vertex_uvs)
    return (compact_index_bytes(len(vertex_uvs)) + vertices + struct.pack('<i', node_count if revision is None else revision)
            + compact_index_bytes(material_reference) + struct.pack('<iIi', node_count, poly_flags, lightmap_texture))


def lightmap_record_bytes(surface, rectangle):
    return (compact_index_bytes(surface) + compact_index_bytes(0) + b''.join(compact_index_bytes(value) for value in rectangle)
            + struct.pack(f'<{LIGHTMAP_PROJECTION_FLOAT_COUNT}f', *([0.0] * LIGHTMAP_PROJECTION_FLOAT_COUNT)) + compact_index_bytes(0)
            + compact_index_bytes(FIXTURE_TILE_TAG) + bytes(LIGHTMAP_RECORD_TRAILER_BYTES))


def record_index_list_bytes(indices):
    return compact_index_bytes(len(indices)) + b''.join(struct.pack('<i', index) for index in indices)


def page_mip_bytes(seed):
    return tuple(bytes((seed + offset) & 0xFF for offset in range(byte_count)) for _, byte_count in LIGHTMAP_PAGE_MIPS)


def append_lightmap_texture(tail, record_indices, page_mips):
    tail += compact_index_bytes(len(page_mips))
    for mips in page_mips:
        tail += compact_index_bytes(FIXTURE_TILE_TAG) + record_index_list_bytes(record_indices) + struct.pack('<3i', 0, 1, 0)
        for mip in mips:
            skip_position = len(tail) + 4 + len(compact_index_bytes(len(mip))) + len(mip)
            tail += struct.pack('<i', skip_position) + compact_index_bytes(len(mip)) + mip
        tail += FIXTURE_FOOTER
    tail += record_index_list_bytes([])


def build_lightmap_tail(sections, record_rectangles, textures):
    tail = bytearray(compact_index_bytes(len(sections)))
    for section in sections:
        tail += section
    tail += compact_index_bytes(len(record_rectangles)) + bytes(1)
    for surface, rectangle in record_rectangles:
        tail += lightmap_record_bytes(surface, rectangle)
    for record_indices, page_mips in textures:
        append_lightmap_texture(tail, record_indices, page_mips)
    return bytes(tail)


def lightmap_node(light_map, section, vertex_offset, vertex_count):
    return SimpleNamespace(i_light_map=light_map, i_section=section, i_vert_offset=vertex_offset, num_vertices=vertex_count)


def lightmap_model_and_package(tail, nodes, surface_count):
    model = SimpleNamespace(export=SimpleNamespace(serial_offset=0, serial_size=len(tail)), lightmap_tail=len(tail), nodes=list(nodes),
                            surfs=[SimpleNamespace() for _ in range(surface_count)])
    return model, SimpleNamespace(data=tail, summary={'version': REVIEWED_PACKAGE_VERSION})
