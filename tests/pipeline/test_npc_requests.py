import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors import convert_actors
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, NPC_MODEL_UNIT_KIND, conversion_unit_key
from actors.npc_requests import (animation_reference_gap_reason, label_npc_sound_identities, npc_effect_binding_record, npc_model_request,
                                 npc_profile_recipe)
import native_actor_profiles
from native_catalog.ue2 import FormatError
from native_store.gap_rows import read_gap_rows, validate_gap_row
from native_store.store_paths import lane_store_root, lane_work_root
from reference_client_guard import ReferenceClientAccess, read_reference_client_lock

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


class AnimationReferenceGapTests(unittest.TestCase):
    def test_a_null_reference_is_missing_and_a_reference_into_another_package_is_outside_the_mesh_package(self):
        self.assertEqual(animation_reference_gap_reason(None, 'SyntheticMonsters'), 'animation-reference-missing')
        self.assertEqual(animation_reference_gap_reason('OtherAnimations.synthetic_anim', 'SyntheticMonsters'),
                         'animation-outside-mesh-package:OtherAnimations')
        self.assertEqual(animation_reference_gap_reason('syntheticmonsters.synthetic_anim', 'SyntheticMonsters'),
                         'animation-outside-mesh-package:syntheticmonsters')
        self.assertIsNone(animation_reference_gap_reason(SYNTHETIC_ANIMATION, 'SyntheticMonsters'))


class SoundIdentityLabelTests(unittest.TestCase):
    def labels(self, row, exports):
        return {(label['field'], label['index']): label for label in label_npc_sound_identities(row, exports)['labels']}

    def test_a_group_less_reference_with_one_package_leaf_export_is_a_unique_leaf_candidate(self):
        row = {'damage_sound': [{'param_damage_sound': 'MonSound.gremlin_dmg_1'}]}
        label = self.labels(row, {'monsound': ['MonSound.gremlin.gremlin_dmg_1']})[('damage_sound', 0)]
        self.assertEqual((label['status'], label['candidates'], label['gapReason']),
                         ('unique-package-leaf-candidate', ['MonSound.gremlin.gremlin_dmg_1'], None))

    def test_a_reference_without_candidate_is_unresolved_and_an_empty_reference_is_recorded_as_empty_without_a_gap(self):
        row = {'attack_sound1': [{'param_attack_sound1': ''}], 'defense_sound1': [{'param_defense_sound1': 'MonSound.Hit_Missing_1'}],
               'damage_sound': [{'param_damage_sound': 'NoSuchSound.thing'}], 'sound_vol': 50.0, 'sound_radius': 250.0}
        labels = self.labels(row, {'monsound': ['MonSound.gremlin.gremlin_dmg_1']})
        self.assertEqual((labels[('attack_sound1', 0)]['status'], labels[('attack_sound1', 0)]['gapReason']), ('empty', None))
        self.assertEqual(labels[('defense_sound1', 0)]['gapReason'], 'sound-identity-unresolved')
        self.assertEqual((labels[('damage_sound', 0)]['status'], labels[('damage_sound', 0)]['gapReason']),
                         ('sound-package-not-in-client', 'sound-identity-unresolved'))
        self.assertEqual(label_npc_sound_identities(row, {})['numericFields'], {'sound_vol': 50.0, 'sound_radius': 250.0})

    def test_effect_references_are_binding_records_only(self):
        self.assertEqual(npc_effect_binding_record({'attack_effect': 'LineageEffect.p_u002_a', 'deco_effect': []}),
                         [{'field': 'attack_effect', 'index': 0, 'reference': 'LineageEffect.p_u002_a', 'status': 'binding-record-only'}])


class UnresolvedActorDefaultTests(unittest.TestCase):
    def test_a_definition_without_draw_scale_raises_the_typed_error_that_is_still_a_format_error(self):
        selection = npc_profile_recipe(7, {'id': 7, 'name': 'Synthetic'}, synthetic_npcgrp_row(7), model_catalog_id_of(
            {'mesh': SYNTHETIC_MESH, 'textures': [SYNTHETIC_TEXTURE]}), 'npcname-e.dat')['profiles'][0]
        with self.assertRaises(native_actor_profiles.UnresolvedActorDefaultError) as raised:
            native_actor_profiles.resolved_profile(selection, {'effectiveProperties': {
                'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1}, 'CollisionRadius': 10, 'CollisionHeight': 15}}, 100)
        self.assertEqual(raised.exception.field, 'DrawScale')
        self.assertIsInstance(raised.exception, FormatError)


class ConvertActorsGapReasonListTests(unittest.TestCase):
    def test_every_reason_the_actors_converter_writes_is_a_listed_gap_reason(self):
        reasons = [convert_actors.NPC_NAME_ROW_MISSING_REASON, convert_actors.NPC_NAME_EMPTY_REASON,
                   animation_reference_gap_reason(None, 'SyntheticMonsters'), animation_reference_gap_reason('Other.synthetic_anim', 'SyntheticMonsters'),
                   convert_actors.ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + 'DrawScale', convert_actors.CONVERTER_REFUSED_REASON_PREFIX + 'Object missing: x',
                   'sound-identity-unresolved', 'no-mesh-in-row']
        for reason in reasons:
            with self.subTest(reason=reason):
                validate_gap_row({'key': 'npc:20001', 'part': 'npcs', 'step': 'npc-model', 'status': 'gap', 'reason': reason,
                                  'sourceIdentity': {'path': 'system/npcgrp.dat', 'sha256': 'a' * 64}, 'evidence': 'work/npc__20001/npc-model/receipt.json'})


class ConvertNpcGapTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project_root = Path(temporary.name)
        self.converter = Mock(spec=['output', 'package', 'select', 'convert'])
        self.converter.output = self.project_root / 'artifacts' / 'lane-store' / 'actors' / 'converter'
        self.client_access = ReferenceClientAccess(self.project_root / 'client', read_reference_client_lock(REFERENCE_CLIENT_LOCK), True)
        self.convertible_selection = {'mesh': 'LineageMonsters.synthetic_m00', 'textures': ['LineageMonstersTex.synthetic_t00']}
        self.gap_selection = {'mesh': 'LineageMonsters.synthetic_m01', 'textures': ['LineageMonstersTex.synthetic_t01', 'LineageMonstersTex.synthetic_t02']}
        self.npcgrp = synthetic_npcgrp_table(synthetic_npcgrp_row(1, *self.convertible_selection.values()),
                                             synthetic_npcgrp_row(2, *self.gap_selection.values()), synthetic_npcgrp_row(3, mesh='', textures=()))
        self.npcname = {'source': 'system/npcname-e.dat', 'sourceSha256': 'b' * 64, 'data': {'data': 2, 'npc': [
            {'id': 1, 'name': 'Synthetic'}, {'id': 4, 'name': ''}]}}
        mesh_identity = {'path': 'animations/LineageMonsters.ukx', 'sha256': 'c' * 64}
        census = {'tables': [{'table': 'npcgrp', 'path': 'system/npcgrp.dat', 'sha256': 'a' * 64},
                             {'table': 'npcname', 'path': 'system/npcname-e.dat', 'sha256': 'b' * 64}],
                  'units': [{'key': model_catalog_id_of(self.convertible_selection), 'unitKind': NPC_MODEL_UNIT_KIND, 'status': 'convertible',
                             'reason': None, 'sourceIdentity': {**mesh_identity, 'object': 'LineageMonsters.synthetic_m00'}, 'selection': self.convertible_selection},
                            {'key': model_catalog_id_of(self.gap_selection), 'unitKind': NPC_MODEL_UNIT_KIND, 'status': 'gap',
                             'reason': 'multi-slot-binding-unsupported', 'sourceIdentity': mesh_identity, 'selection': self.gap_selection}]}
        census_path = self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH
        census_path.parent.mkdir(parents=True)
        census_path.write_text(json.dumps(census), encoding='utf-8')
        tables = {'npcgrp': self.npcgrp, 'npcname': self.npcname}
        patcher = patch.object(convert_actors, 'decode_table', side_effect=lambda root, name, **options: tables[name])
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_npc(self, npc_id):
        return convert_actors.convert_npc(self.project_root, self.client_access, self.converter, npc_id,
                                          lane_work_root(self.project_root, 'actors'), lane_store_root(self.project_root, 'actors'))

    def conversion_run(self):
        return convert_actors.NpcConversionRun(self.project_root, self.client_access, self.converter, lane_work_root(self.project_root, 'actors'),
                                               lane_store_root(self.project_root, 'actors'))

    def lane_reasons(self):
        return {(row['key'], row['step']): row['reason'] for row in read_gap_rows(self.project_root, 'actors')}

    def test_a_census_gap_row_is_copied_and_sealed_without_any_converter_call_and_skipped_on_rerun(self):
        self.assertEqual([(outcome['status'], outcome['reason'], outcome['cacheHit']) for outcome in self.run_npc(2)],
                         [('gap', 'multi-slot-binding-unsupported', False)])
        self.assertEqual([(outcome['status'], outcome['cacheHit']) for outcome in self.run_npc(2)], [('gap', True)])
        self.assertEqual(self.run_npc(3)[0]['reason'], 'no-mesh-in-row')
        self.assertEqual(self.converter.mock_calls, [])
        self.assertEqual(self.lane_reasons(), {('npc:2', 'npc-model'): 'multi-slot-binding-unsupported', ('npc:3', 'npc-model'): 'no-mesh-in-row'})

    def test_a_missing_and_an_empty_npcname_row_and_an_unresolved_actor_default_are_listed_profile_gaps(self):
        run = self.conversion_run()
        model_unit_key = model_catalog_id_of(self.convertible_selection)
        missing = run.convert_profile(2, 'npc:2', synthetic_npcgrp_row(2), model_unit_key, 'animations/LineageMonsters.ukx')
        empty = run.convert_profile(4, 'npc:4', synthetic_npcgrp_row(4), model_unit_key, 'animations/LineageMonsters.ukx')
        unresolved_default = native_actor_profiles.UnresolvedActorDefaultError('DrawScale', 'Unsupported or unresolved positive native actor field: DrawScale')
        with patch.object(convert_actors, 'migrate_npc_profiles', side_effect=unresolved_default):
            unresolved = run.convert_profile(1, 'npc:1', synthetic_npcgrp_row(1, *self.convertible_selection.values()), model_unit_key,
                                             'animations/LineageMonsters.ukx')
        self.assertEqual([outcome['reason'] for outcome in (missing, empty, unresolved)],
                         ['npc-name-row-missing', 'npc-name-empty', 'actor-default-unresolved:DrawScale'])
        self.assertEqual(self.lane_reasons(), {('npc:1', 'npc-profile'): 'actor-default-unresolved:DrawScale',
                                               ('npc:2', 'npc-profile'): 'npc-name-row-missing', ('npc:4', 'npc-profile'): 'npc-name-empty'})

    def test_a_converter_refusal_is_a_path_free_listed_gap_and_an_os_error_is_failed_and_unsealed(self):
        unit_key = model_catalog_id_of(self.convertible_selection)
        self.converter.package.side_effect = ValueError(f'Package table adapter refused {self.converter.output}\\.work\\x.log')
        refused = self.run_npc(1)[0]
        self.assertTrue(refused['reason'].startswith('converter-refused:Package table adapter refused <output>'), refused['reason'])
        self.assertEqual(self.lane_reasons()[('npc:1', 'npc-model')], refused['reason'])
        shutil.rmtree(lane_work_root(self.project_root, 'actors') / unit_key.replace(':', '__'))
        self.converter.package.side_effect = OSError('disk went away')
        failed = self.run_npc(1)[0]
        self.assertEqual((failed['status'], failed['reason']), ('failed', 'disk went away'))
        self.assertFalse((lane_work_root(self.project_root, 'actors') / unit_key.replace(':', '__') / 'npc-model' / 'complete.json').exists())


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
