import functools
import hashlib
import json
import re
import struct
from typing import NamedTuple

from native_store.store_paths import REPOSITORY_ROOT
from native_store.unit_ledger import process_reference_client_lock
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH = 'recipes/world/struct-property-tag-rules.json'
STRUCT_PROPERTY_TAG_RULES_KIND = 'struct-property-tag-rules'
CORE_DLL_RELATIVE_PATH = 'system/Core.dll'
SHA256_HEX = re.compile(r'[0-9a-f]{64}')
HEX_VALUE = re.compile(r'0x[0-9a-f]+')
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'coreDll', 'verification', 'rules', 'actorClasses', 'oracles'}
CORE_DLL_FIELDS = {'path', 'bytes', 'sha256', 'imageBase'}
RULE_NAMES = ('structDispatch', 'tag', 'arrayIndex', 'bool', 'nestedStruct', 'dynamicArray')
DISPATCH_NAMES = ('tagged', 'binary')
DISPATCH_FIELDS = {'function', 'address', 'addressKind', 'condition'}
BINARY_MEMBER_FORMATS = {'float32': 'f', 'int32': 'i', 'uint8': 'B'}
ORACLE_EXPORT_FIELDS = {'exportIndex', 'object', 'values'}


class StructPropertyTagRulesError(ValueError):
    pass


class BinaryStructLayout(NamedTuple):
    name: str
    members: tuple

    @property
    def byte_count(self):
        return struct.calcsize('<' + ''.join(member_format for _, member_format in self.members))


class StructPropertyTagRules(NamedTuple):
    path: str
    sha256: str
    document: dict
    binary_structs: dict
    minimum_tagged_package_version: int

    def binary_struct_layout(self, struct_name):
        return self.binary_structs.get(struct_name.casefold())


def require(condition, message):
    if not condition:
        raise StructPropertyTagRulesError(f'{STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH}: {message}')


def refuse_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    require(len(keys) == len(set(keys)), f'repeats a JSON key in {sorted(keys)}')
    return dict(pairs)


def refuse_non_finite_number(value):
    raise StructPropertyTagRulesError(f'{STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH}: holds the non-finite number {value}')


def is_count(value):
    return type(value) is int and value >= 0


def is_text(value):
    return isinstance(value, str) and value != ''


def require_locked_core_dll(core_dll, lock_path):
    require(isinstance(core_dll, dict) and set(core_dll) == CORE_DLL_FIELDS, f'coreDll must hold {sorted(CORE_DLL_FIELDS)}')
    require(core_dll['path'] == CORE_DLL_RELATIVE_PATH and HEX_VALUE.fullmatch(str(core_dll['imageBase'])), 'coreDll names another file or no image base')
    record = process_reference_client_lock(lock_path).record(core_dll['path'])
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == core_dll['sha256']
            and record['eBytes'] == core_dll['bytes'],
            f'coreDll pin {core_dll["sha256"]} differs from the {core_dll["path"].casefold()} entry of the reference client lock')


def require_verification(verification):
    require(isinstance(verification, dict) and SHA256_HEX.fullmatch(str(verification.get('verifiedFactsSha256'))),
            'verification needs the SHA-256 of the verified facts')
    require(isinstance(verification.get('decisionRows'), list) and verification['decisionRows']
            and all(is_text(row) for row in verification['decisionRows']), 'verification needs its decision rows')
    require(is_text(verification.get('workflow')) and is_text(verification.get('date')), 'verification needs its workflow and date')


def require_dispatch(name, dispatch):
    require(isinstance(dispatch, dict) and DISPATCH_FIELDS <= set(dispatch), f'struct dispatch {name} needs {sorted(DISPATCH_FIELDS)}')
    require(is_text(dispatch['function']) and is_text(dispatch['condition']), f'struct dispatch {name} needs a function and a condition')
    require(isinstance(dispatch['address'], str) and HEX_VALUE.fullmatch(dispatch['address']), f'struct dispatch {name} needs a hex address')


def require_binary_struct(binary_struct):
    require(isinstance(binary_struct, dict) and set(binary_struct) == {'fnameId', 'name', 'members'}, 'a binary struct needs fnameId, name and members')
    require(isinstance(binary_struct['fnameId'], str) and HEX_VALUE.fullmatch(binary_struct['fnameId']),
            f'binary struct {binary_struct.get("name")} needs a hex FName id')
    require(is_text(binary_struct['name']), 'a binary struct needs its name')
    members = binary_struct['members']
    require(isinstance(members, list) and members and all(
        isinstance(member, dict) and set(member) == {'name', 'type'} and is_text(member['name']) and member['type'] in BINARY_MEMBER_FORMATS
        for member in members), f'binary struct {binary_struct["name"]} needs members of {sorted(BINARY_MEMBER_FORMATS)}')
    require(len({member['name'] for member in members}) == len(members), f'binary struct {binary_struct["name"]} repeats a member')


def require_rules(rules):
    require(isinstance(rules, dict) and set(rules) == set(RULE_NAMES), f'rules must be {sorted(RULE_NAMES)}')
    for name in RULE_NAMES[1:]:
        require(isinstance(rules[name], dict) and is_text(rules[name].get('condition')), f'rule {name} needs a condition')
    dispatch = rules['structDispatch']
    require(isinstance(dispatch, dict) and set(dispatch) == set(DISPATCH_NAMES), f'structDispatch must be {sorted(DISPATCH_NAMES)}')
    for name in DISPATCH_NAMES:
        require_dispatch(name, dispatch[name])
    require(is_count(dispatch['tagged'].get('minimumPackageVersion')), 'tagged struct dispatch needs its minimum package version')
    structs = dispatch['binary'].get('structs')
    require(isinstance(structs, list) and structs, 'binary struct dispatch needs its structs')
    for binary_struct in structs:
        require_binary_struct(binary_struct)
    require(len({binary_struct['name'].casefold() for binary_struct in structs}) == len(structs), 'binary struct dispatch repeats a struct')
    require(len({binary_struct['fnameId'] for binary_struct in structs}) == len(structs), 'binary struct dispatch repeats an FName id')


def require_actor_classes(actor_classes):
    require(isinstance(actor_classes, list) and actor_classes and all(
        isinstance(entry, dict) and set(entry) == {'class', 'superChain'} and is_text(entry['class'])
        and isinstance(entry['superChain'], list) and entry['superChain'] and all(is_text(name) for name in entry['superChain'])
        for entry in actor_classes), 'actorClasses must name each class with its super chain')


def require_oracles(oracles):
    require(isinstance(oracles, dict) and set(oracles) == {'map', 'streamsEndAtExportEnd', 'exports'}, 'oracles need map, streamsEndAtExportEnd and exports')
    require(is_text(oracles['map']) and oracles['streamsEndAtExportEnd'] is True, 'oracles need their map and streams that end at the export end')
    exports = oracles['exports']
    require(isinstance(exports, list) and exports and all(
        isinstance(entry, dict) and ORACLE_EXPORT_FIELDS <= set(entry) and is_count(entry['exportIndex']) and is_text(entry['object'])
        and isinstance(entry['values'], list) and entry['values'] and all(isinstance(value, dict) and is_text(value.get('path')) for value in entry['values'])
        for entry in exports), 'oracle exports need their export index, object and value paths')


def validate_struct_property_tag_rules_document(document, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == STRUCT_PROPERTY_TAG_RULES_KIND, 'is not a struct-property-tag-rules v1 recipe')
    require_locked_core_dll(document['coreDll'], lock_path)
    require_verification(document['verification'])
    require_rules(document['rules'])
    require_actor_classes(document['actorClasses'])
    require_oracles(document['oracles'])
    return document


def binary_struct_layouts(document):
    return {binary_struct['name'].casefold(): BinaryStructLayout(binary_struct['name'], tuple(
        (member['name'], BINARY_MEMBER_FORMATS[member['type']]) for member in binary_struct['members']))
        for binary_struct in document['rules']['structDispatch']['binary']['structs']}


def load_struct_property_tag_rules(path, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(path.is_file(), 'is missing')
    payload = path.read_bytes()
    try:
        document = json.loads(payload, object_pairs_hook=refuse_duplicate_keys, parse_constant=refuse_non_finite_number)
    except json.JSONDecodeError as error:
        raise StructPropertyTagRulesError(f'{STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH} is not JSON: {error}') from error
    validate_struct_property_tag_rules_document(document, lock_path)
    return StructPropertyTagRules(STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH, hashlib.sha256(payload).hexdigest(), document, binary_struct_layouts(document),
                                  document['rules']['structDispatch']['tagged']['minimumPackageVersion'])


@functools.cache
def read_struct_property_tag_rules():
    return load_struct_property_tag_rules(REPOSITORY_ROOT / STRUCT_PROPERTY_TAG_RULES_RELATIVE_PATH)
