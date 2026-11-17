import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import stat
import sys

BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
MANIFEST_SCHEMA_VERSION = 1


def lower_process_priority():
    if sys.platform != 'win32':
        return
    kernel32 = ctypes.windll.kernel32
    kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)


def is_reparse_point_or_symlink(status):
    return bool(getattr(status, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT) or stat.S_ISLNK(status.st_mode)


def reject_reparse_ancestors(root):
    for path in (root, *root.parents):
        if is_reparse_point_or_symlink(os.lstat(path)):
            raise ValueError('Reparse point on the reference tree root path: ' + str(path))


def walk_regular_files(root):
    pending_directories = [str(root)]
    while pending_directories:
        directory = pending_directories.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                if is_reparse_point_or_symlink(entry.stat(follow_symlinks=False)) or entry.is_symlink():
                    raise ValueError('Reparse point inside the reference tree: ' + entry.path)
                if entry.is_dir(follow_symlinks=False):
                    pending_directories.append(entry.path)
                elif entry.is_file(follow_symlinks=False):
                    yield Path(entry.path)
                else:
                    raise ValueError('Entry is neither a regular file nor a directory: ' + entry.path)


def manifest_sort_key(row):
    return (row['path'].casefold(), row['path'])


def describe_read_failure(error):
    return f'{type(error).__name__} errno {error.errno}'


def hash_file_row(path, relative_path):
    before = os.lstat(path)
    with open(path, 'rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    after = os.lstat(path)
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        return None
    return {'path': relative_path, 'bytes': before.st_size, 'sha256': digest, 'modifiedNanoseconds': before.st_mtime_ns}


def hash_tree(root):
    root_path = Path(os.path.abspath(root))
    reject_reparse_ancestors(root_path)
    files, unreadable = [], []
    for path in walk_regular_files(root_path):
        relative_path = path.relative_to(root_path).as_posix()
        try:
            row = hash_file_row(path, relative_path)
        except OSError as error:
            unreadable.append({'path': relative_path, 'reason': describe_read_failure(error)})
            continue
        if row is None:
            unreadable.append({'path': relative_path, 'reason': 'ChangedWhileReading'})
        else:
            files.append(row)
    return {
        'schemaVersion': MANIFEST_SCHEMA_VERSION,
        'root': root,
        'host': socket.gethostname().upper(),
        'pythonVersion': platform.python_version(),
        'files': sorted(files, key=manifest_sort_key),
        'unreadable': sorted(unreadable, key=manifest_sort_key),
    }


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def require_tree_root(root):
    if not os.path.isdir(root):
        raise SystemExit('Reference client root is missing or not a directory: ' + root)


def main(arguments):
    if len(arguments) != 1:
        raise SystemExit('Usage: hash_reference_client_tree.py <client root>')
    root = arguments[0]
    require_tree_root(root)
    lower_process_priority()
    try:
        manifest = hash_tree(root)
    except ValueError as error:
        raise SystemExit(f'Reference client tree {root} rejected: {error}')
    if not manifest['files'] and not manifest['unreadable']:
        raise SystemExit('Reference client root contains no regular files: ' + root)
    sys.stdout.buffer.write(canonical_json_bytes(manifest))


if __name__ == '__main__':
    main(sys.argv[1:])
