import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from actors.skill_effect_conversion import add_staged_effect_store_files, skill_effect_component_record, stage_effect_bundle
from effect_source_bundle_fixture import write_sprite_effect_source_bundle
from native_store.canonical_json import canonical_json_bytes
from native_store import catalog_writer
from native_store.catalog_writer import (CatalogWriteError, PinnedFileReference, catalog_pinned_file_references, merge_catalog_slice,
                                         pinned_store_files, write_store)
from native_store import pinned_store_verification
from native_store.pinned_store_verification import verified_chunk_outcomes, verified_file_child_references, verify_pinned_store_files
from native_store.store_paths import lane_store_root
from native_store import write_lane_catalog as lane_catalog_module
from native_store.write_lane_catalog import PINNED_STORE_VERIFICATION_WORKER_COUNT, write_lane_catalog
from test_bundle_member_pins import (POOLED_WALK_WORKER_COUNT, ProfileBundle, ProfileBundleProjectTestCase, SyntheticEffectBundle,
                                     SyntheticWorldTile, TemporaryStoreTestCase, native_material_program_pin, sha256_hex,
                                     synthetic_profile_bundle_members, write_file)

FIRST_WRONG_MEMBER, SECOND_WRONG_MEMBER = 'source/member-05.bin', 'source/member-35.bin'


def verify_only_walk(store_root, catalog):
    return verify_pinned_store_files(store_root, catalog, POOLED_WALK_WORKER_COUNT)


IN_PROCESS_WALKS = (pinned_store_files, verify_only_walk)


class VerifyOnlyWalkTests(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.store_root = self.temporary_root / 'lane' / 'l2'

    def test_every_walk_verifies_the_three_levels_of_a_world_tile(self):
        tile = SyntheticWorldTile(self.store_root)
        self.assert_every_walk_verifies(self.store_root, tile.catalog())

    def test_every_walk_refuses_a_material_program_missing_at_the_deepest_level(self):
        tile = SyntheticWorldTile(self.store_root, [native_material_program_pin('6' * 64)])
        self.assert_every_walk_refuses(CatalogWriteError, f'pinned store file is missing from .*: native-materials/{"6" * 64}/program.json',
                                       self.store_root, tile.catalog())

    def test_a_per_reference_verification_returns_child_references_and_no_payload(self):
        tile = SyntheticWorldTile(self.store_root)
        tile_manifest_reference = catalog_pinned_file_references(tile.catalog())[0]
        child_references = verified_file_child_references(self.store_root, tile_manifest_reference)
        self.assertEqual([reference.relative for reference in child_references], [f'{tile.sky_folder}/manifest.json', tile.bsp_relative])
        for reference in child_references:
            self.assertIs(type(reference), PinnedFileReference)

    def test_a_repeated_reference_with_the_same_sha256_is_hashed_once(self):
        bundle = SyntheticEffectBundle(self.store_root)
        for walk in IN_PROCESS_WALKS:
            with self.subTest(walk=walk.__name__), patch.object(catalog_writer, 'sha256_hex', wraps=catalog_writer.sha256_hex) as hashed:
                walk(self.store_root, bundle.catalog)
                self.assertEqual(hashed.call_count, 2)

    def test_a_repeated_reference_with_another_sha256_is_refused_without_a_second_hash(self):
        bundle = SyntheticEffectBundle(self.store_root, resource_pin_sha256='7' * 64)
        message = f'store file {bundle.folder}/{bundle.texture_pin["file"]} is pinned with two different SHA-256 values'
        self.assert_every_walk_refuses(CatalogWriteError, f'^{re.escape(message)}$', self.store_root, bundle.catalog)
        for walk in IN_PROCESS_WALKS:
            with self.subTest(walk=walk.__name__), patch.object(catalog_writer, 'sha256_hex', wraps=catalog_writer.sha256_hex) as hashed:
                with self.assertRaises(CatalogWriteError) as refusal:
                    walk(self.store_root, bundle.catalog)
                self.assertEqual((str(refusal.exception), hashed.call_count), (message, 2))

    def test_every_walk_verifies_a_profile_bundle_a_store_root_manifest_and_a_repeated_effect_resource(self):
        stores = (('profile-bundle', lambda store_root: ProfileBundle(synthetic_profile_bundle_members()).write(store_root)),
                  ('store-root-manifest', lambda store_root: ProfileBundle({'flat-member.bin': b'member beside a root manifest'},
                                                                           manifest_folder='').write(store_root)),
                  ('effect-bundle', lambda store_root: SyntheticEffectBundle(store_root).catalog))
        for store_name, write_store_and_return_catalog in stores:
            with self.subTest(store=store_name):
                store_root = self.temporary_root / store_name / 'l2'
                self.assert_every_walk_verifies(store_root, write_store_and_return_catalog(store_root))

    def test_a_level_below_the_pooled_minimum_is_verified_in_the_calling_process(self):
        catalog = ProfileBundle(synthetic_profile_bundle_members()).write(self.store_root)
        verified = {key: sha256_hex(payload) for key, (_, payload) in pinned_store_files(self.store_root, catalog).items()}
        self.assertEqual(verify_pinned_store_files(self.store_root, catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT), verified)
        pinned_store_verification.ProcessPoolExecutor.assert_not_called()

    def test_every_walk_reports_the_first_of_two_wrong_files_in_one_level(self):
        bundle = ProfileBundle({f'source/member-{index:02d}.bin': f'member {index:02d} bytes'.encode() for index in range(40)})
        catalog = bundle.write(self.store_root)
        (self.store_root / bundle.member_relative(FIRST_WRONG_MEMBER)).unlink()
        write_file(self.store_root / bundle.member_relative(SECOND_WRONG_MEMBER), b'other bytes')
        self.assert_every_walk_refuses(CatalogWriteError, f'pinned store file is missing from .*: {bundle.member_relative(FIRST_WRONG_MEMBER)}$',
                                       self.store_root, catalog)

    def test_every_walk_reports_a_repeated_reference_refusal_that_precedes_a_wrong_file_of_the_same_chunk(self):
        payload = b'synthetic archive bytes'
        write_file(self.store_root / 'kept/first.bin', payload)
        catalog = {'schemaVersion': 1, 'models': [
            {'id': 'first', 'archive': '/l2/kept/first.bin', 'archiveSha256': sha256_hex(payload)},
            {'id': 'repeat', 'archive': '/l2/kept/first.bin', 'archiveSha256': '7' * 64},
            {'id': 'missing', 'archive': '/l2/kept/missing.bin', 'archiveSha256': '8' * 64}]}
        message = 'store file kept/first.bin is pinned with two different SHA-256 values'
        self.assert_every_walk_refuses(CatalogWriteError, f'^{re.escape(message)}$', self.store_root, catalog)

    def test_a_chunk_stops_at_its_first_refusal_and_returns_it_at_its_own_position(self):
        payload = b'synthetic archive bytes'
        for name in ('first', 'third'):
            write_file(self.store_root / f'kept/{name}.bin', payload)
        references = [PinnedFileReference(f'kept/{name}.bin', sha256_hex(payload), None, None) for name in ('first', 'second', 'third')]
        outcomes = verified_chunk_outcomes(self.store_root, references)
        self.assertEqual((outcomes[0], len(outcomes), type(outcomes[1])), ([], 2, CatalogWriteError))
        self.assertRegex(str(outcomes[1]), 'pinned store file is missing from .*: kept/second.bin$')

    def test_every_walk_reports_the_wrong_file_of_the_earlier_level_first(self):
        tile = SyntheticWorldTile(self.store_root)
        write_file(self.store_root / tile.bsp_relative, b'other bytes')
        (self.store_root / tile.sky_folder / 'sky.glb').unlink()
        self.assert_every_walk_refuses(CatalogWriteError, f'pinned store file SHA-256 differs from its pin [0-9a-f]{{64}}: {tile.bsp_relative}$',
                                       self.store_root, tile.catalog())

    def test_every_walk_applies_the_store_file_path_rule_to_a_file_whose_bytes_match_its_pin(self):
        payload = b'{"schemaVersion":1,"models":[]}'
        cases = (('.hidden/x.bin', 'Store file path is not a bounded /l2 resource path: .hidden/x.bin'),
                 ('catalog.json', 'The store catalog is written only by write_store: catalog.json'))
        for relative, message in cases:
            with self.subTest(relative=relative):
                write_file(self.store_root / relative, payload)
                catalog = {'schemaVersion': 1, 'models': [{'id': 'synthetic-model', 'archive': f'/l2/{relative}',
                                                           'archiveSha256': sha256_hex(payload)}]}
                self.assert_every_walk_refuses(CatalogWriteError, f'^{re.escape(message)}$', self.store_root, catalog)


class StagedSkillEffectStoreWalkTests(TemporaryStoreTestCase):
    def test_every_walk_verifies_a_staged_skill_effect_store_and_refuses_it_without_its_source_graph(self):
        source_bundle_root, staged_effects_root, store_root = (self.temporary_root / name for name in ('bundle', 'effects', 'store'))
        write_sprite_effect_source_bundle(source_bundle_root)
        manifest_sha256 = stage_effect_bundle(ROOT, source_bundle_root, staged_effects_root)
        staged_root = staged_effects_root / manifest_sha256
        files = {}
        add_staged_effect_store_files(files, staged_root, manifest_sha256)
        catalog = merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'effectComponents',
                                      skill_effect_component_record(3, 1, 'skill.fixture.root', manifest_sha256), 1)
        write_store(store_root, files, None, canonical_json_bytes(catalog))
        self.assert_every_walk_verifies(store_root, catalog)
        source_graph_member = json.loads((staged_root / 'manifest.json').read_bytes())['sourceBundle']['graph']['file']
        (store_root / f'effects/{manifest_sha256}/{source_graph_member}').unlink()
        self.assert_every_walk_refuses(CatalogWriteError, 'pinned store file is missing', store_root, catalog)


class LaneCatalogVerificationCallSiteTests(ProfileBundleProjectTestCase):
    def test_the_lane_catalog_verifies_the_target_lane_and_each_union_lane_without_collecting_payloads(self):
        with (patch.object(lane_catalog_module, 'verify_pinned_store_files', wraps=verify_pinned_store_files) as verify_only_walk_calls,
              patch.object(catalog_writer, 'pinned_store_files', side_effect=AssertionError('the lane catalog must not collect payloads'))):
            write_lane_catalog(self.project, 'actors')
            write_lane_catalog(self.project, 'integration', ('actors',))
        self.assertEqual([(call.args[0], call.args[2]) for call in verify_only_walk_calls.call_args_list],
                         [(self.actors_store, PINNED_STORE_VERIFICATION_WORKER_COUNT),
                          (lane_store_root(self.project, 'integration'), PINNED_STORE_VERIFICATION_WORKER_COUNT),
                          (self.actors_store, PINNED_STORE_VERIFICATION_WORKER_COUNT)])
        self.assertFalse(hasattr(lane_catalog_module, 'pinned_store_files'))
        self.assertEqual(PINNED_STORE_VERIFICATION_WORKER_COUNT, 12)


if __name__ == '__main__':
    unittest.main()
