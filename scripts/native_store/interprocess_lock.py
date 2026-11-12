from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import msvcrt
from pathlib import Path

from native_store.canonical_json import canonical_json_bytes

INTERPROCESS_LOCK_FOLDER_NAME = 'interprocess-locks'
LOCK_FILE_SUFFIX = '.lock'
LOCKFILE_EXCLUSIVE_LOCK = 0x2
LOCKED_BYTE_COUNT = 1
CONVERTER_LOCK_KEY_PREFIX = 'converter:'
held_lock_file_path = None


class InterprocessLockError(RuntimeError):
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


@contextmanager
def interprocess_lock(lock_folder, key):
    global held_lock_file_path
    path = lock_file_path(lock_folder, key)
    if held_lock_file_path is not None:
        raise InterprocessLockError(f'this process holds the lock {held_lock_file_path} and may not take a second lock: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    kernel32 = file_lock_functions()
    with open(path, 'ab') as lock_file:
        handle = msvcrt.get_osfhandle(lock_file.fileno())
        locked_range = OVERLAPPED()
        if not kernel32.LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, 0, LOCKED_BYTE_COUNT, 0, ctypes.byref(locked_range)):
            raise InterprocessLockError(f'LockFileEx failed with Windows error {ctypes.get_last_error()}: {path}')
        held_lock_file_path = path
        try:
            yield
        finally:
            held_lock_file_path = None
            if not kernel32.UnlockFileEx(handle, 0, LOCKED_BYTE_COUNT, 0, ctypes.byref(locked_range)):
                raise InterprocessLockError(f'UnlockFileEx failed with Windows error {ctypes.get_last_error()}: {path}')


def convert_under_request_lock(converter, request):
    converter_folder = Path(converter.output)
    key = '\n'.join([CONVERTER_LOCK_KEY_PREFIX + converter_folder.as_posix(), canonical_json_bytes(request).decode('ascii')])
    with interprocess_lock(lane_lock_folder(converter_folder.parent), key):
        return converter.convert(request)
