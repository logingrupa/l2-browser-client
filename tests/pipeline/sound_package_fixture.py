import io
import struct
import wave

from ue2_package_fixture import compact, package_bytes, tag


def wav_bytes(with_smpl=True):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(struct.pack('<4h', -32768, -100, 100, 32767))
    data = stream.getvalue()
    if with_smpl:
        preserved_ancillary_smpl_chunk = b'smpl' + struct.pack('<I', 36) + bytes(range(36))
        data += preserved_ancillary_smpl_chunk
        data = data[:4] + struct.pack('<I', len(data)-8) + data[8:]
    return data


def sound_package(payload=None, duplicate=False, wrong_class=False, bad_boundary=False):
    payload = wav_bytes() if payload is None else payload
    def body(offset, names):
        props = tag(names, 'UnknownSoundProperty', 11, b'\xaa\xbb\xcc') + compact(names['None'])
        prefix = props + compact(names['WAV'])
        size = len(prefix) + 4 + len(compact(len(payload))) + len(payload)
        return prefix + struct.pack('<i', offset + size + int(bad_boundary)) + compact(len(payload)) + payload
    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Sound'),
               ('Core', 'Package', 0, 'Core'), ('Core', 'Class', -3, 'Package'), ('Core', 'Class', -1, 'Texture')]
    sound = {'name': 'wind_loop', 'class': -5 if wrong_class else -2, 'outer': 1, 'body': body}
    return package_bytes(['WAV', 'UnknownSoundProperty'], imports,
                         [{'name': 'Default', 'class': -4, 'body': lambda offset, names: b''}, sound, *([sound] if duplicate else [])])
