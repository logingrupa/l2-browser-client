"""Decode the native client's L2SD Ogg signature without changing encoded audio.

The four-byte capture signature is restored and the validated native footer
is removed. Encoded Vorbis packets remain unchanged. Every Ogg page CRC, stream
serial, sequence, Vorbis identification header and final granule is validated.
WAV output preserves the complete original file and inventories every top-level
RIFF chunk, including ancillary metadata after PCM data. Chunk framing is checked;
ancillary payloads are not interpreted as native playback policy. An unfamiliar
wrapper fails explicitly; input files are never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import wave
import zlib


def _crc_table() -> tuple[int, ...]:
    table = []
    for value in range(256):
        value <<= 24
        for _ in range(8):
            value = ((value << 1) ^ (0x04C11DB7 if value & 0x80000000 else 0)) & 0xFFFFFFFF
        table.append(value)
    return tuple(table)


CRC_TABLE = _crc_table()


def ogg_crc(data: bytes | bytearray) -> int:
    value = 0
    for byte in data:
        value = ((value << 8) & 0xFFFFFFFF) ^ CRC_TABLE[((value >> 24) ^ byte) & 255]
    return value


def decode_ogg(original: bytes) -> tuple[bytes, dict]:
    if original[:4] not in (b"OggS", b"L2SD"):
        raise ValueError("Unsupported audio container; expected OggS or the native L2SD signature.")
    data = b"OggS" + original[4:]
    offset = 0
    pages = 0
    serial = None
    sample_rate = channels = last_granule = None
    ended = False
    trailer = b""
    while offset < len(data):
        if ended and len(data) - offset == 20:
            trailer = original[offset:]
            expected = struct.unpack_from("<I", trailer, 12)[0]
            if trailer[:4] != b"\0" * 4 or trailer[-4:] != b"\0" * 4 or zlib.crc32(original[:offset]) != expected:
                raise ValueError("Invalid native audio footer/checksum.")
            data = data[:offset]
            break
        if len(data) - offset < 27 or data[offset:offset + 4] != b"OggS" or data[offset + 4] != 0:
            raise ValueError(f"Invalid Ogg page header at byte {offset}.")
        if ended:
            raise ValueError("Chained Ogg streams require a separate adapter.")
        flags = data[offset + 5]
        granule, current_serial, sequence, expected_crc = struct.unpack_from("<QIII", data, offset + 6)
        segment_count = data[offset + 26]
        body = offset + 27 + segment_count
        if body > len(data):
            raise ValueError("Truncated Ogg lacing table.")
        end = body + sum(data[offset + 27:body])
        if end > len(data):
            raise ValueError("Truncated Ogg page body.")
        page = bytearray(data[offset:end])
        page[22:26] = b"\0" * 4
        if ogg_crc(page) != expected_crc:
            raise ValueError(f"Ogg CRC mismatch on page {pages}.")
        if sequence != pages or (serial is not None and serial != current_serial):
            raise ValueError("Missing/reordered or multiplexed Ogg pages are unsupported.")
        if pages == 0:
            if flags != 2 or data[body:body + 7] != b"\x01vorbis" or end - body != 30:
                raise ValueError("Expected a complete Vorbis identification packet on the first page.")
            version = struct.unpack_from("<I", data, body + 7)[0]
            channels = data[body + 11]
            sample_rate = struct.unpack_from("<I", data, body + 12)[0]
            if version != 0 or not 1 <= channels <= 8 or not 8000 <= sample_rate <= 384000 or data[end - 1] != 1:
                raise ValueError("Invalid Vorbis identification fields.")
            serial = current_serial
        elif flags & 2:
            raise ValueError("Unexpected beginning-of-stream flag.")
        if flags & ~7:
            raise ValueError("Unknown Ogg header flags.")
        if granule != 0xFFFFFFFFFFFFFFFF:
            if last_granule is not None and granule < last_granule:
                raise ValueError("Ogg granule positions moved backwards.")
            last_granule = granule
        ended = bool(flags & 4)
        pages += 1
        offset = end
    if not ended or last_granule is None or not sample_rate:
        raise ValueError("Ogg stream has no complete end/duration.")
    return data, {
        "codec": "vorbis", "channels": channels, "sampleRate": sample_rate,
        "durationSeconds": last_granule / sample_rate, "pages": pages,
        "sourceWrapper": original[:4].decode("ascii"),
        "changedByteRange": [0, 4] if original[:4] == b"L2SD" else None,
        "encodedAudioUnchanged": data[4:] == original[4:len(data)], "allPageCrcsValid": True,
        "nativeFooterHex": trailer.hex() if trailer else None,
        "removedFooterBytes": len(trailer), "nativeFooterCrcValid": True if trailer else None,
    }


def inspect_wav_riff(original: bytes) -> dict:
    """Inventory top-level framing only; retain unknown payloads without policy.

    Python's wave reader stops scanning once it finds PCM data. Walk to the RIFF
    boundary as well so trailing metadata is neither omitted nor silently accepted
    with truncated framing. LIST bodies and sampler/cue records remain opaque.
    """
    if len(original) < 12 or original[:4] != b"RIFF" or original[8:12] != b"WAVE":
        raise ValueError("Expected a complete RIFF/WAVE header.")
    if struct.unpack_from("<I", original, 4)[0] + 8 != len(original):
        raise ValueError("WAV RIFF length does not match its payload.")
    chunks = []
    offset = 12
    while offset < len(original):
        if len(original) - offset < 8:
            raise ValueError(f"Truncated WAV chunk header at byte {offset}.")
        fourcc = original[offset:offset + 4]
        size = struct.unpack_from("<I", original, offset + 4)[0]
        start = offset + 8
        end = start + size
        padded_end = end + (size & 1)
        if end > len(original):
            raise ValueError(f"Truncated WAV chunk payload at byte {offset}.")
        if padded_end > len(original):
            raise ValueError(f"Missing WAV chunk padding at byte {end}.")
        chunk = {
            "fourCC": fourcc.decode("latin-1"), "headerOffset": offset,
            "dataOffset": start, "bytes": size,
            "payloadSha256": hashlib.sha256(memoryview(original)[start:end]).hexdigest(),
            "paddingHex": original[end:padded_end].hex(),
        }
        if fourcc == b"LIST":
            if size < 4:
                raise ValueError(f"Truncated WAV LIST type at byte {start}.")
            chunk["listType"] = original[start:start + 4].decode("latin-1")
        chunks.append(chunk)
        offset = padded_end
    return {"container": "RIFF/WAVE", "chunks": chunks,
            "scope": "top-level framing and payload hashes; ancillary semantics uninterpreted"}


def decode_native_audio(path: Path | str) -> tuple[bytes, str, dict]:
    path = Path(path)
    original = path.read_bytes()
    if original[:4] in (b"OggS", b"L2SD"):
        result, metadata = decode_ogg(original)
        mime = "audio/ogg"
    elif original[:4] == b"RIFF" and original[8:12] == b"WAVE":
        riff = inspect_wav_riff(original)
        with wave.open(io.BytesIO(original), "rb") as audio:
            frames = audio.getnframes()
            if len(audio.readframes(frames)) != frames * audio.getnchannels() * audio.getsampwidth():
                raise ValueError("Truncated PCM WAV data.")
            metadata = {"codec": "pcm", "channels": audio.getnchannels(), "sampleRate": audio.getframerate(),
                        "durationSeconds": frames / audio.getframerate(), "sampleBytes": audio.getsampwidth(),
                        "encodedAudioUnchanged": True, "riff": riff}
        result, mime = original, "audio/wav"
    else:
        raise ValueError(f"Unsupported audio wrapper in {path.name}; extract a native Sound object or use an explicit adapter.")
    return result, mime, {**metadata, "sourceSha256": hashlib.sha256(original).hexdigest(),
                          "outputSha256": hashlib.sha256(result).hexdigest(), "sourceBytes": len(original), "outputBytes": len(result)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, help="New destination file; omitted means inspect/verify only.")
    args = parser.parse_args()
    data, mime, metadata = decode_native_audio(args.source)
    if args.output:
        target = args.output.resolve()
        if target == args.source.resolve():
            raise ValueError("Source audio is read-only; choose a different output.")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != data:
            raise ValueError("A different output already exists; choose a new path.")
        if not target.exists():
            target.write_bytes(data)
    print(json.dumps({"mime": mime, **metadata}, indent=2))


if __name__ == "__main__":
    main()
