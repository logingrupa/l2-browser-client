import ast
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.interprocess_lock import lane_lock_folder
from native_store.store_paths import lane_work_root
from test_world_audio_step import wav_bytes
from world import exact_sound_sources, minimap_step, mover_step, static_mesh_step
from world.exact_sound_sources import ResolvedSound
from world.minimap_join import RADAR_PACKAGE_ROLE
from world.mover_class_defaults import MOVER_CLASS_UNIT_KEY
from world.tile_census import WORLD_LANE_NAME

TILE_ID = '20_20'
LOCK_RECORD = {'eSha256': 'e' * 64}
CLASS_RECEIPT_SHA256 = 'c' * 64
CHUNKS_FINGERPRINT = 'f' * 64
PINNED_MOVER_CLASS_MODULE = 'world.mover_class_defaults'
PINNED_MOVER_CLASS_CALLS = ('mover_class_evidence', 'sealed_mover_class_receipt_sha256')
MOVER_STEP_RELATIVE_PATH = 'scripts/world/mover_step.py'


class StepEndedAfterTheLock(Exception):
    pass


class RecordingLock:
    def __init__(self):
        self.held, self.entered_with, self.left_count = False, [], 0

    @contextmanager
    def interprocess_lock(self, lock_folder, key):
        self.entered_with.append((lock_folder, key))
        self.held = True
        try:
            yield
        finally:
            self.held = False
            self.left_count += 1


class ConverterRequestLockTests(unittest.TestCase):
    def test_a_static_mesh_conversion_goes_through_the_request_lock(self):
        converter = mock.Mock()
        store_files = {'a/asset.l2asset': ('a/asset.l2asset', b'archive'), 'a/model.glb': ('a/model.glb', b'model')}
        record = {'assetId': 'rock', 'source': {'object': 'Rock.Rock_S'}, 'archive': '/l2/a/asset.l2asset', 'archiveSha256': 'a' * 64,
                  'model': '/l2/a/model.glb', 'modelSha256': 'b' * 64}
        with mock.patch.object(static_mesh_step, 'convert_under_request_lock', return_value={'file': 'converted/asset.l2asset'}) as request_lock, \
                mock.patch.object(static_mesh_step, 'converted_model_store_files_and_record', return_value=(store_files, record)) as store_record:
            converted = static_mesh_step.convert_static_mesh(converter, {'package': 'staticmeshes/Rock.usx', 'object': 'Rock.Rock_S', 'reference': 'x'})
        request_lock.assert_called_once_with(converter, {'kind': 'model', 'package': 'staticmeshes/Rock.usx', 'object': 'Rock.Rock_S'})
        store_record.assert_called_once_with(None, Path('converted/asset.l2asset'))
        converter.convert.assert_not_called()
        self.assertEqual((converted.model_record['id'], converted.store_files), ('rock', store_files))

    def test_an_exact_sound_conversion_goes_through_the_request_lock(self):
        converter, audio = mock.Mock(), wav_bytes()
        request = {'kind': 'audio', 'package': 'sounds/AmbSound.uax', 'object': 'AmbSound.Wind.gust'}
        resolved = ResolvedSound('AmbSound.Wind.gust', 'sounds/AmbSound.uax', 'a' * 64, {'object': 'AmbSound.Wind.gust', 'exportIndex': 3}, audio, {})
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / 'asset.l2asset'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                archive.writestr('asset.json', json.dumps({'kind': 'audio', 'source': {'object': 'AmbSound.Wind.gust'}, 'audio': {'file': 'audio.wav'}}))
                archive.writestr('provenance.json', json.dumps({'request': request, 'metadata': {
                    'encodedAudioUnchanged': True, 'nativeExportIndex': 3, 'nativePayloadSha256': hashlib.sha256(audio).hexdigest()}}))
                archive.writestr('audio.wav', audio)
            with mock.patch.object(exact_sound_sources, 'convert_under_request_lock', return_value={'file': str(archive_path)}) as request_lock, \
                    mock.patch.object(exact_sound_sources, 'verify_archive', return_value={'sha256': 'b' * 64}):
                converted = exact_sound_sources.convert_exact_sound(converter, resolved)
        request_lock.assert_called_once_with(converter, request)
        converter.convert.assert_not_called()
        self.assertEqual((converted.wav, converted.archive_sha256), (audio, 'b' * 64))

    def test_a_radar_texture_conversion_goes_through_the_request_lock(self):
        converter = mock.Mock()
        radar_texture = {'object': 'L2_Radar.Radar_20_20', 'rule': 'radar-name'}
        sources = mock.Mock(packages={RADAR_PACKAGE_ROLE: {'packageName': 'L2_Radar'}})
        conversion = {'file': 'converted/asset.l2asset', 'sha256': 'a' * 64}
        radar_record, output = {'archive': '/l2/a/asset.l2asset'}, {'path': 'l2/a/asset.l2asset'}
        with mock.patch.object(minimap_step, 'convert_under_request_lock', return_value=conversion) as request_lock, \
                mock.patch.object(minimap_step, 'join_tile_minimap', return_value={'radarTexture': radar_texture}) as join, \
                mock.patch.object(minimap_step, 'store_converted_radar_texture', return_value=(radar_record, (256, 256), output)) as store:
            minimap = minimap_step.tile_minimap('project', 'client', 'store', TILE_ID, 'frame', sources, converter)
        request_lock.assert_called_once_with(converter, {'kind': 'texture', 'package': 'L2_Radar', 'object': 'L2_Radar.Radar_20_20'})
        store.assert_called_once_with('store', conversion, radar_texture)
        converter.convert.assert_not_called()
        self.assertEqual(minimap, (join.return_value, radar_record, [output], []))


class MoverClassUnitLockTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.lock = RecordingLock()
        self.held_at_each_call = []
        lock_patcher = mock.patch.object(mover_step, 'interprocess_lock', self.lock.interprocess_lock)
        lock_patcher.start()
        self.addCleanup(lock_patcher.stop)
        self.expected_lock = (lane_lock_folder(lane_work_root(self.project_root, WORLD_LANE_NAME)), mover_step.MOVER_CLASS_UNIT_LOCK_KEY)

    def recording(self, name, result=None, error=None):
        def stand_in(*arguments):
            self.held_at_each_call.append((name, self.lock.held))
            if error is not None:
                raise error
            return result

        return stand_in

    def test_the_mover_class_unit_is_read_under_the_lock_of_its_unit_key(self):
        evidence = mock.Mock(receipt_sha256=CLASS_RECEIPT_SHA256)
        with mock.patch.object(mover_step, 'read_tile_map_lock_record', return_value=LOCK_RECORD), mock.patch.object(mover_step, 'MapSources'), \
                mock.patch.object(mover_step, 'mover_class_evidence', self.recording('mover_class_evidence', evidence)), \
                mock.patch.object(mover_step, 'mover_unit', self.recording('mover_unit', error=StepEndedAfterTheLock())):
            with self.assertRaises(StepEndedAfterTheLock):
                mover_step.run_mover_step(self.project_root, self.project_root / 'client', TILE_ID)
        self.assertEqual(mover_step.MOVER_CLASS_UNIT_LOCK_KEY, 'unit:' + MOVER_CLASS_UNIT_KEY)
        self.assertEqual(self.lock.entered_with, [self.expected_lock])
        self.assertEqual(self.held_at_each_call, [('mover_class_evidence', True), ('mover_unit', False)])
        self.assertEqual(self.lock.left_count, 1)

    def test_the_sealed_mover_class_receipt_is_read_under_the_same_lock_and_the_lock_is_left_before_the_chunk_plan_is_read(self):
        chunk_plan = (CHUNKS_FINGERPRINT, None, None)
        with mock.patch.object(mover_step, 'sealed_mover_class_receipt_sha256', self.recording('sealed_mover_class_receipt_sha256', CLASS_RECEIPT_SHA256)), \
                mock.patch.object(mover_step, 'sealed_chunk_plan', self.recording('sealed_chunk_plan', chunk_plan)):
            config = mover_step.sealed_mover_unit_config(self.project_root, TILE_ID, LOCK_RECORD)
            self.assertEqual(config, mover_step.mover_unit_config(CHUNKS_FINGERPRINT, CLASS_RECEIPT_SHA256))
        self.assertEqual(config['classDefaultsReceiptSha256'], CLASS_RECEIPT_SHA256)
        self.assertEqual(self.lock.entered_with, [self.expected_lock])
        self.assertEqual(self.held_at_each_call, [('sealed_mover_class_receipt_sha256', True), ('sealed_chunk_plan', False)])
        self.assertEqual(self.lock.left_count, 1)

    def test_an_unsealed_mover_class_unit_still_answers_none_under_the_lock(self):
        with mock.patch.object(mover_step, 'sealed_mover_class_receipt_sha256', self.recording('sealed_mover_class_receipt_sha256', None)), \
                mock.patch.object(mover_step, 'sealed_chunk_plan', self.recording('sealed_chunk_plan')):
            self.assertIsNone(mover_step.sealed_mover_unit_config(self.project_root, TILE_ID, LOCK_RECORD))
        self.assertEqual(self.lock.entered_with, [self.expected_lock])
        self.assertEqual(self.held_at_each_call, [('sealed_mover_class_receipt_sha256', True)])
        self.assertEqual((self.lock.left_count, self.lock.held), (1, False))


def imports_module(tree, module_name):
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == module_name:
            return True
        if isinstance(node, ast.ImportFrom) and node.module == module_name.rpartition('.')[0] \
                and any(alias.name == module_name.rpartition('.')[2] for alias in node.names):
            return True
        if isinstance(node, ast.Import) and any(alias.name == module_name for alias in node.names):
            return True
    return False


def called_name(node):
    return node.func.id if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) else None


def calls_of(tree, function_name):
    return [node for node in ast.walk(tree) if called_name(node) == function_name]


def calls_inside_with_statements_on(tree, lock_function_name, function_name):
    return [call for node in ast.walk(tree) if isinstance(node, ast.With)
            and [called_name(item.context_expr) for item in node.items] == [lock_function_name]
            for statement in node.body for call in calls_of(statement, function_name)]


class PinnedMoverClassModuleEntryTests(unittest.TestCase):
    def test_only_the_mover_step_module_imports_the_pinned_mover_class_module(self):
        importing_paths = [path.relative_to(ROOT).as_posix() for path in sorted((ROOT / 'scripts').rglob('*.py'))
                           if imports_module(ast.parse(path.read_text(encoding='utf-8')), PINNED_MOVER_CLASS_MODULE)]
        self.assertEqual(importing_paths, [MOVER_STEP_RELATIVE_PATH])
        mover_step_tree = ast.parse((ROOT / MOVER_STEP_RELATIVE_PATH).read_text(encoding='utf-8'))
        for function_name in PINNED_MOVER_CLASS_CALLS:
            calls = calls_of(mover_step_tree, function_name)
            self.assertEqual(len(calls), 1, function_name)
            self.assertEqual(calls_inside_with_statements_on(mover_step_tree, 'mover_class_unit_lock', function_name), calls, function_name)


if __name__ == '__main__':
    unittest.main()
