import argparse
import copy
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.actor_sound_batch import (CHARACTER_CENSUS_RELATIVE_PATH, actor_sound_key_argument, bundle_sort_key, decoded_config_keys,
                                      run_actor_sound_slice, skipped_character_bundles, write_bundle_catalog_records)
from actors.actor_sound_bindings import (ACTOR_SOUND_BUNDLE_ID_PREFIX, NO_EXACT_SKILL_SOUND_ROW_REASON, NPC_NATIVE_NUMERIC_FIELDS,
                                         actor_sound_bundle_id, actor_sound_gap_row, actor_sound_gap_rows, actor_sound_reference_counts,
                                         build_actor_sound_recipe, skill_actor_row)
from actors.actor_sound_conversion import BundleStoreState, bundle_store_state
from native_assets import archive_bytes
from native_assets_lib import combat_audio_bundle
from native_assets_lib.gltf import json_bytes
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row

PACKAGE_SHA256 = sha256_hex_digest(b'synthetic sound package')
NPCGRP_IDENTITY = {'path': 'system/npcgrp.dat', 'sha256': 'a' * 64}
EVIDENCE = 'work/actor-sounds/npc_20001/receipt.json'
BOUND_PROOF = {'proofPath': 'proof.json', 'proofSha256': 'b' * 64, 'anchors': ['Getter 0x1', 'Serialize 0x2']}


def bound_route(field_name, ordinal):
    return {'table': 'npcgrp', 'descriptorSha256': 'c' * 64, 'fieldOrdinal': ordinal, 'fieldName': field_name, 'routeProof': BOUND_PROOF}


BOUND_ROUTES = {'npcgrp': {'table': 'npcgrp', 'routes': {'attackItem': bound_route('attack_sound1', 8), 'defense': bound_route('defense_sound1', 9),
                                                         'damage': bound_route('damage_sound', 10)},
                           'unresolved': {'attackVoice': {'reason': 'combat-role-route-unresolved:npcgrp/attackVoice', 'detail': 'no member'}}}}
NO_BOUND_ROUTES = {'npcgrp': {'table': 'npcgrp', 'routes': {}, 'unresolved': {
    role: {'reason': f'combat-role-route-unresolved:npcgrp/{role}', 'detail': 'route proof is missing'}
    for role in ('attackItem', 'attackVoice', 'defense', 'damage')}}}
GREMLIN_ROW = {'npc_id': 20001, 'mesh_name': 'LineageMonsters.gremlin_m00', 'attack_sound1': [{'param_attack_sound1': ''}],
               'defense_sound1': [{'param_defense_sound1': 'MonSound.Hit_Wet_4'}],
               'damage_sound': [{'param_damage_sound': 'MonSound.gremlin_dmg_1'}, {'param_damage_sound': 'MonSound.gremlin_dmg_9'},
                                {'param_damage_sound': 'MonSound.gremlin_dmg_2'}],
               'sound_vol': 1234.5, 'sound_radius': 0.25, 'sound_random': 70.125}
GREMLIN_ACTOR_ROW = {'table': 'npcgrp', 'kind': 'actor', 'label': 'Gremlin (npcgrp npc_id 20001)', 'catalogId': 'npc-model:gremlin',
                     'sourceObject': 'LineageMonsters.gremlin_m00', 'match': [{'pointer': '/npc_id', 'value': 20001}]}


class ActorSoundCorpusFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='actor-sounds-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.inventory = {'kind': 'native-staged-sound-inventory', 'sounds': []}
        self.coverage = {'kind': 'native-staged-sound-coverage', 'sounds': []}
        for index, name in enumerate(['monsound.Public_Hit_Wet.Hit_Wet_4', 'monsound.gremlin.gremlin_dmg_1', 'monsound.gremlin.gremlin_dmg_2'], start=1):
            self.add_sound(name, index)
        self.rows = [{'npc_id': 1, 'mesh_name': 'Other.mesh'}, copy.deepcopy(GREMLIN_ROW)]

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)}

    def add_sound(self, object_name, export_index, verified=True):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(22050)
            writer.writeframes(bytes([export_index, 0]) * 8)
        wav = stream.getvalue()
        prefix, stable = f'cache/{export_index}', f'FIXTURE:{PACKAGE_SHA256}:{export_index}'
        asset = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:' + object_name,
                 'source': {'edition': 'interlude', 'object': object_name, 'sha256': PACKAGE_SHA256}, 'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        payloads = {'audio.wav': wav, 'provenance.json': json_bytes({'metadata': {'nativeExportIndex': export_index,
                                                                                  'nativePayloadSha256': sha256_hex_digest(wav), 'encodedAudioUnchanged': True}})}
        asset['files'] = [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)} for name, data in payloads.items()]
        archive = self.write('lane/' + prefix + '/asset.l2asset', archive_bytes(asset, payloads))
        audio = self.write('lane/' + prefix + '/audio.wav', wav)
        native = self.write(f'lane/source/{export_index}.bin', wav)
        self.inventory['sounds'].append({'stableId': stable, 'status': 'source-ready', 'id': asset['id'],
                                         'export': {'object': object_name, 'classObject': 'Engine.Sound', 'exportIndex': export_index},
                                         'sourcePackage': {'sha256': PACKAGE_SHA256, 'relativePath': 'Sounds/MonSound.uax'},
                                         'nativePayload': {**native, 'path': f'source/{export_index}.bin'},
                                         'nativeSound': {'exportIndex': export_index, 'embeddedPayloadSha256': sha256_hex_digest(wav)},
                                         'serializedExport': {'offsetUnwrapped': export_index * 1000}})
        if verified:
            self.coverage['sounds'].append({'stableId': stable, 'status': 'exported-and-verified', 'products': {
                'archive': {**archive, 'path': prefix + '/asset.l2asset'}, 'audio': {**audio, 'path': prefix + '/audio.wav'}}})

    def recipe_inputs(self):
        original = self.write('lane/tables/npcgrp.dat', b'synthetic npcgrp original')
        table = {'schemaVersion': 1, 'edition': 'interlude', 'source': 'system/npcgrp.dat', 'sourceSha256': original['sha256'],
                 'decodedSha256': sha256_hex_digest(json_bytes(self.rows)), 'schema': {'fixture': True},
                 'data': {'npc': self.rows, 'data': len(self.rows)}}
        decoded = self.write('lane/tables/npcgrp.json', json_bytes(table))
        inventory = self.write('lane/inventory.json', json_bytes(self.inventory))
        coverage = self.write('lane/coverage.json', json_bytes({**self.coverage, 'inventorySha256': inventory['sha256']}))
        return {'corpus': {'root': 'lane', 'inventory': inventory, 'coverage': coverage},
                'tables': {'npcgrp': {'original': original, 'decoded': decoded}}}

    def built_manifest(self, routes=BOUND_ROUTES):
        recipe = build_actor_sound_recipe('npc:20001', [GREMLIN_ACTOR_ROW], routes, self.recipe_inputs())
        self.write('lane/recipe.json', json_bytes(recipe))
        manifest, _, _ = combat_audio_bundle.prepare(self.root, self.root / 'lane/recipe.json')
        return recipe, manifest


class ActorSoundRecipeTests(ActorSoundCorpusFixture):
    def test_the_recipe_holds_one_actor_selection_routed_only_by_bound_routes(self):
        recipe = build_actor_sound_recipe('npc:20001', [GREMLIN_ACTOR_ROW], BOUND_ROUTES, self.recipe_inputs())
        self.assertEqual(recipe['kind'], combat_audio_bundle.RECIPE_KIND)
        self.assertEqual(recipe['referencePolicy'], combat_audio_bundle.POLICY)
        self.assertEqual(len(recipe['selections']), 1)
        selection = recipe['selections'][0]
        self.assertEqual(selection['roles'], {'attackItem': 'attack_sound1', 'defense': 'defense_sound1', 'damage': 'damage_sound'})
        self.assertNotIn('attackVoice', selection['roles'])
        self.assertEqual((selection['id'], selection['catalogId'], selection['sourceObject']),
                         ('npc-20001-npcgrp', 'npc-model:gremlin', 'LineageMonsters.gremlin_m00'))
        self.assertEqual(recipe['routes'], {'npcgrp': BOUND_ROUTES['npcgrp']['routes']})
        self.assertEqual(actor_sound_bundle_id('npc:20001'), 'actor-sounds:npc:20001')

    def test_the_builder_keeps_source_slot_positions_and_labels_each_reference(self):
        _, manifest = self.built_manifest()
        roles = manifest['selections'][0]['roles']
        self.assertEqual([(slot['index'], slot['reference'], slot['status']) for slot in roles['damage']['slots']], [
            (0, 'MonSound.gremlin_dmg_1', 'unique-package-leaf-candidate'), (1, 'MonSound.gremlin_dmg_9', 'no-package-leaf-candidate-in-inventory'),
            (2, 'MonSound.gremlin_dmg_2', 'unique-package-leaf-candidate')])
        self.assertEqual([(slot['status'], slot['dependencyId']) for slot in roles['attackItem']['slots']], [('empty', None)])
        self.assertEqual(actor_sound_reference_counts(manifest), {'exactIdentity': 0, 'uniquePackageLeafCandidate': 3, 'unresolved': 1, 'empty': 1})

    def test_the_swapped_npcgrp_labels_reach_the_manifest_as_native_radius_and_volume_unrounded(self):
        _, manifest = self.built_manifest()
        self.assertEqual(manifest['selections'][0]['numeric'], {'soundRadius': 1234.5, 'soundVolume': 0.25, 'soundRandom': 70.125})
        self.assertEqual(NPC_NATIVE_NUMERIC_FIELDS, {'soundRadius': 'sound_vol', 'soundVolume': 'sound_radius', 'soundRandom': 'sound_random'})

    def test_unbound_roles_and_unadmitted_references_become_gap_rows_and_an_empty_field_records_none(self):
        _, manifest = self.built_manifest()
        rows = actor_sound_gap_rows('npc:20001', [GREMLIN_ACTOR_ROW], BOUND_ROUTES, manifest, {'npcgrp': NPCGRP_IDENTITY}, EVIDENCE, {})
        self.assertEqual([(row['reason'], row['sourceIdentity'].get('object')) for row in rows], [
            ('combat-role-route-unresolved:npcgrp/attackVoice', None), ('sound-identity-unresolved', 'MonSound.gremlin_dmg_9')])
        reason_patterns = load_gap_reason_patterns()
        for row in rows:
            self.assertEqual((row['part'], row['step'], row['status'], row['evidence']), ('audio', 'actor-sounds', 'gap', EVIDENCE))
            validate_gap_row(row, reason_patterns)

    def test_with_no_bound_route_the_selection_is_left_out_and_every_role_is_a_gap_row(self):
        self.assertIsNone(build_actor_sound_recipe('npc:20001', [GREMLIN_ACTOR_ROW], NO_BOUND_ROUTES, self.recipe_inputs()))
        rows = actor_sound_gap_rows('npc:20001', [GREMLIN_ACTOR_ROW], NO_BOUND_ROUTES, None, {'npcgrp': NPCGRP_IDENTITY}, EVIDENCE, {})
        self.assertEqual([row['reason'] for row in rows], [f'combat-role-route-unresolved:npcgrp/{role}'
                                                           for role in ('attackItem', 'attackVoice', 'defense', 'damage')])

    def test_two_builds_give_byte_identical_recipes_and_gap_rows(self):
        first_recipe, first_manifest = self.built_manifest()
        second_recipe, second_manifest = self.built_manifest()
        self.assertEqual(json_bytes(first_recipe), json_bytes(second_recipe))
        gap_rows = [json_bytes(actor_sound_gap_rows('npc:20001', [GREMLIN_ACTOR_ROW], BOUND_ROUTES, manifest, {'npcgrp': NPCGRP_IDENTITY}, EVIDENCE, {}))
                    for manifest in (first_manifest, second_manifest)]
        self.assertEqual(gap_rows[0], gap_rows[1])


class ActorSoundIdentityBoundaryTests(ActorSoundCorpusFixture):
    def test_one_exact_identity_binds_exact_and_a_group_less_reference_with_one_leaf_binds_as_a_candidate(self):
        self.rows[1]['defense_sound1'] = [{'param_defense_sound1': 'monsound.Public_Hit_Wet.Hit_Wet_4'}]
        _, manifest = self.built_manifest()
        roles = manifest['selections'][0]['roles']
        self.assertEqual(roles['defense']['slots'][0]['status'], 'exact-identity')
        self.assertEqual(roles['damage']['slots'][0]['status'], 'unique-package-leaf-candidate')

    def test_two_leaf_candidates_stay_unresolved_with_a_gap_row(self):
        self.add_sound('monsound.Other_Group.gremlin_dmg_1', 9)
        _, manifest = self.built_manifest()
        slot = manifest['selections'][0]['roles']['damage']['slots'][0]
        self.assertEqual((slot['status'], slot['dependencyId']), ('ambiguous-package-leaf-candidates', None))
        rows = actor_sound_gap_rows('npc:20001', [GREMLIN_ACTOR_ROW], BOUND_ROUTES, manifest, {'npcgrp': NPCGRP_IDENTITY}, EVIDENCE, {})
        self.assertIn(('sound-identity-unresolved', 'MonSound.gremlin_dmg_1'), [(row['reason'], row['sourceIdentity'].get('object')) for row in rows])

    def test_a_candidate_whose_conversion_was_refused_records_the_converter_reason(self):
        self.coverage['sounds'] = [row for row in self.coverage['sounds'] if not row['stableId'].endswith(':2')]
        _, manifest = self.built_manifest()
        refused = {f'FIXTURE:{PACKAGE_SHA256}:2': 'converter-refused:Native Sound lazy-array boundaries do not match export'}
        rows = actor_sound_gap_rows('npc:20001', [GREMLIN_ACTOR_ROW], BOUND_ROUTES, manifest, {'npcgrp': NPCGRP_IDENTITY}, EVIDENCE, refused)
        self.assertIn('converter-refused:Native Sound lazy-array boundaries do not match export', [row['reason'] for row in rows])


class ActorSoundSourceRuleTests(unittest.TestCase):
    def test_the_python_and_typescript_generated_bundle_prefixes_are_equal(self):
        source = (ROOT / 'src' / 'audio' / 'combatAudioRoleRouting.ts').read_text(encoding='utf-8')
        match = re.search(r'generatedActorSoundBundlePrefix = "([^"]+)"', source)
        self.assertEqual(match.group(1), ACTOR_SOUND_BUNDLE_ID_PREFIX)

    def test_no_binding_code_selects_a_sound_by_partial_case_folded_or_nearest_name(self):
        for name in ('actor_sound_bindings.py', 'combat_role_routes.py', 'actor_sound_conversion.py'):
            source = (ROOT / 'scripts' / 'actors' / name).read_text(encoding='utf-8')
            with self.subTest(name):
                self.assertIsNone(re.search(r'difflib|get_close_matches|startswith\(|casefold\(\)\.find|fuzzy', source, re.IGNORECASE))
                self.assertNotIn('previousValue', source)


SOUND_ROWS = [{'skill_id': 3, 'skill_level': 1, 'spelleffect_sound_1': 'SkillSound.power_strike'}, {'skill_id': 3, 'skill_level': 2}]


class ActorSoundSkillAndCharacterTests(unittest.TestCase):
    def test_a_skill_bundle_takes_only_the_exact_skillsound_row_of_its_binding(self):
        binding = {'key': 'skill:3:2', 'skillId': 3, 'level': 2, 'soundRowOrdinal': 1}
        self.assertEqual(skill_actor_row(binding, SOUND_ROWS), {
            'table': 'skillsoundgrp', 'kind': 'skill', 'label': 'skill:3:2 (skillsoundgrp row 1)', 'skillId': 3, 'level': 2,
            'match': [{'pointer': '/skill_id', 'value': 3}, {'pointer': '/skill_level', 'value': 2}]})
        with self.assertRaisesRegex(ValueError, 'does not belong to skill:3:1'):
            skill_actor_row({**binding, 'key': 'skill:3:1', 'level': 1}, SOUND_ROWS)

    def test_a_skill_key_without_an_exact_row_gets_no_sound_and_keeps_the_no_exact_skillsound_row_gap(self):
        self.assertIsNone(skill_actor_row({'key': 'skill:9:1', 'skillId': 9, 'level': 1, 'soundRowOrdinal': None}, SOUND_ROWS))
        self.assertEqual(NO_EXACT_SKILL_SOUND_ROW_REASON, 'no-exact-skillsound-row')
        validate_gap_row(actor_sound_gap_row('skill:9:1', NO_EXACT_SKILL_SOUND_ROW_REASON, NPCGRP_IDENTITY, EVIDENCE), load_gap_reason_patterns())

    def test_skill_routes_stay_unbound_so_a_skill_bundle_builds_no_recipe(self):
        routes = {'skillsoundgrp': {'table': 'skillsoundgrp', 'routes': {}, 'unresolved': {
            role: {'reason': f'combat-role-route-unresolved:skillsoundgrp/{role}', 'detail': 'no anchor'} for role in ('cast', 'shot')}}}
        actor_row = skill_actor_row({'key': 'skill:3:1', 'skillId': 3, 'level': 1, 'soundRowOrdinal': 0}, SOUND_ROWS)
        self.assertIsNone(build_actor_sound_recipe('skill:3:1', [actor_row], routes, {'corpus': {}, 'tables': {}}))
        rows = actor_sound_gap_rows('skill:3:1', [actor_row], routes, None, {'skillsoundgrp': NPCGRP_IDENTITY}, EVIDENCE, {})
        self.assertEqual([row['reason'] for row in rows], ['combat-role-route-unresolved:skillsoundgrp/cast',
                                                           'combat-role-route-unresolved:skillsoundgrp/shot'])

    def test_characters_are_skipped_with_their_census_reasons_and_an_absent_census_is_named(self):
        with tempfile.TemporaryDirectory(prefix='character-census-') as temporary:
            self.assertEqual(skipped_character_bundles(temporary),
                             {'count': 0, 'skippedReason': 'character-census-absent', 'skippedByReason': {}})
            census_path = Path(temporary) / CHARACTER_CENSUS_RELATIVE_PATH
            census_path.parent.mkdir(parents=True)
            census_path.write_text(json.dumps({'schemaVersion': 1, 'rows': [
                {'padding': False, 'profile': 'gap', 'gaps': [{'field': 'hair', 'reason': 'hair-layout-undecoded'},
                                                              {'field': 'profile', 'reason': 'class-template-mapping-undecoded'}]},
                {'padding': False, 'profile': 'gap', 'gaps': [{'field': 'profile', 'reason': 'class-template-mapping-undecoded'}]},
                {'padding': False, 'profile': 'pending', 'gaps': []},
                {'padding': False, 'profile': 'written', 'gaps': []},
                {'padding': True, 'profile': None, 'gaps': [{'field': 'body_mesh1', 'reason': 'no-mesh-in-row'}]}]}), encoding='utf-8')
            self.assertEqual(skipped_character_bundles(temporary), {'count': 0, 'skippedReason': None, 'skippedByReason': {
                'character-profile-pending': 1, 'character-sound-bundle-not-built': 1, 'class-template-mapping-undecoded': 2}})

    def test_a_character_key_is_refused_as_an_actor_sound_bundle(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            actor_sound_key_argument('character:0')
        self.assertEqual(actor_sound_key_argument('skill:4:2'), 'skill:4:2')

class FakeSoundBundles:
    def __init__(self, keys, sealed_keys):
        self.keys, self.sealed_keys, self.converted, self.synchronized = keys, sealed_keys, [], []

    def sealed_store_state(self, run, bundle_key):
        return BundleStoreState(None, []) if bundle_key in self.sealed_keys else None

    def convert(self, run, bundle_key):
        self.converted.append(bundle_key)
        return {'key': bundle_key}, BundleStoreState(None, [])

    def synchronize_store(self, run, converted_states, skipped_sealed_states):
        self.synchronized.append((list(converted_states), list(skipped_sealed_states)))


class ActorSoundBatchSliceTests(unittest.TestCase):
    def test_bundle_keys_order_npcs_then_skills_by_number(self):
        keys = ['skill:3:2', 'npc:100', 'skill:3:10', 'npc:20001', 'npc:9']
        self.assertEqual(sorted(keys, key=bundle_sort_key), ['npc:9', 'npc:100', 'npc:20001', 'skill:3:2', 'skill:3:10'])

    def test_a_slice_skips_sealed_bundles_converts_up_to_the_limit_and_runs_the_preflight_before_each(self):
        sealed_keys = ('npc:1', 'npc:3')
        bundles, preflights = FakeSoundBundles(['npc:1', 'npc:2', 'npc:3', 'npc:4'], sealed_keys), []
        outcomes = run_actor_sound_slice(None, bundles, 1, lambda: preflights.append(len(bundles.converted)))
        self.assertEqual([outcome['key'] for outcome in outcomes], ['npc:2'])
        self.assertEqual(bundles.synchronized, [(['npc:2'], ['npc:1'])])
        unlimited_bundles = FakeSoundBundles(bundles.keys, sealed_keys)
        outcomes = run_actor_sound_slice(None, unlimited_bundles, 5, lambda: None)
        self.assertEqual([outcome['key'] for outcome in outcomes], ['npc:2', 'npc:4'])
        self.assertEqual(unlimited_bundles.synchronized, [(['npc:2', 'npc:4'], ['npc:1', 'npc:3'])])
        self.assertEqual(preflights, [0])

    def test_the_alaudio_config_keys_are_read_per_section_in_file_order_without_comments(self):
        decoded = b'[Public]\r\nObject=(Name=X)\r\n; Commented=1\r\n[EtcSound]\r\nCriticalSound=SkillSound.Critical_Hit_02\r\nCriticalSound_Vol=250.0\r\n'
        self.assertEqual(decoded_config_keys(decoded), ['Public.Object', 'EtcSound.CriticalSound', 'EtcSound.CriticalSound_Vol'])


class ActorSoundCatalogRecordTests(unittest.TestCase):
    def test_a_resealed_bundle_replaces_its_own_combat_audio_record(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            store_root = Path(temporary_directory).resolve() / 'artifacts' / 'lane-store' / 'actors' / 'l2'
            for manifest_sha256 in ('a' * 64, 'b' * 64):
                receipt = {'outputs': [{'path': f'l2/combat-audio/{manifest_sha256}/manifest.json', 'bytes': 10, 'sha256': manifest_sha256}],
                           'gapRows': []}
                write_bundle_catalog_records(store_root, {'npc:20001': bundle_store_state('npc:20001', receipt)}, {}, 4)
            catalog = json.loads((store_root / 'catalog.json').read_bytes())
        self.assertEqual(catalog['combatAudio'], [{'id': 'actor-sounds:npc:20001', 'manifest': f'/l2/combat-audio/{"b" * 64}/manifest.json',
                                                   'manifestBytes': 10, 'manifestSha256': 'b' * 64}])


if __name__ == '__main__':
    unittest.main()
