from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.side_by_side_check_records import (AUDIO_ROLES, COMPUTED_UNVERIFIED_REASONS, STORED_UNVERIFIED_REASONS,
                                                     SideBySideCheckRecordError, current_reference_tree_lock_sha256, read_side_by_side_records,
                                                     side_by_side_checks_path, write_side_by_side_records)
from side_by_side_fixture import (CAPTURED_AT_RIGA, FRESH_REVIEWER, JUDGED_AT_RIGA, audio_record, judged_tile_record, unverified_record,
                                  unverified_tile_record, write_reference_client_lock)

WORLD_PART = 'world'
AUDIO_PART = 'audio'


class SideBySideRecordsTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()

    def write_document(self, part, document):
        path = side_by_side_checks_path(self.project_root, part)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document), encoding='utf-8')
        return path

    def stored_document_bytes(self, part):
        path = side_by_side_checks_path(self.project_root, part)
        return path.read_bytes() if path.exists() else None

    def assert_write_refused(self, part, records, message_fragment):
        document_bytes_before = self.stored_document_bytes(part)
        with self.assertRaisesRegex(SideBySideCheckRecordError, message_fragment):
            write_side_by_side_records(self.project_root, part, records)
        self.assertEqual(self.stored_document_bytes(part), document_bytes_before)


class SideBySideRecordDocumentTest(SideBySideRecordsTestCase):
    def test_reasons_split_into_seven_stored_and_six_computed(self):
        self.assertEqual(len(STORED_UNVERIFIED_REASONS), 7)
        self.assertEqual(len(COMPUTED_UNVERIFIED_REASONS), 6)
        self.assertFalse(set(STORED_UNVERIFIED_REASONS) & set(COMPUTED_UNVERIFIED_REASONS))

    def test_absent_document_reads_as_no_records(self):
        self.assertEqual(read_side_by_side_records(self.project_root, WORLD_PART), [])

    def test_path_accepts_only_coverage_parts(self):
        self.assertEqual(side_by_side_checks_path(self.project_root, WORLD_PART),
                         self.project_root / 'docs' / 'parts' / 'world' / 'side-by-side-checks.json')
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'part must be one of'):
            side_by_side_checks_path(self.project_root, '../world')

    def test_written_records_read_back_sorted_and_rewrite_byte_identical(self):
        records = [unverified_tile_record('tile:21_20'), unverified_tile_record('tile:20_20')]
        document = write_side_by_side_records(self.project_root, WORLD_PART, records)
        path = side_by_side_checks_path(self.project_root, WORLD_PART)
        first_bytes = path.read_bytes()
        self.assertEqual([record['key'] for record in document['records']], ['tile:20_20', 'tile:21_20'])
        self.assertEqual(read_side_by_side_records(self.project_root, WORLD_PART), document['records'])
        write_side_by_side_records(self.project_root, WORLD_PART, read_side_by_side_records(self.project_root, WORLD_PART))
        self.assertEqual(path.read_bytes(), first_bytes)
        self.assertTrue(first_bytes.endswith(b'\n'))

    def test_unknown_record_field_is_refused(self):
        record = {**unverified_tile_record(), 'note': 'looks right'}
        self.assert_write_refused(WORLD_PART, [record], r"record 'tile:20_20' of part world record must hold exactly")

    def test_unsorted_records_in_a_document_are_refused(self):
        self.write_document(WORLD_PART, {'schemaVersion': 1, 'part': WORLD_PART,
                                         'records': [unverified_tile_record('tile:21_20'), unverified_tile_record('tile:20_20')]})
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'must be sorted by identity'):
            read_side_by_side_records(self.project_root, WORLD_PART)

    def test_repeated_record_in_a_document_is_refused(self):
        self.write_document(WORLD_PART, {'schemaVersion': 1, 'part': WORLD_PART,
                                         'records': [unverified_tile_record(), unverified_tile_record()]})
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'repeats a record identity'):
            read_side_by_side_records(self.project_root, WORLD_PART)

    def test_duplicate_json_key_and_non_finite_number_are_refused(self):
        path = side_by_side_checks_path(self.project_root, WORLD_PART)
        path.parent.mkdir(parents=True, exist_ok=True)
        for payload in ('{"schemaVersion": 1, "schemaVersion": 1, "part": "world", "records": []}',
                        '{"schemaVersion": NaN, "part": "world", "records": []}'):
            path.write_text(payload, encoding='utf-8')
            with self.assertRaisesRegex(SideBySideCheckRecordError, 'not strict JSON'):
                read_side_by_side_records(self.project_root, WORLD_PART)

    def test_reason_outside_the_stored_list_is_refused(self):
        self.assert_write_refused(WORLD_PART, [unverified_tile_record() | {'reason': 'looks-fine'}], 'unverified reason must be one of')

    def test_computed_reason_is_never_stored(self):
        for reason in COMPUTED_UNVERIFIED_REASONS:
            with self.subTest(reason=reason):
                self.assert_write_refused(WORLD_PART, [unverified_tile_record() | {'reason': reason}], 'computed by the report')

    def test_sandbox_half_capture_identity_and_hashes_are_checked(self):
        cases = (({'capturedBy': 'executor:02-01'}, 'capturedBy must match'),
                 ({'capturedAtRiga': '2026-11-11 09:00'}, 'capturedAtRiga must be ISO 8601'),
                 ({'pngSha256': 'D' * 64}, 'pngSha256 must be 64 lowercase hex'),
                 ({'viewport': {'width': 0, 'height': 900}}, 'viewport width and height must be positive integers'))
        for changes, message_fragment in cases:
            with self.subTest(changes=changes):
                record = unverified_tile_record()
                record['sandboxHalf'].update(changes)
                self.assert_write_refused(WORLD_PART, [record], message_fragment)


class JudgedRecordTest(SideBySideRecordsTestCase):
    def setUp(self):
        super().setUp()
        write_reference_client_lock(self.project_root)
        self.lock_sha256 = current_reference_tree_lock_sha256(self.project_root)

    def test_pass_and_mismatch_with_both_halves_and_an_independent_reviewer_are_written(self):
        records = [judged_tile_record('pass', self.lock_sha256), judged_tile_record('mismatch', self.lock_sha256, key='tile:21_20')]
        document = write_side_by_side_records(self.project_root, WORLD_PART, records)
        self.assertEqual([record['verdict'] for record in document['records']], ['pass', 'mismatch'])

    def test_judged_record_without_a_native_half_reviewer_or_time_is_refused(self):
        for verdict in ('pass', 'mismatch'):
            for field, message_fragment in (('nativeHalf', 'needs a nativeHalf'), ('reviewer', 'needs a reviewer'),
                                            ('judgedAtRiga', 'judgedAtRiga must be ISO 8601')):
                with self.subTest(verdict=verdict, field=field):
                    self.assert_write_refused(WORLD_PART, [judged_tile_record(verdict, self.lock_sha256) | {field: None}], message_fragment)

    def test_judged_record_with_a_reason_is_refused(self):
        record = judged_tile_record('pass', self.lock_sha256) | {'reason': 'reviewer-uncertain'}
        self.assert_write_refused(WORLD_PART, [record], 'pass record must have reason null')

    def test_mismatch_without_difference_or_suspected_step_is_refused(self):
        for field in ('difference', 'suspectedStep'):
            with self.subTest(field=field):
                record = judged_tile_record('mismatch', self.lock_sha256) | {field: ' '}
                self.assert_write_refused(WORLD_PART, [record], f'mismatch needs a {field} text')

    def test_pass_with_a_difference_is_refused(self):
        record = judged_tile_record('pass', self.lock_sha256) | {'difference': 'none'}
        self.assert_write_refused(WORLD_PART, [record], 'difference must be null unless the verdict is mismatch')

    def test_reviewer_equal_to_either_capturer_is_refused(self):
        sandbox_capturer = judged_tile_record('pass', self.lock_sha256)['sandboxHalf']['capturedBy']
        native_capturer = judged_tile_record('pass', self.lock_sha256)['nativeHalf']['capturedBy']
        for reviewer in (sandbox_capturer, native_capturer, f'reviewer:{sandbox_capturer}', f'reviewer:{native_capturer}'):
            with self.subTest(reviewer=reviewer):
                self.assert_write_refused(WORLD_PART, [judged_tile_record('pass', self.lock_sha256, reviewer=reviewer)],
                                          'reviewer must differ from the capturer of either half')

    def test_reviewer_outside_owner_and_fresh_agent_ids_is_refused(self):
        self.assert_write_refused(WORLD_PART, [judged_tile_record('pass', self.lock_sha256, reviewer='someone')],
                                  'reviewer must be owner or reviewer:<agent id>')

    def test_native_half_on_another_lock_reference_or_the_raw_lock_file_hash_is_refused(self):
        raw_lock_file_sha256 = hashlib.sha256(
            (self.project_root / 'recipes' / 'reference-client-tree.lock.json').read_bytes()).hexdigest()
        for lock_sha256 in ('9' * 64, raw_lock_file_sha256):
            with self.subTest(lock_sha256=lock_sha256):
                self.assert_write_refused(WORLD_PART, [judged_tile_record('pass', lock_sha256)],
                                          'nativeHalf referenceTreeLockSha256 differs from reference_client_build')

    def test_review_pending_needs_both_halves_and_no_reviewer(self):
        record = judged_tile_record('pass', self.lock_sha256) | {'verdict': 'unverified', 'reason': 'review-pending', 'reviewer': None,
                                                                  'judgedAtRiga': None}
        write_side_by_side_records(self.project_root, WORLD_PART, [record])
        self.assert_write_refused(WORLD_PART, [record | {'nativeHalf': None}], 'review-pending needs a nativeHalf')

    def test_reviewer_uncertain_needs_an_independent_reviewer(self):
        record = judged_tile_record('pass', self.lock_sha256) | {'verdict': 'unverified', 'reason': 'reviewer-uncertain'}
        write_side_by_side_records(self.project_root, WORLD_PART, [record])
        self.assert_write_refused(WORLD_PART, [record | {'reviewer': None}], 'reviewer-uncertain needs a reviewer')

    def test_unverified_record_without_a_review_has_no_reviewer(self):
        record = unverified_tile_record() | {'reviewer': 'owner', 'judgedAtRiga': JUDGED_AT_RIGA}
        self.assert_write_refused(WORLD_PART, [record], 'reviewer and judgedAtRiga must be null')


def escaping_artifact_paths(folder):
    return (f'{folder}/../../npcs/sandbox/tile_20_20.png', f'/{folder}/tile_20_20.png', f'C:/{folder}/tile_20_20.png',
            f'{folder}/tile_20_20.png'.replace('/', '\\'), f'{folder}/./tile_20_20.png', f'{folder}//tile_20_20.png',
            'artifacts/side-by-side/npcs/sandbox/tile_20_20.png', folder)


class ArtifactPathTest(SideBySideRecordsTestCase):
    def test_png_path_outside_the_part_sandbox_folder_is_refused(self):
        for png_path in escaping_artifact_paths('artifacts/side-by-side/world/sandbox'):
            with self.subTest(png_path=png_path):
                self.assert_write_refused(WORLD_PART, [unverified_tile_record(png_path=png_path)], 'sandboxHalf.pngPath must')

    def test_receipt_path_outside_the_part_folder_is_refused(self):
        write_reference_client_lock(self.project_root)
        lock_sha256 = current_reference_tree_lock_sha256(self.project_root)
        for receipt_path in escaping_artifact_paths('artifacts/side-by-side/world'):
            with self.subTest(receipt_path=receipt_path):
                record = judged_tile_record('pass', lock_sha256)
                record['nativeHalf']['receiptPath'] = receipt_path
                self.assert_write_refused(WORLD_PART, [record], 'nativeHalf.receiptPath must')

    def test_clip_path_outside_the_audio_clip_folder_is_refused(self):
        for clip_path in (*escaping_artifact_paths('artifacts/side-by-side/audio/clips'), 'artifacts/side-by-side/audio/sandbox/x.wav'):
            with self.subTest(clip_path=clip_path):
                record = audio_record()
                record['sandboxHalf']['clipPath'] = clip_path
                self.assert_write_refused(AUDIO_PART, [record], 'sandboxHalf.clipPath must')


class AudioRecordTest(SideBySideRecordsTestCase):
    def test_audio_records_are_identified_and_sorted_by_key_role_and_source(self):
        records = [audio_record(role='skill'), audio_record(role='combat', source_sha256='8' * 64), audio_record(role='combat'),
                   audio_record(key='npc:1000', role='voice')]
        document = write_side_by_side_records(self.project_root, AUDIO_PART, records)
        self.assertEqual([(record['key'], record['role'], record['sourceSha256']) for record in document['records']],
                         [('npc:1000', 'voice', '6' * 64), ('npc:1001', 'combat', '6' * 64), ('npc:1001', 'combat', '8' * 64),
                          ('npc:1001', 'skill', '6' * 64)])
        self.assertEqual(AUDIO_ROLES, ('ambience', 'placement', 'music', 'voice', 'combat', 'skill'))

    def test_audio_role_and_source_identity_are_required(self):
        cases = (({'role': 'footsteps'}, 'role must be one of'), ({'sourceSha256': 'x'}, 'sourceSha256 must be 64 lowercase hex'),
                 ({'sourcePackage': ''}, 'sourcePackage must be non-empty text'),
                 ({'nativeSelection': {'route': 'listen', 'role': 'skill'}}, 'nativeSelection role must equal the record role'))
        for changes, message_fragment in cases:
            with self.subTest(changes=changes):
                self.assert_write_refused(AUDIO_PART, [audio_record() | changes], message_fragment)
        record = audio_record()
        del record['role']
        self.assert_write_refused(AUDIO_PART, [record], 'record must hold exactly')

    def test_agents_store_only_listen_needs_owner_for_audio(self):
        self.assert_write_refused(AUDIO_PART, [audio_record() | {'reason': 'native-needs-server'}],
                                  'audio record unverified reason must be listen-needs-owner')

    def test_audio_pass_or_mismatch_is_accepted_only_from_the_owner(self):
        judged = audio_record() | {'verdict': 'pass', 'reason': None, 'reviewer': 'owner', 'judgedAtRiga': JUDGED_AT_RIGA}
        write_side_by_side_records(self.project_root, AUDIO_PART, [judged])
        for verdict in ('pass', 'mismatch'):
            with self.subTest(verdict=verdict):
                record = judged | {'verdict': verdict, 'reviewer': FRESH_REVIEWER}
                if verdict == 'mismatch':
                    record |= {'difference': 'The clip is quieter.', 'suspectedStep': 'audio-export'}
                with self.assertRaisesRegex(SideBySideCheckRecordError, 'audio pass or mismatch is accepted only from reviewer owner'):
                    write_side_by_side_records(self.project_root, AUDIO_PART, [record])


class SandboxHalfHistoryTest(SideBySideRecordsTestCase):
    def test_replacing_a_sandbox_half_moves_the_old_half_to_the_end_of_the_history(self):
        first = unverified_tile_record(key_content_sha256='a' * 64, png_sha256='d' * 64)
        second = unverified_tile_record(key_content_sha256='b' * 64, png_sha256='e' * 64, captured_at_riga='2026-11-11T11:00:00+02:00')
        third = unverified_tile_record(key_content_sha256='f' * 64, png_sha256='0' * 64, captured_at_riga='2026-11-11T12:00:00+02:00')
        write_side_by_side_records(self.project_root, WORLD_PART, [first])
        write_side_by_side_records(self.project_root, WORLD_PART, [second])
        document = write_side_by_side_records(self.project_root, WORLD_PART, [third])
        self.assertEqual(document['records'][0]['sandboxHalf'], third['sandboxHalf'])
        self.assertEqual(document['records'][0]['sandboxHalfHistory'], [
            {'pngSha256': 'd' * 64, 'keyContentSha256': 'a' * 64, 'capturedAtRiga': CAPTURED_AT_RIGA},
            {'pngSha256': 'e' * 64, 'keyContentSha256': 'b' * 64, 'capturedAtRiga': '2026-11-11T11:00:00+02:00'}])

    def test_rewriting_the_same_sandbox_half_keeps_the_history(self):
        write_side_by_side_records(self.project_root, WORLD_PART, [unverified_tile_record(png_sha256='d' * 64)])
        write_side_by_side_records(self.project_root, WORLD_PART, [unverified_tile_record(png_sha256='e' * 64)])
        stored = read_side_by_side_records(self.project_root, WORLD_PART)
        document = write_side_by_side_records(self.project_root, WORLD_PART, stored)
        self.assertEqual(len(document['records'][0]['sandboxHalfHistory']), 1)

    def test_a_caller_cannot_rewrite_the_history(self):
        write_side_by_side_records(self.project_root, WORLD_PART, [unverified_tile_record(png_sha256='d' * 64)])
        forged = unverified_tile_record(png_sha256='e' * 64) | {'sandboxHalfHistory': [
            {'pngSha256': '9' * 64, 'keyContentSha256': 'a' * 64, 'capturedAtRiga': CAPTURED_AT_RIGA}]}
        with self.assertRaisesRegex(SideBySideCheckRecordError, 'sandboxHalfHistory is kept by the writer'):
            write_side_by_side_records(self.project_root, WORLD_PART, [forged])

    def test_replacing_an_audio_clip_keeps_the_old_clip_sha256(self):
        write_side_by_side_records(self.project_root, AUDIO_PART, [audio_record(clip_sha256='7' * 64)])
        document = write_side_by_side_records(self.project_root, AUDIO_PART, [audio_record(clip_sha256='8' * 64)])
        self.assertEqual(document['records'][0]['sandboxHalfHistory'],
                         [{'clipSha256': '7' * 64, 'keyContentSha256': 'a' * 64, 'capturedAtRiga': CAPTURED_AT_RIGA}])


class DisplayedTableRowsTest(SideBySideRecordsTestCase):
    def window_record(self, displayed_table_rows):
        return unverified_record('ui', 'window:InventoryWnd', {'route': 'server-world', 'window': 'InventoryWnd'},
                                 reason='native-needs-server') | {'displayedTableRows': displayed_table_rows}

    def test_displayed_table_rows_are_kept(self):
        rows = [{'tableKey': 'table:etcitemgrp', 'rowIds': [1, 57]}, {'tableKey': 'table:itemname-e', 'rowIds': [57]}]
        document = write_side_by_side_records(self.project_root, 'ui', [self.window_record(rows)])
        self.assertEqual(document['records'][0]['displayedTableRows'], rows)

    def test_displayed_table_rows_need_table_keys_and_sorted_unique_row_ids(self):
        cases = (([{'tableKey': 'window:InventoryWnd', 'rowIds': [1]}], 'tableKey must be a table: catalog key'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': [57, 1]}], 'rowIds must be a non-empty sorted list'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': [1, 1]}], 'rowIds must be a non-empty sorted list'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': []}], 'rowIds must be a non-empty sorted list'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': [1, 'a']}], 'rowIds must be a non-empty sorted list'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': [1]}, {'tableKey': 'table:etcitemgrp', 'rowIds': [1]}],
                  'displayedTableRows must be sorted by tableKey'),
                 ([{'tableKey': 'table:itemname-e', 'rowIds': [1], 'note': 'x'}], 'displayedTableRows entry must hold exactly'))
        for rows, message_fragment in cases:
            with self.subTest(rows=rows):
                self.assert_write_refused('ui', [self.window_record(rows)], message_fragment)


if __name__ == '__main__':
    unittest.main()
