from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import stat
import struct
import zlib

from native_catalog.ue2 import FormatError
from world.environment_time_tables import time_tables_document


HEADER = 'Lineage2Ver111'.encode('utf-16le')
MAX_SOURCE_BYTES = 8 * 1024 * 1024
FOOTER_FORMS = frozenset(((0, 7, 90, 0), (0, 1, 32, 0), (0, 1, 71, 0)))
DEFAULT_FILES = ('Env.int', 'timeenv0.int', 'timeenv1.int', 'timeenv2.int', 'timeenv3.int')
IMPLEMENTATION_FILES = ('native_environment.py', 'export-native-environment.py', 'world/environment_config_cache.py',
                        'world/environment_program.py', 'world/environment_time_tables.py')
XOR = bytes(value ^ 0xac for value in range(256))


def require(condition, message):
    if not condition:
        raise FormatError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded_json(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode('utf-8')


def decode_environment(data):
    require(len(HEADER) + 20 < len(data) <= MAX_SOURCE_BYTES, 'Environment source size outside bounds')
    require(data[:28] == HEADER, 'Expected Lineage2Ver111 environment header')
    words = struct.unpack('<5I', data[-20:])
    require((words[0], words[1], words[2], words[4]) in FOOTER_FORMS, 'Unsupported environment111 footer form')
    checksum = zlib.crc32(data[:-20])
    require(words[3] == checksum, 'Environment111 CRC32 mismatch')
    payload = data[28:-20].translate(XOR)
    require(b'\0' not in payload and not payload.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')),
            'Unsupported environment text encoding or NUL bytes')
    require(HEADER + payload.translate(XOR) + data[-20:] == data, 'Environment byte round trip failed')
    return payload, {'headerBytes': 28, 'payloadBytes': len(payload), 'footerOffset': len(data) - 20,
                     'footerBytes': 20, 'footerHex': data[-20:].hex(), 'footerWordsLE': list(words),
                     'crc32': f'{checksum:08x}', 'crcCoveredBytes': len(data) - 20,
                     'crcVerified': True, 'roundTripExact': True, 'footerWordMeaning': 'unassigned'}


def parse_records(payload):
    records, section, section_index, offset = [], None, None, 0
    for line_number, line in enumerate(payload.splitlines(keepends=True), 1):
        body = line.rstrip(b'\r\n')
        stripped = body.strip()
        row = {'recordIndex': len(records), 'line': line_number, 'decodedOffset': offset,
               'sourceOffset': 28 + offset, 'bytes': len(line), 'rawHex': line.hex(), 'hex': body.hex()}
        if not stripped:
            row['kind'] = 'blank'
        elif stripped.startswith(b';'):
            row['kind'] = 'comment'
        elif re.fullmatch(rb'\[[A-Za-z0-9_]+\]', stripped):
            section, section_index = stripped[1:-1].decode('ascii'), len(records)
            row.update(kind='section', name=section, sectionIndex=section_index)
        else:
            match = re.fullmatch(rb'\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*', body)
            row.update(section=section, sectionIndex=section_index)
            if match:
                value = match.group(2)
                row.update(kind='property', key=match.group(1).decode('ascii'), valueHex=value.hex(),
                           valueAscii=value.decode('ascii') if value.isascii() else None,
                           valueDecodedOffset=offset + match.start(2), valueSourceOffset=28 + offset + match.start(2))
            else:
                row['kind'] = 'unparsed'
        records.append(row)
        offset += len(line)
    require(offset == len(payload), 'Record spans do not cover payload')
    return records


def build_products(sources):
    require(bool(sources), 'No environment sources selected')
    require(len({name.casefold() for name in sources}) == len(sources), 'Duplicate environment source names')
    files, products = [], {}
    for name in sorted(sources, key=str.casefold):
        require(re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]*\.int', name), 'Expected a flat .int source filename')
        data = sources[name]
        payload, framing = decode_environment(data)
        products[f'original/{name}'] = data
        products[f'decoded/{name}.bin'] = payload
        products[f'decoded/{name}.txt'] = payload.decode('latin-1').encode('utf-8')
        files.append({'name': name, 'originalBytes': len(data), 'originalSha256': sha(data),
                      'decodedBytes': len(payload), 'decodedSha256': sha(payload), 'framing': framing,
                      'readableEncoding': 'Latin-1 byte mapping to UTF-8; original text encoding unassigned',
                      'records': parse_records(payload)})
    records = {'schemaVersion': 1, 'kind': 'native-environment-ordered-records', 'sourceFileCount': len(files),
               'propertyRecords': sum(row['kind'] == 'property' for file in files for row in file['records']),
               'offsetSpace': 'source=original encrypted file; decoded=exact XOR payload; no section precedence', 'files': files}
    products['environment-records.json'] = encoded_json(records)
    products['time-tables.json'] = encoded_json(time_tables_document(files))
    manifest = {'schemaVersion': 1, 'kind': 'native-environment-conversion',
                'implementation': {name: sha((Path(__file__).parent / name).read_bytes()) for name in IMPLEMENTATION_FILES},
                'inputs': [{key: file[key] for key in ('name', 'originalBytes', 'originalSha256')} for file in files],
                'products': {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(products.items())},
                'runtimeIntegration': False, 'nativeRenderingParity': 'unverified'}
    products['manifest.json'] = encoded_json(manifest)
    return products


def reject_links(path):
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            info = part.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    f'Linked/reparse path is not an input/output boundary: {part}')


def convert(input_dir, output_dir, names=DEFAULT_FILES, verify_only=False):
    input_dir, output_dir = Path(input_dir).absolute(), Path(output_dir).absolute()
    reject_links(input_dir)
    reject_links(output_dir)
    input_dir, output_dir = input_dir.resolve(), output_dir.resolve()
    require(input_dir.is_dir(), 'Environment input directory missing')
    require(not output_dir.is_relative_to(input_dir) and not input_dir.is_relative_to(output_dir),
            'Environment output overlaps source directory')
    require(len(names) == len(set(name.casefold() for name in names)), 'Duplicate environment source names')
    sources = {}
    for name in names:
        require(re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]*\.int', name), 'Expected a flat .int source filename')
        path = input_dir / name
        reject_links(path)
        require(path.is_file() and 48 < path.stat().st_size <= MAX_SOURCE_BYTES, f'Invalid source file or size: {name}')
        sources[name] = path.read_bytes()
    products = build_products(sources)
    existing = set()
    if output_dir.exists():
        require(output_dir.is_dir(), 'Output is not a directory')
        for path in output_dir.rglob('*'):
            reject_links(path)
            if path.is_file():
                name = path.relative_to(output_dir).as_posix()
                require(name in products and path.read_bytes() == products[name], f'Existing product differs or is unowned: {name}')
                existing.add(name)
    require(not verify_only or existing == set(products), 'Verify-only output is incomplete')
    if not verify_only:
        for name, data in products.items():
            if name not in existing:
                path = output_dir / name
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as stream:
                    stream.write(data)
    tables = json.loads(products['time-tables.json'])
    records = json.loads(products['environment-records.json'])
    return {'sourceFiles': len(sources), 'propertyRecords': records['propertyRecords'], 'environmentTypes': len(tables['environmentTypes']),
            'tables': tables['tableCount'], 'rows': tables['rowCount'], 'typedComplete': tables['typedComplete'],
            'unresolved': tables['unresolved'], 'products': len(products), 'existingVerified': len(existing),
            'written': 0 if verify_only else len(products) - len(existing), 'verifyOnly': verify_only,
            'manifestSha256': sha(products['manifest.json'])}
