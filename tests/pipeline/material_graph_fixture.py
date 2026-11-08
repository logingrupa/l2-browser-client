from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct

from native_catalog.ue2 import Package

MATERIAL_GRAPH_FIXTURE_ROOT = Path(__file__).resolve().parents[1] / 'fixtures' / 'material-graph'
PROPERTY_SIZE_CODES = {1: 0, 2: 1, 4: 2, 12: 3, 16: 4}
ARRAY_INDEX_FLAG = 128
BOOL_TRUE_FLAG = 128


def compact(value):
    negative, magnitude = value < 0, abs(value)
    encoded = bytearray([(magnitude & 63) | (128 if negative else 0)])
    magnitude >>= 6
    if magnitude:
        encoded[0] |= 64
    while magnitude:
        low_bits, magnitude = magnitude & 127, magnitude >> 7
        encoded.append(low_bits | (128 if magnitude else 0))
    return bytes(encoded)


class SyntheticPackageTables:
    def __init__(self):
        self.names = ['None']
        self.imports = []

    def name_index(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    def import_index(self, class_package, class_name, outer_index, name):
        for text in (class_package, class_name, name):
            self.name_index(text)
        record = {'classPackage': class_package, 'className': class_name, 'outerIndex': outer_index, 'name': name}
        if record not in self.imports:
            self.imports.append(record)
        return -(self.imports.index(record) + 1)

    def package_import(self, package_name):
        return self.import_index('Core', 'Package', 0, package_name)

    def class_import(self, class_object):
        package_name, class_name = class_object.split('.')
        return self.import_index('Core', 'Class', self.package_import(package_name), class_name)

    def object_import(self, object_name, class_object):
        package_name, leaf_name = object_name.split('.')
        class_package, class_name = class_object.split('.')
        return self.import_index(class_package, class_name, self.package_import(package_name), leaf_name)


def encoded_property_payload(tables, export_indexes, record):
    if 'object' in record:
        return 5, compact(0 if record['object'] is None else export_indexes[record['object']]), None
    if 'importedObject' in record:
        return 5, compact(tables.object_import(record['importedObject'], record['importedClass'])), None
    if 'byte' in record:
        return 1, bytes([record['byte']]), None
    if 'int' in record:
        return 2, struct.pack('<i', record['int']), None
    if 'float' in record:
        return 4, struct.pack('<f', record['float']), None
    if 'bool' in record:
        return 3, b'', None
    if 'struct' in record:
        return 10, bytes.fromhex(record['payloadHex']), tables.name_index(record['struct'])
    if 'arrayPayloadHex' in record:
        return 9, bytes.fromhex(record['arrayPayloadHex']), None
    raise ValueError(f'synthetic property record has no value: {record!r}')


def encoded_property(tables, export_indexes, record):
    kind, payload, struct_name_index = encoded_property_payload(tables, export_indexes, record)
    array_index = record.get('arrayIndex')
    size_code = 0 if kind == 3 else PROPERTY_SIZE_CODES.get(len(payload), 5)
    information = kind | (size_code << 4)
    if kind == 3 and record['bool']:
        information |= BOOL_TRUE_FLAG
    if array_index is not None:
        information |= ARRAY_INDEX_FLAG
    encoded = compact(tables.name_index(record['name'])) + bytes([information])
    if struct_name_index is not None:
        encoded += compact(struct_name_index)
    if size_code == 5:
        encoded += bytes([len(payload)])
    if array_index is not None:
        encoded += bytes([array_index])
    return encoded + payload


def build_synthetic_material_package(fixture_name):
    fixture = json.loads((MATERIAL_GRAPH_FIXTURE_ROOT / fixture_name).read_text(encoding='utf-8'))
    tables = SyntheticPackageTables()
    export_indexes = {export['name']: index for index, export in enumerate(fixture['exports'], 1)}
    data, exports = bytearray(), []
    for index, export in enumerate(fixture['exports'], 1):
        body = b''.join(encoded_property(tables, export_indexes, record) for record in export['properties'])
        body += compact(tables.name_index('None')) + bytes.fromhex(export.get('tailHex', ''))
        exports.append({'exportIndex': index, 'classIndex': tables.class_import(export['class']), 'superIndex': 0, 'outerIndex': 0,
                        'name': export['name'], 'flags': 0, 'size': len(body), 'offset': len(data)})
        tables.name_index(export['name'])
        data += body
    package = Package.__new__(Package)
    package.filename = fixture['file']
    package.package_name = fixture['file'].rsplit('.', 1)[0]
    package.data = bytes(data)
    package.source_hash = hashlib.sha256(package.data).hexdigest()
    package.summary = {'version': fixture['packageVersion'], 'licenseeVersion': fixture['licensee']}
    package.names, package.imports, package.exports = tables.names, tables.imports, exports
    for item in exports:
        item['object'] = package.object_name(item['exportIndex'])
        item['classObject'] = package.object_name(item['classIndex'])
        item['className'] = item['classObject'].rsplit('.', 1)[-1]
    for index, item in enumerate(package.imports, 1):
        item['object'] = package.object_name(-index)
    return package


def synthetic_export(package, name):
    return next(item for item in package.exports if item['name'] == name)
