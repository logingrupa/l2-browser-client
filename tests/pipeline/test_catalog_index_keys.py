from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.character_requests import CHARACTER_STEP
from actors.item_requests import ITEM_STEP
from actors.skill_binding_table import SKILLS_GAP_ROW_STEP
from catalog_store_fixture import model_record, write_profile_manifest
from convert_tables import DECODE_STEP
from convert_ui import LAYOUT_STEP
from native_store.catalog_index_keys import (CHARACTER_MODEL_STEP_NAME, ITEM_MODEL_STEP_NAME, SKILL_EFFECT_GAP_ROW_STEP_NAME,
                                             TABLE_DECODE_STEP_NAME, TABLE_NAME_INDEX_STEP_NAME, TILE_MANIFEST_STEP_NAME, WINDOW_LAYOUT_STEP_NAME,
                                             CatalogRecordUnit, catalog_index_keys, catalog_record_unit, catalog_record_unit_key,
                                             character_model_record_id)
from native_store.coverage_denominators import CoverageReportError
from table_name_indexes import NAME_INDEX_STEP
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME as CONVERTER_TILE_MANIFEST_STEP_NAME

GOLDEN_STORE_ROOT = ROOT / 'tests' / 'fixtures' / 'golden' / 'l2'
CATALOG_INDEX_KEYS_FIXTURE_PATH = ROOT / 'tests' / 'fixtures' / 'catalog-index-keys.json'
MUSVEREN_MESH = 'LineageMonsters.field_stalker_m00'
FIGHTER_MESH = 'Fighter.MFighter_m001_u'
SABER_TOOTHED_TIGER_EXPORT = 'LineageMonsters.Saber_toothed_tiger_m00'
SABER_TOOTHED_TIGER_NPCGRP_SPELLING = 'LineageMonsters.saber_toothed_tiger_m00'
MUSVEREN_NPC_MODEL_ID = 'npc-model:' + 'c' * 64
LANE_NPC_PROFILE_PACK_RECORD_ID = 'interlude:npc-profiles:pack-0123456789abcdef'


def golden_catalog():
    return json.loads((GOLDEN_STORE_ROOT / 'catalog.json').read_text(encoding='utf-8'))


class CatalogIndexKeysGoldenAgreementTests(unittest.TestCase):
    def test_python_keys_equal_the_contract_keys_of_the_golden_catalog(self):
        fixture = json.loads(CATALOG_INDEX_KEYS_FIXTURE_PATH.read_text(encoding='utf-8'))
        self.assertEqual(fixture['catalog'], 'tests/fixtures/golden/l2/catalog.json')
        self.assertEqual(list(catalog_index_keys(GOLDEN_STORE_ROOT, golden_catalog())), fixture['keys'],
                         'catalog_index_keys over tests/fixtures/golden/l2 differs from tests/fixtures/catalog-index-keys.json')

    def test_a_refused_tiles_tables_or_windows_record_raises_before_any_key_is_counted(self):
        refused_records = {
            'tiles': {'id': '0_0', 'manifest': '/l2/tiles/x/tile.json', 'manifestSha256': 'x', 'manifestBytes': 1},
            'tables': {**golden_catalog()['tables'][0], 'recordCount': -1},
            'windows': {**golden_catalog()['windows'][0], 'note': 'extra field'},
        }
        for slice_name, record in refused_records.items():
            with self.subTest(slice_name), self.assertRaisesRegex(CoverageReportError, f'catalog slice {slice_name} holds a refused record'):
                catalog_index_keys(GOLDEN_STORE_ROOT, {**golden_catalog(), slice_name: [record]})


class CatalogIndexKeysJoinTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.store_root = Path(temporary_directory.name).resolve() / 'lane' / 'l2'
        self.shared_store_root = Path(temporary_directory.name).resolve() / 'shared' / 'l2'
        self.store_root.mkdir(parents=True)
        self.shared_store_root.mkdir(parents=True)
        self.models = [model_record('musveren:0', MUSVEREN_MESH), model_record('human-male-fighter:0', 'Magic.MMagic_M005_u'),
                       model_record('fighter-equipment:0', FIGHTER_MESH)]

    def npc_keys(self, profiles, models=None, pack_record_id='native-npc-profiles'):
        record = {**write_profile_manifest(self.store_root, 'native-npc-profiles', profiles), 'id': pack_record_id}
        catalog = {'schemaVersion': 1, 'models': self.models if models is None else models, 'npcProfiles': [record]}
        return catalog_index_keys(self.store_root, catalog, self.shared_store_root)

    def test_an_npc_profile_with_a_model_catalog_id_joins_only_a_staged_model(self):
        models = [*self.models, model_record(MUSVEREN_NPC_MODEL_ID, MUSVEREN_MESH)]
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH, 'modelCatalogId': MUSVEREN_NPC_MODEL_ID}], models,
                                       LANE_NPC_PROFILE_PACK_RECORD_ID), ('npc:21622',))
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH, 'modelCatalogId': 'npc-model:' + 'b' * 64}], models,
                                       LANE_NPC_PROFILE_PACK_RECORD_ID), ())

    def test_an_npc_profile_model_catalog_id_must_be_an_npc_model_id_like_the_browser_catalog_index(self):
        with self.assertRaisesRegex(CoverageReportError, r"NPC profile 21622 modelCatalogId must match \^npc-model:\[a-f0-9\]\{64\}\$: 'musveren:0'"):
            self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH, 'modelCatalogId': 'musveren:0'}])

    def test_an_npc_profile_without_a_model_catalog_id_outside_the_shared_store_bundle_is_refused_like_the_browser_catalog_index(self):
        with self.assertRaisesRegex(CoverageReportError, f'NPC profile 21622 in bundle {LANE_NPC_PROFILE_PACK_RECORD_ID} has no model catalog id'):
            self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], pack_record_id=LANE_NPC_PROFILE_PACK_RECORD_ID)

    def test_an_npc_profile_naming_a_model_of_another_mesh_is_refused_like_the_browser_catalog_index(self):
        models = [*self.models, model_record(MUSVEREN_NPC_MODEL_ID, MUSVEREN_MESH)]
        with self.assertRaisesRegex(CoverageReportError, f"NPC profile 21622 names model {MUSVEREN_NPC_MODEL_ID} of a different mesh: the model source "
                                                         "object is 'LineageMonsters.field_stalker_m00', the profile mesh is 'Other.mesh'"):
            self.npc_keys([{'npcId': 21622, 'mesh': 'Other.mesh', 'modelCatalogId': MUSVEREN_NPC_MODEL_ID}], models)

    def test_an_npc_profile_mesh_differing_from_its_model_only_in_case_is_refused(self):
        models = [*self.models, model_record('npc-model:' + 'a' * 64, SABER_TOOTHED_TIGER_EXPORT)]
        profile = {'npcId': 16015, 'mesh': SABER_TOOTHED_TIGER_NPCGRP_SPELLING, 'modelCatalogId': 'npc-model:' + 'a' * 64}
        with self.assertRaisesRegex(CoverageReportError, 'NPC profile 16015 names model npc-model:a{64} of a different mesh'):
            self.npc_keys([profile], models)
        self.assertEqual(self.npc_keys([dict(profile, mesh=SABER_TOOTHED_TIGER_EXPORT)], models), ('npc:16015',))

    def test_a_model_listed_twice_is_refused_like_the_browser_catalog_index(self):
        with self.assertRaisesRegex(CoverageReportError, 'catalog models list model musveren:0 twice'):
            self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], [*self.models, model_record('musveren:0', MUSVEREN_MESH)])

    def test_a_shared_store_npc_profile_without_a_model_catalog_id_joins_exactly_one_legacy_model_with_its_mesh(self):
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}]), ('npc:21622',))
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': 'LineageMonsters.unstaged_m00'}]), ())
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], [*self.models, model_record('musveren:1', MUSVEREN_MESH)]), ())

    def test_a_shared_store_npc_profile_without_a_model_catalog_id_never_joins_an_npc_model_record_like_the_browser_catalog_index(self):
        lane_model = model_record(MUSVEREN_NPC_MODEL_ID, MUSVEREN_MESH)
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], [*self.models, lane_model]), ('npc:21622',))
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], [lane_model]), ())

    def test_player_profiles_give_item_keys_and_character_keys_for_staged_models(self):
        record = write_profile_manifest(self.store_root, 'native-player-profiles', [
            {'id': 'human-male-fighter', 'catalogId': 'human-male-fighter:0', 'chargrpIndex': 0,
             'upperItems': [{'catalogId': 'fighter-equipment:0', 'itemId': 22}, {'catalogId': 'unstaged:0', 'itemId': 23}]},
            {'id': 'human-female-fighter', 'catalogId': 'unstaged:1', 'chargrpIndex': 1, 'upperItems': []},
            {'id': 'human-male-mystic', 'catalogId': 'human-male-fighter:0', 'upperItems': []},
        ])
        catalog = {'schemaVersion': 1, 'models': self.models, 'playerProfiles': [record]}
        self.assertEqual(catalog_index_keys(self.store_root, catalog, self.shared_store_root), ('character:0', 'item:22'))

    def test_item_model_records_give_item_keys_like_the_browser_catalog_index(self):
        models = [model_record('interlude:item:1:body-part:7:weapon', 'LineageWeapons.small_sword_m00_wp'),
                  model_record('interlude:item:26:body-part:6:armor:2', 'Fighter.FFighter_m002_l'),
                  model_record('interlude:item:01:body-part:7:weapon', 'LineageWeapons.other_m00_wp'),
                  model_record('interlude:item:5:body-part:7:weapon:0', 'LineageWeapons.other_m00_wp')]
        catalog = {'schemaVersion': 1, 'models': models}
        self.assertEqual(catalog_index_keys(self.store_root, catalog, self.shared_store_root), ('item:1', 'item:26'))

    def test_skill_keys_come_from_effect_component_ids_and_tile_keys_from_tiles_and_legacy_sections(self):
        catalog = {'schemaVersion': 1, 'models': [],
                   'effectComponents': [{'id': 'interlude:skill:3:level:1:raw-source-dispatch'}, {'id': 'interlude:footsteps'},
                                        {'id': 'interlude:skill-dispatch-class:LineageEffect.s_u010_b'}],
                   'sections': [{'id': 'map-20-20-section'}, {'id': 'map-00-00-section'}, {'id': 'map-20-20-movers'}],
                   'tiles': golden_catalog()['tiles']}
        self.assertEqual(catalog_index_keys(self.store_root, catalog, self.shared_store_root), ('skill:3:1', 'tile:00_00', 'tile:20_20'))

    def test_a_profile_manifest_whose_bytes_differ_from_its_pin_is_refused(self):
        record = write_profile_manifest(self.store_root, 'native-npc-profiles', [{'npcId': 21622, 'mesh': MUSVEREN_MESH}])
        manifest_path = self.store_root / record['manifest'][len('/l2/'):]
        manifest_path.write_bytes(manifest_path.read_bytes().replace(b'21622', b'21623'))
        catalog = {'schemaVersion': 1, 'models': self.models, 'npcProfiles': [record]}
        with self.assertRaisesRegex(CoverageReportError, 'SHA-256 or byte length'):
            catalog_index_keys(self.store_root, catalog, self.shared_store_root)

    def test_a_manifest_only_in_the_shared_store_root_is_read_from_there(self):
        record = write_profile_manifest(self.shared_store_root, 'native-npc-profiles', [{'npcId': 21622, 'mesh': MUSVEREN_MESH}])
        catalog = {'schemaVersion': 1, 'models': self.models, 'npcProfiles': [record]}
        self.assertEqual(catalog_index_keys(self.store_root, catalog, self.shared_store_root), ('npc:21622',))
        with self.assertRaisesRegex(CoverageReportError, 'in neither store root'):
            catalog_index_keys(self.store_root, catalog)


class CatalogRecordUnitKeyTests(unittest.TestCase):
    def test_each_record_id_maps_to_the_unit_key_its_converter_writes_or_to_none(self):
        expected_unit_key_by_record = {
            ('models', character_model_record_id(8)): 'character:8',
            ('models', 'interlude:item:26:body-part:6:armor:2'): 'item:26',
            ('models', 'interlude:item:01:body-part:7:weapon'): None,
            ('models', 'character-model:08'): None,
            ('models', 'npc-model:' + 'c' * 64): None,
            ('tiles', '20_21'): 'tile:20_21',
            ('tables', 'actionname-e'): 'table:actionname-e',
            ('windows', 'StatusWnd#2'): 'window:StatusWnd#2',
            ('sections', 'map-20-20-section'): 'tile:20_20',
            ('sections', 'map-20-20-movers'): None,
            ('effectComponents', 'interlude:skill:3:level:1:raw-source-dispatch'): 'skill:3:1',
            ('effectComponents', 'interlude:footsteps'): None,
            ('npcProfiles', 'native-npc-profiles'): None,
        }
        for (slice_name, record_id), unit_key in expected_unit_key_by_record.items():
            with self.subTest(slice_name=slice_name, record_id=record_id):
                self.assertEqual(catalog_record_unit_key(slice_name, record_id), unit_key)

    def test_each_record_maps_to_the_step_that_writes_its_slice(self):
        expected_unit_by_record = {
            ('models', character_model_record_id(8)): CatalogRecordUnit('character:8', 'characters'),
            ('models', 'interlude:item:26:body-part:6:armor:2'): CatalogRecordUnit('item:26', 'items'),
            ('tiles', '20_21'): CatalogRecordUnit('tile:20_21', 'manifest'),
            ('sections', 'map-20-20-section'): CatalogRecordUnit('tile:20_20', 'manifest'),
            ('tables', 'actionname-e'): CatalogRecordUnit('table:actionname-e', 'decode'),
            ('tables', 'itemname_e_names'): CatalogRecordUnit('table:itemname_e_names', 'name-index'),
            ('windows', 'StatusWnd#2'): CatalogRecordUnit('window:StatusWnd#2', 'layout'),
            ('effectComponents', 'interlude:skill:3:level:1:raw-source-dispatch'): CatalogRecordUnit('skill:3:1', 'skills'),
            ('models', 'npc-model:' + 'c' * 64): None,
        }
        for (slice_name, record_id), unit in expected_unit_by_record.items():
            with self.subTest(slice_name=slice_name, record_id=record_id):
                self.assertEqual(catalog_record_unit(slice_name, record_id), unit)

    def test_each_owning_step_name_is_the_step_name_its_converter_writes(self):
        self.assertEqual((CHARACTER_MODEL_STEP_NAME, ITEM_MODEL_STEP_NAME, TILE_MANIFEST_STEP_NAME, TABLE_DECODE_STEP_NAME,
                          TABLE_NAME_INDEX_STEP_NAME, WINDOW_LAYOUT_STEP_NAME, SKILL_EFFECT_GAP_ROW_STEP_NAME),
                         (CHARACTER_STEP, ITEM_STEP, CONVERTER_TILE_MANIFEST_STEP_NAME, DECODE_STEP, NAME_INDEX_STEP, LAYOUT_STEP,
                          SKILLS_GAP_ROW_STEP))


if __name__ == '__main__':
    unittest.main()
