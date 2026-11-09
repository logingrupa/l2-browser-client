import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import UnitLedger
import window_control_gaps

INTERFACE_SHA256 = '1' * 64
MANIFEST_SHA256 = '2' * 64
RENDERED_TYPES = ('Window', 'Texture', 'Button', 'TextBox')
SOURCE_IDENTITY = {'path': 'system/interface.xdat', 'sha256': INTERFACE_SHA256}


def synthetic_node(name, control_type, children=()):
    return {'name': name, 'type': control_type, 'children': list(children)}


def synthetic_manifest(window_id, root):
    return {'windowId': window_id, 'sourceSha256': INTERFACE_SHA256, 'root': root}


def mixed_manifest(window_id='SyntheticInventoryWnd'):
    return synthetic_manifest(window_id, synthetic_node(window_id.split('#')[0], 'Window', [
        synthetic_node('SyntheticBackTex', 'Texture'),
        synthetic_node('SyntheticItemGrid', 'ItemWindow'),
        synthetic_node('SyntheticPanel', 'Window', [synthetic_node('SyntheticWeightBar', 'InvenWeight')]),
    ]))


class WindowControlGapRowTests(unittest.TestCase):
    def test_one_row_names_the_only_unsupported_control(self):
        manifest = synthetic_manifest('SyntheticInventoryWnd', synthetic_node('SyntheticInventoryWnd', 'Window', [
            synthetic_node('SyntheticBackTex', 'Texture'), synthetic_node('SyntheticItemGrid', 'ItemWindow')]))
        self.assertEqual(window_control_gaps.window_control_gap_rows(manifest, RENDERED_TYPES, SOURCE_IDENTITY), [{
            'key': 'window:SyntheticInventoryWnd', 'part': 'ui', 'step': 'controls', 'status': 'gap',
            'reason': 'control-type-unsupported:ItemWindow',
            'sourceIdentity': {**SOURCE_IDENTITY, 'object': 'SyntheticInventoryWnd.SyntheticItemGrid'}}])

    def test_only_rendered_types_give_no_rows(self):
        manifest = synthetic_manifest('SyntheticPlainWnd', synthetic_node('SyntheticPlainWnd', 'Window', [
            synthetic_node('SyntheticBackTex', 'Texture'), synthetic_node('SyntheticCloseButton', 'Button'), synthetic_node('SyntheticTitle', 'TextBox')]))
        self.assertEqual(window_control_gaps.window_control_gap_rows(manifest, RENDERED_TYPES, SOURCE_IDENTITY), [])

    def test_nested_controls_come_in_source_order_and_ordinal_ids_keep_their_ordinal_in_the_key(self):
        rows = window_control_gaps.window_control_gap_rows(mixed_manifest('SyntheticInventoryWnd#2'), RENDERED_TYPES, SOURCE_IDENTITY)
        self.assertEqual([(row['key'], row['reason'], row['sourceIdentity']['object']) for row in rows], [
            ('window:SyntheticInventoryWnd#2', 'control-type-unsupported:ItemWindow', 'SyntheticInventoryWnd.SyntheticItemGrid'),
            ('window:SyntheticInventoryWnd#2', 'control-type-unsupported:InvenWeight', 'SyntheticInventoryWnd.SyntheticWeightBar')])

    def test_a_node_without_children_is_refused(self):
        manifest = synthetic_manifest('SyntheticBrokenWnd', {'name': 'SyntheticBrokenWnd', 'type': 'Window'})
        with self.assertRaisesRegex(window_control_gaps.WindowControlGapError, 'name, a type and children'):
            window_control_gaps.window_control_gap_rows(manifest, RENDERED_TYPES, SOURCE_IDENTITY)


class RenderedControlTypeRecipeTests(unittest.TestCase):
    def test_the_committed_recipe_lists_the_four_rendered_types(self):
        self.assertEqual(window_control_gaps.read_rendered_control_types(), RENDERED_TYPES)

    def test_a_recipe_with_repeated_or_missing_types_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            recipe_path = Path(directory) / 'native-window-control-types.json'
            for document in ({'schemaVersion': 1, 'renderedTypes': ['Window', 'Window'], 'source': 's'},
                             {'schemaVersion': 1, 'renderedTypes': [], 'source': 's'},
                             {'schemaVersion': 2, 'renderedTypes': ['Window'], 'source': 's'}):
                recipe_path.write_text(json.dumps(document), encoding='utf-8')
                with self.subTest(document=document), self.assertRaises(window_control_gaps.WindowControlGapError):
                    window_control_gaps.read_rendered_control_types(recipe_path)


class ConvertWindowControlsTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.manifest_record = {'manifest': f'/l2/windows/{MANIFEST_SHA256}/window.json', 'manifestSha256': MANIFEST_SHA256}

    def convert(self, manifest, rendered_types=RENDERED_TYPES):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), window_control_gaps.CONTROLS_STEP, window_control_gaps.CONTROLS_ALGORITHM_VERSION)
        return window_control_gaps.convert_window_controls(self.project_root, manifest, self.manifest_record, rendered_types, ledger)

    def test_writes_one_step_row_naming_the_first_control_and_lists_every_control_in_the_evidence_then_skips_a_rerun(self):
        result = self.convert(mixed_manifest())
        self.assertEqual(result, {'unit': 'window:SyntheticInventoryWnd', 'status': 'gap', 'unsupportedControls': 2,
                                  'unsupportedTypes': ['InvenWeight', 'ItemWindow']})
        [row] = read_gap_rows(self.project_root, 'data-ui')
        self.assertEqual((row['step'], row['reason'], row['sourceIdentity']['object']),
                         ('controls', 'control-type-unsupported:ItemWindow', 'SyntheticInventoryWnd.SyntheticItemGrid'))
        evidence = json.loads((self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / row['evidence']).read_bytes())
        self.assertEqual([evidence_row['sourceIdentity']['object'] for evidence_row in evidence['gapRows']],
                         ['SyntheticInventoryWnd.SyntheticItemGrid', 'SyntheticInventoryWnd.SyntheticWeightBar'])
        self.assertEqual(self.convert(mixed_manifest()), {'unit': 'window:SyntheticInventoryWnd', 'status': 'skipped-sealed'})

    def test_a_wider_rendered_list_reseals_the_unit_and_drops_its_gap_row(self):
        self.convert(mixed_manifest())
        result = self.convert(mixed_manifest(), RENDERED_TYPES + ('ItemWindow', 'InvenWeight'))
        self.assertEqual((result['status'], result['unsupportedControls']), ('converted', 0))
        self.assertEqual(read_gap_rows(self.project_root, 'data-ui'), [])


if __name__ == '__main__':
    unittest.main()
