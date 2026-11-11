from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.actor_sound_batch import ActorSoundBundles, run_actor_sound_slice
from actors.actor_sound_bindings import ACTOR_SOUND_STEP, NO_EXACT_SKILL_SOUND_ROW_REASON, actor_sound_bundle_id
from actors.actor_sound_conversion import (ACTOR_SOUND_ALGORITHM_VERSION, ACTOR_SOUND_UNIT_STEP, ActorSoundConversionRun,
                                           no_sound_row_bundle_outcome)
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
        outcomes = run_actor_sound_slice(run, ActorSoundBundles(self.project_root, run.store_root), 5,
                                         lambda: self.preflights.append(builder_sha256))
        return run, outcomes

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

    def test_a_bundle_that_loses_its_sound_row_loses_its_combat_audio_record(self):
        run = SyntheticActorSoundRun(self.project_root, FIRST_BUILDER_SHA256)
        catalog, _ = read_store_catalog(run.store_root)
        write_store_catalog(run.store_root, {**catalog, 'combatAudio': [STALE_SKILL_COMBAT_AUDIO_RECORD]})
        outcome = no_sound_row_bundle_outcome(run, 'skill:1:1', NO_EXACT_SKILL_SOUND_ROW_REASON, {'path': 'system/skillsoundgrp.dat', 'sha256': 'c' * 64})
        self.assertEqual((outcome['status'], outcome['bundleId']), ('gap', None))
        self.assertEqual(read_store_catalog(run.store_root)[0]['combatAudio'], [])


if __name__ == '__main__':
    unittest.main()
