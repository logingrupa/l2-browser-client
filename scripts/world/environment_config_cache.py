import re
import struct
from typing import NamedTuple

FLOAT_PREFIX = re.compile(r'[ \t]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)')
INTEGER_PREFIX = re.compile(r'[ \t]*([+-]?\d+)')
INTEGER_TEXT = re.compile(r'[+-]?\d+')
FLOAT_TEXT = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)')
BOOLEAN_TEXT = {'true': True, 'false': False}
BYTE_RANGE = range(256)
FIELD_READ = 'read'
FIELD_MISSING = 'missing'
FIELD_UNPARSED = 'unparsed'
FIELD_OUT_OF_BYTE_RANGE = 'out-of-byte-range'


class TupleFieldReading(NamedTuple):
    status: str
    value: object


def float32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def float32_of_text(text):
    try:
        return float32(float(text))
    except OverflowError:
        return None


class EnvironmentConfigFile:
    def __init__(self, records):
        self.sections = {}
        self.section_headers = {}
        for row in records:
            if row['kind'] == 'section':
                folded_name = row['name'].casefold()
                self.sections.setdefault(folded_name, {})
                self.section_headers.setdefault(folded_name, {'name': row['name'], 'lines': []})['lines'].append(row['line'])
            elif row['kind'] == 'property' and row['section'] is not None:
                self.sections.setdefault(row['section'].casefold(), {})[row['key'].casefold()] = row

    def has_section(self, section):
        return section.casefold() in self.sections

    def property(self, section, key):
        return self.sections.get(section.casefold(), {}).get(key.casefold())

    def folded_property_keys(self, section):
        return list(self.sections.get(section.casefold(), {}))

    def merged_duplicate_sections(self):
        return {header['name']: header['lines'] for header in self.section_headers.values() if len(header['lines']) > 1}


def typed_setting_value(text, value_type):
    if text is None:
        return None
    stripped = text.strip()
    if value_type == 'text':
        return stripped
    if value_type == 'boolean':
        return BOOLEAN_TEXT.get(stripped.casefold())
    if value_type == 'integer':
        return int(stripped) if INTEGER_TEXT.fullmatch(stripped) else None
    if value_type == 'float32':
        return float32_of_text(stripped) if FLOAT_TEXT.fullmatch(stripped) else None
    raise ValueError(f'unknown environment setting type {value_type!r}')


def tuple_field_text(text, match):
    position = text.casefold().find(match.casefold())
    return None if position < 0 else text[position + len(match):]


def read_tuple_field(text, match, field_type):
    field_text = tuple_field_text(text, match)
    if field_text is None:
        return TupleFieldReading(FIELD_MISSING, None)
    if field_type == 'float32':
        number = FLOAT_PREFIX.match(field_text)
        value = float32_of_text(number.group(1)) if number else None
        return TupleFieldReading(FIELD_UNPARSED, None) if value is None else TupleFieldReading(FIELD_READ, value)
    if field_type == 'byte':
        number = INTEGER_PREFIX.match(field_text)
        if not number:
            return TupleFieldReading(FIELD_UNPARSED, None)
        value = int(number.group(1))
        return TupleFieldReading(FIELD_READ, value) if value in BYTE_RANGE else TupleFieldReading(FIELD_OUT_OF_BYTE_RANGE, None)
    raise ValueError(f'unknown environment tuple field type {field_type!r}')
