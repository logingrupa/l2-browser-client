import contextlib
import ctypes
from ctypes import wintypes
import hashlib
import io
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from native_assets import Converter, sha
from native_store import identical_file_sharing, share_identical_lane_files as sharing_command
from native_store.share_identical_lane_files import share_identical_lane_files
from native_store.unit_ledger import UnitLedger
from reference_client_lock_fixture import lock_client_as_reference_root

SHARED_FILE_BYTES = 4096
WAVE_SAMPLE_COUNT = 4000
SOUND_CONVERTER_RELATIVE_FOLDER = 'work/sound-converter'
FIXTURE_HOST = 'DATABASE-PC'
FIXTURE_RIGA_TIME = '2026-11-13T12:00:00+02:00'
FIXTURE_INPUT_SHA256 = 'a' * 64
CONTENT_FOLDER_NAME = 'c' * 64
CONVERTER_RELATIVE_FOLDER = 'work/static-mesh-converter'
SHARING_FOLDER_RELATIVE = 'work/identical-file-sharing'
GENERIC_READ = 0x80000000
OPEN_EXISTING = 3
NO_SHARING = 0


def payload_of(label, byte_count=SHARED_FILE_BYTES):
    seed = label.encode('utf-8')
    return (seed * (byte_count // len(seed) + 1))[:byte_count]


def write_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def replace_by_a_new_file(path, payload):
    new_file = write_file(path.with_name(path.name + '.new'), payload)
    os.replace(new_file, path)


def output_record(lane_folder, path):
    payload = path.read_bytes()
    return {'path': path.relative_to(lane_folder).as_posix(), 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}


def snapshot_of_every_entry(root):
    snapshot = {}
    for folder, folder_names, file_names in os.walk(root):
        for name in folder_names + file_names:
            path = Path(folder) / name
            status = os.stat(path)
            snapshot[path.relative_to(root).as_posix()] = (status.st_size, status.st_nlink, status.st_mtime_ns)
    return snapshot


def is_outside_the_sharing_folders(relative):
    return SHARING_FOLDER_RELATIVE not in relative


def file_bytes_outside_the_sharing_folders(root):
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(Path(root).rglob('*'))
            if path.is_file() and is_outside_the_sharing_folders(path.relative_to(root).as_posix())}


def link_count(path):
    return os.stat(path).st_nlink


def file_number(path):
    return os.stat(path).st_ino


def hold_file_open_without_sharing(test_case, path):
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
                                     wintypes.HANDLE)
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.CreateFileW(str(path), GENERIC_READ, NO_SHARING, None, OPEN_EXISTING, 0, None)
    if handle in (None, wintypes.HANDLE(-1).value):
        raise ctypes.WinError(ctypes.get_last_error())
    test_case.addCleanup(kernel32.CloseHandle, handle)


def synthetic_audio_converter_and_request(test_case, lanes):
    client = lanes.project / 'source'
    client.mkdir()
    lock_client_as_reference_root(test_case, client)
    samples = b''.join(struct.pack('<h', (index * 7919) % 30000 - 15000) for index in range(WAVE_SAMPLE_COUNT))
    wave_header = b'RIFF' + struct.pack('<I', 36 + len(samples)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 8000, 16000, 2, 16)
    (client / 'sample.wav').write_bytes(wave_header + b'data' + struct.pack('<I', len(samples)) + samples)
    tool = lanes.project / 'tool.exe'
    tool.write_bytes(b'not executed by the media adapter')
    pinned_tool = patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes()))
    pinned_tool.start()
    test_case.addCleanup(pinned_tool.stop)
    converter = Converter(client, lanes.lane_folder('actors') / SOUND_CONVERTER_RELATIVE_FOLDER, tool, project_root=lanes.project)
    return converter, {'kind': 'audio', 'media': 'sample.wav'}


def run_sharing_command(*arguments):
    standard_output, standard_error = io.StringIO(), io.StringIO()
    with (patch.object(sharing_command, 'run_at_below_normal_priority') as below_normal_priority,
          contextlib.redirect_stdout(standard_output), contextlib.redirect_stderr(standard_error)):
        exit_code = sharing_command.main([str(argument) for argument in arguments])
    return exit_code, standard_output.getvalue(), standard_error.getvalue(), below_normal_priority.call_count


class SharedLaneFixture:
    def __init__(self, test_case):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.project = Path(temporary_directory.name).resolve() / 'project'
        self.lane_stores_root = self.project / 'artifacts' / 'lane-store'
        self.lane_stores_root.mkdir(parents=True)

    def lane_folder(self, lane_name):
        return self.lane_stores_root / lane_name

    def lane_names(self):
        return sorted(path.name for path in self.lane_stores_root.iterdir())

    def write_lane_file(self, lane_name, relative, payload):
        return write_file(self.lane_folder(lane_name) / relative, payload)

    def write_store_file(self, lane_name, relative, payload):
        return self.write_lane_file(lane_name, 'l2/' + relative, payload)

    def converter_folder(self, lane_name, converter_relative=CONVERTER_RELATIVE_FOLDER):
        folder = self.lane_folder(lane_name) / converter_relative
        (folder / 'index').mkdir(parents=True, exist_ok=True)
        return folder

    def write_converter_file(self, lane_name, relative, payload, content_folder_name=CONTENT_FOLDER_NAME):
        return write_file(self.converter_folder(lane_name) / content_folder_name / relative, payload)

    def ledger(self, lane_name, step='model'):
        return UnitLedger(self.lane_folder(lane_name) / 'work', step, 1, riga_clock=lambda: FIXTURE_RIGA_TIME,
                          free_bytes=lambda path: 1, host=FIXTURE_HOST)

    def begin_unit(self, lane_name, unit_key, products, step='model', config_version=1):
        ledger = self.ledger(lane_name, step)
        config = {'unit': unit_key, 'configVersion': config_version}
        fingerprint = ledger.unit_fingerprint([FIXTURE_INPUT_SHA256], config)
        step_directory = ledger.begin(unit_key, fingerprint)
        for relative, payload in products.items():
            write_file(step_directory / relative, payload)
        return ledger, fingerprint, config, step_directory

    def seal_unit(self, lane_name, unit_key, products, step='model', store_files=None, config_version=1):
        ledger, fingerprint, config, step_directory = self.begin_unit(lane_name, unit_key, products, step, config_version)
        store_paths = [self.write_store_file(lane_name, relative, payload) for relative, payload in (store_files or {}).items()]
        outputs = [output_record(ledger.lane_folder, path) for path in [*(step_directory / relative for relative in products), *store_paths]]
        ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': [{'path': 'maps/input.unr', 'sha256': FIXTURE_INPUT_SHA256}],
                                            'outputs': outputs, 'gapRows': []})
        return step_directory


class SharedLaneTestCase(unittest.TestCase):
    def setUp(self):
        self.lanes = SharedLaneFixture(self)

    def share(self, lane_names=None, plan_only=False, lanes_free_of_conversions=()):
        return share_identical_lane_files(self.lanes.lane_stores_root, self.lanes.lane_names() if lane_names is None else lane_names,
                                          plan_only, lanes_free_of_conversions)

    def share_counting_hashed_files(self, **options):
        with patch.object(identical_file_sharing, 'sha256_of_file_with_identity',
                          wraps=identical_file_sharing.sha256_of_file_with_identity) as hashed:
            report = self.share(**options)
        return report, hashed.call_count
