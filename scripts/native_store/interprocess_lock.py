from contextlib import contextmanager, nullcontext
import ctypes
from ctypes import wintypes
import hashlib
import msvcrt
from pathlib import Path

from native_store.canonical_json import canonical_json_bytes

INTERPROCESS_LOCK_FOLDER_NAME = 'interprocess-locks'
LOCK_FILE_SUFFIX = '.lock'
LOCKFILE_SHARED_LOCK = 0x0
LOCKFILE_FAIL_IMMEDIATELY = 0x1
LOCKFILE_EXCLUSIVE_LOCK = 0x2
LOCK_VIOLATION_WINDOWS_ERROR = 33
LOCKED_BYTE_COUNT = 1
WAITING_LOCK_PART_OFFSET = 0
CONVERTER_LOCK_KEY_PREFIX = 'converter:'
STORE_LOCK_KEY_PREFIX = 'store:'
LANE_LOCK_KEY = 'lane'
LANE_ONE_BATCH_PART_OFFSET = 0
LANE_IN_USE_PART_OFFSET = 1
ANOTHER_LANE_RUN_HOLDER = 'another batch, conversion or sharing run'
LANE_CONVERSION_PROCESS_HOLDER = 'a conversion process, which may be a worker left by a stopped batch'
ARTIFACTS_FOLDER_NAME = 'artifacts'
LANE_STORES_FOLDER_NAME = 'lane-store'
LANE_STORE_FOLDER_NAME = 'l2'
LANE_WORK_FOLDER_NAME = 'work'
held_lock_file_path = None
lane_lock_files_held_until_process_end = []


class InterprocessLockError(RuntimeError):
    pass


class LaneInUseError(InterprocessLockError):
    pass


class OVERLAPPED(ctypes.Structure):
    _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t), ('Offset', wintypes.DWORD), ('OffsetHigh', wintypes.DWORD),
                ('hEvent', wintypes.HANDLE)]


def lane_lock_folder(lane_work_root):
    return Path(lane_work_root) / INTERPROCESS_LOCK_FOLDER_NAME


def lock_file_path(lock_folder, key):
    return Path(lock_folder) / (hashlib.sha256(key.encode('utf-8')).hexdigest() + LOCK_FILE_SUFFIX)


def file_lock_functions():
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.LockFileEx.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(OVERLAPPED))
    kernel32.LockFileEx.restype = wintypes.BOOL
    kernel32.UnlockFileEx.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(OVERLAPPED))
    kernel32.UnlockFileEx.restype = wintypes.BOOL
    return kernel32


def lock_file_part(lock_file, part_offset, lock_flags):
    locked_range = OVERLAPPED(Offset=part_offset)
    if file_lock_functions().LockFileEx(msvcrt.get_osfhandle(lock_file.fileno()), lock_flags, 0, LOCKED_BYTE_COUNT, 0,
                                        ctypes.byref(locked_range)):
        return True
    windows_error = ctypes.get_last_error()
    if lock_flags & LOCKFILE_FAIL_IMMEDIATELY and windows_error == LOCK_VIOLATION_WINDOWS_ERROR:
        return False
    raise InterprocessLockError(f'LockFileEx failed with Windows error {windows_error}: {lock_file.name}')


def unlock_file_part(lock_file, part_offset):
    locked_range = OVERLAPPED(Offset=part_offset)
    if not file_lock_functions().UnlockFileEx(msvcrt.get_osfhandle(lock_file.fileno()), 0, LOCKED_BYTE_COUNT, 0, ctypes.byref(locked_range)):
        raise InterprocessLockError(f'UnlockFileEx failed with Windows error {ctypes.get_last_error()}: {lock_file.name}')


@contextmanager
def interprocess_lock(lock_folder, key):
    global held_lock_file_path
    path = lock_file_path(lock_folder, key)
    if held_lock_file_path is not None:
        raise InterprocessLockError(f'this process holds the lock {held_lock_file_path} and may not take a second lock: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'ab') as lock_file:
        lock_file_part(lock_file, WAITING_LOCK_PART_OFFSET, LOCKFILE_EXCLUSIVE_LOCK)
        held_lock_file_path = path
        try:
            yield
        finally:
            held_lock_file_path = None
            unlock_file_part(lock_file, WAITING_LOCK_PART_OFFSET)


def lane_lock_file_path(lane_work_root):
    return lock_file_path(lane_lock_folder(lane_work_root), LANE_LOCK_KEY)


def open_lane_lock_file(lane_work_root):
    path = lane_lock_file_path(lane_work_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    return open(path, 'ab')


def require_lane_lock_part(lane_work_root, lock_file, part_offset, lock_flags, holder):
    if not lock_file_part(lock_file, part_offset, lock_flags | LOCKFILE_FAIL_IMMEDIATELY):
        raise LaneInUseError(f'lane {Path(lane_work_root).parent.name} is in use by {holder} and this run does not wait for it: '
                             f'{lock_file.name}')


class HeldLaneLock:
    def __init__(self, lane_work_root, lock_file):
        self.lane_work_root, self.lock_file, self.held_part_offsets = lane_work_root, lock_file, []

    def hold_part(self, part_offset, lock_flags, holder):
        require_lane_lock_part(self.lane_work_root, self.lock_file, part_offset, lock_flags, holder)
        self.held_part_offsets.append(part_offset)

    def release_part(self, part_offset):
        self.held_part_offsets.remove(part_offset)
        unlock_file_part(self.lock_file, part_offset)

    def hold_the_lane_in_use_part_exclusively(self):
        self.release_part(LANE_IN_USE_PART_OFFSET)
        self.hold_part(LANE_IN_USE_PART_OFFSET, LOCKFILE_EXCLUSIVE_LOCK, LANE_CONVERSION_PROCESS_HOLDER)

    def release_held_parts(self):
        for part_offset in reversed(list(self.held_part_offsets)):
            self.release_part(part_offset)


@contextmanager
def lane_lock_with_in_use_part(lane_work_root, in_use_part_lock_flags, in_use_part_holder):
    with open_lane_lock_file(lane_work_root) as lock_file:
        held_lane_lock = HeldLaneLock(lane_work_root, lock_file)
        try:
            held_lane_lock.hold_part(LANE_ONE_BATCH_PART_OFFSET, LOCKFILE_EXCLUSIVE_LOCK, ANOTHER_LANE_RUN_HOLDER)
            held_lane_lock.hold_part(LANE_IN_USE_PART_OFFSET, in_use_part_lock_flags, in_use_part_holder)
            yield held_lane_lock
        finally:
            held_lane_lock.release_held_parts()


def lane_batch_lock(lane_work_root):
    return lane_lock_with_in_use_part(lane_work_root, LOCKFILE_SHARED_LOCK, ANOTHER_LANE_RUN_HOLDER)


def lane_sharing_lock(lane_work_root):
    return lane_lock_with_in_use_part(lane_work_root, LOCKFILE_EXCLUSIVE_LOCK, LANE_CONVERSION_PROCESS_HOLDER)


def hold_lane_in_use_part_until_process_end(lane_work_root):
    lock_file = open_lane_lock_file(lane_work_root)
    try:
        require_lane_lock_part(lane_work_root, lock_file, LANE_IN_USE_PART_OFFSET, LOCKFILE_SHARED_LOCK, ANOTHER_LANE_RUN_HOLDER)
    except InterprocessLockError:
        lock_file.close()
        raise
    lane_lock_files_held_until_process_end.append(lock_file)


def convert_under_request_lock(converter, request):
    converter_folder = Path(converter.output)
    key = '\n'.join([CONVERTER_LOCK_KEY_PREFIX + converter_folder.as_posix(), canonical_json_bytes(request).decode('ascii')])
    with interprocess_lock(lane_lock_folder(converter_folder.parent), key):
        return converter.convert(request)


def is_lane_store_root(store_root):
    return (len(store_root.parts) > 4 and store_root.name == LANE_STORE_FOLDER_NAME and store_root.parents[1].name == LANE_STORES_FOLDER_NAME
            and store_root.parents[2].name == ARTIFACTS_FOLDER_NAME)


def lane_store_publish_lock(store_root):
    store_root = Path(store_root)
    if not is_lane_store_root(store_root):
        return nullcontext()
    return interprocess_lock(lane_lock_folder(store_root.parent / LANE_WORK_FOLDER_NAME), STORE_LOCK_KEY_PREFIX + store_root.as_posix())
