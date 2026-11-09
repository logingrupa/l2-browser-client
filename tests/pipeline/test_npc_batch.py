import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from actors import convert_actors, npc_batch
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, NPC_MODEL_UNIT_KIND, conversion_unit_key
from native_store.catalog_writer import add_store_file
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import BatchPreflightRefusedError
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, ReferenceClientAccess, read_reference_client_lock

MESH_PACKAGE_PATH = 'animations/LineageMonsters.ukx'
OTHER_MESH_PACKAGE_PATH = 'animations/LineageNpcs.ukx'
MODEL_CATALOG_ID_PATTERN = re.compile(r'^npc-model:[a-f0-9]{64}$')
SYNTHETIC_TOOL_PINS = {'synthetic': 1}


def synthetic_selection(name, texture_count=1):
    return {'mesh': f'LineageMonsters.{name}_m00', 'textures': [f'LineageMonstersTex.{name}_t0{index}' for index in range(texture_count)]}


def synthetic_npcgrp_row(npc_id, selection, class_name=None):
    return {'npc_id': npc_id, 'class_name': class_name or f'LineageMonster.class_{npc_id}', 'mesh_name': selection['mesh'],
            'texture_name': [{'param_texture_name': texture} for texture in selection['textures']]}


def synthetic_unit(selection, package_path=MESH_PACKAGE_PATH):
    return {'key': conversion_unit_key(NPC_MODEL_UNIT_KIND, selection), 'part': 'npcs', 'unitKind': NPC_MODEL_UNIT_KIND, 'status': 'convertible',
            'reason': None, 'selection': selection, 'sourceIdentity': {'path': package_path, 'sha256': 'c' * 64, 'object': selection['mesh']}}


def synthetic_closure(class_name):
    return ('Core.Object', 'Engine.Actor', class_name)


class SyntheticMeshPackages:
    def __init__(self, mesh_spellings):
        self.mesh_spellings = mesh_spellings

    def resolve(self, reference, expected_class):
        return {'object': self.mesh_spellings.get(reference, reference), 'resolution': 'exact-qualified-object'}, None, None


class SyntheticSourceIdentities(npc_batch.NpcSourceIdentities):
    def __init__(self, closure_of=synthetic_closure, mesh_spellings=None):
        super().__init__(SyntheticMeshPackages(mesh_spellings or {}))
        self.closure_of = closure_of

    def class_closure(self, class_reference):
        return self.closure_of(class_reference)


def directory_snapshot(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns) for path in sorted(root.rglob('*')) if path.is_file()}


class FakeConverter:
    def __init__(self, output):
        self.output, self.converted_requests, self.failure = output, [], None

    def package(self, package_name):
        if self.failure:
            raise self.failure
        return Path(package_name), SimpleNamespace(package_name='LineageMonsters')

    def select(self, package, mesh, expected_class):
        return {'object': mesh, 'className': expected_class}

    def convert(self, request):
        self.converted_requests.append(request)
        archive_path = self.output / f'{request["name"]}.l2asset'
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        archive_path.write_bytes(json.dumps(request, sort_keys=True).encode('utf-8'))
        return {'file': archive_path, 'cacheHit': False}


def fake_migrate_npc_profiles(client_root, recipe, bundle_root):
    bundle_root.mkdir(parents=True, exist_ok=True)
    manifest = {'id': recipe['id'], 'profiles': [{'id': f'npc:{profile["npcId"]}', 'npcId': profile['npcId'],
                                                  'modelCatalogId': profile['modelCatalogId']} for profile in recipe['profiles']],
                'excludedProfiles': [], 'recipe': recipe}
    (bundle_root / 'manifest.json').write_bytes(json.dumps(manifest, sort_keys=True).encode('utf-8'))
    (bundle_root / 'receipt.json').write_bytes(b'{"schemaVersion":1}')


def fake_profile_bundle_store_files_and_record(client_root, bundle_root):
    manifest_bytes = (bundle_root / 'manifest.json').read_bytes()
    manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    files = {}
    add_store_file(files, f'npc-profiles/{manifest_sha256}/manifest.json', manifest_bytes)
    return files, {'id': json.loads(manifest_bytes)['id'], 'manifest': f'/l2/npc-profiles/{manifest_sha256}/manifest.json',
                   'manifestSha256': manifest_sha256, 'manifestBytes': len(manifest_bytes)}


def fake_converted_model_store_files_and_record(record_id, archive_path):
    archive_bytes = Path(archive_path).read_bytes()
    archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
    files = {}
    add_store_file(files, f'{archive_sha256}/asset.l2asset', archive_bytes)
    return files, {'id': record_id, 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256}


class NpcBatchFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project_root = Path(temporary.name)
        self.selections = [synthetic_selection('alpha'), synthetic_selection('beta', 2), synthetic_selection('gamma')]
        self.npcgrp = {'source': 'system/npcgrp.dat', 'sourceSha256': 'a' * 64, 'data': {'npc': [
            synthetic_npcgrp_row(30, self.selections[2]), synthetic_npcgrp_row(11, self.selections[0]),
            synthetic_npcgrp_row(20, self.selections[1]), synthetic_npcgrp_row(12, self.selections[0])]}}
        self.npcname = {'source': 'system/npcname-e.dat', 'sourceSha256': 'b' * 64, 'data': {'npc': [
            {'id': 11, 'name': 'Alpha one'}, {'id': 12, 'name': 'Alpha two'}, {'id': 20, 'name': 'Beta'}, {'id': 30, 'name': 'Gamma'}]}}
        self.census = {'tables': [{'table': 'npcgrp', 'path': 'system/npcgrp.dat', 'sha256': 'a' * 64},
                                  {'table': 'npcname', 'path': 'system/npcname-e.dat', 'sha256': 'b' * 64}],
                       'units': [synthetic_unit(selection) for selection in self.selections]}
        self.write_census()
        tables = {'npcgrp': self.npcgrp, 'npcname': self.npcname}
        for target, name, replacement in ((convert_actors, 'decode_table', lambda root, name, **options: tables[name]),
                                          (convert_actors, 'serialized_animation_reference', lambda package, mesh_export: 'LineageMonsters.synthetic_anim'),
                                          (npc_batch, 'migrate_npc_profiles', fake_migrate_npc_profiles),
                                          (npc_batch, 'profile_bundle_store_files_and_record', fake_profile_bundle_store_files_and_record),
                                          (npc_batch, 'converted_model_store_files_and_record', fake_converted_model_store_files_and_record)):
            patcher = patch.object(target, name, side_effect=replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.converter = FakeConverter(self.project_root / 'artifacts' / 'lane-store' / 'actors' / 'converter')
        self.client_access = ReferenceClientAccess(self.project_root / 'client', read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH), True)
        self.preflight_calls = 0
        self.refuse_on_preflight_call = None

    def write_census(self):
        census_path = self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH
        census_path.parent.mkdir(parents=True, exist_ok=True)
        census_path.write_text(json.dumps(self.census), encoding='utf-8')

    def preflight(self):
        self.preflight_calls += 1
        if self.preflight_calls == self.refuse_on_preflight_call:
            raise BatchPreflightRefusedError('free disk 1 bytes is below the batch floor 2 bytes')

    def conversion_run(self):
        return convert_actors.NpcConversionRun(self.project_root, self.client_access, self.converter, lane_work_root(self.project_root, 'actors'),
                                               lane_store_root(self.project_root, 'actors'))

    def run_slice(self, limit=20, excluded_npc_ids=()):
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table, SyntheticSourceIdentities(), excluded_npc_ids)
        return npc_batch.run_npc_batch_slice(run, plan, limit, self.preflight, lambda: SYNTHETIC_TOOL_PINS)

    def model_step_directory(self, selection):
        return lane_work_root(self.project_root, 'actors') / conversion_unit_key(NPC_MODEL_UNIT_KIND, selection).replace(':', '__') / 'npc-model'

    def lane_gap_reasons(self, step):
        return {row['key']: row['reason'] for row in read_gap_rows(self.project_root, 'actors') if row['step'] == step}


class NpcBatchResumeTests(NpcBatchFixture):
    def test_a_second_slice_converts_nothing_and_leaves_the_lane_store_bytes_and_times_unchanged(self):
        first = self.run_slice()
        self.assertEqual(first['convertedUnits'], 3)
        self.assertEqual([outcome['status'] for outcome in first['packOutcomes']], ['pass'])
        store_root = lane_store_root(self.project_root, 'actors')
        catalog = json.loads((store_root / 'catalog.json').read_bytes())
        self.assertEqual(len(catalog['models']), 3)
        self.assertEqual([record['id'] for record in catalog['npcProfiles']], [npc_batch.npc_profile_pack_id([11, 12, 20, 30])])
        before = directory_snapshot(store_root)
        second = self.run_slice()
        self.assertEqual((second['convertedUnits'], second['unitOutcomes'], second['stopReason']), (0, [], None))
        self.assertEqual([outcome['cacheHit'] for outcome in second['packOutcomes']], [True])
        self.assertEqual(directory_snapshot(store_root), before)
        self.assertEqual(len(self.converter.converted_requests), 3)

    def test_a_unit_left_running_without_a_seal_is_converted_again(self):
        self.run_slice()
        step_directory = self.model_step_directory(self.selections[1])
        (step_directory / 'complete.json').unlink()
        (step_directory / '.running.json').write_text('{}', encoding='utf-8')
        again = self.run_slice()
        self.assertEqual([outcome['key'] for outcome in again['unitOutcomes']], [conversion_unit_key(NPC_MODEL_UNIT_KIND, self.selections[1])])
        self.assertTrue((step_directory / 'complete.json').is_file())
        self.assertFalse((step_directory / '.running.json').exists())

    def test_units_convert_in_batch_order_with_the_rows_of_each_unit_in_npc_id_order(self):
        self.census['units'][2] = synthetic_unit(self.selections[2], OTHER_MESH_PACKAGE_PATH)
        self.write_census()
        run = self.conversion_run()
        units = npc_batch.npc_batch_order(run.census, run.npcgrp['data']['npc'], ())
        expected_first_package_keys = sorted(conversion_unit_key(NPC_MODEL_UNIT_KIND, selection) for selection in self.selections[:2])
        self.assertEqual([scheduled.unit['key'] for scheduled in units],
                         expected_first_package_keys + [conversion_unit_key(NPC_MODEL_UNIT_KIND, self.selections[2])])
        alpha = next(scheduled for scheduled in units if scheduled.unit['selection'] == self.selections[0])
        self.assertEqual([(row.npc_id, row.row_index) for row in alpha.rows], [(11, 1), (12, 3)])

    def test_an_exhausted_batch_converts_zero_units_and_reports_no_failure(self):
        self.run_slice()
        exhausted = self.run_slice(limit=1)
        self.assertEqual(exhausted['convertedUnits'], 0)
        self.assertFalse(any(outcome['status'] == 'failed' for outcome in exhausted['unitOutcomes'] + exhausted['packOutcomes']))

    def test_a_limit_below_one_is_refused_by_the_slice_and_by_the_command_line(self):
        with self.assertRaisesRegex(ValueError, 'at least 1'):
            npc_batch.run_npc_batch_slice(self.conversion_run(), None, 0, self.preflight)
        with self.assertRaises(SystemExit) as raised, patch('sys.stderr'):
            convert_actors.main(['--client', str(self.project_root), '--batch', 'npcs', '--limit', '0'])
        self.assertEqual(raised.exception.code, 2)


class NpcBatchRefusalTests(NpcBatchFixture):
    def test_a_preflight_refusal_before_the_third_unit_keeps_two_sealed_units_and_writes_no_row_for_the_third(self):
        self.refuse_on_preflight_call = 3
        result = self.run_slice()
        self.assertIn('below the batch floor', result['stopReason'])
        self.assertEqual(result['convertedUnits'], 2)
        self.assertEqual(result['packOutcomes'], [])
        run = self.conversion_run()
        units = npc_batch.npc_batch_order(run.census, run.npcgrp['data']['npc'], ())
        self.assertEqual([run.is_convertible_model_unit_sealed(scheduled.unit) for scheduled in units], [True, True, False])
        third_row_keys = {f'npc:{row.npc_id}' for row in units[2].rows}
        self.assertFalse(third_row_keys & set(self.lane_gap_reasons('npc-model')))

    def test_a_value_error_is_a_sealed_path_free_converter_refusal_and_an_os_error_is_failed_and_unsealed(self):
        self.converter.failure = ValueError(f'Package table adapter refused {self.converter.output}\\.work\\x.log')
        refused = self.run_slice(limit=1)['unitOutcomes'][0]
        self.assertTrue(refused['reason'].startswith('converter-refused:Package table adapter refused <output>'), refused['reason'])
        self.assertNotIn(str(self.project_root), refused['reason'])
        self.assertNotIn(self.project_root.as_posix(), refused['reason'])
        self.converter.failure = OSError('disk went away')
        failed = self.run_slice(limit=1)['unitOutcomes'][0]
        self.assertEqual((failed['status'], failed['reason']), ('failed', 'disk went away'))
        run = self.conversion_run()
        units = npc_batch.npc_batch_order(run.census, run.npcgrp['data']['npc'], ())
        self.assertFalse((self.model_step_directory(units[1].unit['selection']) / 'complete.json').exists())

    def test_rows_of_a_gap_unit_each_keep_one_model_gap_row_and_are_left_out_of_the_bundle(self):
        self.converter.failure = ValueError('Synthetic refusal')
        self.run_slice(limit=1)
        self.converter.failure = None
        result = self.run_slice()
        self.assertEqual([outcome['status'] for outcome in result['packOutcomes']], ['pass'])
        model_gaps = self.lane_gap_reasons('npc-model')
        run = self.conversion_run()
        first_unit = npc_batch.npc_batch_order(run.census, run.npcgrp['data']['npc'], ())[0]
        self.assertEqual({key: reason for key, reason in model_gaps.items()},
                         {f'npc:{row.npc_id}': 'converter-refused:Synthetic refusal' for row in first_unit.rows})
        catalog = json.loads((lane_store_root(self.project_root, 'actors') / 'catalog.json').read_bytes())
        manifest = json.loads((lane_store_root(self.project_root, 'actors') / catalog['npcProfiles'][0]['manifest'][len('/l2/'):]).read_bytes())
        self.assertFalse({row.npc_id for row in first_unit.rows} & {profile['npcId'] for profile in manifest['profiles']})


def migrate_excluding(excluded_npc_ids):
    def migrate(client_root, recipe, bundle_root):
        kept = {**recipe, 'profiles': [profile for profile in recipe['profiles'] if profile['npcId'] not in excluded_npc_ids]}
        fake_migrate_npc_profiles(client_root, kept, bundle_root)
        manifest_path = bundle_root / 'manifest.json'
        manifest = json.loads(manifest_path.read_bytes())
        manifest['excludedProfiles'] = [{'npcId': npc_id, 'field': 'CollisionHeight'} for npc_id in sorted(excluded_npc_ids)]
        manifest_path.write_bytes(json.dumps(manifest, sort_keys=True).encode('utf-8'))
    return migrate


class NpcBatchExcludedProfileTests(NpcBatchFixture):
    def test_each_excluded_profile_is_an_actor_default_gap_row_and_the_rest_of_the_pack_is_written(self):
        with patch.object(npc_batch, 'migrate_npc_profiles', side_effect=migrate_excluding({12})):
            result = self.run_slice()
        self.assertEqual([outcome['status'] for outcome in result['packOutcomes']], ['pass'])
        self.assertEqual(self.lane_gap_reasons('npc-profile-pack'), {'npc:12': 'actor-default-unresolved:CollisionHeight'})
        catalog = json.loads((lane_store_root(self.project_root, 'actors') / 'catalog.json').read_bytes())
        self.assertEqual(len(catalog['npcProfiles']), 1)

    def test_a_pack_whose_every_profile_is_excluded_writes_no_bundle(self):
        with patch.object(npc_batch, 'migrate_npc_profiles', side_effect=migrate_excluding({11, 12, 20, 30})):
            result = self.run_slice()
            rerun = self.run_slice()
        self.assertEqual([outcome['status'] for outcome in result['packOutcomes']], ['gap'])
        self.assertEqual([(outcome['status'], outcome['cacheHit']) for outcome in rerun['packOutcomes']], [('gap', True)])
        self.assertEqual(set(self.lane_gap_reasons('npc-profile-pack')), {'npc:11', 'npc:12', 'npc:20', 'npc:30'})
        catalog = json.loads((lane_store_root(self.project_root, 'actors') / 'catalog.json').read_bytes())
        self.assertNotIn('npcProfiles', catalog)


class NpcBatchSharedStoreTests(NpcBatchFixture):
    def test_shared_store_npc_ids_are_the_npc_ids_of_the_committed_shared_store_recipe(self):
        recipe = json.loads((REPOSITORY_ROOT / 'recipes' / 'native-npc-profiles.json').read_bytes())
        self.assertEqual(npc_batch.shared_store_npc_ids(REPOSITORY_ROOT), tuple(sorted(profile['npcId'] for profile in recipe['profiles'])))

    def test_a_missing_shared_store_recipe_is_refused_with_its_path(self):
        with self.assertRaisesRegex(ValueError, 'native-npc-profiles.json'):
            npc_batch.shared_store_npc_ids(self.project_root)

    def test_shared_store_ids_leave_their_rows_and_a_unit_holding_only_such_rows_out_of_the_batch(self):
        first, second = synthetic_selection('delta'), synthetic_selection('epsilon')
        self.npcgrp['data']['npc'] = [synthetic_npcgrp_row(21622, first), synthetic_npcgrp_row(21623, first), synthetic_npcgrp_row(21622, second)]
        self.npcname['data']['npc'] = [{'id': 21622, 'name': 'Shared'}, {'id': 21623, 'name': 'Lane'}]
        self.census['units'] = [synthetic_unit(first), synthetic_unit(second)]
        self.write_census()
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table, SyntheticSourceIdentities(), (21622,))
        self.assertEqual([(scheduled.unit['key'], [row.npc_id for row in scheduled.rows]) for scheduled in plan.units],
                         [(conversion_unit_key(NPC_MODEL_UNIT_KIND, first), [21623])])
        profiles = [profile for pack in plan.packs for profile in pack.recipe['profiles']]
        self.assertEqual([profile['npcId'] for profile in profiles], [21623])
        self.assertTrue(all(MODEL_CATALOG_ID_PATTERN.fullmatch(profile['modelCatalogId']) for profile in profiles))


class NpcProfilePackRecipeTests(NpcBatchFixture):
    def test_pack_recipes_take_name_mesh_and_class_from_the_decoded_rows_and_the_name_table_from_the_census_path(self):
        self.census['tables'][1]['path'] = 'system/npcname-e.dat'
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table, SyntheticSourceIdentities(), ())
        self.assertEqual(len(plan.packs), 1)
        recipe = plan.packs[0].recipe
        self.assertEqual(recipe['nameTable'], 'npcname-e.dat')
        self.assertEqual(recipe['id'], npc_batch.npc_profile_pack_id([11, 12, 20, 30]))
        names = {row['id']: row['name'] for row in self.npcname['data']['npc']}
        rows = {row['npc_id']: row for row in self.npcgrp['data']['npc']}
        for profile in recipe['profiles']:
            with self.subTest(npc_id=profile['npcId']):
                row = rows[profile['npcId']]
                self.assertEqual((profile['expectedName'], profile['expectedMesh'], profile['expectedActorClass']),
                                 (names[profile['npcId']], row['mesh_name'], row['class_name']))
                self.assertEqual(profile['modelCatalogId'], conversion_unit_key(NPC_MODEL_UNIT_KIND, npc_batch.npc_row_selection(row)))

    def test_a_class_that_resolves_only_to_another_spelling_is_a_planning_gap_outside_every_pack(self):
        inexact_class = self.npcgrp['data']['npc'][2]['class_name']
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table,
                                        SyntheticSourceIdentities(lambda class_name: synthetic_closure(class_name.upper() if class_name == inexact_class else class_name)), ())
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(20, 'converter-refused:Actor class requires an exact qualified export identity')])
        self.assertNotIn(20, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_class_outside_engine_actor_is_a_planning_gap_outside_every_pack(self):
        object_class = self.npcgrp['data']['npc'][1]['class_name']
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table, SyntheticSourceIdentities(
            lambda class_name: ('Core.Object', class_name) if class_name == object_class else synthetic_closure(class_name)), ())
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(11, 'converter-refused:NPC actor class inheritance must resolve through Engine.Actor to Core.Object')])

    def test_a_mesh_that_resolves_only_to_another_spelling_is_a_planning_gap_outside_every_pack(self):
        inexact_mesh = self.npcgrp['data']['npc'][0]['mesh_name']
        run = self.conversion_run()
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table,
                                        SyntheticSourceIdentities(mesh_spellings={inexact_mesh: inexact_mesh.upper()}), ())
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(30, 'converter-refused:NPC mesh requires an exact qualified skeletal mesh export')])
        self.assertNotIn(30, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_pack_record_of_an_earlier_plan_leaves_the_lane_catalog_when_the_packs_are_cut_again(self):
        self.run_slice()
        first_pack_id = npc_batch.npc_profile_pack_id([11, 12, 20, 30])
        self.npcname['data']['npc'] = [row for row in self.npcname['data']['npc'] if row['id'] != 12]
        self.run_slice()
        catalog = json.loads((lane_store_root(self.project_root, 'actors') / 'catalog.json').read_bytes())
        self.assertEqual([record['id'] for record in catalog['npcProfiles']], [npc_batch.npc_profile_pack_id([11, 20, 30])])
        self.assertNotEqual(first_pack_id, catalog['npcProfiles'][0]['id'])
        self.assertEqual(self.lane_gap_reasons('npc-profile-pack'), {'npc:12': 'npc-name-row-missing'})

    def test_a_row_without_a_name_is_a_planning_gap_and_a_closure_at_the_class_limit_is_over_limit(self):
        self.npcname['data']['npc'] = [row for row in self.npcname['data']['npc'] if row['id'] != 12]
        wide_class = self.npcgrp['data']['npc'][0]['class_name']
        run = self.conversion_run()
        wide_closure = (*synthetic_closure(wide_class), *(f'Synthetic.class_{index:03d}' for index in range(npc_batch.MAX_CLASSES - 3)))
        plan = npc_batch.npc_batch_plan(run.census, run.npcgrp, run.npcname, run.name_table,
                                        SyntheticSourceIdentities(lambda class_name: wide_closure if class_name == wide_class else synthetic_closure(class_name)), ())
        self.assertEqual({(gap.npc_id, gap.reason) for gap in plan.planning_gaps},
                         {(12, 'npc-name-row-missing'), (30, f'class-closure-over-limit:{npc_batch.MAX_CLASSES}')})
        self.assertTrue(all(len(pack.class_closure) < npc_batch.MAX_CLASSES for pack in plan.packs))


if __name__ == '__main__':
    unittest.main()
