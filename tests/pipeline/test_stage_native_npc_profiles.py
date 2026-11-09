import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import stage_native_runtime as staging
from native_assets_lib.gltf import json_bytes
from runtime_staging_fixture import ROOT, RuntimeStagingFixture, sha


class NpcProfileStagingTests(RuntimeStagingFixture):
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
        with self.assertRaisesRegex(ValueError, 'NPC mesh matches no qualified skeletal mesh export, even ignoring case'):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_npc_class_and_mesh_exports_spelled_in_another_case_stage_like_exact_ones(self):
        self.add_npc_profiles(actor_class_exports=['lineagemonster.Field_Stalker_20_BI'], mesh_export='lineagemonsters.field_stalker_M00')
        result = self.stage()
        self.assertEqual(result['npcProfiles'], 1)
        manifest_hash = sha((self.npc_root / 'manifest.json').read_bytes())
        self.assertTrue((self.destination / 'npc-profiles' / manifest_hash / 'source/classes/lineagemonster.Field_Stalker_20_BI.json').is_file())

    def test_npc_class_matching_two_definitions_ignoring_case_is_refused_before_publication(self):
        self.add_npc_profiles(actor_class_exports=['LineageMonster.field_stalker_20_bi', 'LINEAGEMONSTER.FIELD_STALKER_20_BI'])
        with self.assertRaisesRegex(ValueError, 'Duplicate/reserved NPC profile artifact path'):
            self.stage()
        self.assertFalse((self.destination / 'catalog.json').exists())

    def test_npc_class_matching_no_definition_ignoring_case_is_refused_before_publication(self):
        self.add_npc_profiles(actor_class_exports=['LineageMonster.field_stalker'])
        with self.assertRaisesRegex(ValueError, 'Actor class matches no qualified class export, even ignoring case'):
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


if __name__ == '__main__':
    unittest.main()
