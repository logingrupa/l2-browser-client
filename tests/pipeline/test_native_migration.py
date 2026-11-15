import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes, hash_file, sha
from native_assets_lib.gltf import json_bytes
from native_migration import check_coverage, dependency_pins, load_recipe, product_files, receipt_dependencies, validate_products
from native_assets_lib.material_graph import POLICY as MATERIAL_GRAPH_POLICY

SEALED_TWENTY_TWENTY_STATIC_MESH_REQUESTS = ROOT / 'artifacts/lane-store/world/work/tile__20_20/raw/products/static-mesh-requests.json'


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

    def test_load_recipe_refuses_the_retired_map_and_map_section_adapters(self):
        for adapter in ('map', 'map-section'):
            with self.subTest(adapter=adapter), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _, _, _, _, recipe, _ = self.fixture(root)
                recipe['jobs'].append({'id': 'retired-map-job', 'adapter': adapter, 'recipe': 'recipes/assets.json'})
                recipe_path = root / 'recipes/migration.json'
                recipe_path.write_bytes(json_bytes(recipe))
                with patch('native_migration.ROOT', root), self.assertRaisesRegex(ValueError, 'Unknown migration adapter: ' + adapter):
                    load_recipe(recipe_path)


class CommittedMigrationRecipeTests(unittest.TestCase):
    def setUp(self):
        self.recipe = load_recipe(ROOT / 'recipes/native-migration.json')

    def material_policy_requests(self):
        return [request for job in self.recipe['jobs'] if job['adapter'] == 'assets'
                for request in json.loads((ROOT / job['recipe']).read_text(encoding='utf-8')) if 'materialPolicy' in request]

    def test_the_map_jobs_are_gone_and_the_flame_job_follows_the_terrain_textures(self):
        identities = [job['id'] for job in self.recipe['jobs']]
        self.assertNotIn('map-20-20', identities)
        self.assertNotIn('map-20-20-section', identities)
        self.assertEqual(identities[identities.index('map-20-20-textures') + 1], 'flame-native-material-graph')

    def test_exactly_one_request_keeps_the_native_material_graph_and_it_is_the_flame_model(self):
        requests = self.material_policy_requests()
        self.assertEqual(requests, [{'kind': 'model', 'object': 'FX_E_S.Flameset.Default_Flame01', 'package': 'staticmeshes/FX_E_S.usx',
                                     'materialPolicy': MATERIAL_GRAPH_POLICY}])

    @unittest.skipUnless(SEALED_TWENTY_TWENTY_STATIC_MESH_REQUESTS.is_file(), 'the sealed 20_20 raw unit is not present in this checkout')
    def test_the_flame_request_names_the_package_and_object_of_the_sealed_20_20_raw_request(self):
        flame = self.material_policy_requests()[0]
        raw_requests = json.loads(SEALED_TWENTY_TWENTY_STATIC_MESH_REQUESTS.read_text(encoding='utf-8'))
        matches = [request for request in raw_requests if request['object'] == flame['object']]
        self.assertEqual(len(matches), 1)
        self.assertEqual({key: flame[key] for key in ('kind', 'package', 'object')}, matches[0])

if __name__ == '__main__':
    unittest.main()
