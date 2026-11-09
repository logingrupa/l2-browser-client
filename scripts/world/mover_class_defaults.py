import copy
import hashlib
import json
from pathlib import Path
import re
from typing import NamedTuple

from native_assets_lib.gltf import json_bytes
from native_catalog.effects import SourcePackages, UELIB_SHA256, parse_uc
from native_catalog.ue2 import FormatError
from native_effect_bundle import DefaultReader
from native_store.store_paths import REPOSITORY_ROOT, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records, sha256_of_file
from world.map_sources import file_hash, safe_path
from world.raw_map_step import PRODUCTS_FOLDER_NAME
from world.tile_census import WORLD_LANE_NAME

MOVER_CLASS = 'Engine.Mover'
MOVER_CLASS_UNIT_KEY = 'class:Engine.Mover'
MOVER_CLASS_DEFAULTS_STEP_NAME = 'class-defaults'
MOVER_CLASS_DEFAULTS_ALGORITHM_VERSION = 1
CLASS_EVIDENCE_PRODUCT_NAME = 'class-evidence.json'
ENGINE_PACKAGE_SHA256 = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
DEFAULTS_HELPER_PATH = REPOSITORY_ROOT / 'scripts' / 'native_catalog' / 'extract_ue_defaults.ps1'
MOVER_CLASS_CHAIN = ('engine.mover', 'engine.actor', 'core.object')
NATIVE_ENDPOINT_SEMANTICS = {
    'core.object': (r'native\(215\).*Vector\s+\+\(Vector A, Vector B\)',
                    r'native\(216\).*Vector\s+-\(Vector A, Vector B\)',
                    r'native\(316\).*Rotator\s+\+\(Rotator A, Rotator B\)',
                    r'native\(147\).*int\s+-\(int A, int B\)',
                    r'native\(250\).*int Max\(int A, int B\)'),
    'engine.actor': (r'native\(266\).*bool Move\(Vector Delta\)',
                     r'native\(299\).*bool SetRotation\(Rotator NewRotation\)'),
    'engine.mover': (r'__NFUN_266__\(__NFUN_216__\(__NFUN_215__\(BasePos, KeyPos\[int\(KeyNum\)\]\), Location\)\)',
                     r'__NFUN_299__\(__NFUN_316__\(BaseRot, KeyRot\[int\(KeyNum\)\]\)\)',
                     r'InterpolateTo\(1, MoveTime\)',
                     r'InterpolateTo\(byte\(__NFUN_250__\(0, __NFUN_147__\(int\(KeyNum\), 1\)\)\), MoveTime\)')}
ZERO_VALUE_OF_KIND = {'Vector': dict.fromkeys('XYZ', 0), 'Rotator': dict.fromkeys(('Pitch', 'Yaw', 'Roll'), 0),
                      'byte': 0, 'int': 0, 'bool': False}
ZERO_INITIALIZATION_EVIDENCE = 'Exact native declared field without actor or inherited authored override; UObject field zero initialization.'


def require(value, message):
    if not value:
        raise FormatError(message)


def sha256_hex(value):
    return hashlib.sha256(value).hexdigest()


def qualified_classes(definitions, read):
    require(set(definitions) == set(MOVER_CLASS_CHAIN), 'Unsupported Engine.Mover inheritance census')
    scripts = {}
    for key, definition in definitions.items():
        script = read(definition['sourceScript'])
        require(sha256_hex(script) == definition['sourceScriptSha256'] and
                definition['uelibSha256'] == UELIB_SHA256 and
                definition['helperSha256'] == file_hash(DEFAULTS_HELPER_PATH),
                'Class evidence parser/script changed: ' + key)
        parsed = parse_uc(script.decode('utf-8-sig'), definition['object'])
        require(not parsed['unparsed'] and parsed['properties'] == definition['properties'] and
                parsed['superClass'] == definition['superClass'],
                'Class defaults disagree with retained script: ' + key)
        scripts[key] = script.decode('utf-8-sig')
    require(definitions['engine.mover']['nativeSuperClass'] == 'Engine.Actor' and
            definitions['engine.actor']['nativeSuperClass'] == 'Core.Object' and
            definitions['core.object']['nativeSuperClass'] is None,
            'Exact Engine.Mover native superclass chain changed')
    require(definitions['engine.mover']['source']['packageSha256'] == ENGINE_PACKAGE_SHA256,
            'Engine.Mover package pin changed')
    for key, patterns in NATIVE_ENDPOINT_SEMANTICS.items():
        for pattern in patterns:
            require(re.search(pattern, scripts[key]), 'Unqualified native mover endpoint semantics: ' + pattern)
    return scripts


class MoverDefaults:
    def __init__(self, definitions, scripts):
        self.definitions, self.scripts = definitions, scripts

    def declaration(self, name, kind, count=None):
        suffix = r'\[' + str(count) + r'\]' if count is not None else ''
        column_zero_class_field_declaration = r'^var[^;\n]*\b' + re.escape(kind) + r'\s+' + name + suffix + r'\s*;'
        matches = [key for key, script in self.scripts.items() if re.search(column_zero_class_field_declaration, script, re.MULTILINE)]
        require(len(matches) == 1, 'Native mover field declaration unresolved: ' + name)
        return matches[0]

    def resolve(self, properties, name, kind, index=None, count=None):
        self.declaration(name, kind, count)
        if (name, index) in properties:
            serialized = properties[name, index]
            require('value' in serialized, 'Undecoded mover field: ' + name)
            return {'value': copy.deepcopy(serialized['value']), 'source': 'serialized-actor-property', 'payload': serialized['payload']}
        for class_key in MOVER_CLASS_CHAIN:
            definition = self.definitions[class_key]
            if name not in definition['properties']:
                continue
            value = definition['properties'][name]
            if index is not None:
                require(isinstance(value, list), 'Native fixed array default is malformed: ' + name)
                if index >= len(value) or value[index] is None:
                    continue
                value = value[index]
            return {'value': copy.deepcopy(value), 'source': definition['object'], 'sourceScript': definition['sourceScript']}
        zero = ZERO_VALUE_OF_KIND.get(kind)
        require(zero is not None, 'No qualified zero initialization: ' + name)
        return {'value': copy.deepcopy(zero), 'source': 'native-declared-field-zero-init', 'declaration': self.declaration(name, kind, count),
                'evidence': ZERO_INITIALIZATION_EVIDENCE}


def mover_class_packages(client):
    packages, reference = SourcePackages(client), MOVER_CLASS
    relative_paths = set()
    while reference:
        record, package, item = packages.resolve(reference, 'Class')
        relative_paths.add(record['package'])
        reference = package.object_name(item['superIndex'])
    return sorted(relative_paths)


def mover_class_defaults_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MOVER_CLASS_DEFAULTS_STEP_NAME, MOVER_CLASS_DEFAULTS_ALGORITHM_VERSION)


def mover_class_defaults_config():
    return {'uelibSha256': UELIB_SHA256, 'helperSha256': file_hash(DEFAULTS_HELPER_PATH), 'implementationSha256': file_hash(Path(__file__))}


def class_evidence_products(ledger):
    return ledger.unit_step_directory(MOVER_CLASS_UNIT_KEY) / PRODUCTS_FOLDER_NAME


def sealed_mover_class_receipt_sha256(project_root):
    ledger = mover_class_defaults_ledger(project_root)
    receipt = ledger.sealed_receipt(MOVER_CLASS_UNIT_KEY)
    if receipt is None or receipt['algorithmVersion'] != MOVER_CLASS_DEFAULTS_ALGORITHM_VERSION or receipt['config'] != mover_class_defaults_config():
        return None
    if locked_input_records([record['path'] for record in receipt['inputs']]) != receipt['inputs']:
        return None
    return sha256_of_file(ledger.unit_step_directory(MOVER_CLASS_UNIT_KEY) / RECEIPT_RECORD_NAME)


class MoverClassEvidence(NamedTuple):
    receipt_sha256: str
    definitions: dict
    defaults: MoverDefaults


def sealed_class_evidence(ledger):
    products = class_evidence_products(ledger)
    definitions = json.loads((products / CLASS_EVIDENCE_PRODUCT_NAME).read_text(encoding='utf-8'))
    scripts = qualified_classes(definitions, lambda name: safe_path(products, name).read_bytes())
    receipt_sha256 = sha256_of_file(ledger.unit_step_directory(MOVER_CLASS_UNIT_KEY) / RECEIPT_RECORD_NAME)
    return MoverClassEvidence(receipt_sha256, definitions, MoverDefaults(definitions, scripts))


def mover_class_evidence(project_root, client):
    ledger = mover_class_defaults_ledger(project_root)
    inputs = locked_input_records(mover_class_packages(client))
    config = mover_class_defaults_config()
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    if ledger.is_sealed(MOVER_CLASS_UNIT_KEY, fingerprint):
        return sealed_class_evidence(ledger)
    products = ledger.begin(MOVER_CLASS_UNIT_KEY, fingerprint) / PRODUCTS_FOLDER_NAME
    products.mkdir()
    outputs = {}

    def save(name, value):
        path = safe_path(products, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
        outputs[name] = {'path': path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(value), 'bytes': len(value)}
        return name

    definitions, _ = load_mover_class_defaults(client, products, save)
    save(CLASS_EVIDENCE_PRODUCT_NAME, json_bytes(definitions))
    ledger.seal(MOVER_CLASS_UNIT_KEY, fingerprint, {'config': config, 'inputs': inputs, 'outputs': [outputs[name] for name in sorted(outputs)],
                                                    'gapRows': []})
    return sealed_class_evidence(ledger)


def load_mover_class_defaults(client, output, save):
    reader = DefaultReader(client, SourcePackages(client), output / '.work', save)
    reader.get(MOVER_CLASS)
    definitions = reader.definitions
    scripts = qualified_classes(definitions, lambda name: safe_path(output, name).read_bytes())
    for definition in definitions.values():
        source = definition['source']
        require(file_hash(safe_path(client, source['package'])) == source['packageSha256'], 'Source class package changed')
        raw = safe_path(output, definition['rawExport']).read_bytes()
        require(len(raw) == source['sourceBytes'], 'Class raw export length differs')
    return definitions, MoverDefaults(definitions, scripts)
