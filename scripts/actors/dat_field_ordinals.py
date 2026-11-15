from functools import lru_cache
import xml.etree.ElementTree as ET

from native_catalog.table_layout_pins import MTX_DEFINITION_EVIDENCE
from native_catalog.tables import SCHEMA_ROOT, checked_bytes

SCALAR_FIELD_READERS = frozenset({'UINT', 'INT', 'UCHAR', 'USHORT', 'SHORT', 'UBYTE', 'FLOAT', 'UNICODE', 'ASCF', 'CNTR', 'RGBA'})
DESCRIPTOR_FIELD_ELEMENTS = ('node', 'for', 'wrapper')
COUNT_REFERENCE_PREFIX = '#'
DECODED_COUNTS_KEY = '_counts'


class UnreadLayoutConstruct(Exception):
    pass


def descriptor_record_collection(layout):
    collections = [element for element in layout if element.tag == 'for' and element.get('hidden') == 'false']
    if len(collections) != 1:
        collections = [element for element in layout if element.tag == 'for']
    if len(collections) != 1:
        raise ValueError(f'descriptor layout holds {len(collections)} record collections; one is required')
    return collections[0]


@lru_cache(maxsize=1)
def pinned_compound_definitions():
    definitions = ET.fromstring(checked_bytes(SCHEMA_ROOT.parent / 'definitions.xml', MTX_DEFINITION_EVIDENCE['sha256']))
    return {definition.get('name'): list(definition) for definition in definitions
            if definition.get('name') == MTX_DEFINITION_EVIDENCE['definition']}


class FieldOrdinalWalk:
    def __init__(self):
        self.position, self.counted_length, self.counted_lists = 0, 0, 0

    def terms(self):
        return self.position - self.counted_length, self.counted_lists

    def walk_reader_node(self, node, value):
        reader = node.get('reader')
        if reader in SCALAR_FIELD_READERS:
            self.position += 1
            return
        if not isinstance(value, dict):
            raise UnreadLayoutConstruct(f'compound field {node.get("name")} holds no decoded record')
        definitions = pinned_compound_definitions()
        if reader not in definitions:
            raise UnreadLayoutConstruct(f'reader {reader} has no pinned definition')
        self.walk_nodes(definitions[reader], value)

    def walk_counted_list(self, node, row):
        name = node.get('name')
        if not node.get('size', '').startswith(COUNT_REFERENCE_PREFIX):
            raise UnreadLayoutConstruct(f'list {name} has no count field')
        elements = list(node)
        if len(elements) != 1 or elements[0].tag != 'node' or elements[0].get('reader') not in SCALAR_FIELD_READERS:
            raise UnreadLayoutConstruct(f'list {name} elements are not one scalar field each')
        values = row.get(name)
        if not isinstance(values, list):
            raise UnreadLayoutConstruct(f'list {name} holds no decoded elements')
        count = row.get(DECODED_COUNTS_KEY, {}).get(name, len(values))
        self.position += count
        self.counted_length += count
        self.counted_lists += 1

    def walk_conditional_block(self, node, row):
        names = [child.get('name') for child in node]
        held = [name for name in names if name in row]
        if held and len(held) != len(names):
            raise UnreadLayoutConstruct(f'conditional block {node.get("name")} is partly decoded')
        if held:
            self.walk_nodes(list(node), row)

    def walk_element(self, node, row):
        name = node.get('name')
        if node.tag == 'node':
            self.walk_reader_node(node, row.get(name))
        elif node.tag == 'for':
            self.walk_counted_list(node, row)
        elif node.tag == 'wrapper':
            if not isinstance(row.get(name), dict):
                raise UnreadLayoutConstruct(f'wrapper {name} holds no decoded record')
            self.walk_nodes(list(node), row[name])
        elif node.tag == 'if':
            self.walk_conditional_block(node, row)
        else:
            raise UnreadLayoutConstruct(f'layout element {node.tag} is not read')

    def walk_nodes(self, nodes, row, field_terms=None):
        for node in nodes:
            start = self.terms()
            try:
                self.walk_element(node, row)
            except UnreadLayoutConstruct:
                if field_terms is not None:
                    field_terms.pop(node.get('name'), None)
                raise
            if field_terms is not None and node.tag in DESCRIPTOR_FIELD_ELEMENTS:
                field_terms[node.get('name')] = start


def row_field_terms(collection, row):
    field_terms = {}
    try:
        FieldOrdinalWalk().walk_nodes(list(collection), row, field_terms)
    except UnreadLayoutConstruct:
        pass
    return field_terms


def descriptor_field_ordinal_terms(layout, rows):
    collection = descriptor_record_collection(layout)
    terms_by_row = [row_field_terms(collection, row) for row in rows]
    if not terms_by_row:
        return {}
    return {name: {'ordinalConstant': constant, 'ordinalCountTerms': count_terms}
            for name, (constant, count_terms) in terms_by_row[0].items()
            if all(terms.get(name) == (constant, count_terms) for terms in terms_by_row[1:])}
