import hashlib
from pathlib import Path

from native_store.catalog_writer import add_store_file
from native_store.store_file_publish import publish_store_files
from support.item_unit_worker_runs import wait_until_path_exists

SYNTHETIC_STORE_FILE_NAME = 'asset.bin'
SYNTHETIC_PAYLOAD_REPEAT_COUNT = 64


def synthetic_store_files(file_count):
    files = {}
    for file_number in range(file_count):
        payload = f'synthetic store file {file_number}\n'.encode('ascii') * SYNTHETIC_PAYLOAD_REPEAT_COUNT
        add_store_file(files, f'{hashlib.sha256(payload).hexdigest()}/{SYNTHETIC_STORE_FILE_NAME}', payload)
    return files


def publish_at_the_start_signal(store_root, file_count, ready_path, start_signal_path):
    files = synthetic_store_files(int(file_count))
    Path(ready_path).write_bytes(b'')
    wait_until_path_exists(Path(start_signal_path))
    publish_store_files(Path(store_root), files)
