import _winapi
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.skill_bundle_step_names import SKILL_DISPATCH_CLASS_STEP, SKILL_EFFECT_ROOT_STEP, SOURCE_BUNDLE_FOLDER
from actors.skill_effect_conversion import convert_skill_batch_slice
from native_store import converter_scratch_removal, unit_ledger
from native_store.interprocess_lock import lane_batch_lock
from native_store.share_identical_lane_files import BATCH_LANE_SHARED_MESSAGE_PREFIX, share_identical_files_of_batch_lane
from native_store.unit_ledger import RUNNING_MARKER_NAME, SEAL_RECORD_NAME
from support.shared_lane_fixture import (SharedLaneFixture, SharedLaneTestCase, hold_file_open_without_sharing, payload_of,
                                         run_sharing_command, snapshot_of_every_entry, write_file)
from test_skill_effect_batch_bookkeeping import (FIRST_CLASS, ONE_LEVEL_ROOT, SECOND_CLASS, TWO_LEVEL_ROOT, UNSEALED_ROOT,
                                                 CandidateClassSkillEffectRun)

SCRATCH_FILE_BYTES = 5000
SCRATCH = payload_of('scratch', SCRATCH_FILE_BYTES)
EVIDENCE = payload_of('evidence', SCRATCH_FILE_BYTES)
STAGED_MANIFEST_RELATIVE_PATH = f'effects/{"e" * 64}/manifest.json'
OUTCOME_RECORD_RELATIVE_PATH = 'outcome.json'
UNIT_KEY_BY_SKILL_STEP = {SKILL_EFFECT_ROOT_STEP: 'skill-root:skill.wh.1011', SKILL_DISPATCH_CLASS_STEP: 'skill-dispatch-class:LineageEffect.s_u010_a'}
NPC_PROFILE_PACK_STEP = 'npc-profile-pack'
BUNDLE_SCRATCH_FOLDER = SOURCE_BUNDLE_FOLDER + '/.work'
REMOVING_BUNDLE_SCRATCH_FOLDER = BUNDLE_SCRATCH_FOLDER + '.removing'
BUNDLE_SCRATCH_FILES = (BUNDLE_SCRATCH_FOLDER + '/classes/engine.u', BUNDLE_SCRATCH_FOLDER + '/classes/decoded/lineageeffect/class.json')
BUNDLE_EVIDENCE_FILES = tuple(f'{SOURCE_BUNDLE_FOLDER}/{relative}' for relative in (
    'manifest.json', 'receipt.json', 'assets/texture.l2asset', 'source/lineageeffect.u'))
BUNDLE_SCRATCH_BYTES = len(BUNDLE_SCRATCH_FILES) * SCRATCH_FILE_BYTES
SCRATCH_REPORT_KEYS = ('scratchJobFoldersRemoved', 'scratchJobFoldersNotRemoved', 'scratchBytesRemoved', 'scratchBytesLeftByLane')
STOPPED_REMOVAL_MESSAGE = 'the removal stopped after its first file'


def scratch_report(report):
    return tuple(report[key] for key in SCRATCH_REPORT_KEYS)


def write_bundle_files(step_directory):
    for relative in BUNDLE_EVIDENCE_FILES:
        write_file(step_directory / relative, EVIDENCE)
    return [write_file(step_directory / relative, SCRATCH) for relative in BUNDLE_SCRATCH_FILES]


def file_bytes_by_relative_path(folder):
    return {path.relative_to(folder).as_posix(): path.read_bytes() for path in sorted(folder.rglob('*')) if path.is_file()}


class SealedSkillBundleScratchRemovalTests(SharedLaneTestCase):
    def seal_unit_with_bundle_scratch(self, step, lane_name='actors', unit_key=None):
        step_directory = self.lanes.seal_unit(lane_name, unit_key or UNIT_KEY_BY_SKILL_STEP[step], {
            STAGED_MANIFEST_RELATIVE_PATH: payload_of(step), OUTCOME_RECORD_RELATIVE_PATH: payload_of('outcome of ' + step)}, step=step)
        write_bundle_files(step_directory)
        return step_directory

    def begin_unit_with_bundle_scratch(self, step, unit_key):
        step_directory = self.lanes.begin_unit('actors', unit_key, {OUTCOME_RECORD_RELATIVE_PATH: EVIDENCE}, step=step)[3]
        write_bundle_files(step_directory)
        return step_directory

    def sealed_receipt_read_from_the_files(self, step):
        unit_ledger.verified_receipts_by_step_directory_and_unit_key.clear()
        return self.lanes.ledger('actors', step).sealed_receipt(UNIT_KEY_BY_SKILL_STEP[step])

    def test_a_sealed_unit_of_each_skill_step_loses_its_bundle_scratch_and_keeps_every_other_file_and_its_receipt(self):
        step_directories = [self.seal_unit_with_bundle_scratch(step) for step in UNIT_KEY_BY_SKILL_STEP]
        receipts = [self.sealed_receipt_read_from_the_files(step) for step in UNIT_KEY_BY_SKILL_STEP]
        kept_file_bytes = [{relative: payload for relative, payload in file_bytes_by_relative_path(step_directory).items()
                            if relative not in BUNDLE_SCRATCH_FILES} for step_directory in step_directories]
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (2, 0, 2 * BUNDLE_SCRATCH_BYTES, {'actors': 0}))
        self.assertEqual([file_bytes_by_relative_path(step_directory) for step_directory in step_directories], kept_file_bytes)
        self.assertEqual([sorted(path.name for path in (step_directory / SOURCE_BUNDLE_FOLDER).iterdir()) for step_directory in step_directories],
                         [['assets', 'manifest.json', 'receipt.json', 'source']] * 2)
        self.assertEqual([self.sealed_receipt_read_from_the_files(step) for step in UNIT_KEY_BY_SKILL_STEP], receipts)
        self.assertNotIn(None, receipts)

    def test_an_unsealed_step_a_running_step_and_a_sealed_step_of_another_kind_keep_their_bundle_scratch(self):
        running_step = self.begin_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP, 'skill-root:skill.wh.1012')
        step_without_a_record = self.begin_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP, 'skill-root:skill.wh.1014')
        (step_without_a_record / RUNNING_MARKER_NAME).unlink()
        sealed_step_with_a_running_marker = self.seal_unit_with_bundle_scratch(SKILL_DISPATCH_CLASS_STEP)
        write_file(sealed_step_with_a_running_marker / RUNNING_MARKER_NAME, b'{}')
        npc_profile_pack_step = self.seal_unit_with_bundle_scratch(NPC_PROFILE_PACK_STEP, unit_key='npc-profile-pack:0123456789abcdef')
        step_of_another_kind = self.seal_unit_with_bundle_scratch('model', unit_key='skill-root:skill.wh.1015')
        snapshot = snapshot_of_every_entry(self.lanes.lane_folder('actors') / 'work')
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (0, 0, 0, {'actors': 0}))
        for step_directory in (running_step, step_without_a_record, sealed_step_with_a_running_marker, npc_profile_pack_step,
                               step_of_another_kind):
            self.assertEqual([(step_directory / relative).read_bytes() for relative in BUNDLE_SCRATCH_FILES], [SCRATCH] * 2)
        self.assertEqual({relative: entry for relative, entry in snapshot_of_every_entry(self.lanes.lane_folder('actors') / 'work').items()
                          if '/bundle' in relative}, {relative: entry for relative, entry in snapshot.items() if '/bundle' in relative})

    def test_a_lane_that_is_not_held_free_keeps_its_bundle_scratch_and_the_report_states_its_bytes(self):
        step_directories = [self.seal_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP, lane_name) for lane_name in ('actors', 'data-ui')]
        report = self.share()
        self.assertEqual(scratch_report(report), (0, 0, 0, {'actors': BUNDLE_SCRATCH_BYTES, 'data-ui': BUNDLE_SCRATCH_BYTES}))
        report = self.share(lanes_free_of_conversions=['data-ui'])
        self.assertEqual(scratch_report(report), (0, 0, 0, {'actors': BUNDLE_SCRATCH_BYTES, 'data-ui': BUNDLE_SCRATCH_BYTES}))
        self.assertEqual([[(step_directory / relative).read_bytes() for relative in BUNDLE_SCRATCH_FILES] for step_directory in step_directories],
                         [[SCRATCH] * 2] * 2)

    def test_the_command_in_plan_mode_removes_nothing_and_states_the_folders_and_bytes_a_run_removes(self):
        step_directories = [self.seal_unit_with_bundle_scratch(step) for step in UNIT_KEY_BY_SKILL_STEP]
        snapshot = snapshot_of_every_entry(self.lanes.project)
        plan_exit_code, plan_output, plan_error, _ = run_sharing_command(self.lanes.lane_stores_root, '--plan')
        self.assertEqual((plan_exit_code, plan_error, snapshot_of_every_entry(self.lanes.project)), (0, '', snapshot))
        run_exit_code, run_output, run_error, _ = run_sharing_command(self.lanes.lane_stores_root)
        self.assertEqual((run_exit_code, run_error), (0, ''))
        self.assertEqual(scratch_report(json.loads(plan_output)), scratch_report(json.loads(run_output)))
        self.assertEqual(scratch_report(json.loads(run_output)), (2, 0, 2 * BUNDLE_SCRATCH_BYTES, {'actors': 0}))
        self.assertEqual([(step_directory / BUNDLE_SCRATCH_FOLDER).exists() for step_directory in step_directories], [False, False])

    def test_the_rest_of_a_stopped_bundle_scratch_removal_goes_in_the_next_run(self):
        step_directory = self.seal_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP)
        remove_folder_tree = shutil.rmtree

        def remove_one_file_and_stop(folder):
            if Path(folder).name == Path(REMOVING_BUNDLE_SCRATCH_FOLDER).name:
                os.unlink(Path(folder) / 'classes' / 'engine.u')
                raise PermissionError(STOPPED_REMOVAL_MESSAGE)
            remove_folder_tree(folder)

        with patch.object(converter_scratch_removal.shutil, 'rmtree', remove_one_file_and_stop):
            report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (0, 1, SCRATCH_FILE_BYTES, {'actors': SCRATCH_FILE_BYTES}))
        self.assertEqual(((step_directory / BUNDLE_SCRATCH_FOLDER).exists(), (step_directory / REMOVING_BUNDLE_SCRATCH_FOLDER).is_dir()),
                         (False, True))
        plan = self.share(plan_only=True, lanes_free_of_conversions=['actors'])
        self.assertEqual((scratch_report(plan), (step_directory / REMOVING_BUNDLE_SCRATCH_FOLDER).is_dir()),
                         ((1, 0, SCRATCH_FILE_BYTES, {'actors': 0}), True))
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (1, 0, SCRATCH_FILE_BYTES, {'actors': 0}))
        self.assertEqual(sorted(path.name for path in (step_directory / SOURCE_BUNDLE_FOLDER).iterdir()),
                         ['assets', 'manifest.json', 'receipt.json', 'source'])

    def test_a_bundle_scratch_folder_with_a_file_open_elsewhere_stays_whole_and_the_other_goes(self):
        held_step_directory, other_step_directory = (self.seal_unit_with_bundle_scratch(step) for step in UNIT_KEY_BY_SKILL_STEP)
        hold_file_open_without_sharing(self, held_step_directory / BUNDLE_SCRATCH_FILES[1])
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (1, 1, BUNDLE_SCRATCH_BYTES, {'actors': BUNDLE_SCRATCH_BYTES}))
        self.assertEqual([(held_step_directory / relative).stat().st_size for relative in BUNDLE_SCRATCH_FILES], [SCRATCH_FILE_BYTES] * 2)
        self.assertEqual(((held_step_directory / REMOVING_BUNDLE_SCRATCH_FOLDER).exists(), (other_step_directory / BUNDLE_SCRATCH_FOLDER).exists()),
                         (False, False))

    def test_a_step_bundle_or_scratch_folder_that_is_a_junction_is_not_followed(self):
        outside_folder = self.lanes.project / 'outside-the-lane'
        outside_step_folder = self.lanes.project / 'sealed-step-outside-the-lane'
        outside_files = [write_file(outside_folder / relative, SCRATCH) for relative in ('.work/classes/engine.u', 'classes/engine.u')]
        outside_files += [write_file(outside_step_folder / SEAL_RECORD_NAME, EVIDENCE), *write_bundle_files(outside_step_folder)]
        step_with_a_scratch_junction, step_with_a_bundle_junction = (self.seal_unit_with_bundle_scratch(step) for step in UNIT_KEY_BY_SKILL_STEP)
        step_that_is_a_junction = self.seal_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP, unit_key='skill-root:skill.wh.1016')
        for junction, target in ((step_with_a_scratch_junction / BUNDLE_SCRATCH_FOLDER, outside_folder),
                                 (step_with_a_bundle_junction / SOURCE_BUNDLE_FOLDER, outside_folder),
                                 (step_that_is_a_junction, outside_step_folder)):
            shutil.rmtree(junction)
            _winapi.CreateJunction(str(target), str(junction))
            self.addCleanup(os.rmdir, junction)
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(scratch_report(report), (0, 0, 0, {'actors': 0}))
        self.assertEqual([path.stat().st_size for path in outside_files], [SCRATCH_FILE_BYTES] * len(outside_files))
        self.assertTrue((step_with_a_scratch_junction / BUNDLE_SCRATCH_FOLDER).is_dir())

    def test_a_run_lists_the_unit_folders_once_and_no_folder_of_a_step_of_another_kind(self):
        skill_step_directory = self.seal_unit_with_bundle_scratch(SKILL_EFFECT_ROOT_STEP)
        self.seal_unit_with_bundle_scratch(NPC_PROFILE_PACK_STEP, unit_key='npc-profile-pack:0123456789abcdef')
        self.seal_unit_with_bundle_scratch('model', unit_key='item:57')
        lane_folder = self.lanes.lane_folder('actors')
        listed_folders = []
        directory_entries = converter_scratch_removal.directory_entries

        def recorded_directory_entries(folder):
            listed_folders.append(Path(folder))
            return directory_entries(folder)

        with patch.object(converter_scratch_removal, 'directory_entries', recorded_directory_entries):
            removal = converter_scratch_removal.lane_scratch_removal(lane_folder, True, False)
        self.assertEqual(tuple(removal), (1, 0, BUNDLE_SCRATCH_BYTES, 0))
        self.assertEqual(listed_folders.count(lane_folder / 'work'), 1)
        self.assertEqual([folder for folder in listed_folders
                          if folder != lane_folder / 'work' and not folder.is_relative_to(skill_step_directory / SOURCE_BUNDLE_FOLDER)], [])


class ScratchLeavingSkillEffectRun(CandidateClassSkillEffectRun):
    def migrated_bundle_outcome(self, recipe, closure_item, closure_of, step_directory):
        write_bundle_files(step_directory)
        return super().migrated_bundle_outcome(recipe, closure_item, closure_of, step_directory)


class SkillBatchAfterBundleScratchRemovalTests(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)
        self.catalog_path = self.lanes.lane_folder('actors') / 'l2' / 'catalog.json'

    def bundle_scratch_folders(self):
        return sorted(self.lanes.lane_folder('actors').glob(f'work/*/*/{BUNDLE_SCRATCH_FOLDER}*'))

    def remove_scratch_through_the_batch_end_pass(self):
        errors = io.StringIO()
        with lane_batch_lock(self.lanes.lane_folder('actors') / 'work') as held_lane_lock, contextlib.redirect_stderr(errors):
            lane_was_shared = share_identical_files_of_batch_lane(self.lanes.project, 'actors', held_lane_lock)
        return lane_was_shared, json.loads(errors.getvalue().removeprefix(BATCH_LANE_SHARED_MESSAGE_PREFIX))

    def test_a_skills_batch_after_the_pass_finds_every_unit_sealed_converts_nothing_and_writes_the_same_catalog(self):
        first_run = ScratchLeavingSkillEffectRun(self.lanes.project)
        outcomes, _ = convert_skill_batch_slice(first_run, 10, lambda: None)
        converted_unit_count = sum(outcome['status'] == 'converted' for outcome in outcomes)
        self.assertEqual((converted_unit_count, len(self.bundle_scratch_folders())), (5, 5))
        catalog_bytes = self.catalog_path.read_bytes()
        lane_was_shared, report = self.remove_scratch_through_the_batch_end_pass()
        self.assertEqual((lane_was_shared, scratch_report(report)), (True, (5, 0, 5 * BUNDLE_SCRATCH_BYTES, {'actors': 0})))
        self.assertEqual(self.bundle_scratch_folders(), [])
        second_run = ScratchLeavingSkillEffectRun(self.lanes.project)
        unit_ledger.verified_receipts_by_step_directory_and_unit_key.clear()

        def refuse_a_conversion():
            raise AssertionError('a sealed skill unit started a conversion')

        outcomes, summary = convert_skill_batch_slice(second_run, 10, refuse_a_conversion)
        self.assertEqual((outcomes, second_run.migrated_recipes), ([], []))
        self.assertEqual((summary['convertedRoots'], summary['alreadySealedRoots'], summary['convertedDispatchClasses'],
                          summary['alreadySealedDispatchClasses']), (0, 3, 0, 3))
        cache_hits = [second_run.convert_root(visual_root) for visual_root in (TWO_LEVEL_ROOT, ONE_LEVEL_ROOT, UNSEALED_ROOT)] + [
            second_run.dispatch_classes.convert_class(effect_object) for effect_object in (FIRST_CLASS, SECOND_CLASS)]
        self.assertEqual([(outcome['status'], outcome['cacheHit']) for outcome in cache_hits], [('skipped', True)] * 5)
        self.assertEqual((second_run.migrated_recipes, self.catalog_path.read_bytes()), ([], catalog_bytes))


if __name__ == '__main__':
    unittest.main()
