import hashlib
import os
from pathlib import Path
import re
import struct
from typing import NamedTuple
import xml.etree.ElementTree as ET
import zlib

from .table_layout_pins import (CLIENT_DERIVED_LAYOUTS, CRYPTO_HASH, MTX_DEFINITION_EVIDENCE, RECORD_IDENTIFIER_FIELDS,
                                RGBA_DEFINITION_EVIDENCE, SCHEMA_HASHES, TABLES)
from .table_source_resolver import descriptor_layout_links, resolve_table_source_file_name
from .ue2 import FormatError, Reader
from reference_client_guard import REPOSITORY_ROOT, require_reference_client

SCHEMA_ROOT = Path(os.environ.get('L2_SCHEMA_ROOT', 'C:/laragon/www/l2-browser-client/.assets/native-tools/dat-schema/dat_engine/data/structure'))
CRYPTO_SOURCE = Path(os.environ.get('L2_CRYPTO_SOURCE', 'C:/laragon/www/l2-browser-client/.assets/native-tools/open-l2encdec/src/l2encdec.cpp'))
DESCRIPTOR_FILE = '06_interlude.xml'
SAFE_PACKAGE_TRAILER = b'\x0cSafePackage\0'
SYSTEM_FOLDER_NAME = 'system'
TABLE_LIMITATIONS = ['Native client presentation bindings only, not authoritative gameplay.',
    'Native field names and values retained; no cross-edition joins or fallback substitutions.',
    'Skill action-code to skeletal animation dispatch and effect runtime equivalence require separate verification.']


class TableLayoutSchema(NamedTuple):
    name: str
    path: Path
    sha256: str


def checked_bytes(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise FormatError(f'External format definition hash mismatch: {path}')
    return data


def interlude_descriptor_links(schema_root=SCHEMA_ROOT):
    return descriptor_layout_links(checked_bytes(Path(schema_root) / DESCRIPTOR_FILE, SCHEMA_HASHES[DESCRIPTOR_FILE]))


def table_layout_schema(name, schema_root=SCHEMA_ROOT):
    if name in CLIENT_DERIVED_LAYOUTS:
        client_derived_layout = CLIENT_DERIVED_LAYOUTS[name]
        return TableLayoutSchema(client_derived_layout['file'], REPOSITORY_ROOT / client_derived_layout['file'],
                                 client_derived_layout['sha256'])
    schema_name = f'dats/{name}.xml'
    return TableLayoutSchema(schema_name, Path(schema_root) / schema_name, SCHEMA_HASHES[schema_name])


def interlude_table_layout(name, schema_root=SCHEMA_ROOT):
    if name not in TABLES:
        raise FormatError('This adapter only supports the pinned Interlude descriptor layouts: ' + str(name))
    links = [link for link in interlude_descriptor_links(schema_root) if link.layout == name]
    if len(links) != 1:
        raise FormatError('Missing unambiguous Interlude table descriptor: ' + name)
    layout_schema = table_layout_schema(name, schema_root)
    schema_bytes = checked_bytes(layout_schema.path, layout_schema.sha256)
    layouts = [entry for entry in ET.fromstring(schema_bytes) if entry.get('pattern') == links[0].version]
    if len(layouts) != 1 or layouts[0].get('isSafePackage') != 'true':
        raise FormatError('Missing audited safe-package table layout: ' + name)
    return links[0], layouts[0], layout_schema.name


def layout_reader_names(layout):
    return {node.get('reader') for node in layout.iter() if node.get('reader')}


def layout_definition_pins(name, layout, schema_root, crypto_source):
    layout_schema = table_layout_schema(name, schema_root)
    pins = {'crypto-definition': hashlib.sha256(checked_bytes(crypto_source, CRYPTO_HASH)).hexdigest(),
            DESCRIPTOR_FILE: hashlib.sha256(checked_bytes(Path(schema_root) / DESCRIPTOR_FILE, SCHEMA_HASHES[DESCRIPTOR_FILE])).hexdigest(),
            layout_schema.name: hashlib.sha256(checked_bytes(layout_schema.path, layout_schema.sha256)).hexdigest()}
    reader_names = layout_reader_names(layout)
    if 'MTX' in reader_names:
        pins['definitions.xml#MTX'] = hashlib.sha256(checked_bytes(schema_root.parent / 'definitions.xml', MTX_DEFINITION_EVIDENCE['sha256'])).hexdigest()
    if 'RGBA' in reader_names:
        for relative, expected in RGBA_DEFINITION_EVIDENCE['files'].items():
            pins[relative + '#RGBA'] = hashlib.sha256(checked_bytes(schema_root.parents[2] / relative, expected)).hexdigest()
    return pins


def table_definition_pins(name, schema_root=SCHEMA_ROOT, crypto_source=CRYPTO_SOURCE):
    _, layout, _ = interlude_table_layout(name, schema_root)
    return layout_definition_pins(name, layout, schema_root, crypto_source)


def decode413(raw, crypto_source=CRYPTO_SOURCE):
    if raw[:28].decode('utf-16le', errors='replace') != 'Lineage2Ver413':
        raise FormatError('Presentation table adapter requires native Ver413 bytes')
    source = checked_bytes(crypto_source, CRYPTO_HASH).decode('utf-8')
    public_open_l2encdec_key_blocks = [('modern', source.split('MODERN_RSA_PARAMS = {', 1)[1].split('};', 1)[0]),
        ('legacy413', source.split('{413, {', 1)[1].split('}}', 1)[0])]
    encrypted = raw[28:-20]
    if not encrypted or len(encrypted) % 128:
        raise FormatError('Malformed Ver413 block length')
    for name, block in public_open_l2encdec_key_blocks:
        values = dict(re.findall(r'\.rsa_(\w+) = "([0-9a-f]+)"', block))
        modulus, exponent = int(values['modulus'], 16), int(values['private_exponent'], 16)
        payload = bytearray()
        for offset in range(0, len(encrypted), 128):
            value = pow(int.from_bytes(encrypted[offset:offset + 128], 'big'), exponent, modulus).to_bytes(128, 'big')
            count = value[3]
            if count > 124:
                break
            start = 128 - ((count + 3) & ~3)
            payload.extend(value[start:start + count])
        else:
            if len(payload) < 4:
                continue
            expected = struct.unpack_from('<I', payload)[0]
            if expected > 100_000_000:
                continue
            try:
                decoder = zlib.decompressobj()
                decoded = decoder.decompress(payload[4:], expected + 1)
                if len(decoded) == expected and decoder.eof and not decoder.unconsumed_tail and not decoder.unused_data:
                    return name, decoded
            except zlib.error:
                pass
    raise FormatError('No known Ver413 key produced a complete bounded stream')


def read_core_fstring_text(reader):
    length = reader.compact()
    wide = length < 0
    unit_bytes = 2 if wide else 1
    raw = reader.take(abs(length) * unit_bytes)
    if abs(length) == 1:
        return ''
    code_units = struct.unpack(f'<{-length}H', raw) if wide else raw
    if code_units and 0 not in code_units:
        raise FormatError('Unterminated Unreal string')
    visible_unit_count = code_units.index(0) if code_units else 0
    return raw[:visible_unit_count * unit_bytes].decode('utf-16le' if wide else 'latin-1')


def read_value(reader, kind):
    numbers = {'UINT': 'I', 'INT': 'i', 'FLOAT': 'f', 'UCHAR': 'B', 'USHORT': 'H', 'SHORT': 'h', 'UBYTE': 'B'}
    if kind in numbers:
        return reader.number(numbers[kind])
    if kind == 'UNICODE':
        size = reader.number('I')
        if size % 2 or size > 1_000_000:
            raise FormatError('Invalid bounded Unicode field length')
        return reader.take(size).decode('utf-16le').rstrip('\0')
    if kind == 'ASCF':
        return read_core_fstring_text(reader)
    if kind == 'CNTR':
        return reader.compact()
    if kind == 'RGBA':
        return reader.take(4).hex().upper()
    if kind == 'MTX':
        result = {}
        for number, collection, field in ((1, 'mesh', 'mtx_mesh_'), (2, 'texture', 'mtx_text_')):
            count = reader.number('i')
            if not 0 <= count <= 4096:
                raise FormatError('Invalid bounded MTX ' + collection + ' count')
            result[f'mtx_size_{number}_'] = count
            result[f'for_mtx_size_{number}_'] = [{field: read_value(reader, 'UNICODE')} for _ in range(count)]
        return {'var_0_': result}
    raise FormatError('Unsupported table field reader: ' + kind)


def unwrap_same_named_count_wrapper(value, name):
    return value.get(name) if isinstance(value, dict) else value


def read_nodes(reader, nodes):
    row = {}
    for node in nodes:
        name = node.get('name')
        if node.tag == 'if':
            reference = node.get('param', '')
            if not reference.startswith('#') or reference[1:] not in row:
                raise FormatError('Conditional table field requires a preceding count')
            value = unwrap_same_named_count_wrapper(row[reference[1:]], reference[1:])
            if not isinstance(value, int):
                raise FormatError('Conditional table field does not reference an integer')
            if value == int(node.get('val')):
                extra = read_nodes(reader, node)
                if set(extra) & set(row):
                    raise FormatError('Conditional table fields overwrite authored values')
                row.update(extra)
            continue
        count_replacement = node.tag == 'for' and node.get('size') == '#' + str(name) and isinstance(row.get(name), int)
        if not name or (name in row and not count_replacement):
            raise FormatError('Missing/duplicate table field name')
        if node.tag == 'node':
            row[name] = read_value(reader, node.get('reader'))
        elif node.tag == 'for':
            size = node.get('size')
            count = row[size[1:]] if size.startswith('#') else int(size)
            if not isinstance(count, int) or not 0 <= count <= 100_000:
                raise FormatError('Invalid bounded table row count')
            if count_replacement:
                row.setdefault('_counts', {})[name] = count
            row[name] = [read_nodes(reader, node) for _ in range(count)]
        elif node.tag == 'wrapper':
            row[name] = read_nodes(reader, node)
        else:
            raise FormatError('Unsupported schema element: ' + node.tag)
    return row


def table_source_path(client, file_pattern, source_filename=None):
    file_names = [path.name for path in (client / SYSTEM_FOLDER_NAME).iterdir() if path.is_file()]
    file_name = resolve_table_source_file_name(file_names, file_pattern, source_filename)
    return require_reference_client(client).require_equal_file(f'{SYSTEM_FOLDER_NAME}/{file_name}')


def require_unique_record_identifiers(name, rows):
    if name not in RECORD_IDENTIFIER_FIELDS:
        return
    collection, key = RECORD_IDENTIFIER_FIELDS[name]
    identifiers = [row[key] for row in rows[collection]]
    if rows['data'] != len(identifiers) or len(set(identifiers)) != len(identifiers):
        raise FormatError('Native item/NPC identifiers are not unique or do not match the declared count')


def require_in_use_slot_prefix(name, rows):
    in_use_slots = CLIENT_DERIVED_LAYOUTS.get(name, {}).get('inUseSlots')
    if in_use_slots is None:
        return
    slots, in_use_count = rows[in_use_slots['records']], rows[in_use_slots['countField']]
    if [slot[in_use_slots['slotField']] for slot in slots] != list(range(len(slots))):
        raise FormatError(f'{name} slot ids are not the slot positions 0 to {len(slots) - 1}')
    in_use_flags = [slot[in_use_slots['inUseField']] != 0 for slot in slots]
    if in_use_count > len(slots) or in_use_flags != [True] * in_use_count + [False] * (len(slots) - in_use_count):
        raise FormatError(f'{name} header counts {in_use_count} in-use slots, but the in-use slots are not exactly the first '
                          f'{in_use_count} of {len(slots)}')


def decoded_table_record_count(decoded_table):
    record_lists = [value for value in decoded_table['data'].values() if isinstance(value, list)]
    if len(record_lists) != 1:
        raise FormatError(f'decoded {decoded_table["source"]} has {len(record_lists)} top-level record lists, expected 1')
    return len(record_lists[0])


def decode_table(client, name, schema_root=SCHEMA_ROOT, crypto_source=CRYPTO_SOURCE, *, source_filename=None):
    client = client.resolve(strict=True)
    link, layout, _ = interlude_table_layout(name, schema_root)
    layout_schema = table_layout_schema(name, schema_root)
    definition_pins = layout_definition_pins(name, layout, schema_root, crypto_source)
    path = table_source_path(client, link.pattern, source_filename)
    raw = path.read_bytes()
    key_family, decoded = decode413(raw, crypto_source)
    reader = Reader(decoded)
    rows = read_nodes(reader, layout)
    trailer = decoded[reader.position:]
    if trailer != SAFE_PACKAGE_TRAILER:
        raise FormatError(f'Unexpected safe-package trailer: {name}: {trailer.hex()}')
    require_unique_record_identifiers(name, rows)
    require_in_use_slot_prefix(name, rows)
    schema = {'descriptor': DESCRIPTOR_FILE, 'layout': link.version, 'descriptorSha256': SCHEMA_HASHES[DESCRIPTOR_FILE],
        'file': layout_schema.name, 'sha256': layout_schema.sha256, 'sourcePattern': link.pattern}
    if name in CLIENT_DERIVED_LAYOUTS:
        schema['clientLayoutEvidence'] = dict(CLIENT_DERIVED_LAYOUTS[name]['evidence'])
    reader_names = layout_reader_names(layout)
    if 'MTX' in reader_names:
        schema['compoundDefinitionEvidence'] = dict(MTX_DEFINITION_EVIDENCE)
    if 'RGBA' in reader_names:
        schema['primitiveDefinitionEvidence'] = dict(RGBA_DEFINITION_EVIDENCE)
    return {'schemaVersion': 1, 'edition': 'interlude', 'source': path.relative_to(client).as_posix(),
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'decodedSha256': hashlib.sha256(decoded).hexdigest(),
        'keyFamily': key_family, 'decodedBytes': len(decoded), 'consumedBytes': reader.position,
        'trailerHex': trailer.hex(), 'schema': schema, 'formatDefinitionPins': definition_pins,
        'data': rows, 'limitations': list(TABLE_LIMITATIONS)}
