from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import re
import struct
import xml.etree.ElementTree as ET

from data.pinned_elbera_module import load_pinned_elbera_module
from native_catalog.tables import SAFE_PACKAGE_TRAILER, SCHEMA_ROOT, SYSTEM_FOLDER_NAME, checked_bytes, decode413, read_value
from native_catalog.ue2 import Reader
from reference_client_guard import require_reference_client

ELBERA_HAIR_SELECTION_SCRIPT_PATH = 'tools/ui/check_hair_selection_native.py'
ELBERA_HAIR_SELECTION_SCRIPT_SHA256 = 'd21095f2b8f0d88102f0667601704d44b5079fd71d92fb1bee224da3fa701590'
ELBERA_HAIR_FIELD_PROOF = 'Elbera 07b24 proof, unverified on 4dd2'
HAIR_LAYOUT_UNDECODED_REASON = 'hair-layout-undecoded'
HELMET_LAYOUT_UNDECODED_REASON = 'helmet-layout-undecoded'
HAIR_TABLE_PARSERS = {'hairgrp': 'hair_pairs', 'helmetgrp': 'keyed_hair_pairs', 'hairaccessarygrp': 'keyed_hair_pairs'}
HAIR_TABLE_UNDECODED_REASONS = {'hairgrp': HAIR_LAYOUT_UNDECODED_REASON, 'helmetgrp': HELMET_LAYOUT_UNDECODED_REASON,
                                'hairaccessarygrp': HAIR_LAYOUT_UNDECODED_REASON}
HAIRGRP_TABLE = 'hairgrp'
HAIRGRP_LAYOUT_SCHEMA_NAME = 'dats/hairgrp.xml'
HAIRGRP_LAYOUT_SHA256 = '83662b49bb051535155951150cdc3c981cef7b322057a65f46dc921bd8893bf6'
HAIRGRP_LAYOUT_PATTERN = 'Interlude'
ELBERA_INT32_WORD_BYTES = 4
FIRST_DISAGREEMENT_OFFSET_LIMIT = 16
INTERLUDE_DDF_FOLDER = 'L2FileEdit-master/data/l2asm-disasm/DAT_defs/Interlude'
INTERLUDE_DDF_PATHS = {HAIRGRP_TABLE: f'{INTERLUDE_DDF_FOLDER}/hairgrp.ddf'}
DDF_CROSS_CHECK_COMPARED_STATUS = 'ddf cross-check compared'
DDF_CROSS_CHECK_UNRESOLVED_STATUS = 'ddf cross-check unresolved'
NO_INTERLUDE_DDF_STATUS = 'no Interlude ddf'
DDF_RECORD_COUNT_KEY = 'RECCNT'
DDF_COMMENT_PATTERN = re.compile(r'//[^\r\n]*')
DDF_HEADER_ASSIGNMENT_PATTERN = re.compile(r'([A-Z_]+)\s*=\s*([^;]+);')
DDF_FIELD_DECLARATION_PATTERN = re.compile(r'([A-Z]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;')


class HairTableAdapterError(ValueError):
    pass


class HairTableUndecodedError(ValueError):
    def __init__(self, table, reason, parser_message):
        super().__init__(f'{table}: {reason}: {parser_message}')
        self.table = table
        self.reason = reason


class DdfDeclarationsUnreadableError(ValueError):
    pass


def require_hair_table(table):
    if table not in HAIR_TABLE_PARSERS:
        raise HairTableAdapterError(f'{table} has no Elbera hair table parser; known: {", ".join(sorted(HAIR_TABLE_PARSERS))}')


def hair_table_source_path(table):
    require_hair_table(table)
    return f'{SYSTEM_FOLDER_NAME}/{table}.dat'


def elbera_hair_table_parser(elbera_module, table):
    parsers_by_name = {'hair_pairs': elbera_module.hair_pairs, 'keyed_hair_pairs': elbera_module.keyed_hair_pairs}
    return parsers_by_name[HAIR_TABLE_PARSERS[table]]


def parse_decoded_hair_table(table, decoded_bytes):
    require_hair_table(table)
    elbera_module = load_pinned_elbera_module(ELBERA_HAIR_SELECTION_SCRIPT_PATH, ELBERA_HAIR_SELECTION_SCRIPT_SHA256)
    try:
        return elbera_hair_table_parser(elbera_module, table)(decoded_bytes)
    except ValueError as error:
        raise HairTableUndecodedError(table, HAIR_TABLE_UNDECODED_REASONS[table], str(error)) from error


def read_decoded_hair_table_bytes(client_access, table):
    source_path = hair_table_source_path(table)
    raw = client_access.require_equal_file(source_path).read_bytes()
    key_family, decoded_bytes = decode413(raw)
    return {'sourcePath': source_path, 'sourceSha256': hashlib.sha256(raw).hexdigest(), 'keyFamily': key_family,
            'decodedBytes': decoded_bytes}


def decode_hair_table(client_access, table):
    decoded_source = read_decoded_hair_table_bytes(client_access, table)
    records = parse_decoded_hair_table(table, decoded_source['decodedBytes'])
    return {'sourcePath': decoded_source['sourcePath'], 'sourceSha256': decoded_source['sourceSha256'], 'records': records,
            'recordCount': len(records), 'decodedBytes': len(decoded_source['decodedBytes']), 'keyFamily': decoded_source['keyFamily']}


def hairgrp_layout_xml_bytes(schema_root=SCHEMA_ROOT):
    return checked_bytes(Path(schema_root) / HAIRGRP_LAYOUT_SCHEMA_NAME, HAIRGRP_LAYOUT_SHA256)


def declared_layout_reader(layout_xml_bytes):
    layouts = [entry for entry in ET.fromstring(layout_xml_bytes) if entry.get('pattern') == HAIRGRP_LAYOUT_PATTERN]
    if len(layouts) != 1:
        raise HairTableAdapterError(f'{HAIRGRP_LAYOUT_SCHEMA_NAME} has {len(layouts)} {HAIRGRP_LAYOUT_PATTERN} layouts, expected 1')
    readers = sorted({node.get('reader') for node in layouts[0].iter('node')})
    if len(readers) != 1 or readers[0] is None:
        raise HairTableAdapterError(f'{HAIRGRP_LAYOUT_SCHEMA_NAME} declares element readers {readers}, expected exactly one')
    return readers[0]


def hair_table_payload(decoded_bytes):
    payload_length = len(decoded_bytes) - len(SAFE_PACKAGE_TRAILER)
    if not decoded_bytes.endswith(SAFE_PACKAGE_TRAILER) or payload_length % ELBERA_INT32_WORD_BYTES:
        raise HairTableAdapterError(f'decoded hair table of {len(decoded_bytes)} bytes is not whole int32 words plus the SafePackage trailer')
    return decoded_bytes[:payload_length]


def hair_table_int32_versus_layout_cross_check(decoded_bytes, layout_xml_bytes):
    declared_reader = declared_layout_reader(layout_xml_bytes)
    payload = hair_table_payload(decoded_bytes)
    agreement_count = 0
    disagreement_offsets = []
    for offset in range(0, len(payload), ELBERA_INT32_WORD_BYTES):
        elbera_int32_value = struct.unpack_from('<i', payload, offset)[0]
        declared_reader_value = read_value(Reader(payload, offset), declared_reader)
        if elbera_int32_value == declared_reader_value:
            agreement_count += 1
        else:
            disagreement_offsets.append(offset)
    return {'declaredReader': declared_reader, 'layoutSchema': HAIRGRP_LAYOUT_SCHEMA_NAME,
            'layoutSha256': hashlib.sha256(layout_xml_bytes).hexdigest(), 'wordCount': len(payload) // ELBERA_INT32_WORD_BYTES,
            'agreementCount': agreement_count, 'disagreementCount': len(disagreement_offsets),
            'firstDisagreementOffsets': disagreement_offsets[:FIRST_DISAGREEMENT_OFFSET_LIMIT]}


def ddf_statements(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def parsed_ddf_declarations(ddf_text):
    text = DDF_COMMENT_PATTERN.sub('', ddf_text)
    if text.count('{') != 1 or text.count('}') != 1 or text.index('{') > text.index('}'):
        raise DdfDeclarationsUnreadableError('ddf does not hold exactly one field block')
    header_text, block_text = text.split('{')
    field_text, trailing_text = block_text.split('}')
    if trailing_text.strip():
        raise DdfDeclarationsUnreadableError('ddf holds text after its field block')
    header = {}
    for statement in ddf_statements(header_text):
        match = DDF_HEADER_ASSIGNMENT_PATTERN.fullmatch(statement)
        if match is None or match[1] in header:
            raise DdfDeclarationsUnreadableError(f'ddf header statement is not one unique NAME = value: {statement!r}')
        header[match[1]] = match[2].strip()
    fields = []
    for statement in ddf_statements(field_text):
        match = DDF_FIELD_DECLARATION_PATTERN.fullmatch(statement)
        if match is None:
            raise DdfDeclarationsUnreadableError(f'ddf field statement is not one TYPE name: {statement!r}')
        fields.append({'type': match[1], 'name': match[2]})
    field_names = [field['name'] for field in fields]
    if not fields or len(set(field_names)) != len(field_names):
        raise DdfDeclarationsUnreadableError('ddf field block is empty or repeats a field name')
    if not header.get(DDF_RECORD_COUNT_KEY, '').isdigit():
        raise DdfDeclarationsUnreadableError(f'ddf header has no integer {DDF_RECORD_COUNT_KEY}')
    return header, fields


def elbera_pair_table_shape(elbera_records):
    words_per_row = {sum(len(pair) for pair in row) for row in elbera_records}
    if len(words_per_row) != 1:
        raise HairTableAdapterError(f'Elbera pair table rows hold {sorted(words_per_row)} int32 words, expected one width')
    return len(elbera_records), words_per_row.pop()


def hair_table_ddf_cross_check(client_access, table, elbera_records):
    require_hair_table(table)
    ddf_path = INTERLUDE_DDF_PATHS.get(table)
    if ddf_path is None:
        return {'table': table, 'status': NO_INTERLUDE_DDF_STATUS, 'reason': f'the locked client has no {table}.ddf in {INTERLUDE_DDF_FOLDER}'}
    ddf_bytes = client_access.require_equal_file(ddf_path).read_bytes()
    evidence = {'table': table, 'ddfPath': ddf_path, 'ddfSha256': hashlib.sha256(ddf_bytes).hexdigest()}
    try:
        header, fields = parsed_ddf_declarations(ddf_bytes.decode('ascii'))
    except (DdfDeclarationsUnreadableError, UnicodeDecodeError) as error:
        return {**evidence, 'status': DDF_CROSS_CHECK_UNRESOLVED_STATUS, 'reason': str(error)}
    elbera_row_count, elbera_words_per_row = elbera_pair_table_shape(elbera_records)
    ddf_record_count = int(header[DDF_RECORD_COUNT_KEY])
    return {**evidence, 'status': DDF_CROSS_CHECK_COMPARED_STATUS, 'ddfHeader': header, 'ddfRecordCount': ddf_record_count,
            'ddfFieldCount': len(fields), 'ddfFieldTypes': sorted({field['type'] for field in fields}),
            'elberaRowCount': elbera_row_count, 'elberaInt32WordsPerRow': elbera_words_per_row,
            'recordCountAgrees': ddf_record_count == elbera_row_count, 'fieldCountAgrees': len(fields) == elbera_words_per_row}


def hairgrp_cross_checks(client_access, schema_root=SCHEMA_ROOT):
    decoded_source = read_decoded_hair_table_bytes(client_access, HAIRGRP_TABLE)
    records = parse_decoded_hair_table(HAIRGRP_TABLE, decoded_source['decodedBytes'])
    return {'table': HAIRGRP_TABLE, 'sourceSha256': decoded_source['sourceSha256'], 'fieldProof': ELBERA_HAIR_FIELD_PROOF,
            'int32VersusLayout': hair_table_int32_versus_layout_cross_check(decoded_source['decodedBytes'], hairgrp_layout_xml_bytes(schema_root)),
            'ddf': {table: hair_table_ddf_cross_check(client_access, table, records if table == HAIRGRP_TABLE else None)
                    for table in sorted(HAIR_TABLE_PARSERS)}}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Print the hairgrp int32 versus layout and ddf cross-checks of the Elbera hair readings.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        print(json.dumps(hairgrp_cross_checks(client_access), indent=1, sort_keys=True))
    except (OSError, ValueError) as error:
        print(f'Hair table cross-check failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
