import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors import item_conversion
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH
from actors.item_census import item_census, run_item_batch
from actors.item_conversion import ItemConversionRun
from actors.item_unit_inventory import weapon_selection
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX
from catalog_store_fixture import model_record, write_store_catalog
from native_store.catalog_writer import read_store_catalog
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import locked_input_records
from test_item_requests import convertible_census_units, item_sources, synthetic_weapon_row

FIRST_CONVERTER_SHA256 = 'c' * 64
CHANGED_CONVERTER_SHA256 = 'd' * 64
WEAPON_ROWS = (synthetic_weapon_row(1), synthetic_weapon_row(2, meshes=('LineageWeapons.long_m00_wp',)),
               synthetic_weapon_row(3, meshes=('LineageWeapons.bow_m00_wp',)), synthetic_weapon_row(4, meshes=('LineageWeapons.axe_m00_wp',)))


def write_actor_unit_census(project_root, weapon_rows):
    census_path = Path(project_root) / ACTOR_UNIT_CENSUS_RELATIVE_PATH
    census_path.parent.mkdir(parents=True)
    census_units = convertible_census_units(*[('weapon-mesh', weapon_selection(row)) for row in weapon_rows])
    census_path.write_text(json.dumps({'tables': [{'table': 'weapongrp', 'rowCount': len(weapon_rows)}, {'table': 'armorgrp', 'rowCount': 0}],
                                       'units': [{**unit, 'unitKind': 'weapon-mesh'} for unit in census_units.values()]}))
    return census_path


class SyntheticItemRun(ItemConversionRun):
    weapon_rows = WEAPON_ROWS
    itemname_ids = (1, 2, 3, 4)

    def __init__(self, project_root, client_root):
        client_access = SimpleNamespace(root=Path(client_root), lock=SimpleNamespace(records_by_path={}))
        converter = SimpleNamespace(output=Path(client_root).parent / 'converter-output')
        super().__init__(project_root, client_access, converter, lane_work_root(project_root, 'actors'), lane_store_root(project_root, 'actors'),
                         item_sources(list(self.weapon_rows), [], itemname_ids=list(self.itemname_ids)))
        self.converted_unit_keys = []
        self.converted_archive = Path(client_root).parent / 'converted.l2asset'
        self.converted_archive.write_bytes(b'synthetic converted archive')

    def converted_model_reason(self, unit):
        self.converted_unit_keys.append(unit['unitKey'])
        return None, {'file': self.converted_archive}


class RefusingItemRun(SyntheticItemRun):
    def converted_model_reason(self, unit):
        self.converted_unit_keys.append(unit['unitKey'])
        return CONVERTER_REFUSED_REASON_PREFIX + 'synthetic refusal', None


def synthetic_model_store_files_and_record(record_id, archive_path):
    return {}, model_record(record_id, 'LineageWeapons.small_sword_m00_wp')


class ItemConversionRunTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        self.project_root, self.client_root = temporary_root / 'project', temporary_root / 'client'
        (self.project_root / 'artifacts').mkdir(parents=True)
        write_actor_unit_census(self.project_root, WEAPON_ROWS)
        for name, replacement in (('converted_model_store_files_and_record', mock.Mock(side_effect=synthetic_model_store_files_and_record)),
                                  ('implementation_hash', mock.Mock(return_value=FIRST_CONVERTER_SHA256)),
                                  ('locked_input_records', mock.Mock(wraps=locked_input_records)),
                                  ('write_store', mock.Mock(wraps=item_conversion.write_store))):
            patcher = mock.patch.object(item_conversion, name, replacement)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def catalog_model_ids(self):
        catalog, _ = read_store_catalog(lane_store_root(self.project_root, 'actors'))
        return [record['id'] for record in catalog['models']]

    def test_a_converted_unit_archive_is_a_second_name_of_its_converter_file_and_its_receipt_holds_its_sha256_and_size(self):
        run = SyntheticItemRun(self.project_root, self.client_root)
        outcome = run.convert(run.units[0])
        archive_copy = run.ledger.unit_step_directory(run.units[0]['unitKey']) / 'asset.l2asset'
        converted_bytes = run.converted_archive.read_bytes()
        self.assertEqual((os.stat(archive_copy).st_ino, os.stat(archive_copy).st_nlink), (os.stat(run.converted_archive).st_ino, 2))
        archive_record = {'path': archive_copy.relative_to(run.ledger.lane_folder).as_posix(),
                          'sha256': hashlib.sha256(converted_bytes).hexdigest(), 'bytes': len(converted_bytes)}
        self.assertEqual((outcome['outputs'], run.ledger.sealed_receipt(run.units[0]['unitKey'])['outputs']), ([archive_record], [archive_record]))

    def test_a_run_asks_for_the_converter_version_and_reads_the_client_lock_once_for_all_of_its_units(self):
        run = SyntheticItemRun(self.project_root, self.client_root)
        outcomes = [run.convert(unit) for unit in run.units]
        run.sealed_outcomes_by_unit_key()
        self.assertEqual([outcome['cacheHit'] for outcome in outcomes], [False] * 4)
        self.assertEqual((self.implementation_hash.call_count, self.locked_input_records.call_count), (1, 1))

    def test_the_batch_preflights_only_units_it_converts_and_writes_the_store_catalog_once(self):
        write_store_catalog(lane_store_root(self.project_root, 'actors'), {'schemaVersion': 1, 'models': []})
        first_run = SyntheticItemRun(self.project_root, self.client_root)
        for unit in first_run.units[:2]:
            first_run.convert(unit)
        self.write_store.reset_mock()
        run, preflights = SyntheticItemRun(self.project_root, self.client_root), []
        outcomes = run_item_batch(run, 1, lambda: preflights.append(True))
        self.assertEqual([outcome['cacheHit'] for outcome in outcomes], [True, True, False])
        catalog_replacing_calls = [call for call in self.write_store.call_args_list if call.args[3] != call.args[2]]
        self.assertEqual((len(preflights), run.converted_unit_keys, len(catalog_replacing_calls)), (1, [run.units[2]['unitKey']], 1))
        self.assertEqual(self.catalog_model_ids(), [f'interlude:item:{item_id}:body-part:7:weapon' for item_id in (1, 2, 3)])

    def test_a_batch_of_units_whose_records_are_all_in_the_catalog_writes_nothing(self):
        run_item_batch(SyntheticItemRun(self.project_root, self.client_root), 4, lambda: None)
        self.write_store.reset_mock()
        outcomes = run_item_batch(SyntheticItemRun(self.project_root, self.client_root), 4, lambda: None)
        self.assertEqual(([outcome['cacheHit'] for outcome in outcomes], self.write_store.call_count), ([True] * 4, 0))

    def test_the_census_reports_units_sealed_under_an_older_converter_as_pending(self):
        run_item_batch(SyntheticItemRun(self.project_root, self.client_root), 4, lambda: None)
        self.implementation_hash.return_value = CHANGED_CONVERTER_SHA256
        run = SyntheticItemRun(self.project_root, self.client_root)
        run_item_batch(run, 1, lambda: None)
        census = item_census(run, 1)
        self.assertEqual(census['units']['weapon'], {'convertible': 4, 'converted': 1, 'gap': 0, 'pending': 3})
        self.assertEqual([row['unitKey'] for row in census['sealedUnits']], [run.units[0]['unitKey']])
        self.assertEqual(census['items']['pending'], 3)

    def test_a_unit_that_reconverts_into_a_gap_removes_its_model_record(self):
        run_item_batch(SyntheticItemRun(self.project_root, self.client_root), 4, lambda: None)
        self.implementation_hash.return_value = CHANGED_CONVERTER_SHA256
        run = RefusingItemRun(self.project_root, self.client_root)
        outcomes = run_item_batch(run, 1, lambda: None)
        self.assertEqual([outcome['status'] for outcome in outcomes], ['gap'])
        self.assertEqual(self.catalog_model_ids(), [f'interlude:item:{item_id}:body-part:7:weapon' for item_id in (2, 3, 4)])


if __name__ == '__main__':
    unittest.main()
