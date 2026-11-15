import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import item_conversion
from actors.actor_unit_inventory import conversion_unit_key
from actors.item_census import run_item_batch, write_item_census_and_gap_rows
from actors.item_requests import item_gap_rows
from actors.item_unit_inventory import weapon_selection
from catalog_store_fixture import model_record, write_store_catalog
from native_assets_lib.gltf import json_bytes
from native_store import gap_rows
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, add_store_file
from native_store.gap_rows import GapRowError, gap_reason_list_versions
from native_store.store_paths import lane_gap_rows_path, lane_store_root
from native_store.unit_ledger import UnitLedger
from test_item_conversion_run import FIRST_CONVERTER_SHA256, WEAPON_ROWS, SyntheticItemRun, write_actor_unit_census
from test_item_requests import TABLE_IDENTITIES, synthetic_weapon_row

SWORD_OBJECT_NAME, LONG_SWORD_OBJECT_NAME, BOW_OBJECT_NAME = 'small_sword_m00_wp', 'long_m00_wp', 'bow_m00_wp'
SHARED_SWORD_ROWS = (synthetic_weapon_row(1), synthetic_weapon_row(2))
REFUSED_LONG_SWORD_ROW = synthetic_weapon_row(3, meshes=('LineageWeapons.long_m00_wp',))
BOW_ROW = synthetic_weapon_row(4, meshes=('LineageWeapons.bow_m00_wp',))
AXE_ROW_BEYOND_THE_LIMIT = synthetic_weapon_row(5, meshes=('LineageWeapons.axe_m00_wp',))
BOOKKEEPING_WEAPON_ROWS = (*SHARED_SWORD_ROWS, REFUSED_LONG_SWORD_ROW, BOW_ROW, AXE_ROW_BEYOND_THE_LIMIT)
ITEM_NAME_IDS_WITH_ONE_UNGROUPED = (1, 2, 3, 4, 5, 6)
SLICE_LIMIT = 3
REFUSAL_REASON = 'converter-refused:synthetic refusal'
UNLISTED_REASON = 'Unlisted reason'
SLOT_MEANING_REASON = 'equipment-slot-meaning-undecoded:7'
ITEM_CENSUS_RELATIVE_PATH = 'docs/parts/items/item-census.json'
FOREIGN_MODEL_RECORD = model_record('interlude:npc:1', 'LineageMonsters.gremlin')


def item_record_id(item_id):
    return f'interlude:item:{item_id}:body-part:7:weapon'


def synthetic_archive_bytes(object_name):
    return b'synthetic archive of ' + object_name.encode('ascii')


def archive_record(record_id, archive_bytes):
    archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
    return {'id': record_id, 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256,
            'archiveBytes': len(archive_bytes)}


def archive_store_relative_path(object_name):
    return archive_record('', synthetic_archive_bytes(object_name))['archive'][len('/l2/'):]


def archive_derived_store_files_and_record(record_id, archive_path):
    archive_bytes = Path(archive_path).read_bytes()
    record = archive_record(record_id, archive_bytes)
    files = {}
    add_store_file(files, record['archive'][len('/l2/'):], archive_bytes)
    return files, record


def weapon_unit_key(row):
    return conversion_unit_key('weapon-mesh', weapon_selection(row))


def expected_item_records():
    return [archive_record(item_record_id(1), synthetic_archive_bytes(SWORD_OBJECT_NAME)),
            archive_record(item_record_id(2), synthetic_archive_bytes(SWORD_OBJECT_NAME)),
            archive_record(item_record_id(4), synthetic_archive_bytes(BOW_OBJECT_NAME))]


def expected_gap_row(item_id, status, reason):
    return {'key': f'item:{item_id}', 'part': 'items', 'step': 'items', 'status': status, 'reason': reason,
            'sourceIdentity': {'path': 'system/weapongrp.dat', 'sha256': TABLE_IDENTITIES['weapongrp']['sha256']},
            'evidence': ITEM_CENSUS_RELATIVE_PATH}


def expected_gap_row_document():
    return {'schemaVersion': 1, 'lane': 'actors', 'step': 'items', 'reasonListVersions': gap_reason_list_versions(),
            'rows': [expected_gap_row(1, 'gap', SLOT_MEANING_REASON), expected_gap_row(2, 'gap', SLOT_MEANING_REASON),
                     expected_gap_row(3, 'gap', REFUSAL_REASON), expected_gap_row(4, 'gap', SLOT_MEANING_REASON),
                     expected_gap_row(5, 'pending', 'conversion-pending')]}


def expected_sealed_unit_row(row, status, reason, item_ids):
    return {'unitKey': weapon_unit_key(row), 'unitKind': 'weapon', 'status': status, 'reason': reason, 'itemIds': item_ids,
            'recordIds': [item_record_id(item_id) for item_id in item_ids]}


def expected_census():
    return {'schemaVersion': 1,
            'sources': {'weapongrp': 'e' * 64, 'armorgrp': 'f' * 64, 'itemname-e': 'a' * 64, 'etcitemgrp': 'b' * 64},
            'denominator': 6,
            'units': {'weapon': {'convertible': 4, 'converted': 2, 'gap': 1, 'pending': 1},
                      'armor': {'convertible': 0, 'converted': 0, 'gap': 0, 'pending': 0}},
            'items': {'converted': 3, 'gap': {REFUSAL_REASON: 1, 'item-group-row-absent': 1}, 'pending': 1},
            'sealedUnits': [expected_sealed_unit_row(SHARED_SWORD_ROWS[0], 'pass', None, [1, 2]),
                            expected_sealed_unit_row(REFUSED_LONG_SWORD_ROW, 'gap', REFUSAL_REASON, [3]),
                            expected_sealed_unit_row(BOW_ROW, 'pass', None, [4])],
            'sliceLimit': SLICE_LIMIT}


class BookkeepingItemRun(SyntheticItemRun):
    weapon_rows = BOOKKEEPING_WEAPON_ROWS
    itemname_ids = ITEM_NAME_IDS_WITH_ONE_UNGROUPED

    def converted_model_reason(self, unit):
        self.converted_unit_keys.append(unit['unitKey'])
        object_name = unit['request']['object']
        if object_name == LONG_SWORD_OBJECT_NAME:
            return REFUSAL_REASON, None
        archive_path = self.converted_archive.with_name(object_name + '.l2asset')
        archive_path.write_bytes(synthetic_archive_bytes(object_name))
        return None, {'file': archive_path}


class UnlistedReasonItemRun(BookkeepingItemRun):
    def converted_model_reason(self, unit):
        return UNLISTED_REASON, None


class ItemBatchFixture:
    weapon_rows = BOOKKEEPING_WEAPON_ROWS

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        self.project_root, self.client_root = temporary_root / 'project', temporary_root / 'client'
        (self.project_root / 'artifacts').mkdir(parents=True)
        write_actor_unit_census(self.project_root, self.weapon_rows)
        self.store_root = lane_store_root(self.project_root, 'actors')
        self.catalog_path = self.store_root / 'catalog.json'
        for name, replacement in (('converted_model_store_files_and_record', mock.Mock(side_effect=archive_derived_store_files_and_record)),
                                  ('implementation_hash', mock.Mock(return_value=FIRST_CONVERTER_SHA256)),
                                  ('write_store', mock.Mock(wraps=item_conversion.write_store))):
            patcher = mock.patch.object(item_conversion, name, replacement)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)


class ItemBatchByteIdentityTests(ItemBatchFixture, unittest.TestCase):
    def test_one_batch_writes_the_catalog_the_gap_rows_and_the_census_with_the_expected_bytes(self):
        run = BookkeepingItemRun(self.project_root, self.client_root)
        outcomes = run_item_batch(run, SLICE_LIMIT, lambda: None)
        census_path = write_item_census_and_gap_rows(run, SLICE_LIMIT)
        self.assertEqual([(outcome['status'], outcome['cacheHit']) for outcome in outcomes], [('pass', False), ('gap', False), ('pass', False)])
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes({'schemaVersion': 1, 'models': expected_item_records()}))
        self.assertEqual(lane_gap_rows_path(self.project_root, 'actors', 'items').read_bytes(), canonical_json_bytes(expected_gap_row_document()))
        self.assertEqual(census_path, self.project_root / ITEM_CENSUS_RELATIVE_PATH)
        self.assertEqual(census_path.read_bytes(), (json.dumps(expected_census(), indent=1, sort_keys=True, ensure_ascii=True) + '\n').encode('ascii'))

    def test_the_archive_of_a_unit_with_two_record_ids_is_read_once(self):
        run = BookkeepingItemRun(self.project_root, self.client_root)
        run_item_batch(run, SLICE_LIMIT, lambda: None)
        sealed_archive_paths = [run.ledger.unit_step_directory(weapon_unit_key(row)) / 'asset.l2asset' for row in (SHARED_SWORD_ROWS[0], BOW_ROW)]
        self.assertEqual([call.args for call in self.converted_model_store_files_and_record.call_args_list],
                         [(item_record_id(1), sealed_archive_paths[0]), (item_record_id(4), sealed_archive_paths[1])])
        for object_name in (SWORD_OBJECT_NAME, BOW_OBJECT_NAME):
            self.assertEqual((self.store_root / archive_store_relative_path(object_name)).read_bytes(), synthetic_archive_bytes(object_name))


class ItemBatchStoreWriteTests(ItemBatchFixture, unittest.TestCase):
    def written_relative_paths_by_call(self):
        return [sorted(relative for relative, _ in call.args[1].values()) for call in self.write_store.call_args_list]

    def test_a_store_with_a_catalog_gets_the_files_of_one_unit_per_call_and_one_catalog_replacement(self):
        stale_refused_record = model_record(item_record_id(3), 'LineageWeapons.long_m00_wp')
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [FOREIGN_MODEL_RECORD, stale_refused_record]})
        run_item_batch(BookkeepingItemRun(self.project_root, self.client_root), SLICE_LIMIT, lambda: None)
        self.assertEqual([call.args[3] != call.args[2] for call in self.write_store.call_args_list], [False, False, True])
        self.assertEqual(self.written_relative_paths_by_call(),
                         [[archive_store_relative_path(SWORD_OBJECT_NAME)], [archive_store_relative_path(BOW_OBJECT_NAME)], []])
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes({'schemaVersion': 1, 'models': [*expected_item_records(), FOREIGN_MODEL_RECORD]}))

    def test_a_store_without_a_catalog_never_gets_no_catalog_bytes_to_write(self):
        self.assertFalse(self.catalog_path.exists())
        run_item_batch(BookkeepingItemRun(self.project_root, self.client_root), SLICE_LIMIT, lambda: None)
        self.assertEqual([call.args[3] is None for call in self.write_store.call_args_list], [False, False, False])
        self.assertEqual(self.written_relative_paths_by_call(),
                         [[archive_store_relative_path(SWORD_OBJECT_NAME)], [archive_store_relative_path(BOW_OBJECT_NAME)], []])
        self.assertEqual(self.catalog_path.read_bytes(), json_bytes({'schemaVersion': 1, 'models': expected_item_records()}))

    def test_a_slice_over_the_model_capacity_is_refused_after_its_unit_files_and_keeps_the_catalog(self):
        foreign_records = [model_record(f'interlude:npc:{npc_id}', 'LineageMonsters.gremlin') for npc_id in (1, 2, 3)]
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': foreign_records})
        seeded_catalog_bytes = self.catalog_path.read_bytes()
        with self.assertRaises(CatalogWriteError) as refusal:
            run_item_batch(BookkeepingItemRun(self.project_root, self.client_root), SLICE_LIMIT, lambda: None)
        self.assertEqual(str(refusal.exception), f'catalog models capacity {len(BOOKKEEPING_WEAPON_ROWS)} exceeded')
        self.assertEqual(self.catalog_path.read_bytes(), seeded_catalog_bytes)
        for object_name in (SWORD_OBJECT_NAME, BOW_OBJECT_NAME):
            self.assertEqual((self.store_root / archive_store_relative_path(object_name)).read_bytes(), synthetic_archive_bytes(object_name))


class ItemGapRowValidationTests(ItemBatchFixture, unittest.TestCase):
    def test_building_the_item_gap_rows_loads_no_reason_patterns(self):
        run = BookkeepingItemRun(self.project_root, self.client_root)
        with mock.patch.object(gap_rows, 'load_gap_reason_patterns', wraps=gap_rows.load_gap_reason_patterns) as load_gap_reason_patterns:
            rows = item_gap_rows(run.grouped_items, run.census_units_by_key, {}, run.sources.identities)
        self.assertEqual(([row['key'] for row in rows], load_gap_reason_patterns.call_count), ([f'item:{item_id}' for item_id in range(1, 6)], 0))

    def test_a_unit_with_an_unlisted_gap_reason_is_refused_at_its_seal(self):
        run = UnlistedReasonItemRun(self.project_root, self.client_root)
        with self.assertRaises(GapRowError) as refusal:
            run.convert(run.units[0])
        self.assertEqual(str(refusal.exception), f'gap row item:1 status gap needs a listed reason: {UNLISTED_REASON!r}')
        self.assertEqual(run.sealed_outcomes_by_unit_key(), {})


class ItemBatchReceiptReadTests(ItemBatchFixture, unittest.TestCase):
    weapon_rows = WEAPON_ROWS

    def test_a_slice_reads_the_receipt_of_a_unit_sealed_at_process_start_once(self):
        earlier_run = SyntheticItemRun(self.project_root, self.client_root)
        for unit in earlier_run.units[:2]:
            earlier_run.convert(unit)
        receipt_was_returned_by_unit_key = {}
        sealed_receipt = UnitLedger.sealed_receipt

        def recorded_sealed_receipt(ledger, unit_key):
            receipt = sealed_receipt(ledger, unit_key)
            receipt_was_returned_by_unit_key.setdefault(unit_key, []).append(receipt is not None)
            return receipt

        preflights = []
        with mock.patch.object(UnitLedger, 'sealed_receipt', recorded_sealed_receipt):
            run = SyntheticItemRun(self.project_root, self.client_root)
            outcomes = run_item_batch(run, 1, lambda: preflights.append(True))
            write_item_census_and_gap_rows(run, 1)
        sealed_first, sealed_second, converted_in_the_slice, beyond_the_limit = [unit['unitKey'] for unit in run.units]
        self.assertEqual(([outcome['cacheHit'] for outcome in outcomes], len(preflights)), ([True, True, False], 1))
        self.assertEqual(receipt_was_returned_by_unit_key, {sealed_first: [True], sealed_second: [True],
                                                            converted_in_the_slice: [False, False, True], beyond_the_limit: [False]})


if __name__ == '__main__':
    unittest.main()
