from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_store import catalog_writer
from native_store.catalog_writer import CatalogWriteError, PinnedFileReference, catalog_pinned_file_references, pinned_store_files
from native_store.pinned_store_verification import verified_file_child_references, verify_pinned_store_files
from native_store.store_paths import lane_store_root
from native_store import write_lane_catalog as lane_catalog_module
from native_store.write_lane_catalog import PINNED_STORE_VERIFICATION_WORKER_COUNT, write_lane_catalog
from test_bundle_member_pins import (POOLED_WALK_WORKER_COUNT, ProfileBundleProjectTestCase, SyntheticEffectBundle, SyntheticWorldTile,
                                     TemporaryStoreTestCase, native_material_program_pin)


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
        self.assertEqual(PINNED_STORE_VERIFICATION_WORKER_COUNT, 6)


if __name__ == '__main__':
    unittest.main()
