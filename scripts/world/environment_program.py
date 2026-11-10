import hashlib
import re

from native_catalog.ue2 import FormatError
from native_environment import decode_environment, parse_records
from native_store.unit_ledger import locked_input_records
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, ReferenceClientLockError, read_reference_client_lock

ENVIRONMENT_PROGRAM_SCHEMA_VERSION = 1
ENVIRONMENT_PROGRAM_KIND = 'native-environment-program'
ENVIRONMENT_SYSTEM_FOLDER = 'system'
ENVIRONMENT_SETUP_FILE = 'Env.int'
ENVIRONMENT_SETUP_SECTION = 'EnvSetup'
ENVIRONMENT_TYPE_FILE_KEY = 'TimeEnvFileName{}'
ENVIRONMENT_TYPE_SECTION = 'EnvType'
ENVIRONMENT_TYPES = (0, 1, 2, 3)
PROGRAM_SETUP_KEYS = ('TimeRatio', 'StartTime', 'TimeEnvFileNum')
ENVIRONMENT_PROGRAM_UNRESOLVED_REASON_PREFIX = 'environment-program-unresolved:'
INTEGER_TEXT = re.compile(r'-?\d+')
NUMBER_TEXT = re.compile(r'-?\d+\.\d+')
TUPLE_FIELD_TEXT = r'\s*[A-Za-z][A-Za-z0-9]*\s*=\s*-?\d+(?:\.\d+)?\s*'
TUPLE_TEXT = re.compile(rf'\(({TUPLE_FIELD_TEXT}(?:,{TUPLE_FIELD_TEXT})*)\)')
BOOLEAN_TEXT = {'true': True, 'false': False}
ENVIRONMENT_LOCK_PATH_PATTERN = re.compile(r'system/(?:env|timeenv\d+)\.int', re.IGNORECASE)
LOCK_EQUAL_CLASS = 'equal'


def environment_program_unresolved_reason(file_name):
    return f'{ENVIRONMENT_PROGRAM_UNRESOLVED_REASON_PREFIX}{file_name}'


def typed_number(text):
    return int(text) if INTEGER_TEXT.fullmatch(text) else float(text)


def typed_environment_value(text):
    if text is None:
        return {'kind': 'unparsed'}
    stripped = text.strip()
    if stripped.casefold() in BOOLEAN_TEXT:
        return {'kind': 'boolean', 'value': BOOLEAN_TEXT[stripped.casefold()]}
    if INTEGER_TEXT.fullmatch(stripped):
        return {'kind': 'integer', 'value': int(stripped)}
    if NUMBER_TEXT.fullmatch(stripped):
        return {'kind': 'number', 'value': float(stripped)}
    match = TUPLE_TEXT.fullmatch(stripped)
    if match:
        fields = [part.split('=') for part in match.group(1).split(',')]
        return {'kind': 'tuple', 'fields': [[key.strip(), typed_number(value.strip())] for key, value in fields]}
    return {'kind': 'text', 'value': stripped}


def typed_sections(records):
    sections, occurrences = [], {}
    for row in records:
        if row['kind'] == 'section':
            occurrences[row['name']] = occurrences.get(row['name'], 0) + 1
            sections.append({'section': row['name'], 'occurrence': occurrences[row['name']] - 1, 'line': row['line'], 'properties': []})
        elif row['kind'] == 'property' and sections and row['sectionIndex'] is not None:
            sections[-1]['properties'].append({'key': row['key'], 'line': row['line'], 'valueSourceOffset': row['valueSourceOffset'],
                                               'raw': row['valueAscii'], **typed_environment_value(row['valueAscii'])})
        elif row['kind'] == 'unparsed':
            raise FormatError(f'environment line {row["line"]} is neither a section, a property nor a comment')
    return sections


def section_properties(sections, name):
    return [prop for section in sections if section['section'] == name for prop in section['properties']]


def section_value(sections, section_name, key):
    matches = [prop for prop in section_properties(sections, section_name) if prop['key'].casefold() == key.casefold()]
    if len(matches) != 1:
        return None
    return matches[0]


def read_environment_file(client_access, file_name):
    relative_path = f'{ENVIRONMENT_SYSTEM_FOLDER}/{file_name}'
    try:
        data = client_access.require_equal_file(relative_path).read_bytes()
    except (ReferenceClientLockError, OSError):
        return None
    payload, _ = decode_environment(data)
    return {'file': file_name, 'path': relative_path, 'sha256': hashlib.sha256(data).hexdigest(), 'sections': typed_sections(parse_records(payload))}


def unresolved_environment_type(environment_type, file_name, reason):
    return {'environmentType': environment_type, 'file': file_name, 'path': None, 'sha256': None, 'declaredEnvType': None, 'sections': [],
            'unresolved': reason}


def environment_type_entry(client_access, setup, environment_type):
    if setup is None:
        return unresolved_environment_type(environment_type, None, environment_program_unresolved_reason(ENVIRONMENT_SETUP_FILE))
    declared_file = section_value(setup['sections'], ENVIRONMENT_SETUP_SECTION, ENVIRONMENT_TYPE_FILE_KEY.format(environment_type))
    if declared_file is None or declared_file['kind'] != 'text':
        return unresolved_environment_type(environment_type, None, environment_program_unresolved_reason(ENVIRONMENT_SETUP_FILE))
    environment_file = read_environment_file(client_access, declared_file['value'])
    if environment_file is None:
        return unresolved_environment_type(environment_type, declared_file['value'], environment_program_unresolved_reason(declared_file['value']))
    declared_type = section_value(environment_file['sections'], ENVIRONMENT_TYPE_SECTION, ENVIRONMENT_TYPE_SECTION)
    return {'environmentType': environment_type, **environment_file, 'declaredEnvType': declared_type, 'unresolved': None}


def program_setup_values(setup):
    if setup is None:
        return {key: None for key in PROGRAM_SETUP_KEYS}
    return {key: section_value(setup['sections'], ENVIRONMENT_SETUP_SECTION, key) for key in PROGRAM_SETUP_KEYS}


def read_environment_program(client_access):
    setup = read_environment_file(client_access, ENVIRONMENT_SETUP_FILE)
    types = [environment_type_entry(client_access, setup, environment_type) for environment_type in ENVIRONMENT_TYPES]
    unresolved = sorted({entry['unresolved'] for entry in types if entry['unresolved']}
                        | ({environment_program_unresolved_reason(ENVIRONMENT_SETUP_FILE)} if setup is None else set()))
    return {'schemaVersion': ENVIRONMENT_PROGRAM_SCHEMA_VERSION, 'kind': ENVIRONMENT_PROGRAM_KIND, 'setupValues': program_setup_values(setup),
            'setup': setup if setup is not None else {'file': ENVIRONMENT_SETUP_FILE, 'path': None, 'sha256': None, 'sections': []},
            'environmentTypes': types, 'unresolved': unresolved}


def environment_lock_input_records(lock_path=REFERENCE_CLIENT_LOCK_PATH):
    lock = read_reference_client_lock(lock_path)
    paths = sorted(path for path, record in lock.records_by_path.items()
                   if ENVIRONMENT_LOCK_PATH_PATTERN.fullmatch(path) and record['class'] == LOCK_EQUAL_CLASS)
    return locked_input_records(paths, lock_path)
