import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_dat_table_inventory import (DECODED_TABLE_COUNT_SOURCE, ELBERA_ADAPTER_COUNT_SOURCE, ELBERA_ADAPTER_DECODED_STATUS,
    ELBERA_EVIDENCE_COUNT_SOURCE, ELBERA_EVIDENCE_RECORD_COUNTS, ELBERA_PARSER_PRESENT_STATUS, ELBERA_PARSER_SOURCES, LAYOUT_NOT_DECODED_STATUS, NOT_LOCK_EQUAL_STATUS, DatTableInventoryError,
    classify_dat_table, count_descriptor_linked_table, elbera_parser_presence, lock_equal_source_sha256,
    validate_dat_table_inventory)
from data.hair_table_adapter import ELBERA_HAIR_FIELD_PROOF, HAIR_TABLE_UNDECODED_REASONS
from native_catalog.table_source_resolver import TableSourceResolutionError, descriptor_layout_links
from native_catalog.tables import TABLES
from native_store.catalog_writer import is_table_name_index_id
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import use_reference_client_lock
from test_reference_client_guard import SyntheticReferenceClientTrees

COMMITTED_INVENTORY_PATH = ROOT / 'docs' / 'parts' / 'data' / 'dat-table-inventory.json'
COMMITTED_REFERENCE_CLIENT_LOCK_PATH = ROOT / 'recipes' / 'reference-client-tree.lock.json'
PORT_SCOPE_PATH = ROOT / 'docs' / 'PORT_SCOPE.md'
ELBERA_CANDIDATE_TABLES = ('hairaccessarygrp', 'hairgrp', 'helmetgrp')
SYNTHETIC_DESCRIPTOR = b'''<?xml version="1.0" encoding="UTF-8"?>
<list name="CT0 Interlude">
	<link pattern="ActionName-[\\w]+\\.dat" file="actionname" version="ScionsOfDestiny" />
	<link pattern="SkillSoundgrp.dat" file="skillsoundgrp" version="ScionsOfDestiny" />
	<!-- <link pattern="hairgrp.dat" file="hairgrp" version="Interlude" /> -->
</list>
'''
OVERLAPPING_DESCRIPTOR = b'''<list name="CT0 Interlude">
	<link pattern="itemname-[\\w]+\\.dat" file="itemname" version="Interlude" />
	<link pattern="ItemName-e\\.dat" file="itemname_copy" version="Interlude" />
</list>
'''
NO_ELBERA_PARSERS = {}
SYNTHETIC_MANIFEST_SHA256 = 'c' * 64


def committed_inventory():
    return json.loads(COMMITTED_INVENTORY_PATH.read_bytes().decode('utf-8'))


def port_scope_elbera_record_counts():
    lines = PORT_SCOPE_PATH.read_text(encoding='utf-8').splitlines()
    start = next(index for index, line in enumerate(lines) if line.startswith("Record counts from Elbera's"))
    counts = {}
    for line in lines[start + 1:]:
        if counts and not line.startswith('|'):
            break
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) != 2 or not cells[1].replace(',', '').isdigit():
            continue
        for table in cells[0].split(','):
            counts[table.strip()] = int(cells[1].replace(',', ''))
    return counts


class DescriptorClassificationTests(unittest.TestCase):
    def setUp(self):
        self.links = descriptor_layout_links(SYNTHETIC_DESCRIPTOR)

    def test_commented_links_vanish(self):
        self.assertEqual([link.layout for link in self.links], ['actionname', 'skillsoundgrp'])

    def test_file_names_match_case_insensitively(self):
        row = classify_dat_table('actionname-e.dat', self.links, NO_ELBERA_PARSERS)
        self.assertEqual((row['table'], row['layout'], row['route'], row['descriptorLayout']),
                         ('actionname-e', 'actionname', 'local-layout-only', True))
        self.assertEqual(classify_dat_table('SkillSoundGrp.dat', self.links, NO_ELBERA_PARSERS)['layout'], 'skillsoundgrp')

    def test_two_layouts_for_one_file_name_raise(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'more than one layout for itemname-e.dat: itemname, itemname_copy'):
            classify_dat_table('itemname-e.dat', descriptor_layout_links(OVERLAPPING_DESCRIPTOR), NO_ELBERA_PARSERS)

    def test_table_without_layout_routes_to_elbera_only_with_a_parser(self):
        with_parser = classify_dat_table('hairgrp.dat', self.links, {'hairgrp': ELBERA_PARSER_PRESENT_STATUS})
        without_parser = classify_dat_table('hairgrp.dat', self.links, NO_ELBERA_PARSERS)
        self.assertEqual((with_parser['route'], with_parser['layout']), ('elbera', None))
        self.assertEqual(without_parser['route'], 'none')


class ElberaParserPresenceTests(unittest.TestCase):
    def test_parser_presence_reads_only_named_function_definitions(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            elbera_root = Path(temporary_directory)
            relative_source, function_name = ELBERA_PARSER_SOURCES['hairgrp']
            (elbera_root / relative_source).parent.mkdir(parents=True)
            (elbera_root / relative_source).write_text(f'def {function_name}(data):\n    return data\n', encoding='utf-8')
            statuses = elbera_parser_presence(elbera_root)
        self.assertEqual(statuses, {'hairgrp': ELBERA_PARSER_PRESENT_STATUS, 'helmetgrp': None, 'hairaccessarygrp': None})


class CommittedDatTableInventoryTests(unittest.TestCase):
    def setUp(self):
        self.inventory = committed_inventory()
        self.rows = self.inventory['rows']

    def test_committed_inventory_validates(self):
        validate_dat_table_inventory(self.inventory)
        self.assertEqual(self.inventory['schemaVersion'], 1)

    def test_rows_are_sorted_by_table(self):
        tables = [row['table'] for row in self.rows]
        self.assertEqual(tables, sorted(tables))

    def test_route_tally(self):
        routes = [row['route'] for row in self.rows]
        self.assertEqual(len(self.rows), len(TABLES) + len(ELBERA_CANDIDATE_TABLES))
        self.assertEqual(routes.count('local-decoded') + routes.count('local-layout-only'), len(TABLES))
        self.assertEqual(sorted(row['table'] for row in self.rows if row['route'] in ('elbera', 'none')), list(ELBERA_CANDIDATE_TABLES))
        self.assertEqual(sorted(row['layout'] for row in self.rows if row['descriptorLayout']), sorted(TABLES))

    def test_no_inventory_table_takes_a_name_index_id(self):
        self.assertEqual([row['table'] for row in self.rows if is_table_name_index_id(row['table'])], [])

    def test_no_row_keeps_the_layout_pinned_not_decoded_status(self):
        self.assertEqual([row['table'] for row in self.rows if row['status'] == LAYOUT_NOT_DECODED_STATUS], [])

    def test_every_layout_only_row_names_its_decode_failure(self):
        for row in self.rows:
            if row['route'] == 'local-layout-only':
                self.assertTrue(row['status'].startswith('decode-failed:'), row)

    def test_local_decoded_counts_are_integers_from_sealed_decodes_of_the_locked_conversion_root(self):
        conversion_root = json.loads(COMMITTED_REFERENCE_CLIENT_LOCK_PATH.read_bytes())['conversionRoot']
        self.assertTrue(DECODED_TABLE_COUNT_SOURCE.endswith(f'lock-equal {conversion_root}/'))
        for row in self.rows:
            if row['route'] == 'local-decoded':
                self.assertIsInstance(row['recordCount'], int, row['table'])
                self.assertEqual(row['countSource'], f'{DECODED_TABLE_COUNT_SOURCE}system/{row["file"]}')

    def test_elbera_adapter_counts_come_from_sealed_decodes_with_the_proof_label(self):
        conversion_root = json.loads(COMMITTED_REFERENCE_CLIENT_LOCK_PATH.read_bytes())['conversionRoot']
        self.assertTrue(ELBERA_ADAPTER_COUNT_SOURCE.endswith(f'lock-equal {conversion_root}/'))
        for row in self.rows:
            if row['status'] == ELBERA_ADAPTER_DECODED_STATUS:
                self.assertEqual(row['route'], 'elbera', row['table'])
                self.assertIsInstance(row['recordCount'], int, row['table'])
                self.assertEqual(row['countSource'], f'{ELBERA_ADAPTER_COUNT_SOURCE}system/{row["file"]}')
                self.assertIn(ELBERA_HAIR_FIELD_PROOF, row['status'])

    def test_every_elbera_row_is_decoded_by_the_adapter_or_names_its_undecoded_reason(self):
        for row in self.rows:
            if row['route'] == 'elbera':
                self.assertIn(row['status'], (ELBERA_ADAPTER_DECODED_STATUS, *HAIR_TABLE_UNDECODED_REASONS.values(),
                                              ELBERA_PARSER_PRESENT_STATUS), row['table'])

    def test_counts_without_a_decode_are_elbera_evidence_or_unknown(self):
        for row in self.rows:
            if row['route'] == 'local-decoded' or row['status'] == ELBERA_ADAPTER_DECODED_STATUS:
                continue
            if row['table'] in ELBERA_EVIDENCE_RECORD_COUNTS:
                self.assertEqual((row['recordCount'], row['countSource']),
                                 (ELBERA_EVIDENCE_RECORD_COUNTS[row['table']], ELBERA_EVIDENCE_COUNT_SOURCE))
            else:
                self.assertEqual((row['recordCount'], row['countSource']), ('unknown', None), row['table'])

    def test_elbera_evidence_counts_equal_port_scope(self):
        self.assertEqual(ELBERA_EVIDENCE_RECORD_COUNTS, port_scope_elbera_record_counts())


class SealedDecodeCountTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.trees = SyntheticReferenceClientTrees(Path(temporary_directory.name).resolve())
        use_reference_client_lock(self, self.trees.lock_path)
        self.trees.write_lock()
        self.conversion_access = require_reference_client(self.trees.conversion_root)
        self.row = {'table': 'npcgrp', 'file': 'npcgrp.dat', 'layout': 'npcgrp'}
        self.source_sha256 = lock_equal_source_sha256(self.conversion_access, 'npcgrp.dat')

    def decoded_records(self, source_sha256):
        return {'npcgrp': {'id': 'npcgrp', 'manifest': f'/l2/tables/{SYNTHETIC_MANIFEST_SHA256}/npcgrp.json',
                           'manifestSha256': SYNTHETIC_MANIFEST_SHA256, 'manifestBytes': 10, 'recordCount': 6519,
                           'sourceSha256': source_sha256}}

    def decode_gap_rows(self, source_sha256):
        return {'table:npcgrp': {'key': 'table:npcgrp', 'part': 'data', 'step': 'decode', 'status': 'gap',
                                 'reason': 'decode-failed:UnicodeDecodeError', 'evidence': 'work/table__npcgrp/decode/receipt.json',
                                 'sourceIdentity': {'path': 'system/npcgrp.dat', 'sha256': source_sha256}}}

    def test_the_source_sha256_is_the_lock_record_of_a_checked_equal_file(self):
        self.assertEqual(self.source_sha256, self.conversion_access.lock.record('system/npcgrp.dat')['eSha256'])
        self.assertIsNone(lock_equal_source_sha256(self.conversion_access, 'chargrp.dat'))

    def test_a_sealed_record_of_the_locked_source_is_local_decoded_with_its_count(self):
        counted = count_descriptor_linked_table(self.row, self.source_sha256, self.decoded_records(self.source_sha256), {})
        self.assertEqual(counted, {'route': 'local-decoded', 'recordCount': 6519, 'countSource': f'{DECODED_TABLE_COUNT_SOURCE}system/npcgrp.dat',
                                   'status': 'decoded, matches Elbera evidence'})

    def test_a_record_of_another_source_is_ignored(self):
        counted = count_descriptor_linked_table(self.row, self.source_sha256, self.decoded_records('d' * 64), {})
        self.assertEqual(counted, {'route': 'local-layout-only', 'recordCount': 6519, 'countSource': ELBERA_EVIDENCE_COUNT_SOURCE,
                                   'status': LAYOUT_NOT_DECODED_STATUS})

    def test_a_decode_failed_gap_row_keeps_the_layout_route_and_names_its_reason(self):
        counted = count_descriptor_linked_table(self.row, self.source_sha256, {}, self.decode_gap_rows(self.source_sha256))
        self.assertEqual((counted['route'], counted['status']), ('local-layout-only', 'decode-failed:UnicodeDecodeError'))
        stale_gap = count_descriptor_linked_table(self.row, self.source_sha256, {}, self.decode_gap_rows('d' * 64))
        self.assertEqual(stale_gap['status'], LAYOUT_NOT_DECODED_STATUS)

    def test_no_record_and_no_gap_keeps_the_layout_route_with_elbera_evidence_or_unknown(self):
        row = {'table': 'castlename-e', 'file': 'castlename-e.dat', 'layout': 'castlename'}
        self.assertEqual(count_descriptor_linked_table(row, self.source_sha256, {}, {}),
                         {'route': 'local-layout-only', 'recordCount': 'unknown', 'countSource': None, 'status': LAYOUT_NOT_DECODED_STATUS})

    def test_a_table_the_lock_marks_not_equal_gets_no_count(self):
        row = {'table': 'chargrp', 'file': 'chargrp.dat', 'layout': 'chargrp'}
        self.assertEqual(count_descriptor_linked_table(row, None, self.decoded_records(self.source_sha256), {}),
                         {'route': 'local-layout-only', 'recordCount': 'unknown', 'countSource': None, 'status': NOT_LOCK_EQUAL_STATUS})


class InventoryValidationBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.inventory = committed_inventory()

    def test_thirty_nine_rows_fail(self):
        shortened = copy.deepcopy(self.inventory)
        shortened['rows'].pop()
        with self.assertRaisesRegex(DatTableInventoryError, 'has 39 rows'):
            validate_dat_table_inventory(shortened)

    def test_forty_one_rows_fail(self):
        lengthened = copy.deepcopy(self.inventory)
        lengthened['rows'].append(dict(lengthened['rows'][-1], table='zzz-extra'))
        with self.assertRaisesRegex(DatTableInventoryError, 'has 41 rows'):
            validate_dat_table_inventory(lengthened)

    def test_unsorted_rows_fail(self):
        reversed_inventory = copy.deepcopy(self.inventory)
        reversed_inventory['rows'].reverse()
        with self.assertRaisesRegex(DatTableInventoryError, 'sorted'):
            validate_dat_table_inventory(reversed_inventory)

    def test_zero_off_the_decoded_route_or_unsourced_counts_fail(self):
        for replacement in ({'recordCount': 0}, {'countSource': None}, {'recordCount': 12.5}):
            broken = copy.deepcopy(self.inventory)
            sourced_row = next(row for row in broken['rows'] if isinstance(row['recordCount'], int) and row['route'] != 'local-decoded')
            sourced_row.update(replacement)
            with self.assertRaisesRegex(DatTableInventoryError, 'is not a sourced integer of at least 1'):
                validate_dat_table_inventory(broken)

    def test_zero_is_accepted_only_on_a_sourced_local_decoded_row(self):
        decoded = copy.deepcopy(self.inventory)
        decoded_row = next(row for row in decoded['rows'] if row['route'] == 'local-decoded')
        decoded_row['recordCount'] = 0
        validate_dat_table_inventory(decoded)
        decoded_row['countSource'] = None
        with self.assertRaisesRegex(DatTableInventoryError, 'is not a sourced integer of at least 0'):
            validate_dat_table_inventory(decoded)

    def test_unknown_count_with_a_source_fails(self):
        broken = copy.deepcopy(self.inventory)
        unknown_row = next(row for row in broken['rows'] if row['recordCount'] == 'unknown')
        unknown_row['countSource'] = ELBERA_EVIDENCE_COUNT_SOURCE
        with self.assertRaisesRegex(DatTableInventoryError, 'names a source'):
            validate_dat_table_inventory(broken)


if __name__ == '__main__':
    unittest.main()
