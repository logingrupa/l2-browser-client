import contextlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import identical_file_sharing, share_identical_lane_files as sharing_command
from native_store.examined_file_record import ExaminedFileRecordError, examined_file_record_path, read_examined_file_record
from native_store.file_identity import file_identity
from native_store.identical_file_sharing import MAXIMUM_NAMES_PER_SHARED_FILE, IdenticalFileSharingError, PlannedLink, planned_links
from native_store.lane_sharing_candidates import SharingCandidate
from native_store.share_identical_lane_files import share_identical_lane_files, temporary_links_folder
from native_store.store_paths import StorePathError
from support.shared_lane_fixture import (SHARED_FILE_BYTES, SharedLaneFixture, SharedLaneTestCase, file_bytes_outside_the_sharing_folders,
                                         file_number, hold_file_open_without_sharing, link_count, payload_of, replace_by_a_new_file,
                                         snapshot_of_every_entry, write_file)

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
except (ImportError, AttributeError):
    JUNCTION_FACTORY = None

TWIN = payload_of('twin')
OTHER = payload_of('other')
NEVER_SHARED_RELATIVE_PATHS = (
    'l2/catalog.json', 'l2/models/.work/twin.bin', 'l2/models/index/twin.bin', 'l2/models/interprocess-locks/twin.bin',
    'l2/models/class-defaults/twin.bin', 'l2/skills/bundle/twin.bin', 'l2/classes/0123abcd/decoded/twin.bin', 'l2/models/owner.json',
    'l2/models/.running.json', 'l2/models/receipt.json', 'l2/models/complete.json', 'l2/models/twin.bin.tmp',
    'work/static-mesh-converter/.work/job/twin.png', 'work/static-mesh-converter/index/twin.json', 'gap-rows/twin.json')
REPORT_KEYS_A_PLAN_SHARES_WITH_A_RUN = ('lanes', 'filesExamined', 'filesSkippedByRule', 'filesHashed', 'sharedNames', 'sharedBytes',
                                        'sharedBytesByPlace', 'sharedBytesByFileType', 'leftoverLinksRemoved', 'leftoverLinksKept')


class IdenticalFileSharingTests(SharedLaneTestCase):
    def write_twins(self, count, lane_name='actors'):
        return [self.lanes.write_store_file(lane_name, f'models/twin-{index:04d}.bin', TWIN) for index in range(count)]

    def actors_record(self):
        return read_examined_file_record(self.lanes.lane_folder('actors'))

    def test_two_and_three_identical_files_become_names_of_one_file_with_every_path_and_byte_unchanged(self):
        for count in (2, 3):
            with self.subTest(count=count):
                self.lanes = SharedLaneFixture(self)
                paths = self.write_twins(count)
                kept_file_number, bytes_before = file_number(paths[0]), file_bytes_outside_the_sharing_folders(self.lanes.project)
                report = self.share()
                self.assertEqual([(file_number(path), link_count(path)) for path in paths], [(kept_file_number, count)] * count)
                self.assertEqual(file_bytes_outside_the_sharing_folders(self.lanes.project), bytes_before)
                self.assertEqual((report['filesHashed'], report['sharedNames'], report['sharedBytes']),
                                 (count, count - 1, (count - 1) * SHARED_FILE_BYTES))

    def test_1001_identical_files_become_two_kept_files(self):
        paths = self.write_twins(MAXIMUM_NAMES_PER_SHARED_FILE + 1)
        report = self.share()
        self.assertEqual(MAXIMUM_NAMES_PER_SHARED_FILE, 1000)
        self.assertEqual((link_count(paths[0]), link_count(paths[-1])), (1000, 1))
        self.assertEqual(len({file_number(path) for path in paths}), 2)
        self.assertEqual({path.read_bytes() for path in paths}, {TWIN})
        self.assertEqual(report['sharedNames'], 999)

    def test_files_of_equal_size_and_other_bytes_and_files_below_the_floor_stay_apart(self):
        paths = [self.lanes.write_store_file('actors', f'models/{name}.bin', payload) for name, payload in (
            ('twin', TWIN), ('other', OTHER), ('short-first', TWIN[:-1]), ('short-second', TWIN[:-1]), ('only-file-of-its-size', TWIN + b'x'))]
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual([link_count(path) for path in paths], [1, 1, 1, 1, 1])
        self.assertEqual((hashed_file_count, report['filesHashed'], report['sharedNames'], report['filesSkippedByRule']),
                         (2, 2, 0, {'below-4096-bytes': 2}))

    def test_identical_files_in_every_never_shared_place_stay_apart(self):
        self.lanes.converter_folder('actors')
        shared_paths = [self.lanes.write_store_file('actors', f'models/twin-{name}.bin', TWIN) for name in ('first', 'second')]
        paths = [self.lanes.write_lane_file('actors', relative, TWIN) for relative in NEVER_SHARED_RELATIVE_PATHS]
        running_step_directory = self.lanes.begin_unit('actors', 'mesh:running', {'asset.l2asset': TWIN})[3]
        self.lanes.seal_unit('world', 'class:Engine.Mover', {'products': TWIN}, step='class-defaults')
        self.share(lanes_free_of_conversions=['actors', 'world'])
        self.assertEqual([link_count(path) for path in shared_paths], [2, 2])
        for path in [*paths, running_step_directory / 'asset.l2asset',
                     self.lanes.lane_folder('world') / 'work' / 'class__Engine.Mover' / 'class-defaults' / 'products']:
            with self.subTest(path=path):
                self.assertEqual(link_count(path), 1)

    def test_the_kept_file_is_the_store_name_and_then_the_first_path(self):
        converter_path = self.lanes.write_converter_file('actors', 'asset.l2asset', TWIN)
        store_path = self.lanes.write_store_file('world', 'models/twin.bin', TWIN)
        first_path = self.lanes.write_converter_file('actors', 'first.bin', OTHER)
        second_path = self.lanes.write_converter_file('actors', 'second.bin', OTHER)
        kept_file_numbers = [file_number(store_path), file_number(first_path)]
        self.share()
        self.assertEqual([file_number(converter_path), file_number(store_path)], [kept_file_numbers[0]] * 2)
        self.assertEqual([file_number(first_path), file_number(second_path)], [kept_file_numbers[1]] * 2)

    def test_files_on_two_devices_are_never_planned_as_one_file(self):
        on_the_first_device = SharingCandidate(Path('a'), 'actors/l2/models/a.bin', (1, 10, SHARED_FILE_BYTES, 5), 1)
        on_the_second_device = SharingCandidate(Path('b'), 'actors/l2/models/b.bin', (2, 10, SHARED_FILE_BYTES, 5), 1)
        twin_on_the_second_device = SharingCandidate(Path('c'), 'actors/l2/models/c.bin', (2, 11, SHARED_FILE_BYTES, 5), 1)
        candidates = [on_the_first_device, on_the_second_device, twin_on_the_second_device]
        self.assertEqual(planned_links(candidates, {candidate.identity: 'f' * 64 for candidate in candidates}),
                         [PlannedLink(twin_on_the_second_device, on_the_second_device)])

    def test_a_second_run_hashes_nothing_and_changes_no_file_and_no_record(self):
        self.write_twins(3)
        self.lanes.write_store_file('actors', 'models/other.bin', OTHER)
        _, first_hashed_file_count = self.share_counting_hashed_files()
        snapshot = snapshot_of_every_entry(self.lanes.project)
        report, second_hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((first_hashed_file_count, second_hashed_file_count), (4, 0))
        self.assertEqual((report['filesHashed'], report['sharedNames'], report['sharedBytes']), (0, 0, 0))
        self.assertEqual(snapshot_of_every_entry(self.lanes.project), snapshot)

    def test_a_file_replaced_by_other_bytes_of_equal_size_is_hashed_again_and_kept_apart_or_shared(self):
        first_path, second_path = self.write_twins(2)
        self.share()
        replace_by_a_new_file(second_path, OTHER)
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((hashed_file_count, report['sharedNames'], link_count(first_path), second_path.read_bytes()), (1, 0, 1, OTHER))
        replace_by_a_new_file(second_path, TWIN)
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((hashed_file_count, report['sharedNames'], file_number(second_path)), (1, 1, file_number(first_path)))

    def test_a_record_entry_of_a_file_that_no_longer_exists_is_ignored_and_dropped(self):
        removed_paths = self.write_twins(2)
        self.share()
        record_of_the_removed_file = self.actors_record()
        for path in removed_paths:
            path.unlink()
        new_paths = [self.lanes.write_store_file('actors', f'textures/{name}.bin', OTHER) for name in ('first', 'second')]
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((hashed_file_count, report['sharedNames']), (2, 1))
        self.assertEqual(list(self.actors_record()), [file_identity(new_paths[0])])
        self.assertEqual(len(record_of_the_removed_file), 1)
        self.assertTrue(record_of_the_removed_file.keys().isdisjoint(self.actors_record()))

    def test_the_record_drops_an_identity_whose_last_name_was_replaced(self):
        later_paths = [self.lanes.write_store_file('actors', f'models/twin-{index}.bin', TWIN) for index in (1, 2)]
        self.share()
        dropped_identity = file_identity(later_paths[0])
        self.assertEqual(list(self.actors_record()), [dropped_identity])
        earlier_path = self.lanes.write_store_file('actors', 'models/twin-0.bin', TWIN)
        self.share()
        self.assertEqual(list(self.actors_record()), [file_identity(earlier_path)])
        self.assertEqual([file_number(path) for path in later_paths], [file_number(earlier_path)] * 2)

    def test_plan_mode_writes_nothing_and_states_what_a_run_would_do(self):
        self.write_twins(3)
        self.lanes.write_converter_file('world', 'evidence/export/twin.png', OTHER)
        self.lanes.write_store_file('world', 'textures/twin.png', OTHER)
        snapshot = snapshot_of_every_entry(self.lanes.project)
        plan = self.share(plan_only=True)
        self.assertEqual(snapshot_of_every_entry(self.lanes.project), snapshot)
        report = self.share()
        self.assertEqual((plan['planOnly'], report['planOnly']), (True, False))
        self.assertEqual({key: plan[key] for key in REPORT_KEYS_A_PLAN_SHARES_WITH_A_RUN},
                         {key: report[key] for key in REPORT_KEYS_A_PLAN_SHARES_WITH_A_RUN})
        self.assertEqual(sorted(report), sorted(['planOnly', *REPORT_KEYS_A_PLAN_SHARES_WITH_A_RUN]))
        self.assertEqual((report['lanes'], report['filesExamined'], report['filesHashed'], report['sharedNames'], report['sharedBytes']),
                         (['actors', 'world'], 5, 5, 3, 3 * SHARED_FILE_BYTES))
        self.assertEqual(report['sharedBytesByPlace'], {'actors/l2': 2 * SHARED_FILE_BYTES, 'world/work': SHARED_FILE_BYTES})
        self.assertEqual(report['sharedBytesByFileType'], {'.bin': 2 * SHARED_FILE_BYTES, '.png': SHARED_FILE_BYTES})

    def test_a_raise_in_the_third_read_keeps_the_hashes_taken_and_the_next_run_hashes_the_rest(self):
        paths = self.write_twins(4)
        read_file = identical_file_sharing.sha256_of_file_with_identity
        read_outcomes = iter([read_file, read_file, OSError('the third read failed')])

        def read_or_raise(path, surveyed_identity):
            outcome = next(read_outcomes)
            if isinstance(outcome, OSError):
                raise outcome
            return outcome(path, surveyed_identity)

        with patch.object(identical_file_sharing, 'sha256_of_file_with_identity', read_or_raise):
            with self.assertRaisesRegex(OSError, 'the third read failed'):
                self.share()
        self.assertEqual(sorted(self.actors_record()), sorted(file_identity(path) for path in paths[:2]))
        self.assertEqual([link_count(path) for path in paths], [1, 1, 1, 1])
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((hashed_file_count, report['sharedNames']), (2, 3))

    def test_a_raise_while_replacing_keeps_the_hashes_taken(self):
        paths = self.write_twins(3)
        with patch.object(sharing_command, 'replace_name_by_hard_link', side_effect=OSError('the replace failed')):
            with self.assertRaisesRegex(OSError, 'the replace failed'):
                self.share()
        self.assertEqual(sorted(self.actors_record()), sorted(file_identity(path) for path in paths))
        report, hashed_file_count = self.share_counting_hashed_files()
        self.assertEqual((hashed_file_count, report['sharedNames']), (0, 2))

    def test_a_file_named_in_two_lanes_is_recorded_in_the_lane_of_its_kept_file_only(self):
        actors_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        integration_path = self.lanes.write_store_file('integration', 'models/twin.bin', TWIN)
        self.share()
        self.assertEqual(file_number(integration_path), file_number(actors_path))
        self.assertEqual(list(self.actors_record()), [file_identity(actors_path)])
        self.assertFalse(examined_file_record_path(self.lanes.lane_folder('integration')).exists())

    def test_a_one_lane_run_between_two_all_lane_runs_hashes_nothing_again_and_changes_no_record(self):
        self.write_twins(2, 'actors')
        self.write_twins(2, 'integration')
        for name in ('first', 'second'):
            self.lanes.write_store_file('integration', f'textures/{name}.bin', OTHER)
        self.share()
        snapshot = snapshot_of_every_entry(self.lanes.project)
        skipped_files_by_lane_names = {}
        for lane_names in (['integration'], ['actors'], None):
            report, hashed_file_count = self.share_counting_hashed_files(lane_names=lane_names)
            self.assertEqual((hashed_file_count, report['sharedNames']), (0, 0))
            self.assertEqual(snapshot_of_every_entry(self.lanes.project), snapshot)
            skipped_files_by_lane_names[' '.join(report['lanes'])] = report['filesSkippedByRule']
        self.assertEqual(skipped_files_by_lane_names, {
            'integration': {'has-a-name-outside-this-run': 2, 'outside-the-shared-places': 1},
            'actors': {'outside-the-shared-places': 1}, 'actors integration': {'outside-the-shared-places': 2}})

    def test_a_leftover_temporary_link_is_counted_by_a_plan_removed_by_a_run_and_kept_when_it_is_the_only_name(self):
        store_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        links_folder = temporary_links_folder(self.lanes.lane_folder('actors'))
        links_folder.mkdir(parents=True)
        os.link(store_path, links_folder / 'leftover-of-a-stopped-run')
        only_name_path = write_file(links_folder / 'only-name-of-its-file', OTHER)
        expected = (1, ['actors/work/identical-file-sharing/temporary-links/only-name-of-its-file'])
        plan = self.share(plan_only=True)
        self.assertEqual((plan['leftoverLinksRemoved'], plan['leftoverLinksKept']), expected)
        self.assertEqual(link_count(store_path), 2)
        report = self.share()
        self.assertEqual((report['leftoverLinksRemoved'], report['leftoverLinksKept']), expected)
        self.assertEqual((link_count(store_path), sorted(links_folder.iterdir()), only_name_path.read_bytes()), (1, [only_name_path], OTHER))

    def test_a_file_another_process_holds_is_skipped_and_counted_while_the_others_are_shared(self):
        paths = self.write_twins(3)
        hold_file_open_without_sharing(self, paths[1])
        report = self.share()
        self.assertEqual((report['filesSkippedByRule'], report['sharedNames']), ({'in-use-by-another-process': 1}, 1))
        self.assertEqual([link_count(path) for path in paths], [2, 1, 2])

    def test_a_name_that_cannot_be_replaced_is_skipped_and_counted_and_leaves_no_temporary_link(self):
        paths = self.write_twins(3)
        with open(paths[2], 'rb'):
            report = self.share()
        self.assertEqual((report['filesSkippedByRule'], report['sharedNames']), ({'in-use-by-another-process': 1}, 1))
        self.assertEqual([link_count(path) for path in paths], [2, 2, 1])
        self.assertEqual(list(temporary_links_folder(self.lanes.lane_folder('actors')).iterdir()), [])

    def test_a_name_that_does_not_name_the_kept_file_after_its_replacement_stops_the_run_and_keeps_the_hashes(self):
        paths = self.write_twins(2)
        replace_name = os.replace

        def replace_every_name_but_a_store_name(source, destination):
            if Path(destination).parent != paths[0].parent:
                replace_name(source, destination)

        with patch.object(identical_file_sharing.os, 'replace', replace_every_name_but_a_store_name):
            with self.assertRaisesRegex(IdenticalFileSharingError, 'does not name the file of .* after its replacement by a hard link$'):
                self.share()
        self.assertEqual([link_count(path) for path in paths], [1, 1])
        self.assertEqual(sorted(self.actors_record()), sorted(file_identity(path) for path in paths))
        self.assertEqual(list(temporary_links_folder(self.lanes.lane_folder('actors')).iterdir()), [])

    def test_the_cap_counts_the_names_on_disk_also_those_outside_the_surveyed_lane(self):
        with patch.object(identical_file_sharing, 'MAXIMUM_NAMES_PER_SHARED_FILE', 6):
            actors_paths = self.write_twins(3, 'actors')
            self.write_twins(2, 'integration')
            self.share()
            self.assertEqual(link_count(actors_paths[0]), 5)
            new_paths = [self.lanes.write_store_file('actors', f'models/twin-new-{index}.bin', TWIN) for index in range(3)]
            report = self.share(lane_names=['actors'])
        self.assertEqual((report['sharedNames'], link_count(actors_paths[0]), link_count(new_paths[1])), (2, 6, 2))
        self.assertEqual([file_number(path) for path in new_paths],
                         [file_number(actors_paths[0]), file_number(new_paths[1]), file_number(new_paths[1])])

    def test_a_root_that_is_not_the_lane_store_folder_of_artifacts_is_refused(self):
        self.write_twins(2)
        other_root = self.lanes.project / 'other' / 'lane-store'
        other_root.mkdir(parents=True)
        for root in (self.lanes.project, self.lanes.project / 'artifacts', self.lanes.lane_folder('actors'), other_root):
            with self.subTest(root=root), self.assertRaisesRegex(IdenticalFileSharingError, 'artifacts/lane-store'):
                share_identical_lane_files(root, [], False, ())

    @unittest.skipIf(JUNCTION_FACTORY is None, 'NTFS junctions unavailable')
    def test_a_lane_folder_that_is_a_junction_is_refused_and_its_target_stays_untouched(self):
        target_paths = [write_file(self.lanes.project / 'outside' / 'l2' / 'models' / f'{name}.bin', TWIN) for name in ('first', 'second')]
        junction = self.lanes.lane_folder('world')
        JUNCTION_FACTORY(str(self.lanes.project / 'outside'), str(junction))
        self.addCleanup(os.rmdir, junction)
        with self.assertRaises(StorePathError):
            self.share()
        self.assertEqual([link_count(path) for path in target_paths], [1, 1])

    def test_a_record_of_another_shape_is_refused_with_the_way_out(self):
        paths = self.write_twins(2)
        record_path = examined_file_record_path(self.lanes.lane_folder('actors'))
        for payload in (b'[]', b'not json', json.dumps({'1:2:3': 'a' * 64}).encode(), json.dumps({'1:2:3:4': 'short'}).encode()):
            with self.subTest(payload=payload):
                write_file(record_path, payload)
                with self.assertRaises(ExaminedFileRecordError) as refusal:
                    self.share()
                self.assertIn(str(record_path), str(refusal.exception))
                self.assertIn('delete it and the next run hashes every file again', str(refusal.exception))
                self.assertEqual(record_path.read_bytes(), payload)
        self.assertEqual([link_count(path) for path in paths], [1, 1])

    def run_main(self, *arguments):
        standard_output, standard_error = io.StringIO(), io.StringIO()
        with (patch.object(sharing_command, 'run_at_below_normal_priority') as below_normal_priority,
              contextlib.redirect_stdout(standard_output), contextlib.redirect_stderr(standard_error)):
            exit_code = sharing_command.main([str(argument) for argument in arguments])
        return exit_code, standard_output.getvalue(), standard_error.getvalue(), below_normal_priority.call_count

    def test_main_plans_and_shares_every_lane_of_the_root_at_below_normal_priority_and_names_no_lane_free(self):
        actors_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        integration_path = self.lanes.write_store_file('integration', 'models/twin.bin', TWIN)
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        exit_code, output, error, priority_call_count = self.run_main(self.lanes.lane_stores_root, '--plan')
        self.assertEqual((exit_code, error, priority_call_count, json.loads(output)['planOnly'], json.loads(output)['sharedNames']),
                         (0, '', 1, True, 1))
        self.assertEqual(link_count(actors_path), 1)
        exit_code, output, error, priority_call_count = self.run_main(self.lanes.lane_stores_root)
        report = json.loads(output)
        self.assertEqual((exit_code, error, priority_call_count, report['planOnly'], report['sharedNames'], report['lanes']),
                         (0, '', 1, False, 1, ['actors', 'integration']))
        self.assertEqual(report['filesSkippedByRule'], {'ledger-record': 3, 'unit-step-of-a-lane-in-use': 1})
        self.assertEqual((file_number(integration_path), link_count(step_directory / 'asset.l2asset')), (file_number(actors_path), 1))

    def test_main_prints_a_refusal_on_standard_error_and_exits_with_1(self):
        exit_code, output, error, _ = self.run_main(self.lanes.project)
        self.assertEqual((exit_code, output), (1, ''))
        self.assertIn('artifacts/lane-store', error)


if __name__ == '__main__':
    unittest.main()
