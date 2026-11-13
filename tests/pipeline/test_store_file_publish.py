import ast
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store import catalog_writer, store_file_publish
from native_store import interprocess_lock as interprocess_lock_module
from native_store.catalog_writer import STORE_CATALOG_NAME, CatalogWriteError, write_store
from native_store.interprocess_lock import STORE_LOCK_KEY_PREFIX, InterprocessLockError, interprocess_lock, lane_lock_folder, lock_file_path
from native_store.store_file_publish import publish_store_files
from native_store.store_paths import StorePathError, lane_store_root, lane_work_root
from support.item_unit_worker_runs import wait_until_path_exists
from support.store_file_publish_programs import synthetic_store_files
from synthetic_class_scripts import scratch_work_root
from test_material_program_images import synthetic_png_bytes
from world import bsp_step, material_texture_images, minimap_step, static_mesh_step, tile_json_resource
from world.static_mesh_step import ConvertedStaticMesh

STORE_FILE_PUBLISH_PROGRAM = '\n'.join([
    'import sys',
    'sys.path[:0] = sys.argv[1:3]',
    'from support.store_file_publish_programs import publish_at_the_start_signal',
    'publish_at_the_start_signal(*sys.argv[3:])',
])
STORE_FILE_PUBLISH_TIMEOUT_SECONDS = 120
PUBLISHING_PROCESS_NAMES = ('first', 'second')
FILE_COUNT_OF_THE_TWO_PROCESS_PUBLISH = 600
OTHER_WRITER_PAYLOAD = b'bytes of another writer'
CATALOG_BYTES = b'{"schemaVersion": 1, "models": []}'
WORLD_MODULES_THAT_PUBLISH_STORE_FILES = {'bsp_step', 'material_texture_images', 'minimap_step', 'static_mesh_step', 'tile_json_resource'}
WORLD_MODULE_THAT_WRITES_A_PRIVATE_ASSET_FOLDER = 'typed_payload'


def world_modules_naming(name):
    modules = set()
    for path in sorted((ROOT / 'scripts' / 'world').glob('*.py')):
        nodes = list(ast.walk(ast.parse(path.read_text(encoding='utf-8'))))
        names = {node.id for node in nodes if isinstance(node, ast.Name)} | {node.name for node in nodes if isinstance(node, ast.alias)}
        if name in names:
            modules.add(path.stem)
    return modules


class StoreLockRecordingTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.store_root = lane_store_root(self.project_root, 'world')
        self.store_root.mkdir(parents=True)
        self.store_lock_file_path = lock_file_path(lane_lock_folder(lane_work_root(self.project_root, 'world')),
                                                   STORE_LOCK_KEY_PREFIX + self.store_root.as_posix())
        self.locks_held_at_each_call = []
        self.record_the_held_lock_at_each_call(catalog_writer, 'immutable_write')

    def record_the_held_lock_at_each_call(self, owner, function_name):
        function = getattr(owner, function_name)

        def recorded_call(*arguments):
            self.locks_held_at_each_call.append((function_name, interprocess_lock_module.held_lock_file_path))
            return function(*arguments)

        patcher = mock.patch.object(owner, function_name, recorded_call)
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_every_call_held_the_store_lock(self, function_names, store_lock_file_path=None):
        expected_lock_file_path = store_lock_file_path or self.store_lock_file_path
        self.assertEqual(self.locks_held_at_each_call, [(function_name, expected_lock_file_path) for function_name in function_names])
        self.assertTrue(expected_lock_file_path.is_file())
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)

    def published_relative_paths(self, store_root=None):
        root = store_root or self.store_root
        return sorted(path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file())


class StoreFilePublishTests(StoreLockRecordingTestCase):
    def test_every_file_is_verified_and_written_under_the_lock_of_its_store_root(self):
        self.record_the_held_lock_at_each_call(store_file_publish, 'verify_store_destinations')
        files = synthetic_store_files(3)
        publish_store_files(self.store_root, files)
        self.assert_every_call_held_the_store_lock(['verify_store_destinations', *['immutable_write'] * 3])
        self.assertEqual(self.published_relative_paths(), sorted(relative for relative, _ in files.values()))
        for relative, payload in files.values():
            self.assertEqual((self.store_root / relative).read_bytes(), payload)

    def test_a_differing_existing_file_is_refused_before_any_file_is_written(self):
        files = synthetic_store_files(2)
        new_file, existing_file = (relative for relative, _ in files.values())
        (self.store_root / existing_file).parent.mkdir()
        (self.store_root / existing_file).write_bytes(OTHER_WRITER_PAYLOAD)
        with self.assertRaisesRegex(CatalogWriteError, '^Existing immutable store file differs; preserved: '):
            publish_store_files(self.store_root, files)
        self.assertEqual(self.published_relative_paths(), [existing_file])
        self.assertEqual((self.store_root / existing_file).read_bytes(), OTHER_WRITER_PAYLOAD)
        self.assertFalse((self.store_root / new_file).parent.exists())
        self.assert_every_call_held_the_store_lock([])

    def test_a_path_that_leaves_the_store_root_is_refused_as_a_store_path_error_and_the_lock_is_left(self):
        with self.assertRaises(StorePathError) as refusal:
            publish_store_files(self.store_root, {'outside': ('../outside.bin', OTHER_WRITER_PAYLOAD)})
        self.assertEqual(str(refusal.exception), 'Unsafe relative path: ../outside.bin')
        self.assertFalse((self.store_root.parent / 'outside.bin').exists())
        self.assert_every_call_held_the_store_lock([])

    def test_write_store_verifies_writes_and_replaces_the_catalog_under_the_same_lock(self):
        for function_name in ('verify_store_destinations', 'replace_file'):
            self.record_the_held_lock_at_each_call(catalog_writer, function_name)
        files = synthetic_store_files(2)
        written = write_store(self.store_root, files, None, CATALOG_BYTES)
        self.assert_every_call_held_the_store_lock(['verify_store_destinations', 'immutable_write', 'immutable_write', 'replace_file'])
        self.assertEqual(written, {'filesWritten': 3, 'catalogSha256': hashlib.sha256(CATALOG_BYTES).hexdigest()})
        self.assertEqual(self.published_relative_paths(), sorted([STORE_CATALOG_NAME, *(relative for relative, _ in files.values())]))

    def test_a_process_that_holds_another_lock_is_refused_the_store_lock(self):
        with interprocess_lock(lane_lock_folder(lane_work_root(self.project_root, 'world')), 'unit:other'):
            with self.assertRaises(InterprocessLockError):
                publish_store_files(self.store_root, synthetic_store_files(1))
        self.assertEqual((self.locks_held_at_each_call, self.published_relative_paths()), ([], []))


class StoreOutsideALaneTests(unittest.TestCase):
    def test_a_store_root_that_is_no_lane_store_is_written_without_a_lock_file_and_nothing_is_created_beside_it(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        project_root = Path(temporary_directory.name).resolve() / 'project'
        served_store_root = project_root / 'public' / 'l2'
        served_store_root.mkdir(parents=True)
        files = synthetic_store_files(2)
        self.assertEqual(write_store(served_store_root, files, None, CATALOG_BYTES)['filesWritten'], 3)
        publish_store_files(served_store_root, files)
        self.assertEqual(sorted(path.relative_to(project_root).as_posix() for path in project_root.rglob('*') if path.is_file()),
                         sorted(f'public/l2/{relative}' for relative in [STORE_CATALOG_NAME, *(relative for relative, _ in files.values())]))
        self.assertEqual([path.name for path in served_store_root.parent.iterdir()], [served_store_root.name])
        self.assertIsNone(interprocess_lock_module.held_lock_file_path)


class WorldStepStorePublishTests(StoreLockRecordingTestCase):
    def test_static_mesh_store_files_are_published_under_the_store_lock(self):
        store_files = synthetic_store_files(2)
        mesh_outcomes = {'Rock.Rock_S': ConvertedStaticMesh({'id': 'rock'}, store_files), 'Rock.Rock_L': ('gap', 'not converted')}
        outputs = static_mesh_step.write_static_mesh_store_files(self.project_root, {'models': [{'id': 'rock'}]}, mesh_outcomes)
        self.assert_every_call_held_the_store_lock(['immutable_write'] * 2)
        self.assertEqual([output['path'] for output in outputs], [f'l2/{relative}' for relative in self.published_relative_paths()])

    def test_chunk_bsp_glbs_are_published_under_the_store_lock(self):
        outputs = bsp_step.write_chunk_glbs(self.project_root, {'chunk-0-0': b'first synthetic glb', 'chunk-1-0': b'second synthetic glb'})
        self.assert_every_call_held_the_store_lock(['immutable_write'] * 2)
        self.assertEqual([output['path'] for output in outputs], [f'l2/{relative}' for relative in self.published_relative_paths()])

    def test_a_converted_radar_texture_is_published_under_the_store_lock(self):
        archive, converted_folder = b'synthetic radar texture archive', self.project_root / 'converted'
        converted_folder.mkdir()
        (converted_folder / minimap_step.TEXTURE_ARCHIVE_NAME).write_bytes(archive)
        (converted_folder / minimap_step.TEXTURE_IMAGE_NAME).write_bytes(synthetic_png_bytes())
        conversion = {'file': str(converted_folder / minimap_step.TEXTURE_ARCHIVE_NAME), 'sha256': hashlib.sha256(archive).hexdigest()}
        _, _, output = minimap_step.store_converted_radar_texture(self.store_root, conversion, {'object': 'L2_Radar.Radar_20_20', 'rule': 'radar-name'})
        self.assert_every_call_held_the_store_lock(['immutable_write'])
        self.assertEqual(self.published_relative_paths(), [output['path'].removeprefix('l2/')])

    def test_a_tile_json_resource_is_published_under_the_store_lock(self):
        _, output = tile_json_resource.write_tile_json_resource(self.store_root, 'tile-movers', 'movers.json', {'tileId': '00_00'})
        self.assert_every_call_held_the_store_lock(['immutable_write'])
        self.assertEqual(self.published_relative_paths(), [output['path'].removeprefix('l2/')])

    def test_a_tile_resource_bundle_is_published_under_the_store_lock(self):
        files = {tile_json_resource.BUNDLE_MANIFEST_NAME: b'{"kind": "synthetic bundle"}', 'sky.glb': b'synthetic bundle member'}
        _, outputs = tile_json_resource.write_tile_resource_bundle(self.store_root, 'skies', files)
        self.assert_every_call_held_the_store_lock(['immutable_write'] * 2)
        self.assertEqual(self.published_relative_paths(), [output['path'].removeprefix('l2/') for output in outputs])

    def test_material_texture_images_are_published_under_the_store_lock(self):
        store_root = lane_store_root(scratch_work_root(self, 'store-file-publish-'), 'world')
        records = material_texture_images.write_material_texture_images(store_root, {'SyntheticMaterials.SkyTexture': synthetic_png_bytes()})
        self.assert_every_call_held_the_store_lock(
            ['immutable_write'], lock_file_path(lane_lock_folder(store_root.parent / 'work'), STORE_LOCK_KEY_PREFIX + store_root.as_posix()))
        self.assertEqual(self.published_relative_paths(store_root), [record['path'] for record in records])

    def test_no_world_step_module_writes_a_shared_store_file_without_the_owner(self):
        self.assertEqual(world_modules_naming('publish_store_files'), WORLD_MODULES_THAT_PUBLISH_STORE_FILES)
        self.assertEqual(world_modules_naming('immutable_write'), {WORLD_MODULE_THAT_WRITES_A_PRIVATE_ASSET_FOLDER})
        self.assertEqual(world_modules_naming('verify_store_destinations'), set())


class TwoProcessStorePublishTests(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.store_root = lane_store_root(self.temporary_root / 'project', 'world')
        self.store_root.mkdir(parents=True)
        lane_work_root(self.temporary_root / 'project', 'world').mkdir()
        self.start_signal_path = self.temporary_root / 'start-signal'

    def start_publishing_process(self, process_name):
        command = [sys.executable, '-B', '-c', STORE_FILE_PUBLISH_PROGRAM, str(ROOT / 'scripts'), str(ROOT / 'tests' / 'pipeline'),
                   str(self.store_root), str(FILE_COUNT_OF_THE_TWO_PROCESS_PUBLISH), str(self.ready_path(process_name)), str(self.start_signal_path)]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.end_publishing_process, process)
        return process

    def end_publishing_process(self, process):
        if process.poll() is None:
            process.kill()
        process.communicate()

    def ready_path(self, process_name):
        return self.temporary_root / f'{process_name}.ready'

    def test_two_processes_that_publish_the_same_new_files_at_the_same_time_are_both_accepted(self):
        processes = [self.start_publishing_process(process_name) for process_name in PUBLISHING_PROCESS_NAMES]
        for process_name in PUBLISHING_PROCESS_NAMES:
            wait_until_path_exists(self.ready_path(process_name))
        self.start_signal_path.write_bytes(b'')
        refusals = [process.communicate(timeout=STORE_FILE_PUBLISH_TIMEOUT_SECONDS)[1] for process in processes]
        self.assertEqual(([process.returncode for process in processes], refusals), ([0, 0], ['', '']))
        files = synthetic_store_files(FILE_COUNT_OF_THE_TWO_PROCESS_PUBLISH)
        published = sorted(path.relative_to(self.store_root).as_posix() for path in self.store_root.rglob('*') if path.is_file())
        self.assertEqual(len(files), FILE_COUNT_OF_THE_TWO_PROCESS_PUBLISH)
        self.assertEqual(published, sorted(relative for relative, _ in files.values()))
        for relative, payload in files.values():
            self.assertEqual((self.store_root / relative).read_bytes(), payload)


if __name__ == '__main__':
    unittest.main()
