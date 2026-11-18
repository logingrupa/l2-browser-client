import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store import verified_file_writes
from native_store.verified_file_writes import (CatalogWriteError, StorePayloadIntegrityError, immutable_write, immutable_write_expecting_sha256,
                                               replace_file, sha256_hex)

PAYLOAD = b'the whole payload of one immutable store file'
PAYLOAD_WITH_ONE_FLIPPED_BYTE = bytes([PAYLOAD[0] ^ 0x01]) + PAYLOAD[1:]
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

        return mock.patch.object(verified_file_writes.os, 'link', publish_first_then_link)

    def test_a_new_file_is_published_complete_and_leaves_no_temporary_file(self):
        immutable_write(self.destination, PAYLOAD)
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)
        self.assertEqual(self.destination.stat().st_nlink, 1)

    def test_the_same_bytes_already_present_are_accepted_and_nothing_is_written(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(PAYLOAD)
        modified_before = self.destination.stat().st_mtime_ns
        with mock.patch.object(verified_file_writes.tempfile, 'NamedTemporaryFile', side_effect=AssertionError('a temporary file was written')), \
                mock.patch.object(verified_file_writes.os, 'link', side_effect=AssertionError('a link was made')):
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

        with mock.patch.object(verified_file_writes.os, 'link', record_then_link):
            immutable_write(self.destination, PAYLOAD)
        self.assertEqual(seen_at_the_link, [(False, PAYLOAD, self.folder, '.tmp')])
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)
        self.destination.unlink()
        link_refusal = OSError('the link was refused')
        with mock.patch.object(verified_file_writes.os, 'link', side_effect=link_refusal):
            with self.assertRaises(OSError) as caught:
                immutable_write(self.destination, PAYLOAD)
        self.assertIs(caught.exception, link_refusal)
        self.assertFalse(self.destination.exists())

    def test_a_written_file_whose_read_back_differs_is_refused_as_an_integrity_fault_before_it_gets_its_name(self):
        with mock.patch.object(verified_file_writes, 'sha256_of_file', return_value='0' * 64):
            with self.assertRaises(StorePayloadIntegrityError) as refusal:
                immutable_write(self.destination, PAYLOAD)
        self.assertEqual(str(refusal.exception), f'Written store file hashes to {"0" * 64} where {sha256_hex(PAYLOAD)} was verified; '
                                                 f'not published: {self.destination}')
        self.assertFalse(self.destination.exists())

    def test_a_payload_with_one_flipped_byte_against_its_verified_sha256_is_refused_and_no_file_gets_its_name(self):
        with self.assertRaises(StorePayloadIntegrityError) as refusal:
            immutable_write_expecting_sha256(self.destination, PAYLOAD_WITH_ONE_FLIPPED_BYTE, sha256_hex(PAYLOAD))
        self.assertNotIsInstance(refusal.exception, ValueError)
        self.assertEqual(str(refusal.exception), f'Written store file hashes to {sha256_hex(PAYLOAD_WITH_ONE_FLIPPED_BYTE)} where '
                                                 f'{sha256_hex(PAYLOAD)} was verified; not published: {self.destination}')
        self.assertFalse(self.destination.exists())

    def test_an_existing_file_is_compared_with_the_verified_sha256_and_not_with_a_flipped_payload(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(PAYLOAD)
        immutable_write_expecting_sha256(self.destination, PAYLOAD_WITH_ONE_FLIPPED_BYTE, sha256_hex(PAYLOAD))
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)

    def test_replace_file_still_replaces_an_existing_file(self):
        self.folder.mkdir(parents=True)
        self.destination.write_bytes(OTHER_WRITER_PAYLOAD)
        replace_file(self.destination, PAYLOAD)
        self.assertEqual(self.destination.read_bytes(), PAYLOAD)


if __name__ == '__main__':
    unittest.main()
