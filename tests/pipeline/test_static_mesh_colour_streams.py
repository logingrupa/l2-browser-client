import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import Package
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from world.gltf_builder import GltfBuilder
from world.static_mesh_colour_streams import (COLOUR_SELECTOR_UNRESOLVED_REASON, COLOUR_STREAM_JOIN_MISMATCH_REASON,
                                              read_static_mesh_colour_streams, static_mesh_colour_stream_outcome, static_mesh_export)
from ue2_package_fixture import compact, package_bytes

REFERENCE_CLIENT = Path('E:/Lineage2-client')
DB7_EXPECTATIONS_PATH = ROOT / 'tests/fixtures/environment/hourly-lighting-db7-converter-expectations.json'
REVIEWED_LAYOUT = (123, 12)
PACKAGE_RECORD = {'path': 'staticmeshes/Synthetic_S.usx', 'sha256': '0' * 64}
SYNTHETIC_POSITIONS = ((100.0, 200.0, 300.0), (-100.0, 200.0, 300.0), (100.0, -200.0, 300.0))
GLTF_POSITIONS = ((1.0, 3.0, 2.0), (-1.0, 3.0, 2.0), (1.0, 3.0, -2.0))
SYNTHETIC_UVS = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0))
PRIMARY_COLOURS = bytes((10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 128))
ALTERNATE_COLOURS = bytes((255,) * 12)
SECTIONS = ((0, 1), (3, 0), (3, 2))
INDICES = (2, 0, 2, 0, 1, 2, 1, 0, 1)


def section_bytes(first_index, triangle_count):
    return struct.pack('<IHHHHH', 0, first_index, 0, 2, triangle_count, triangle_count)


def static_mesh_body(positions, uvs, primary=PRIMARY_COLOURS, alternate=ALTERNATE_COLOURS):
    def body(offset, names):
        vertex_count = len(positions)
        vertices = b''.join(struct.pack('<6f', *position, 0.0, 0.0, 1.0) for position in positions)
        return (compact(names['None']) + bytes(25 + 16) + compact(len(SECTIONS)) + b''.join(section_bytes(*section) for section in SECTIONS)
                + bytes(25) + compact(vertex_count) + vertices + struct.pack('<i', 1) + compact(vertex_count) + primary + struct.pack('<i', 3)
                + compact(vertex_count) + alternate + struct.pack('<i', 4) + compact(1) + compact(vertex_count)
                + b''.join(struct.pack('<2f', *uv) for uv in uvs) + struct.pack('<2i', 0, 5) + compact(len(INDICES))
                + struct.pack(f'<{len(INDICES)}H', *INDICES) + struct.pack('<i', 6))
    return body


def synthetic_static_mesh_package(positions=SYNTHETIC_POSITIONS, uvs=SYNTHETIC_UVS):
    exports = [{'name': 'Rock', 'class': -2, 'body': static_mesh_body(positions, uvs)}]
    return Package(package_bytes([], [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'StaticMesh')], exports), 'Synthetic_S.usx')


def synthetic_glb(primitive_vertices):
    builder = GltfBuilder('test_static_mesh_colour_streams.py')
    meshes = []
    for vertices in primitive_vertices:
        positions = [list(GLTF_POSITIONS[vertex]) for vertex in vertices]
        uvs = [list(SYNTHETIC_UVS[vertex]) for vertex in vertices]
        attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'), 'TEXCOORD_0': builder.accessor(uvs, len(uvs), 'VEC2')}
        meshes.append({'primitives': [{'attributes': attributes}]})
    builder.data.update(meshes=meshes)
    return builder.glb()


def loader_of(package):
    return lambda relative: (package, {**PACKAGE_RECORD, 'path': relative})


def request_of(package):
    return {'package': PACKAGE_RECORD['path'], 'object': package.exports[0]['object']}


class StaticMeshColourStreamTests(unittest.TestCase):
    def test_both_colour_streams_keep_their_bgra_bytes_and_revisions_in_vertex_order(self):
        package = synthetic_static_mesh_package()
        streams = read_static_mesh_colour_streams(package, static_mesh_export(package, 'synthetic_s.rock'))
        self.assertEqual((streams.positions, streams.first_uvs), (SYNTHETIC_POSITIONS, SYNTHETIC_UVS))
        self.assertEqual((streams.sections, streams.indices), (SECTIONS, INDICES))
        self.assertEqual((streams.primary_colours, streams.primary_revision), (PRIMARY_COLOURS, 3))
        self.assertEqual((streams.alternate_colours, streams.alternate_revision), (ALTERNATE_COLOURS, 4))

    def test_each_drawn_section_joins_its_primitive_in_first_use_order_and_the_selector_stays_a_named_gap(self):
        package = synthetic_static_mesh_package()
        outcome = static_mesh_colour_stream_outcome(REVIEWED_LAYOUT, loader_of(package), request_of(package), synthetic_glb([(2, 0), (0, 1, 2)]))
        self.assertIsNone(outcome.gap_reason)
        document = json.loads(outcome.payload)
        self.assertEqual([primitive['nativeVertices'] for primitive in document['primitives']], [[2, 0], [0, 1, 2]])
        self.assertEqual((document['primary']['bgraHex'], document['alternate']['revision']), (PRIMARY_COLOURS.hex(), 4))
        self.assertEqual((document['selector'], document['selectorGapReason']), (None, COLOUR_SELECTOR_UNRESOLVED_REASON))
        self.assertEqual(document['package'], PACKAGE_RECORD)

    def test_a_primitive_whose_vertices_differ_from_its_section_order_or_count_makes_the_join_a_named_gap(self):
        package = synthetic_static_mesh_package()
        for primitive_vertices in ([(0, 2), (0, 1, 2)], [(2, 0)], [(2, 0), (0, 1)]):
            with self.subTest(primitive_vertices=primitive_vertices):
                outcome = static_mesh_colour_stream_outcome(REVIEWED_LAYOUT, loader_of(package), request_of(package), synthetic_glb(primitive_vertices))
                self.assertEqual(outcome, (None, COLOUR_STREAM_JOIN_MISMATCH_REASON))

    def test_an_unreadable_colour_stream_is_a_listed_gap_naming_the_first_line_of_the_error(self):
        package = synthetic_static_mesh_package()
        missing = {'package': PACKAGE_RECORD['path'], 'object': 'Synthetic_S.Missing'}
        outcome = static_mesh_colour_stream_outcome(REVIEWED_LAYOUT, loader_of(package), missing, synthetic_glb([(2, 0), (0, 1, 2)]))
        self.assertEqual(outcome, (None, 'static-mesh-colour-stream-unread:Synthetic_S.usx holds 0 StaticMesh exports named Synthetic_S.Missing'))
        self.assertTrue(is_listed_reason(outcome.gap_reason, load_gap_reason_patterns()))

    def test_a_model_whose_gltf_accessor_is_not_float32_is_a_gap_instead_of_an_error(self):
        package = synthetic_static_mesh_package()
        glb = bytearray(synthetic_glb([(2, 0), (0, 1, 2)]))
        float_component = b'"componentType":5126'
        self.assertIn(float_component, glb)
        glb[glb.index(float_component):glb.index(float_component) + len(float_component)] = b'"componentType":5123'
        outcome = static_mesh_colour_stream_outcome(REVIEWED_LAYOUT, loader_of(package), request_of(package), bytes(glb))
        self.assertEqual(outcome, (None, 'static-mesh-colour-stream-unread:glTF accessor 0 is not float32'))

    def test_an_unreviewed_layout_is_a_named_gap_without_reading_the_package(self):
        def refuse(relative):
            raise AssertionError(f'read {relative}')
        outcome = static_mesh_colour_stream_outcome((123, 28), refuse, {'package': PACKAGE_RECORD['path'], 'object': 'Synthetic_S.Rock'}, b'')
        self.assertEqual(outcome, (None, 'static-mesh-colour-stream-layout-unreviewed:123/28'))


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class ReferenceClientColourStreamTests(unittest.TestCase):
    def test_cruma_s_g_12_matches_the_db7_streams(self):
        expected = json.loads(DB7_EXPECTATIONS_PATH.read_text(encoding='utf-8'))['staticMesh']['mesh']
        path = REFERENCE_CLIENT / expected['package']
        data = path.read_bytes()
        package = Package(data, path.name)
        export = static_mesh_export(package, expected['object'])
        self.assertEqual(export['exportIndex'], expected['exportIndex'])
        streams = read_static_mesh_colour_streams(package, export)
        self.assertEqual(len(streams.positions), expected['vertexCount'])
        self.assertEqual(list(streams.positions[0]), expected['vertex0Position'])
        self.assertEqual(list(streams.primary_colours[:4]), expected['primaryVertex0Bgra'])
        self.assertEqual(list(streams.alternate_colours[:4]), expected['alternateVertex0Bgra'])
        self.assertEqual(len(streams.primary_colours) // 4, expected['primaryCount'])
        self.assertEqual(len(streams.alternate_colours) // 4, expected['alternateCount'])
        for stream, offset in (('primary', expected['primaryRawByteOffset']), ('alternate', expected['alternateRawByteOffset'])):
            self.assertEqual(data[offset:offset + 4].hex(), expected[f'{stream}RawBytesHex'])
        self.assertEqual(sum(section.triangle_count for section in streams.sections) * 3, len(streams.indices))


if __name__ == '__main__':
    unittest.main()
