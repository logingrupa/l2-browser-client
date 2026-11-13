import math

from native_catalog.effects import tagged_values
from native_catalog.ue2 import FormatError, Reader
from native_effect_bundle import object_values
from world.declared_property_types import PropertyScope, container_inner_type
from world.map_actor_properties import MAXIMUM_ARRAY_ELEMENTS, MAXIMUM_PROPERTY_NESTING_DEPTH

ARRAY_PROPERTY_TYPE = 9
STRUCT_PROPERTY_TYPE = 10
DECODED_PROPERTY_TYPES = (ARRAY_PROPERTY_TYPE, STRUCT_PROPERTY_TYPE)
NUMERIC_ELEMENT_FORMATS = {'float': 'f', 'int': 'i', 'byte': 'B'}
NAME_ELEMENT_TYPE = 'name'
BYTE_ELEMENT_FORMAT = 'B'


class StructPropertyValueError(FormatError):
    pass


def unparsed_value(tag):
    return {'unparsedHex': tag['payloadHex'], 'type': tag['type'], 'struct': tag['structName']}


def member_path(parent_path, name, array_index):
    path = name if not parent_path else f'{parent_path}.{name}'
    return path if array_index is None else f'{path}[{array_index}]'


def payload_end(tag):
    return tag['payloadOffset'] + len(tag['payloadHex']) // 2


def finite_numbers(values, path):
    if not all(math.isfinite(value) for value in values.values() if isinstance(value, float)):
        raise StructPropertyValueError(f'{path} holds a non-finite number')
    return values


def decoded_binary_struct(reader, layout, path):
    if reader.end - reader.position < layout.byte_count:
        raise StructPropertyValueError(f'{path} at offset {reader.position}: binary {layout.name} needs {layout.byte_count} bytes, '
                                       f'{reader.end - reader.position} remain')
    return finite_numbers({member: reader.number(member_format) for member, member_format in layout.members}, path)


class StructPropertyDecoder:
    def __init__(self, package, declared_types, rules):
        self.package, self.declared_types, self.rules = package, declared_types, rules

    def tag_values(self, tags, scope, parent_path, depth):
        values = object_values(self.package, tags)
        indexed_names = {tag['name'] for tag in tags if tag['arrayIndex'] is not None}
        for tag in tags:
            if tag['type'] not in DECODED_PROPERTY_TYPES:
                continue
            array_index = tag['arrayIndex'] if tag['arrayIndex'] is not None else (0 if tag['name'] in indexed_names else None)
            value = self.tag_value(tag, scope, member_path(parent_path, tag['name'], array_index), depth)
            if array_index is None:
                values[tag['name']] = value
            else:
                values[tag['name']][array_index] = value
        return values

    def tag_value(self, tag, scope, path, depth):
        if depth > MAXIMUM_PROPERTY_NESTING_DEPTH:
            raise StructPropertyValueError(f'{path} nests deeper than {MAXIMUM_PROPERTY_NESTING_DEPTH} structs')
        if tag['type'] == STRUCT_PROPERTY_TYPE:
            return self.struct_payload_value(tag, scope, path, depth)
        if tag['type'] == ARRAY_PROPERTY_TYPE:
            return self.array_payload_value(tag, scope, path, depth)
        return tagged_values(self.package, [{**tag, 'arrayIndex': None}])[tag['name']]

    def struct_payload_value(self, tag, scope, path, depth):
        reader = Reader(self.package.data, tag['payloadOffset'], payload_end(tag))
        value = self.struct_value(reader, tag['structName'], scope, path, depth)
        if reader.position != reader.end:
            raise StructPropertyValueError(f'{path} at offset {reader.position}: {reader.end - reader.position} bytes follow the {tag["structName"]} value')
        return value

    def struct_value(self, reader, struct_name, scope, path, depth):
        layout = self.rules.binary_struct_layout(struct_name)
        if layout is not None:
            return decoded_binary_struct(reader, layout, path)
        version = self.package.summary['version']
        if version < self.rules.minimum_tagged_package_version:
            raise StructPropertyValueError(f'{path}: tagged struct {struct_name} needs package version {self.rules.minimum_tagged_package_version}, '
                                           f'the package is {version}')
        start = reader.position
        try:
            tags, tail = self.package.properties({'offset': start, 'size': reader.end - start})
            reader.position = tail.position
            return self.tag_values(tags, PropertyScope(scope.class_name, struct_name), path, depth + 1)
        except StructPropertyValueError:
            raise
        except FormatError as error:
            raise StructPropertyValueError(f'{path} at offset {start}: {error}') from error

    def array_payload_value(self, tag, scope, path, depth):
        element_type = container_inner_type(self.declared_types.property_type(scope, tag['name']), 'array')
        read_element = None if element_type is None else self.element_reader(element_type, scope, depth)
        if read_element is None:
            return unparsed_value(tag)
        reader = Reader(self.package.data, tag['payloadOffset'], payload_end(tag))
        try:
            count = reader.count(MAXIMUM_ARRAY_ELEMENTS)
        except FormatError as error:
            raise StructPropertyValueError(f'{path} at offset {tag["payloadOffset"]}: {error}') from error
        values = [read_element(reader, f'{path}[{index}]') for index in range(count)]
        if reader.position != reader.end:
            raise StructPropertyValueError(f'{path} at offset {reader.position}: {reader.end - reader.position} bytes follow its {count} elements')
        return values

    def element_reader(self, element_type, scope, depth):
        if self.rules.binary_struct_layout(element_type) is not None or self.declared_types.is_struct(scope, element_type):
            return lambda reader, path: self.struct_value(reader, element_type, scope, path, depth)
        if element_type.casefold() in NUMERIC_ELEMENT_FORMATS:
            return self.number_element_reader(NUMERIC_ELEMENT_FORMATS[element_type.casefold()])
        if element_type.casefold() == NAME_ELEMENT_TYPE:
            return lambda reader, path: self.package.name(self.element_compact(reader, path))
        if self.declared_types.is_enum(scope, element_type):
            return self.number_element_reader(BYTE_ELEMENT_FORMAT)
        if self.declared_types.is_object_class(scope, element_type):
            return self.object_element
        return None

    def number_element_reader(self, element_format):
        def read_number(reader, path):
            value = self.element_number(reader, element_format, path)
            if isinstance(value, float) and not math.isfinite(value):
                raise StructPropertyValueError(f'{path} holds a non-finite number')
            return value
        return read_number

    def object_element(self, reader, path):
        object_name = self.package.object_name(self.element_compact(reader, path))
        return {'class': 'Object', 'object': object_name} if object_name else None

    def element_number(self, reader, element_format, path):
        try:
            return reader.number(element_format)
        except FormatError as error:
            raise StructPropertyValueError(f'{path} at offset {reader.position}: {error}') from error

    def element_compact(self, reader, path):
        try:
            return reader.compact()
        except FormatError as error:
            raise StructPropertyValueError(f'{path} at offset {reader.position}: {error}') from error


def decode_property_tags(package, tags, owner_class, declared_types, rules):
    return StructPropertyDecoder(package, declared_types, rules).tag_values(tags, PropertyScope(owner_class, None), '', 0)
