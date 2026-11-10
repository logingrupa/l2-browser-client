import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.actor_unit_inventory import conversion_unit_key
from actors.item_census import run_item_batch
from actors.item_conversion import ItemSources, conversion_units, grouped_item_entries
from actors.item_requests import (ItemRequestError, build_armor_unit_requests, build_weapon_unit_request, item_gap_rows, item_model_record_id,
                                  ungrouped_item_reason)
from actors.item_unit_inventory import armor_column_selection, weapon_selection
from actors.npc_store_records import converted_model_store_files_and_record
from native_assets import verify_archive

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SYNTHETIC_WEAPONGRP_SHA256 = 'e' * 64
SYNTHETIC_ARMORGRP_SHA256 = 'f' * 64
EQUIPMENT_RECIPE_PATH = ROOT / 'recipes' / 'native-equipment.json'
ACTORS_LANE_STORE = ROOT / 'artifacts' / 'lane-store' / 'actors' / 'l2'
SWORD_MESH, SWORD_TEXTURE = 'LineageWeapons.small_sword_m00_wp', 'LineageWeaponsTex.small_sword_t00_wp'
ARMOR_COLUMNS = ('m_HumnFigh', 'f_HumnFigh', 'm_DarkElf')
ITEM_MODEL_RECORD_FIELDS = {'id', 'assetId', 'source', 'archive', 'archiveSha256', 'model', 'modelSha256', 'nativeSkinAdapter', 'limitations'}
TABLE_IDENTITIES = {table: {'path': f'system/{table}.dat', 'sha256': character * 64}
                    for table, character in (('weapongrp', 'e'), ('armorgrp', 'f'), ('itemname-e', 'a'), ('etcitemgrp', 'b'))}


def synthetic_weapon_row(object_id, meshes=(SWORD_MESH,), textures=(SWORD_TEXTURE,), body_part=7):
    return {'object_id': object_id, 'body_part': body_part, 'wp_mesh': {'wp_mesh': len(meshes), 'mesh_0_': [{'mesh0': mesh} for mesh in meshes]},
            'texture': [{'texture0': texture} for texture in textures]}


def synthetic_weapongrp(rows):
    return {'source': 'system/weapongrp.dat', 'sourceSha256': SYNTHETIC_WEAPONGRP_SHA256, 'data': {'item': rows}}


def armor_column(meshes, textures):
    return {'var_0_': {'mtx_size_1_': len(meshes), 'for_mtx_size_1_': [{'mtx_mesh_': mesh} for mesh in meshes],
                       'mtx_size_2_': len(textures), 'for_mtx_size_2_': [{'mtx_text_': texture} for texture in textures]}}


def synthetic_armor_row(object_id, columns, body_part=10):
    return {'object_id': object_id, 'body_part': body_part, **{name: armor_column(*columns.get(name, ((), ()))) for name in ARMOR_COLUMNS}}


def synthetic_armorgrp(rows):
    return {'source': 'system/armorgrp.dat', 'sourceSha256': SYNTHETIC_ARMORGRP_SHA256, 'data': {'item': rows}}


def item_sources(weapon_rows, armor_rows, itemname_ids=(), etcitem_ids=()):
    return ItemSources(synthetic_weapongrp(weapon_rows), synthetic_armorgrp(armor_rows), list(ARMOR_COLUMNS), list(itemname_ids),
                       frozenset(etcitem_ids), TABLE_IDENTITIES)


def convertible_census_units(*selections_by_kind):
    return {conversion_unit_key(kind, selection): {'key': conversion_unit_key(kind, selection), 'status': 'convertible', 'reason': None}
            for kind, selection in selections_by_kind}


class WeaponUnitRequestTracerTests(unittest.TestCase):
    def test_one_mesh_and_one_texture_give_one_request_shaped_like_the_reviewed_item_one_binding(self):
        entry = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(1)]), 0)
        self.assertIsNone(entry['reason'])
        self.assertEqual(entry['recordId'], 'interlude:item:1:body-part:7:weapon')
        request = entry['request']
        self.assertEqual((request['package'], request['object']), ('LineageWeapons', 'small_sword_m00_wp'))
        self.assertEqual(request['materials'], [f'0={SWORD_TEXTURE}'])
        self.assertEqual(request['sourceBinding'], {'table': 'weapongrp', 'sourceSha256': SYNTHETIC_WEAPONGRP_SHA256,
                                                    'meshPath': ['item', 0, 'wp_mesh', 'mesh_0_', 0, 'mesh0'],
                                                    'texturePath': ['item', 0, 'texture', 0, 'texture0']})
        self.assertNotIn('animation', request)

    def test_item_model_record_ids_name_the_item_the_body_part_and_the_unit_kind(self):
        self.assertEqual(item_model_record_id(1, 7, 'weapon'), 'interlude:item:1:body-part:7:weapon')
        self.assertEqual(item_model_record_id(22, 10, 'armor', 0), 'interlude:item:22:body-part:10:armor:0')
        for arguments in ((1, 7, 'weapon', 0), (22, 10, 'armor'), (1, 7, 'shield'), (-1, 7, 'weapon'), (1, True, 'weapon'), (1, 7.0, 'weapon')):
            with self.assertRaises(ItemRequestError, msg=repr(arguments)):
                item_model_record_id(*arguments)

    def test_one_mesh_with_two_textures_binds_each_texture_list_index_to_its_material_slot(self):
        entry = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(3, textures=('Tex.a', 'Tex.b'))]), 0)
        self.assertEqual(entry['request']['materials'], ['0=Tex.a', '1=Tex.b'])
        self.assertEqual(entry['request']['sourceBinding']['slotBindings'], [
            {'slot': 0, 'texturePath': ['item', 0, 'texture', 0, 'texture0']}, {'slot': 1, 'texturePath': ['item', 0, 'texture', 1, 'texture0']}])


class ArmorUnitRequestTests(unittest.TestCase):
    def test_one_unit_per_non_empty_race_column_in_source_order_and_an_empty_column_names_its_ordinal(self):
        row = synthetic_armor_row(22, {'m_HumnFigh': (('Fighter.MFighter_m001_u',), ('MFighter.MFighter_m001_t04_u',)),
                                       'm_DarkElf': (('Fighter.MDarkElf_m001_u',), ('MDarkElf.MDarkElf_m001_t01_u',))})
        entries = build_armor_unit_requests(synthetic_armorgrp([row]), 0, ARMOR_COLUMNS)
        self.assertEqual([(entry['raceColumnOrdinal'], entry['raceColumn'], entry['reason']) for entry in entries],
                         [(0, 'm_HumnFigh', None), (1, 'f_HumnFigh', 'no-mesh-in-row'), (2, 'm_DarkElf', None)])
        self.assertIsNone(entries[1]['unitKey'])
        self.assertEqual(entries[0]['recordId'], 'interlude:item:22:body-part:10:armor:0')
        self.assertEqual(entries[2]['request']['sourceBinding'], {
            'table': 'armorgrp', 'sourceSha256': SYNTHETIC_ARMORGRP_SHA256,
            'meshPath': ['item', 0, 'm_DarkElf', 'var_0_', 'for_mtx_size_1_', 0, 'mtx_mesh_'],
            'texturePath': ['item', 0, 'm_DarkElf', 'var_0_', 'for_mtx_size_2_', 0, 'mtx_text_']})
        self.assertEqual(entries[0]['unitKey'], conversion_unit_key('armor-mesh', armor_column_selection(row, 'm_HumnFigh')))

    def test_two_meshes_in_a_column_are_a_pairing_gap_instead_of_a_chosen_pairing(self):
        row = synthetic_armor_row(26, {'m_HumnFigh': (('Fighter.A_l', 'Fighter.A_g'), ('MFighter.A_t_l', 'MFighter.A_t_g'))})
        self.assertEqual(build_armor_unit_requests(synthetic_armorgrp([row]), 0, ARMOR_COLUMNS)[0]['reason'], 'mesh-texture-pairing-undecoded:2/2')


class ItemEdgeTests(unittest.TestCase):
    def test_an_item_without_a_weapon_or_armor_row_is_an_etcitem_gap_or_an_ungrouped_gap(self):
        self.assertEqual(ungrouped_item_reason(57, {57}), 'etcitem-presentation-unplanned')
        self.assertEqual(ungrouped_item_reason(58, {57}), 'item-group-row-absent')

    def test_an_empty_weapon_mesh_is_no_mesh_in_row_without_a_unit(self):
        entry = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(5, meshes=('',), textures=('',))]), 0)
        self.assertEqual((entry['reason'], entry['unitKey'], entry['request']), ('no-mesh-in-row', None, None))
        rows = item_gap_rows(grouped_item_entries(item_sources([synthetic_weapon_row(5, meshes=('',), textures=('',))], [])), {}, {},
                             TABLE_IDENTITIES)
        self.assertEqual([(row['key'], row['status'], row['reason']) for row in rows], [('item:5', 'gap', 'no-mesh-in-row')])

    def test_three_items_sharing_one_mesh_and_texture_share_one_unit_and_keep_three_record_ids(self):
        sources = item_sources([synthetic_weapon_row(2), synthetic_weapon_row(3), synthetic_weapon_row(4)], [])
        census = convertible_census_units(('weapon-mesh', weapon_selection(synthetic_weapon_row(2))))
        units = conversion_units(grouped_item_entries(sources), census)
        self.assertEqual(len(units), 1)
        self.assertEqual([entry['recordId'] for entry in units[0]['entries']],
                         [f'interlude:item:{item_id}:body-part:7:weapon' for item_id in (2, 3, 4)])
        self.assertEqual(units[0]['request']['sourceBinding']['meshPath'][:2], ['item', 0])

    def test_a_bare_reference_is_an_actor_default_gap_never_a_package_fallback(self):
        bare_mesh = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(6, meshes=('small_sword_m00_wp',))]), 0)
        bare_texture = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(6, textures=('small_sword_t00_wp',))]), 0)
        self.assertEqual((bare_mesh['reason'], bare_texture['reason']), ('actor-default-unresolved:mesh0', 'actor-default-unresolved:texture0'))
        quoted = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(241, meshes=("LineageWeapons.knife_o'_silenus_m00_wp",))]), 0)
        self.assertIsNone(quoted['reason'])

    def test_units_follow_ascending_item_ids_with_race_columns_in_source_order_and_reruns_are_byte_identical(self):
        armor = synthetic_armor_row(22, {'m_DarkElf': (('Fighter.B_u',), ('T.b',)), 'm_HumnFigh': (('Fighter.A_u',), ('T.a',))})
        weapons = [synthetic_weapon_row(1), synthetic_weapon_row(30, meshes=('LineageWeapons.long_m00_wp',), textures=('LineageWeaponsTex.long_t00_wp',))]
        sources = item_sources(weapons, [armor])
        census = convertible_census_units(*[(entry['unitKind'], selection) for entry, selection in (
            (build_weapon_unit_request(sources.weapongrp, index), weapon_selection(row)) for index, row in enumerate(weapons))],
            *[('armor-mesh', armor_column_selection(armor, column)) for column in ('m_HumnFigh', 'm_DarkElf')])
        units = conversion_units(grouped_item_entries(sources), census)
        self.assertEqual([(unit['firstItemId'], unit['entries'][0]['raceColumnOrdinal']) for unit in units], [(1, None), (22, 0), (22, 2), (30, None)])
        first = json.dumps([unit['request'] for unit in units], sort_keys=True)
        self.assertEqual(json.dumps([unit['request'] for unit in conversion_units(grouped_item_entries(sources), census)], sort_keys=True), first)

    def test_a_converted_item_row_is_the_equipment_slot_meaning_gap_until_a_decoded_meaning_exists(self):
        sources = item_sources([synthetic_weapon_row(1)], [])
        unit_key = conversion_unit_key('weapon-mesh', weapon_selection(synthetic_weapon_row(1)))
        census = convertible_census_units(('weapon-mesh', weapon_selection(synthetic_weapon_row(1))))
        pending, converted = (item_gap_rows(grouped_item_entries(sources), census, outcomes, TABLE_IDENTITIES)[0]
                              for outcomes in ({}, {unit_key: {'status': 'pass', 'reason': None}}))
        self.assertEqual((pending['status'], pending['reason']), ('pending', 'conversion-pending'))
        self.assertEqual((converted['status'], converted['reason'], converted['step']), ('gap', 'equipment-slot-meaning-undecoded:7', 'items'))

    def test_a_census_gap_unit_gives_the_item_its_census_reason_and_no_conversion_unit(self):
        sources = item_sources([synthetic_weapon_row(1)], [])
        unit_key = conversion_unit_key('weapon-mesh', weapon_selection(synthetic_weapon_row(1)))
        census = {unit_key: {'key': unit_key, 'status': 'gap', 'reason': 'skeletal-licensee-unsupported:123/31'}}
        self.assertEqual(conversion_units(grouped_item_entries(sources), census), [])
        self.assertEqual(item_gap_rows(grouped_item_entries(sources), census, {}, TABLE_IDENTITIES)[0]['reason'], 'skeletal-licensee-unsupported:123/31')


class ItemBatchSliceTests(unittest.TestCase):
    def test_sealed_units_are_skipped_without_counting_and_the_slice_stops_at_its_limit(self):
        class RecordingRun:
            units = [{'unitKey': f'weapon-mesh:{index}'} for index in range(5)]
            sealed = {'weapon-mesh:0', 'weapon-mesh:1'}
            converted = []

            def convert(self, unit):
                self.converted.append(unit['unitKey'])
                return {'key': unit['unitKey'], 'status': 'pass', 'cacheHit': unit['unitKey'] in self.sealed}
        run, preflights = RecordingRun(), []
        outcomes = run_item_batch(run, 2, lambda: preflights.append(True))
        self.assertEqual([outcome['key'] for outcome in outcomes], ['weapon-mesh:0', 'weapon-mesh:1', 'weapon-mesh:2', 'weapon-mesh:3'])
        self.assertEqual(len(preflights), 4)


@unittest.skipUnless((REFERENCE_CLIENT / 'system' / 'weapongrp.dat').is_file(), 'E:/Lineage2-client is absent; the item cross-checks need it')
class ReferenceClientItemCrossCheckTests(unittest.TestCase):
    def recipe(self, name):
        return next(entry for entry in json.loads(EQUIPMENT_RECIPE_PATH.read_text(encoding='utf-8')) if entry['name'] == name)

    def test_generated_item_one_request_equals_the_reviewed_small_sword_recipe(self):
        from native_catalog.tables import decode_table
        weapongrp = decode_table(REFERENCE_CLIENT, 'weapongrp')
        row_index = next(index for index, row in enumerate(weapongrp['data']['item']) if row['object_id'] == 1)
        request = build_weapon_unit_request(weapongrp, row_index)['request']
        recipe = self.recipe('Native-Small-Sword-ClassID1')
        for field in ('package', 'object', 'materials', 'sourceBinding'):
            self.assertEqual(request[field], recipe[field], field)

    def test_generated_item_twenty_two_male_fighter_column_equals_the_reviewed_leather_shirt_recipe(self):
        from actors.item_unit_inventory import armorgrp_mtx_column_names
        from native_catalog.tables import decode_table
        armorgrp = decode_table(REFERENCE_CLIENT, 'armorgrp')
        row_index = next(index for index, row in enumerate(armorgrp['data']['item']) if row['object_id'] == 22)
        entry = build_armor_unit_requests(armorgrp, row_index, armorgrp_mtx_column_names(armorgrp))[0]
        recipe = self.recipe('MFighter-Leather-Shirt-ClassID22')
        self.assertEqual(entry['raceColumn'], 'm_HumnFigh')
        for field in ('package', 'object', 'materials', 'sourceBinding'):
            self.assertEqual(entry['request'][field], recipe[field], field)


@unittest.skipUnless((ACTORS_LANE_STORE / 'catalog.json').is_file(), 'the actors lane store has no catalog; run convert_actors.py --item 1 first')
class ConvertedItemPackageTests(unittest.TestCase):
    def test_every_converted_item_package_keeps_every_listed_file_and_its_record_adds_no_socket_or_attachment_data(self):
        models = json.loads((ACTORS_LANE_STORE / 'catalog.json').read_bytes())['models']
        item_records = [record for record in models if record['id'].startswith('interlude:item:')]
        if not item_records:
            self.skipTest('no item model record is converted in the actors lane store')
        for record in item_records:
            with self.subTest(record['id']):
                archive_path = ACTORS_LANE_STORE / record['archive'].removeprefix('/l2/')
                verify_archive(archive_path)
                self.assertEqual(set(record), ITEM_MODEL_RECORD_FIELDS)
                _, rebuilt = converted_model_store_files_and_record(record['id'], archive_path)
                self.assertEqual(rebuilt, record)


if __name__ == '__main__':
    unittest.main()
