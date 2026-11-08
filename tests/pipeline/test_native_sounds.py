import argparse
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
import native_assets
from reference_client_lock_fixture import lock_client_as_reference_root
from test_native_map_audio import compact, package_bytes, sound_package, wav_bytes

spec = importlib.util.spec_from_file_location('export_native_sounds', ROOT/'scripts/export-native-sounds.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


def mixed_name_package():
    payload = wav_bytes()

    def body(offset, names):
        prefix = compact(names['None']) + compact(names['WAV'])
        size = len(prefix) + 4 + len(compact(len(payload))) + len(payload)
        return prefix + struct.pack('<i', offset + size) + compact(len(payload)) + payload

    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Sound'),
               ('Core', 'Package', 0, 'Core'), ('Core', 'Class', -3, 'Package')]
    return package_bytes(['WAV'], imports, [
        {'name': 'Default', 'class': -4, 'body': lambda offset, names: b''},
        {'name': 'wind_loop', 'class': -2, 'outer': 1, 'body': body},
        {'name': 'wind-loop', 'class': -2, 'outer': 1, 'body': body}])


class NativeSoundBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(batch, 'ROOT', self.root))
        self.tool = self.root/'tool.exe'
        self.tool.write_bytes(b'pinned analysis input; must never run')
        self.stack.enter_context(patch.object(native_assets, 'UMODEL_SHA256', batch.digest(self.tool.read_bytes())))
        self.native_process = self.stack.enter_context(patch('native_assets.subprocess.run', side_effect=AssertionError('No native process permitted')))

    def fixture(self, **options):
        snapshot = self.root/'artifacts/inputs/IMPORTA-PC'
        (snapshot/'sounds').mkdir(parents=True)
        lock_client_as_reference_root(self, snapshot)
        source = snapshot/'sounds/AmbSound.uax'
        hyphen = options.pop('hyphen', False)
        mixed = options.pop('mixed', False)
        data = mixed_name_package() if mixed else sound_package(**options)
        source.write_bytes(data.replace(b'wind_loop', b'wind-loop') if hyphen else data)
        pin = {'relativePath': 'sounds/AmbSound.uax', 'bytes': source.stat().st_size, 'sha256': batch.digest(source.read_bytes())}
        (self.root/'recipes').mkdir()
        lock = self.root/'recipes/lock.json'
        lock.write_bytes(batch.canonical({'schemaVersion': 1, 'sourceHost': 'IMPORTA-PC',
            'sourceRoot': 'C:/Lineage2-client', 'files': [pin]}))
        sounds = 2 if mixed or options.get('duplicate') else 0 if options.get('wrong_class') else 1
        recipe = self.root/'recipes/recipe.json'
        recipe.write_bytes(batch.canonical({'schemaVersion': 1, 'kind': 'native-sound-packages',
            'source': {'host': 'IMPORTA-PC', 'root': 'C:/Lineage2-client'}, 'selection': batch.SELECTION,
            'packages': [{'file': pin['relativePath'], 'bytes': pin['bytes'], 'sha256': pin['sha256'], 'expectedSounds': sounds}],
            'expectedInventory': {'packages': 1, 'sounds': sounds}}))
        return argparse.Namespace(client_snapshot=snapshot, input_lock=lock, recipe=recipe,
            umodel=self.tool, output=self.root/'artifacts/output', verify_only=False, reuse_from=None)

    def read(self, args, name):
        return batch.load_json((args.output/name).read_bytes())

    def snapshot(self, path, mtime=False):
        return {p.relative_to(path).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns) if mtime else p.read_bytes()
                for p in path.rglob('*') if p.is_file()}

    def rewrite(self, path, value):
        path.write_bytes(batch.canonical(value))

    def rehash(self, args):
        self.rewrite(args.output/'SHA256-MANIFEST.json', {'schemaVersion': 1, 'files': batch.map_audio_exporter_guards.files_receipt(args.output)})

    def output_from_previous_name_policy_wrapper(self, args):
        previous_wrapper_implementation = batch.implementation()
        previous_wrapper_implementation['files']['export-native-sounds.py'] = 'a07ac02e417616f0000754ee746cc19cd59ce5eee085cb2fb4fc20d1500c022f'
        with patch.object(batch, 'FULL_OBJECT', batch.map_audio_exporter_guards.REFERENCE), \
                patch.object(batch, 'implementation', return_value=previous_wrapper_implementation):
            return batch.run(args)

    def test_real_converter_clean_repeat_and_cache_preserve_bytes_and_times(self):
        args = self.fixture()
        source = self.snapshot(args.client_snapshot)
        first = batch.run(args)
        self.assertTrue(first['success'])
        self.assertEqual(first['cacheHits'], 0)
        old = self.snapshot(args.output, True)
        repeat = batch.run(args)
        self.assertEqual(repeat['cacheHits'], 1)
        self.assertEqual(self.snapshot(args.output, True), old)
        args.output = self.root/'artifacts/clean'
        clean = batch.run(args)
        self.assertEqual(clean['coverageSha256'], first['coverageSha256'])
        self.assertEqual(self.snapshot(args.output), {key: value[0] for key, value in old.items()})
        self.assertEqual(source, self.snapshot(args.client_snapshot))
        self.native_process.assert_not_called()

    def test_verify_only_never_converts_or_changes_files(self):
        args = self.fixture()
        batch.run(args)
        old = self.snapshot(args.output, True)
        args.verify_only = True
        with patch.object(batch, 'Converter', side_effect=AssertionError('verify-only must not convert')):
            self.assertTrue(batch.run(args)['success'])
        self.assertEqual(self.snapshot(args.output, True), old)

    def test_exact_id_raw_records_ancillary_chunks_and_single_cache_product(self):
        args = self.fixture()
        batch.run(args)
        row = self.read(args, 'inventory.json')['sounds'][0]
        self.assertEqual(row['export']['object'], 'AmbSound.Default.wind_loop')
        self.assertEqual(row['stableId'], 'IMPORTA-PC:' + row['sourcePackage']['sha256'] + ':2')
        self.assertEqual((args.output/row['nativePayload']['path']).read_bytes(), wav_bytes())
        self.assertEqual(row['nativeSound']['properties'][0]['payloadHex'], 'aabbcc')
        coverage = self.read(args, 'coverage.json')
        media = coverage['sounds'][0]['products']['audio']
        self.assertEqual((args.output/media['path']).read_bytes(), wav_bytes())
        self.assertEqual([chunk['fourCC'] for chunk in media['metadata']['riff']['chunks']], ['fmt ', 'data', 'smpl'])
        self.assertEqual(len(list(args.output.rglob('asset.l2asset'))), 1)
        self.assertFalse(coverage['runtime']['worldPlaybackConnected'])
        self.assertEqual(coverage['runtime']['eventSelection'], 'not-inferred')

    def test_hyphenated_native_name_exports_without_renaming_or_shared_policy_change(self):
        args = self.fixture(hyphen=True)
        result = batch.run(args)
        self.assertTrue(result['success'])
        row = self.read(args, 'inventory.json')['sounds'][0]
        self.assertEqual(row['export']['object'], 'AmbSound.Default.wind-loop')
        self.assertEqual(row['id'], 'interlude:AmbSound.Default.wind-loop')
        self.assertIsNone(batch.map_audio_exporter_guards.REFERENCE.fullmatch(row['export']['object']))
        media = self.read(args, 'coverage.json')['sounds'][0]['products']['audio']
        self.assertEqual((args.output/media['path']).read_bytes(), wav_bytes())

    def test_reuse_partial_older_wrapper_preserves_old_tree_and_matches_clean_build(self):
        args = self.fixture(mixed=True)
        self.assertFalse(self.output_from_previous_name_policy_wrapper(args)['success'])
        previous = args.output
        old = self.snapshot(previous, True)
        args.output = self.root/'artifacts/reused'
        args.reuse_from = previous
        result = batch.run(args)
        self.assertTrue(result['success'])
        self.assertEqual(result['importedCacheSounds'], 1)
        self.assertEqual(result['cacheHits'], 1)
        self.assertEqual(self.snapshot(previous, True), old)
        seeded = self.snapshot(args.output)
        seeded_times = self.snapshot(args.output, True)
        args.reuse_from = None
        self.assertEqual(batch.run(args)['cacheHits'], 2)
        self.assertEqual(self.snapshot(args.output, True), seeded_times)
        args.output = self.root/'artifacts/clean-new-wrapper'
        clean = batch.run(args)
        self.assertTrue(clean['success'])
        self.assertEqual(clean['cacheHits'], 0)
        self.assertEqual(self.snapshot(args.output), seeded)
        self.assertEqual(self.snapshot(previous, True), old)

    def test_reuse_corrupt_previous_media_rejected_before_any_destination_write(self):
        args = self.fixture(mixed=True)
        self.output_from_previous_name_policy_wrapper(args)
        previous = args.output
        coverage = self.read(args, 'coverage.json')
        media = previous/coverage['sounds'][0]['products']['audio']['path']
        media.write_bytes(b'corrupt')
        self.rehash(args)
        old = self.snapshot(previous, True)
        args.output, args.reuse_from = self.root/'artifacts/reused', previous
        with self.assertRaisesRegex(ValueError, 'Loose cache member differs'):
            batch.run(args)
        self.assertFalse(args.output.exists())
        self.assertEqual(self.snapshot(previous, True), old)

    def test_reuse_non_wrapper_tool_settings_or_source_pin_drift_rejected_without_writes(self):
        args = self.fixture()
        self.output_from_previous_name_policy_wrapper(args)
        previous = args.output
        original = self.read(args, 'run.json')
        mutations = [
            lambda owner: owner['implementation']['files'].__setitem__('native_map.py', '0'*64),
            lambda owner: owner['implementation'].__setitem__('converterSha256', '0'*64),
            lambda owner: owner['implementation']['tool'].__setitem__('sha256', '0'*64),
            lambda owner: owner.__setitem__('recipeSha256', '0'*64),
            lambda owner: owner.__setitem__('inputLockSha256', '0'*64),
            lambda owner: owner['settings'].__setitem__('runtimeStaging', True),
        ]
        for index, mutate in enumerate(mutations):
            owner = json.loads(json.dumps(original))
            mutate(owner)
            self.rewrite(previous/'run.json', owner)
            self.rehash(args)
            attempt = argparse.Namespace(**{**vars(args), 'output': self.root/('artifacts/rejected-' + str(index)), 'reuse_from': previous})
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'non-wrapper implementation differs'):
                batch.run(attempt)
            self.assertFalse(attempt.output.exists())

    def test_reuse_inventory_mutation_is_not_allowed_as_name_promotion(self):
        args = self.fixture(mixed=True)
        self.output_from_previous_name_policy_wrapper(args)
        previous = args.output
        document = self.read(args, 'inventory.json')
        document['sounds'][1]['serializedExport']['sha256'] = '0'*64
        self.rewrite(previous/'inventory.json', document)
        self.rehash(args)
        args.output, args.reuse_from = self.root/'artifacts/reused', previous
        with self.assertRaisesRegex(ValueError, 'source identity or raw span differs'):
            batch.run(args)
        self.assertFalse(args.output.exists())

    def test_reuse_overlap_existing_target_and_verify_only_are_refused(self):
        args = self.fixture()
        self.output_from_previous_name_policy_wrapper(args)
        previous = args.output
        old = self.snapshot(previous, True)
        for output in (previous, previous/'inside', previous.parent):
            attempt = argparse.Namespace(**{**vars(args), 'output': output, 'reuse_from': previous})
            with self.subTest(output=str(output)), self.assertRaisesRegex(ValueError, 'fresh nonexistent|overlaps protected|named subdirectory'):
                batch.run(attempt)
        target = self.root/'artifacts/existing-empty'
        target.mkdir()
        args.output, args.reuse_from = target, previous
        with self.assertRaisesRegex(ValueError, 'fresh nonexistent'):
            batch.run(args)
        self.assertEqual(list(target.iterdir()), [])
        args.output = self.root/'artifacts/not-created'
        args.verify_only = True
        with self.assertRaisesRegex(ValueError, 'cannot be combined'):
            batch.run(args)
        self.assertFalse(args.output.exists())
        self.assertEqual(self.snapshot(previous, True), old)

    def test_reuse_unknown_files_busy_tree_and_source_change_fail_before_output(self):
        args = self.fixture()
        self.output_from_previous_name_policy_wrapper(args)
        previous = args.output
        (previous/'unowned.txt').write_bytes(b'preserve')
        self.rehash(args)
        attempt = argparse.Namespace(**{**vars(args), 'output': self.root/'artifacts/rejected', 'reuse_from': previous})
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing output'):
            batch.run(attempt)
        self.assertFalse(attempt.output.exists())
        (previous/'.run.lock').write_bytes(b'active')
        with self.assertRaisesRegex(ValueError, 'active or interrupted'):
            batch.run(attempt)
        self.assertFalse(attempt.output.exists())
        source = args.client_snapshot/'sounds/AmbSound.uax'
        source.write_bytes(source.read_bytes()[:-1] + b'X')
        with self.assertRaisesRegex(ValueError, 'hash/length mismatch'):
            batch.run(attempt)
        self.assertFalse(attempt.output.exists())

    def test_reuse_symlink_is_rejected_without_target_writes(self):
        args = self.fixture()
        self.output_from_previous_name_policy_wrapper(args)
        link = self.root/'artifacts/linked-output'
        try:
            link.symlink_to(args.output, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not allow test symlink creation')
        args.output, args.reuse_from = self.root/'artifacts/new-target', link
        with self.assertRaisesRegex(ValueError, 'Linked/reparse'):
            batch.run(args)
        self.assertFalse(args.output.exists())

    def test_bad_source_hash_and_tool_fail_before_output(self):
        args = self.fixture()
        source = args.client_snapshot/'sounds/AmbSound.uax'
        source.write_bytes(source.read_bytes()[:-1] + b'X')
        with self.assertRaisesRegex(ValueError, 'hash/length mismatch'):
            batch.run(args)
        self.assertFalse(args.output.exists())
        self.tool.write_bytes(b'changed tool')
        with self.assertRaisesRegex(ValueError, 'tool hash mismatch'):
            batch.run(args)
        self.assertFalse(args.output.exists())

    def test_missing_source_is_fatal_not_unsupported(self):
        args = self.fixture()
        (args.client_snapshot/'sounds/AmbSound.uax').unlink()
        with self.assertRaises(FileNotFoundError):
            batch.run(args)
        self.assertFalse(args.output.exists())

    def test_unsupported_codec_retains_raw_bytes_and_is_reverified(self):
        args = self.fixture(payload=b'not-a-supported-codec')
        result = batch.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['soundStatuses'], {'unsupported-codec': 1})
        row = self.read(args, 'inventory.json')['sounds'][0]
        self.assertEqual((args.output/row['nativePayload']['path']).read_bytes(), b'not-a-supported-codec')
        old = self.snapshot(args.output, True)
        args.verify_only = True
        self.assertFalse(batch.run(args)['success'])
        self.assertEqual(old, self.snapshot(args.output, True))

    def test_unsupported_pcm_codec_does_not_enter_converter(self):
        payload = bytearray(wav_bytes())
        struct.pack_into('<H', payload, 20, 3)
        args = self.fixture(payload=bytes(payload))
        with patch.object(batch.Converter, 'convert', side_effect=AssertionError('Unsupported codec must not convert')):
            result = batch.run(args)
        self.assertEqual(result['counts']['soundStatuses'], {'unsupported-codec': 1})

    def test_bad_native_boundary_retains_serialized_export_only(self):
        args = self.fixture(bad_boundary=True)
        result = batch.run(args)
        self.assertEqual(result['counts']['soundStatuses'], {'unsupported-source-record': 1})
        row = self.read(args, 'inventory.json')['sounds'][0]
        self.assertTrue((args.output/row['serializedExport']['path']).is_file())
        self.assertNotIn('nativePayload', row)
        self.assertIn('boundary', row['error'])

    def test_duplicate_exact_name_never_uses_leaf_fallback(self):
        args = self.fixture(duplicate=True)
        result = batch.run(args)
        self.assertEqual(result['counts']['unsupportedSourceRecords'], 2)
        rows = self.read(args, 'inventory.json')['sounds']
        self.assertNotEqual(rows[0]['stableId'], rows[1]['stableId'])
        self.assertTrue(all('Ambiguous' in row['error'] for row in rows))
        self.assertFalse(list(args.output.rglob('asset.l2asset')))

    def test_non_sound_exports_are_not_selected(self):
        args = self.fixture(wrong_class=True)
        result = batch.run(args)
        self.assertTrue(result['success'])
        self.assertEqual(result['counts']['sounds'], 0)
        self.assertFalse(list(args.output.rglob('asset.l2asset')))

    def test_recipe_cannot_drop_locked_package_or_change_source_pin(self):
        args = self.fixture()
        recipe = batch.load_json(args.recipe.read_bytes())
        altered = json.loads(json.dumps(recipe))
        altered['packages'] = []
        self.rewrite(args.recipe, altered)
        with self.assertRaisesRegex(ValueError, 'every locked UAX'):
            batch.run(args)
        recipe['packages'][0]['sha256'] = '0'*64
        self.rewrite(args.recipe, recipe)
        with self.assertRaisesRegex(ValueError, 'identity differs'):
            batch.run(args)
        self.assertFalse(args.output.exists())

    def test_unexpected_inventory_count_is_partial_not_false_complete(self):
        args = self.fixture()
        recipe = batch.load_json(args.recipe.read_bytes())
        recipe['packages'][0]['expectedSounds'] = 2
        recipe['expectedInventory']['sounds'] = 2
        self.rewrite(args.recipe, recipe)
        result = batch.run(args)
        self.assertFalse(result['success'])
        self.assertFalse(self.read(args, 'coverage.json')['expectedInventoryMatch'])

    def test_unsupported_package_header_is_explicit_partial_coverage(self):
        args = self.fixture()
        source = args.client_snapshot/'sounds/AmbSound.uax'
        source.write_bytes(b'unsupported package header')
        lock = batch.load_json(args.input_lock.read_bytes())
        recipe = batch.load_json(args.recipe.read_bytes())
        for row in (lock['files'][0], recipe['packages'][0]):
            row.update(bytes=source.stat().st_size, sha256=batch.digest(source.read_bytes()))
        self.rewrite(args.input_lock, lock)
        self.rewrite(args.recipe, recipe)
        result = batch.run(args)
        self.assertFalse(result['success'])
        self.assertEqual(result['counts']['unsupportedPackages'], 1)
        self.assertEqual(self.read(args, 'inventory.json')['packages'][0]['status'], 'unsupported-package')
        args.verify_only = True
        self.assertFalse(batch.run(args)['success'])

    def test_source_overlap_unowned_destination_and_busy_run_refused(self):
        args = self.fixture()
        original = args.output
        for output in (args.client_snapshot/'new', self.root/'artifacts/inputs', self.root/'artifacts',
                       self.root/'public/new', self.root/'elsewhere'):
            args.output = output
            with self.subTest(output=str(output)), self.assertRaises(ValueError):
                batch.run(args)
        args.output = original
        args.output.mkdir()
        (args.output/'keep.txt').write_bytes(b'authored')
        with self.assertRaisesRegex(ValueError, 'not owned'):
            batch.run(args)
        self.assertEqual((args.output/'keep.txt').read_bytes(), b'authored')
        args.output = self.root/'artifacts/other'
        batch.run(args)
        (args.output/'.run.lock').write_bytes(b'busy')
        with self.assertRaisesRegex(ValueError, 'Another export'):
            batch.run(args)
        self.assertEqual((args.output/'.run.lock').read_bytes(), b'busy')

    def test_unsafe_source_and_duplicate_case_lock_rejected(self):
        args = self.fixture()
        lock = batch.load_json(args.input_lock.read_bytes())
        for name in ('../evil.uax', 'sounds\\evil.uax', 'sounds/NUL.uax', 'sounds/trailing.uax.'):
            altered = json.loads(json.dumps(lock))
            altered['files'][0]['relativePath'] = name
            self.rewrite(args.input_lock, altered)
            with self.subTest(name=name), self.assertRaises(ValueError):
                batch.run(args)
        lock['files'].append({**lock['files'][0], 'relativePath': lock['files'][0]['relativePath'].upper()})
        self.rewrite(args.input_lock, lock)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            batch.run(args)

    def test_corrupt_media_is_not_repaired_even_if_manifest_rehashed(self):
        args = self.fixture()
        batch.run(args)
        row = self.read(args, 'coverage.json')['sounds'][0]
        path = args.output/row['products']['audio']['path']
        path.write_bytes(b'corrupt')
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'Loose cache member differs'):
            batch.run(args)
        self.assertEqual(path.read_bytes(), b'corrupt')

    def test_forged_converter_export_manifest_is_rejected_even_if_manifest_rehashed(self):
        args = self.fixture()
        batch.run(args)
        row = self.read(args, 'coverage.json')['sounds'][0]
        export_manifest = args.output/row['products']['archive']['path'].removesuffix('asset.l2asset')/'evidence/export-manifest.json'
        forged = batch.load_json(export_manifest.read_bytes())
        forged['files'] = []
        self.rewrite(export_manifest, forged)
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'Converter export manifest differs'):
            batch.run(args)

    def test_rehashed_unknown_files_and_coverage_counter_forgery_rejected(self):
        args = self.fixture()
        batch.run(args)
        coverage = self.read(args, 'coverage.json')
        coverage['counts']['exportedSounds'] = 2
        self.rewrite(args.output/'coverage.json', coverage)
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'counters/status'):
            batch.run(args)
        coverage['counts']['exportedSounds'] = 1
        self.rewrite(args.output/'coverage.json', coverage)
        (args.output/'unowned.txt').write_bytes(b'keep')
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing output'):
            batch.run(args)
        self.assertEqual((args.output/'unowned.txt').read_bytes(), b'keep')

    def test_nested_lock_named_file_is_not_treated_as_our_root_lock(self):
        args = self.fixture()
        batch.run(args)
        (args.output/'unowned').mkdir()
        (args.output/'unowned/.run.lock').write_bytes(b'not our lock')
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing output'):
            batch.run(args)

    def test_supported_source_cannot_be_relabelled_unsupported(self):
        args = self.fixture()
        batch.run(args)
        inventory = self.read(args, 'inventory.json')
        old = self.read(args, 'coverage.json')['sounds'][0]
        bogus = {'stableId': old['stableId'], 'status': 'unsupported-codec', 'error': 'invented'}
        self.rewrite(args.output/'coverage.json', batch.coverage_document(inventory, [bogus]))
        self.rehash(args)
        with self.assertRaisesRegex(ValueError, 'Supported source has no export'):
            batch.run(args)

    def test_cache_traversal_rejected_before_converter(self):
        args = self.fixture()
        batch.run(args)
        index = next((args.output/'cache/index').glob('*.json'))
        row = batch.load_json(index.read_bytes())
        row['directory'] = '../../outside'
        self.rewrite(index, row)
        self.rehash(args)
        with patch.object(batch, 'Converter', side_effect=AssertionError('Unsafe cache reached converter')):
            with self.assertRaisesRegex(ValueError, 'cache index differs'):
                batch.run(args)

    def test_converter_or_validation_errors_are_fatal_not_partial_coverage(self):
        args = self.fixture()
        with patch.object(batch.Converter, 'convert', side_effect=ValueError('integrity failure')):
            with self.assertRaisesRegex(ValueError, 'integrity failure'):
                batch.run(args)
        self.assertFalse((args.output/'coverage.json').exists())
        self.assertFalse((args.output/'.run.lock').exists())

    def test_verify_missing_output_and_duplicate_json_keys_create_nothing(self):
        args = self.fixture()
        args.verify_only = True
        with self.assertRaisesRegex(ValueError, 'completed existing output'):
            batch.run(args)
        self.assertFalse(args.output.exists())
        args.recipe.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            batch.run(args)

    def test_symlink_destination_refused(self):
        args = self.fixture()
        target = self.root/'target'
        target.mkdir()
        link = self.root/'artifacts/link'
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not allow test symlink creation')
        args.output = link/'output'
        with self.assertRaisesRegex(ValueError, 'Linked/reparse'):
            batch.run(args)
        self.assertFalse((target/'output').exists())


if __name__ == '__main__':
    unittest.main()
