"""Migration receipt integrity, current-job coverage and cache-history isolation."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes, hash_file, sha, implementation_hash as converter_hash, UMODEL_SHA256
from native_assets_lib.gltf import json_bytes
from native_migration import active_products, check_coverage, dependency_pins, load_recipe, product_files, receipt_dependencies, validate_products
from native_map_geometry import implementation_hash as geometry_hash, verify_section_runtime


class MigrationIntegrityTests(unittest.TestCase):
    def test_active_dispatch_job_has_a_separate_output_and_pinned_binary_dependency(self):
        recipe = load_recipe(ROOT / 'recipes/native-migration.json')
        jobs = [job for job in recipe['jobs'] if job['recipe'] == 'recipes/native-power-strike.json']
        self.assertEqual(jobs, [{'id': 'power-strike-source-dispatch', 'adapter': 'effect',
                                'recipe': 'recipes/native-power-strike.json'}])
        effect = json.loads((ROOT / jobs[0]['recipe']).read_text())
        binary = effect['sourceDispatch']['binary']
        manifest = json.loads((ROOT / recipe['sourceManifest']).read_text())
        matches = [entry for entry in manifest['files']
                   if entry['relativePath'].casefold() == binary['path'].casefold()]
        self.assertEqual(matches, [{'relativePath': binary['path'], 'bytes': binary['bytes'],
                                   'sha256': binary['sha256']}])
        dependencies = receipt_dependencies({'sourceFiles': [binary]})
        dependency_pins(dependencies, manifest)
        with self.assertRaisesRegex(ValueError, 'outside the pinned fleet snapshot'):
            dependency_pins(dependencies, {'files': []})
        with self.assertRaisesRegex(ValueError, 'outside the pinned fleet snapshot'):
            dependency_pins(dependencies, {'files': [{**matches[0], 'sha256': '0' * 64}]})

    def fixture(self, root, dependencies=None):
        output = root / 'artifacts/migration'
        client = root / 'source'
        client.mkdir(parents=True)
        payload = b'unchanged source fixture'
        (client / 'sample.wav').write_bytes(payload)
        manifest = {'files': [{'relativePath': 'sample.wav', 'sha256': sha(payload), 'bytes': len(payload)}]}
        dependencies = {'sample.wav': sha(payload)} if dependencies is None else dependencies
        files = {'audio.wav': payload, 'provenance.json': json_bytes({'dependencies': dependencies})}
        asset = {'schemaVersion': 1, 'id': 'interlude:fixture', 'kind': 'audio',
                 'audio': {'file': 'audio.wav'},
                 'files': [{'path': name, 'bytes': len(value), 'sha256': sha(value)} for name, value in files.items()]}
        archive = archive_bytes(asset, files)
        target = output / 'assets' / sha(archive)
        target.mkdir(parents=True)
        (target / 'asset.l2asset').write_bytes(archive)
        (target / 'asset.json').write_bytes(json_bytes(asset))
        for name, value in files.items():
            (target / name).write_bytes(value)
        (root / 'recipes').mkdir()
        (root / 'recipes/assets.json').write_bytes(json_bytes([{'kind': 'audio', 'media': 'sample.wav'}]))
        (root / 'recipes/inputs.json').write_bytes(json_bytes(manifest))
        (root / 'recipes/acceptance.json').write_bytes(json_bytes({'purpose': 'raw migration fixture'}))
        recipe = {'schemaVersion': 1, 'sourceManifest': 'recipes/inputs.json', 'acceptance': 'recipes/acceptance.json',
                  'jobs': [{'id': 'audio', 'adapter': 'assets', 'recipe': 'recipes/assets.json'}]}
        coverage = {'migrationRecipe': recipe, 'sourceManifestSha256': hash_file(root / recipe['sourceManifest']),
                    'acceptanceSha256': hash_file(root / recipe['acceptance']),
                    'recipePins': {'recipes/assets.json': hash_file(root / 'recipes/assets.json')},
                    'jobs': [{'id': 'audio:0', 'support': 'converted', 'path': (target / 'asset.l2asset').relative_to(output).as_posix()}]}
        (output / 'coverage.json').write_bytes(json_bytes(coverage))
        return output, client, manifest, target, recipe, coverage

    def test_verified_archive_and_every_unpacked_member_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, client, manifest, _, recipe, _ = self.fixture(root)
            with patch('native_migration.ROOT', root):
                check_coverage(recipe, output)
            result = validate_products(output, client, manifest)
            self.assertTrue(result['passed'], result)
            self.assertEqual(len(result['archives']), 1)
            self.assertEqual(len(product_files(output)), 1)

    def test_external_manifest_cannot_hide_corrupted_or_missing_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            output, client, manifest, target, _, _ = self.fixture(Path(directory))
            asset = json.loads((target / 'asset.json').read_text())
            asset['files'] = []
            (target / 'asset.json').write_bytes(json_bytes(asset))
            (target / 'audio.wav').write_bytes(b'corruption hidden by empty file list')
            result = validate_products(output, client, manifest)
            self.assertFalse(result['passed'])
            self.assertIn('Unpacked file differs', result['errors'][0]['error'])

    def test_external_provenance_cannot_erase_source_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            output, client, manifest, target, _, _ = self.fixture(Path(directory))
            (target / 'provenance.json').write_bytes(json_bytes({'dependencies': {}}))
            result = validate_products(output, client, manifest)
            self.assertFalse(result['passed'])
            self.assertIn('provenance.json', result['errors'][0]['error'])

    def test_undeclared_or_changed_source_dependency_is_rejected(self):
        for dependencies in ({'outside.wav': 'a' * 64}, {'sample.wav': 'b' * 64}):
            with self.subTest(dependencies=dependencies), tempfile.TemporaryDirectory() as directory:
                output, client, manifest, _, _, _ = self.fixture(Path(directory), dependencies)
                result = validate_products(output, client, manifest)
                self.assertFalse(result['passed'])
                self.assertIn('outside the pinned fleet snapshot', result['errors'][0]['error'])

    def test_superseded_corrupt_archive_does_not_enter_current_products(self):
        with tempfile.TemporaryDirectory() as directory:
            output, client, manifest, target, _, _ = self.fixture(Path(directory))
            old = output / 'assets/obsolete'
            old.mkdir()
            (old / 'asset.l2asset').write_bytes(b'old corrupt cache entry is not an active product')
            self.assertEqual(list(product_files(output)), [(target / 'asset.l2asset').relative_to(output).as_posix()])
            self.assertTrue(validate_products(output, client, manifest)['passed'])

    def test_empty_missing_duplicate_failed_or_unsupported_coverage_is_rejected(self):
        for mode in ('empty', 'wrong-id', 'duplicate', 'failed', 'unsupported'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                output, _, _, _, recipe, coverage = self.fixture(root)
                if mode == 'empty':
                    coverage['jobs'] = []
                elif mode == 'wrong-id':
                    coverage['jobs'][0]['id'] = 'unrequested:0'
                elif mode == 'duplicate':
                    coverage['jobs'].append(dict(coverage['jobs'][0]))
                elif mode == 'failed':
                    coverage['jobs'][0]['support'] = 'failed'
                else:
                    coverage['jobs'][0]['unsupported'] = ['native feature has no adapter']
                (output / 'coverage.json').write_bytes(json_bytes(coverage))
                with patch('native_migration.ROOT', root), self.assertRaises(ValueError):
                    check_coverage(recipe, output)

    def test_current_recipe_acceptance_and_source_pins_must_match(self):
        for relative in ('recipes/assets.json', 'recipes/inputs.json', 'recipes/acceptance.json'):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                output, _, _, _, recipe, _ = self.fixture(root)
                (root / relative).write_bytes(b'changed file')
                with patch('native_migration.ROOT', root), self.assertRaisesRegex(ValueError, 'pin changed'):
                    check_coverage(recipe, output)

    def test_changed_job_plan_is_rejected_even_with_previous_products_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, _, _, _, recipe, _ = self.fixture(root)
            recipe['jobs'][0]['id'] = 'different-request'
            with patch('native_migration.ROOT', root), self.assertRaisesRegex(ValueError, 'recipe differs'):
                check_coverage(recipe, output)

    def test_dependency_checks_accept_map_dictionary_hash_records(self):
        manifest = {'files': [{'relativePath': 'maps/20_20.unr', 'sha256': 'a' * 64}]}
        dependency_pins({'maps/20_20.unr': {'sha256': 'a' * 64, 'bytes': 10}}, manifest)
        with self.assertRaises(ValueError):
            dependency_pins({'maps/20_20.unr': {'sha256': 'b' * 64}}, manifest)

    def section_fixture(self, root):
        output, client, manifest, _, recipe, coverage = self.fixture(root)
        for name in ('map', 'section'):
            (root / ('recipes/'+name+'.json')).write_bytes(json_bytes({'fixture': name}))
        recipe['jobs'].extend([
            {'id': 'map', 'adapter': 'map', 'recipe': 'recipes/map.json'},
            {'id': 'section', 'adapter': 'map-section', 'mapJob': 'map', 'recipe': 'recipes/section.json'}])
        coverage['recipePins'].update({job['recipe']: hash_file(root/job['recipe']) for job in recipe['jobs']})
        raw, geometry, models, runtime = (output/'maps/map', output/'sections/section/map-section',
            output/'sections/section/map-section-models', output/'sections/section/map-section-runtime')
        for path in (raw, geometry, models, runtime):
            path.mkdir(parents=True)
        dependencies = {'sample.wav': manifest['files'][0]['sha256']}
        (raw/'manifest.json').write_bytes(json_bytes({'kind': 'native-map-raw'}))
        (raw/'receipt.json').write_bytes(json_bytes({'outputs': {'manifest.json': hash_file(raw/'manifest.json')}, 'dependencies': dependencies}))
        (geometry/'terrain.glb').write_bytes(b'terrain resource integrity fixture')
        (geometry/'manifest.json').write_bytes(json_bytes({'kind': 'native-terrain-section'}))
        (geometry/'receipt.json').write_bytes(json_bytes({'kind': 'native-terrain-section', 'sourceDependencies': dependencies,
            'outputs': {name: hash_file(geometry/name) for name in ('manifest.json', 'terrain.glb')}}))
        payloads = {'model.glb': b'static model resource integrity fixture', 'provenance.json': json_bytes({'dependencies': dependencies})}
        asset = {'schemaVersion': 1, 'id': 'interlude:static-fixture', 'kind': 'model', 'model': {'file': 'model.glb'},
            'files': [{'path': name, 'sha256': sha(value), 'bytes': len(value)} for name, value in payloads.items()]}
        packed = archive_bytes(asset, payloads)
        folder = models/sha(packed)
        folder.mkdir()
        (folder/'asset.l2asset').write_bytes(packed)
        (folder/'asset.json').write_bytes(json_bytes(asset))
        for name, value in payloads.items():
            (folder/name).write_bytes(value)
        def resource(path, base):
            return {'file': path.relative_to(base).as_posix(), 'sha256': hash_file(path), 'bytes': path.stat().st_size}
        section_manifest = {'kind': 'native-map-section-runtime', 'resourceRoots': {'terrain': '../map-section', 'models': '../map-section-models'},
            'terrain': resource(geometry/'terrain.glb', geometry), 'models': [{'id': asset['id'],
            'archive': resource(folder/'asset.l2asset', models), 'model': resource(folder/'model.glb', models)}],
            'placements': [{'modelId': asset['id']}], 'errors': [], 'support': 'section-products-ready-for-runtime-validation'}
        (runtime/'manifest.json').write_bytes(json_bytes(section_manifest))
        (runtime/'receipt.json').write_bytes(json_bytes({'kind': 'native-map-section-runtime',
            'implementationSha256': geometry_hash(), 'converterImplementationSha256': converter_hash(), 'umodelSha256': UMODEL_SHA256,
            'sectionReceiptSha256': hash_file(geometry/'receipt.json'), 'manifestSha256': hash_file(runtime/'manifest.json'),
            'modelArchives': {section_manifest['models'][0]['archive']['file']: sha(packed)}}))
        coverage['jobs'].extend([{'id': 'map', 'support': 'raw-data-extracted', 'path': 'maps/map/manifest.json'},
            {'id': 'section', 'adapter': 'map-section', 'support': section_manifest['support'],
             'path': 'sections/section/map-section-runtime/manifest.json', 'geometryPath': 'sections/section/map-section/manifest.json',
             'sourceMapJob': 'map', 'sourceMapPath': 'maps/map/manifest.json'}])
        (output/'coverage.json').write_bytes(json_bytes(coverage))
        return output, client, manifest, recipe, coverage, raw, geometry, models, runtime, folder

    def test_section_recipe_requires_an_earlier_raw_map_dependency(self):
        for mode in ('valid', 'missing', 'later', 'wrong-adapter', 'unknown'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _, _, _, recipe, _, *_ = self.section_fixture(root)
                if mode == 'missing':
                    del recipe['jobs'][-1]['mapJob']
                elif mode == 'later':
                    recipe['jobs'][-2:] = reversed(recipe['jobs'][-2:])
                elif mode == 'wrong-adapter':
                    recipe['jobs'][-2]['adapter'] = 'effect'
                elif mode == 'unknown':
                    recipe['jobs'][-1]['mapJob'] = 'absent'
                path = root/'recipes/migration.json'
                path.write_bytes(json_bytes(recipe))
                with patch('native_migration.ROOT', root):
                    if mode == 'valid':
                        self.assertEqual(load_recipe(path), recipe)
                    else:
                        with self.assertRaisesRegex(ValueError, 'earlier raw-map'):
                            load_recipe(path)

    def test_section_products_include_geometry_runtime_and_selected_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, _, _, recipe, _, raw, geometry, _, runtime, folder = self.section_fixture(root)
            with patch('native_migration.ROOT', root):
                check_coverage(recipe, output)
            archives, bundles = active_products(output)
            self.assertIn(folder/'asset.l2asset', archives)
            self.assertEqual(bundles, sorted([raw, geometry, runtime]))
            products = product_files(output)
            self.assertEqual(len(products), 9)
            for path in (geometry/'terrain.glb', geometry/'receipt.json', runtime/'receipt.json', runtime/'manifest.json', folder/'asset.l2asset'):
                self.assertEqual(products[path.relative_to(output).as_posix()], hash_file(path))
            (output/'run.json').write_bytes(json_bytes({'cacheHit': True}))
            self.assertEqual(products, product_files(output))

    def test_section_coverage_cannot_omit_failure_or_change_product_dependency(self):
        for mode in ('missing-row', 'failed', 'partial', 'errors', 'wrong-map', 'missing-map-path', 'wrong-geometry-path', 'escape-runtime'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                output, _, _, recipe, coverage, *_ = self.section_fixture(root)
                row = coverage['jobs'][-1]
                if mode == 'missing-row':
                    coverage['jobs'].pop()
                elif mode in ('failed', 'partial'):
                    row['support'] = mode
                elif mode == 'errors':
                    row['unsupported'] = [{'sourceObject': 'missing.mesh', 'error': 'unsupported'}]
                elif mode == 'wrong-map':
                    row.update(sourceMapJob='other', sourceMapPath='maps/other/manifest.json')
                elif mode == 'missing-map-path':
                    del row['sourceMapPath']
                elif mode == 'wrong-geometry-path':
                    row['geometryPath'] = 'sections/other/map-section/manifest.json'
                else:
                    row['path'] = '../outside/manifest.json'
                (output/'coverage.json').write_bytes(json_bytes(coverage))
                with patch('native_migration.ROOT', root), self.assertRaises(ValueError):
                    check_coverage(recipe, output)

    def test_section_geometry_source_dependencies_must_belong_to_pinned_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            _, _, manifest, _, _, _, geometry, _, _, _ = self.section_fixture(Path(directory))
            receipt = json.loads((geometry/'receipt.json').read_text())
            dependency_pins(receipt_dependencies(receipt), manifest)
            receipt['sourceDependencies']['undeclared/Engine.u'] = 'f'*64
            with self.assertRaisesRegex(ValueError, 'outside the pinned fleet snapshot'):
                dependency_pins(receipt_dependencies(receipt), manifest)

    def test_section_runtime_rejects_missing_or_corrupt_render_resources(self):
        # Geometry decoding is tested separately with the real source fixture;
        # this test isolates runtime links and archive/resource integrity.
        for resource in ('terrain', 'model', 'archive', 'manifest', 'geometry-receipt'):
            for missing in (False, True):
                with self.subTest(resource=resource, missing=missing), tempfile.TemporaryDirectory() as directory:
                    _, client, _, _, _, raw, geometry, models, runtime, folder = self.section_fixture(Path(directory))
                    with patch('native_map_geometry.verify_geometry'):
                        self.assertTrue(verify_section_runtime(client, raw, geometry, models, runtime)['verified'])
                        path = {'terrain': geometry/'terrain.glb', 'model': folder/'model.glb', 'archive': folder/'asset.l2asset',
                            'manifest': runtime/'manifest.json', 'geometry-receipt': geometry/'receipt.json'}[resource]
                        if missing:
                            path.unlink()
                        else:
                            path.write_bytes(path.read_bytes()+b'changed')
                        with self.assertRaises((ValueError, OSError)):
                            verify_section_runtime(client, raw, geometry, models, runtime)


if __name__ == '__main__':
    unittest.main()
