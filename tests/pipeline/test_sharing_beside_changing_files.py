import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import identical_file_sharing, share_identical_lane_files as sharing_command
from native_store.examined_file_record import read_examined_file_record
from native_store.file_identity import file_identity
from native_store.share_identical_lane_files import temporary_links_folder
from native_store.write_lane_catalog import union_lane_store_relative_paths
from support.shared_lane_fixture import (SharedLaneTestCase, file_bytes_outside_the_sharing_folders, file_number, link_count, payload_of,
                                         replace_by_a_new_file)

TWIN = payload_of('twin')
OTHER = payload_of('other')
STOPPED_RUN_EXIT_CODE = 3
STOPPED_RUN_TIMEOUT_SECONDS = 120
RUN_STOPPED_AT_ITS_SECOND_REPLACE_PROGRAM = '\n'.join([
    'import os, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from native_store.share_identical_lane_files import share_identical_lane_files',
    'replace_name, replaced_names = os.replace, []',
    'def replace_one_name_then_stop(source, destination):',
    '    if replaced_names:',
    f'        os._exit({STOPPED_RUN_EXIT_CODE})',
    '    replaced_names.append(destination)',
    '    replace_name(source, destination)',
    'os.replace = replace_one_name_then_stop',
    'share_identical_lane_files(sys.argv[2], sys.argv[3:], False, sys.argv[3:])',
])


class SharingBesideChangingFilesTests(SharedLaneTestCase):
    def write_store_twins(self, *names):
        return [self.lanes.write_store_file('actors', f'models/{name}', TWIN) for name in names]

    def test_a_two_name_file_whose_read_name_is_replaced_after_the_survey_gets_no_hash_link_or_record_entry(self):
        read_name_path, single_name_path = self.write_store_twins('twin-0.bin', 'twin-2.bin')
        second_name_path = read_name_path.with_name('twin-1.bin')
        os.link(read_name_path, second_name_path)
        survey_lane = sharing_command.survey_lane

        def survey_then_replace_the_read_name(lane_stores_root, lane_name, lane_is_free_of_conversions):
            survey = survey_lane(lane_stores_root, lane_name, lane_is_free_of_conversions)
            replace_by_a_new_file(read_name_path, OTHER)
            return survey

        with patch.object(sharing_command, 'survey_lane', survey_then_replace_the_read_name):
            report = self.share()
        self.assertEqual((report['filesHashed'], report['sharedNames'], report['filesSkippedByRule']),
                         (1, 0, {'changed-during-the-run': 2}))
        self.assertEqual([link_count(path) for path in (read_name_path, second_name_path, single_name_path)], [1, 1, 1])
        self.assertEqual(list(read_examined_file_record(self.lanes.lane_folder('actors'))), [file_identity(single_name_path)])

    def test_a_modification_time_changed_during_the_read_gives_no_hash(self):
        touched_path, untouched_path = self.write_store_twins('twin-0.bin', 'twin-1.bin')
        digest_of_file = hashlib.file_digest

        def digest_then_change_the_modification_time(stream, digest_name):
            digest = digest_of_file(stream, digest_name)
            os.utime(touched_path, ns=(1_000_000_000, 1_000_000_000))
            return digest

        with patch.object(identical_file_sharing.hashlib, 'file_digest', digest_then_change_the_modification_time):
            report = self.share()
        self.assertEqual((report['filesHashed'], report['sharedNames'], report['filesSkippedByRule']),
                         (1, 0, {'changed-during-the-run': 1}))
        self.assertEqual(list(read_examined_file_record(self.lanes.lane_folder('actors'))), [file_identity(untouched_path)])

    def test_a_folder_can_be_removed_elsewhere_while_its_file_is_hashed(self):
        removed_path, = [self.lanes.write_store_file('actors', 'models/removed/twin.bin', TWIN)]
        kept_path, = self.write_store_twins('twin.bin')
        digest_of_file = hashlib.file_digest

        def remove_the_folder_then_digest(stream, digest_name):
            if removed_path.parent.exists():
                shutil.rmtree(removed_path.parent)
            return digest_of_file(stream, digest_name)

        with patch.object(identical_file_sharing.hashlib, 'file_digest', remove_the_folder_then_digest):
            report = self.share()
        self.assertFalse(removed_path.parent.exists())
        self.assertEqual((report['sharedNames'], link_count(kept_path), kept_path.read_bytes()), (0, 1, TWIN))
        self.assertEqual(list(read_examined_file_record(self.lanes.lane_folder('actors'))), [file_identity(kept_path)])

    def test_a_run_stopped_between_link_and_replace_keeps_every_path_and_byte_and_the_next_run_removes_the_leftover(self):
        store_paths = self.write_store_twins('twin-0.bin', 'twin-1.bin', 'twin-2.bin')
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        actors_store, links_folder = self.lanes.lane_folder('actors') / 'l2', temporary_links_folder(self.lanes.lane_folder('actors'))
        bytes_before = file_bytes_outside_the_sharing_folders(self.lanes.project)
        store_listing = union_lane_store_relative_paths(actors_store)
        step_listing = sorted(path.name for path in step_directory.iterdir())
        stopped_run = subprocess.run([sys.executable, '-B', '-c', RUN_STOPPED_AT_ITS_SECOND_REPLACE_PROGRAM, str(ROOT / 'scripts'),
                                      str(self.lanes.lane_stores_root), 'actors'], capture_output=True, text=True, check=False,
                                     timeout=STOPPED_RUN_TIMEOUT_SECONDS)
        self.assertEqual(stopped_run.returncode, STOPPED_RUN_EXIT_CODE, stopped_run.stderr)
        self.assertEqual(file_bytes_outside_the_sharing_folders(self.lanes.project), bytes_before)
        self.assertEqual(union_lane_store_relative_paths(actors_store), store_listing)
        self.assertEqual(sorted(path.name for path in step_directory.iterdir()), step_listing)
        self.assertEqual(([link_count(path) for path in store_paths], len(list(links_folder.iterdir()))), ([3, 3, 1], 1))
        report = self.share(lanes_free_of_conversions=['actors'])
        self.assertEqual((report['leftoverLinksRemoved'], report['leftoverLinksKept'], list(links_folder.iterdir())), (1, [], []))
        self.assertEqual([file_number(path) for path in [*store_paths, step_directory / 'asset.l2asset']], [file_number(store_paths[0])] * 4)
        self.assertEqual(file_bytes_outside_the_sharing_folders(self.lanes.project), bytes_before)


if __name__ == '__main__':
    unittest.main()
