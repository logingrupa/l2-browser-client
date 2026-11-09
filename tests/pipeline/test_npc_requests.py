import json
from pathlib import Path, PurePosixPath
import sys
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, NPC_MODEL_UNIT_KIND, conversion_unit_key
from actors.npc_requests import npc_model_request, npc_profile_recipe
import native_actor_profiles
from native_catalog.ue2 import FormatError

REFERENCE_CLIENT_ROOT = Path('E:/Lineage2-client')
REFERENCE_CLIENT_LOCK = REPOSITORY_ROOT / 'recipes' / 'reference-client-tree.lock.json'
SYNTHETIC_MESH = 'SyntheticMonsters.synthetic_m00'
SYNTHETIC_TEXTURE = 'SyntheticMonstersTex.synthetic_t00'
SYNTHETIC_ANIMATION = 'SyntheticMonsters.synthetic_anim'


def synthetic_npcgrp_row(npc_id, mesh=SYNTHETIC_MESH, textures=(SYNTHETIC_TEXTURE,), class_name='SyntheticMonster.synthetic'):
    return {'npc_id': npc_id, 'class_name': class_name, 'mesh_name': mesh,
            'texture_name': [{'param_texture_name': texture} for texture in textures]}


def synthetic_npcgrp_table(*rows):
    return {'source': 'system/npcgrp.dat', 'sourceSha256': 'a' * 64, 'data': {'data': len(rows), 'npc': list(rows)}}


def synthetic_npc_model_unit(selection):
    return {'key': conversion_unit_key(NPC_MODEL_UNIT_KIND, selection), 'selection': selection}


def model_catalog_id_of(selection):
    return conversion_unit_key(NPC_MODEL_UNIT_KIND, selection)


class NpcModelRequestTests(unittest.TestCase):
    def setUp(self):
        self.table = synthetic_npcgrp_table(synthetic_npcgrp_row(1, mesh='Other.other_m00'), synthetic_npcgrp_row(7))
        self.unit = synthetic_npc_model_unit({'mesh': SYNTHETIC_MESH, 'textures': [SYNTHETIC_TEXTURE]})

    def test_request_cites_the_row_mesh_and_texture_fields_and_binds_the_texture_to_material_slot_zero(self):
        request = npc_model_request(self.unit, self.table, 1, SYNTHETIC_ANIMATION)
        self.assertEqual(request['sourceBinding'], {'table': 'npcgrp', 'sourceSha256': 'a' * 64, 'meshPath': ['npc', 1, 'mesh_name'],
                                                    'texturePath': ['npc', 1, 'texture_name', 0, 'param_texture_name']})
        self.assertEqual(request['materials'], [f'0={SYNTHETIC_TEXTURE}'])
        self.assertEqual((request['kind'], request['package'], request['object']), ('model', 'SyntheticMonsters', 'synthetic_m00'))
        self.assertEqual(request['name'], self.unit['key'].replace(':', '-'))
        self.assertTrue(request['withEventAudio'])
        self.assertTrue(any('unverified presentation' in limitation for limitation in request['limitations']))

    def test_request_animation_is_only_the_given_serialized_reference(self):
        self.assertEqual(npc_model_request(self.unit, self.table, 1, SYNTHETIC_ANIMATION)['animation'], SYNTHETIC_ANIMATION)
        request_without_reference = npc_model_request(self.unit, self.table, 1, None)
        self.assertIsNone(request_without_reference['animation'])
        self.assertNotIn('_anim', json.dumps(request_without_reference))

    def test_request_refuses_a_row_that_names_another_mesh_or_texture(self):
        with self.assertRaisesRegex(ValueError, 'exact mesh and textures'):
            npc_model_request(self.unit, self.table, 0, SYNTHETIC_ANIMATION)
        differently_cased_unit = synthetic_npc_model_unit({'mesh': SYNTHETIC_MESH.lower(), 'textures': [SYNTHETIC_TEXTURE]})
        with self.assertRaisesRegex(ValueError, 'exact mesh and textures'):
            npc_model_request(differently_cased_unit, self.table, 1, SYNTHETIC_ANIMATION)


class NpcProfileRecipeTests(unittest.TestCase):
    def setUp(self):
        self.model_catalog_id = model_catalog_id_of({'mesh': SYNTHETIC_MESH, 'textures': [SYNTHETIC_TEXTURE]})
        self.recipe = npc_profile_recipe(7, {'id': 7, 'name': 'Synthetic'}, synthetic_npcgrp_row(7), self.model_catalog_id, 'npcname-e.dat')

    def test_generated_recipe_copies_the_rows_and_passes_the_profile_recipe_validator_with_model_catalog_id(self):
        self.assertEqual(self.recipe['id'], 'interlude:npc-profiles:7')
        self.assertEqual(self.recipe['profiles'], [{'npcId': 7, 'expectedName': 'Synthetic', 'expectedMesh': SYNTHETIC_MESH,
                                                    'expectedActorClass': 'SyntheticMonster.synthetic', 'modelCatalogId': self.model_catalog_id}])
        self.assertEqual(native_actor_profiles._recipe(self.recipe), self.recipe)

    def test_profile_recipe_refuses_a_model_catalog_id_of_the_wrong_form(self):
        for wrong in ('musveren:0', 'npc-model:' + 'A' * 64, 'npc-model:' + 'a' * 63, 7):
            recipe = json.loads(json.dumps(self.recipe))
            recipe['profiles'][0]['modelCatalogId'] = wrong
            with self.subTest(wrong=wrong), self.assertRaisesRegex(FormatError, 'modelCatalogId'):
                native_actor_profiles._recipe(recipe)

    def test_resolved_profile_copies_the_model_catalog_id(self):
        profile = native_actor_profiles.resolved_profile(self.recipe['profiles'][0], {'effectiveProperties': {
            'DrawScale': 1, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1}, 'CollisionRadius': 10, 'CollisionHeight': 15}}, 100)
        self.assertEqual(profile['modelCatalogId'], self.model_catalog_id)

    def test_recipe_refuses_rows_of_another_npc(self):
        with self.assertRaisesRegex(ValueError, 'both belong'):
            npc_profile_recipe(7, {'id': 8, 'name': 'Other'}, synthetic_npcgrp_row(7), self.model_catalog_id, 'npcname-e.dat')


@unittest.skipUnless(REFERENCE_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK.is_file(), 'needs E:/Lineage2-client and the reference client lock')
class GremlinProfileRecipeFromDecodedRowsTests(unittest.TestCase):
    def test_gremlin_recipe_takes_its_mesh_from_the_decoded_row_and_its_name_table_from_the_census(self):
        from native_catalog.tables import decode_table
        from reference_client_guard import require_reference_client
        census = json.loads((REPOSITORY_ROOT / ACTOR_UNIT_CENSUS_RELATIVE_PATH).read_bytes())
        name_table = PurePosixPath(next(table['path'] for table in census['tables'] if table['table'] == 'npcname')).name
        client_root = require_reference_client(REFERENCE_CLIENT_ROOT).root
        npcgrp_row = next(row for row in decode_table(client_root, 'npcgrp')['data']['npc'] if row['npc_id'] == 20001)
        npcname_row = next(row for row in decode_table(client_root, 'npcname', source_filename=name_table)['data']['npc'] if row['id'] == 20001)
        selection = {'mesh': npcgrp_row['mesh_name'], 'textures': [slot['param_texture_name'] for slot in npcgrp_row['texture_name']]}
        recipe = npc_profile_recipe(20001, npcname_row, npcgrp_row, model_catalog_id_of(selection), name_table)
        self.assertEqual(recipe['profiles'][0]['expectedMesh'], 'LineageMonsters.gremlin_m00')
        self.assertEqual(recipe['nameTable'], name_table)
        self.assertEqual(native_actor_profiles._recipe(recipe), recipe)


if __name__ == '__main__':
    unittest.main()
