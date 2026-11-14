import functools
import hashlib
import json
from pathlib import Path
import re
from typing import NamedTuple

from native_assets_lib.class_defaults import (CLASS_DEFAULT_CACHE_FOLDER_NAME, DECOMPILE_WORK_FOLDER_NAME, ClassDefaultError, declared_fields,
                                              read_class_field_declarations, script_text_without_comments_and_strings)
from native_catalog.ue2 import FormatError
from world.class_default_reads import kept_class_chain, kept_read

FIELD_DECLARATIONS_READ_KIND = 'field-declarations'
DECOMPILE_DEFAULTS_NAME = 'defaults.json'
STRUCT_HEADER_PATTERN = re.compile(r'struct\s+(?:\w+\s+)*?(\w+)(?:\s+extends\s+([\w.]+))?', re.IGNORECASE)
BASE_TYPE_PATTERN = re.compile(r'((?:array|class)\s*<[^<>]*(?:<[^<>]*>)?[^<>]*>|[\w.]+)\s*$', re.IGNORECASE)
CONTAINER_TYPE_PATTERN = re.compile(r'(array|class)\s*<\s*(.+?)\s*>', re.IGNORECASE)


class DeclaredPropertyTypeError(FormatError):
    pass


class StructDeclaration(NamedTuple):
    name: str
    parent: str | None
    members: tuple


class PropertyScope(NamedTuple):
    class_name: str
    struct_name: str | None


def base_declared_type(declared_type):
    match = BASE_TYPE_PATTERN.search(declared_type)
    return None if match is None else ' '.join(match[1].split())


def container_inner_type(declared_type, container):
    match = CONTAINER_TYPE_PATTERN.fullmatch(declared_type or '')
    return match[2] if match is not None and match[1].casefold() == container else None


def leaf_type_name(type_name):
    return type_name.rsplit('.', 1)[-1]


def top_level_struct_blocks(script_text):
    text = script_text_without_comments_and_strings(script_text)
    blocks, statement, depth, body_start, header = [], [], 0, None, None
    for position, character in enumerate(text):
        if character == '{':
            if depth == 0:
                header = STRUCT_HEADER_PATTERN.fullmatch(''.join(statement).strip())
                body_start = position + 1
            depth += 1
        elif character == '}':
            depth -= 1
            if depth < 0:
                raise ClassDefaultError('decompiled class script has an unbalanced closing brace')
            if depth == 0:
                if header is not None:
                    blocks.append((header, text[body_start:position]))
                header, statement = None, []
        elif depth == 0 and character == ';':
            statement = []
        elif depth == 0:
            statement.append(character)
    if depth:
        raise ClassDefaultError('decompiled class script has an unclosed brace')
    return blocks


def struct_member_declarations(script_text):
    structs = {}
    for header, body in top_level_struct_blocks(script_text):
        name, parent = header[1], header[2]
        if name.casefold() in structs:
            raise ClassDefaultError(f'decompiled class script declares struct {name} twice')
        members = tuple((field['name'], field['type']) for field in declared_fields(body))
        structs[name.casefold()] = StructDeclaration(name, None if parent is None else leaf_type_name(parent), members)
    return structs


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def verified_class_script_text(work_root, definition):
    class_object = definition['identity']['object']
    folder = (Path(work_root) / CLASS_DEFAULT_CACHE_FOLDER_NAME / DECOMPILE_WORK_FOLDER_NAME / class_object).resolve()
    defaults_path = folder / DECOMPILE_DEFAULTS_NAME
    if not defaults_path.is_file():
        raise DeclaredPropertyTypeError(f'decompiled class {class_object} has no {DECOMPILE_DEFAULTS_NAME} in {folder.as_posix()}')
    metadata = json.loads(defaults_path.read_text(encoding='utf-8'))
    source_script, source_sha256 = metadata.get('sourceScript'), metadata.get('sourceScriptSha256')
    if not (isinstance(source_script, str) and isinstance(source_sha256, str)):
        raise DeclaredPropertyTypeError(f'decompiled class {class_object} names no source script and SHA-256')
    script_path = (folder / source_script).resolve()
    if not (script_path.is_relative_to(folder) and script_path.is_file()):
        raise DeclaredPropertyTypeError(f'decompiled class {class_object} names the source script {source_script} outside its folder or absent')
    if sha256_hex(script_path.read_bytes()) != source_sha256:
        raise DeclaredPropertyTypeError(f'decompiled script of {class_object} differs from the sourceScriptSha256 of its {DECOMPILE_DEFAULTS_NAME}')
    script_text = script_path.read_text(encoding='utf-8-sig')
    if sha256_hex(script_text.encode('utf-8')) != definition['scriptSha256']:
        raise DeclaredPropertyTypeError(f'decompiled script of {class_object} differs from the scriptSha256 of its cached class definition')
    return script_text


class DeclaredPropertyTypes:
    def __init__(self, class_defaults):
        self.class_defaults = class_defaults
        self.field_types_by_class, self.structs_by_class, self.object_classes = {}, {}, {}

    def class_chain(self, class_name):
        return kept_class_chain(class_name, self.class_defaults.work_root, self.class_defaults.class_scripts)

    def field_types(self, class_name):
        if class_name not in self.field_types_by_class:
            work_root, class_scripts = self.class_defaults.work_root, self.class_defaults.class_scripts
            try:
                declarations = kept_read(work_root, class_scripts, (FIELD_DECLARATIONS_READ_KIND, class_name),
                                         lambda: read_class_field_declarations(class_name, work_root, class_scripts))
                self.field_types_by_class[class_name] = {declaration.field.casefold(): base_declared_type(declaration.declared_type)
                                                         for declaration in declarations}
            except ClassDefaultError:
                self.field_types_by_class[class_name] = None
        return self.field_types_by_class[class_name]

    def structs(self, class_name):
        if class_name not in self.structs_by_class:
            try:
                chain = self.class_chain(class_name)
            except ClassDefaultError:
                self.structs_by_class[class_name] = None
                return None
            structs = {}
            for definition in chain:
                declared = struct_member_declarations(verified_class_script_text(self.class_defaults.work_root, definition))
                for key, declaration in declared.items():
                    structs.setdefault(key, declaration)
            self.structs_by_class[class_name] = structs
        return self.structs_by_class[class_name]

    def struct_declaration(self, class_name, struct_name):
        structs = self.structs(class_name)
        return None if structs is None else structs.get(leaf_type_name(struct_name).casefold())

    def struct_member_types(self, class_name, struct_name):
        members, visited, declaration = {}, set(), self.struct_declaration(class_name, struct_name)
        if declaration is None:
            return None
        while declaration is not None and declaration.name.casefold() not in visited:
            visited.add(declaration.name.casefold())
            for member, declared_type in declaration.members:
                members.setdefault(member.casefold(), base_declared_type(declared_type))
            declaration = None if declaration.parent is None else self.struct_declaration(class_name, declaration.parent)
        return members

    def property_type(self, scope, name):
        types = self.field_types(scope.class_name) if scope.struct_name is None else self.struct_member_types(scope.class_name, scope.struct_name)
        return None if types is None else types.get(name.casefold())

    def is_struct(self, scope, type_name):
        return self.struct_declaration(scope.class_name, type_name) is not None

    def is_enum(self, scope, type_name):
        try:
            chain = self.class_chain(scope.class_name)
        except ClassDefaultError:
            return False
        owner, _, enum_name = type_name.rpartition('.')
        return any(enum_name in definition['enums'] for definition in chain
                   if not owner or leaf_type_name(definition['identity']['object']).casefold() == owner.casefold())

    def is_object_class(self, scope, type_name):
        if container_inner_type(type_name, 'class') is not None:
            return True
        key = (scope.class_name, type_name.casefold())
        if key not in self.object_classes:
            self.object_classes[key] = self.resolves_class(scope.class_name, type_name)
        return self.object_classes[key]

    def resolves_class(self, class_name, type_name):
        try:
            chain = self.class_chain(class_name)
        except ClassDefaultError:
            return False
        candidates = [type_name] if '.' in type_name else list(dict.fromkeys(
            f'{definition["identity"]["object"].split(".", 1)[0]}.{type_name}' for definition in chain))
        for candidate in candidates:
            try:
                self.class_defaults.class_scripts.class_identity(candidate)
            except (ClassDefaultError, FormatError):
                continue
            return True
        return False


@functools.cache
def declared_property_types(class_defaults):
    return DeclaredPropertyTypes(class_defaults)
