from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from catalog_store_fixture import model_record, write_profile_manifest
from native_store.catalog_index_keys import catalog_index_keys
from native_store.coverage_denominators import CoverageReportError

GOLDEN_STORE_ROOT = ROOT / 'tests' / 'fixtures' / 'golden' / 'l2'
CATALOG_INDEX_KEYS_FIXTURE_PATH = ROOT / 'tests' / 'fixtures' / 'catalog-index-keys.json'
MUSVEREN_MESH = 'LineageMonsters.field_stalker_m00'
FIGHTER_MESH = 'Fighter.MFighter_m001_u'
SABER_TOOTHED_TIGER_EXPORT = 'LineageMonsters.Saber_toothed_tiger_m00'
SABER_TOOTHED_TIGER_NPCGRP_SPELLING = 'LineageMonsters.saber_toothed_tiger_m00'


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

    def npc_keys(self, profiles, models=None):
        record = write_profile_manifest(self.store_root, 'native-npc-profiles', profiles)
        catalog = {'schemaVersion': 1, 'models': self.models if models is None else models, 'npcProfiles': [record]}
        return catalog_index_keys(self.store_root, catalog, self.shared_store_root)

    def test_an_npc_profile_with_a_model_catalog_id_joins_only_a_staged_model(self):
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH, 'modelCatalogId': 'musveren:0'}]), ('npc:21622',))
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH, 'modelCatalogId': 'musveren:9'}]), ())

    def test_an_npc_profile_naming_a_model_of_another_mesh_is_refused_like_the_browser_catalog_index(self):
        with self.assertRaisesRegex(CoverageReportError, "NPC profile 21622 names model musveren:0 of a different mesh: the model source object "
                                                         "is 'LineageMonsters.field_stalker_m00', the profile mesh is 'Other.mesh'"):
            self.npc_keys([{'npcId': 21622, 'mesh': 'Other.mesh', 'modelCatalogId': 'musveren:0'}])

    def test_an_npc_profile_mesh_differing_from_its_model_only_in_case_is_refused(self):
        models = [*self.models, model_record('npc-model:' + 'a' * 64, SABER_TOOTHED_TIGER_EXPORT)]
        profile = {'npcId': 16015, 'mesh': SABER_TOOTHED_TIGER_NPCGRP_SPELLING, 'modelCatalogId': 'npc-model:' + 'a' * 64}
        with self.assertRaisesRegex(CoverageReportError, 'NPC profile 16015 names model npc-model:a{64} of a different mesh'):
            self.npc_keys([profile], models)
        self.assertEqual(self.npc_keys([dict(profile, mesh=SABER_TOOTHED_TIGER_EXPORT)], models), ('npc:16015',))

    def test_a_model_listed_twice_is_refused_like_the_browser_catalog_index(self):
        with self.assertRaisesRegex(CoverageReportError, 'catalog models list model musveren:0 twice'):
            self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], [*self.models, model_record('musveren:0', MUSVEREN_MESH)])

    def test_an_npc_profile_without_a_model_catalog_id_needs_exactly_one_model_with_its_mesh(self):
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}]), ('npc:21622',))
        self.assertEqual(self.npc_keys([{'npcId': 21622, 'mesh': 'LineageMonsters.unstaged_m00'}]), ())
        duplicate_models = [*self.models, model_record('musveren:1', MUSVEREN_MESH)]
        with self.assertRaisesRegex(CoverageReportError, 'musveren:0, musveren:1'):
            self.npc_keys([{'npcId': 21622, 'mesh': MUSVEREN_MESH}], duplicate_models)

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
                   'effectComponents': [{'id': 'interlude:skill:3:level:1:raw-source-dispatch'}, {'id': 'interlude:footsteps'}],
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


if __name__ == '__main__':
    unittest.main()
