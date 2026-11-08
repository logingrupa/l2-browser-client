from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
sys.path.insert(0, str(ROOT / 'tests' / 'fixtures' / 'xdat'))
import convert_ui
import interface_layout_adapter as adapter
from native_store.catalog_writer import WINDOW_MANIFEST_PATH_PATTERN, validate_catalog_record
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from pinned_elbera_module import ELBERA_ROOT, load_pinned_elbera_module
from synthetic_interface_xdat import (SYNTHETIC_WINDOW_LAYOUT_PATH, SYNTHETIC_WINDOWS, decode_synthetic_interface_layout,
                                      synthetic_interface_xdat, synthetic_window_layout_bytes)

ELBERA_PARSER_AVAILABLE = (ELBERA_ROOT / adapter.ELBERA_PARSE_XDAT_PATH).is_file()
SYNTHETIC_INPUT_SHA256 = '1' * 64
COMMITTED_CENSUS_PATH = ROOT / 'docs' / 'parts' / 'ui' / 'interface-window-census.json'
LANE_STORE_CATALOG_PATH = ROOT / 'artifacts' / 'lane-store' / 'data-ui' / 'l2' / 'catalog.json'
DECLARED_INTERFACE_WINDOW_COUNT = 165


def manifest_nodes(node):
    yield node
    for child in node['children']:
        yield from manifest_nodes(child)


def pinned_parse_xdat_module():
    return load_pinned_elbera_module(adapter.ELBERA_PARSE_XDAT_PATH, adapter.ELBERA_PARSE_XDAT_SHA256)


class WindowIdentifierTests(unittest.TestCase):
    def roots(self, *names):
        return [{'name': name} for name in names]

    def test_repeated_root_names_get_one_based_ordinals_in_source_order(self):
        self.assertEqual(adapter.window_identifiers(self.roots('A', 'B', 'A')), ['A#1', 'B', 'A#2'])

    def test_a_root_name_that_appears_once_keeps_its_bare_name(self):
        self.assertEqual(adapter.window_identifiers(self.roots('A')), ['A'])

    def test_a_root_name_outside_the_window_id_rule_is_refused(self):
        with self.assertRaisesRegex(adapter.InterfaceLayoutError, 'does not match'):
            adapter.window_identifiers(self.roots('Has.Dot'))


class DecodeRefusalTests(unittest.TestCase):
    def test_source_bytes_off_the_pin_are_refused_before_the_parser_runs(self):
        parser_calls = []
        parse_xdat_module = SimpleNamespace(scan=lambda data: parser_calls.append(data), build_tree=lambda records: [])
        with self.assertRaisesRegex(adapter.InterfaceLayoutError, 'differs from its pin b5b37678'):
            adapter.decode_interface_layout(b'not the pinned interface', parse_xdat_module)
        self.assertEqual(parser_calls, [])

    def test_nodes_that_share_a_scan_record_textures_list_are_refused(self):
        shared_textures = []
        records = [{'name': 'First', 'textures': shared_textures}, {'name': 'Second', 'textures': shared_textures}]
        parse_xdat_module = SimpleNamespace(scan=lambda data: (1, records), build_tree=lambda scanned: [])
        with patch.object(adapter, 'INTERFACE_XDAT_SHA256', hashlib.sha256(b'synthetic').hexdigest()):
            with self.assertRaisesRegex(adapter.InterfaceLayoutError, 'share a textures list'):
                adapter.decode_interface_layout(b'synthetic', parse_xdat_module)

    def test_a_tree_that_drops_a_scan_record_is_refused(self):
        records = [{'name': 'Kept', 'textures': []}, {'name': 'Dropped', 'textures': []}]
        kept_node = {'name': 'Kept', 'textures': records[0]['textures'], 'children': []}
        parse_xdat_module = SimpleNamespace(scan=lambda data: (1, records), build_tree=lambda scanned: [kept_node])
        with patch.object(adapter, 'INTERFACE_XDAT_SHA256', hashlib.sha256(b'synthetic').hexdigest()):
            with self.assertRaisesRegex(adapter.InterfaceLayoutError, '1 nodes for 2 scan records'):
                adapter.decode_interface_layout(b'synthetic', parse_xdat_module)


@unittest.skipUnless(ELBERA_PARSER_AVAILABLE, 'pinned Elbera checkout with tools/xdat/parse_xdat.py is absent')
class SyntheticInterfaceLayoutTests(unittest.TestCase):
    def setUp(self):
        self.data = synthetic_interface_xdat(SYNTHETIC_WINDOWS)
        self.parse_xdat_module = pinned_parse_xdat_module()
        self.layout = decode_synthetic_interface_layout(self.data, self.parse_xdat_module)

    def manifests(self):
        return [adapter.window_layout_manifest(window_id, root, self.layout.record_of_node, self.data)
                for window_id, root in zip(adapter.window_identifiers(self.layout.roots), self.layout.roots)]

    def test_parser_reads_the_guarded_bytes_through_its_module_data(self):
        self.assertIs(self.parse_xdat_module.data_g, self.data)
        self.assertEqual(self.layout.declared_window_count, len(SYNTHETIC_WINDOWS))

    def test_roots_keep_source_order_and_an_ambiguous_parent_stays_a_root(self):
        self.assertEqual([root['name'] for root in self.layout.roots],
                         ['SyntheticStatusWnd', 'SyntheticRepeatedWnd', 'SyntheticRepeatedTex', 'SyntheticPlainWnd', 'SyntheticRepeatedWnd'])
        offsets = [self.layout.record_of_node(root)['off'] for root in self.layout.roots]
        self.assertEqual(offsets, sorted(offsets))
        self.assertEqual(self.layout.roots[2]['parentResolution']['status'], 'ambiguous')

    def test_every_node_pairs_with_its_own_scan_record(self):
        paired_offsets = []
        for manifest in self.manifests():
            for node in manifest_nodes(manifest['root']):
                record = next(record for record in self.layout.records if record['off'] == node['sourceOffset'])
                self.assertEqual(record['name'], node['name'])
                paired_offsets.append(node['sourceOffset'])
        self.assertEqual(sorted(paired_offsets), [record['off'] for record in self.layout.records])

    def test_every_node_tail_hashes_exactly_its_source_span(self):
        for manifest in self.manifests():
            for node in manifest_nodes(manifest['root']):
                tail = node['tail']
                self.assertLessEqual(tail['offset'], tail['end'])
                self.assertEqual(tail['sha256'], hashlib.sha256(self.data[tail['offset']:tail['end']]).hexdigest())

    def test_manifest_keeps_children_in_source_order_and_lists_texture_references_once(self):
        status_manifest = self.manifests()[0]
        self.assertEqual((status_manifest['kind'], status_manifest['schemaVersion'], status_manifest['anchorProof']),
                         ('native-window-layout', 1, adapter.WINDOW_ANCHOR_PROOF))
        self.assertEqual([child['name'] for child in status_manifest['root']['children']], ['SyntheticBackTex', 'SyntheticGaugeBar'])
        self.assertEqual(status_manifest['textureRefs'], ['SyntheticUI.StatusWnd.BackPlate', 'SyntheticUI.StatusWnd.GaugeFill',
                                                          'SyntheticUI.StatusWnd.GaugeBack'])
        self.assertEqual(status_manifest['sourceSha256'], hashlib.sha256(self.data).hexdigest())

    def test_census_lists_roots_in_source_order_with_duplicate_ids_and_sorted_control_names(self):
        census = adapter.interface_window_census(self.layout, adapter.ELBERA_PARSE_XDAT_SHA256)
        self.assertEqual((census['declaredWindowCount'], census['scannedRecordCount'], census['rootWindowCount']), (4, 7, 5))
        self.assertEqual([row['windowId'] for row in census['windows']], ['SyntheticStatusWnd', 'SyntheticRepeatedWnd#1', 'SyntheticRepeatedTex',
                                                                         'SyntheticPlainWnd', 'SyntheticRepeatedWnd#2'])
        self.assertEqual(census['windows'][2], {'windowId': 'SyntheticRepeatedTex', 'name': 'SyntheticRepeatedTex', 'type': 'Texture',
                                                'sourceOffset': 922})
        self.assertEqual(census['duplicateRootNames'], [{'name': 'SyntheticRepeatedWnd', 'occurrences': 2}])
        self.assertEqual(census['controlNames'], sorted({record['name'] for record in self.layout.records}))
        self.assertEqual(census['elberaParser'], {'path': adapter.ELBERA_PARSE_XDAT_PATH, 'sha256': adapter.ELBERA_PARSE_XDAT_SHA256,
                                                  'commit': '12c9656'})

    def test_committed_synthetic_layout_fixture_regenerates_byte_identically(self):
        committed = SYNTHETIC_WINDOW_LAYOUT_PATH.read_bytes().replace(b'\r\n', b'\n')
        self.assertEqual(synthetic_window_layout_bytes(self.parse_xdat_module), committed)
        self.assertEqual(synthetic_window_layout_bytes(pinned_parse_xdat_module()), committed)


class CommittedInterfaceWindowCensusTests(unittest.TestCase):
    def setUp(self):
        self.census = json.loads(COMMITTED_CENSUS_PATH.read_bytes())

    def test_census_pins_the_lock_equal_source_and_the_parser(self):
        self.assertEqual((self.census['sourcePath'], self.census['sourceSha256']), (adapter.INTERFACE_XDAT_PATH, adapter.INTERFACE_XDAT_SHA256))
        self.assertEqual(self.census['elberaParser']['sha256'], adapter.ELBERA_PARSE_XDAT_SHA256)

    def test_census_declares_165_windows_and_lists_each_decoded_root_once_in_source_order(self):
        self.assertEqual(self.census['declaredWindowCount'], DECLARED_INTERFACE_WINDOW_COUNT)
        rows = self.census['windows']
        self.assertEqual(len(rows), self.census['rootWindowCount'])
        self.assertEqual(len({row['windowId'] for row in rows}), len(rows))
        offsets = [row['sourceOffset'] for row in rows]
        self.assertEqual(offsets, sorted(set(offsets)))
        self.assertEqual([row['windowId'] for row in rows], adapter.window_identifiers(rows))
        repeated = {entry['name']: entry['occurrences'] for entry in self.census['duplicateRootNames']}
        self.assertTrue(all(occurrences > 1 for occurrences in repeated.values()))
        self.assertEqual(repeated, {name: count for name, count in Counter(row['name'] for row in rows).items() if count > 1})

    def test_control_names_are_a_sorted_unique_set_covering_every_root(self):
        names = self.census['controlNames']
        self.assertEqual(names, sorted(set(names)))
        self.assertLessEqual({row['name'] for row in self.census['windows']}, set(names))
        self.assertLessEqual(len(names), self.census['scannedRecordCount'])

    @unittest.skipUnless(LANE_STORE_CATALOG_PATH.is_file(), 'data-ui lane store has no catalog')
    def test_every_lane_store_window_record_is_a_census_window(self):
        catalog_window_ids = {record['id'] for record in json.loads(LANE_STORE_CATALOG_PATH.read_bytes()).get('windows', [])}
        self.assertLessEqual(catalog_window_ids, {row['windowId'] for row in self.census['windows']})


@unittest.skipUnless(ELBERA_PARSER_AVAILABLE, 'pinned Elbera checkout with tools/xdat/parse_xdat.py is absent')
class ConvertWindowUnitTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.output_root = lane_store_root(self.project_root, 'data-ui')
        self.data = synthetic_interface_xdat(SYNTHETIC_WINDOWS)
        self.parse_xdat_module = load_pinned_elbera_module(adapter.ELBERA_PARSE_XDAT_PATH, adapter.ELBERA_PARSE_XDAT_SHA256)
        self.source_pin = patch.object(adapter, 'INTERFACE_XDAT_SHA256', hashlib.sha256(self.data).hexdigest())
        self.source_pin.start()
        self.addCleanup(self.source_pin.stop)

    def unit_plan(self):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), convert_ui.LAYOUT_STEP, convert_ui.LAYOUT_ALGORITHM_VERSION)
        return convert_ui.LayoutUnitPlan(self.project_root, self.output_root, ledger,
                                         [{'path': adapter.INTERFACE_XDAT_PATH, 'sha256': SYNTHETIC_INPUT_SHA256}])

    def convert(self, window_ids):
        return convert_ui.convert_layout_step(self.unit_plan(), self.data, self.parse_xdat_module, window_ids, 10)[0]

    def windows_records(self):
        return json.loads((self.output_root / 'catalog.json').read_bytes())['windows']

    def test_one_window_is_written_cataloged_sealed_and_skipped_on_rerun(self):
        [result] = self.convert(['SyntheticStatusWnd'])
        self.assertEqual(result['status'], 'decoded')
        [record] = self.windows_records()
        validate_catalog_record('windows', record)
        self.assertEqual(WINDOW_MANIFEST_PATH_PATTERN.fullmatch(record['manifest'])['sha256'], record['manifestSha256'])
        manifest_bytes = (self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes()
        self.assertEqual((hashlib.sha256(manifest_bytes).hexdigest(), len(manifest_bytes)), (record['manifestSha256'], record['manifestBytes']))
        self.assertEqual(json.loads(manifest_bytes)['windowId'], 'SyntheticStatusWnd')
        seal_path = lane_work_root(self.project_root, 'data-ui') / 'window__SyntheticStatusWnd' / 'layout' / 'complete.json'
        self.assertTrue(seal_path.is_file())
        self.assertEqual(self.convert(['SyntheticStatusWnd']), [{'unit': 'window:SyntheticStatusWnd', 'status': 'skipped-sealed'}])

    def test_unknown_window_is_refused(self):
        with self.assertRaisesRegex(convert_ui.ConvertUiError, 'no root window MissingWnd'):
            self.convert(['MissingWnd'])

    def test_decode_failure_is_a_sealed_gap_row_for_every_requested_window(self):
        broken_module = SimpleNamespace(scan=lambda data: (_ for _ in ()).throw(IndexError('truncated')), build_tree=lambda records: [])
        results = convert_ui.convert_layout_step(self.unit_plan(), self.data, broken_module, ['SyntheticStatusWnd', 'SyntheticPlainWnd'], 10)[0]
        self.assertEqual([(result['unit'], result['reason']) for result in results],
                         [('window:SyntheticStatusWnd', 'decode-failed:IndexError'), ('window:SyntheticPlainWnd', 'decode-failed:IndexError')])
        gap_rows = json.loads((self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / 'gap-rows' / 'layout.json').read_bytes())['rows']
        self.assertEqual([(row['key'], row['part']) for row in gap_rows], [('window:SyntheticPlainWnd', 'ui'), ('window:SyntheticStatusWnd', 'ui')])


if __name__ == '__main__':
    unittest.main()
