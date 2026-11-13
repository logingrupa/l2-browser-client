import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import lane_sharing_candidates
from native_store.file_identity import file_identity
from native_store.lane_sharing_candidates import MINIMUM_SHARED_FILE_BYTES, lane_converter_folders, survey_lane
from support.shared_lane_fixture import CONTENT_FOLDER_NAME, SharedLaneFixture, payload_of, write_file

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
except (ImportError, AttributeError):
    JUNCTION_FACTORY = None

TWIN = payload_of('twin')
NEVER_SHARED_FOLDER_RELATIVE_PATHS = ('models/.work/twin.bin', 'models/index/twin.bin', 'models/interprocess-locks/twin.bin',
                                      'models/class-defaults/twin.bin', 'skills/bundle/twin.bin', 'classes/0123abcd/decoded/twin.bin')
LEDGER_RECORD_NAMES = ('owner.json', '.running.json', 'receipt.json', 'complete.json')


class SurveyLaneTests(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)

    def survey(self, lane_name='actors', lane_is_free_of_conversions=True):
        return survey_lane(self.lanes.lane_stores_root, lane_name, lane_is_free_of_conversions)

    def require_only_rule(self, survey, rule, file_count):
        self.assertEqual(survey.candidates, [])
        self.assertEqual(survey.skipped_file_count_by_rule, {rule: file_count})

    def test_a_store_folder_file_a_converter_content_file_and_a_sealed_unit_output_are_candidates(self):
        store_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        content_path = self.lanes.write_converter_file('actors', 'asset.l2asset', TWIN)
        evidence_path = self.lanes.write_converter_file('actors', 'evidence/export/twin.png', TWIN)
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        survey = self.survey()
        self.assertEqual([candidate.relative for candidate in survey.candidates], [
            'actors/l2/models/twin.bin', f'actors/work/mesh__first/model/asset.l2asset',
            f'actors/work/static-mesh-converter/{CONTENT_FOLDER_NAME}/asset.l2asset',
            f'actors/work/static-mesh-converter/{CONTENT_FOLDER_NAME}/evidence/export/twin.png'])
        self.assertEqual([candidate.path for candidate in survey.candidates],
                         [store_path, step_directory / 'asset.l2asset', content_path, evidence_path])
        self.assertEqual([candidate.identity for candidate in survey.candidates],
                         [file_identity(candidate.path) for candidate in survey.candidates])
        self.assertEqual({candidate.link_count for candidate in survey.candidates}, {1})
        self.assertEqual(survey.skipped_file_count_by_rule, {'ledger-record': 3})

    def test_a_link_count_is_read_from_the_file_on_disk(self):
        store_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        os.link(store_path, store_path.with_name('second-name.bin'))
        self.assertEqual([candidate.link_count for candidate in self.survey().candidates], [2, 2])

    def test_a_temporary_name_is_no_candidate(self):
        self.lanes.write_store_file('actors', 'models/twin.bin.k3j2.tmp', TWIN)
        self.require_only_rule(self.survey(), 'temporary-name', 1)

    def test_a_file_directly_in_the_store_root_is_no_candidate(self):
        for name in ('catalog.json', 'coverage.json'):
            self.lanes.write_store_file('actors', name, TWIN)
        self.require_only_rule(self.survey(), 'store-root-file', 2)

    def test_files_outside_the_shared_places_are_no_candidates(self):
        converter_folder = self.lanes.converter_folder('actors')
        for relative in ('loose.bin', 'gap-rows/model.json', 'work/mesh__first/loose.bin', 'work/loose.bin',
                         'work/folder-without-index/' + CONTENT_FOLDER_NAME + '/twin.bin', 'work/identical-file-sharing/examined-files.json'):
            self.lanes.write_lane_file('actors', relative, TWIN)
        for relative in ('.work/job-1/export/twin.png', 'index/twin.json', 'not-a-sha256/twin.bin', 'twin.bin'):
            write_file(converter_folder / relative, TWIN)
        self.require_only_rule(self.survey(), 'outside-the-shared-places', 10)

    def test_each_never_shared_folder_name_gives_no_candidate(self):
        for relative in NEVER_SHARED_FOLDER_RELATIVE_PATHS:
            with self.subTest(relative=relative):
                lanes = SharedLaneFixture(self)
                lanes.write_store_file('actors', relative, TWIN)
                lanes.write_converter_file('actors', 'evidence/' + relative, TWIN)
                survey = survey_lane(lanes.lane_stores_root, 'actors', True)
                self.assertEqual((survey.candidates, survey.skipped_file_count_by_rule), ([], {'never-shared-folder': 2}))

    def test_a_decoded_folder_that_is_not_two_levels_below_classes_gives_a_candidate(self):
        self.lanes.write_store_file('actors', 'classes/decoded/twin.bin', TWIN)
        self.lanes.write_store_file('actors', 'models/0123abcd/decoded/twin.bin', TWIN)
        self.assertEqual(len(self.survey().candidates), 2)

    def test_the_sealed_products_of_a_step_named_class_defaults_give_no_candidate(self):
        self.lanes.seal_unit('world', 'class:Engine.Mover', {'products': TWIN}, step='class-defaults')
        survey = self.survey('world')
        self.assertEqual((survey.candidates, survey.skipped_file_count_by_rule), ([], {'never-shared-folder': 4}))

    def test_each_ledger_record_name_gives_no_candidate(self):
        for name in LEDGER_RECORD_NAMES:
            self.lanes.write_store_file('actors', f'npc-profiles/{name}', TWIN)
            self.lanes.write_converter_file('actors', name, TWIN)
        self.require_only_rule(self.survey(), 'ledger-record', 8)

    def test_a_unit_file_of_a_lane_that_is_not_named_free_is_no_candidate(self):
        self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        self.assertEqual(self.survey(lane_is_free_of_conversions=False).skipped_file_count_by_rule,
                         {'ledger-record': 3, 'unit-step-of-a-lane-in-use': 1})

    def test_data_ui_and_integration_never_give_a_unit_file(self):
        for lane_name in ('data-ui', 'integration'):
            self.lanes.seal_unit(lane_name, 'table:first', {'table.json': TWIN})
            survey = self.survey(lane_name)
            self.assertEqual((survey.candidates, survey.skipped_file_count_by_rule),
                             ([], {'ledger-record': 3, 'unit-step-of-a-lane-in-use': 1}))

    def test_a_unit_step_with_a_running_marker_gives_no_candidate(self):
        self.lanes.begin_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        self.assertEqual(self.survey().skipped_file_count_by_rule, {'ledger-record': 2, 'unit-step-not-sealed': 1})

    def test_a_sealed_unit_step_that_gained_a_running_marker_gives_no_candidate(self):
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        write_file(step_directory / '.running.json', b'{}')
        self.assertEqual(self.survey().skipped_file_count_by_rule, {'ledger-record': 4, 'unit-step-not-sealed': 1})

    def test_a_seal_that_does_not_name_the_receipt_bytes_gives_no_candidate(self):
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        receipt_path = step_directory / 'receipt.json'
        receipt_path.write_bytes(receipt_path.read_bytes() + b'\n')
        self.assertEqual(self.survey().skipped_file_count_by_rule, {'ledger-record': 3, 'unit-step-not-sealed': 1})

    def test_a_ledger_record_of_another_shape_gives_no_candidate_and_no_error(self):
        receipt_without_output_list = b'{"outputs": "none"}'
        records_by_unit = {
            'mesh__no-seal': {},
            'mesh__seal-is-a-list': {'complete.json': b'[]', 'receipt.json': b'{}'},
            'mesh__seal-is-no-json': {'complete.json': b'\xff', 'receipt.json': b'{}'},
            'mesh__receipt-is-no-json': {'complete.json': json.dumps({'receiptSha256': hashlib.sha256(b'{').hexdigest()}).encode(),
                                         'receipt.json': b'{'},
            'mesh__outputs-is-no-list': {'complete.json': json.dumps({
                'receiptSha256': hashlib.sha256(receipt_without_output_list).hexdigest()}).encode(), 'receipt.json': receipt_without_output_list},
        }
        for unit_folder_name, records in records_by_unit.items():
            self.lanes.write_lane_file('actors', f'work/{unit_folder_name}/model/asset.l2asset', TWIN)
            for name, payload in records.items():
                self.lanes.write_lane_file('actors', f'work/{unit_folder_name}/model/{name}', payload)
        self.assertEqual(self.survey().skipped_file_count_by_rule, {'ledger-record': 8, 'unit-step-not-sealed': 5})

    def test_a_file_of_a_sealed_step_that_its_receipt_does_not_list_is_no_candidate(self):
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        write_file(step_directory / 'log/converter.log', TWIN)
        survey = self.survey()
        self.assertEqual([candidate.relative for candidate in survey.candidates], ['actors/work/mesh__first/model/asset.l2asset'])
        self.assertEqual(survey.skipped_file_count_by_rule, {'ledger-record': 3, 'not-a-receipt-output': 1})

    def test_a_file_below_the_minimum_size_is_no_candidate(self):
        self.assertEqual(MINIMUM_SHARED_FILE_BYTES, 4096)
        self.lanes.write_store_file('actors', 'models/one-byte-short.bin', TWIN[:-1])
        self.lanes.write_store_file('actors', 'models/empty.bin', b'')
        self.lanes.write_converter_file('actors', 'asset.json', TWIN[:-1])
        self.require_only_rule(self.survey(), 'below-4096-bytes', 3)

    def test_a_sealed_output_whose_size_differs_from_its_receipt_is_no_candidate(self):
        step_directory = self.lanes.seal_unit('actors', 'mesh:first', {'asset.l2asset': TWIN})
        (step_directory / 'asset.l2asset').write_bytes(TWIN + b'x')
        self.assertEqual(self.survey().skipped_file_count_by_rule, {'ledger-record': 3, 'differs-from-its-receipt': 1})

    @unittest.skipIf(JUNCTION_FACTORY is None, 'NTFS junctions unavailable')
    def test_no_junction_is_entered(self):
        outside_folder = self.lanes.project / 'outside'
        write_file(outside_folder / 'twin.bin', TWIN)
        self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        junction = self.lanes.lane_folder('actors') / 'l2' / 'junction'
        JUNCTION_FACTORY(str(outside_folder), str(junction))
        self.addCleanup(os.rmdir, junction)
        survey = self.survey()
        self.assertEqual([candidate.relative for candidate in survey.candidates], ['actors/l2/models/twin.bin'])
        self.assertEqual(survey.skipped_file_count_by_rule, {})

    def test_a_file_removed_after_its_folder_was_listed_is_counted_as_changed(self):
        store_path = self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        read_file_status = os.stat

        def remove_then_read_file_status(path, *arguments, **options):
            store_path.unlink(missing_ok=True)
            return read_file_status(path, *arguments, **options)

        with patch.object(lane_sharing_candidates.os, 'stat', remove_then_read_file_status):
            survey = self.survey()
        self.require_only_rule(survey, 'changed-during-the-run', 1)

    def test_a_folder_removed_after_its_parent_was_listed_gives_no_error(self):
        self.lanes.write_store_file('actors', 'models/twin.bin', TWIN)
        textures_folder = self.lanes.write_store_file('actors', 'textures/twin.bin', TWIN).parent
        list_folder = os.scandir

        def remove_the_textures_folder_then_list(folder):
            if Path(folder) == textures_folder:
                with patch.object(lane_sharing_candidates.os, 'scandir', list_folder):
                    shutil.rmtree(folder)
            return list_folder(folder)

        with patch.object(lane_sharing_candidates.os, 'scandir', remove_the_textures_folder_then_list):
            survey = self.survey()
        self.assertFalse(textures_folder.exists())
        self.assertEqual([candidate.relative for candidate in survey.candidates], ['actors/l2/models/twin.bin'])

    def test_every_file_is_a_candidate_or_under_exactly_one_rule(self):
        self.lanes.write_store_file('world', 'catalog.json', TWIN)
        self.lanes.write_store_file('world', 'tiles/twin.bin', TWIN)
        self.lanes.write_store_file('world', 'tiles/twin.bin.tmp', TWIN)
        self.lanes.write_store_file('world', 'tiles/small.bin', b'small')
        self.lanes.write_store_file('world', 'tiles/index/twin.bin', TWIN)
        self.lanes.write_converter_file('world', 'evidence/export/twin.png', TWIN)
        write_file(self.lanes.converter_folder('world') / '.work' / 'job-1' / 'twin.png', TWIN)
        self.lanes.seal_unit('world', 'tile:20_20', {'products/tile.bin': TWIN}, store_files={'tiles/sealed.bin': TWIN})
        self.lanes.begin_unit('world', 'tile:20_21', {'products/tile.bin': TWIN})
        survey = self.survey('world')
        file_count = sum(len(file_names) for _, _, file_names in os.walk(self.lanes.lane_folder('world')))
        self.assertEqual(len(survey.candidates) + sum(survey.skipped_file_count_by_rule.values()), file_count)
        self.assertEqual(survey.skipped_file_count_by_rule, {
            'store-root-file': 1, 'temporary-name': 1, 'below-4096-bytes': 1, 'never-shared-folder': 1, 'outside-the-shared-places': 1,
            'ledger-record': 5, 'unit-step-not-sealed': 1})
        self.assertEqual(len(survey.candidates), 4)

    def test_converter_folders_are_the_lane_and_work_children_that_hold_an_index_folder(self):
        lane_folder = self.lanes.lane_folder('actors')
        for relative in ('converter/index', 'work/static-mesh-converter/index', 'work/mesh__first/index', 'l2/index', 'work/index',
                         'work/no-index/content', 'gap-rows'):
            (lane_folder / relative).mkdir(parents=True)
        write_file(lane_folder / 'work' / 'index-is-a-file' / 'index', b'')
        self.assertEqual(lane_converter_folders(lane_folder), [lane_folder / 'converter', lane_folder / 'work' / 'static-mesh-converter'])


if __name__ == '__main__':
    unittest.main()
