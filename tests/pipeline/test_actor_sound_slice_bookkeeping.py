import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

import native_assets
from actors import actor_sound_batch, actor_sound_conversion
from actors.actor_sound_batch import ActorSoundBundles, run_actor_sound_slice, write_actor_sound_census
from actors.actor_sound_conversion import ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH, ActorSoundConversionRun
from actors.combat_role_routes import COMBAT_ROLE_ROUTE_PROOF
from actors.combat_sound_route_recipe import read_combat_sound_route_recipe
from actors.npc_store_records import file_output_record
from catalog_store_fixture import write_profile_manifest, write_store_catalog
from native_assets_lib import combat_audio_bundle
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import gap_reason_list_versions
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import BatchPreflightRefusedError
from reference_client_guard import ReferenceClientLockError
from test_actor_sound_bundle_reseal import (FIRST_BUILDER_SHA256, GREMLIN_PROFILE, NPCGRP_IDENTITY, SILENT_PROFILE,
                                            STALE_GREMLIN_COMBAT_AUDIO_RECORD, SYNTHETIC_NPCGRP_ROWS, SyntheticActorSoundRun, snapshot_tree)

GREMLIN_KEY, SILENT_KEY = 'npc:20001', 'npc:30001'
GREMLIN_MANIFEST_BYTES = b'{"bundleKey":"npc:20001","selections":[]}'
GREMLIN_MANIFEST_SHA256 = hashlib.sha256(GREMLIN_MANIFEST_BYTES).hexdigest()
GREMLIN_COMBAT_AUDIO_RECORD = {'id': 'actor-sounds:npc:20001', 'manifest': f'/l2/combat-audio/{GREMLIN_MANIFEST_SHA256}/manifest.json',
                               'manifestBytes': len(GREMLIN_MANIFEST_BYTES), 'manifestSha256': GREMLIN_MANIFEST_SHA256}
STALE_SILENT_COMBAT_AUDIO_RECORD = {**STALE_GREMLIN_COMBAT_AUDIO_RECORD, 'id': 'actor-sounds:npc:30001'}
NPCGRP_ROLES = ('attackItem', 'attackVoice', 'defense', 'damage')
ALAUDIO_LOCK_REFUSAL = 'synthetic lock holds no system/ALAudio.int'
ACTOR_SOUND_CENSUS_RELATIVE_PATH = 'docs/parts/audio/actor-sound-census.json'
FIRST_SOUND_UNIT_FINGERPRINT_UNDER_THE_CONVERTER_OUTPUT_VERSION = 'e0b0b5e96ef673a264fa6dae580904668576043953e59b538e35f2c8ac20c13c'
LOCKED_SOUND_PACKAGE_RECORD = {'path': 'Sounds/MonSound.uax', 'sha256': '8' * 64}
SOUND_PACKAGE_RECORD = {'path': 'Sounds/MonSound.uax', 'package': SimpleNamespace(source_hash='7' * 64)}
NO_REFERENCES = {'exactIdentity': 0, 'uniquePackageLeafCandidate': 0, 'unresolved': 0, 'empty': 0}


def expected_gap_row(bundle_key, reason):
    return {'key': bundle_key, 'part': 'audio', 'step': 'actor-sounds', 'status': 'gap', 'reason': reason, 'sourceIdentity': NPCGRP_IDENTITY,
            'evidence': f'work/{bundle_key.replace(":", "__")}/actor-sounds/receipt.json'}


GREMLIN_GAP_ROWS = [expected_gap_row(GREMLIN_KEY, f'combat-role-route-unresolved:npcgrp/{role}') for role in NPCGRP_ROLES]
SILENT_GAP_ROWS = [expected_gap_row(SILENT_KEY, 'npc-names-no-sound')]


def expected_gap_row_bytes(rows):
    return canonical_json_bytes({'schemaVersion': 1, 'lane': 'actors', 'step': 'actor-sounds', 'reasonListVersions': gap_reason_list_versions(),
                                 'rows': rows})


def unresolved_route_entry(table, role, detail):
    return {'status': 'unresolved', 'fieldOrdinal': None, 'fieldName': None, 'reason': f'combat-role-route-unresolved:{table}/{role}',
            'detail': detail}


def expected_census():
    synthetic_table_routes = {role: unresolved_route_entry('npcgrp', role, 'route proof is missing') for role in NPCGRP_ROLES}
    route_recipe = read_combat_sound_route_recipe(ROOT)
    return {'schemaVersion': 1, 'routeProof': {'path': COMBAT_ROLE_ROUTE_PROOF['path'], 'sha256': None},
            'routeRecipe': {'path': 'recipes/actors/combat-sound-routes.json', 'sha256': route_recipe['sha256']},
            'routes': {'chargrp': synthetic_table_routes, 'npcgrp': synthetic_table_routes, 'armorgrp': synthetic_table_routes,
                       'weapongrp': synthetic_table_routes, 'skillsoundgrp': synthetic_table_routes,
                       'alaudio': {role: unresolved_route_entry('alaudio', role, ALAUDIO_LOCK_REFUSAL) for role in ('critical', 'soulshot')}},
            'bundles': {'npc': 2, 'skillSoundRow': 0, 'character': {'count': 0, 'skippedReason': 'character-census-absent', 'skippedByReason': {}}},
            'casterIndexedRoutes': {}, 'unroutedFields': {},
            'references': NO_REFERENCES, 'perTable': {'npcgrp': NO_REFERENCES}, 'sealedBundles': [GREMLIN_KEY, SILENT_KEY]}


def refuse_the_alaudio_config(relative_path):
    raise ReferenceClientLockError(ALAUDIO_LOCK_REFUSAL)


CLIENT_ACCESS_WITHOUT_ALAUDIO = SimpleNamespace(require_equal_file=refuse_the_alaudio_config)


class ManifestActorSoundRun(SyntheticActorSoundRun):
    def __init__(self, project_root):
        super().__init__(project_root, FIRST_BUILDER_SHA256)
        self.client_access, self.route_proof = CLIENT_ACCESS_WITHOUT_ALAUDIO, None

    def built_bundle(self, bundle_key, actor_rows, routes_by_table, inventory, coverage_rows, step_directory):
        manifest_path = self.store_root / 'combat-audio' / GREMLIN_MANIFEST_SHA256 / 'manifest.json'
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(GREMLIN_MANIFEST_BYTES)
        return json.loads(GREMLIN_MANIFEST_BYTES), [file_output_record(self.lane_folder, manifest_path)], None


class ConstructedActorSoundRun(ManifestActorSoundRun):
    def __init__(self, project_root):
        ActorSoundConversionRun.__init__(self, project_root, CLIENT_ACCESS_WITHOUT_ALAUDIO, None, lane_store_root(project_root, 'actors'),
                                         lane_work_root(project_root, 'actors'), None)
        self.tables = {'npcgrp': {'identity': NPCGRP_IDENTITY, 'original': b'synthetic npcgrp', 'decoded': {'synthetic': 'npcgrp'},
                                  'rows': SYNTHETIC_NPCGRP_ROWS}}


class ActorSoundSliceFixture:
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.store_root = lane_store_root(self.project_root, 'actors')
        self.profile_record = write_profile_manifest(self.store_root, 'native-npc-profiles', [GREMLIN_PROFILE, SILENT_PROFILE])
        self.write_catalog_with_combat_audio(None)
        self.catalog_path = self.store_root / 'catalog.json'
        self.gap_rows_path = self.store_root.parent / ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH
        self.preflights = []
        for name in ('write_store', 'replace_file'):
            patcher = mock.patch.object(actor_sound_batch, name, wraps=getattr(actor_sound_batch, name))
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def catalog_with_combat_audio(self, combat_audio_records):
        catalog = {'schemaVersion': 1, 'models': [], 'npcProfiles': [self.profile_record]}
        return catalog if combat_audio_records is None else {**catalog, 'combatAudio': combat_audio_records}

    def write_catalog_with_combat_audio(self, combat_audio_records):
        write_store_catalog(self.store_root, self.catalog_with_combat_audio(combat_audio_records))

    def expected_catalog_bytes(self):
        return json_bytes(self.catalog_with_combat_audio([GREMLIN_COMBAT_AUDIO_RECORD]))

    def run_slice(self):
        run = ManifestActorSoundRun(self.project_root)
        bundles = ActorSoundBundles(self.project_root, run.store_root, [])
        return run, bundles, run_actor_sound_slice(run, bundles, 5, lambda: self.preflights.append(True))

    def assert_the_next_slice_writes_no_file(self):
        before = snapshot_tree(self.project_root)
        self.write_store.reset_mock()
        self.replace_file.reset_mock()
        self.preflights.clear()
        _, _, outcomes = self.run_slice()
        self.assertEqual((outcomes, self.preflights, self.write_store.call_count, self.replace_file.call_count), ([], [], 0, 0))
        self.assertEqual(snapshot_tree(self.project_root), before)


class ActorSoundSliceByteIdentityTests(ActorSoundSliceFixture, unittest.TestCase):
    def test_one_slice_writes_the_catalog_the_gap_rows_and_the_census_with_the_expected_bytes(self):
        run, bundles, outcomes = self.run_slice()
        write_actor_sound_census(run, bundles)
        self.assertEqual([(outcome['key'], outcome['status'], outcome['cacheHit'], outcome['bundleId'], outcome['references']) for outcome in outcomes],
                         [(GREMLIN_KEY, 'gap', False, 'actor-sounds:npc:20001', NO_REFERENCES), (SILENT_KEY, 'gap', False, None, NO_REFERENCES)])
        self.assertEqual(self.catalog_path.read_bytes(), self.expected_catalog_bytes())
        self.assertEqual(self.gap_rows_path.read_bytes(), expected_gap_row_bytes([*GREMLIN_GAP_ROWS, *SILENT_GAP_ROWS]))
        self.assertEqual((self.project_root / ACTOR_SOUND_CENSUS_RELATIVE_PATH).read_bytes(), canonical_json_bytes(expected_census()))


class ActorSoundSliceWriteCountTests(ActorSoundSliceFixture, unittest.TestCase):
    def test_a_slice_that_converts_two_bundles_writes_the_catalog_and_the_gap_row_file_once(self):
        _, _, outcomes = self.run_slice()
        self.assertEqual(([outcome['key'] for outcome in outcomes], len(self.preflights)), ([GREMLIN_KEY, SILENT_KEY], 2))
        self.assertEqual(self.write_store.call_count, 1)
        self.assertEqual([call.args[0] for call in self.replace_file.call_args_list], [self.gap_rows_path])

    def test_a_slice_over_an_unchanged_store_writes_no_file(self):
        self.run_slice()
        self.assert_the_next_slice_writes_no_file()

    def test_a_slice_stopped_by_its_preflight_leaves_the_bundles_converted_so_far_synchronized(self):
        def refuse_the_second_bundle():
            if self.preflights:
                raise BatchPreflightRefusedError('synthetic refusal before the second bundle')
            self.preflights.append(True)

        run = ManifestActorSoundRun(self.project_root)
        with self.assertRaises(BatchPreflightRefusedError):
            run_actor_sound_slice(run, ActorSoundBundles(self.project_root, run.store_root, []), 5, refuse_the_second_bundle)
        self.assertEqual([receipt['unitKey'] for receipt in run.bundle_ledger.sealed_receipts()], [GREMLIN_KEY])
        self.assertEqual(self.catalog_path.read_bytes(), self.expected_catalog_bytes())
        self.assertEqual(self.gap_rows_path.read_bytes(), expected_gap_row_bytes(GREMLIN_GAP_ROWS))


class ActorSoundHashReuseTests(ActorSoundSliceFixture, unittest.TestCase):
    def test_the_builder_is_hashed_once_and_sound_units_hold_the_converter_output_version(self):
        builder_path = Path(combat_audio_bundle.__file__)
        builder_reads = []
        read_bytes = Path.read_bytes

        def recorded_read_bytes(path):
            if path == builder_path:
                builder_reads.append(path)
            return read_bytes(path)

        with mock.patch.object(actor_sound_conversion, 'ActorPackageCensus'), \
                mock.patch.object(actor_sound_conversion, 'read_combat_role_route_proof', return_value=None), \
                mock.patch.object(actor_sound_conversion, 'locked_input_records', return_value=[LOCKED_SOUND_PACKAGE_RECORD]), \
                mock.patch.object(Path, 'read_bytes', recorded_read_bytes):
            run = ConstructedActorSoundRun(self.project_root)
            sound_works = [run.sound_unit_work(SOUND_PACKAGE_RECORD, {'object': f'MonSound.hit_{export_index}', 'exportIndex': export_index},
                                               {'stableId': f'SYNTHETIC:{export_index}'}) for export_index in (1, 2, 3)]
            outcomes = run_actor_sound_slice(run, ActorSoundBundles(self.project_root, run.store_root, []), 5, lambda: None)
        self.assertEqual((len(builder_reads), len(outcomes)), (1, 2))
        self.assertEqual([work.config['converterSha256'] for work in sound_works],
                         [native_assets.CONVERTER_OUTPUT_VERSION_RAISED_BY_HAND_ONLY_WHEN_OUTPUTS_CHANGE] * 3)
        self.assertEqual(sound_works[0].fingerprint, FIRST_SOUND_UNIT_FINGERPRINT_UNDER_THE_CONVERTER_OUTPUT_VERSION)
        gremlin_receipt = next(receipt for receipt in run.bundle_ledger.sealed_receipts() if receipt['unitKey'] == GREMLIN_KEY)
        self.assertEqual(gremlin_receipt['config']['builderSha256'], hashlib.sha256(builder_path.read_bytes()).hexdigest())


class ActorSoundSealedBundleRepairTests(ActorSoundSliceFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.run_slice()
        self.preflights.clear()

    def assert_the_next_slice_converts_nothing_and_leaves_the_expected_catalog(self):
        _, _, outcomes = self.run_slice()
        self.assertEqual((outcomes, self.preflights), ([], []))
        self.assertEqual(self.catalog_path.read_bytes(), self.expected_catalog_bytes())
        self.assert_the_next_slice_writes_no_file()

    def test_the_missing_record_of_a_sealed_bundle_is_added_again(self):
        self.write_catalog_with_combat_audio(None)
        self.assert_the_next_slice_converts_nothing_and_leaves_the_expected_catalog()

    def test_a_record_that_pins_another_manifest_is_replaced_by_the_record_of_the_sealed_receipt(self):
        self.write_catalog_with_combat_audio([STALE_GREMLIN_COMBAT_AUDIO_RECORD])
        self.assert_the_next_slice_converts_nothing_and_leaves_the_expected_catalog()

    def test_the_record_of_a_bundle_sealed_without_a_manifest_is_removed(self):
        self.write_catalog_with_combat_audio([GREMLIN_COMBAT_AUDIO_RECORD, STALE_SILENT_COMBAT_AUDIO_RECORD])
        self.assert_the_next_slice_converts_nothing_and_leaves_the_expected_catalog()

    def test_a_stale_record_and_a_record_without_a_manifest_are_repaired_in_one_slice(self):
        self.write_catalog_with_combat_audio([STALE_GREMLIN_COMBAT_AUDIO_RECORD, STALE_SILENT_COMBAT_AUDIO_RECORD])
        self.assert_the_next_slice_converts_nothing_and_leaves_the_expected_catalog()
        self.assertEqual(self.gap_rows_path.read_bytes(), expected_gap_row_bytes([*GREMLIN_GAP_ROWS, *SILENT_GAP_ROWS]))

    def test_the_deleted_gap_row_file_gets_the_rows_of_the_sealed_bundles_again(self):
        self.gap_rows_path.unlink()
        _, _, outcomes = self.run_slice()
        self.assertEqual((outcomes, self.preflights), ([], []))
        self.assertEqual(self.gap_rows_path.read_bytes(), expected_gap_row_bytes([*GREMLIN_GAP_ROWS, *SILENT_GAP_ROWS]))
        self.assert_the_next_slice_writes_no_file()


if __name__ == '__main__':
    unittest.main()
