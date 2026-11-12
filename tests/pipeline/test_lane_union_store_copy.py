from functools import partial
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_store.catalog_writer import CatalogWriteError
from native_store import store_file_copy
from native_store.store_file_copy import copy_store_files
from native_store.store_paths import lane_store_root
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES
from native_store import write_lane_catalog as lane_catalog_module
from native_store.write_lane_catalog import UNION_EXCLUDED_STORE_FILES, write_lane_catalog
from test_bundle_member_pins import ProfileBundleProjectTestCase, snapshot_tree, write_file


def bytes_by_relative_path(root):
    return {relative: payload for relative, (payload, _) in snapshot_tree(root).items()}


class LaneUnionStoreCopyTests(ProfileBundleProjectTestCase):
    def setUp(self):
        super().setUp()
        write_lane_catalog(self.project, 'actors')
        self.integration_store = lane_store_root(self.project, 'integration')
        self.receipt_relative = self.bundle.member_relative('receipt.json')

    def drive_the_free_bytes_of_the_union_copy(self, free_bytes):
        disk_usage = Mock(return_value=SimpleNamespace(free=free_bytes))
        driven_copy = patch.object(lane_catalog_module, 'copy_store_files', partial(copy_store_files, disk_usage=disk_usage))
        driven_copy.start()
        self.addCleanup(driven_copy.stop)
        return disk_usage

    def test_the_union_hashes_only_the_unpinned_receipt_from_disk_and_copies_every_file_of_the_union_lane(self):
        with patch.object(store_file_copy, 'sha256_of_file', wraps=store_file_copy.sha256_of_file) as hashed:
            write_lane_catalog(self.project, 'integration', ('actors',))
        hashed_paths = [Path(hashed_call.args[0]) for hashed_call in hashed.call_args_list]
        self.assertEqual([path for path in hashed_paths if path.is_relative_to(self.actors_store)], [self.actors_store / self.receipt_relative])
        union_lane_bytes = {relative: payload for relative, payload in bytes_by_relative_path(self.actors_store).items()
                            if relative not in UNION_EXCLUDED_STORE_FILES}
        self.assertEqual(sorted(union_lane_bytes), sorted([*self.bundle.pinned_relative_paths(), self.receipt_relative]))
        integration_bytes = bytes_by_relative_path(self.integration_store)
        self.assertEqual({relative: integration_bytes.get(relative) for relative in union_lane_bytes}, union_lane_bytes)

    def test_a_union_source_changed_after_its_verification_is_refused_by_the_copy_and_leaves_no_file(self):
        require_npc_profiles_join_models_of_their_mesh = lane_catalog_module.require_npc_profiles_join_models_of_their_mesh

        def join_check_then_rewrite_the_actors_manifest(checked_store_root, checked_catalog, shared_store_root):
            require_npc_profiles_join_models_of_their_mesh(checked_store_root, checked_catalog, shared_store_root)
            if checked_store_root == self.actors_store:
                write_file(self.actors_store / self.bundle.manifest_relative, b'manifest bytes written after the verification')

        with patch.object(lane_catalog_module, 'require_npc_profiles_join_models_of_their_mesh', join_check_then_rewrite_the_actors_manifest):
            with self.assertRaisesRegex(CatalogWriteError, f'^Store file source no longer has its expected SHA-256 {self.bundle.manifest_sha256}; '):
                write_lane_catalog(self.project, 'integration', ('actors',))
        self.assertEqual(snapshot_tree(self.integration_store), {})

    def test_a_path_one_union_lane_pins_and_another_holds_unpinned_with_other_bytes_is_refused_before_the_first_write(self):
        write_lane_catalog(self.project, 'world')
        write_file(lane_store_root(self.project, 'world') / self.bundle.manifest_relative, b'other bytes at the manifest path')
        with self.assertRaisesRegex(CatalogWriteError, f'^Conflicting store file paths: {re.escape(self.bundle.manifest_relative)}$'):
            write_lane_catalog(self.project, 'integration', ('world', 'actors'))
        self.assertFalse(self.integration_store.exists())

    def test_a_union_whose_missing_files_and_floor_exceed_the_free_bytes_is_refused_and_writes_nothing(self):
        disk_usage = self.drive_the_free_bytes_of_the_union_copy(BATCH_MINIMUM_FREE_BYTES)
        with self.assertRaisesRegex(CatalogWriteError, '; nothing was written$'):
            write_lane_catalog(self.project, 'integration', ('actors',))
        disk_usage.assert_called_once()
        self.assertFalse(self.integration_store.exists())

    def test_a_union_rerun_with_no_file_to_copy_is_not_refused_for_low_free_space(self):
        write_lane_catalog(self.project, 'integration', ('actors',))
        snapshot = snapshot_tree(self.project)
        disk_usage = self.drive_the_free_bytes_of_the_union_copy(0)
        self.assertEqual(write_lane_catalog(self.project, 'integration', ('actors',))['filesWritten'], 0)
        disk_usage.assert_not_called()
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_a_differing_file_in_the_target_lane_is_refused_by_the_plan_check_and_by_the_union(self):
        write_lane_catalog(self.project, 'integration', ('actors',))
        write_file(self.integration_store / self.receipt_relative, b'receipt bytes of another writer')
        snapshot = snapshot_tree(self.project)
        for plan_only in (True, False):
            with self.subTest(plan_only=plan_only):
                with self.assertRaisesRegex(CatalogWriteError, 'Existing immutable store file differs; preserved'):
                    write_lane_catalog(self.project, 'integration', ('actors',), plan_only=plan_only)
                self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_a_lane_without_union_lanes_publishes_through_write_store_with_no_files(self):
        with (patch.object(lane_catalog_module, 'copy_store_files', side_effect=AssertionError('a lane without union lanes must not use the copy')),
              patch.object(lane_catalog_module, 'write_store', wraps=lane_catalog_module.write_store) as write_store):
            self.assertEqual(write_lane_catalog(self.project, 'actors')['filesWritten'], 0)
        self.assertEqual([write_store_call.args[1] for write_store_call in write_store.call_args_list], [{}])


if __name__ == '__main__':
    unittest.main()
