from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import hashlib

from data.pinned_elbera_module import load_pinned_elbera_module
from native_catalog.tables import SYSTEM_FOLDER_NAME, decode413

ELBERA_HAIR_SELECTION_SCRIPT_PATH = 'tools/ui/check_hair_selection_native.py'
ELBERA_HAIR_SELECTION_SCRIPT_SHA256 = 'd21095f2b8f0d88102f0667601704d44b5079fd71d92fb1bee224da3fa701590'
HAIR_TABLE_FIELD_PROOF = ('client int32 layout of system/Engine.dll 4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08: '
                          'FL2GameData::HairDataLoad 0x10451720, HelmHairDataLoad 0x10466140, AccessaryHairDataLoad 0x104675f0')
HAIR_LAYOUT_UNDECODED_REASON = 'hair-layout-undecoded'
HELMET_LAYOUT_UNDECODED_REASON = 'helmet-layout-undecoded'
HAIR_TABLE_PARSERS = {'hairgrp': 'hair_pairs', 'helmetgrp': 'keyed_hair_pairs', 'hairaccessarygrp': 'keyed_hair_pairs'}
HAIR_TABLE_UNDECODED_REASONS = {'hairgrp': HAIR_LAYOUT_UNDECODED_REASON, 'helmetgrp': HELMET_LAYOUT_UNDECODED_REASON,
                                'hairaccessarygrp': HAIR_LAYOUT_UNDECODED_REASON}


class HairTableAdapterError(ValueError):
    pass


class HairTableUndecodedError(ValueError):
    def __init__(self, table, reason, parser_message):
        super().__init__(f'{table}: {reason}: {parser_message}')
        self.table = table
        self.reason = reason


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
