import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import linked_file_copy
from native_store.identical_file_sharing import MAXIMUM_NAMES_PER_SHARED_FILE
from native_store.linked_file_copy import link_or_copy_file, paths_are_on_one_volume, source_can_be_linked
from support.second_volume_simulation import simulate_a_second_volume
from support.shared_lane_fixture import SharedLaneTestCase, file_number, link_count, payload_of, write_file

ARCHIVE = payload_of('converted archive')
OTHER_ARCHIVE = payload_of('archive of a later conversion')


class LinkOrCopyFileTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.source = write_file(self.temporary_root / 'converter' / 'asset.l2asset', ARCHIVE)
        self.destination = self.temporary_root / 'unit' / 'step' / 'asset.l2asset'
        self.destination.parent.mkdir(parents=True)

    def test_on_one_volume_the_destination_is_a_second_name_of_the_source_file(self):
        link_or_copy_file(self.source, self.destination)
        self.assertEqual((file_number(self.destination), link_count(self.source), self.destination.read_bytes()),
                         (file_number(self.source), 2, ARCHIVE))

    def test_on_two_volumes_the_destination_is_a_copy_with_its_own_file(self):
        simulate_a_second_volume(self)
        link_or_copy_file(self.source, self.destination)
        self.assertNotEqual(file_number(self.destination), file_number(self.source))
        self.assertEqual((link_count(self.source), link_count(self.destination), self.destination.read_bytes()), (1, 1, ARCHIVE))

    def test_the_volume_of_a_destination_is_that_of_its_nearest_existing_folder_and_another_device_is_never_linked(self):
        real_stat = os.stat

        def stat_with_the_source_on_another_device(path, **options):
            status = real_stat(path, **options)
            if Path(path) == self.source:
                return SimpleNamespace(st_dev=status.st_dev + 1, st_nlink=status.st_nlink)
            return status

        absent_destination = self.temporary_root / 'absent' / 'folder' / 'asset.l2asset'
        self.assertEqual((paths_are_on_one_volume(self.source, absent_destination), source_can_be_linked(self.source, absent_destination)),
                         (True, True))
        with patch.object(linked_file_copy.os, 'stat', stat_with_the_source_on_another_device):
            self.assertEqual((paths_are_on_one_volume(self.source, absent_destination), source_can_be_linked(self.source, absent_destination)),
                             (False, False))

    def test_a_source_one_name_below_the_cap_is_linked_and_a_source_with_1000_names_is_copied(self):
        for name_number in range(MAXIMUM_NAMES_PER_SHARED_FILE - 2):
            os.link(self.source, self.source.with_name(f'name-{name_number}'))
        link_or_copy_file(self.source, self.destination)
        self.assertEqual((link_count(self.source), file_number(self.destination)), (MAXIMUM_NAMES_PER_SHARED_FILE, file_number(self.source)))
        copied_destination = self.destination.with_name('copied.l2asset')
        link_or_copy_file(self.source, copied_destination)
        self.assertEqual((link_count(self.source), link_count(copied_destination), copied_destination.read_bytes()),
                         (MAXIMUM_NAMES_PER_SHARED_FILE, 1, ARCHIVE))


class LinkedUnitArchiveTests(SharedLaneTestCase):
    def test_a_link_into_a_fresh_unit_folder_and_the_next_begin_leave_the_other_names_of_a_shared_archive_unchanged(self):
        store_path = self.lanes.write_store_file('actors', 'models/first/asset.l2asset', ARCHIVE)
        converter_path = self.lanes.write_converter_file('actors', 'asset.l2asset', ARCHIVE)
        self.share()
        self.assertEqual((file_number(converter_path), link_count(store_path)), (file_number(store_path), 2))
        modification_times = [path.stat().st_mtime_ns for path in (store_path, converter_path)]
        step_directory = self.lanes.begin_unit('actors', 'mesh:first', {})[3]
        link_or_copy_file(converter_path, step_directory / 'asset.l2asset')
        self.assertEqual((file_number(step_directory / 'asset.l2asset'), link_count(store_path)), (file_number(store_path), 3))
        step_directory = self.lanes.begin_unit('actors', 'mesh:first', {'asset.l2asset': OTHER_ARCHIVE}, config_version=2)[3]
        self.assertEqual(((step_directory / 'asset.l2asset').read_bytes(), store_path.read_bytes(), converter_path.read_bytes()),
                         (OTHER_ARCHIVE, ARCHIVE, ARCHIVE))
        self.assertEqual((link_count(store_path), file_number(converter_path)), (2, file_number(store_path)))
        self.assertEqual([path.stat().st_mtime_ns for path in (store_path, converter_path)], modification_times)


if __name__ == '__main__':
    unittest.main()
