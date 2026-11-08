import argparse
from contextlib import ExitStack
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
import native_assets
from native_catalog.ue2 import Package
from reference_client_lock_fixture import lock_client_as_reference_root

spec = importlib.util.spec_from_file_location('export_native_map_audio', ROOT/'scripts/export-native-map-audio.py')
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


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


def package_bytes(names, imports, exports):
    names = list(dict.fromkeys(['None', *names, *(name for row in imports for name in (row[0], row[1], row[3])), *(row['name'] for row in exports)]))
    index = {name: i for i, name in enumerate(names)}
    name_bytes = b''.join(compact(len(name)+1) + name.encode('ascii') + b'\0' + struct.pack('<I', 0) for name in names)
    import_bytes = b''.join(compact(index[cp]) + compact(index[cn]) + struct.pack('<i', outer) + compact(index[name]) for cp, cn, outer, name in imports)
    table, payloads = b'', b''
    for row in exports:
        offset = 4096 + len(payloads)
        payload = row['body'](offset, index)
        table += compact(row['class']) + compact(0) + struct.pack('<i', row.get('outer', 0)) + compact(index[row['name']])
        table += struct.pack('<I', row.get('flags', 0)) + compact(len(payload)) + (compact(offset) if payload else b'')
        payloads += payload
    assert len(name_bytes) < 960 and len(import_bytes) < 1024 and len(table) < 2048
    data = bytearray(4096)
    struct.pack_into('<IHHIIIIIII', data, 0, 0x9e2a83c1, 123, 28, 0, len(names), 64, len(exports), 2048, len(imports), 1024)
    data[64:64+len(name_bytes)] = name_bytes
    data[1024:1024+len(import_bytes)] = import_bytes
    data[2048:2048+len(table)] = table
    return bytes(data) + payloads


def tag(names, name, kind, raw, struct_name=None):
    fixed = {1: 0, 2: 1, 4: 2, 12: 3, 16: 4}
    size_code = fixed.get(len(raw), 5)
    return compact(names[name]) + bytes([kind | (size_code << 4)]) + (compact(names[struct_name]) if struct_name else b'') + (bytes([len(raw)]) if size_code == 5 else b'') + raw


def wav_bytes(with_smpl=True):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(struct.pack('<4h', -32768, -100, 100, 32767))
    data = stream.getvalue()
    if with_smpl:
        preserved_ancillary_smpl_chunk = b'smpl' + struct.pack('<I', 36) + bytes(range(36))
        data += preserved_ancillary_smpl_chunk
        data = data[:4] + struct.pack('<I', len(data)-8) + data[8:]
    return data


def sound_package(payload=None, duplicate=False, wrong_class=False, bad_boundary=False):
    payload = wav_bytes() if payload is None else payload
    def body(offset, names):
        props = tag(names, 'UnknownSoundProperty', 11, b'\xaa\xbb\xcc') + compact(names['None'])
        prefix = props + compact(names['WAV'])
        size = len(prefix) + 4 + len(compact(len(payload))) + len(payload)
        return prefix + struct.pack('<i', offset + size + int(bad_boundary)) + compact(len(payload)) + payload
    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Sound'),
               ('Core', 'Package', 0, 'Core'), ('Core', 'Class', -3, 'Package'), ('Core', 'Class', -1, 'Texture')]
    sound = {'name': 'wind_loop', 'class': -5 if wrong_class else -2, 'outer': 1, 'body': body}
    return package_bytes(['WAV', 'UnknownSoundProperty'], imports,
                         [{'name': 'Default', 'class': -4, 'body': lambda offset, names: b''}, sound, *([sound] if duplicate else [])])


def map_package(grouped=True, invalid_property=False, null_reference=False):
    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'AmbientSoundObject'),
               ('Core', 'Package', 0, 'AMBSOUND'), ('Core', 'Package', -3, 'DEFAULT'),
               ('Engine', 'Sound', -4 if grouped else -3, 'WIND_LOOP'),
               ('Core', 'Package', 0, 'Other'), ('Core', 'Class', -6, 'AmbientSoundObject')]
    def body(offset, names):
        sound = tag(names, 'AmbientSound', 11 if invalid_property else 5, compact(0 if null_reference else -5))
        location = tag(names, 'Location', 10, struct.pack('<3f', 1000000, -2000000, -200), 'Vector')
        unknown = tag(names, 'UnknownMapProperty', 11, b'\x11\x22\x33')
        return sound + location + unknown + compact(names['None']) + b'\xab\xcd'
    export_of_another_class_with_a_matching_leaf_class_name = {'name': 'Unrelated0', 'class': -7, 'body': body}
    return package_bytes(['AmbientSound', 'Location', 'Vector', 'UnknownMapProperty'], imports, [
        {'name': 'AmbientSoundObject0', 'class': -2, 'body': body},
        {'name': 'AmbientSoundObject1', 'class': -2, 'body': body},
        {'name': 'AmbientSoundObject4093', 'class': -2, 'body': lambda offset, names: compact(names['None'])},
        export_of_another_class_with_a_matching_leaf_class_name,
    ])


class NativeMapAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(audio, 'ROOT', self.root))
        self.tool = self.root/'tool.exe'
        self.tool.write_bytes(b'pinned but never executed for native Sound conversion')
        self.stack.enter_context(patch.object(native_assets, 'UMODEL_SHA256', audio.digest(self.tool.read_bytes())))
        self.native_process = self.stack.enter_context(patch('native_assets.subprocess.run', side_effect=AssertionError('No native process allowed')))

    def fixture(self, **options):
        snapshot = self.root/'artifacts/inputs/IMPORTA-PC'
        (snapshot/'maps').mkdir(parents=True)
        (snapshot/'sounds').mkdir()
        lock_client_as_reference_root(self, snapshot)
        (snapshot/'maps/20_20.unr').write_bytes(map_package(**{key: options[key] for key in ('grouped', 'invalid_property', 'null_reference') if key in options}))
        (snapshot/'sounds/AmbSound.uax').write_bytes(sound_package(**{key: options[key] for key in ('payload', 'duplicate', 'wrong_class', 'bad_boundary') if key in options}))
        (self.root/'recipes').mkdir()
        pins = [{'relativePath': path.relative_to(snapshot).as_posix(), 'bytes': path.stat().st_size, 'sha256': audio.digest(path.read_bytes())}
                for path in sorted(snapshot.rglob('*')) if path.is_file()]
        lock = self.root/'recipes/lock.json'
        lock.write_bytes(audio.canonical({'schemaVersion': 1, 'sourceHost': 'IMPORTA-PC', 'sourceRoot': 'C:/Lineage2-client', 'files': pins}))
        map_pin = next(row for row in pins if row['relativePath'].endswith('.unr'))
        recipe = self.root/'recipes/recipe.json'
        recipe.write_bytes(audio.canonical({'schemaVersion': 1, 'kind': 'native-map-ambient-audio',
            'source': {'host': 'IMPORTA-PC', 'root': 'C:/Lineage2-client'},
            'map': {'file': map_pin['relativePath'], 'sha256': map_pin['sha256'], 'bytes': map_pin['bytes']},
            'selection': 'all-exact-Engine.AmbientSoundObject-exports-no-spatial-filter', 'referenceProperty': 'AmbientSound',
            'expectedInventory': {'declarations': 3, 'authoredReferences': 2, 'distinctReferences': 1, 'omittedReferences': 1}}))
        return argparse.Namespace(client_snapshot=snapshot, input_lock=lock, recipe=recipe,
                                  umodel=self.tool, output=self.root/'artifacts/export-first', verify_only=False)

    def read(self, args, name):
        return audio.load_json((args.output/name).read_bytes())

    def all_bytes(self, root):
        return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*') if path.is_file()}

    def test_real_package_converter_clean_build_and_cache_repeat_are_byte_identical(self):
        args = self.fixture()
        original = self.all_bytes(args.client_snapshot)
        first = audio.run(args)
        self.assertTrue(first['success'])
        self.assertEqual(first['cacheHits'], 0)
        products = self.all_bytes(args.output)
        mtimes = {name: (args.output/name).stat().st_mtime_ns for name in products}
        second = audio.run(args)
        self.assertEqual(second['cacheHits'], 1)
        self.assertEqual(first['coverageSha256'], second['coverageSha256'])
        self.assertEqual(products, self.all_bytes(args.output))
        self.assertEqual(mtimes, {name: (args.output/name).stat().st_mtime_ns for name in products})
        args.output = self.root/'artifacts/export-second'
        third = audio.run(args)
        self.assertEqual(first['coverageSha256'], third['coverageSha256'])
        self.assertEqual(products, self.all_bytes(args.output))
        self.assertEqual(original, self.all_bytes(args.client_snapshot))
        self.native_process.assert_not_called()

    def test_verify_only_reads_without_converter_or_writes(self):
        args = self.fixture()
        audio.run(args)
        original = self.all_bytes(args.output)
        mtimes = {name: (args.output/name).stat().st_mtime_ns for name in original}
        args.verify_only = True
        with patch.object(audio, 'Converter', side_effect=AssertionError('verify-only must not convert')):
            result = audio.run(args)
        self.assertTrue(result['success'])
        self.assertEqual(original, self.all_bytes(args.output))
        self.assertEqual(mtimes, {name: (args.output/name).stat().st_mtime_ns for name in original})

    def test_all_locations_unknown_properties_tails_raw_sound_and_smpl_survive(self):
        args = self.fixture()
        audio.run(args)
        inventory = self.read(args, 'inventory.json')
        self.assertEqual(inventory['counts'], {'declarations': 3, 'authoredReferences': 2, 'distinctReferences': 1, 'omittedReferences': 1})
        placed = inventory['objects'][0]
        props = placed['declaration']['properties']
        self.assertEqual(next(row['value'] for row in props if row['name'] == 'Location')['X'], 1000000)
        unknown = next(row for row in props if row['name'] == 'UnknownMapProperty')
        self.assertEqual(unknown['status'], 'raw-preserved')
        raw = (args.output/'native/map.unwrapped.bin').read_bytes()
        self.assertEqual(raw[unknown['payload']['offset']:unknown['payload']['offset']+3], b'\x11\x22\x33')
        tail = placed['declaration']['nativeTail']
        self.assertEqual(raw[tail['offset']:tail['offset']+tail['bytes']], b'\xab\xcd')
        self.assertEqual(inventory['objects'][2]['status'], 'omitted-reference-unresolved')
        sound = inventory['sounds'][0]
        self.assertEqual(sound['export']['object'], 'AmbSound.Default.wind_loop')
        self.assertEqual(sound['properties'][0]['payloadHex'], 'aabbcc')
        package = Package((args.client_snapshot/'sounds/AmbSound.uax').read_bytes(), 'AmbSound.uax')
        span = sound['serializedExport']
        self.assertEqual((args.output/span['path']).read_bytes(), package.data[span['offsetUnwrapped']:span['offsetUnwrapped']+span['bytes']])
        self.assertEqual((args.output/sound['nativePayloadFile']).read_bytes(), wav_bytes())
        coverage = self.read(args, 'coverage.json')
        media = coverage['sounds'][0]['products']['audio']
        self.assertEqual((args.output/media['path']).read_bytes(), wav_bytes())
        self.assertIn(b'smpl', (args.output/media['path']).read_bytes())
        self.assertFalse(coverage['runtime']['nativePlaybackVerified'])
        self.assertFalse(coverage['runtime']['worldPlaybackConnected'])
        self.assertEqual(coverage['runtime']['nativeLoopPolicy'], 'unresolved')

    def test_corrupt_locked_source_fails_before_output(self):
        args = self.fixture()
        sound = args.client_snapshot/'sounds/AmbSound.uax'
        sound.write_bytes(sound.read_bytes()[:-1] + b'X')
        with self.assertRaisesRegex(audio.FormatError, 'hash/length mismatch'):
            audio.run(args)
        self.assertFalse(args.output.exists())

    def test_map_recipe_hash_and_tool_pin_are_strict(self):
        args = self.fixture()
        recipe = self.read_recipe(args)
        recipe['map']['sha256'] = '0'*64
        args.recipe.write_bytes(audio.canonical(recipe))
        with self.assertRaisesRegex(audio.FormatError, 'map identity differs'):
            audio.run(args)
        self.assertFalse(args.output.exists())
        self.tool.write_bytes(b'not the pinned tool')
        with self.assertRaisesRegex(audio.FormatError, 'tool hash mismatch'):
            audio.run(args)

    def read_recipe(self, args):
        return audio.load_json(args.recipe.read_bytes())

    def test_group_less_reference_cannot_use_converter_leaf_fallback(self):
        args = self.fixture(grouped=False)
        with patch.object(audio, 'Converter', wraps=audio.Converter) as converter:
            result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['failedReferencedDependencies'], 1)
        self.assertIn('exact qualified', self.read(args, 'inventory.json')['sounds'][0]['error'])
        self.assertFalse(list(args.output.rglob('asset.l2asset')))
        constructor_only_call_count = 1
        self.assertEqual(converter.call_count, constructor_only_call_count)

    def test_ambiguous_exact_object_does_not_export(self):
        args = self.fixture(duplicate=True)
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertIn('ambiguous', self.read(args, 'inventory.json')['sounds'][0]['error'])
        self.assertFalse(list(args.output.rglob('asset.l2asset')))

    def test_exact_wrong_class_does_not_export(self):
        args = self.fixture(wrong_class=True)
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertIn('not Sound', self.read(args, 'inventory.json')['sounds'][0]['error'])

    def test_missing_staged_dependency_is_explicit_failed_coverage(self):
        args = self.fixture()
        (args.client_snapshot/'sounds/AmbSound.uax').unlink()
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertIn('not staged', self.read(args, 'inventory.json')['sounds'][0]['error'])

    def test_unsupported_payload_keeps_original_bytes_but_fails_closure(self):
        args = self.fixture(payload=b'unknown native codec')
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['soundStatuses'], {'unsupported-export': 1})
        sound = self.read(args, 'inventory.json')['sounds'][0]
        self.assertEqual((args.output/sound['nativePayloadFile']).read_bytes(), b'unknown native codec')
        self.assertTrue((args.output/sound['serializedExport']['path']).exists())
        self.assertEqual(list((args.output/'cache/.work').iterdir()), [])

    def test_wav_codec_rejection_is_explicit_failed_coverage(self):
        payload = bytearray(wav_bytes())
        wav_format_tag_offset, unsupported_ieee_float_format_tag = 20, 3
        struct.pack_into('<H', payload, wav_format_tag_offset, unsupported_ieee_float_format_tag)
        args = self.fixture(payload=bytes(payload))
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['soundStatuses'], {'unsupported-export': 1})
        self.assertIn('unknown format', self.read(args, 'coverage.json')['sounds'][0]['error'])

    def test_lazy_array_boundary_failure_retains_serialized_export(self):
        args = self.fixture(bad_boundary=True)
        result = audio.run(args)
        self.assertFalse(result['success'])
        sound = self.read(args, 'inventory.json')['sounds'][0]
        self.assertIn('boundary', sound['error'])
        self.assertTrue((args.output/sound['serializedExport']['path']).is_file())

    def test_undecoded_reference_is_retained_as_error_not_an_omitted_default(self):
        args = self.fixture(invalid_property=True)
        result = audio.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['declarationDecodeErrors'], 2)
        self.assertFalse(result['counts']['expectedInventoryMatch'])
        self.assertEqual(self.read(args, 'inventory.json')['objects'][0]['declaration']['properties'][0]['status'], 'raw-preserved')

    def test_explicit_null_reference_is_separate_from_omission(self):
        args = self.fixture(null_reference=True)
        result = audio.run(args)
        recipe_still_expecting_two_references_succeeded = result['success']
        self.assertFalse(recipe_still_expecting_two_references_succeeded)
        self.assertEqual([row['status'] for row in self.read(args, 'inventory.json')['objects']],
                         ['serialized-null-reference', 'serialized-null-reference', 'omitted-reference-unresolved'])

    def test_unsafe_lock_paths_duplicate_case_and_device_names_reject(self):
        args = self.fixture()
        original = audio.load_json(args.input_lock.read_bytes())
        for name in ('../escape.uax', 'sounds\\AmbSound.uax', 'sounds/NUL.uax', 'sounds/evil.uax.', '/absolute.uax'):
            lock = json.loads(json.dumps(original))
            lock['files'][1]['relativePath'] = name
            args.input_lock.write_bytes(audio.canonical(lock))
            with self.subTest(name=name), self.assertRaises(ValueError):
                audio.run(args)
        original['files'].append({**original['files'][1], 'relativePath': original['files'][1]['relativePath'].upper()})
        args.input_lock.write_bytes(audio.canonical(original))
        with self.assertRaisesRegex(audio.FormatError, 'duplicate'):
            audio.run(args)
        self.assertFalse(args.output.exists())

    def test_source_public_assets_and_root_outputs_are_rejected(self):
        args = self.fixture()
        for output in (args.client_snapshot/'derived', self.root/'public/new', self.root/'assets/new',
                       self.root/'artifacts', self.root/'artifacts/inputs', self.root/'elsewhere'):
            args.output = output
            with self.subTest(output=output), self.assertRaises(audio.FormatError):
                audio.run(args)

    def test_unowned_existing_destination_and_busy_run_are_not_overwritten(self):
        args = self.fixture()
        args.output.mkdir()
        important = args.output/'keep.txt'
        important.write_bytes(b'authored work')
        with self.assertRaisesRegex(audio.FormatError, 'not owned'):
            audio.run(args)
        self.assertEqual(important.read_bytes(), b'authored work')
        args.output = self.root/'artifacts/new-output'
        audio.run(args)
        (args.output/'.run.lock').write_bytes(b'other process')
        with self.assertRaisesRegex(audio.FormatError, 'Another export'):
            audio.run(args)
        self.assertEqual((args.output/'.run.lock').read_bytes(), b'other process')

    def test_changed_settings_and_corrupt_output_are_rejected_without_repair(self):
        args = self.fixture()
        audio.run(args)
        coverage = self.read(args, 'coverage.json')
        media = args.output/coverage['sounds'][0]['products']['audio']['path']
        media.write_bytes(b'corruption')
        args.verify_only = True
        with self.assertRaisesRegex(audio.FormatError, 'manifest/file/hash'):
            audio.run(args)
        self.assertEqual(media.read_bytes(), b'corruption')
        recipe = self.read_recipe(args)
        recipe['expectedInventory']['declarations'] = 4
        args.recipe.write_bytes(audio.canonical(recipe))
        with self.assertRaisesRegex(audio.FormatError, 'different inputs'):
            audio.run(args)

    def test_rehashed_coverage_counter_forgery_is_rejected(self):
        args = self.fixture()
        audio.run(args)
        coverage = self.read(args, 'coverage.json')
        coverage['counts']['exportedSounds'] = 999
        (args.output/'coverage.json').write_bytes(audio.canonical(coverage))
        (args.output/'SHA256-MANIFEST.json').write_bytes(audio.canonical({'schemaVersion': 1, 'files': audio.files_receipt(args.output)}))
        args.verify_only = True
        with self.assertRaisesRegex(audio.FormatError, 'counters/status'):
            audio.run(args)

    def test_rehashed_cache_traversal_is_rejected_before_reuse(self):
        args = self.fixture()
        audio.run(args)
        index = next((args.output/'cache/index').glob('*.json'))
        record = audio.load_json(index.read_bytes())
        record['directory'] = '../../outside'
        index.write_bytes(audio.canonical(record))
        (args.output/'SHA256-MANIFEST.json').write_bytes(audio.canonical({'schemaVersion': 1, 'files': audio.files_receipt(args.output)}))
        with patch.object(audio, 'Converter', side_effect=AssertionError('unsafe cache must not reach Converter')):
            with self.assertRaisesRegex(audio.FormatError, 'Unsafe cache content directory'):
                audio.run(args)

    def test_linked_output_ancestor_is_rejected(self):
        args = self.fixture()
        target = self.root/'scratch-target'
        target.mkdir()
        link = self.root/'artifacts/linked'
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not allow test symlink creation')
        args.output = link/'new'
        with self.assertRaisesRegex(audio.FormatError, 'Linked/reparse'):
            audio.run(args)
        self.assertFalse((target/'new').exists())

    def test_duplicate_json_source_keys_are_rejected(self):
        args = self.fixture()
        args.recipe.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaisesRegex(audio.FormatError, 'Duplicate JSON key'):
            audio.run(args)
        self.assertFalse(args.output.exists())

    def test_verify_only_missing_output_creates_nothing(self):
        args = self.fixture()
        args.verify_only = True
        with self.assertRaisesRegex(audio.FormatError, 'completed existing'):
            audio.run(args)
        self.assertFalse(args.output.exists())


if __name__ == '__main__':
    unittest.main()
