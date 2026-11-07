"""Offline Interlude environment records; no environment/time/sky policy.

Envelope evidence: sky-environment-source-20261107/NATIVE_EVIDENCE.md. This
separate reader admits three observed footer forms with CRC32 and size guards;
it does not broaden the existing localization decoder or assign footer meanings.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import stat
import struct
import zlib

from native_catalog.ue2 import FormatError


HEADER = 'Lineage2Ver111'.encode('utf-16le')
MAX_SOURCE_BYTES = 8 * 1024 * 1024
FOOTER_FORMS = frozenset(((0, 7, 90, 0), (0, 1, 32, 0), (0, 1, 71, 0)))
DEFAULT_FILES = ('Env.int', 'timeenv0.int', 'timeenv1.int', 'timeenv2.int', 'timeenv3.int')
SKY_SECTIONS = ('SkyBoxColor', 'HazeringColor', 'CloudColor1', 'CloudColor2', 'CloudColor3')
COLOR = re.compile(r'\(\s*T\s*=\s*(\d+)\s*,\s*R\s*=\s*(\d+)\s*,\s*G\s*=\s*(\d+)\s*,\s*B\s*=\s*(\d+)\s*\)')
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
    """Retain every physical line; section occurrences never collapse to keys."""
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


def derive_tables(files):
    tables, duplicates, anomalies, setup = [], [], [], []
    for file in files:
        records, name = file['records'], file['name']
        headers = [row for row in records if row['kind'] == 'section']
        header_counts = Counter(row['name'] for row in headers)
        duplicates.extend({'file': name, 'section': row['name'], 'sectionIndex': row['sectionIndex'],
                           'line': row['line'], 'sourceOffset': row['sourceOffset']}
                          for row in headers if header_counts[row['name']] > 1)
        properties = [row for row in records if row['kind'] == 'property']
        setup.extend({'file': name, **row} for row in properties if row['section'] == 'EnvSetup')
        env_types = [row for row in properties if row['section'] == 'EnvType']
        anomalies.extend({'file': name, 'kind': 'unparsed-line', 'recordIndex': row['recordIndex']}
                         for row in records if row['kind'] == 'unparsed')
        for header in headers:
            if header['name'] not in SKY_SECTIONS:
                continue
            selected = [row for row in properties if row['sectionIndex'] == header['sectionIndex']]
            declared = [row for row in selected if row['key'] == 'NUM']
            colors, other, issues = [], [], []
            for row in selected:
                if row['key'] == 'NUM':
                    continue
                if not re.fullmatch(r'COLOR\d+', row['key']):
                    other.append(row)
                    issues.append('unsupported-table-property')
                    continue
                match = COLOR.fullmatch(row['valueAscii'] or '')
                values = list(map(int, match.groups())) if match else None
                valid = values is not None and all(0 <= value <= 255 for value in values[1:])
                colors.append({'key': row['key'], 'tLiteral': values[0] if valid else None,
                               'rgb': values[1:] if valid else None, 'typed': valid,
                               'line': row['line'], 'sourceOffset': row['sourceOffset'],
                               'decodedOffset': row['decodedOffset'], 'valueSourceOffset': row['valueSourceOffset'],
                               'rawValue': row['valueAscii'], 'recordIndex': row['recordIndex']})
                if not valid:
                    issues.append('unsupported-color-tuple')
            number = int(declared[0]['valueAscii']) if len(declared) == 1 and re.fullmatch(r'\d+', declared[0]['valueAscii'] or '') else None
            if number is None:
                issues.append('missing-ambiguous-or-unsupported-NUM')
            count_matches = number == len(colors) if number is not None else None
            if count_matches is False:
                anomalies.append({'file': name, 'kind': 'declared-count-mismatch', 'sectionIndex': header['sectionIndex'],
                                  'declaredNum': number, 'physicalColorRows': len(colors)})
            if len({row['key'] for row in colors}) != len(colors):
                anomalies.append({'file': name, 'kind': 'duplicate-color-key', 'sectionIndex': header['sectionIndex']})
            anomalies.extend({'file': name, 'kind': issue, 'sectionIndex': header['sectionIndex']} for issue in sorted(set(issues)))
            tables.append({'file': name, 'originalSha256': file['originalSha256'], 'decodedSha256': file['decodedSha256'],
                           'section': header['name'], 'sectionIndex': header['sectionIndex'], 'headerLine': header['line'],
                           'headerSourceOffset': header['sourceOffset'], 'envTypeDeclarations': env_types,
                           'declaredNum': number, 'numDeclarations': declared, 'physicalColorRows': len(colors),
                           'declaredNumMatchesPhysicalRows': count_matches, 'rows': colors, 'otherProperties': other,
                           'typedComplete': not issues, 'runtimeConsumedRows': None})
    return {'schemaVersion': 1, 'kind': 'native-environment-source-tables', 'tableCount': len(tables),
            'physicalColorRows': sum(len(table['rows']) for table in tables), 'tables': tables,
            'envSetupDeclarations': setup, 'duplicateSectionHeaders': duplicates, 'anomalies': anomalies,
            'typedComplete': all(table['typedComplete'] for table in tables),
            'selection': {'nativeEnvironmentType': None, 'nativeTime': None, 'interpolation': None,
                          'numConsumption': None, 'duplicateSectionPrecedence': None, 'liveColorWriter': None}}


def build_products(sources):
    """Build deterministic products from named bytes; no filesystem writes."""
    require(bool(sources), 'No environment sources selected')
    require(len({name.casefold() for name in sources}) == len(sources), 'Duplicate environment source names')
    files, products = [], {}
    for name in sorted(sources, key=str.casefold):
        require(re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]*\.int', name), 'Expected a flat .int source filename')
        data = sources[name]
        payload, framing = decode_environment(data)
        products[f'original/{name}'] = data
        products[f'decoded/{name}.bin'] = payload
        # This is only a readable, lossless byte mapping, not a Korean/locale claim.
        products[f'decoded/{name}.txt'] = payload.decode('latin-1').encode('utf-8')
        files.append({'name': name, 'originalBytes': len(data), 'originalSha256': sha(data),
                      'decodedBytes': len(payload), 'decodedSha256': sha(payload), 'framing': framing,
                      'readableEncoding': 'Latin-1 byte mapping to UTF-8; original text encoding unassigned',
                      'records': parse_records(payload)})
    records = {'schemaVersion': 1, 'kind': 'native-environment-ordered-records', 'sourceFileCount': len(files),
               'propertyRecords': sum(row['kind'] == 'property' for file in files for row in file['records']),
               'offsetSpace': 'source=original encrypted file; decoded=exact XOR payload; no section precedence', 'files': files}
    products['environment-records.json'] = encoded_json(records)
    products['sky-tables.json'] = encoded_json(derive_tables(files))
    manifest = {'schemaVersion': 1, 'kind': 'native-environment-conversion',
                'implementation': {name: sha((Path(__file__).parent / name).read_bytes())
                                   for name in ('native_environment.py', 'export-native-environment.py')},
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
    tables = json.loads(products['sky-tables.json'])
    records = json.loads(products['environment-records.json'])
    return {'sourceFiles': len(sources), 'propertyRecords': records['propertyRecords'], 'tables': tables['tableCount'],
            'physicalColorRows': tables['physicalColorRows'], 'typedComplete': tables['typedComplete'],
            'anomalies': tables['anomalies'], 'products': len(products), 'existingVerified': len(existing),
            'written': 0 if verify_only else len(products) - len(existing), 'verifyOnly': verify_only,
            'manifestSha256': sha(products['manifest.json'])}
