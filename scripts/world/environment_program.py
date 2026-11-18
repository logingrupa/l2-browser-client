import hashlib
import json
from pathlib import Path

from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from world.environment_config_cache import float32, typed_setting_value

ENVIRONMENT_NATIVE_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'environment-native-rules.json'
ENVIRONMENT_NATIVE_RULES_RELATIVE_PATH = 'recipes/world/environment-native-rules.json'
REQUIRED_RULE_IDS = ('setup.section', 'setup.IsClock', 'setup.TimeRatio', 'setup.StartTime', 'setup.ShadowTick', 'setup.SlopeSunAngle',
                     'setup.TimeEnvFileNum', 'setup.TimeEnvFileName', 'binding.SKYBOX', 'binding.HAZERING', 'binding.NumCloudColor',
                     'binding.CLOUD', 'table.environmentType', 'table.countKey', 'table.kind.rgb', 'table.kind.hsv', 'table.kind.scale',
                     'table.sections', 'fog.section', 'fog.StartRange', 'fog.EndRange', 'fog.FogSpeed')
SETUP_VALUE_RULE_IDS = ('setup.IsClock', 'setup.TimeRatio', 'setup.StartTime', 'setup.ShadowTick', 'setup.SlopeSunAngle', 'setup.TimeEnvFileNum')
SETTING_FROM_FILE = 'file'
SETTING_FROM_NATIVE_DEFAULT = 'native-default'
SETTING_UNRESOLVED = 'unresolved'


def load_environment_native_rules(path=ENVIRONMENT_NATIVE_RULES_PATH):
    document = json.loads(Path(path).read_text(encoding='utf-8'))
    if not (isinstance(document, dict) and document.get('schemaVersion') == 1 and isinstance(document.get('rows'), list)):
        raise FormatError(f'{ENVIRONMENT_NATIVE_RULES_RELATIVE_PATH} must be schema 1 with a rows list')
    rules = {row['id']: row['value'] for row in document['rows']}
    missing = [rule_id for rule_id in REQUIRED_RULE_IDS if rule_id not in rules]
    if missing or len(rules) != len(document['rows']):
        raise FormatError(f'{ENVIRONMENT_NATIVE_RULES_RELATIVE_PATH} misses rule rows {missing} or repeats an id')
    return rules, hashlib.sha256(canonical_json_bytes(document)).hexdigest()


def typed_rule_default(rule):
    default = rule['default']
    return float32(default) if default is not None and rule['type'] == 'float32' else default


def setting_record(config_file, section, key, rule):
    record = config_file.property(section, key)
    if record is None:
        default = typed_rule_default(rule)
        if default is None:
            return {'key': key, 'value': None, 'source': SETTING_UNRESOLVED, 'recordIndex': None, 'valueSourceOffset': None, 'raw': None,
                    'unresolved': f'environment-setup-value-missing:{key}'}
        return {'key': key, 'value': default, 'source': SETTING_FROM_NATIVE_DEFAULT, 'recordIndex': None, 'valueSourceOffset': None,
                'raw': None, 'unresolved': None}
    value = typed_setting_value(record['valueAscii'], rule['type'])
    located = {'key': key, 'recordIndex': record['recordIndex'], 'valueSourceOffset': record['valueSourceOffset'], 'raw': record['valueAscii']}
    if value is None:
        return {**located, 'value': None, 'source': SETTING_UNRESOLVED, 'unresolved': f'environment-setup-value-unparsed:{key}'}
    return {**located, 'value': value, 'source': SETTING_FROM_FILE, 'unresolved': None}


def indexed_setting_records(config_file, section, rule, count):
    return [{'index': index, **setting_record(config_file, section, rule['keyPattern'].format(index=index), rule)}
            for index in range(rule['firstIndex'], rule['firstIndex'] + max(count, 0))]


def environment_fog_setup(config_file, rules):
    section = rules['fog.section']
    return {'section': section,
            'startRanges': indexed_setting_records(config_file, section, rules['fog.StartRange'], rules['fog.StartRange']['count']),
            'endRanges': indexed_setting_records(config_file, section, rules['fog.EndRange'], rules['fog.EndRange']['count']),
            'FogSpeed': setting_record(config_file, section, rules['fog.FogSpeed']['key'], rules['fog.FogSpeed'])}


def environment_setup(file_name, config_file, rules):
    section = rules['setup.section']
    values = {rules[rule_id]['key']: setting_record(config_file, section, rules[rule_id]['key'], rules[rule_id]) for rule_id in SETUP_VALUE_RULE_IDS}
    cloud_count = setting_record(config_file, section, rules['binding.NumCloudColor']['key'], rules['binding.NumCloudColor'])
    bindings = {'SKYBOX': setting_record(config_file, section, rules['binding.SKYBOX']['key'], rules['binding.SKYBOX']),
                'HAZERING': setting_record(config_file, section, rules['binding.HAZERING']['key'], rules['binding.HAZERING']),
                'NumCloudColor': cloud_count,
                'CLOUD': indexed_setting_records(config_file, section, rules['binding.CLOUD'], cloud_count['value'] or 0)}
    time_environment_files = indexed_setting_records(config_file, section, rules['setup.TimeEnvFileName'], values['TimeEnvFileNum']['value'] or 0)
    return {'file': file_name, 'section': section, 'values': values, 'bindings': bindings, 'timeEnvironmentFiles': time_environment_files,
            'fog': environment_fog_setup(config_file, rules)}


def environment_setup_settings(setup):
    bindings, fog = setup['bindings'], setup['fog']
    return [*setup['values'].values(), bindings['SKYBOX'], bindings['HAZERING'], bindings['NumCloudColor'], *bindings['CLOUD'],
            *setup['timeEnvironmentFiles'], *fog['startRanges'], *fog['endRanges'], fog['FogSpeed']]


def environment_setup_unresolved_reasons(setup):
    return sorted({setting['unresolved'] for setting in environment_setup_settings(setup) if setting['unresolved']})
