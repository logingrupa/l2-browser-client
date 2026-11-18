from contextlib import contextmanager
from pathlib import Path
from unittest import mock


def payload_with_first_byte_flipped(payload):
    return bytes([payload[0] ^ 0x01]) + payload[1:]


@contextmanager
def rereads_of_files_named_flip_one_byte(file_name):
    original_read_bytes = Path.read_bytes
    read_counts_by_path = {}

    def read_bytes_flipping_rereads(path):
        payload = original_read_bytes(path)
        if path.name != file_name:
            return payload
        resolved_path = path.resolve()
        read_counts_by_path[resolved_path] = read_counts_by_path.get(resolved_path, 0) + 1
        return payload if read_counts_by_path[resolved_path] == 1 else payload_with_first_byte_flipped(payload)

    with mock.patch.object(Path, 'read_bytes', read_bytes_flipping_rereads):
        yield read_counts_by_path
