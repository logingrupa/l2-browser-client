import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.item_requests import ItemRequestError, build_weapon_unit_request, item_model_record_id

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SYNTHETIC_WEAPONGRP_SHA256 = 'e' * 64
EQUIPMENT_RECIPE_PATH = ROOT / 'recipes' / 'native-equipment.json'


def synthetic_weapon_row(object_id, meshes=('LineageWeapons.small_sword_m00_wp',), textures=('LineageWeaponsTex.small_sword_t00_wp',),
                         body_part=7):
    return {'object_id': object_id, 'body_part': body_part, 'wp_mesh': {'wp_mesh': len(meshes), 'mesh_0_': [{'mesh0': mesh} for mesh in meshes]},
            'texture': [{'texture0': texture} for texture in textures]}


def synthetic_weapongrp(rows):
    return {'source': 'system/weapongrp.dat', 'sourceSha256': SYNTHETIC_WEAPONGRP_SHA256, 'data': {'item': rows}}


class WeaponUnitRequestTracerTests(unittest.TestCase):
    def test_one_mesh_and_one_texture_give_one_request_shaped_like_the_reviewed_item_one_binding(self):
        entry = build_weapon_unit_request(synthetic_weapongrp([synthetic_weapon_row(1)]), 0)
        self.assertIsNone(entry['reason'])
        self.assertEqual(entry['recordId'], 'interlude:item:1:body-part:7:weapon')
        request = entry['request']
        self.assertEqual((request['package'], request['object']), ('LineageWeapons', 'small_sword_m00_wp'))
        self.assertEqual(request['materials'], ['0=LineageWeaponsTex.small_sword_t00_wp'])
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


@unittest.skipUnless((REFERENCE_CLIENT / 'system' / 'weapongrp.dat').is_file(), 'E:/Lineage2-client is absent; the item 1 cross-check needs it')
class ReferenceClientItemOneCrossCheckTests(unittest.TestCase):
    def test_generated_item_one_request_equals_the_reviewed_small_sword_recipe(self):
        from native_catalog.tables import decode_table
        weapongrp = decode_table(REFERENCE_CLIENT, 'weapongrp')
        row_index = next(index for index, row in enumerate(weapongrp['data']['item']) if row['object_id'] == 1)
        request = build_weapon_unit_request(weapongrp, row_index)['request']
        recipe = next(entry for entry in json.loads(EQUIPMENT_RECIPE_PATH.read_text(encoding='utf-8'))
                      if entry['name'] == 'Native-Small-Sword-ClassID1')
        for field in ('package', 'object', 'materials', 'sourceBinding'):
            self.assertEqual(request[field], recipe[field], field)


if __name__ == '__main__':
    unittest.main()
