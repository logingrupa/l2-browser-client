import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
from hash_reference_client_tree import canonical_json_bytes
from native_store.gap_rows import read_gap_rows, read_gap_reason_list
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from reference_client_guard import ReferenceClientLockError
import ui_texture_step

INTERFACE_SHA256 = '1' * 64
SYNTHETIC_PACKAGE_PATH = 'systextures/SyntheticUI.utx'
SYNTHETIC_PACKAGE_SHA256 = '2' * 64
LOCK = SimpleNamespace(document={'schemaVersion': 1, 'synthetic': True}, records_by_path={
    SYNTHETIC_PACKAGE_PATH: {'class': 'equal', 'eSha256': SYNTHETIC_PACKAGE_SHA256},
    'systextures/Twin.utx': {'class': 'equal', 'eSha256': '3' * 64},
    'textures/twin.utx': {'class': 'equal', 'eSha256': '4' * 64},
    'systextures/Changed.utx': {'class': 'differs', 'eSha256': '5' * 64},
})
CENSUS = {'schemaVersion': 1, 'referenceTreeLockSha256': hashlib.sha256(canonical_json_bytes(LOCK.document)).hexdigest(), 'packages': [
    {'path': SYNTHETIC_PACKAGE_PATH, 'packageVersion': 118, 'licensee': 11, 'reviewed': False, 'reason': 'texture-licensee-unsupported:118/11'},
]}
FIELD_BINDINGS = {'schemaVersion': 1, 'bindings': [
    {'windowId': 'SyntheticStatusWnd', 'controlName': 'SyntheticHpBar', 'gapReason': None},
    {'windowId': 'SyntheticStatusWnd', 'controlName': 'SyntheticCpBar', 'gapReason': 'adapter-field-absent:cp'},
    {'windowId': 'SyntheticOtherWnd', 'controlName': 'SyntheticMpBar', 'gapReason': 'adapter-field-absent:mp'},
]}


def synthetic_manifest(window_id, texture_refs):
    return {'windowId': window_id, 'sourceSha256': INTERFACE_SHA256, 'textureRefs': texture_refs}


class SyntheticDecodeError(ValueError):
    pass


class FakeConverter:
    def __init__(self, output, failing_objects):
        self.output = output
        self.failing_objects = failing_objects
        self.failing_error = SyntheticDecodeError('synthetic package table refused')
        self.requests = []

    def convert(self, request):
        self.requests.append(request)
        if request['object'] in self.failing_objects:
            raise self.failing_error
        image = b'\x89PNG\r\n\x1a\n' + request['object'].encode()
        archive = b'PK' + image
        archive_sha256 = hashlib.sha256(archive).hexdigest()
        target = self.output / archive_sha256
        target.mkdir(parents=True, exist_ok=True)
        (target / 'texture.png').write_bytes(image)
        (target / 'asset.l2asset').write_bytes(archive)
        (target / 'asset.json').write_bytes(json.dumps({
            'id': 'interlude:' + request['object'], 'image': {'file': 'texture.png'},
            'source': {'edition': 'interlude', 'package': request['package'], 'object': request['object'], 'sha256': SYNTHETIC_PACKAGE_SHA256,
                       'packageVersion': 118, 'licenseeVersion': 11, 'path': {'host': 'SYNTHETIC', 'absolutePath': 'C:/synthetic.utx'}},
            'files': [{'path': 'texture.png', 'sha256': hashlib.sha256(image).hexdigest(), 'bytes': len(image), 'mime': 'image/png'}],
        }).encode())
        return {'file': str(target / 'asset.l2asset'), 'sha256': archive_sha256, 'id': 'interlude:' + request['object']}


class UiTextureRequestTests(unittest.TestCase):
    def requests(self, manifests):
        return ui_texture_step.ui_texture_requests(manifests, CENSUS, LOCK)

    def test_shared_reference_is_listed_once_with_both_windows_sorted_by_reference(self):
        recipe = self.requests([synthetic_manifest('SyntheticStatusWnd', ['SyntheticUI.Status.Plate', 'syntheticui.Status.Gauge']),
                                synthetic_manifest('SyntheticOtherWnd', ['SyntheticUI.Status.Plate'])])
        self.assertEqual(recipe['interfaceSha256'], INTERFACE_SHA256)
        self.assertEqual([texture['reference'] for texture in recipe['textures']], ['SyntheticUI.Status.Plate', 'syntheticui.Status.Gauge'])
        plate = recipe['textures'][0]
        self.assertEqual(plate['windowIds'], ['SyntheticOtherWnd', 'SyntheticStatusWnd'])
        self.assertEqual((plate['packageName'], plate['packagePath'], plate['packageSha256']), ('SyntheticUI', SYNTHETIC_PACKAGE_PATH, SYNTHETIC_PACKAGE_SHA256))
        self.assertEqual((plate['packageVersion'], plate['licensee'], plate['nativeSidecarReviewed'], plate['reason']), (118, 11, False, None))
        self.assertEqual(recipe['textures'][1]['packagePath'], SYNTHETIC_PACKAGE_PATH)

    def test_ambiguous_missing_and_not_lock_equal_packages_are_unresolved(self):
        recipe = self.requests([synthetic_manifest('SyntheticStatusWnd', ['Twin.Plate.Back', 'Absent.Plate.Back', 'Changed.Plate.Back'])])
        self.assertEqual({texture['reference']: (texture['reason'], texture['packagePath']) for texture in recipe['textures']}, {
            'Absent.Plate.Back': ('texture-reference-unresolved', None), 'Changed.Plate.Back': ('texture-reference-unresolved', None),
            'Twin.Plate.Back': ('texture-reference-unresolved', None)})

    def test_case_variants_of_one_reference_stay_separate(self):
        recipe = self.requests([synthetic_manifest('SyntheticStatusWnd', ['SyntheticUI.Plate.Back', 'SyntheticUI.Plate.back'])])
        self.assertEqual([texture['reference'] for texture in recipe['textures']], ['SyntheticUI.Plate.Back', 'SyntheticUI.Plate.back'])

    def test_census_of_another_lock_and_mixed_interfaces_are_refused(self):
        with self.assertRaisesRegex(ui_texture_step.UiTextureStepError, 'another reference client lock'):
            ui_texture_step.ui_texture_requests([], {**CENSUS, 'referenceTreeLockSha256': '9' * 64}, LOCK)
        with self.assertRaisesRegex(ui_texture_step.UiTextureStepError, 'one interface.xdat'):
            self.requests([synthetic_manifest('SyntheticStatusWnd', []), {**synthetic_manifest('SyntheticOtherWnd', []), 'sourceSha256': '8' * 64}])

    def test_recipe_bytes_regenerate_identically(self):
        manifests = [synthetic_manifest('SyntheticStatusWnd', ['SyntheticUI.Status.Plate'])]
        self.assertEqual(ui_texture_step.ui_texture_recipe_bytes(self.requests(manifests)), ui_texture_step.ui_texture_recipe_bytes(self.requests(manifests)))


class ConvertWindowTexturesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.output_root = lane_store_root(self.project_root, 'data-ui')
        self.converter = FakeConverter(lane_work_root(self.project_root, 'data-ui') / 'ui-texture-converter', {'SyntheticUI.Status.Broken'})
        self.requests = ui_texture_step.ui_texture_requests([synthetic_manifest('SyntheticStatusWnd', [
            'SyntheticUI.Status.Plate', 'SyntheticUI.Status.Broken', 'SyntheticUI.Status.plate', 'Absent.Status.Plate'])], CENSUS, LOCK)

    def ledger(self):
        return UnitLedger(lane_work_root(self.project_root, 'data-ui'), ui_texture_step.TEXTURES_STEP, ui_texture_step.UI_TEXTURE_ALGORITHM_VERSION)

    def convert(self, field_bindings_document=FIELD_BINDINGS):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), ui_texture_step.TEXTURES_STEP, ui_texture_step.UI_TEXTURE_ALGORITHM_VERSION)
        return ui_texture_step.convert_window_textures(self.project_root, 'SyntheticStatusWnd', self.requests, self.converter, ledger, self.output_root,
                                                       converter_identity={'implementation': 'synthetic'}, field_bindings_document=field_bindings_document)

    def test_converts_records_gaps_and_binding_gaps_then_seals_and_skips_a_rerun(self):
        result = self.convert()
        self.assertEqual((result['status'], result['converted'], result['textureGaps'], result['fieldGaps']), ('gap', 2, 2, 1))
        self.assertEqual([request['object'] for request in self.converter.requests],
                         ['SyntheticUI.Status.Broken', 'SyntheticUI.Status.Plate', 'SyntheticUI.Status.plate'])
        records = json.loads((self.output_root / 'catalog.json').read_bytes())['textures']
        self.assertEqual([record['id'] for record in records], ['ui-texture:SyntheticUI.Status.Plate', 'ui-texture:SyntheticUI.Status.plate'])
        for record in records:
            image = (self.output_root / record['image'].removeprefix('/l2/')).read_bytes()
            self.assertEqual((hashlib.sha256(image).hexdigest(), len(image)), (record['imageSha256'], record['imageBytes']))
            self.assertEqual(record['source']['package'], 'SyntheticUI')
            self.assertNotIn('path', record['source'])
        rows = read_gap_rows(self.project_root, 'data-ui')
        self.assertEqual([(row['step'], row['key'], row['reason'], row['sourceIdentity'].get('object')) for row in rows], [
            ('field-cp', 'window:SyntheticStatusWnd', 'adapter-field-absent:cp', 'SyntheticStatusWnd.SyntheticCpBar'),
            ('textures', 'window:SyntheticStatusWnd', 'texture-reference-unresolved', 'Absent.Status.Plate')])
        outcomes = json.loads((self.project_root / 'artifacts' / 'lane-store' / 'data-ui' / rows[0]['evidence']).read_bytes())['outcomes']
        self.assertEqual({outcome['reference']: outcome['status'] for outcome in outcomes}, {
            'Absent.Status.Plate': 'gap', 'SyntheticUI.Status.Broken': 'gap', 'SyntheticUI.Status.Plate': 'converted', 'SyntheticUI.Status.plate': 'converted'})
        self.assertIn('decode-failed:SyntheticDecodeError', [outcome.get('reason') for outcome in outcomes])
        self.assertEqual(self.convert(), {'unit': 'window:SyntheticStatusWnd', 'status': 'skipped-sealed'})
        self.assertEqual(len(self.converter.requests), 3)

    def test_a_resolved_field_binding_removes_its_field_gap_row_on_the_next_run(self):
        self.convert()
        resolved_bindings = {**FIELD_BINDINGS, 'bindings': [
            {**binding, 'gapReason': None} if binding['controlName'] == 'SyntheticCpBar' else binding for binding in FIELD_BINDINGS['bindings']]}
        result = self.convert(resolved_bindings)
        self.assertEqual(result['fieldGaps'], 0)
        self.assertEqual([(row['step'], row['key']) for row in read_gap_rows(self.project_root, 'data-ui')],
                         [('textures', 'window:SyntheticStatusWnd')])

    def test_a_raising_reference_alone_is_a_decode_failed_gap_row(self):
        self.requests = ui_texture_step.ui_texture_requests([synthetic_manifest('SyntheticStatusWnd', ['SyntheticUI.Status.Broken'])], CENSUS, LOCK)
        self.convert()
        [texture_row] = [row for row in read_gap_rows(self.project_root, 'data-ui') if row['step'] == 'textures']
        self.assertEqual((texture_row['reason'], texture_row['sourceIdentity']), ('decode-failed:SyntheticDecodeError', {
            'path': SYNTHETIC_PACKAGE_PATH, 'sha256': SYNTHETIC_PACKAGE_SHA256, 'object': 'SyntheticUI.Status.Broken'}))
        self.assertFalse((self.output_root / 'catalog.json').exists())

    def test_a_transient_converter_failure_leaves_the_window_unsealed_with_no_gap_row_and_no_store_write(self):
        for failing_error in (subprocess.TimeoutExpired('umodel', 300), OSError('disk full')):
            with self.subTest(type(failing_error).__name__):
                self.converter.failing_error = failing_error
                result = self.convert()
                self.assertEqual((result['status'], result['reason'].split(':')[0]), ('failed', type(failing_error).__name__))
                self.assertIsNone(self.ledger().sealed_receipt('window:SyntheticStatusWnd'))
                self.assertEqual(read_gap_rows(self.project_root, 'data-ui'), [])
                self.assertFalse((self.output_root / 'catalog.json').exists())

    def test_a_reference_client_lock_error_propagates_and_leaves_the_window_unsealed(self):
        self.converter.failing_error = ReferenceClientLockError('systextures/SyntheticUI.utx differs from the reference client lock')
        with self.assertRaises(ReferenceClientLockError):
            self.convert()
        self.assertIsNone(self.ledger().sealed_receipt('window:SyntheticStatusWnd'))
        self.assertEqual(read_gap_rows(self.project_root, 'data-ui'), [])


class DataUiGapReasonListTests(unittest.TestCase):
    def test_lists_the_four_data_ui_reasons(self):
        document = read_gap_reason_list(ROOT / 'recipes' / 'data' / 'gap-reasons.json')
        self.assertEqual((document['listVersion'], document['reasons']),
                         (1, ['texture-reference-unresolved', 'texture-not-in-catalog', 'anchor-unresolved:<reason>', 'label-unresolved']))


if __name__ == '__main__':
    unittest.main()
