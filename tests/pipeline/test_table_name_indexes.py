import contextlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
import table_name_indexes
from convert_tables import LOCAL_DESCRIPTOR_ROUTE, write_table_to_store
from hash_reference_client_tree import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, validate_catalog_record
from native_store.gap_rows import write_gap_rows
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from table_name_indexes import (NAME_INDEX_ALGORITHM_VERSION, NAME_INDEX_SOURCES, TableNameIndexError, name_index_record_id,
                                native_table_name_index, write_table_name_index)

SOURCE_SHA256 = 'a' * 64
SOURCE_MANIFEST_SHA256 = 'b' * 64
DESCRIPTOR_SHA256 = 'c' * 64


def native_table_source_manifest(table, rows_field, rows):
    return {'kind': 'native-table', 'schemaVersion': 1, 'table': table, 'sourcePath': f'system/{table}.dat', 'sourceSha256': SOURCE_SHA256,
            'descriptorSha256': DESCRIPTOR_SHA256, 'route': LOCAL_DESCRIPTOR_ROUTE, 'recordCount': len(rows),
            'records': {'data': len(rows), rows_field: rows}}


def npcname_manifest(rows):
    return native_table_source_manifest('npcname-e', 'npc', rows)


def skillname_manifest(rows):
    return native_table_source_manifest('skillname-e', 'skill', rows)


def npc_row(identifier, name):
    return {'id': identifier, 'name': name, 'nick': 'nick', 'nickcolor': [1, 2, 3, 4]}


def skill_row(identifier, level, name):
    return {'skill_id': identifier, 'skill_level': level, 'name': name, 'desc': 'desc', 'enchant_name': '', 'enchant_desc': ''}


class NativeTableNameIndexTests(unittest.TestCase):
    def test_sources_name_the_pinned_layout_fields(self):
        self.assertEqual({table: tuple(source) for table, source in NAME_INDEX_SOURCES.items()},
                         {'itemname-e': ('item_name', ('id',), 'name'), 'npcname-e': ('npc', ('id',), 'name'),
                          'skillname-e': ('skill', ('skill_id', 'skill_level'), 'name')})

    def test_record_ids_match_the_tables_id_rule(self):
        self.assertEqual([name_index_record_id(table) for table in sorted(NAME_INDEX_SOURCES)],
                         ['itemname_e_names', 'npcname_e_names', 'skillname_e_names'])

    def test_repeated_names_with_different_ids_stay_separate_entries(self):
        index = native_table_name_index('npcname-e', npcname_manifest([npc_row(7, 'Gremlin'), npc_row(3, 'Gremlin')]),
                                        SOURCE_MANIFEST_SHA256)
        self.assertEqual(index['entries'], [{'id': 3, 'name': 'Gremlin'}, {'id': 7, 'name': 'Gremlin'}])
        self.assertEqual(index['duplicateIdentifierCount'], 0)

    def test_one_skill_at_two_levels_gives_one_entry_per_row(self):
        index = native_table_name_index('skillname-e', skillname_manifest([skill_row(3, 2, 'Power Strike'), skill_row(3, 1, 'Power Strike')]),
                                        SOURCE_MANIFEST_SHA256)
        self.assertEqual(index['entries'], [{'skill_id': 3, 'skill_level': 1, 'name': 'Power Strike'},
                                            {'skill_id': 3, 'skill_level': 2, 'name': 'Power Strike'}])
        self.assertEqual((index['identifierFields'], index['nameField']), (['skill_id', 'skill_level'], 'name'))

    def test_exact_duplicate_identifiers_are_kept_in_source_order_and_counted(self):
        index = native_table_name_index('skillname-e', skillname_manifest([skill_row(9, 1, 'Second'), skill_row(4, 1, 'Low'),
                                                                           skill_row(9, 1, 'Third')]), SOURCE_MANIFEST_SHA256)
        self.assertEqual([entry['name'] for entry in index['entries']], ['Low', 'Second', 'Third'])
        self.assertEqual((index['entryCount'], index['duplicateIdentifierCount']), (3, 1))

    def test_names_are_kept_exactly_as_decoded(self):
        names = ['  Leading Spaces', 'MiXeD case', 'Ėlven Ñame', '']
        index = native_table_name_index('npcname-e', npcname_manifest([npc_row(number, name) for number, name in enumerate(names)]),
                                        SOURCE_MANIFEST_SHA256)
        self.assertEqual([entry['name'] for entry in index['entries']], names)

    def test_zero_rows_give_an_index_with_entry_count_zero(self):
        index = native_table_name_index('npcname-e', npcname_manifest([]), SOURCE_MANIFEST_SHA256)
        self.assertEqual((index['entryCount'], index['duplicateIdentifierCount'], index['entries']), (0, 0, []))
        self.assertEqual((index['kind'], index['schemaVersion'], index['sourceManifestSha256'], index['sourceSha256']),
                         ('native-table-name-index', 1, SOURCE_MANIFEST_SHA256, SOURCE_SHA256))

    def test_a_row_without_its_identifier_or_name_is_refused(self):
        with self.assertRaisesRegex(TableNameIndexError, 'npcname-e row 1 lacks integer id or a string name'):
            native_table_name_index('npcname-e', npcname_manifest([npc_row(1, 'Fine'), {'id': 2}]), SOURCE_MANIFEST_SHA256)

    def test_a_manifest_of_another_table_is_refused(self):
        with self.assertRaisesRegex(TableNameIndexError, 'not a native-table manifest of npcname-e'):
            native_table_name_index('npcname-e', skillname_manifest([]), SOURCE_MANIFEST_SHA256)


class WriteTableNameIndexTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.output_root = lane_store_root(self.project_root, 'data-ui')
        self.catalog_path = self.output_root / 'catalog.json'

    def new_ledger(self):
        return UnitLedger(lane_work_root(self.project_root, 'data-ui'), 'name-index', NAME_INDEX_ALGORITHM_VERSION)

    def store_source_table(self, manifest):
        record, manifest_path = write_table_to_store(self.output_root, manifest['table'], canonical_json_bytes(manifest), manifest)
        return record, manifest_path

    def tables_records_by_id(self):
        return {record['id']: record for record in json.loads(self.catalog_path.read_bytes())['tables']}

    def test_index_is_written_cataloged_and_sealed_from_the_source_manifest(self):
        source_record, _ = self.store_source_table(npcname_manifest([npc_row(20001, 'Gremlin'), npc_row(20002, 'Rabbit')]))
        result = write_table_name_index(self.project_root, 'npcname-e', self.output_root, self.new_ledger())
        self.assertEqual((result['status'], result['id'], result['entryCount']), ('indexed', 'npcname_e_names', 2))
        record = self.tables_records_by_id()['npcname_e_names']
        validate_catalog_record('tables', record)
        self.assertEqual((record['recordCount'], record['sourceSha256']), (2, SOURCE_SHA256))
        index = json.loads((self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes())
        self.assertEqual(index['sourceManifestSha256'], source_record['manifestSha256'])
        self.assertEqual(index['entries'], [{'id': 20001, 'name': 'Gremlin'}, {'id': 20002, 'name': 'Rabbit'}])
        seal_path = lane_work_root(self.project_root, 'data-ui') / 'table__npcname-e' / 'name-index' / 'complete.json'
        self.assertTrue(seal_path.is_file())

    def test_rerun_is_skipped_and_byte_identical(self):
        self.store_source_table(npcname_manifest([npc_row(5, 'Same'), npc_row(5, 'Same')]))
        write_table_name_index(self.project_root, 'npcname-e', self.output_root, self.new_ledger())
        record = self.tables_records_by_id()['npcname_e_names']
        catalog_bytes = self.catalog_path.read_bytes()
        index_bytes = (self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes()
        result = write_table_name_index(self.project_root, 'npcname-e', self.output_root, self.new_ledger())
        self.assertEqual(result['status'], 'skipped-sealed')
        self.assertEqual(self.catalog_path.read_bytes(), catalog_bytes)
        self.assertEqual(json.loads(index_bytes)['duplicateIdentifierCount'], 1)

    def test_two_fresh_builds_give_byte_identical_index_and_catalog(self):
        built_bytes = []
        for _ in range(2):
            shutil.rmtree(self.project_root / 'artifacts' / 'lane-store', ignore_errors=True)
            self.store_source_table(skillname_manifest([skill_row(2, 1, 'B'), skill_row(1, 1, 'A')]))
            write_table_name_index(self.project_root, 'skillname-e', self.output_root, self.new_ledger())
            record = self.tables_records_by_id()['skillname_e_names']
            built_bytes.append((self.catalog_path.read_bytes(), (self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes()))
        self.assertEqual(built_bytes[0], built_bytes[1])

    def test_source_manifest_bytes_that_differ_from_the_catalog_pin_are_refused_by_the_shared_pinned_file_reader(self):
        _, manifest_path = self.store_source_table(npcname_manifest([npc_row(1, 'Name')]))
        manifest_path.write_bytes(manifest_path.read_bytes().replace(b'Name', b'Nama'))
        with self.assertRaisesRegex(CatalogWriteError, 'pinned store file SHA-256 differs from its pin'):
            write_table_name_index(self.project_root, 'npcname-e', self.output_root, self.new_ledger())
        self.assertNotIn('npcname_e_names', self.tables_records_by_id())

    def test_a_decode_failed_source_gives_no_index_and_reports_its_gap(self):
        write_gap_rows(self.project_root, 'data-ui', 'decode', [{
            'key': 'table:itemname-e', 'part': 'data', 'step': 'decode', 'status': 'gap', 'reason': 'decode-failed:FormatError',
            'sourceIdentity': {'path': 'system/itemname-e.dat', 'sha256': SOURCE_SHA256}, 'evidence': 'work/table__itemname-e/decode/receipt.json'}])
        result = write_table_name_index(self.project_root, 'itemname-e', self.output_root, self.new_ledger())
        self.assertEqual(result, {'unit': 'table:itemname-e', 'status': 'gap', 'reason': 'decode-failed:FormatError'})
        self.assertFalse(self.catalog_path.exists())

    def test_a_source_without_record_or_gap_is_refused(self):
        with self.assertRaisesRegex(TableNameIndexError, 'itemname-e has neither a sealed tables record nor a decode gap row'):
            write_table_name_index(self.project_root, 'itemname-e', self.output_root, self.new_ledger())


class TableNameIndexCommandTests(unittest.TestCase):
    def test_an_output_folder_other_than_the_lane_store_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_root = Path(temporary_directory).resolve()
            (project_root / 'artifacts').mkdir()
            error_output = io.StringIO()
            with patch.object(table_name_indexes, 'REPOSITORY_ROOT', project_root), contextlib.redirect_stderr(error_output),                     self.assertRaises(SystemExit) as raised:
                table_name_indexes.main(['--output', str(project_root / 'artifacts' / 'tables-scratch')])
            self.assertEqual(raised.exception.code, 2)
            self.assertIn('unrecognized arguments: --output', error_output.getvalue())
            self.assertEqual(sorted(path.name for path in project_root.rglob('*')), ['artifacts'])


if __name__ == '__main__':
    unittest.main()
