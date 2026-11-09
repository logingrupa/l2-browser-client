import hashlib
from pathlib import Path
import struct

from native_catalog.ue2 import FormatError

ROOT = Path(__file__).resolve().parent.parent
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
ENGINE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value:
        raise FormatError(message)


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def difference(a, b):
    return [a[i]-b[i] for i in range(3)]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def write_unchanged_or_new(output, files):
    output = Path(output)
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        current = {p.name for p in output.iterdir()}
        require(not current or current == set(files), 'Output has unexpected or incomplete files')
        if current:
            require(all((output/name).is_file() and (output/name).read_bytes() == data for name, data in files.items()),
                    'Existing output differs; select a fresh scratch directory')
            return 'unchanged'
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        with (output/name).open('xb') as stream:
            stream.write(data)
    return 'created'
