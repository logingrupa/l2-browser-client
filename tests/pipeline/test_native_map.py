import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.ue2 import FormatError, Package, Reader
from native_map import (HAS_STACK, actor_properties, ambient_sound_object, bitmap_words, build_map, explicit_properties,
                        decode_property, migrate_map, png16, read_g16, safe_path, selected_by_origin,
                        static_mesh_request, validate_recipe, verify_map)
from native_assets import Converter


def compact(value):
    negative, value = value < 0, abs(value)
    result = bytearray([(value & 63) | (128 if negative else 0)])
    value >>= 6
    if value:
        result[0] |= 64
    while value:
        byte, value = value & 127, value >> 7
        result.append(byte | (128 if value else 0))
    return bytes(result)


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


def recipe():
    return {'schemaVersion': 1, 'kind': 'native-map-raw', 'map': 'maps/example.unr',
            'section': {'selection': 'serialized-origin-xy-inclusive', 'min': [0, 10], 'max': [2, 12]}}


class PointRegionTests(unittest.TestCase):
    # Exercise the actual tagged parser, including compact object references,
    # rather than assuming a fixed-size C struct or mocking nested properties.
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


class MapReaderTests(unittest.TestCase):
    def test_non_actor_ambient_objects_are_exported_without_inventing_actor_state(self):
        package = DummyPackage(b'\0\xaa\xbb\x01')
        package.source_hash, package.package_name = 'a' * 64, 'example'
        package.names, package.imports = [], []
        entry = {'offset': 0, 'size': 3, 'flags': 0x70001, 'object': 'example.AmbientSoundObject0',
                 'className': 'AmbientSoundObject', 'classObject': 'Engine.AmbientSoundObject', 'exportIndex': 1}
        package.exports = [entry, {**entry, 'offset': 3, 'size': 1, 'exportIndex': 2,
                                  'object': 'example.AmbientSoundObject1'}]
        files = {}
        with patch('native_map.MapSources', return_value=SimpleNamespace(get=lambda name: package, dependencies={})):
            manifest, _ = build_map(Path('unused'), recipe(), lambda name, data: files.__setitem__(name, data))
        sounds = json.loads(files['ambient-sounds.json'])['objects']
        self.assertEqual(len(sounds), 1)
        self.assertEqual(json.loads(files['actors.json']), [])
        self.assertEqual(len(json.loads(files['exports.json'])['exports']), 2)
        self.assertEqual(manifest['coverage']['ambientSoundObjectsDecoded'], 1)
        self.assertEqual(manifest['coverage']['ambientSoundObjectsWithTail'], 1)
        self.assertEqual(manifest['unsupported'][0]['stage'], 'ambient-object-tags')
        self.assertEqual(manifest['support'], 'partial-raw-data-extracted')
        sound = sounds[0]
        self.assertEqual(sound['nativeTail']['sha256'], hashlib.sha256(b'\xaa\xbb').hexdigest())
        self.assertEqual(sound['properties'], [])
        self.assertTrue(sound['authoredPropertiesOnly'])
        self.assertNotIn('sourceTransform', sound)
        self.assertNotIn('sectionOriginSelected', sound)
        self.assertEqual(sound['classDefaults'], 'not-resolved-by-raw-map-export')
        for invalid in ({**entry, 'flags': HAS_STACK}, {**entry, 'classObject': 'Other.AmbientSoundObject'}):
            with self.assertRaisesRegex(FormatError, 'ambient LevelObject'):
                ambient_sound_object(package, invalid, 'raw.bin')

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
        package.summary = {'version': 123, 'licenseeVersion': 30}
        with self.assertRaises(FormatError):
            actor_properties(package, {'offset': 0, 'size': 1, 'flags': 0})

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

    def test_section_boundary_and_omitted_defaults_are_explicit(self):
        section = recipe()['section']
        prop = {'name': 'Location', 'arrayIndex': None, 'value': {'X': 0, 'Y': 12, 'Z': -9000}}
        self.assertTrue(selected_by_origin([prop], section))
        prop['value']['X'] = -0.001
        self.assertFalse(selected_by_origin([prop], section))
        self.assertIsNone(selected_by_origin([], section))
        self.assertEqual(explicit_properties([], ['DrawScale'])['DrawScale'], {'status': 'omitted-class-default-unresolved'})
        bad = recipe()
        bad['section']['max'] = [float('nan'), 2]
        with self.assertRaises(ValueError):
            validate_recipe(bad)


class MapCacheTests(unittest.TestCase):
    def build(self, client, request, write):
        payload = (client / 'maps/example.unr').read_bytes()
        manifest = {'recipe': request, 'support': 'fixture', 'coverage': {}, 'gaps': [], 'unsupported': []}
        write('manifest.json', json.dumps(manifest).encode())
        write('raw/map.bin', payload)
        return manifest, {'maps/example.unr': {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}}

    def test_reproducible_build_cache_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client, first, second = root / 'inputs', root / 'first', root / 'second'
            (client / 'maps').mkdir(parents=True)
            source = client / 'maps/example.unr'
            source.write_bytes(b'native unchanged source')
            with patch('native_map.build_map', side_effect=self.build) as build:
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])
                before = (first / 'manifest.json').stat().st_mtime_ns
                self.assertTrue(migrate_map(client, recipe(), first)['cacheHit'])
                self.assertEqual(build.call_count, 1)
                self.assertEqual((first / 'manifest.json').stat().st_mtime_ns, before)
                migrate_map(client, recipe(), second)
                self.assertEqual((first / 'receipt.json').read_bytes(), (second / 'receipt.json').read_bytes())
                (first / 'raw/map.bin').write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError, 'hash/length'):
                    verify_map(client, first)
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])
                self.assertEqual((first / 'raw/map.bin').read_bytes(), source.read_bytes())
                source.write_bytes(b'updated source')
                with self.assertRaisesRegex(ValueError, 'hash/length'):
                    verify_map(client, first)
                self.assertFalse(migrate_map(client, recipe(), first)['cacheHit'])

    def test_rejects_source_overwrite_unowned_files_and_unsafe_receipt_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            client = root / 'inputs'
            (client / 'maps').mkdir(parents=True)
            (client / 'maps/example.unr').write_bytes(b'source')
            with self.assertRaises(ValueError):
                migrate_map(client, recipe(), client / 'output')
            for path in ('../outside', '/outside', 'C:/outside', 'a\\b', 'a. /file'):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    safe_path(root, path)
            output = root / 'out'
            with patch('native_map.build_map', side_effect=self.build):
                migrate_map(client, recipe(), output)
                (output / 'authored-edit.json').write_text('{}')
                with self.assertRaisesRegex(ValueError, 'unowned files'):
                    migrate_map(client, recipe(), output)
                self.assertEqual((output / 'authored-edit.json').read_text(), '{}')


STAGED = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
ORACLE = ROOT / 'artifacts/native-parity/research/map-java-oracle/result/20_20'


@unittest.skipUnless((STAGED / 'maps/20_20.unr').is_file(), 'local native sources are intentionally not tracked')
class LocalMapSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name) / 'map'
        cls.result = migrate_map(STAGED, json.loads((ROOT / 'recipes/native-map-20_20.json').read_text()), cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_native_coverage_and_exact_terrain_samples(self):
        coverage = self.result['coverage']
        self.assertEqual(coverage['actorsDecoded'], coverage['stackActors'])
        self.assertEqual(coverage['staticMeshActorsDecoded'], 4183)
        self.assertEqual(coverage['terrainHeightsDecoded'], 1)
        self.assertEqual(coverage['exportsPreservedRaw'], 13248)
        self.assertEqual(self.result['unsupported'], [])
        terrain = json.loads((self.output / 'terrain.json').read_text())[0]
        self.assertEqual(len(terrain['layers']), 11)
        self.assertEqual(len(terrain['decoLayers']), 4)
        self.assertEqual([item['wordCount'] for item in terrain['bitmaps']], [2048] * 4)
        mip = terrain['height']['mips'][0]
        self.assertEqual(mip['sha256'], '85fff0a8c5b9fa717270180110f9a4a8711bf0818c0b153839d380c14c2abab9')
        self.assertEqual(mip['sourceBytes'], 256 * 256 * 2)
        if (ORACLE / '20_20_heightmap.raw').is_file():
            self.assertEqual((self.output / mip['rawPath']).read_bytes(), (ORACLE / '20_20_heightmap.raw').read_bytes())

    def test_all_native_ambient_levelobjects_keep_exact_payloads_and_sound_references(self):
        data = json.loads((self.output / 'ambient-sounds.json').read_text())
        raw = (self.output / 'raw/map.unwrapped.bin').read_bytes()
        self.assertEqual(data['sourcePackageSha256'], '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4')
        self.assertEqual(len(data['objects']), 2622)
        self.assertEqual(self.result['coverage']['ambientSoundObjectsDecoded'], 2622)
        self.assertEqual(self.result['coverage']['ambientSoundObjectsWithTail'], 0)
        references, missing = set(), 0
        for obj in data['objects']:
            self.assertEqual(obj['classObject'], 'Engine.AmbientSoundObject')
            self.assertFalse(obj['objectFlags'] & HAS_STACK)
            payload = obj['nativePayload']
            self.assertEqual(hashlib.sha256(raw[payload['offset']:payload['offset'] + payload['bytes']]).hexdigest(), payload['sha256'])
            sound = next((prop for prop in obj['properties'] if prop['name'] == 'AmbientSound'), None)
            if sound is None:
                missing += 1
            else:
                references.add(sound['value']['object'])
            self.assertNotIn('Random', obj)  # Missing defaults are not synthesized.
            self.assertEqual(obj['nativePlayback'], 'unverified')
        self.assertEqual(missing, 2)
        self.assertEqual(len(references), 106)

    @unittest.skipUnless((ORACLE / 'staticmeshes.json').is_file(), 'independent pinned Java oracle output is local')
    def test_all_static_placements_match_independent_java_extraction(self):
        actors = json.loads((self.output / 'actors.json').read_text())
        index = {a['object'].rsplit('.', 1)[-1]: a for a in actors if a['class'] == 'StaticMeshActor'}
        java = json.loads((ORACLE / 'staticmeshes.json').read_text())
        self.assertEqual(len(index), java['count'])
        for row in java['staticMeshes']:
            actor = index[row['name']]
            self.assertEqual(actor['staticMesh']['object'], row['meshPath'])
            for axis in 'xyz':
                # Java's serializer rounds positions to four decimals; preserve source f32 here.
                self.assertAlmostEqual(actor['sourceTransform']['Location']['value'][axis.upper()], row['location'][axis], delta=0.000051)


if __name__ == '__main__':
    unittest.main()
