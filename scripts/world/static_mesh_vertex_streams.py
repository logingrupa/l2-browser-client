import json
import struct
from typing import NamedTuple

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from world.terrain_coordinates import f32
from world.error_detail import first_line_of_error


class StaticMeshTailLayout(NamedTuple):
    lazy_collision_arrays: bool
    level_of_detail_trailing_integers: int


REVIEWED_COLOUR_STREAM_LAYOUTS = {
    (123, 12): StaticMeshTailLayout(lazy_collision_arrays=False, level_of_detail_trailing_integers=0),
    (123, 14): StaticMeshTailLayout(lazy_collision_arrays=False, level_of_detail_trailing_integers=3),
    (123, 16): StaticMeshTailLayout(lazy_collision_arrays=False, level_of_detail_trailing_integers=4),
    **{(123, licensee): StaticMeshTailLayout(lazy_collision_arrays=True, level_of_detail_trailing_integers=4) for licensee in (18, 19, 20, 22, 23, 25, 28, 30, 31)},
}
PRIMITIVE_BOUNDS_BYTES = 25 + 16
STATIC_MESH_SECTION_FORMAT = '<IHHHHH'
STATIC_MESH_BOUNDING_BOX_BYTES = 25
STATIC_MESH_VERTEX_FORMAT = '<6f'
COLOUR_BYTES = 4
UV_FORMAT = '<2f'
INDEX_FORMAT = '<H'
VERTICES_PER_TRIANGLE = 3
COLLISION_TRIANGLE_PLANES_BYTES = 4 * 16
COLLISION_TRIANGLE_INDEX_COUNT = 4
COLLISION_NODE_INDEX_COUNT = 4
LEVEL_OF_DETAIL_REFERENCE_COUNT = 2
LEVEL_OF_DETAIL_FIELDS_FORMAT = '<2fi2f'
AUTHORED_TRIANGLE_POSITIONS_BYTES = VERTICES_PER_TRIANGLE * 3 * 4
AUTHORED_TRIANGLE_UV_CHANNEL_BYTES = VERTICES_PER_TRIANGLE * 2 * 4
AUTHORED_TRIANGLE_TRAILING_FORMAT = '<5i'
INTEGER_BYTES = 4
MAXIMUM_STREAM_ELEMENTS = 4_000_000
MAXIMUM_SECTIONS = 4096
MAXIMUM_UV_STREAMS = 8
SOURCE_UNITS_TO_GLTF_METRES = 0.01
GLTF_AXIS_OF_SOURCE_AXIS = (0, 2, 1)
GLTF_FLOAT_COMPONENT_TYPE = 5126
GLB_HEADER_BYTES = 12
GLB_CHUNK_HEADER_BYTES = 8
VERTEX_STREAMS_KIND = 'native-static-mesh-vertex-streams'
VERTEX_STREAMS_SCHEMA_VERSION = 3
VERTEX_STREAMS_FILE_NAME = 'vertex-streams.json'
VERTEX_STREAMS_STORE_FOLDER = 'static-mesh-vertex-streams'
COLOUR_SELECTOR_UNRESOLVED_REASON = 'static-mesh-colour-selector-unresolved'
COLOUR_STREAM_LAYOUT_UNREVIEWED_REASON_PREFIX = 'static-mesh-colour-stream-layout-unreviewed:'
COLOUR_STREAM_JOIN_MISMATCH_REASON = 'static-mesh-colour-stream-join-mismatch'
COLOUR_STREAM_UNREAD_REASON_PREFIX = 'static-mesh-colour-stream-unread:'


class StaticMeshSection(NamedTuple):
    first_index: int
    triangle_count: int


class StaticMeshVertexStreams(NamedTuple):
    sections: tuple
    positions: tuple
    normals: tuple
    primary_colours: bytes
    primary_revision: int
    alternate_colours: bytes
    alternate_revision: int
    first_uvs: tuple
    indices: tuple


class VertexStreamOutcome(NamedTuple):
    payload: bytes | None
    gap_reason: str | None


def colour_stream_layout_unreviewed_reason(package_version, licensee):
    return f'{COLOUR_STREAM_LAYOUT_UNREVIEWED_REASON_PREFIX}{package_version}/{licensee}'


def colour_stream_unread_reason(error):
    return f'{COLOUR_STREAM_UNREAD_REASON_PREFIX}{first_line_of_error(error)}'


def vertex_streams_store_path(payload_sha256):
    return f'{VERTEX_STREAMS_STORE_FOLDER}/{payload_sha256}/{VERTEX_STREAMS_FILE_NAME}'


def counted(reader, label, maximum=MAXIMUM_STREAM_ELEMENTS):
    count = reader.compact()
    if not 0 <= count <= maximum:
        raise FormatError(f'{label} declares {count} elements')
    return count


def unpacked_rows(reader, row_format, count):
    return tuple(struct.iter_unpack(row_format, reader.take(struct.calcsize(row_format) * count)))


def read_sections(reader, label):
    rows = unpacked_rows(reader, STATIC_MESH_SECTION_FORMAT, counted(reader, f'{label} sections', MAXIMUM_SECTIONS))
    return tuple(StaticMeshSection(first_index, triangle_count) for _, first_index, _, _, triangle_count, _ in rows)


def read_colour_stream(reader, vertex_count, label):
    count = counted(reader, label)
    if count != vertex_count:
        raise FormatError(f'{label} holds {count} colours for {vertex_count} vertices')
    return bytes(reader.take(COLOUR_BYTES * count)), reader.number('i')


def read_uv_streams(reader, vertex_count, label):
    streams = []
    for stream_index in range(counted(reader, f'{label} UV streams', MAXIMUM_UV_STREAMS)):
        count = counted(reader, f'{label} UV stream {stream_index}')
        if count != vertex_count:
            raise FormatError(f'{label} UV stream {stream_index} holds {count} coordinates for {vertex_count} vertices')
        streams.append(unpacked_rows(reader, UV_FORMAT, count))
        reader.number('i')
        reader.number('i')
    if not streams:
        raise FormatError(f'{label} holds no UV stream')
    return streams


def reviewed_tail_layout(package):
    layout = (package.summary['version'], package.summary['licenseeVersion'])
    if layout not in REVIEWED_COLOUR_STREAM_LAYOUTS:
        raise FormatError(f'{package.filename} holds the unreviewed static mesh layout {layout[0]}/{layout[1]}')
    return REVIEWED_COLOUR_STREAM_LAYOUTS[layout]


def skip_compact_indices(reader, count):
    for _ in range(count):
        reader.compact()


def skip_object_references(reader, count):
    skip_compact_indices(reader, count)


def declared_array_end(reader, is_lazy):
    return reader.number('i') if is_lazy else None


def require_declared_array_end(reader, array_end, label):
    if array_end is not None and array_end != reader.position:
        raise FormatError(f'{label} end at {reader.position}, not at their declared end {array_end}')


def skip_wireframe_index_buffer(reader, label):
    reader.take(struct.calcsize(INDEX_FORMAT) * counted(reader, f'{label} wireframe index buffer'))
    reader.number('i')


def skip_collision_triangles(reader, tail_layout, label):
    array_end = declared_array_end(reader, tail_layout.lazy_collision_arrays)
    for _ in range(counted(reader, f'{label} collision triangles')):
        reader.take(COLLISION_TRIANGLE_PLANES_BYTES)
        skip_compact_indices(reader, COLLISION_TRIANGLE_INDEX_COUNT)
    require_declared_array_end(reader, array_end, f'{label} collision triangles')


def skip_collision_nodes(reader, tail_layout, label):
    array_end = declared_array_end(reader, tail_layout.lazy_collision_arrays)
    for _ in range(counted(reader, f'{label} collision nodes')):
        skip_compact_indices(reader, COLLISION_NODE_INDEX_COUNT)
        reader.take(STATIC_MESH_BOUNDING_BOX_BYTES)
    require_declared_array_end(reader, array_end, f'{label} collision nodes')


def skip_level_of_detail_fields(reader, tail_layout):
    reader.number('i')
    skip_object_references(reader, LEVEL_OF_DETAIL_REFERENCE_COUNT)
    reader.take(struct.calcsize(LEVEL_OF_DETAIL_FIELDS_FORMAT) + INTEGER_BYTES * tail_layout.level_of_detail_trailing_integers)


def skip_authored_triangles(reader, uv_stream_count, label):
    array_end = declared_array_end(reader, True)
    for _ in range(counted(reader, f'{label} authored triangles')):
        reader.take(AUTHORED_TRIANGLE_POSITIONS_BYTES)
        uv_channel_count = reader.number('i')
        if uv_channel_count != uv_stream_count:
            raise FormatError(f'{label} authored triangle holds {uv_channel_count} UV channels for {uv_stream_count} UV streams')
        reader.take(AUTHORED_TRIANGLE_UV_CHANNEL_BYTES * uv_channel_count + struct.calcsize(AUTHORED_TRIANGLE_TRAILING_FORMAT))
    require_declared_array_end(reader, array_end, f'{label} authored triangles')


def skip_internal_version_and_mesh_properties(reader):
    reader.number('i')
    skip_object_references(reader, 1)
    reader.number('i')


def skip_static_mesh_tail(reader, tail_layout, uv_stream_count, label):
    skip_wireframe_index_buffer(reader, label)
    skip_object_references(reader, 1)
    skip_collision_triangles(reader, tail_layout, label)
    skip_collision_nodes(reader, tail_layout, label)
    skip_level_of_detail_fields(reader, tail_layout)
    skip_authored_triangles(reader, uv_stream_count, label)
    skip_internal_version_and_mesh_properties(reader)
    if reader.position != reader.end:
        raise FormatError(f'{label} leaves {reader.end - reader.position} bytes after its last field')


def read_static_mesh_vertex_streams(package, export):
    label = f'static mesh {export["object"]}'
    tail_layout = reviewed_tail_layout(package)
    _, reader = package.properties(export)
    reader.take(PRIMITIVE_BOUNDS_BYTES)
    sections = read_sections(reader, label)
    reader.take(STATIC_MESH_BOUNDING_BOX_BYTES)
    vertex_count = counted(reader, f'{label} vertex stream')
    vertices = unpacked_rows(reader, STATIC_MESH_VERTEX_FORMAT, vertex_count)
    reader.number('i')
    primary_colours, primary_revision = read_colour_stream(reader, vertex_count, f'{label} colour stream')
    alternate_colours, alternate_revision = read_colour_stream(reader, vertex_count, f'{label} alternate colour stream')
    uv_streams = read_uv_streams(reader, vertex_count, label)
    indices = tuple(index for (index,) in unpacked_rows(reader, INDEX_FORMAT, counted(reader, f'{label} index buffer')))
    reader.number('i')
    skip_static_mesh_tail(reader, tail_layout, len(uv_streams), label)
    return StaticMeshVertexStreams(sections, tuple(vertex[:3] for vertex in vertices), tuple(vertex[3:6] for vertex in vertices), primary_colours, primary_revision, alternate_colours,
                                   alternate_revision, uv_streams[0], indices)


def static_mesh_export(package, source_object):
    matches = [item for item in package.exports if item['object'].casefold() == source_object.casefold() and item['className'] == 'StaticMesh']
    if len(matches) != 1:
        raise FormatError(f'{package.filename} holds {len(matches)} StaticMesh exports named {source_object}')
    return matches[0]


def gltf_position_of_source(position):
    scale = f32(SOURCE_UNITS_TO_GLTF_METRES)
    return tuple(f32(position[axis] * scale) for axis in GLTF_AXIS_OF_SOURCE_AXIS)


def glb_document_and_binary(glb):
    json_length = struct.unpack_from('<I', glb, GLB_HEADER_BYTES)[0]
    json_start = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES
    return json.loads(glb[json_start:json_start + json_length]), json_start + json_length + GLB_CHUNK_HEADER_BYTES


def glb_float_accessor(glb, document, binary_start, accessor_index, components):
    accessor = document['accessors'][accessor_index]
    if accessor['componentType'] != GLTF_FLOAT_COMPONENT_TYPE:
        raise FormatError(f'glTF accessor {accessor_index} is not float32')
    view = document['bufferViews'][accessor['bufferView']]
    start = binary_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', 4 * components)
    return [struct.unpack_from(f'<{components}f', glb, start + stride * index) for index in range(accessor['count'])]


def section_vertices_in_first_use_order(streams, section):
    end = section.first_index + VERTICES_PER_TRIANGLE * section.triangle_count
    if end > len(streams.indices):
        return None
    vertices = list(dict.fromkeys(streams.indices[section.first_index:end]))
    return vertices if all(vertex < len(streams.positions) for vertex in vertices) else None


def primitive_matches_vertices(glb, document, binary_start, primitive, streams, vertices):
    attributes = primitive['attributes']
    if vertices is None or 'TEXCOORD_0' not in attributes:
        return False
    positions = glb_float_accessor(glb, document, binary_start, attributes['POSITION'], 3)
    uvs = glb_float_accessor(glb, document, binary_start, attributes['TEXCOORD_0'], 2)
    return list(zip(positions, uvs)) == [(gltf_position_of_source(streams.positions[vertex]), streams.first_uvs[vertex]) for vertex in vertices]


def joined_primitive_vertices(glb, streams):
    document, binary_start = glb_document_and_binary(glb)
    primitives = [(mesh_index, primitive_index, primitive) for mesh_index, mesh in enumerate(document['meshes'])
                  for primitive_index, primitive in enumerate(mesh['primitives'])]
    drawn_sections = [section for section in streams.sections if section.triangle_count > 0]
    if len(primitives) != len(drawn_sections):
        return None
    joined = []
    for (mesh_index, primitive_index, primitive), section in zip(primitives, drawn_sections):
        vertices = section_vertices_in_first_use_order(streams, section)
        if not primitive_matches_vertices(glb, document, binary_start, primitive, streams, vertices):
            return None
        joined.append({'mesh': mesh_index, 'primitive': primitive_index, 'nativeVertices': vertices})
    return joined


def vertex_streams_document(source_object, package_record, streams, primitives):
    return {'schemaVersion': VERTEX_STREAMS_SCHEMA_VERSION, 'kind': VERTEX_STREAMS_KIND, 'sourceObject': source_object,
            'package': package_record, 'nativeVertexCount': len(streams.positions),
            'nativePositions': [component for position in streams.positions for component in position],
            'nativeNormals': [component for normal in streams.normals for component in normal],
            'primary': {'bgraHex': streams.primary_colours.hex(), 'revision': streams.primary_revision},
            'alternate': {'bgraHex': streams.alternate_colours.hex(), 'revision': streams.alternate_revision},
            'selector': None, 'selectorGapReason': COLOUR_SELECTOR_UNRESOLVED_REASON, 'primitives': primitives}


def static_mesh_vertex_stream_outcome(package_version, load_package, request, glb):
    if package_version not in REVIEWED_COLOUR_STREAM_LAYOUTS:
        return VertexStreamOutcome(None, colour_stream_layout_unreviewed_reason(*package_version))
    package, package_record = load_package(request['package'])
    try:
        export = static_mesh_export(package, request['object'])
        streams = read_static_mesh_vertex_streams(package, export)
        primitives = joined_primitive_vertices(glb, streams)
    except FormatError as error:
        return VertexStreamOutcome(None, colour_stream_unread_reason(error))
    if primitives is None:
        return VertexStreamOutcome(None, COLOUR_STREAM_JOIN_MISMATCH_REASON)
    return VertexStreamOutcome(json_bytes(vertex_streams_document(export['object'], package_record, streams, primitives)), None)
