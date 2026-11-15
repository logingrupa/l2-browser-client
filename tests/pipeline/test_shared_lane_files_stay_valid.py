import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.catalog_writer import CatalogWriteError, immutable_write, replace_file
from native_store.lane_sharing_candidates import MINIMUM_SHARED_FILE_BYTES
from native_store.pinned_store_verification import verify_pinned_store_files
from native_store.share_identical_lane_files import share_identical_lane_files
from native_store.store_paths import lane_store_root
from native_store.unit_ledger import verified_receipts_by_step_directory_and_unit_key
from native_store.write_lane_catalog import write_lane_catalog
from support.shared_lane_fixture import (SharedLaneFixture, SharedLaneTestCase, file_bytes_outside_the_sharing_folders, file_number,
                                         link_count, payload_of, synthetic_audio_converter_and_request)
from test_bundle_member_pins import (GOLDEN_CATALOG_BYTES, RAW_CLASS_EXPORT, ProfileBundle, TemporaryStoreTestCase,
                                     synthetic_profile_bundle_members, write_file)

TWIN = payload_of('twin')
OTHER = payload_of('other')
SEALED_LANE_NAMES = ('actors', 'world')
SEALED_UNIT_KEYS = ('mesh:first', 'mesh:second')
SINGLE_PROCESS_WORKER_COUNT = 1


class SealedUnitsStaySealedTests(SharedLaneTestCase):
    def sealed_receipts(self):
        verified_receipts_by_step_directory_and_unit_key.clear()
        return {(lane_name, unit_key): self.lanes.ledger(lane_name).sealed_receipt(unit_key)
                for lane_name in SEALED_LANE_NAMES for unit_key in SEALED_UNIT_KEYS}

    def test_every_sealed_unit_returns_the_same_receipt_after_its_outputs_became_links(self):
        for lane_name in SEALED_LANE_NAMES:
            self.lanes.seal_unit(lane_name, 'mesh:first', {'asset.l2asset': TWIN},
                                 store_files={'models/first/asset.l2asset': TWIN, 'models/first/model.glb': OTHER})
            self.lanes.seal_unit(lane_name, 'mesh:second', {'asset.l2asset': TWIN, 'products/model.glb': OTHER})
        receipts_before = self.sealed_receipts()
        report = self.share(lanes_free_of_conversions=SEALED_LANE_NAMES)
        self.assertEqual(report['sharedNames'], 8)
        self.assertNotIn(None, receipts_before.values())
        self.assertEqual(self.sealed_receipts(), receipts_before)
        for lane_name in SEALED_LANE_NAMES:
            ledger = self.lanes.ledger(lane_name)
            self.assertEqual(link_count(ledger.unit_step_directory('mesh:second') / 'asset.l2asset'), 6)
            self.assertEqual([receipt['unitKey'] for receipt in ledger.sealed_receipts()], list(SEALED_UNIT_KEYS))


class WritersBesideLinkedFilesTests(SharedLaneTestCase):
    def setUp(self):
        super().setUp()
        self.store_path = self.lanes.write_store_file('actors', 'models/first/asset.l2asset', TWIN)
        self.converter_path = self.lanes.write_converter_file('actors', 'asset.l2asset', TWIN)
        self.unit_path = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN}) / 'asset.l2asset'
        self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual([file_number(path) for path in (self.converter_path, self.unit_path)], [file_number(self.store_path)] * 2)

    def bytes_of_the_three_names(self):
        return self.store_path.read_bytes(), self.converter_path.read_bytes(), self.unit_path.read_bytes()

    def test_begin_write_and_seal_of_a_unit_whose_product_was_linked_leave_the_other_names_their_bytes(self):
        self.lanes.begin_unit('actors', 'mesh:first', {'asset.l2asset': OTHER}, config_version=2)
        self.assertEqual((self.bytes_of_the_three_names(), link_count(self.store_path)), ((TWIN, TWIN, OTHER), 2))
        self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': OTHER}, config_version=3)
        self.assertEqual((self.bytes_of_the_three_names(), link_count(self.store_path), link_count(self.unit_path)), ((TWIN, TWIN, OTHER), 2, 1))

    def test_an_immutable_write_onto_a_linked_name_writes_nothing(self):
        immutable_write(self.store_path, TWIN)
        with self.assertRaisesRegex(CatalogWriteError, 'corrupt; preserved'):
            immutable_write(self.store_path, OTHER)
        self.assertEqual((self.bytes_of_the_three_names(), link_count(self.store_path)), ((TWIN, TWIN, TWIN), 3))

    def test_a_replace_by_name_of_a_linked_file_leaves_the_other_names_their_bytes(self):
        replace_file(self.store_path, OTHER)
        self.assertEqual((self.bytes_of_the_three_names(), link_count(self.converter_path)), ((OTHER, TWIN, TWIN), 2))


class LinkedStoreFilesStayValidTests(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.project = self.temporary_root / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        write_file(self.project / 'public' / 'l2' / 'catalog.json', GOLDEN_CATALOG_BYTES)
        self.bundle = ProfileBundle({**synthetic_profile_bundle_members(), RAW_CLASS_EXPORT: payload_of('raw class export')})
        self.bundle.write(lane_store_root(self.project, 'actors'))
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', ('actors',))

    def test_the_pinned_store_verification_and_a_union_rerun_pass_over_linked_store_files(self):
        raw_export_relative = self.bundle.member_relative(RAW_CLASS_EXPORT)
        share_identical_lane_files(self.project / 'artifacts' / 'lane-store', ['actors', 'integration'], False, ())
        stores = [lane_store_root(self.project, lane_name) for lane_name in ('actors', 'integration')]
        self.assertEqual(file_number(stores[0] / raw_export_relative), file_number(stores[1] / raw_export_relative))
        for store in stores:
            verified_store_file_by_key = verify_pinned_store_files(store, json.loads((store / 'catalog.json').read_bytes()),
                                                                   SINGLE_PROCESS_WORKER_COUNT)
            self.assertIn(raw_export_relative.casefold(), verified_store_file_by_key)
        bytes_before = file_bytes_outside_the_sharing_folders(self.project)
        self.assertEqual(write_lane_catalog(self.project, 'integration', ('actors',))['filesWritten'], 0)
        self.assertEqual(file_bytes_outside_the_sharing_folders(self.project), bytes_before)
        self.assertEqual(link_count(stores[0] / raw_export_relative), 2)


class ConverterCacheHitTests(unittest.TestCase):
    def test_a_converter_cache_hit_passes_over_a_content_folder_whose_archive_became_a_link(self):
        lanes = SharedLaneFixture(self)
        converter, request = synthetic_audio_converter_and_request(self, lanes)
        first_result = converter.convert(request)
        archive_path = Path(first_result['file'])
        self.assertGreaterEqual(archive_path.stat().st_size, MINIMUM_SHARED_FILE_BYTES)
        store_path = lanes.write_store_file('actors', 'sounds/first/asset.l2asset', archive_path.read_bytes())
        report = share_identical_lane_files(lanes.lane_stores_root, ['actors'], False, ())
        self.assertEqual((report['sharedNames'], file_number(archive_path)), (1, file_number(store_path)))
        second_result = converter.convert(request)
        self.assertEqual((first_result['cacheHit'], second_result['cacheHit'], second_result['sha256']), (False, True, first_result['sha256']))


if __name__ == '__main__':
    unittest.main()
