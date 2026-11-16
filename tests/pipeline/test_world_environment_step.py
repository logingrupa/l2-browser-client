import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.catalog_writer import CatalogWriteError, read_store_catalog, validate_catalog_record
from native_store.pinned_store_verification import verify_pinned_store_files
from support.environment_source_files import SETUP_FILE_TEXT, encoded_environment_file
from world import environment_step
from world.environment_step import ENVIRONMENT_INPUT_PATHS, EnvironmentStepError, current_environment, run_environment_step
from world.tile_census import WORLD_LANE_NAME

CLIENT_ROOT = Path('E:/Lineage2-client')
TIME_ENVIRONMENT_FILE_TEXT = '[SkyBoxColor]\r\nNUM=2\r\nCOLOR1=(T=0,R=40,G=49,B=70)\r\nCOLOR2=(T=12,R=66,G=124,B=176)\r\n'


def source_text_of(relative_path):
    return SETUP_FILE_TEXT if relative_path.endswith('/Env.int') else TIME_ENVIRONMENT_FILE_TEXT


class SyntheticClient:
    def __init__(self, folder):
        self.folder, self.locked_sha256s = folder, {}
        for relative_path in ENVIRONMENT_INPUT_PATHS:
            payload = encoded_environment_file(source_text_of(relative_path))
            path = folder / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            self.locked_sha256s[relative_path] = hashlib.sha256(payload).hexdigest()

    def require_equal_file_with_sha256(self, relative_path):
        return self.folder / relative_path, self.locked_sha256s[relative_path]

    def locked_input_records(self, relative_paths):
        return sorted(({'path': path, 'sha256': self.locked_sha256s[path]} for path in relative_paths), key=lambda record: record['path'])


class WorldEnvironmentStepTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name) / 'project'
        self.store_root = self.project_root / 'artifacts' / 'lane-store' / WORLD_LANE_NAME / 'l2'
        self.store_root.mkdir(parents=True)
        self.client = SyntheticClient(Path(temporary_directory.name) / 'client')
        for patcher in (mock.patch.object(environment_step, 'require_reference_client', return_value=self.client),
                        mock.patch.object(environment_step, 'locked_input_records', side_effect=self.client.locked_input_records)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def environment_record(self):
        catalog, _ = read_store_catalog(self.store_root)
        return catalog, catalog['environments']

    def test_the_step_stages_the_time_tables_under_a_catalog_record_whose_manifest_pins_every_staged_file(self):
        result = run_environment_step(self.project_root, CLIENT_ROOT)
        catalog, records = self.environment_record()
        self.assertEqual((result['status'], len(records), records[0]['id']), ('converted', 1, 'interlude'))
        record = records[0]
        manifest_path = self.store_root / record['manifest'].removeprefix('/l2/')
        self.assertEqual(manifest_path.parent.name, record['manifestSha256'])
        self.assertEqual(hashlib.sha256(manifest_path.read_bytes()).hexdigest(), record['manifestSha256'])
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        self.assertEqual((manifest['kind'], manifest['tables']['file']), ('native-environment-browser-source', 'time-tables.json'))
        verified = verify_pinned_store_files(self.store_root, catalog, 1)
        self.assertEqual(sorted(file.relative.rsplit('/', 1)[1] for file in verified.values()),
                         ['conversion-manifest.json', 'manifest.json', 'time-tables.json'])
        tables = json.loads((manifest_path.parent / 'time-tables.json').read_text(encoding='utf-8'))
        self.assertEqual((tables['kind'], result['tables'], result['rows']), ('native-environment-time-tables', tables['tableCount'], tables['rowCount']))
        self.assertEqual(current_environment(self.project_root).product['record'], record)

    def test_a_rerun_with_unchanged_sources_answers_from_the_seal_and_writes_nothing(self):
        first = run_environment_step(self.project_root, CLIENT_ROOT)
        catalog_bytes = (self.store_root / 'catalog.json').read_bytes()
        rerun = run_environment_step(self.project_root, CLIENT_ROOT, stage_environment=mock.Mock(side_effect=AssertionError('staged twice')))
        self.assertEqual((rerun['status'], rerun['record']), ('sealed', first['record']))
        self.assertEqual((self.store_root / 'catalog.json').read_bytes(), catalog_bytes)

    def test_a_source_whose_bytes_differ_from_its_lock_is_refused_before_anything_is_staged(self):
        self.client.locked_sha256s['system/timeenv2.int'] = '0' * 64
        with self.assertRaisesRegex(EnvironmentStepError, 'system/timeenv2.int changed while it was read'):
            run_environment_step(self.project_root, CLIENT_ROOT)
        self.assertFalse((self.store_root / 'environments').exists())

    def test_a_stage_receipt_whose_folder_is_not_its_browser_manifest_hash_is_refused(self):
        def misplaced_stage(export_folder, staged_folder):
            receipt = environment_step.stage_environment_with_node(export_folder, staged_folder)
            return {**receipt, 'browserManifestSha256': '1' * 64}
        with self.assertRaisesRegex(EnvironmentStepError, 'is not its browser manifest SHA-256'):
            run_environment_step(self.project_root, CLIENT_ROOT, stage_environment=misplaced_stage)

    def test_the_catalog_refuses_an_environment_record_outside_its_manifest_hash_folder(self):
        with self.assertRaisesRegex(CatalogWriteError, 'differs from its pin'):
            validate_catalog_record('environments', {'id': 'interlude', 'manifest': f'/l2/environments/{"a" * 64}/manifest.json',
                                                     'manifestSha256': 'b' * 64, 'manifestBytes': 10})
        with self.assertRaisesRegex(CatalogWriteError, 'id must match'):
            validate_catalog_record('environments', {'id': 'other', 'manifest': f'/l2/environments/{"a" * 64}/manifest.json',
                                                     'manifestSha256': 'a' * 64, 'manifestBytes': 10})

    def test_the_command_guards_the_parsed_client_and_reports_a_failure_as_json(self):
        guard = mock.Mock(side_effect=ValueError('reference client lock refused'))
        with mock.patch.multiple(environment_step, require_reference_client=guard, run_at_below_normal_priority=mock.DEFAULT), \
                mock.patch('builtins.print') as printed:
            exit_code = environment_step.main(['--client', 'client'])
        self.assertEqual(exit_code, 1)
        self.assertEqual(guard.call_args_list, [mock.call(Path('client'))])
        self.assertEqual(json.loads(printed.call_args.args[0])['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
