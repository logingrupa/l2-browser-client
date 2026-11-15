import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import stage_native_runtime as staging
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from runtime_staging_fixture import RuntimeStagingFixture, sha

UNSTAGED_SLICE_RECORDS = {
    'sections': [{'id': 'map-20-20-section', 'manifest': '/l2/maps/' + 'a' * 64 + '/map-section-runtime/manifest.json', 'manifestSha256': 'a' * 64}],
    'movers': [{'id': 'map-20-20-movers', 'manifest': '/l2/movers/' + 'b' * 64 + '/movers.json', 'manifestSha256': 'b' * 64}],
    'worldAudio': [{'id': 'map-20-20-music', 'kind': 'native-map-music', 'manifest': '/l2/world-audio/' + 'c' * 64 + '/manifest.json',
                    'manifestBytes': 10, 'manifestSha256': 'c' * 64}],
    'animationAudio': [{'id': 'stepsound-surfaces', 'manifest': '/l2/step-sounds/' + 'd' * 64 + '/manifest.json', 'manifestBytes': 11,
                        'manifestSha256': 'd' * 64}],
    'playerProfiles': [{'id': 'human-fighter', 'manifest': '/l2/players/' + 'e' * 64 + '/manifest.json', 'manifestSha256': 'e' * 64}],
    'combatAudio': [{'id': 'combat-audio', 'manifest': '/l2/combat-audio/' + 'f' * 64 + '/manifest.json', 'manifestSha256': 'f' * 64}],
    'effectComponents': [{'id': 'power-strike', 'manifest': '/l2/effects/' + '1' * 64 + '/manifest.json', 'manifestSha256': '1' * 64}],
}
UNPRODUCED_MODEL = {'id': 'kept-lane-model:0', 'assetId': 'interlude:Kept.mesh', 'archive': '/l2/' + '2' * 64 + '/asset.l2asset',
                    'archiveSha256': '2' * 64, 'model': '/l2/' + '2' * 64 + '/model.glb', 'modelSha256': '3' * 64}


class RuntimeStagingTests(RuntimeStagingFixture):
    def test_stages_the_verified_model_archive_and_geometry_and_replays_without_writes(self):
        result = self.stage()
        self.assertEqual(result['models'], 1)
        self.assertNotIn('sections', result)
        catalog_path = self.destination / 'catalog.json'
        catalog_bytes = catalog_path.read_bytes()
        catalog = json.loads(catalog_bytes)
        self.assertNotIn('sections', catalog)
        self.assertEqual(catalog['models'][0]['archive'], '/l2/' + self.archive_hash + '/asset.l2asset')
        self.assertEqual(catalog['models'][0]['model'], '/l2/' + self.archive_hash + '/model.glb')
        self.assertEqual(catalog['models'][0]['assetId'], self.asset['id'])
        staged = self.destination / self.archive_hash
        self.assertEqual((staged / 'asset.l2asset').read_bytes(), self.archive)
        self.assertEqual((staged / 'model.glb').read_bytes(), self.model_glb)
        snapshots = {path.relative_to(staged): (path.read_bytes(), path.stat().st_mtime_ns) for path in staged.rglob('*') if path.is_file()}
        self.assertEqual(self.stage(), result)
        self.assertEqual(catalog_path.read_bytes(), catalog_bytes)
        self.assertEqual({path.relative_to(staged): (path.read_bytes(), path.stat().st_mtime_ns) for path in staged.rglob('*') if path.is_file()},
                         snapshots)

    def test_keeps_every_record_the_migration_does_not_produce_and_replaces_same_id_models_in_place(self):
        stale_fighter = {'id': 'human-male-fighter:0', 'assetId': 'interlude:Stale.mesh', 'archiveSha256': '4' * 64}
        current = {'schemaVersion': 1, 'sourceHost': 'OLD-HOST', 'models': [UNPRODUCED_MODEL, stale_fighter], **UNSTAGED_SLICE_RECORDS}
        self.write(self.destination / 'catalog.json', json_bytes(current))
        texture_job = self.add_texture_job()
        self.stage()
        catalog_bytes = (self.destination / 'catalog.json').read_bytes()
        catalog = json.loads(catalog_bytes)
        for slice_name, records in UNSTAGED_SLICE_RECORDS.items():
            with self.subTest(slice_name=slice_name):
                self.assertEqual(json_bytes(catalog[slice_name]), json_bytes(records))
        self.assertEqual([model['id'] for model in catalog['models']], ['kept-lane-model:0', 'human-male-fighter:0'])
        self.assertEqual(json_bytes(catalog['models'][0]), json_bytes(UNPRODUCED_MODEL))
        self.assertEqual(catalog['models'][1]['archiveSha256'], self.archive_hash)
        self.assertEqual([texture['id'] for texture in catalog['textures']], [texture_job['id']])
        self.assertEqual(catalog['sourceHost'], 'IMPORTA-PC')
        self.stage()
        self.assertEqual((self.destination / 'catalog.json').read_bytes(), catalog_bytes)

    def test_appends_new_migration_records_in_migration_order_after_the_current_records(self):
        current = {'schemaVersion': 1, 'models': [UNPRODUCED_MODEL], 'textures': [{'id': 'kept-texture:0', 'archiveSha256': '5' * 64}]}
        self.write(self.destination / 'catalog.json', json_bytes(current))
        texture_job = self.add_texture_job()
        self.stage()
        catalog = json.loads((self.destination / 'catalog.json').read_bytes())
        self.assertEqual([model['id'] for model in catalog['models']], ['kept-lane-model:0', 'human-male-fighter:0'])
        self.assertEqual([texture['id'] for texture in catalog['textures']], ['kept-texture:0', texture_job['id']])

    def add_texture_job(self):
        pixels = b'original verified PNG payload'
        asset = {'schemaVersion': 1, 'id': 'interlude:Terrain.NativeMask', 'name': 'NativeMask', 'kind': 'texture',
            'source': {'object': 'Terrain.NativeMask', 'package': 'Terrain', 'sha256': 'd' * 64},
            'image': {'file': 'texture.png'}, 'limitations': [],
            'files': [{'path': 'texture.png', 'bytes': len(pixels), 'sha256': sha(pixels)}]}
        archive = archive_bytes(asset, {'texture.png': pixels})
        archive_hash = sha(archive)
        path = 'textures/' + archive_hash + '/asset.l2asset'
        self.write(self.migration / path, archive)
        job = {'id': 'terrain:0', 'support': 'converted', 'path': path, 'sha256': archive_hash}
        self.coverage['jobs'].append(job)
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.texture = {'asset': asset, 'archive': archive, 'archiveHash': archive_hash, 'pixels': pixels}
        return job

    def test_stages_verified_texture_bytes_and_source_identity_with_models(self):
        self.add_texture_job()
        self.assertEqual(self.stage()['textures'], 1)
        catalog = json.loads((self.destination / 'catalog.json').read_bytes())
        texture = catalog['textures'][0]
        self.assertEqual(texture['source'], self.texture['asset']['source'])
        self.assertEqual(texture['assetId'], self.texture['asset']['id'])
        self.assertEqual(texture['imageSha256'], sha(self.texture['pixels']))
        self.assertEqual(texture['imageBytes'], len(self.texture['pixels']))
        self.assertEqual((self.destination / texture['image'].removeprefix('/l2/')).read_bytes(), self.texture['pixels'])
        self.assertEqual((self.destination / self.texture['archiveHash'] / 'asset.l2asset').read_bytes(), self.texture['archive'])

    def test_rejects_a_tampered_model_archive_without_publishing_the_catalog(self):
        path = self.migration / self.character_path
        path.write_bytes(self.archive + b'tampered')
        with self.assertRaises(ValueError):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_rejects_a_coverage_path_that_escapes_the_migration_root(self):
        self.coverage['jobs'][0]['path'] = '../outside/asset.l2asset'
        self.write_json(self.migration / 'coverage.json', self.coverage)
        with self.assertRaises(ValueError):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_rejects_destination_directory_link_escape_without_touching_external_files(self):
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        self.destination.mkdir(parents=True)
        self.directory_link_or_junction_without_symlink_privilege(self.destination / self.archive_hash, outside)
        with self.assertRaisesRegex(ValueError, 'Symlink/junction/reparse boundary refused'):
            self.stage()
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_the_public_directory_itself_linking_outside_the_project(self):
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        self.destination.parent.mkdir(parents=True)
        self.directory_link_or_junction_without_symlink_privilege(self.destination, outside)
        with self.assertRaisesRegex(ValueError, 'Symlink/junction/reparse boundary refused'):
            self.stage()
        self.assertEqual(list(outside.iterdir()), [])

    def test_preserves_corrupt_immutable_destination_and_previous_catalog_for_review(self):
        self.stage()
        catalog = (self.destination / 'catalog.json').read_bytes()
        model = self.destination / self.archive_hash / 'model.glb'
        model.write_bytes(b'local corruption to preserve')
        with self.assertRaisesRegex(ValueError, 'Existing immutable store file differs; preserved'):
            self.stage()
        self.assertEqual(model.read_bytes(), b'local corruption to preserve')
        self.assertEqual((self.destination / 'catalog.json').read_bytes(), catalog)

    def test_requires_successful_validation_and_the_project_destination(self):
        self.write_json(self.migration / 'validation.json', {'passed': False})
        with self.assertRaisesRegex(ValueError, 'validation must pass'):
            self.stage()
        self.write_json(self.migration / 'validation.json', {'passed': True})
        self.coverage['jobs'][0]['support'] = 'failed'
        self.write_json(self.migration / 'coverage.json', self.coverage)
        with self.assertRaisesRegex(ValueError, 'validation must pass'):
            self.stage()
        with self.assertRaisesRegex(ValueError, 'only to this project'):
            staging.stage_runtime(self.migration, self.root / 'elsewhere')


if __name__ == '__main__':
    unittest.main()
