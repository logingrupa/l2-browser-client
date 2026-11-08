from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re

from native_catalog.effects import SourcePackages, UELIB_SHA256, parse_uc, read_class_defaults
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.store_paths import REPOSITORY_ROOT, require_converter_output

CLASS_DEFAULT_PROVENANCES = ('authored', 'class-default', 'ue-zero')
CLASS_DEFAULT_CACHE_FOLDER_NAME = 'class-defaults'
CLASS_DEFAULT_CACHE_SCHEMA_VERSION = 1
DECOMPILE_WORK_FOLDER_NAME = 'decompiled'
MAXIMUM_CLASS_CHAIN_LENGTH = 64
QUALIFIED_CLASS_NAME_PATTERN = re.compile(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+')
FIELD_NAME_PATTERN = re.compile(r'[A-Za-z_]\w*')
STRING_LITERAL_PATTERN = re.compile(r'"(?:\\.|[^"\\\n])*"')
LINE_COMMENT_PATTERN = re.compile(r'//[^\n]*')
BLOCK_COMMENT_PATTERN = re.compile(r'/\*.*?\*/', re.DOTALL)
VARIABLE_STATEMENT_PATTERN = re.compile(r'\s*var\b', re.IGNORECASE)
VARIABLE_DECLARATION_PATTERN = re.compile(r'var\s*(?:\([^)]*\))?\s*(.+)', re.IGNORECASE | re.DOTALL)
DECLARED_NAME_PATTERN = re.compile(r'(\w+)\s*(?:\[[^\]]*\])?\s*$')
REFERENCE_VALUE_FIELDS = frozenset({'class', 'object'})
SYMBOL_VALUE_FIELDS = frozenset({'symbol'})


class ClassDefaultError(ValueError):
    pass


@dataclass(frozen=True)
class ClassDefaultValue:
    field: str
    value: object
    provenance: str
    declaring_class: str | None

    def to_record(self):
        return {'field': self.field, 'value': self.value, 'provenance': self.provenance, 'declaringClass': self.declaring_class}


class ReferenceClientClassScripts:
    def __init__(self, client_root):
        self.client_root = Path(client_root).resolve(strict=True)
        self.packages = SourcePackages(self.client_root)

    def class_identity(self, class_object):
        source, package, item = self.packages.resolve(class_object, 'Class')
        if source['resolution'] != 'exact-qualified-object':
            raise ClassDefaultError(f'class {class_object} does not resolve to an exact qualified export')
        return {'object': source['object'], 'superClass': package.object_name(item['superIndex']), 'package': source['package'],
                'packageSha256': source['packageSha256'], 'uelibSha256': UELIB_SHA256}

    def decompile_class_script(self, class_object, work_directory):
        result = read_class_defaults(self.client_root, class_object, work_directory)
        return (Path(work_directory) / result['sourceScript']).read_text(encoding='utf-8-sig')


def script_text_without_comments_and_strings(script_text):
    without_strings = STRING_LITERAL_PATTERN.sub('""', script_text)
    return BLOCK_COMMENT_PATTERN.sub(' ', LINE_COMMENT_PATTERN.sub('', without_strings))


def top_level_statements(script_text):
    statements, current, depth, braces_belong_to_variable = [], [], 0, False
    for character in script_text_without_comments_and_strings(script_text):
        if character == '{':
            if depth == 0:
                braces_belong_to_variable = bool(VARIABLE_STATEMENT_PATTERN.match(''.join(current)))
                if not braces_belong_to_variable:
                    statements.append(''.join(current))
                    current = []
            depth += 1
        elif character == '}':
            depth -= 1
            if depth < 0:
                raise ClassDefaultError('decompiled class script has an unbalanced closing brace')
        elif depth == 0:
            if character == ';':
                statements.append(''.join(current))
                current = []
            else:
                current.append(character)
    if depth:
        raise ClassDefaultError('decompiled class script has an unclosed brace')
    statements.append(''.join(current))
    return [statement.strip() for statement in statements if statement.strip()]


def declared_field_names(script_text):
    names = set()
    for statement in top_level_statements(script_text):
        if not VARIABLE_STATEMENT_PATTERN.match(statement):
            continue
        declaration = VARIABLE_DECLARATION_PATTERN.fullmatch(statement)
        if declaration is None:
            raise ClassDefaultError(f'decompiled variable declaration is malformed: {statement[:120]}')
        for declarator in declaration[1].split(','):
            name = DECLARED_NAME_PATTERN.search(declarator)
            if name is None:
                raise ClassDefaultError(f'decompiled variable declaration has no name: {statement[:120]}')
            names.add(name[1].casefold())
    return names


def require_field_list(fields):
    if not (isinstance(fields, (list, tuple)) and fields and all(isinstance(field, str) and FIELD_NAME_PATTERN.fullmatch(field) for field in fields)
            and len({field.casefold() for field in fields}) == len(fields)):
        raise ClassDefaultError(f'class-default field list must be non-empty unique identifiers: {fields!r}')
    return list(fields)


def require_qualified_class_name(class_name):
    if not (isinstance(class_name, str) and QUALIFIED_CLASS_NAME_PATTERN.fullmatch(class_name)):
        raise ClassDefaultError(f'class name must be a qualified Package.Class name: {class_name!r}')
    return class_name


def leaf_class_name(class_name):
    return None if class_name is None else class_name.rsplit('.', 1)[-1].casefold()


def decompiled_class_definition(identity, class_scripts, cache_folder):
    class_object = identity['object']
    script_text = class_scripts.decompile_class_script(class_object, cache_folder / DECOMPILE_WORK_FOLDER_NAME / class_object)
    try:
        parsed = parse_uc(script_text, class_object)
    except FormatError as error:
        raise ClassDefaultError(f'decompiled class {class_object} cannot be read: {error}') from error
    if parsed['unparsed']:
        raise ClassDefaultError(f'decompiled class {class_object} has unparsed default properties: {parsed["unparsed"][0]["text"]}')
    if leaf_class_name(parsed['superClass']) != leaf_class_name(identity['superClass']):
        raise ClassDefaultError(f'decompiled superclass {parsed["superClass"]} of {class_object} differs from the export table {identity["superClass"]}')
    return {'schemaVersion': CLASS_DEFAULT_CACHE_SCHEMA_VERSION, 'identity': identity, 'properties': parsed['properties'],
            'declaredFields': sorted(declared_field_names(script_text)),
            'scriptSha256': hashlib.sha256(script_text.encode('utf-8')).hexdigest()}


def read_cached_class_definition(cache_path):
    try:
        return json.loads(cache_path.read_text(encoding='utf-8'))
    except ValueError as error:
        raise ClassDefaultError(f'class-default cache is not JSON: {cache_path}') from error


def cached_class_definition(class_object, class_scripts, cache_folder):
    identity = class_scripts.class_identity(class_object)
    require_qualified_class_name(identity['object'])
    cache_path = cache_folder / f'{identity["object"]}.json'
    if cache_path.is_file():
        cached = read_cached_class_definition(cache_path)
        if cached.get('schemaVersion') == CLASS_DEFAULT_CACHE_SCHEMA_VERSION and cached.get('identity') == identity:
            return cached
    definition = decompiled_class_definition(identity, class_scripts, cache_folder)
    replace_file(cache_path, canonical_json_bytes(definition))
    return definition


def read_class_chain(class_name, class_scripts, cache_folder):
    chain, visited_classes, current_class = [], set(), require_qualified_class_name(class_name)
    while current_class is not None:
        if current_class.casefold() in visited_classes:
            raise ClassDefaultError(f'Cyclic class chain at {current_class} from {class_name}')
        if len(chain) >= MAXIMUM_CLASS_CHAIN_LENGTH:
            raise ClassDefaultError(f'class chain of {class_name} exceeds {MAXIMUM_CLASS_CHAIN_LENGTH} classes')
        visited_classes.add(current_class.casefold())
        definition = cached_class_definition(current_class, class_scripts, cache_folder)
        chain.append(definition)
        current_class = definition['identity']['superClass']
    return chain


def is_struct_value(value):
    return isinstance(value, dict) and set(value) != REFERENCE_VALUE_FIELDS and set(value) != SYMBOL_VALUE_FIELDS


def inherited_value(ancestor_value, descendant_value):
    if is_struct_value(ancestor_value) and is_struct_value(descendant_value):
        merged = dict(ancestor_value)
        for member, value in descendant_value.items():
            merged[member] = inherited_value(merged[member], value) if member in merged else value
        return merged
    if isinstance(ancestor_value, list) and isinstance(descendant_value, list):
        merged = list(ancestor_value) + [None] * max(0, len(descendant_value) - len(ancestor_value))
        for index, value in enumerate(descendant_value):
            if value is not None:
                merged[index] = value
        return merged
    return descendant_value


def property_value(definition, field):
    matches = [name for name in definition['properties'] if name.casefold() == field.casefold()]
    if len(matches) > 1:
        raise ClassDefaultError(f'class {definition["identity"]["object"]} sets {field} under two spellings')
    return (True, definition['properties'][matches[0]]) if matches else (False, None)


def class_default_value(field, chain):
    setters = []
    for definition in chain:
        is_set, value = property_value(definition, field)
        if is_set:
            setters.append((definition, value))
    if setters:
        value = setters[-1][1]
        for _, descendant_value in reversed(setters[:-1]):
            value = inherited_value(value, descendant_value)
        nearest_setter = setters[0][0]
        provenance = 'authored' if nearest_setter is chain[0] else 'class-default'
        return ClassDefaultValue(field, value, provenance, nearest_setter['identity']['object'])
    declaring = [definition for definition in chain if field.casefold() in definition['declaredFields']]
    if not declaring:
        raise ClassDefaultError(f'{field} is not declared by the class chain of {chain[0]["identity"]["object"]}')
    if len(declaring) > 1:
        raise ClassDefaultError(f'{field} is declared by more than one class in the chain of {chain[0]["identity"]["object"]}')
    return ClassDefaultValue(field, None, 'ue-zero', declaring[0]['identity']['object'])


def read_class_defaults_with_provenance(class_name, fields, work_root, class_scripts):
    requested_fields = require_field_list(fields)
    require_qualified_class_name(class_name)
    cache_folder = require_converter_output(REPOSITORY_ROOT, Path(work_root) / CLASS_DEFAULT_CACHE_FOLDER_NAME)
    chain = read_class_chain(class_name, class_scripts, cache_folder)
    return [class_default_value(field, chain) for field in requested_fields]
