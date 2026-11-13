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

from native_store import converter_scratch_removal
from support.shared_lane_fixture import (CONVERTER_RELATIVE_FOLDER, SOUND_CONVERTER_RELATIVE_FOLDER, SharedLaneTestCase,
                                         hold_file_open_without_sharing, link_count, payload_of, run_sharing_command, snapshot_of_every_entry,
                                         synthetic_audio_converter_and_request, write_file)

TWIN = payload_of('twin')
OTHER = payload_of('other')
SCRATCH_FILE_BYTES = 5000
SCRATCH = payload_of('scratch', SCRATCH_FILE_BYTES)
ACTORS_LANE_CHILD_CONVERTER_FOLDER = 'converter'
LANES_WITH_SCRATCH_REMOVAL = ('actors', 'world')
SCRATCH_REPORT_KEYS = ('scratchJobFoldersRemoved', 'scratchJobFoldersNotRemoved', 'scratchBytesRemoved', 'scratchBytesLeftByLane')
STOPPED_REMOVAL_MESSAGE = 'the removal stopped after its first file'


class ConverterScratchRemovalTests(SharedLaneTestCase):
    def write_job_file(self, lane_name, job_name, relative='export/twin.png', converter_relative=CONVERTER_RELATIVE_FOLDER):
        return write_file(self.lanes.converter_folder(lane_name, converter_relative) / '.work' / job_name / relative, SCRATCH)

    def job_folder_names(self, lane_name, converter_relative=CONVERTER_RELATIVE_FOLDER):
        return sorted(path.name for path in (self.lanes.lane_folder(lane_name) / converter_relative / '.work').iterdir())

    def scratch_report(self, report):
        return tuple(report[key] for key in SCRATCH_REPORT_KEYS)

    def test_a_run_removes_the_job_folders_of_world_and_actors_and_keeps_evidence_index_and_content_folders(self):
        kept_paths = []
        for lane_name in LANES_WITH_SCRATCH_REMOVAL:
            self.write_job_file(lane_name, 'job-1')
            self.write_job_file(lane_name, 'job-1', 'failure.txt')
            self.write_job_file(lane_name, 'job-2', 'export/deep/folder/twin.png')
            kept_paths += [self.lanes.write_converter_file(lane_name, 'evidence/export/twin.png', TWIN),
                           self.lanes.write_converter_file(lane_name, 'asset.l2asset', OTHER),
                           write_file(self.lanes.converter_folder(lane_name) / 'index' / 'request.json', SCRATCH)]
        self.write_job_file('actors', 'job-3', converter_relative=ACTORS_LANE_CHILD_CONVERTER_FOLDER)
        kept_bytes = [path.read_bytes() for path in kept_paths]
        report = self.share(lanes_free_of_conversions=LANES_WITH_SCRATCH_REMOVAL)
        self.assertEqual(self.scratch_report(report), (5, 0, 7 * SCRATCH_FILE_BYTES, {'actors': 0, 'world': 0}))
        self.assertEqual([self.job_folder_names(lane_name) for lane_name in LANES_WITH_SCRATCH_REMOVAL], [[], []])
        self.assertEqual(self.job_folder_names('actors', ACTORS_LANE_CHILD_CONVERTER_FOLDER), [])
        self.assertEqual([path.read_bytes() for path in kept_paths], kept_bytes)
        self.assertEqual(report['sharedNames'], 2)

    def test_plan_mode_removes_nothing_and_states_what_a_run_would_remove(self):
        for lane_name in LANES_WITH_SCRATCH_REMOVAL:
            self.write_job_file(lane_name, 'job-1')
        self.write_job_file('integration', 'job-1')
        snapshot = snapshot_of_every_entry(self.lanes.project)
        plan = self.share(plan_only=True, lanes_free_of_conversions=LANES_WITH_SCRATCH_REMOVAL)
        self.assertEqual(snapshot_of_every_entry(self.lanes.project), snapshot)
        report = self.share(lanes_free_of_conversions=LANES_WITH_SCRATCH_REMOVAL)
        self.assertEqual(self.scratch_report(plan), self.scratch_report(report))
        self.assertEqual(self.scratch_report(report),
                         (2, 0, 2 * SCRATCH_FILE_BYTES, {'actors': 0, 'integration': SCRATCH_FILE_BYTES, 'world': 0}))

    def test_a_scratch_folder_outside_a_converter_folder_stays(self):
        kept_paths = [self.lanes.write_lane_file('world', relative, SCRATCH) for relative in (
            '.work/job/twin.png', 'l2/models/.work/job/twin.png', 'work/.work/job/twin.png', 'work/tile__20_21/meshes/.work/job/twin.png',
            'work/folder-without-an-index/.work/job/twin.png', 'gap-rows/.work/job/twin.png')]
        self.lanes.converter_folder('world')
        report = self.share(lanes_free_of_conversions=LANES_WITH_SCRATCH_REMOVAL)
        self.assertEqual(self.scratch_report(report), (0, 0, 0, {'world': 0}))
        self.assertEqual([path.read_bytes() for path in kept_paths], [SCRATCH] * len(kept_paths))

    def test_data_ui_and_integration_keep_their_scratch_and_the_report_states_its_bytes(self):
        lane_names = ('actors', 'data-ui', 'integration', 'world')
        job_paths = {lane_name: self.write_job_file(lane_name, 'job-1') for lane_name in lane_names}
        self.write_job_file('integration', 'job-2')
        report = self.share(lanes_free_of_conversions=lane_names)
        self.assertEqual(self.scratch_report(report), (2, 0, 2 * SCRATCH_FILE_BYTES, {
            'actors': 0, 'data-ui': SCRATCH_FILE_BYTES, 'integration': 2 * SCRATCH_FILE_BYTES, 'world': 0}))
        self.assertEqual([job_paths[lane_name].exists() for lane_name in lane_names], [False, True, True, False])

    def test_a_lane_that_is_not_named_free_keeps_its_job_folders(self):
        world_job_path, actors_job_path = (self.write_job_file(lane_name, 'job-1') for lane_name in ('world', 'actors'))
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual(self.scratch_report(report), (1, 0, SCRATCH_FILE_BYTES, {'actors': 0, 'world': SCRATCH_FILE_BYTES}))
        self.assertEqual((world_job_path.read_bytes(), actors_job_path.exists()), (SCRATCH, False))
        report = self.share()
        self.assertEqual(self.scratch_report(report), (0, 0, 0, {'actors': 0, 'world': SCRATCH_FILE_BYTES}))

    def test_a_job_folder_with_a_file_open_elsewhere_stays_whole_and_the_others_go(self):
        held_job_paths = [self.write_job_file('world', 'job-1', relative) for relative in ('export/first.png', 'export/second.png', 'log.txt')]
        self.write_job_file('world', 'job-0')
        self.write_job_file('world', 'job-2')
        hold_file_open_without_sharing(self, held_job_paths[1])
        report = self.share(lanes_free_of_conversions=['world'])
        self.assertEqual(self.scratch_report(report), (2, 1, 2 * SCRATCH_FILE_BYTES, {'world': 3 * SCRATCH_FILE_BYTES}))
        self.assertEqual(self.job_folder_names('world'), ['job-1'])
        self.assertEqual([path.stat().st_size for path in held_job_paths], [SCRATCH_FILE_BYTES] * 3)
        self.assertEqual([held_job_paths[0].read_bytes(), held_job_paths[2].read_bytes()], [SCRATCH] * 2)

    def test_the_rest_of_a_stopped_removal_goes_in_the_next_run(self):
        job_paths = [self.write_job_file('world', 'job-1', relative) for relative in ('first.png', 'second.png')]
        self.write_job_file('world', 'job-2')
        remove_folder_tree = shutil.rmtree

        def remove_one_file_and_stop(folder):
            if Path(folder).name == 'job-1.removing':
                os.unlink(Path(folder) / job_paths[0].name)
                raise PermissionError(STOPPED_REMOVAL_MESSAGE)
            remove_folder_tree(folder)

        with patch.object(converter_scratch_removal.shutil, 'rmtree', remove_one_file_and_stop):
            report = self.share(lanes_free_of_conversions=['world'])
        self.assertEqual(self.scratch_report(report), (1, 1, 2 * SCRATCH_FILE_BYTES, {'world': SCRATCH_FILE_BYTES}))
        self.assertEqual(self.job_folder_names('world'), ['job-1.removing'])
        plan = self.share(plan_only=True, lanes_free_of_conversions=['world'])
        self.assertEqual((self.scratch_report(plan), self.job_folder_names('world')),
                         ((1, 0, SCRATCH_FILE_BYTES, {'world': 0}), ['job-1.removing']))
        report = self.share(lanes_free_of_conversions=['world'])
        self.assertEqual((self.scratch_report(report), self.job_folder_names('world')), ((1, 0, SCRATCH_FILE_BYTES, {'world': 0}), []))

    def test_the_command_shares_the_unit_step_outputs_of_world_and_not_those_of_data_ui(self):
        unit_paths = {}
        for lane_name in ('world', 'data-ui'):
            unit_paths[lane_name] = self.lanes.seal_unit(lane_name, 'tile:20_21', {'products/twin.bin': TWIN},
                                                         store_files={'models/twin.bin': TWIN}) / 'products' / 'twin.bin'
            self.write_job_file(lane_name, 'job-1')
        exit_code, output, error, _ = run_sharing_command(self.lanes.lane_stores_root)
        report = json.loads(output)
        self.assertEqual((exit_code, error, report['filesSkippedByRule']['unit-step-of-a-lane-in-use']), (0, '', 1))
        self.assertEqual((link_count(unit_paths['world']), link_count(unit_paths['data-ui'])), (3, 1))
        self.assertEqual(self.scratch_report(report), (1, 0, SCRATCH_FILE_BYTES, {'data-ui': SCRATCH_FILE_BYTES, 'world': 0}))

    def test_a_converter_cache_hit_after_the_scratch_removal_still_does_no_work(self):
        converter, request = synthetic_audio_converter_and_request(self, self.lanes)
        first_result = converter.convert(request)
        self.write_job_file('actors', 'job-left-by-an-attempt', converter_relative=SOUND_CONVERTER_RELATIVE_FOLDER)
        content_folder = Path(first_result['file']).parent
        content_snapshot = snapshot_of_every_entry(content_folder)
        index_snapshot = snapshot_of_every_entry(content_folder.parent / 'index')
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertGreaterEqual(report['scratchJobFoldersRemoved'], 1)
        self.assertEqual((report['scratchJobFoldersNotRemoved'], self.job_folder_names('actors', SOUND_CONVERTER_RELATIVE_FOLDER)), (0, []))
        self.assertEqual((snapshot_of_every_entry(content_folder), snapshot_of_every_entry(content_folder.parent / 'index')),
                         (content_snapshot, index_snapshot))
        with patch('native_assets.tempfile.mkdtemp', side_effect=AssertionError('a cache hit made a job folder')):
            second_result = converter.convert(request)
        self.assertEqual((first_result['cacheHit'], second_result['cacheHit'], second_result['sha256']), (False, True, first_result['sha256']))
        self.assertEqual(self.job_folder_names('actors', SOUND_CONVERTER_RELATIVE_FOLDER), [])


if __name__ == '__main__':
    unittest.main()
