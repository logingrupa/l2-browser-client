import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_dat_table_inventory
from build_dat_table_inventory import (ELBERA_EVIDENCE_COUNT_SOURCE, ELBERA_EVIDENCE_RECORD_COUNTS, ELBERA_PARSER_PRESENT_STATUS,
    ELBERA_PARSER_SOURCES, LOCAL_DECODE_COUNT_SOURCE_PREFIX, NOT_LOCK_EQUAL_STATUS, DatTableInventoryError, classify_dat_table,
    count_local_decoded_table, descriptor_layout_links, elbera_parser_presence, validate_dat_table_inventory)
from native_catalog.tables import TABLES
from reference_client_guard import ReferenceClientLockError, require_reference_client
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
        self.assertEqual([layout for _, layout in self.links], ['actionname', 'skillsoundgrp'])

    def test_file_names_match_case_insensitively(self):
        row = classify_dat_table('actionname-e.dat', self.links, NO_ELBERA_PARSERS)
        self.assertEqual((row['table'], row['layout'], row['route'], row['descriptorLayout']),
                         ('actionname-e', 'actionname', 'local-layout-only', True))
        self.assertEqual(classify_dat_table('skillsoundgrp.dat', self.links, NO_ELBERA_PARSERS)['route'], 'local-decoded')

    def test_two_layouts_for_one_file_name_raise(self):
        with self.assertRaisesRegex(DatTableInventoryError, 'more than one layout'):
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
        self.assertEqual(len(self.rows), 40)
        self.assertEqual(routes.count('local-decoded'), len(TABLES))
        self.assertEqual(routes.count('local-layout-only'), 29)
        self.assertEqual(sorted(row['table'] for row in self.rows if row['route'] in ('elbera', 'none')), list(ELBERA_CANDIDATE_TABLES))
        self.assertEqual(sorted(row['layout'] for row in self.rows if row['route'] == 'local-decoded'), sorted(TABLES))

    def test_local_decoded_counts_are_integers_from_the_pinned_decode_of_the_locked_conversion_root(self):
        conversion_root = json.loads(COMMITTED_REFERENCE_CLIENT_LOCK_PATH.read_bytes())['conversionRoot']
        for row in self.rows:
            if row['route'] == 'local-decoded' and row['recordCount'] != 'unknown':
                self.assertIsInstance(row['recordCount'], int, row['table'])
                self.assertEqual(row['countSource'], f'{LOCAL_DECODE_COUNT_SOURCE_PREFIX}lock-equal {conversion_root}/system/{row["file"]}')

    def test_counts_without_a_decode_are_elbera_evidence_or_unknown(self):
        for row in self.rows:
            if row['route'] == 'local-decoded':
                continue
            if row['table'] in ELBERA_EVIDENCE_RECORD_COUNTS:
                self.assertEqual((row['recordCount'], row['countSource']),
                                 (ELBERA_EVIDENCE_RECORD_COUNTS[row['table']], ELBERA_EVIDENCE_COUNT_SOURCE))
            else:
                self.assertEqual((row['recordCount'], row['countSource']), ('unknown', None), row['table'])

    def test_elbera_evidence_counts_equal_port_scope(self):
        self.assertEqual(ELBERA_EVIDENCE_RECORD_COUNTS, port_scope_elbera_record_counts())


class LocalDecodedCountTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.trees = SyntheticReferenceClientTrees(Path(temporary_directory.name).resolve())
        use_reference_client_lock(self, self.trees.lock_path)
        self.trees.write_lock()
        self.conversion_access = require_reference_client(self.trees.conversion_root)

    def test_a_table_the_lock_marks_not_equal_is_recorded_without_decoding(self):
        row = {'table': 'chargrp', 'file': 'chargrp.dat', 'layout': 'chargrp'}
        with patch.object(build_dat_table_inventory, 'decode_table', side_effect=AssertionError('a differing table must not be decoded')):
            self.assertEqual(count_local_decoded_table(self.conversion_access, row, None),
                             {'recordCount': 'unknown', 'countSource': None, 'status': NOT_LOCK_EQUAL_STATUS})

    def test_the_count_source_names_the_root_that_was_read_and_whether_the_lock_applied(self):
        row = {'table': 'npcgrp', 'file': 'npcgrp.dat', 'layout': 'npcgrp'}
        decoded = {'source': 'system/npcgrp.dat', 'data': {'npc': [{'id': 1}, {'id': 2}]}}
        reference_access = require_reference_client(self.trees.importa_root)
        with patch.object(build_dat_table_inventory, 'decode_table', return_value=decoded):
            for client_access, expected_source in (
                    (self.conversion_access, f'{LOCAL_DECODE_COUNT_SOURCE_PREFIX}lock-equal {self.trees.conversion_root.as_posix()}/system/npcgrp.dat'),
                    (reference_access, f'{LOCAL_DECODE_COUNT_SOURCE_PREFIX}{self.trees.importa_root.as_posix()}/system/npcgrp.dat')):
                with self.subTest(root=client_access.root):
                    self.assertEqual(count_local_decoded_table(client_access, row, None)['countSource'], expected_source)

    def test_a_stale_lock_on_an_equal_table_stops_the_inventory(self):
        row = {'table': 'npcgrp', 'file': 'npcgrp.dat', 'layout': 'npcgrp'}
        stale_lock = ReferenceClientLockError('reference client lock is stale for system/npcgrp.dat; re-lock ordered')
        with patch.object(build_dat_table_inventory, 'decode_table', side_effect=stale_lock):
            with self.assertRaisesRegex(ReferenceClientLockError, 'stale for system/npcgrp.dat'):
                count_local_decoded_table(self.conversion_access, row, None)


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

    def test_zero_or_unsourced_counts_fail(self):
        for replacement in ({'recordCount': 0}, {'countSource': None}, {'recordCount': 12.5}):
            broken = copy.deepcopy(self.inventory)
            sourced_row = next(row for row in broken['rows'] if isinstance(row['recordCount'], int))
            sourced_row.update(replacement)
            with self.assertRaisesRegex(DatTableInventoryError, 'sourced positive integer'):
                validate_dat_table_inventory(broken)

    def test_unknown_count_with_a_source_fails(self):
        broken = copy.deepcopy(self.inventory)
        unknown_row = next(row for row in broken['rows'] if row['recordCount'] == 'unknown')
        unknown_row['countSource'] = ELBERA_EVIDENCE_COUNT_SOURCE
        with self.assertRaisesRegex(DatTableInventoryError, 'names a source'):
            validate_dat_table_inventory(broken)


if __name__ == '__main__':
    unittest.main()
