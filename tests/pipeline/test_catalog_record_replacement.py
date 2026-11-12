from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import npc_store_records
from actors.npc_store_records import catalog_with_records_replaced, catalog_without_records, write_catalog_without_record
from catalog_store_fixture import write_store_catalog
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import CatalogWriteError


def revised_record(record_id, revision):
    return {'id': record_id, 'revision': revision}


def catalog_of(*model_records):
    return {'schemaVersion': 1, 'models': list(model_records)}


class CatalogRecordsReplacedTests(unittest.TestCase):
    def test_a_repeated_incoming_id_keeps_its_last_record_at_the_place_of_its_last_occurrence(self):
        catalog = catalog_of(revised_record('a', 1), revised_record('b', 1), revised_record('c', 1))
        incoming = [revised_record('b', 2), revised_record('d', 1), revised_record('b', 3)]
        replaced = catalog_with_records_replaced(catalog, 'models', incoming, 4)
        self.assertEqual(replaced, catalog_of(revised_record('a', 1), revised_record('c', 1), revised_record('d', 1), revised_record('b', 3)))
        self.assertEqual(catalog, catalog_of(revised_record('a', 1), revised_record('b', 1), revised_record('c', 1)))

    def test_one_replacement_of_many_records_merges_once(self):
        catalog = catalog_of(revised_record('a', 1), revised_record('b', 1), revised_record('c', 1))
        incoming = [revised_record('b', 2), revised_record('d', 1), revised_record('b', 3)]
        with mock.patch.object(npc_store_records, 'merge_catalog_slice_records',
                               wraps=npc_store_records.merge_catalog_slice_records) as merge_catalog_slice_records:
            catalog_with_records_replaced(catalog, 'models', incoming, 4)
        self.assertEqual(merge_catalog_slice_records.call_count, 1)

    def test_no_incoming_record_returns_the_same_catalog_and_adds_no_slice(self):
        catalog = catalog_of(revised_record('a', 1))
        with mock.patch.object(npc_store_records, 'merge_catalog_slice_records',
                               wraps=npc_store_records.merge_catalog_slice_records) as merge_catalog_slice_records:
            replaced = catalog_with_records_replaced(catalog, 'npcProfiles', [], 1)
        self.assertIs(replaced, catalog)
        self.assertEqual((catalog, merge_catalog_slice_records.call_count), (catalog_of(revised_record('a', 1)), 0))

    def test_a_record_without_a_string_id_is_refused_before_its_id_is_read(self):
        catalog = catalog_of(revised_record('a', 1))
        for record_without_string_id in ({'revision': 1}, {'id': 7, 'revision': 1}, {'id': '', 'revision': 1}):
            with self.subTest(record=record_without_string_id):
                with self.assertRaises(CatalogWriteError) as refusal:
                    catalog_with_records_replaced(catalog, 'models', [revised_record('b', 1), record_without_string_id], 4)
                self.assertEqual(str(refusal.exception), 'catalog models record needs a string id')

    def test_the_capacity_is_judged_on_the_record_count_after_the_whole_replacement(self):
        catalog = catalog_of(revised_record('a', 1), revised_record('b', 1))
        at_capacity = catalog_with_records_replaced(catalog, 'models', [revised_record('b', 2)], 2)
        self.assertEqual(at_capacity, catalog_of(revised_record('a', 1), revised_record('b', 2)))
        with self.assertRaises(CatalogWriteError) as refusal:
            catalog_with_records_replaced(catalog, 'models', [revised_record('b', 2), revised_record('c', 1)], 2)
        self.assertEqual(str(refusal.exception), 'catalog models capacity 2 exceeded')
        self.assertEqual(catalog, catalog_of(revised_record('a', 1), revised_record('b', 1)))


class CatalogWithoutRecordsTests(unittest.TestCase):
    def test_an_absent_slice_or_an_empty_id_set_returns_the_same_catalog(self):
        catalog = catalog_of(revised_record('a', 1))
        self.assertIs(catalog_without_records(catalog, 'npcProfiles', {'a'}), catalog)
        self.assertIs(catalog_without_records(catalog, 'models', set()), catalog)
        self.assertEqual(catalog, catalog_of(revised_record('a', 1)))

    def test_the_kept_records_stay_in_order_and_the_other_slices_stay(self):
        profile_record = revised_record('b', 9)
        catalog = {**catalog_of(*[revised_record(record_id, 1) for record_id in 'dcba']), 'npcProfiles': [profile_record]}
        pruned = catalog_without_records(catalog, 'models', {'c', 'a', 'absent'})
        self.assertEqual(pruned, {**catalog_of(revised_record('d', 1), revised_record('b', 1)), 'npcProfiles': [profile_record]})
        self.assertEqual([record['id'] for record in catalog['models']], ['d', 'c', 'b', 'a'])


class WriteCatalogWithoutRecordTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.store_root = Path(temporary_directory.name).resolve() / 'project' / 'artifacts' / 'lane-store' / 'actors' / 'l2'
        write_store_catalog(self.store_root, catalog_of(revised_record('a', 1), revised_record('b', 1)))
        self.catalog_path = self.store_root / 'catalog.json'

    def test_an_absent_id_writes_nothing_and_a_present_id_is_removed(self):
        seeded_bytes = self.catalog_path.read_bytes()
        with mock.patch.object(npc_store_records, 'write_store', wraps=npc_store_records.write_store) as write_store:
            write_catalog_without_record(self.store_root, 'models', 'absent')
            write_catalog_without_record(self.store_root, 'npcProfiles', 'a')
            self.assertEqual((write_store.call_count, self.catalog_path.read_bytes()), (0, seeded_bytes))
            write_catalog_without_record(self.store_root, 'models', 'a')
        self.assertEqual((write_store.call_count, self.catalog_path.read_bytes()), (1, json_bytes(catalog_of(revised_record('b', 1)))))


if __name__ == '__main__':
    unittest.main()
