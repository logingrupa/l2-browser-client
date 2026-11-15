"""Exact ALAudio configuration/source joins, without native lookup emulation.

This module does not execute client code or choose a world playback policy.
Only exact full-object matches resolve. Group-less literals retain separate,
explicitly non-resolved candidate identities for subsequent native research.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import struct
import zlib

from native_animation_families import decode_localization111, section_records
from native_catalog.ue2 import FormatError


SECTION = 'L2FootStepSound'
PREFIXES = ('DefWalkSound', 'DefRunSound', 'GrassWalkSound', 'GrassRunSound',
            'WaterWalkSound', 'WaterRunSound', 'DefActorWalkSound', 'DefActorRunSound')
KEYS = tuple(prefix + str(index) for prefix in PREFIXES for index in range(1, 4))
REFERENCE = re.compile(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+')
OBSERVED_CONFIG_SHA256 = '25f4e583409d798cd10cdca79eb8620395ca383a50cdecedd2ab3d501eba803c'
MAX_CONFIG_BYTES = 8 * 1024 * 1024
MAX_SOUND_BYTES = 96 * 1024 * 1024
RUNTIME_FLAGS = {'nativePostLoadObserved': False, 'effectiveRuntimeMapping': None,
                 'worldConnected': False, 'audibleObserved': False, 'nativeParityVerified': False}
STATIC_LOOKUP_EVIDENCE = {
    'engineSha256': '4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08',
    'postLoadEntry': '0x106af480', 'configFilenameLiteral': 'ALAudio.int', 'sectionLiteral': SECTION,
    'scope': 'Retained static attempted lookup keys only; execution and successful loads unobserved',
}


def require(condition, message):
    if not condition:
        raise FormatError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def decode_config(data):
    """Known111 forms only; the new envelope is accepted by exact source hash.

    The generalized existing decoder retains its earlier strict footer gate.
    No meaning is assigned to the observed opaque footer words10 and90.
    """
    require(48 < len(data) <= MAX_CONFIG_BYTES, 'unsupported-config-size')
    require(data[:28] == 'Lineage2Ver111'.encode('utf-16le'), 'unsupported-config-framing')
    footer = struct.unpack('<5I', data[-20:])
    checksum = zlib.crc32(data[:-20])
    if digest(data) == OBSERVED_CONFIG_SHA256:
        require((footer[0], footer[1], footer[2], footer[4]) == (0, 10, 90, 0),
                'observed-config-footer-mismatch')
        require(footer[3] == checksum, 'config-footer-crc-mismatch')
        decoded = data[28:-20].translate(bytes(value ^ 0xac for value in range(256)))
        require(b'\0' not in decoded and not decoded.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')),
                'unsupported-config-text-encoding')
        adapter = 'exact-ALAudio-25f4e583-Ver111-XOR0xAC-footer20'
    else:
        # Known ordinary footer form, including its own CRC/text checks.
        # An altered copy of the new observed form intentionally fails here.
        decoded = decode_localization111(data)
        adapter = 'native_animation_families.decode_localization111'
    return decoded, {'adapter': adapter, 'wrapper': 'Lineage2Ver111',
        'sourceHeaderHex': data[:28].hex(), 'encodedTextOffset': 28,
        'encodedTextBytes': len(data)-48, 'footerOffset': len(data)-20,
        'footerHex': data[-20:].hex(), 'footerUint32': list(footer),
        'crc32Hex': f'{checksum:08x}', 'crc32Verified': True,
        'unknownFooterWordsInterpreted': False,
        'decodedBytes': len(decoded), 'decodedSha256': digest(decoded)}


def selected_records(decoded):
    """Select an unchanged target slice, preserving original byte/line offsets.

    Unrelated dotted section names are not interpreted by the animation parser.
    Duplicate targets and malformed selected assignments still fail closed.
    Lines use Python bytes.splitlines: CRCRLF is two line boundaries, explicitly
    different from editors which may display it as one line.
    """
    starts, offset = [], 0
    lines = decoded.splitlines(keepends=True)
    for line_number, raw in enumerate(lines, 1):
        stripped = raw.rstrip(b'\r\n').strip()
        if stripped.startswith(b'['):
            match = re.fullmatch(rb'\[([^\[\]\r\n]+)\]', stripped)
            require(match is not None, f'unsupported-section-header-at-byte-{offset}')
            starts.append((offset, line_number, match.group(1)))
        offset += len(raw)
    targets = [index for index, item in enumerate(starts) if item[2].lower() == SECTION.lower().encode('ascii')]
    require(len(targets) <= 1, 'duplicate-footstep-section')
    if not targets:
        return [], None
    index = targets[0]
    start, first_line, _ = starts[index]
    finish = starts[index+1][0] if index+1 < len(starts) else len(decoded)
    selected = decoded[start:finish]
    # section_records rejects empty sections. Treat an actually empty one as
    #24 missing keys, while rejecting malformed text through the shared parser.
    noncomment = [line.strip() for line in selected.splitlines()[1:]
                  if line.strip() and not line.strip().startswith(b';')]
    records = section_records(selected, SECTION) if noncomment else []
    for record in records:
        record['payloadByteOffset'] += start
        record['line'] += first_line-1
        record['encodedFileByteOffset'] = 28+record['payloadByteOffset']
        begin = record['payloadByteOffset']
        require(decoded[begin:begin+len(record['rawLine'])] == record['rawLine'].encode('ascii'),
                'rebased-raw-line-mismatch')
    return records, {'startByte': start, 'bytes': finish-start, 'sha256': digest(selected),
        'firstLine': first_line, 'lineDefinition': 'bytes.splitlines; CRCRLF counts as two boundaries'}


def strict_reference(value):
    # Do not strip whitespace, quotes, a Sound'...' wrapper or add a group.
    return value if REFERENCE.fullmatch(value) is not None else None


def package_candidates(files, reference):
    package_name = reference.split('.')[0].casefold()
    return [row for row in files if Path(row['relativePath']).suffix.casefold() == '.uax'
            and Path(row['relativePath']).stem.casefold() == package_name]


def object_match(package, reference):
    matches = [row for row in package.exports if row['object'].casefold() == reference.casefold()]
    if len(matches) > 1:
        return 'ambiguous-object', None, []
    if matches:
        if matches[0]['className'] != 'Sound':
            return 'wrong-object-class', matches[0], []
        return 'resolved', matches[0], []
    # Diagnostic only: retain full canonical identities but never select them.
    leaf = reference.split('.')[-1].casefold()
    candidates = [{'object': row['object'], 'exportIndex': row['exportIndex'], 'className': row['className']}
                  for row in package.exports if row['object'].split('.')[-1].casefold() == leaf]
    return 'missing-exact-object', None, candidates


def sound_payload(package, export):
    require(export['className'] == 'Sound', 'Sound class required')
    properties, reader = package.properties(export)
    native_format = package.name(reader.compact())
    lazy_end = reader.number('i')
    size = reader.count(MAX_SOUND_BYTES)
    payload_offset = reader.position
    data = reader.take(size)
    require(reader.position == reader.end == lazy_end, 'Sound lazy-array/export boundary mismatch')
    return data, {'object': export['object'], 'exportIndex': export['exportIndex'],
        'serializedExportOffsetUnwrapped': export['offset'], 'serializedExportBytes': export['size'],
        'serializedExportSha256': digest(package.data[export['offset']:export['offset']+export['size']]),
        'properties': properties, 'nativeFormat': native_format,
        'embeddedPayloadOffsetUnwrapped': payload_offset, 'embeddedPayloadBytes': len(data),
        'embeddedPayloadSha256': digest(data)}
