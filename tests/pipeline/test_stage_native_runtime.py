import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import stage_native_runtime as staging
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from runtime_staging_fixture import RuntimeStagingFixture, sha


class RuntimeStagingTests(RuntimeStagingFixture):
    def test_stages_unchanged_relative_tree_archives_provenance_and_editable_sources_with_replay(self):
        result = self.stage()
        self.assertEqual((result['models'], result['sections']), (1, 1))
        catalog_path = self.destination / 'catalog.json'
        catalog_bytes = catalog_path.read_bytes()
        catalog = json.loads(catalog_bytes)
        record = catalog['sections'][0]
        manifest_hash = sha((self.runtime / 'manifest.json').read_bytes())
        self.assertEqual(record, {'id': 'map-20-20-section', 'manifestSha256': manifest_hash,
            'manifest': '/l2/maps/' + manifest_hash + '/map-section-runtime/manifest.json'})
        staged = self.destination / 'maps' / manifest_hash
        self.assertEqual((staged / 'map-section-runtime/manifest.json').read_bytes(), (self.runtime / 'manifest.json').read_bytes())
        self.assertEqual((staged / 'map-section/terrain.glb').read_bytes(), (self.geometry / 'terrain.glb').read_bytes())
        self.assertEqual((staged / 'map-section/terrain.gltf').read_bytes(), (self.geometry / 'terrain.gltf').read_bytes())
        self.assertEqual((staged / 'map-section/native-defaults/Engine.Actor.uc').read_bytes(), b'preserved native defaults')
        model = staged / 'map-section-models' / self.archive_hash
        for name in ('model.glb', 'asset.l2asset', 'asset.json', 'provenance.json', 'evidence/export/Textures/Body/diffuse.png'):
            self.assertEqual((model / name).read_bytes(), (self.model_folder / name).read_bytes())
        self.assertFalse((model / 'evidence/export/unpinned.log').exists())
        self.assertEqual(catalog['models'][0]['archive'], '/l2/' + self.archive_hash + '/asset.l2asset')
        self.assertEqual(catalog['models'][0]['model'], '/l2/' + self.archive_hash + '/model.glb')
        snapshots = {p.relative_to(staged): (p.read_bytes(), p.stat().st_mtime_ns) for p in staged.rglob('*') if p.is_file()}
        self.assertEqual(self.stage(), result)
        self.assertEqual(catalog_path.read_bytes(), catalog_bytes)
        self.assertEqual({p.relative_to(staged): (p.read_bytes(), p.stat().st_mtime_ns) for p in staged.rglob('*') if p.is_file()}, snapshots)

    def test_preserves_uninterpreted_layer_metadata_from_geometry_receipt(self):
        layers = json_bytes([{'index': 6, 'maskUVStatus': 'inspection-candidate; native mask sampling remains unverified',
            'nativeSamplingSource': {'object': '20_20.TerrainInfo0', 'layerIndex': 6,
                'properties': [{'property': {'name': 'ToMaskmap', 'arrayIndex': None},
                    'serializedTagAndPayload': {'hex': '910300000080000000478d7b15c6'}}]}}])
        self.write(self.geometry / 'layers.json', layers)
        self.geometry_receipt['outputs']['layers.json'] = sha(layers)
        self.write_json(self.geometry / 'receipt.json', self.geometry_receipt)
        self.refresh_receipts()
        self.stage()
        catalog = json.loads((self.destination / 'catalog.json').read_text())
        section = self.destination / 'maps' / catalog['sections'][0]['manifestSha256']
        self.assertEqual((section / 'map-section/layers.json').read_bytes(), layers)
        self.assertEqual((section / 'map-section/receipt.json').read_bytes(), (self.geometry / 'receipt.json').read_bytes())

    def test_stages_verified_texture_bytes_and_source_identity_with_models(self):
        pixels = b'original verified PNG payload'
        asset = {'schemaVersion': 1, 'id': 'interlude:Terrain.NativeMask', 'name': 'NativeMask', 'kind': 'texture',
            'source': {'object': 'Terrain.NativeMask', 'package': 'Terrain', 'sha256': 'd' * 64},
            'image': {'file': 'texture.png'}, 'limitations': [],
            'files': [{'path': 'texture.png', 'bytes': len(pixels), 'sha256': sha(pixels)}]}
        archive = archive_bytes(asset, {'texture.png': pixels})
        archive_hash = sha(archive)
        path = 'textures/' + archive_hash + '/asset.l2asset'
        self.write(self.migration / path, archive)
        self.coverage['jobs'].append({'id': 'terrain:0', 'support': 'converted', 'path': path, 'sha256': archive_hash})
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.assertEqual(self.stage()['textures'], 1)
        catalog = json.loads((self.destination / 'catalog.json').read_bytes())
        texture = catalog['textures'][0]
        self.assertEqual(texture['source'], asset['source'])
        self.assertEqual(texture['assetId'], asset['id'])
        self.assertEqual(texture['imageSha256'], sha(pixels))
        self.assertEqual(texture['imageBytes'], len(pixels))
        self.assertEqual((self.destination / texture['image'].removeprefix('/l2/')).read_bytes(), pixels)
        self.assertEqual((self.destination / archive_hash / 'asset.l2asset').read_bytes(), archive)

    def test_rejects_tampered_terrain_archive_manifest_and_editable_texture_without_publishing_catalog(self):
        for relative in ('map-section/terrain.glb', 'map-section-runtime/manifest.json',
                         'map-section-models/' + self.archive_hash + '/asset.l2asset',
                         'map-section-models/' + self.archive_hash + '/evidence/export/Textures/Body/diffuse.png'):
            with self.subTest(relative=relative):
                path = self.section / relative
                original = path.read_bytes()
                path.write_bytes(original + b'tampered')
                with self.assertRaises(ValueError):
                    self.stage()
                self.assertFalse((self.destination / 'catalog.json').exists())
                path.write_bytes(original)

    def test_rejects_changed_standalone_model_even_if_the_runtime_descriptor_is_updated(self):
        altered = b'changed standalone mesh'
        self.write(self.model_folder / 'model.glb', altered)
        self.manifest['models'][0]['model'].update(bytes=len(altered), sha256=sha(altered))
        self.refresh_receipts()
        with self.assertRaisesRegex(ValueError, 'standalone geometry differs'):
            self.stage()

    def test_rejects_changed_unpacked_provenance_even_with_a_valid_archive(self):
        self.write(self.model_folder / 'provenance.json', b'{}')
        with self.assertRaisesRegex(ValueError, 'hash/length differs'):
            self.stage()

    def test_rejects_resource_root_and_descriptor_path_escapes(self):
        original = copy.deepcopy(self.manifest)
        for unsafe in ('../../outside', 'C:/outside', '\\\\server\\share', '/outside'):
            with self.subTest(unsafe=unsafe):
                self.manifest = copy.deepcopy(original)
                self.manifest['resourceRoots']['terrain'] = unsafe
                self.refresh_receipts()
                with self.assertRaisesRegex(ValueError, 'resource roots'):
                    self.stage()
        self.manifest = original
        self.manifest['models'][0]['model']['file'] = '../outside.glb'
        self.refresh_receipts()
        with self.assertRaisesRegex(ValueError, 'immutable archive identity'):
            self.stage()

    def test_rejects_unsafe_receipt_outputs_even_when_the_receipt_hash_is_updated(self):
        self.geometry_receipt['outputs']['../outside'] = 'a' * 64
        self.write_json(self.geometry / 'receipt.json', self.geometry_receipt)
        self.refresh_receipts()
        with self.assertRaisesRegex(ValueError, 'Unsafe asset path'):
            self.stage()

    def test_rejects_source_directory_link_escape_even_when_payload_hash_matches(self):
        target = Path(self.temporary.name) / 'outside'
        target.mkdir()
        (target / self.image.name).write_bytes(self.image.read_bytes())
        self.image.parent.rename(self.image.parent.with_name('Body-original'))
        self.directory_link_or_junction_without_symlink_privilege(self.image.parent, target)
        with self.assertRaisesRegex(ValueError, 'escapes its root'):
            self.stage()

    def test_rejects_destination_directory_link_escape_without_touching_external_files(self):
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        self.destination.mkdir(parents=True)
        self.directory_link_or_junction_without_symlink_privilege(self.destination / 'maps', outside)
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

    def test_preserves_model_only_migration_support(self):
        self.coverage['jobs'].pop()
        self.write_json(self.migration / 'coverage.json', self.coverage)
        result = self.stage()
        catalog = json.loads((self.destination / 'catalog.json').read_bytes())
        self.assertEqual((result['models'], result['sections']), (1, 0))
        self.assertEqual(catalog['sections'], [])
        self.assertEqual(catalog['models'][0]['assetId'], self.asset['id'])

    def test_preserves_corrupt_immutable_destination_and_previous_catalog_for_review(self):
        self.stage()
        catalog = (self.destination / 'catalog.json').read_bytes()
        terrain = next((self.destination / 'maps').glob('*/map-section/terrain.glb'))
        terrain.write_bytes(b'local corruption to preserve')
        with self.assertRaisesRegex(ValueError, 'Existing immutable store file differs; preserved'):
            self.stage()
        self.assertEqual(terrain.read_bytes(), b'local corruption to preserve')
        self.assertEqual((self.destination / 'catalog.json').read_bytes(), catalog)

    def test_requires_successful_validation_complete_sections_and_the_project_destination(self):
        self.write_json(self.migration / 'validation.json', {'passed': False})
        with self.assertRaisesRegex(ValueError, 'validation must pass'):
            self.stage()
        self.write_json(self.migration / 'validation.json', {'passed': True})
        self.coverage['jobs'][1]['support'] = 'partial-section-products'
        self.write_json(self.migration / 'coverage.json', self.coverage)
        with self.assertRaisesRegex(ValueError, 'coverage is incomplete'):
            self.stage()
        with self.assertRaisesRegex(ValueError, 'only to this project'):
            staging.stage_runtime(self.migration, self.root / 'elsewhere')

    def test_rejects_missing_receipt_archives_and_unbound_placement_models(self):
        self.runtime_receipt['modelArchives'] = {}
        self.refresh_receipts()
        with self.assertRaisesRegex(ValueError, 'archive set differs'):
            self.stage()
        self.runtime_receipt['modelArchives'] = {self.archive_hash + '/asset.l2asset': self.archive_hash}
        self.manifest['placements'][0]['modelId'] = 'unknown-model'
        self.refresh_receipts()
        with self.assertRaisesRegex(ValueError, 'missing model'):
            self.stage()


if __name__ == '__main__':
    unittest.main()
