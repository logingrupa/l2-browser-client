import functools
import hashlib
import json
import re

from native_store.store_paths import REPOSITORY_ROOT
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH = 'recipes/world/bsp-model-licensee-rules.json'
BSP_MODEL_LICENSEE_RULES_KIND = 'bsp-model-licensee-rules'
ENGINE_RELATIVE_PATH = 'system/Engine.dll'
SHA256_HEX = re.compile(r'[0-9a-f]{64}')
HEX_VALUE = re.compile(r'0x[0-9a-f]+')
TILE_ID = re.compile(r'\d{2}_\d{2}')
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'engine', 'verification', 'rules', 'layouts', 'mapLicensees', 'open'}
RULE_FIELDS = {'function', 'address', 'condition'}
RULE_NAMES = ('levelBaseReferenceArrays', 'levelModelReference', 'surfaceTrailingInteger')
LICENSEE_GATED_RULE_NAMES = ('levelBaseReferenceArrays', 'surfaceTrailingInteger')
LAYOUT_NAMES = ('renderSection', 'renderVertex')
RENDER_SECTION_FIELD_COUNT = 6


class BspModelLicenseeRulesError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise BspModelLicenseeRulesError(f'{BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH}: {message}')


def refuse_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    require(len(keys) == len(set(keys)), f'repeats a JSON key in {sorted(keys)}')
    return dict(pairs)


def refuse_non_finite_number(value):
    raise BspModelLicenseeRulesError(f'{BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH}: holds the non-finite number {value}')


def is_count(value):
    return type(value) is int and value >= 0


def is_text(value):
    return isinstance(value, str) and value != ''


def is_hex_list(value):
    return isinstance(value, list) and value != [] and all(isinstance(entry, str) and HEX_VALUE.fullmatch(entry) for entry in value)


def require_locked_engine(engine, lock_path):
    require(isinstance(engine, dict) and set(engine) == {'path', 'sha256', 'imageBase'}, 'engine must hold path, sha256 and imageBase')
    require(engine['path'] == ENGINE_RELATIVE_PATH and HEX_VALUE.fullmatch(str(engine['imageBase'])), 'engine names another file or no image base')
    record = read_reference_client_lock(lock_path).record(engine['path'])
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == engine['sha256'],
            f'engine pin {engine["sha256"]} differs from the {engine["path"].casefold()} entry of the reference client lock')


def require_verification(verification):
    require(isinstance(verification, dict) and SHA256_HEX.fullmatch(str(verification.get('verifiedFactsSha256'))),
            'verification needs the SHA-256 of the verified facts')
    require(isinstance(verification.get('decisionRows'), list) and verification['decisionRows']
            and all(is_text(row) for row in verification['decisionRows']), 'verification needs its decision rows')
    require(is_text(verification.get('workflow')) and is_text(verification.get('date')), 'verification needs its workflow and date')


def require_rule(name, rule):
    require(isinstance(rule, dict) and RULE_FIELDS <= set(rule), f'rule {name} needs {sorted(RULE_FIELDS)}')
    require(is_text(rule['function']) and is_text(rule['condition']), f'rule {name} needs a function and a condition')
    require(isinstance(rule['address'], str) and HEX_VALUE.fullmatch(rule['address']), f'rule {name} needs a hex address')
    if name in LICENSEE_GATED_RULE_NAMES:
        require(is_count(rule.get('minimumLicensee')), f'rule {name} needs a minimum licensee')


def require_rules(rules):
    require(isinstance(rules, dict) and set(rules) == set(RULE_NAMES), f'rules must be {sorted(RULE_NAMES)}')
    for name in RULE_NAMES:
        require_rule(name, rules[name])
    arrays = rules['levelBaseReferenceArrays'].get('arrays')
    require(isinstance(arrays, list) and arrays and all(
        isinstance(array, dict) and set(array) == {'nativeField', 'minimumLicensee'} and HEX_VALUE.fullmatch(str(array['nativeField']))
        and is_count(array['minimumLicensee']) for array in arrays), 'levelBaseReferenceArrays needs its arrays with native fields and minimum licensees')
    require(len({array['nativeField'] for array in arrays}) == len(arrays), 'levelBaseReferenceArrays repeats an array')


def require_layouts(layouts):
    require(isinstance(layouts, dict) and set(layouts) == set(LAYOUT_NAMES), f'layouts must be {sorted(LAYOUT_NAMES)}')
    for name in LAYOUT_NAMES:
        require(isinstance(layouts[name], dict) and is_text(layouts[name].get('structure')) and is_text(layouts[name].get('condition')),
                f'layout {name} needs a structure and a condition')
    section = layouts['renderSection']
    require(is_hex_list(section.get('fieldOrder')) and len(section['fieldOrder']) == RENDER_SECTION_FIELD_COUNT,
            f'renderSection needs its {RENDER_SECTION_FIELD_COUNT} field offsets in wire order')
    vertex = layouts['renderVertex']
    require(type(vertex.get('memberBytes')) is int and vertex['memberBytes'] > 0, 'renderVertex needs its member byte count')
    require(is_hex_list(vertex.get('wireOrder')) and is_hex_list(vertex.get('trailingMembers')), 'renderVertex needs its wire order and trailing members')
    require(is_count(vertex.get('trailingMinimumPackageVersion')), 'renderVertex needs the package version of its trailing members')


def validate_bsp_model_licensee_rules_document(document, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == BSP_MODEL_LICENSEE_RULES_KIND, 'is not a bsp-model-licensee-rules v1 recipe')
    require_locked_engine(document['engine'], lock_path)
    require_verification(document['verification'])
    require_rules(document['rules'])
    require_layouts(document['layouts'])
    licensees = document['mapLicensees']
    require(isinstance(licensees, dict) and licensees and all(TILE_ID.fullmatch(tile) and is_count(licensee) for tile, licensee in licensees.items()),
            'mapLicensees must map tile ids to licensees')
    require(isinstance(document['open'], list) and all(is_text(entry) for entry in document['open']), 'open must list text')
    return document


def load_bsp_model_licensee_rules(path, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(path.is_file(), 'is missing')
    payload = path.read_bytes()
    try:
        document = json.loads(payload, object_pairs_hook=refuse_duplicate_keys, parse_constant=refuse_non_finite_number)
    except json.JSONDecodeError as error:
        raise BspModelLicenseeRulesError(f'{BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH} is not JSON: {error}') from error
    return {'path': BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(),
            'document': validate_bsp_model_licensee_rules_document(document, lock_path)}


@functools.cache
def read_bsp_model_licensee_rules():
    return load_bsp_model_licensee_rules(REPOSITORY_ROOT / BSP_MODEL_LICENSEE_RULES_RELATIVE_PATH)
