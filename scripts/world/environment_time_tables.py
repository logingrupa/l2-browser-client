import re

from world.environment_config_cache import (FIELD_MISSING, FIELD_OUT_OF_BYTE_RANGE, FIELD_READ, FIELD_UNPARSED, EnvironmentConfigFile, float32,
                                            read_tuple_field, typed_setting_value)
from world.environment_program import (ENVIRONMENT_NATIVE_RULES_RELATIVE_PATH, environment_setup, environment_setup_unresolved_reasons,
                                       load_environment_native_rules)

TIME_TABLES_SCHEMA_VERSION = 2
TIME_TABLES_KIND = 'native-environment-time-tables'
ENVIRONMENT_SETUP_FILE = 'Env.int'
KEY_NUMBER_MINUS_ONE = 'key-number-minus-one'
KEY_INDEX_PLACEHOLDER = '{index}'
FIELD_REASON_BY_STATUS = {FIELD_MISSING: 'time-table-field-default-unresolved', FIELD_UNPARSED: 'time-table-field-unparsed',
                          FIELD_OUT_OF_BYTE_RANGE: 'time-table-field-out-of-byte-range'}


def numbered_key_pattern(key_pattern):
    prefix, suffix = key_pattern.split(KEY_INDEX_PLACEHOLDER)
    return re.compile(f'{re.escape(prefix.casefold())}([1-9][0-9]*){re.escape(suffix.casefold())}')


def present_key_numbers(config_file, section, key_pattern, count):
    pattern = numbered_key_pattern(key_pattern)
    numbers = (pattern.fullmatch(folded_key) for folded_key in config_file.folded_property_keys(section))
    return sorted(number for number in (int(match.group(1)) for match in numbers if match) if number <= count)


def default_field_value(field, key_number):
    return float32(key_number - 1) if field['default'] == KEY_NUMBER_MINUS_ONE else field['default']


def time_table_row(file_name, section, record, key_number, kind_rule):
    text, values, defaulted, unresolved = record['valueAscii'], {}, [], []
    for field in kind_rule['fields']:
        reading = read_tuple_field(text, field['match'], field['type']) if text is not None else None
        status = FIELD_UNPARSED if reading is None else reading.status
        if status == FIELD_READ:
            values[field['name']] = reading.value
        elif status == FIELD_MISSING and field['default'] is not None:
            values[field['name']] = default_field_value(field, key_number)
            defaulted.append(field['name'])
        else:
            values[field['name']] = None
            unresolved.append(f'{FIELD_REASON_BY_STATUS[status]}:{file_name}:{section}:{record["key"]}:{field["name"]}')
    return {'key': record['key'], 'keyNumber': key_number, 'recordIndex': record['recordIndex'], 'line': record['line'],
            'sourceOffset': record['sourceOffset'], 'valueSourceOffset': record['valueSourceOffset'], 'raw': text, 'values': values,
            'defaultedFields': defaulted, 'unresolved': unresolved}


def time_table(file_name, config_file, section_rule, rules):
    section, kind = section_rule['section'], section_rule['kind']
    count_record = config_file.property(section, rules['table.countKey'])
    table = {'section': section, 'kind': kind, 'sectionPresent': config_file.has_section(section), 'num': None,
             'numRecordIndex': None if count_record is None else count_record['recordIndex'],
             'numSourceOffset': None if count_record is None else count_record['valueSourceOffset'], 'rows': [], 'unresolved': []}
    if count_record is None:
        return table
    count = typed_setting_value(count_record['valueAscii'], 'integer')
    if count is None:
        return {**table, 'unresolved': [f'time-table-num-unparsed:{file_name}:{section}']}
    kind_rule = rules[f'table.kind.{kind}']
    rows = [time_table_row(file_name, section, config_file.property(section, kind_rule['keyPattern'].format(index=key_number)), key_number, kind_rule)
            for key_number in present_key_numbers(config_file, section, kind_rule['keyPattern'], count)]
    return {**table, 'num': count, 'rows': rows, 'unresolved': [reason for row in rows for reason in row['unresolved']]}


def environment_type_entry(file, config_file, rules):
    type_rule = rules['table.environmentType']
    record = config_file.property(type_rule['section'], type_rule['key'])
    declared = None if record is None else typed_setting_value(record['valueAscii'], 'integer')
    environment_type = type_rule['default'] if record is None else declared
    tables = [time_table(file['name'], config_file, section_rule, rules) for section_rule in rules['table.sections']]
    unresolved = [reason for table in tables for reason in table['unresolved']]
    if record is not None and declared is None:
        unresolved.append(f'environment-type-unparsed:{file["name"]}')
    return {'file': file['name'], 'originalSha256': file['originalSha256'], 'decodedSha256': file['decodedSha256'],
            'environmentType': environment_type, 'environmentTypeSource': 'native-default' if record is None else 'file',
            'environmentTypeRecordIndex': None if record is None else record['recordIndex'],
            'mergedDuplicateSections': [{'section': section, 'headerLines': lines} for section, lines in sorted(config_file.merged_duplicate_sections().items())],
            'tables': tables, 'unresolved': unresolved}


def unparsed_line_reasons(files):
    return [f'environment-line-unparsed:{file["name"]}:{row["line"]}' for file in files for row in file['records'] if row['kind'] == 'unparsed']


def duplicate_environment_type_reasons(entries):
    declared = [entry['environmentType'] for entry in entries if entry['environmentType'] is not None]
    return [f'environment-type-declared-twice:{environment_type}' for environment_type in sorted(set(declared)) if declared.count(environment_type) > 1]


def environment_type_entries(setup, files_by_folded_name, rules):
    entries, unresolved = [], []
    for setting in setup['timeEnvironmentFiles']:
        if setting['value'] is None:
            continue
        file = files_by_folded_name.get(setting['value'].casefold())
        if file is None:
            unresolved.append(f'environment-time-file-missing:{setting["value"]}')
            continue
        entries.append(environment_type_entry(file, EnvironmentConfigFile(file['records']), rules))
    return entries, unresolved


def time_tables_document(files):
    rules, rules_sha256 = load_environment_native_rules()
    files_by_folded_name = {file['name'].casefold(): file for file in files}
    setup_file = files_by_folded_name.get(ENVIRONMENT_SETUP_FILE.casefold())
    unresolved = unparsed_line_reasons(files)
    if setup_file is None:
        setup, entries = None, []
        unresolved.append(f'environment-setup-file-missing:{ENVIRONMENT_SETUP_FILE}')
    else:
        setup = environment_setup(setup_file['name'], EnvironmentConfigFile(setup_file['records']), rules)
        entries, missing_files = environment_type_entries(setup, files_by_folded_name, rules)
        unresolved.extend([*environment_setup_unresolved_reasons(setup), *missing_files])
    unresolved.extend(reason for entry in entries for reason in entry['unresolved'])
    unresolved.extend(duplicate_environment_type_reasons(entries))
    tables = [table for entry in entries for table in entry['tables']]
    return {'schemaVersion': TIME_TABLES_SCHEMA_VERSION, 'kind': TIME_TABLES_KIND,
            'rules': {'path': ENVIRONMENT_NATIVE_RULES_RELATIVE_PATH, 'canonicalSha256': rules_sha256},
            'setup': setup, 'environmentTypes': entries, 'tableCount': len(tables), 'rowCount': sum(len(table['rows']) for table in tables),
            'unresolved': sorted(set(unresolved)), 'typedComplete': not unresolved}
