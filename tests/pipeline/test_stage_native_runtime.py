import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import stage_native_runtime as staging
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_catalog.cli import json_bytes as profile_json_bytes


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


class RuntimeStagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.migration = self.root / 'artifacts/migration'
        self.destination = self.root / 'public/l2'
        self.patch = patch.object(staging, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.section = self.migration / 'sections/map-20-20-section'
        self.runtime = self.section / 'map-section-runtime'
        self.geometry = self.section / 'map-section'
        image = b'original editable PNG bytes'
        provenance = json_bytes({'metadata': {'materialSlots': [{'texture': 'Textures.Body.diffuse', 'textureSha256': sha(image)}]}})
        payloads = {'model.glb': b'opaque validated model GLB fixture', 'provenance.json': provenance}
        self.asset = {'schemaVersion': 1, 'id': 'interlude:Fixture.mesh', 'name': 'Fixture', 'kind': 'model',
            'source': {'object': 'Fixture.mesh', 'package': 'Fixture', 'sha256': 'a' * 64},
            'model': {'file': 'model.glb'}, 'limitations': ['Synthetic staging fixture.'],
            'files': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in payloads.items()]}
        self.archive = archive_bytes(self.asset, payloads)
        self.archive_hash = sha(self.archive)
        self.model_folder = self.section / 'map-section-models' / self.archive_hash
        for name, data in {'asset.l2asset': self.archive, 'asset.json': json_bytes(self.asset), **payloads}.items():
            self.write(self.model_folder / name, data)
        self.image = self.model_folder / 'evidence/export/Textures/Body/diffuse.png'
        self.write(self.image, image)
        self.write(self.model_folder / 'evidence/export/unpinned.log', b'not an approved runtime resource')
        outputs = {'terrain.glb': b'opaque validated terrain GLB fixture', 'terrain.bin': b'original terrain buffer',
            'terrain.gltf': json_bytes({'buffers': [{'uri': 'terrain.bin'}]}), 'manifest.json': json_bytes({'kind': 'native-terrain-section'}),
            'native-defaults/Engine.Actor.uc': b'preserved native defaults'}
        for name, data in outputs.items():
            self.write(self.geometry / name, data)
        self.geometry_receipt = {'kind': 'native-terrain-section', 'outputs': {name: sha(data) for name, data in outputs.items()}}
        self.write_json(self.geometry / 'receipt.json', self.geometry_receipt)
        self.manifest = {'schemaVersion': 1, 'kind': 'native-map-section-runtime', 'errors': [],
            'support': 'section-products-ready-for-runtime-validation', 'resourceRoots': {'terrain': '../map-section', 'models': '../map-section-models'},
            'terrain': {'file': 'terrain.glb', 'sha256': sha(outputs['terrain.glb']), 'bytes': len(outputs['terrain.glb'])},
            'models': [{'id': self.asset['id'], 'archive': {'file': self.archive_hash + '/asset.l2asset', 'sha256': self.archive_hash, 'bytes': len(self.archive)},
                'model': {'file': self.archive_hash + '/model.glb', 'sha256': sha(payloads['model.glb']), 'bytes': len(payloads['model.glb'])}}],
            'placements': [{'id': 'native-placement', 'modelId': self.asset['id'], 'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 213.4, -31.0, 791.9, 1]}],
        }
        self.runtime_receipt = {'schemaVersion': 1, 'kind': 'native-map-section-runtime',
            'modelArchives': {self.archive_hash + '/asset.l2asset': self.archive_hash}}
        self.refresh_receipts()
        character_path = 'models/' + self.archive_hash + '/asset.l2asset'
        self.write(self.migration / character_path, self.archive)
        self.coverage = {'sourceHost': 'IMPORTA-PC', 'sourceManifestSha256': 'b' * 64, 'acceptanceSha256': 'c' * 64, 'jobs': [
            {'id': 'human-male-fighter:0', 'support': 'converted', 'path': character_path, 'sha256': self.archive_hash},
            {'id': 'map-20-20-section', 'adapter': 'map-section', 'support': self.manifest['support'],
             'path': 'sections/map-20-20-section/map-section-runtime/manifest.json',
             'geometryPath': 'sections/map-20-20-section/map-section/manifest.json'},
        ]}
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.write_json(self.migration / 'validation.json', {'passed': True, 'errors': []})

    def write(self, path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def write_json(self, path, value):
        self.write(path, json_bytes(value))

    def refresh_receipts(self):
        self.write_json(self.runtime / 'manifest.json', self.manifest)
        self.runtime_receipt['manifestSha256'] = sha((self.runtime / 'manifest.json').read_bytes())
        self.runtime_receipt['sectionReceiptSha256'] = sha((self.geometry / 'receipt.json').read_bytes())
        self.write_json(self.runtime / 'receipt.json', self.runtime_receipt)

    def stage(self):
        return staging.stage_runtime(self.migration, self.destination)

    def add_npc_profiles(self):
        self.npc_root = self.migration / 'npc-profiles/reference-npcs'
        profile = {'id': 'npc:21622', 'npcId': 21622, 'name': 'Greater Musveren',
            'mesh': 'LineageMonsters.field_stalker_m00', 'actorClass': 'LineageMonster.field_stalker_20_bi',
            'sourceUnitsPerMetre': 100, 'drawScale': 1.2, 'drawScale3D': [1, 1, 1],
            'collisionRadius': 18, 'collisionHeight': 36,
            'unsupportedFields': [{'field': 'prePivot', 'reason': 'Native constructor value remains unproven.'}]}
        recipe = {'schemaVersion': 1, 'id': 'interlude:npc-profiles:fixture', 'nameTable': 'npcname-e.dat',
            'sourceUnitsPerMetre': 100, 'profiles': [{'npcId': 21622, 'expectedName': profile['name'],
                'expectedMesh': profile['mesh'], 'expectedActorClass': profile['actorClass']}]}
        source_files = [{'path': name, 'bytes': 123, 'sha256': str(index) * 64} for index, name in enumerate([
            'system/npcname-e.dat', 'system/npcgrp.dat', 'animations/LineageMonsters.ukx', 'system/Engine.u'])]
        chain = [profile['actorClass'], 'Engine.Actor', 'Core.Object']
        self.npc_payloads = {}
        for index, name in enumerate(chain):
            definition = {'object': name, 'nativeSuperClass': chain[index + 1] if index + 1 < len(chain) else None,
                'source': {'object': name, 'package': 'system/Engine.u', 'packageSha256': '3' * 64},
                'effectiveProperties': {'DrawScale': 1.2, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1},
                    'CollisionHeight': 36, 'CollisionRadius': 18}}
            self.npc_payloads['source/classes/' + name + '.json'] = json_bytes(definition)
            self.npc_payloads['source/classes/' + name + '.uc'] = b'preserved native class source'
            self.npc_payloads['source/classes/' + name + '.bin'] = b'preserved native class export'
        selections = {'tables': {'npcname': {'source': 'system/npcname-e.dat', 'sourceSha256': '0' * 64},
            'npcgrp': {'source': 'system/npcgrp.dat', 'sourceSha256': '1' * 64}}, 'selections': [{
            'id': profile['id'], 'classChain': chain,
            'meshSource': {'reference': profile['mesh'], 'object': profile['mesh'], 'class': 'SkeletalMesh',
                'resolution': 'exact-qualified-object', 'package': 'animations/LineageMonsters.ukx', 'packageSha256': '2' * 64},
            'nameRow': {'row': {'id': 21622, 'name': profile['name']}},
            'groupRow': {'row': {'npc_id': 21622, 'mesh_name': profile['mesh'], 'class_name': profile['actorClass']}}}]}
        self.npc_payloads['source/npc-selections.json'] = json_bytes(selections)
        self.npc_manifest = {'schemaVersion': 1, 'id': recipe['id'], 'kind': 'native-npc-profiles',
            'support': 'source-profile-fields-ready', 'unsupported': [], 'errors': [], 'recipe': recipe,
            'profiles': [profile], 'tools': {'implementation': {'native_actor_profiles.py': 'd' * 64}},
            'sourceFiles': source_files, 'sourceSelections': 'source/npc-selections.json', 'classDefinitions': chain,
            'coverage': {'requestedProfiles': 1, 'resolvedProfiles': 1}, 'visualAcceptance': 'unverified'}
        self.coverage['jobs'].append({'id': 'reference-npcs', 'adapter': 'npc-profiles',
            'support': 'source-profile-fields-ready', 'path': 'npc-profiles/reference-npcs/manifest.json'})
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.refresh_npc_receipt()

    def refresh_npc_receipt(self):
        for name, payload in self.npc_payloads.items():
            self.write(self.npc_root / name, payload)
        records = [{'file': name, 'bytes': len(payload), 'sha256': sha(payload)} for name, payload in sorted(self.npc_payloads.items())]
        self.npc_manifest['files'] = records
        self.write(self.npc_root / 'manifest.json', profile_json_bytes(self.npc_manifest))
        receipt = {'schemaVersion': 1, 'manifestSha256': sha((self.npc_root / 'manifest.json').read_bytes()),
            'recipeSha256': sha(profile_json_bytes(self.npc_manifest['recipe'])), 'tools': self.npc_manifest['tools'],
            'sourceFiles': self.npc_manifest['sourceFiles'], 'files': records}
        self.write_json(self.npc_root / 'receipt.json', receipt)

    def test_stages_complete_immutable_npc_profile_bundle_with_explicit_unknown_field(self):
        self.add_npc_profiles()
        self.write(self.npc_root / '.work/unlisted.log', b'not a declared artifact')
        result = self.stage()
        self.assertEqual(result['npcProfiles'], 1)
        catalog = json.loads((self.destination / 'catalog.json').read_bytes())
        manifest_bytes = (self.npc_root / 'manifest.json').read_bytes()
        manifest_hash = sha(manifest_bytes)
        self.assertEqual(catalog['npcProfiles'], [{'id': 'reference-npcs',
            'manifest': '/l2/npc-profiles/' + manifest_hash + '/manifest.json',
            'manifestSha256': manifest_hash, 'manifestBytes': len(manifest_bytes)}])
        folder = self.destination / 'npc-profiles' / manifest_hash
        for name in ['manifest.json', 'receipt.json', *self.npc_payloads]:
            self.assertEqual((folder / name).read_bytes(), (self.npc_root / name).read_bytes())
        self.assertFalse((folder / '.work').exists())
        profile = json.loads((folder / 'manifest.json').read_bytes())['profiles'][0]
        self.assertNotIn('prePivot', profile)
        self.assertEqual(profile['unsupportedFields'][0]['field'], 'prePivot')
        before = {p.relative_to(folder): (p.read_bytes(), p.stat().st_mtime_ns) for p in folder.rglob('*') if p.is_file()}
        self.assertEqual(self.stage(), result)
        self.assertEqual(before, {p.relative_to(folder): (p.read_bytes(), p.stat().st_mtime_ns) for p in folder.rglob('*') if p.is_file()})
        self.assertEqual((result['models'], result['sections']), (1, 1))

    def test_npc_corrupt_manifest_sidecar_and_missing_bundle_preserve_previous_catalog(self):
        self.stage()
        catalog = (self.destination / 'catalog.json').read_bytes()
        self.add_npc_profiles()
        for name in ('manifest.json', 'source/npc-selections.json', 'source/classes/Engine.Actor.uc', 'receipt.json'):
            with self.subTest(name=name):
                path = self.npc_root / name
                original = path.read_bytes()
                if name == 'receipt.json':
                    path.unlink()
                else:
                    path.write_bytes(original + b'tampered')
                with self.assertRaises((ValueError, OSError)):
                    self.stage()
                self.assertEqual((self.destination / 'catalog.json').read_bytes(), catalog)
                self.assertFalse((self.destination / 'npc-profiles').exists())
                path.write_bytes(original)

    def test_npc_duplicate_and_inconsistent_profile_metadata_fail_before_publication(self):
        self.add_npc_profiles()
        original = copy.deepcopy(self.npc_manifest)
        mutations = [lambda m: m['profiles'].append(copy.deepcopy(m['profiles'][0])),
            lambda m: m['profiles'][0].update(mesh='LineageMonsters.other_mesh'),
            lambda m: m['profiles'][0].update(id='npc:21623'),
            lambda m: m['profiles'][0].update(drawScale=2),
            lambda m: m['profiles'][0].pop('unsupportedFields'),
            lambda m: m.update(unsupported=['missing class']),
            lambda m: m.update(errors=['unresolved table']),
            lambda m: m.update(kind='unknown-profile-kind')]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.npc_manifest = copy.deepcopy(original)
                mutate(self.npc_manifest)
                self.refresh_npc_receipt()
                with self.assertRaises(ValueError):
                    self.stage()
                self.assertFalse((self.destination / 'catalog.json').exists())

    def test_npc_recipe_sidecar_mismatch_is_rejected_even_with_updated_receipt(self):
        self.add_npc_profiles()
        selection = json.loads(self.npc_payloads['source/npc-selections.json'])
        selection['selections'][0]['meshSource']['object'] = 'LineageMonsters.other_mesh'
        self.npc_payloads['source/npc-selections.json'] = json_bytes(selection)
        self.refresh_npc_receipt()
        with self.assertRaisesRegex(ValueError, 'source/name/mesh identity'):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_npc_coverage_path_and_declared_file_set_are_exact(self):
        self.add_npc_profiles()
        self.coverage['jobs'][-1]['path'] = 'npc-profiles/wrong-bundle/manifest.json'
        self.write_json(self.migration / 'coverage.json', self.coverage)
        with self.assertRaisesRegex(ValueError, 'coverage path'):
            self.stage()
        self.coverage['jobs'][-1]['path'] = 'npc-profiles/reference-npcs/manifest.json'
        self.write_json(self.migration / 'coverage.json', self.coverage)
        receipt = json.loads((self.npc_root / 'receipt.json').read_bytes())
        receipt['files'].pop()
        self.write_json(self.npc_root / 'receipt.json', receipt)
        with self.assertRaisesRegex(ValueError, 'receipt differs'):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_npc_existing_corrupt_immutable_sidecar_is_preserved(self):
        self.add_npc_profiles()
        self.stage()
        catalog = (self.destination / 'catalog.json').read_bytes()
        record = json.loads(catalog)['npcProfiles'][0]
        path = self.destination / 'npc-profiles' / record['manifestSha256'] / 'source/npc-selections.json'
        path.write_bytes(b'local corruption retained for review')
        with self.assertRaisesRegex(ValueError, 'Existing immutable store file differs; preserved'):
            self.stage()
        self.assertEqual(path.read_bytes(), b'local corruption retained for review')
        self.assertEqual((self.destination / 'catalog.json').read_bytes(), catalog)

    @unittest.skipUnless((ROOT / 'artifacts/native-parity/research/npc-actor-profiles/bundle/manifest.json').is_file(), 'Local native NPC profile bundle unavailable')
    def test_real_source_profile_bundle_stages_only_in_temporary_project(self):
        self.add_npc_profiles()
        source = ROOT / 'artifacts/native-parity/research/npc-actor-profiles/bundle'
        receipt = json.loads((source / 'receipt.json').read_bytes())
        names = ['manifest.json', 'receipt.json', *[record['file'] for record in receipt['files']]]
        for name in names:
            self.write(self.npc_root / name, staging.contained(source, name).read_bytes())
        result = self.stage()
        self.assertEqual(result['npcProfiles'], 1)
        record = json.loads((self.destination / 'catalog.json').read_bytes())['npcProfiles'][0]
        folder = self.destination / 'npc-profiles' / record['manifestSha256']
        for name in names:
            self.assertEqual((folder / name).read_bytes(), (source / name).read_bytes())
        profile = json.loads((folder / 'manifest.json').read_bytes())['profiles'][0]
        self.assertEqual((profile['npcId'], profile['drawScale'], profile['collisionHeight']), (21622, 1.2, 36))
        self.assertNotIn('prePivot', profile)

    def directory_link_or_junction_without_symlink_privilege(self, link, target):
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            if os.name != 'nt':
                raise
            import _winapi
            _winapi.CreateJunction(str(target), str(link))

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
