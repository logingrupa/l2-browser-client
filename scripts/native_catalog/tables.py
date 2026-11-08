import hashlib
import os
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET
import zlib

from .ue2 import FormatError, Reader

SCHEMA_ROOT = Path(os.environ.get('L2_SCHEMA_ROOT', 'C:/laragon/www/l2-browser-client/.assets/native-tools/dat-schema/dat_engine/data/structure'))
CRYPTO_SOURCE = Path(os.environ.get('L2_CRYPTO_SOURCE', 'C:/laragon/www/l2-browser-client/.assets/native-tools/open-l2encdec/src/l2encdec.cpp'))
SCHEMA_HASHES = {
    '06_interlude.xml': '5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6',
    'dats/skillgrp.xml': 'ad5be4b6daa6c942f1f238de3d77b92b828c97d2d45a4360e4159db199992da1',
    'dats/skillsoundgrp.xml': '373c724ff79e06b9e0b4146618a37c5bb73c86d092cf32ffacada20cb0868284',
    'dats/mobskillanimgrp.xml': 'f94a21d1ead51c6606a95efdffa23257b5aa51ef89adfcb9c62e82267a040079',
    'dats/chargrp.xml': 'e0513aba48dc728e30da8d1630e247f71fe01dc3baaa05c72b87fee32bbeebec',
    'dats/armorgrp.xml': '1729aef2f79ed230b18d4c9b65eabb33c88717b89a97b9f0c02e19abc996d44b',
    'dats/weapongrp.xml': '6f399ff5dbf928e07606bd74b15986df7585bd4af158984529fe7579c319f81d',
    'dats/npcgrp.xml': 'bdb22cce0fb2e9e2abc29714ba425280dba032e51f87ceeccf2c8110e4af9f79',
    'dats/npcname.xml': '18dc3bfb5de2055257e64818d55ca13354694961c08fee50b9b62951eedd681a',
}
CRYPTO_HASH = '600cc9d556c50fb3640075f65a4783bd66e0bd8f7a790b72391b4a2a59004c5b'
SAFE_PACKAGE_TRAILER = b'\x0cSafePackage\0'
TABLES = ('skillgrp', 'skillsoundgrp', 'mobskillanimgrp', 'chargrp', 'armorgrp', 'weapongrp', 'npcgrp', 'npcname')
MTX_DEFINITION_EVIDENCE = {
    'revision': 'f2a2cc16120dd8ffabd60255aaad59fa4d6b6f53',
    'file': 'dat_engine/data/definitions.xml',
    'sha256': 'ac56b72cbec18200b232557623bd9830f176b8819398a8d31d9f84c73daa6076',
    'definition': 'MTX',
}
RGBA_DEFINITION_EVIDENCE = {
    'revision': 'f2a2cc16120dd8ffabd60255aaad59fa4d6b6f53',
    'definition': 'RGBA',
    'files': {
        'dat_engine/src/schema.rs': '3104e3795a7327e98c5a21cc1429b4496fe42d1dedb321376288f3ba3ccb89ac',
        'dat_engine/src/reader.rs': '3b73a029df9ddef76ac3d775da2c2fa03dcce8105189a74d4c0191627f2bde73',
        'dat_engine/src/bytes.rs': '2c20aeccf0dc28d107998be8e27d4281140d5ccbd572c76d6bfcee1abf7038b2',
    },
    'representation': 'Four source-order bytes as eight uppercase hexadecimal characters; no channel reordering or CSS interpretation.',
}


def checked_bytes(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise FormatError(f'External format definition hash mismatch: {path}')
    return data


def table_definition_pins(name, schema_root=SCHEMA_ROOT, crypto_source=CRYPTO_SOURCE):
    if name not in TABLES:
        raise FormatError('This adapter only supports the audited Interlude presentation tables')
    pins = {'crypto-definition': hashlib.sha256(checked_bytes(crypto_source, CRYPTO_HASH)).hexdigest()}
    for relative in ('06_interlude.xml', 'dats/' + name + '.xml'):
        pins[relative] = hashlib.sha256(checked_bytes(schema_root / relative, SCHEMA_HASHES[relative])).hexdigest()
    if name == 'armorgrp':
        pins['definitions.xml#MTX'] = hashlib.sha256(checked_bytes(schema_root.parent / 'definitions.xml', MTX_DEFINITION_EVIDENCE['sha256'])).hexdigest()
    if name == 'npcname':
        for relative, expected in RGBA_DEFINITION_EVIDENCE['files'].items():
            pins[relative + '#RGBA'] = hashlib.sha256(checked_bytes(schema_root.parents[2] / relative, expected)).hexdigest()
    return pins


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
        return reader.string()
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


def require_exact_directory_entry_spelling(directory, file_name):
    if file_name not in {path.name for path in directory.iterdir() if path.is_file()}:
        raise FormatError('Native npcname filename does not exactly match a source directory entry')


def table_source_path(client, name, file_pattern, source_filename=None):
    system = client / 'system'
    if name == 'npcname':
        if source_filename is None:
            matches = sorted(path.name for path in system.iterdir()
                             if path.is_file() and re.fullmatch(file_pattern, path.name))
            if len(matches) != 1:
                raise FormatError('Native npcname requires one matching language file or an explicit source_filename')
            source_filename = matches[0]
        if not isinstance(source_filename, str) or '/' in source_filename or '\\' in source_filename or not re.fullmatch(file_pattern, source_filename):
            raise FormatError('Native npcname filename must match the exact Interlude language-file pattern')
        require_exact_directory_entry_spelling(system, source_filename)
    else:
        if source_filename is not None and source_filename != name + '.dat':
            raise FormatError('Explicit source filename is unsupported for this table')
        source_filename = name + '.dat'
    path = (system / source_filename).resolve(strict=True)
    if not path.is_relative_to(client):
        raise FormatError('Native table path escapes selected client')
    return path


def decode_table(client, name, schema_root=SCHEMA_ROOT, crypto_source=CRYPTO_SOURCE, *, source_filename=None):
    client = client.resolve(strict=True)
    if name not in TABLES:
        raise FormatError('This adapter only supports the audited Interlude presentation tables')
    definition_pins = table_definition_pins(name, schema_root, crypto_source)
    descriptor_bytes = checked_bytes(schema_root / '06_interlude.xml', SCHEMA_HASHES['06_interlude.xml'])
    descriptor = ET.fromstring(descriptor_bytes)
    links = [entry for entry in descriptor if entry.get('file') == name]
    if descriptor.get('name') != 'CT0 Interlude' or len(links) != 1:
        raise FormatError('Missing unambiguous Interlude table descriptor')
    pattern = links[0].get('version')
    schema_name = 'dats/' + name + '.xml'
    schema_bytes = checked_bytes(schema_root / schema_name, SCHEMA_HASHES[schema_name])
    layouts = [entry for entry in ET.fromstring(schema_bytes) if entry.get('pattern') == pattern]
    if len(layouts) != 1 or layouts[0].get('isSafePackage') != 'true':
        raise FormatError('Missing audited safe-package table layout')
    path = table_source_path(client, name, links[0].get('pattern'), source_filename)
    raw = path.read_bytes()
    key_family, decoded = decode413(raw, crypto_source)
    reader = Reader(decoded)
    rows = read_nodes(reader, layouts[0])
    trailer = decoded[reader.position:]
    if trailer != SAFE_PACKAGE_TRAILER:
        raise FormatError(f'Unexpected safe-package trailer: {name}: {trailer.hex()}')
    if name in ('armorgrp', 'weapongrp', 'npcgrp', 'npcname'):
        collection, key = {'npcgrp': ('npc', 'npc_id'), 'npcname': ('npc', 'id')}.get(name, ('item', 'object_id'))
        ids = [row[key] for row in rows[collection]]
        if rows['data'] != len(ids) or len(set(ids)) != len(ids):
            raise FormatError('Native item/NPC identifiers are not unique or do not match the declared count')
    schema = {'descriptor': '06_interlude.xml', 'layout': pattern,
        'descriptorSha256': SCHEMA_HASHES['06_interlude.xml'], 'file': schema_name, 'sha256': SCHEMA_HASHES[schema_name]}
    if name == 'armorgrp':
        schema['compoundDefinitionEvidence'] = dict(MTX_DEFINITION_EVIDENCE)
    if name == 'npcname':
        schema['primitiveDefinitionEvidence'] = dict(RGBA_DEFINITION_EVIDENCE)
        schema['sourcePattern'] = links[0].get('pattern')
    source = path.relative_to(client).as_posix() if name == 'npcname' else 'system/' + name + '.dat'
    return {'schemaVersion': 1, 'edition': 'interlude', 'source': source,
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'decodedSha256': hashlib.sha256(decoded).hexdigest(),
        'keyFamily': key_family, 'decodedBytes': len(decoded), 'consumedBytes': reader.position,
        'trailerHex': trailer.hex(), 'schema': schema, 'formatDefinitionPins': definition_pins,
        'data': rows, 'limitations': ['Native client presentation bindings only, not authoritative gameplay.',
            'Native field names and values retained; no cross-edition joins or fallback substitutions.',
            'Skill action-code to skeletal animation dispatch and effect runtime equivalence require separate verification.']}
