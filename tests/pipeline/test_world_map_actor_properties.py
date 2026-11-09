import hashlib
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import Converter
from native_catalog.ue2 import FormatError, Package, Reader
from ue2_package_fixture import compact
from world.map_actor_properties import HAS_STACK, actor_properties, bitmap_words, decode_property, explicit_properties
from world.map_sources import static_mesh_request
from world.terrain_height_texture import png16, read_g16


class DummyPackage:
    summary = {'version': 123, 'licenseeVersion': 28}

    def __init__(self, data):
        self.data = data

    def object_name(self, index):
        return 'fixture.object' if index else None

    def properties(self, item):
        reader = Reader(self.data, item['offset'], item['offset'] + item['size'])
        if reader.number('B'):
            raise FormatError('Fixture missing property terminator')
        return [], reader


class TaggedParserPointRegionTests(unittest.TestCase):
    names = ['None', 'Region', 'PointRegion', 'Zone', 'iLeaf', 'ZoneNumber', 'Unknown']

    def tag(self, name, kind, payload, struct_name=None):
        return (compact(self.names.index(name)) + bytes([kind | 0x50]) +
                (compact(self.names.index(struct_name)) if struct_name else b'') +
                bytes([len(payload)]) + payload)

    def decode(self, payload):
        package = Package.__new__(Package)
        package.names, package.package_name = self.names, 'fixture'
        package.exports = [{'name': 'Zone' + str(i), 'outerIndex': 0} for i in range(128)]
        package.imports = [{'name': 'ImportedZone', 'outerIndex': 0}]
        prefix = b'outside-struct'
        package.data = prefix + self.tag('Region', 10, payload, 'PointRegion') + b'\0'
        props, tail = package.properties({'offset': len(prefix), 'size': len(package.data) - len(prefix)})
        self.assertEqual(tail.position, tail.end)
        return decode_property(package, props[0], 'raw/map.unwrapped.bin'), package.data

    def test_variable_reference_sizes_and_exact_child_source_ranges(self):
        for ref in (2, 64, 128, -1):
            with self.subTest(ref=ref):
                payload = (self.tag('Zone', 5, compact(ref)) +
                           self.tag('iLeaf', 2, struct.pack('<i', -1)) +
                           self.tag('ZoneNumber', 1, b'\0') + b'\0')
                region, raw = self.decode(payload)
                self.assertEqual(region['status'], 'decoded-tags')
                fields = {f['name']: f for f in region['value']}
                self.assertEqual(fields['Zone']['value'], {'index': ref, 'object':
                    'ImportedZone' if ref == -1 else 'fixture.Zone' + str(ref - 1)})
                self.assertEqual(fields['iLeaf']['value'], -1)
                self.assertEqual(fields['ZoneNumber']['value'], 0)
                self.assertEqual(fields['Zone']['payload']['bytes'], len(compact(ref)))
                for item in [region, *fields.values()]:
                    span = item['payload']
                    chunk = raw[span['offset']:span['offset'] + span['bytes']]
                    self.assertEqual(hashlib.sha256(chunk).hexdigest(), span['sha256'])
                    self.assertEqual(span['path'], 'raw/map.unwrapped.bin')

    def test_omitted_and_explicit_null_are_distinct(self):
        omitted, _ = self.decode(b'\0')
        null, _ = self.decode(self.tag('Zone', 5, compact(0)) + b'\0')
        self.assertEqual(omitted['value'], [])
        self.assertEqual([f['name'] for f in null['value']], ['Zone'])
        self.assertEqual(null['value'][0]['value'], {'index': 0, 'object': None})

    def test_unknown_fields_remain_opaque_and_duplicate_tags_are_not_collapsed(self):
        unknown = self.tag('Unknown', 9, b'\xff\x10')
        region, _ = self.decode(unknown + unknown + b'\0')
        self.assertEqual(len(region['value']), 2)
        for field in region['value']:
            self.assertEqual(field['status'], 'raw-preserved')
            self.assertNotIn('value', field)
            self.assertEqual(field['payload']['sha256'], hashlib.sha256(b'\xff\x10').hexdigest())

    def test_malformed_unterminated_trailing_and_invalid_reference_rejected(self):
        valid = self.tag('Zone', 5, compact(2))
        for raw in (valid, b'\0\x01', valid[:-1], self.tag('Zone', 5, compact(129)) + b'\0',
                    self.tag('iLeaf', 2, b'\x01') + b'\0'):
            with self.subTest(payload=raw.hex()), self.assertRaises(FormatError):
                self.decode(raw)

    def test_nested_region_keeps_existing_depth_limit(self):
        payload = b'\0'
        for _ in range(9):
            payload = self.tag('Region', 10, payload, 'PointRegion') + b'\0'
        with self.assertRaisesRegex(FormatError, 'nesting exceeds eight'):
            self.decode(payload)


class MapActorPropertyReaderTests(unittest.TestCase):
    def test_generated_static_request_uses_real_converter_material_contract(self):
        item = {'object': 'Example.Group.Mesh', 'className': 'StaticMesh'}
        request = static_mesh_request('staticmeshes/Example.usx', item)
        observed = []
        document = SimpleNamespace(original_buffers=[], repairs=[])
        converter = SimpleNamespace(run=lambda *args: '', exported=lambda *args: Path('unused.gltf'),
            materials=lambda work, package, doc, dump, overrides, evidence, **kwargs: (observed.append(overrides) or [], []))
        with patch('native_assets.Document', return_value=document), \
                patch('native_assets.native_static_materials', return_value={'slots': []}), \
                patch('native_assets.static_section_bindings', return_value=[]):
            result = Converter.model_part(converter, Path('work'), request,
                SimpleNamespace(source_hash='a' * 64), item, Path('Example.usx'))
        self.assertEqual(observed, [{}])
        self.assertIs(result[0], document)
        self.assertEqual(request, {'kind': 'model', 'package': 'staticmeshes/Example.usx', 'object': 'Example.Group.Mesh'})

    def test_state_frame_node_and_null_node_layouts_and_truncation(self):
        for node in (0, 1):
            prefix = compact(node) + compact(-3) + struct.pack('<QI', 2**64 - 1, 123)
            if node:
                prefix += compact(4)
            package = DummyPackage(prefix + b'\0')
            item = {'offset': 0, 'size': len(package.data), 'flags': HAS_STACK}
            props, tail, state, end = actor_properties(package, item)
            self.assertEqual(end, len(prefix))
            self.assertEqual(tail.position, len(package.data))
            self.assertEqual(state['probeMaskHex'], 'ffffffffffffffff')
            self.assertEqual(state['offset'], 4 if node else None)
            with self.assertRaises(FormatError):
                actor_properties(package, {**item, 'size': len(prefix) - 1})
        package = DummyPackage(b'\0')
        self.assertIsNone(actor_properties(package, {'offset': 0, 'size': 1, 'flags': 0})[2])
        package.summary = {'version': 123, 'licenseeVersion': 27}
        with self.assertRaisesRegex(FormatError, '^map-licensee-unsupported:123/27$'):
            actor_properties(package, {'offset': 0, 'size': 1, 'flags': 0})

    def test_an_omitted_property_stays_an_unresolved_class_default(self):
        self.assertEqual(explicit_properties([], ['DrawScale'])['DrawScale'], {'status': 'omitted-class-default-unresolved'})

    def test_bitmap_count_exact_words_and_bounds(self):
        decoded = bitmap_words(compact(2) + struct.pack('<II', 0x80000001, 0xffffffff))
        self.assertEqual(decoded['words'], [0x80000001, 0xffffffff])
        self.assertEqual(decoded['setBitCount'], 34)
        for raw in (compact(-1), compact(2) + struct.pack('<I', 0), compact(0) + b'\0'):
            with self.assertRaises(FormatError):
                bitmap_words(raw)

    def texture(self, width=2, height=2):
        samples = struct.pack('<4H', 0, 1, 32768, 65535)
        start = 4 + 1 + 4 + 1
        raw = struct.pack('<i', 0) + compact(1) + struct.pack('<i', start + len(samples)) + compact(len(samples)) + samples
        raw += struct.pack('<iiBB', width, height, 1, 1)
        package = DummyPackage(raw)
        package.properties = lambda item: ([{'name': name, 'arrayIndex': None, 'value': value}
                                           for name, value in (('Format', 10), ('USize', width), ('VSize', height))], Reader(raw))
        return package, samples

    def test_g16_preserves_extreme_samples_and_rejects_wrong_skip_or_dimensions(self):
        package, samples = self.texture()
        mip = read_g16(package, {})['mips'][0]
        self.assertEqual(mip['raw'], samples)
        self.assertEqual(mip['sha256'], hashlib.sha256(samples).hexdigest())
        package, _ = self.texture(3, 2)
        with self.assertRaisesRegex(FormatError, 'dimensions/bytes'):
            read_g16(package, {})
        package, _ = self.texture()
        bad = bytearray(package.data)
        bad[5] ^= 1
        properties = package.properties({})[0]
        package.properties = lambda item: (properties, Reader(bytes(bad)))
        with self.assertRaisesRegex(FormatError, 'skip position'):
            read_g16(package, {})

    def test_16_bit_png_round_trip_does_not_normalize_or_flip_rows(self):
        samples = struct.pack('<4H', 0, 1, 32768, 65535)
        png = png16(samples, 2, 2)
        position, image = 8, b''
        while position < len(png):
            size = struct.unpack_from('>I', png, position)[0]
            kind, payload = png[position + 4:position + 8], png[position + 8:position + 8 + size]
            self.assertEqual(zlib.crc32(kind + payload), struct.unpack_from('>I', png, position + 8 + size)[0])
            if kind == b'IHDR':
                self.assertEqual(struct.unpack('>IIBBBBB', payload), (2, 2, 16, 0, 0, 0, 0))
            if kind == b'IDAT':
                image += payload
            position += size + 12
        decoded = zlib.decompress(image)
        self.assertEqual(decoded, b'\0' + struct.pack('>2H', 0, 1) + b'\0' + struct.pack('>2H', 32768, 65535))


if __name__ == '__main__':
    unittest.main()
