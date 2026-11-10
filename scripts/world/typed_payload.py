import json
import math
from pathlib import Path
import re
import struct
from typing import NamedTuple

from native_store.catalog_writer import immutable_write, sha256_hex
from native_store.store_paths import REPOSITORY_ROOT, require_converter_output

TYPED_PAYLOAD_UNITS = 'source'
TYPED_PAYLOAD_AXES = 'ue2-z-up'
TYPED_PAYLOAD_ASSET_NAME = 'asset.json'
TYPED_PAYLOAD_PAYLOAD_NAME = 'payload.bin'
TYPED_PAYLOAD_ALIGNMENT = 4
ARRAY_NAME_PATTERN = re.compile(r'^[A-Z]{4}\.[a-z][A-Za-z0-9]*$')
SHA256_PATTERN = re.compile(r'^[0-9a-f]{64}$')
STRUCT_FORMAT_OF_TYPE = {'float32': 'f', 'int32': 'i', 'uint32': 'I', 'uint8': 'B'}
BYTES_PER_ELEMENT_OF_TYPE = {'float32': 4, 'int32': 4, 'uint32': 4, 'uint8': 1}
INTEGER_RANGE_OF_TYPE = {'int32': (-2 ** 31, 2 ** 31 - 1), 'uint32': (0, 2 ** 32 - 1), 'uint8': (0, 255)}
FLOAT32_MAXIMUM = struct.unpack('<f', struct.pack('<I', 0x7F7FFFFF))[0]


class TypedPayloadError(ValueError):
    pass


class TypedPayloadArray(NamedTuple):
    name: str
    type: str
    values: tuple


class TypedPayloadAsset(NamedTuple):
    asset_record: dict
    asset_bytes: bytes
    payload_bytes: bytes

    @property
    def asset_sha256(self):
        return sha256_hex(self.asset_bytes)


def require_array_values(array):
    if array.type in INTEGER_RANGE_OF_TYPE:
        minimum, maximum = INTEGER_RANGE_OF_TYPE[array.type]
        if not all(type(value) is int and minimum <= value <= maximum for value in array.values):
            raise TypedPayloadError(f'array {array.name} holds a value outside {array.type}')
    elif not all(type(value) in (int, float) and math.isfinite(value) and abs(value) <= FLOAT32_MAXIMUM for value in array.values):
        raise TypedPayloadError(f'array {array.name} holds a value that is not a finite float32')


def require_payload_metadata(asset_metadata):
    if set(asset_metadata) != {'sourceSha256', 'converterVersion'}:
        raise TypedPayloadError(f'typed payload metadata must hold exactly sourceSha256 and converterVersion: {sorted(asset_metadata)}')
    if not (isinstance(asset_metadata['sourceSha256'], str) and SHA256_PATTERN.fullmatch(asset_metadata['sourceSha256'])):
        raise TypedPayloadError(f'typed payload sourceSha256 must be 64 lowercase hex digits: {asset_metadata["sourceSha256"]!r}')
    if not (isinstance(asset_metadata['converterVersion'], str) and asset_metadata['converterVersion']):
        raise TypedPayloadError('typed payload converterVersion must be a non-empty string')


def typed_payload_asset_text(asset_record):
    return (json.dumps(asset_record, indent=2) + '\n').encode('ascii')


def typed_payload_asset(arrays, asset_metadata):
    require_payload_metadata(asset_metadata)
    payload, records, names = bytearray(), [], set()
    for array in arrays:
        if not (isinstance(array.name, str) and ARRAY_NAME_PATTERN.fullmatch(array.name)):
            raise TypedPayloadError(f'array name {array.name!r} does not match <GROUP>.<field> with a four-letter group')
        if array.name in names:
            raise TypedPayloadError(f'array {array.name} is listed more than once')
        if array.type not in STRUCT_FORMAT_OF_TYPE:
            raise TypedPayloadError(f'array {array.name} has unknown type {array.type!r}')
        require_array_values(array)
        names.add(array.name)
        byte_offset = len(payload)
        payload.extend(struct.pack(f'<{len(array.values)}{STRUCT_FORMAT_OF_TYPE[array.type]}', *array.values))
        records.append({'name': array.name, 'type': array.type, 'count': len(array.values), 'byteOffset': byte_offset,
                        'byteLength': len(array.values) * BYTES_PER_ELEMENT_OF_TYPE[array.type]})
        payload.extend(bytes(-len(payload) % TYPED_PAYLOAD_ALIGNMENT))
    payload_bytes = bytes(payload)
    asset_record = {'units': TYPED_PAYLOAD_UNITS, 'axes': TYPED_PAYLOAD_AXES, 'sourceSha256': asset_metadata['sourceSha256'],
                    'converterVersion': asset_metadata['converterVersion'], 'arrays': records,
                    'payload': {'file': TYPED_PAYLOAD_PAYLOAD_NAME, 'sha256': sha256_hex(payload_bytes), 'bytes': len(payload_bytes)}}
    return TypedPayloadAsset(asset_record, typed_payload_asset_text(asset_record), payload_bytes)


def write_typed_payload_asset(output_directory, arrays, asset_metadata):
    directory = require_converter_output(REPOSITORY_ROOT, Path(output_directory))
    asset = typed_payload_asset(arrays, asset_metadata)
    for name, payload in ((TYPED_PAYLOAD_PAYLOAD_NAME, asset.payload_bytes), (TYPED_PAYLOAD_ASSET_NAME, asset.asset_bytes)):
        immutable_write(directory / name, payload)
    return asset


def write_tile_typed_payload_resource(store_root, folder, arrays, asset_metadata):
    asset = typed_payload_asset(arrays, asset_metadata)
    relative = f'maps/{asset.asset_sha256}/{folder}'
    directory = store_root / relative
    write_typed_payload_asset(directory, arrays, asset_metadata)
    outputs = [{'path': (directory / name).relative_to(store_root.parent).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
               for name, payload in ((TYPED_PAYLOAD_ASSET_NAME, asset.asset_bytes), (TYPED_PAYLOAD_PAYLOAD_NAME, asset.payload_bytes))]
    return {'resource': f'/l2/{relative}/{TYPED_PAYLOAD_ASSET_NAME}', 'sha256': asset.asset_sha256, 'bytes': len(asset.asset_bytes)}, outputs
