import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.actor_sound_batch import ActorSoundBundles, run_actor_sound_slice
from actors.actor_sound_bindings import ACTOR_SOUND_STEP, NO_EXACT_SKILL_SOUND_ROW_REASON, actor_sound_bundle_id
from actors.actor_sound_conversion import (ACTOR_SOUND_ALGORITHM_VERSION, ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH, ACTOR_SOUND_UNIT_STEP,
                                           ActorSoundConversionRun)
from catalog_store_fixture import write_profile_manifest, write_store_catalog
from native_store.catalog_writer import read_store_catalog
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger

FIRST_BUILDER_SHA256 = 'a' * 64
CHANGED_BUILDER_SHA256 = 'b' * 64
GREMLIN_PROFILE = {'npcId': 20001, 'name': 'Gremlin', 'modelCatalogId': 'npc-model:gremlin', 'mesh': 'LineageMonsters.gremlin_m00'}
STALE_GREMLIN_COMBAT_AUDIO_RECORD = {'id': actor_sound_bundle_id('npc:20001'), 'manifest': f'/l2/combat-audio/{"d" * 64}/manifest.json',
                                     'manifestBytes': 1, 'manifestSha256': 'd' * 64}
STALE_SKILL_COMBAT_AUDIO_RECORD = {**STALE_GREMLIN_COMBAT_AUDIO_RECORD, 'id': actor_sound_bundle_id('skill:1:1')}
NO_SOUND_ROW_SKILL_BINDING = {'key': 'skill:1:1', 'skillId': 1, 'level': 1, 'status': 'gap', 'visualRoot': None, 'soundRowOrdinal': None,
                              'soundReason': NO_EXACT_SKILL_SOUND_ROW_REASON, 'reason': NO_EXACT_SKILL_SOUND_ROW_REASON}
SKILLSOUNDGRP_IDENTITY = {'path': 'system/skillsoundgrp.dat', 'sha256': 'c' * 64}
NO_SOUND_ROW_SKILL_COMPONENT = {'id': 'interlude:skill:1:level:1:native-description-action'}
NO_BOUND_NPCGRP_ROUTES ={'table': 'npcgrp', 'routes': {}, 'unresolved': {
    role: {'reason': f'combat-role-route-unresolved:npcgrp/{role}', 'detail': 'route proof is missing'}
    for role in ('attackItem', 'attackVoice', 'defense', 'damage')}}


class SyntheticActorSoundRun(ActorSoundConversionRun):
    def __init__(self, project_root, builder_sha256):
        work_root = lane_work_root(project_root, 'actors')
        self.project_root, self.store_root = Path(project_root), lane_store_root(project_root, 'actors')
        self.sound_ledger = UnitLedger(work_root, ACTOR_SOUND_UNIT_STEP, ACTOR_SOUND_ALGORITHM_VERSION)
        self.bundle_ledger = UnitLedger(work_root, ACTOR_SOUND_STEP, ACTOR_SOUND_ALGORITHM_VERSION)
        self.lane_folder = self.bundle_ledger.lane_folder
        self.synthetic_builder_sha256 = builder_sha256
        self.tables = {'npcgrp': {'identity': {'path': 'system/npcgrp.dat', 'sha256': 'c' * 64}, 'original': b'synthetic npcgrp',
                                  'decoded': {'synthetic': 'npcgrp'}}}

    def routes(self, name):
        return NO_BOUND_NPCGRP_ROUTES

    def bound_references(self, actor_rows):
        return []

    def builder_sha256(self):
        return self.synthetic_builder_sha256


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns) for path in root.rglob('*') if path.is_file()}


class ActorSoundBundleResealTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        store_root = lane_store_root(self.project_root, 'actors')
        profile_record = write_profile_manifest(store_root, 'native-npc-profiles', [GREMLIN_PROFILE])
        write_store_catalog(store_root, {'schemaVersion': 1, 'models': [], 'npcProfiles': [profile_record]})
        self.preflights = []

    def run_batch(self, builder_sha256):
        run = SyntheticActorSoundRun(self.project_root, builder_sha256)
        outcomes = run_actor_sound_slice(run, self.bundles_with_no_sound_row_skill(run), 5, lambda: self.preflights.append(builder_sha256))
        return run, outcomes

    def bundles_with_no_sound_row_skill(self, run):
        bundles = ActorSoundBundles(self.project_root, run.store_root)
        bundles.skill_tables = SimpleNamespace(binding_rows=[NO_SOUND_ROW_SKILL_BINDING], sound_rows=[],
                                               sound_table={'source': SKILLSOUNDGRP_IDENTITY['path'], 'sourceSha256': SKILLSOUNDGRP_IDENTITY['sha256']})
        bundles.skill_bindings_by_key = {NO_SOUND_ROW_SKILL_BINDING['key']: NO_SOUND_ROW_SKILL_BINDING}
        return bundles

    def add_no_sound_row_skill_to_the_catalog(self):
        store_root = lane_store_root(self.project_root, 'actors')
        catalog, _ = read_store_catalog(store_root)
        write_store_catalog(store_root, {**catalog, 'effectComponents': [NO_SOUND_ROW_SKILL_COMPONENT]})

    def test_an_unchanged_sealed_bundle_is_skipped_without_writing_a_file(self):
        self.run_batch(FIRST_BUILDER_SHA256)
        before = snapshot_tree(self.project_root)
        _, outcomes = self.run_batch(FIRST_BUILDER_SHA256)
        self.assertEqual((outcomes, self.preflights), ([], [FIRST_BUILDER_SHA256]))
        self.assertEqual(snapshot_tree(self.project_root), before)

    def test_a_sealed_bundle_whose_builder_changed_is_resealed_by_the_batch(self):
        first_run, first_outcomes = self.run_batch(FIRST_BUILDER_SHA256)
        self.assertEqual([(outcome['key'], outcome['cacheHit']) for outcome in first_outcomes], [('npc:20001', False)])
        run, outcomes = self.run_batch(CHANGED_BUILDER_SHA256)
        self.assertEqual([(outcome['key'], outcome['cacheHit']) for outcome in outcomes], [('npc:20001', False)])
        self.assertEqual(self.preflights, [FIRST_BUILDER_SHA256, CHANGED_BUILDER_SHA256])
        [receipt] = run.bundle_ledger.sealed_receipts()
        self.assertEqual((receipt['unitKey'], receipt['config']['builderSha256']), ('npc:20001', CHANGED_BUILDER_SHA256))
        self.assertFalse(first_run.bundle_ledger.is_sealed('npc:20001', first_run.bundle_work('npc:20001', receipt['config']['actorRows'],
                                                                                             first_run.sealed_sound_outcome).fingerprint))

    def test_a_bundle_resealed_without_a_manifest_loses_its_combat_audio_record(self):
        store_root = lane_store_root(self.project_root, 'actors')
        catalog, _ = read_store_catalog(store_root)
        write_store_catalog(store_root, {**catalog, 'combatAudio': [STALE_GREMLIN_COMBAT_AUDIO_RECORD]})
        _, outcomes = self.run_batch(FIRST_BUILDER_SHA256)
        self.assertEqual([(outcome['key'], outcome['bundleId']) for outcome in outcomes], [('npc:20001', None)])
        self.assertEqual(read_store_catalog(store_root)[0]['combatAudio'], [])

    def test_a_skill_bundle_without_a_sound_row_is_sealed_once_and_skipped_by_the_next_slice(self):
        self.add_no_sound_row_skill_to_the_catalog()
        run, first_outcomes = self.run_batch(FIRST_BUILDER_SHA256)
        self.assertEqual([(outcome['key'], outcome['status'], outcome['reason'], outcome['cacheHit']) for outcome in first_outcomes],
                         [('npc:20001', 'gap', 'combat-role-route-unresolved:npcgrp/attackItem', False),
                          ('skill:1:1', 'gap', NO_EXACT_SKILL_SOUND_ROW_REASON, False)])
        skill_receipt = next(receipt for receipt in run.bundle_ledger.sealed_receipts() if receipt['unitKey'] == 'skill:1:1')
        gap_rows = json.loads((run.lane_folder / ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH).read_bytes())['rows']
        receipt_evidence = (run.bundle_ledger.unit_step_directory('skill:1:1') / 'receipt.json').relative_to(run.lane_folder).as_posix()
        self.assertEqual([(row['reason'], row['evidence']) for row in gap_rows if row['key'] == 'skill:1:1'],
                         [(NO_EXACT_SKILL_SOUND_ROW_REASON, receipt_evidence)])
        self.assertEqual(skill_receipt['gapRows'], [row for row in gap_rows if row['key'] == 'skill:1:1'])
        _, second_outcomes = self.run_batch(FIRST_BUILDER_SHA256)
        self.assertEqual(second_outcomes, [])

    def test_a_bundle_that_loses_its_sound_row_loses_its_combat_audio_record(self):
        run = SyntheticActorSoundRun(self.project_root, FIRST_BUILDER_SHA256)
        catalog, _ = read_store_catalog(run.store_root)
        write_store_catalog(run.store_root, {**catalog, 'combatAudio': [STALE_SKILL_COMBAT_AUDIO_RECORD]})
        outcome = run.convert_no_sound_row_bundle(NO_SOUND_ROW_SKILL_BINDING, SKILLSOUNDGRP_IDENTITY, 5)
        self.assertEqual((outcome['status'], outcome['bundleId']), ('gap', None))
        self.assertEqual(read_store_catalog(run.store_root)[0]['combatAudio'], [])

if __name__ == '__main__':
    unittest.main()
