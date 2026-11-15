import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store import catalog_writer
from native_store.catalog_writer import CatalogWriteError, immutable_write, replace_file

PAYLOAD = b'the whole payload of one immutable store file'
OTHER_WRITER_PAYLOAD = b'bytes of another writer'
FILE_NAME = 'asset.l2asset'
IMMUTABLE_REFUSAL_PREFIX = 'Existing immutable runtime asset is corrupt; preserved: '


class ImmutableWritePublishTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.folder = Path(temporary_directory.name).resolve() / 'store' / ('a' * 64)
        self.destination = self.folder / FILE_NAME
        self.addCleanup(self.require_no_temporary_file)

    def require_no_temporary_file(self):
        self.assertEqual([path.name for path in self.folder.iterdir() if path.name != FILE_NAME], [])

    def link_after_another_process_published(self, other_process_payload):
        link = os.link

        def publish_first_then_link(source, destination):
            Path(destination).write_bytes(other_process_payload)
            link(source, destination)

        return mock.patch.object(catalog_writer.os, 'link', publish_first_then_link)

    def test_a_new_file_is_published_complete_and_leaves_no_temporary_file(self):
        immutable_write(self.destination, PAYLOAD)
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)
        self.assertEqual(self.destination.stat().st_nlink, 1)

    def test_the_same_bytes_already_present_are_accepted_and_nothing_is_written(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(PAYLOAD)
        modified_before = self.destination.stat().st_mtime_ns
        with mock.patch.object(catalog_writer.tempfile, 'NamedTemporaryFile', side_effect=AssertionError('a temporary file was written')), \
                mock.patch.object(catalog_writer.os, 'link', side_effect=AssertionError('a link was made')):
            immutable_write(self.destination, PAYLOAD)
        self.assertEqual((self.destination.read_bytes(), self.destination.stat().st_mtime_ns), (PAYLOAD, modified_before))

    def test_different_bytes_present_are_refused_with_the_present_message_and_the_file_is_kept(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(OTHER_WRITER_PAYLOAD)
        with self.assertRaises(CatalogWriteError) as refusal:
            immutable_write(self.destination, PAYLOAD)
        self.assertEqual(str(refusal.exception), IMMUTABLE_REFUSAL_PREFIX + str(self.destination))
        self.assertEqual(self.destination.read_bytes(), OTHER_WRITER_PAYLOAD)

    def test_a_file_published_by_another_process_between_the_check_and_the_link_is_verified_and_never_replaced(self):
        with self.link_after_another_process_published(PAYLOAD):
            immutable_write(self.destination, PAYLOAD)
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)
        self.require_no_temporary_file()
        self.destination.unlink()
        with self.link_after_another_process_published(OTHER_WRITER_PAYLOAD):
            with self.assertRaises(CatalogWriteError) as refusal:
                immutable_write(self.destination, PAYLOAD)
        self.assertEqual(str(refusal.exception), IMMUTABLE_REFUSAL_PREFIX + str(self.destination))
        self.assertEqual(self.destination.read_bytes(), OTHER_WRITER_PAYLOAD)

    def test_the_final_name_never_exists_half_written(self):
        link = os.link
        seen_at_the_link = []

        def record_then_link(source, destination):
            seen_at_the_link.append((Path(destination).exists(), Path(source).read_bytes(), Path(source).parent, Path(source).suffix))
            link(source, destination)

        with mock.patch.object(catalog_writer.os, 'link', record_then_link):
            immutable_write(self.destination, PAYLOAD)
        self.assertEqual(seen_at_the_link, [(False, PAYLOAD, self.folder, '.tmp')])
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)
        self.destination.unlink()
        link_refusal = OSError('the link was refused')
        with mock.patch.object(catalog_writer.os, 'link', side_effect=link_refusal):
            with self.assertRaises(OSError) as caught:
                immutable_write(self.destination, PAYLOAD)
        self.assertIs(caught.exception, link_refusal)
        self.assertFalse(self.destination.exists())

    def test_a_published_file_whose_read_back_differs_is_refused_as_a_runtime_copy(self):
        with mock.patch.object(catalog_writer, 'sha256_of_file', return_value='0' * 64):
            with self.assertRaises(CatalogWriteError) as refusal:
                immutable_write(self.destination, PAYLOAD)
        self.assertEqual(str(refusal.exception), 'Runtime copy hash differs: ' + str(self.destination))

    def test_replace_file_still_replaces_an_existing_file(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(OTHER_WRITER_PAYLOAD)
        replace_file(self.destination, PAYLOAD)
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)


if __name__ == '__main__':
    unittest.main()
