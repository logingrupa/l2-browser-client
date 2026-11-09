import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_batch_adapters as adapters
import native_assets
from native_environment import HEADER, build_products
from native_assets_lib.gltf import json_bytes


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else json_bytes(data))
    return path


def envelope(payload):
    body = HEADER + bytes(value ^ 0xac for value in payload)
    return body + struct.pack('<5I', 0, 1, 32, zlib.crc32(body), 0)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / 'output'
        self.output.mkdir()
        self.source = self.root / 'inputs'
        self.source.mkdir()
        self.lock = write(self.root, 'recipes/lock.json', {'schemaVersion': 1, 'files': [
            {'relativePath': 'sound/Test.uax', 'bytes': 3, 'sha256': sha(b'src')} ]})
        write(self.source, 'sound/Test.uax', b'src')

    def tearDown(self):
        self.temp.cleanup()

    def job(self, adapter='assets', **extra):
        value = {'id': 'fixture', 'adapter': adapter, 'source': 'original'}
        if adapter in ('assets', 'migration', 'sounds', 'ambient'):
            value['recipe'] = 'recipes/request.json'
        return {**value, **extra}

    def asset(self, request=None, directory=None):
        request = request or {'kind': 'audio', 'package': 'Test', 'object': 'tone'}
        source = {'edition': 'interlude', 'package': 'Test', 'object': 'Test.tone', 'sha256': sha(b'src')}
        provenance = {'schemaVersion': 1, 'request': request, 'source': source,
            'dependencies': {'sound/Test.uax': sha(b'src')}, 'converterSha256': native_assets.implementation_hash(),
            'tool': {'sha256': native_assets.UMODEL_SHA256}, 'metadata': {}}
        wav = b'RIFF' + struct.pack('<I', 38) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 22050, 44100, 2, 16) + b'data' + struct.pack('<Ih', 2, 0)
        files = {'audio.wav': wav, 'provenance.json': json_bytes(provenance)}
        manifest = {'schemaVersion': 1, 'id': 'interlude:Test.tone', 'kind': request['kind'], 'source': source,
            'limitations': ['Synthetic test fixture; no playback claim.'], 'animationEvents': [], 'audio': {'file': 'audio.wav'},
            'files': [{'path': name, 'sha256': sha(data), 'bytes': len(data), 'mime': 'application/octet-stream'} for name, data in files.items()]}
        archive = native_assets.archive_bytes(manifest, files)
        content = sha(archive)
        directory = directory or content
        target = self.output / directory
        for name, data in {**files, 'asset.json': json_bytes(manifest), 'asset.l2asset': archive}.items():
            write(target, name, data)
        outputs = {name: sha((target / name).read_bytes()) for name in ('asset.json', 'asset.l2asset', *files)}
        key = native_assets.sha(json_bytes({'request': request, 'implementation': native_assets.implementation_hash(), 'umodel': native_assets.UMODEL_SHA256}))
        index = write(self.output, 'index/' + key + '.json', {'directory': content, 'outputs': outputs, 'dependencies': provenance['dependencies']})
        write(self.root, 'recipes/request.json', [request])
        return target, index, manifest

    def environment(self, payload=None):
        payload = payload or b'[SkyBoxColor]\r\nNUM=1\r\nCOLOR1=(T=12,R=66,G=124,B=176)\r\n'
        original = envelope(payload)
        products = build_products({'test.int': original})
        for name, data in products.items(): write(self.output, name, data)
        write(self.lock.parent, self.lock.name, {'schemaVersion': 1, 'files': [
            {'relativePath': 'test.int', 'bytes': len(original), 'sha256': sha(original)}]})
        return self.job('environment', files=['test.int'])

    def audio(self, name='sounds', unsupported=False):
        from native_audio import decode_native_audio
        module = adapters._audio_module(name)
        request = {'kind': 'audio', 'package': 'sound/Test.uax', 'object': 'Test.tone'}
        write(self.root, 'recipes/request.json', {'fixture': name})
        identity = 'stableId' if name == 'sounds' else 'referenceKey'
        package = {'relativePath': 'sound/Test.uax', 'sha256': sha(b'src'), 'bytes': 3}
        wav = b'RIFF' + struct.pack('<I', 38) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 22050, 44100, 2, 16) + b'data' + struct.pack('<Ih', 2, 0)
        raw = b'prefix' + wav + b'tail'
        native_path = write(self.output, 'source/native.bin', wav)
        write(self.output, 'source/serialized.bin', raw)
        decoded, mime, metadata = decode_native_audio(native_path)
        metadata.update(nativeFormat='WAV', nativePayloadSha256=sha(wav), nativeExportIndex=3)
        source = {identity: 'exact-source-identity', 'id': 'interlude:Test.tone', 'sourcePackage': package,
            'export': {'object': 'Test.tone', 'exportIndex': 3, 'offset': 100, 'size': len(raw)},
            'nativeSound': {'nativeFormat': 'WAV', 'exportIndex': 3, 'embeddedPayloadOffsetUnwrapped': 106,
                            'embeddedPayloadBytes': len(wav), 'embeddedPayloadSha256': sha(wav)},
            'serializedExport': {'path': 'source/serialized.bin', 'bytes': len(raw), 'sha256': sha(raw)}}
        if name == 'sounds':
            source['nativePayload'] = {'path': 'source/native.bin', 'bytes': len(wav), 'sha256': sha(wav)}
            inventory = {'counts': {'packages': 1, 'sounds': 1, 'unsupportedPackages': 0, 'unsupportedSourceRecords': 0},
                         'packages': [{'source': package, 'status': 'enumerated'}], 'expectedInventoryMatch': True,
                         'sounds': [source], 'limitations': ['Synthetic source only.']}
        else:
            source['nativePayloadFile'] = 'source/native.bin'
            inventory = {'counts': {'declarations': 1, 'authoredReferences': 1, 'distinctReferences': 1, 'omittedReferences': 0},
                         'expectedInventoryMatch': True, 'objects': [{'status': 'authored-reference'}],
                         'sounds': [source], 'limitations': ['Synthetic source only.']}
        native_source = {'edition': 'interlude', 'package': 'Test', 'object': 'Test.tone', 'sha256': sha(b'src')}
        provenance = {'schemaVersion': 1, 'request': request, 'source': native_source,
            'dependencies': {'sound/Test.uax': sha(b'src')}, 'converterSha256': native_assets.implementation_hash(),
            'tool': {'sha256': native_assets.UMODEL_SHA256}, 'metadata': metadata}
        files = {'audio.wav': decoded, 'provenance.json': json_bytes(provenance)}
        asset = {'schemaVersion': 1, 'id': 'interlude:Test.tone', 'kind': 'audio', 'source': native_source,
            'audio': {'file': 'audio.wav'}, 'files': [{'path': key, 'sha256': sha(data), 'bytes': len(data),
                'mime': mime if key.endswith('.wav') else 'application/json'} for key, data in files.items()]}
        archive = native_assets.archive_bytes(asset, files)
        for key, data in {**files, 'asset.json': json_bytes(asset), 'asset.l2asset': archive}.items():
            write(self.output, 'asset/' + key, data)
        result = {identity: source[identity], 'status': 'exported-and-verified', 'products': {
            'archive': {'path': 'asset/asset.l2asset', 'bytes': len(archive), 'sha256': sha(archive)},
            'audio': {'path': 'asset/audio.wav', 'bytes': len(decoded), 'sha256': sha(decoded), 'mime': mime, 'metadata': metadata}}}
        if unsupported:
            result = {identity: source[identity], 'status': 'unsupported-codec', 'error': 'Synthetic unsupported codec.'}
        write(self.output, 'run.json', {'kind': 'native-staged-sound-products' if name == 'sounds' else 'native-map-ambient-audio-products',
            'recipeSha256': sha((self.root / 'recipes/request.json').read_bytes()), 'inputLockSha256': sha(self.lock.read_bytes()),
            'implementation': module.implementation()})
        write(self.output, 'inventory.json', inventory)
        write(self.output, 'coverage.json', module.coverage_document(inventory, [result]))
        self.audio_manifest()
        return self.job(name)

    def audio_manifest(self):
        rows = [{'path': path.relative_to(self.output).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
                for path in sorted(self.output.rglob('*')) if path.is_file() and path.name != 'SHA256-MANIFEST.json']
        write(self.output, 'SHA256-MANIFEST.json', {'schemaVersion': 1, 'files': rows})

    def rewrite_audio(self, name, inventory=None, results=None):
        inventory = inventory or json.loads((self.output / 'inventory.json').read_bytes())
        results = results or json.loads((self.output / 'coverage.json').read_bytes())['sounds']
        write(self.output, 'inventory.json', inventory)
        write(self.output, 'coverage.json', adapters._audio_module(name).coverage_document(inventory, results))
        self.audio_manifest()

    def migration(self, bundle=False):
        import native_migration
        if bundle:
            child_recipe = {'fixture': 'raw-map'}
            manifest = {'kind': 'native-map-raw', 'fixture': True}
            write(self.output, 'maps/map/manifest.json', manifest)
            write(self.output, 'maps/map/receipt.json', {'outputs': ['manifest.json'],
                'dependencies': {'sound/Test.uax': sha(b'src')}})
            rows = [{'id': 'map', 'support': 'raw-data-extracted', 'path': 'maps/map/manifest.json'}]
            validation = {'archives': [], 'bundles': [{'path': 'maps/map', 'kind': 'native-map-raw', 'verified': True}],
                          'passed': True, 'errors': []}
            job = {'id': 'map', 'adapter': 'map', 'recipe': 'recipes/child.json'}
        else:
            target, _, asset = self.asset()
            child_recipe = json.loads((self.root / 'recipes/request.json').read_bytes())
            archive = target / 'asset.l2asset'
            relative = archive.relative_to(self.output).as_posix()
            rows = [{'id': 'asset:0', 'support': 'converted', 'path': relative}]
            validation = {'archives': [{'path': relative, 'id': asset['id'], 'kind': asset['kind'], 'archiveVerified': True,
                'sha256': sha(archive.read_bytes()), 'bytes': archive.stat().st_size}], 'bundles': [], 'errors': [], 'passed': True}
            job = {'id': 'asset', 'adapter': 'assets', 'recipe': 'recipes/child.json'}
        write(self.root, 'recipes/child.json', child_recipe)
        write(self.root, 'recipes/acceptance.json', {'fixture': 'unchanged-tolerances'})
        recipe = {'schemaVersion': 1, 'sourceManifest': 'recipes/lock.json', 'acceptance': 'recipes/acceptance.json', 'jobs': [job]}
        write(self.root, 'recipes/request.json', recipe)
        write(self.output, 'coverage.json', {'migrationRecipe': recipe, 'sourceManifestSha256': sha(self.lock.read_bytes()),
            'acceptanceSha256': sha((self.root / 'recipes/acceptance.json').read_bytes()),
            'recipePins': {'recipes/child.json': sha((self.root / 'recipes/child.json').read_bytes())}, 'jobs': rows,
            'unsupportedPackages': [], 'deferred': ['Synthetic migration only.']})
        write(self.output, 'validation.json', validation)
        write(self.output, 'products.json', native_migration.product_files(self.output))
        return self.job('migration')

    def sky(self):
        source = {'converterSha256': sha((ROOT / 'scripts/native_sky.py').read_bytes()),
            'ddsWrapperSha256': sha((ROOT / 'scripts/native_assets_lib/texture_dds.py').read_bytes()),
            'mapSha256': sha(b'map'), 'skyPackageSha256': sha(b'sky'), 'enginePackageSha256': sha(b'engine')}
        snapshot = {'kind': 'native-sky-source-snapshot', 'id': 'synthetic-sky', 'source': source, 'parts': [
            {'nodeRanges': [1], 'positions': [0, 0, 0, 1, 0, 0, 0, 1, 0], 'indices': [0, 1, 2],
             'texture': {'sourceReference': 'Test.WhiteCloud'}}]}
        write(self.output, 'sky.json', snapshot)
        write(self.output, 'sky.glb', b'synthetic-integrity-fixture-not-a-rendering-test')
        products = {name: {'sha256': sha((self.output / name).read_bytes()), 'bytes': (self.output / name).stat().st_size}
                    for name in ('sky.json', 'sky.glb')}
        write(self.output, 'manifest.json', {'schemaVersion': 1, 'kind': 'native-sky-source-bundle', 'id': snapshot['id'],
            'source': source, 'files': products, 'counts': {'nodes': 1, 'vertices': 3, 'triangles': 1, 'materialRoots': 1, 'textures': 1},
            'limitations': ['Synthetic integrity fixture; no geometry validation or render claim.']})
        write(self.root, 'recipes/lock.json', {'schemaVersion': 1, 'files': [
            {'relativePath': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in [
                ('maps/20_20.unr', b'map'), ('textures/l2_skies.utx', b'sky'), ('system/Engine.u', b'engine')]]})
        return self.job('sky')

    def test_six_named_adapters_have_no_arbitrary_shell_or_staging_fields(self):
        for adapter in adapters.ADAPTERS:
            with self.subTest(adapter=adapter):
                adapters.validate_job(self.job(adapter))
        for value in ['stage', 'native-launch', ['assets'], None]:
            with self.subTest(adapter=value), self.assertRaises(ValueError):
                adapters.validate_job(self.job(value))
        for key, value in [('argv', ['--stage-runtime']), ('script', 'evil.py'), ('command', 'cmd'), ('stage', True)]:
            with self.subTest(field=key), self.assertRaises(ValueError):
                adapters.validate_job(self.job(**{key: value}))

    def test_only_supported_job_specific_fields_are_admitted(self):
        for job in [self.job('sky', recipe='recipes/a.json'), self.job('environment', recipe='recipes/a.json'),
                    self.job(files=['Env.int']), {k: v for k, v in self.job().items() if k != 'recipe'},
                    self.job('environment', files=[]), self.job('environment', files=['../test.int']),
                    self.job('environment', files=['Env.int', 'env.int']), self.job(dependsOn=['fixture']),
                    self.job(dependsOn=['other', 'other']), self.job(id='../outside')]:
            with self.subTest(job=job), self.assertRaises(ValueError): adapters.validate_job(job)

    def test_windows_path_forms_cannot_escape_or_alias_products(self):
        for name in ['../x', '/x', 'C:/x', 'x\\y', 'x//y', 'CON.txt', 'x/NUL', 'x:stream', 'name.', 'name ', 'x/./y']:
            with self.subTest(path=name), self.assertRaises(ValueError): adapters.relative_name(name)

    def test_command_argv_for_all_adapters_is_fixed_and_offline(self):
        scripts = {'assets': 'native_assets.py', 'migration': 'native_migration.py', 'environment': 'export-native-environment.py',
                   'sky': 'native_sky.py', 'sounds': 'export-native-sounds.py', 'ambient': 'export-native-map-audio.py'}
        for filename in scripts.values(): write(self.root, 'scripts/' + filename, b'# fixture')
        write(self.root, 'recipes/request.json', [])
        for adapter in ['assets', 'environment', 'sky', 'sounds', 'ambient']:
            job = self.job(adapter)
            if adapter == 'environment': job['files'] = ['test.int']
            argv = adapters.command(job, self.source, self.lock, self.output, self.root)
            self.assertEqual(argv[:3], [sys.executable, '-B', str(self.root / 'scripts' / scripts[adapter])])
            self.assertNotIn('--stage-runtime', argv); self.assertNotIn('--fleet-stage', argv)
            self.assertIn(str(self.output), argv)
        migration = {'schemaVersion': 1, 'sourceManifest': 'recipes/lock.json', 'acceptance': 'recipes/acceptance.json',
                     'jobs': [{'id': 'one', 'adapter': 'assets', 'recipe': 'recipes/child.json'}]}
        write(self.root, 'recipes/request.json', migration)
        write(self.root, 'recipes/acceptance.json', {'fixture': True})
        write(self.root, 'recipes/child.json', [])
        paths = adapters.recipe_paths(self.job('migration'), self.root)
        self.assertEqual({p.name for p in paths}, {'request.json', 'lock.json', 'acceptance.json', 'child.json'})
        argv = adapters.command(self.job('migration'), self.source, self.lock, self.output, self.root)
        self.assertNotIn('--verify-only', argv)
        other = write(self.root, 'recipes/other.json', {'schemaVersion': 1, 'files': []})
        with self.assertRaisesRegex(ValueError, 'source lock differs'):
            adapters.command(self.job('migration'), self.source, other, self.output, self.root)

    def test_duplicate_json_keys_are_not_silently_selected(self):
        path = write(self.root, 'bad.json', b'{"schemaVersion":1,"schemaVersion":2}')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'): adapters.read_json(path)

    def test_asset_collector_uses_exact_request_index_and_preserves_scope(self):
        target, index, manifest = self.asset()
        write(self.output, '.work/ignored/failure.txt', b'historical diagnostics')
        result = adapters.collect(self.job(), self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['counts'], {'audioAssets': 1, 'animationEvents': 0, 'requestedAssets': 1})
        self.assertEqual(result['sourceDependencies'], {'sound/Test.uax': sha(b'src')})
        self.assertIn(index.relative_to(self.output).as_posix(), result['products'])
        self.assertNotIn('.work/ignored/failure.txt', result['products'])
        self.assertTrue(any('no browser staging' in row for row in result['limits']))
        self.assertEqual(json.loads((target / 'asset.json').read_bytes()), manifest)

    def test_changed_request_cannot_reuse_unrelated_cached_output(self):
        self.asset()
        write(self.root, 'recipes/request.json', [{'kind': 'audio', 'package': 'Test', 'object': 'other'}])
        with self.assertRaisesRegex(ValueError, 'Missing/escaped regular file'):
            adapters.collect(self.job(), self.output, self.lock, self.root)

    def test_loose_archive_or_source_corruption_is_fatal(self):
        target, index, _ = self.asset()
        (target / 'audio.wav').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'hash differs'):
            adapters.collect(self.job(), self.output, self.lock, self.root)

    def test_wrong_source_lock_is_fatal_even_when_archive_bytes_are_valid(self):
        self.asset()
        write(self.root, 'recipes/lock.json', {'schemaVersion': 1, 'files': [
            {'relativePath': 'sound/Test.uax', 'bytes': 3, 'sha256': '0' * 64}]})
        with self.assertRaisesRegex(ValueError, 'source dependency'):
            adapters.collect(self.job(), self.output, self.lock, self.root)

    def test_content_index_must_list_required_products(self):
        _, index, _ = self.asset()
        value = json.loads(index.read_bytes()); del value['outputs']['asset.l2asset']; index.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'lacks required products'):
            adapters.collect(self.job(), self.output, self.lock, self.root)

    def test_environment_collect_reconstructs_exact_products_without_writes(self):
        job = self.environment()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()}
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['counts']['physicalColorRows'], 1)
        self.assertEqual(len(result['products']), 6)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()})

    def test_environment_count_anomaly_is_preserved_not_dropped(self):
        job = self.environment(b'[SkyBoxColor]\nNUM=1\nCOLOR1=(T=0,R=1,G=2,B=3)\nCOLOR2=(T=12,R=66,G=124,B=176)\n')
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['counts']['physicalColorRows'], 2)
        self.assertGreater(result['counts']['anomalies'], 0)

    def test_environment_unsupported_syntax_is_partial_not_success(self):
        job = self.environment(b'[SkyBoxColor]\nNUM=1\nCOLOR1=(invalid)\n')
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'partial')
        self.assertTrue(result['unsupported'])

    def test_environment_derived_table_or_implementation_tamper_fails(self):
        job = self.environment()
        path = self.output / 'sky-tables.json'
        value = json.loads(path.read_bytes()); value['physicalColorRows'] = 999; path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'reconstructed product differs'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_wrong_environment_product_kind_fails(self):
        job = self.environment()
        path = self.output / 'manifest.json'; value = json.loads(path.read_bytes()); value['kind'] = 'other'; path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Wrong environment'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_missing_product_output_is_not_inferred_from_exit_status(self):
        for adapter in ['environment', 'sky', 'sounds', 'ambient', 'migration']:
            with self.subTest(adapter=adapter), self.assertRaises((ValueError, FileNotFoundError)):
                adapters.collect(self.job(adapter), self.output, self.lock, self.root)

    def test_missing_or_unpinned_external_tool_is_rejected_before_command_run(self):
        tool = write(self.root, 'tool.exe', b'wrong-tool')
        with patch.object(native_assets, 'UMODEL', tool), self.assertRaisesRegex(ValueError, 'UModel differs'):
            adapters.adapter_pins('assets')

    def test_every_adapter_pins_only_files_that_exist(self):
        for adapter in sorted(adapters.ADAPTERS):
            with self.subTest(adapter=adapter):
                pinned_files = [name for name in adapters.adapter_pins(adapter) if name.startswith('scripts/')]
                self.assertTrue(pinned_files)
                self.assertEqual([name for name in pinned_files if not (ROOT / name).is_file()], [])

    def test_environment_pins_are_current_concrete_files(self):
        pins = adapters.adapter_pins('environment')
        self.assertEqual(pins['scripts/native_environment.py'], sha((ROOT / 'scripts/native_environment.py').read_bytes()))
        self.assertIn('scripts/export-native-environment.py', pins)

    def test_case_colliding_source_lock_fails_before_collector(self):
        self.asset()
        row = {'relativePath': 'sound/Test.uax', 'bytes': 3, 'sha256': sha(b'src')}
        write(self.root, 'recipes/lock.json', {'schemaVersion': 1, 'files': [row, {**row, 'relativePath': 'SOUND/test.uax'}]})
        with self.assertRaisesRegex(ValueError, 'duplicate locked source'):
            adapters.collect(self.job(), self.output, self.lock, self.root)

    def test_sound_collector_joins_serialized_native_and_decoded_payloads_without_writes(self):
        job = self.audio()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()}
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['counts']['exportedSounds'], 1)
        self.assertEqual(result['sourceDependencies'], {'sound/Test.uax': sha(b'src')})
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()})

    def test_ambient_collector_uses_reference_identity_and_preserves_omission_limit(self):
        job = self.audio('ambient')
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['counts']['exportedSounds'], 1)
        self.assertTrue(any('no browser staging' in row for row in result['limits']))

    def test_missing_ambient_identity_does_not_vacuously_equal_none(self):
        job = self.audio('ambient')
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        results = json.loads((self.output / 'coverage.json').read_bytes())['sounds']
        del inventory['sounds'][0]['referenceKey']; del results[0]['referenceKey']
        self.rewrite_audio('ambient', inventory, results)
        with self.assertRaisesRegex(ValueError, 'source/result identity'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_identity_mismatch_is_rejected_even_with_rehashed_outer_receipts(self):
        job = self.audio()
        results = json.loads((self.output / 'coverage.json').read_bytes())['sounds']
        results[0]['stableId'] = 'other-source'
        self.rewrite_audio('sounds', results=results)
        with self.assertRaisesRegex(ValueError, 'source/result identity'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_wrong_source_object_is_rejected_even_with_rehashed_receipts(self):
        job = self.audio()
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        inventory['sounds'][0]['export']['object'] = 'Test.different'
        self.rewrite_audio('sounds', inventory)
        with self.assertRaisesRegex(ValueError, 'archive identity'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_wrong_native_export_index_is_rejected(self):
        job = self.audio()
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        inventory['sounds'][0]['nativeSound']['exportIndex'] = 4
        self.rewrite_audio('sounds', inventory)
        with self.assertRaisesRegex(ValueError, 'payload/export-index join'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_serialized_payload_corruption_is_rejected_despite_new_hashes(self):
        job = self.audio()
        path = self.output / 'source/serialized.bin'
        data = path.read_bytes().replace(b'RIFF', b'RIFX'); path.write_bytes(data)
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        inventory['sounds'][0]['serializedExport']['sha256'] = sha(data)
        self.rewrite_audio('sounds', inventory)
        with self.assertRaisesRegex(ValueError, 'retained serialized'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_native_payload_corruption_is_rejected_despite_new_manifest(self):
        job = self.audio('ambient')
        path = self.output / 'source/native.bin'; path.write_bytes(path.read_bytes()[:-2] + b'xx')
        self.audio_manifest()
        with self.assertRaisesRegex(ValueError, 'payload/export-index join'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_audio_unsupported_rows_are_partial_not_converted(self):
        job = self.audio(unsupported=True)
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['counts']['exportedSounds'], 0)
        self.assertEqual(result['unsupported'][0]['status'], 'unsupported-codec')

    def test_sky_collector_checks_source_snapshot_and_derived_counts(self):
        job = self.sky()
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['counts'], {'nodes': 1, 'vertices': 3, 'triangles': 1, 'materialRoots': 1, 'textures': 1})
        self.assertEqual(set(result['sourceDependencies']), {'maps/20_20.unr', 'textures/l2_skies.utx', 'system/Engine.u'})

    def test_sky_inflated_coverage_is_rejected(self):
        job = self.sky()
        path = self.output / 'manifest.json'; value = json.loads(path.read_bytes()); value['counts']['vertices'] += 1
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'coverage counts differ'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_sky_stale_converter_pin_is_rejected(self):
        job = self.sky()
        path = self.output / 'manifest.json'; value = json.loads(path.read_bytes()); value['source']['converterSha256'] = '0' * 64
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'snapshot identity differs'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_migration_collector_uses_active_archives_and_never_calls_writing_validator(self):
        import native_migration
        job = self.migration()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()}
        with patch.object(native_migration, 'validate_products', side_effect=AssertionError('Writing validator called')):
            result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'converted'); self.assertEqual(result['counts']['audioAssets'], 1)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.rglob('*') if p.is_file()})

    def test_migration_bundle_collection_checks_saved_validation_identity(self):
        job = self.migration(bundle=True)
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['counts']['bundleCount'], 1)
        path = self.output / 'validation.json'; value = json.loads(path.read_bytes()); value['bundles'][0]['kind'] = 'wrong'
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'bundle validation identity'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_migration_bare_pass_without_per_archive_validation_is_rejected(self):
        job = self.migration()
        write(self.output, 'validation.json', {'passed': True, 'errors': [], 'archives': [], 'bundles': []})
        with self.assertRaisesRegex(ValueError, 'archive validation coverage'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_migration_changed_archive_validation_hash_is_rejected(self):
        job = self.migration()
        path = self.output / 'validation.json'; value = json.loads(path.read_bytes()); value['archives'][0]['sha256'] = '0' * 64
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'archive validation identity'):
            adapters.collect(job, self.output, self.lock, self.root)

    def test_migration_unrelated_unsupported_packages_keep_partial_status(self):
        job = self.migration()
        path = self.output / 'coverage.json'; value = json.loads(path.read_bytes())
        value['unsupportedPackages'] = [{'status': 'unsupported-package', 'source': 'fixture'}]; path.write_bytes(json_bytes(value))
        result = adapters.collect(job, self.output, self.lock, self.root)
        self.assertEqual(result['status'], 'partial'); self.assertEqual(len(result['unsupported']), 1)


if __name__ == '__main__':
    unittest.main()
