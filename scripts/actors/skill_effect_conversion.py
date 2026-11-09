from pathlib import Path
import hashlib
import json
import subprocess
import sys

from actors.effect_bundle_packing import native_class_closure, pack_items_by_class_closure
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, GAP_STATUS, TRANSIENT_FAILURES
from actors.npc_store_records import file_output_record
from actors.skill_binding_table import (EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX, NO_EXACT_SKILLSOUND_ROW_REASON, SKILLS_GAP_ROW_STEP,
                                        VISUAL_ROOT_STATUS, DecodedSkillTables, emitter_class_root_outcome, representative_skill_binding,
                                        skill_binding_gap_rows, skill_bindings_by_visual_root, visual_roots_in_first_key_order)
from actors.skill_unit_inventory import skill_root_key
from native_assets import UMODEL_SHA256, implementation_hash
from native_catalog.effects import UELIB_SHA256, SourcePackages, skill_actions
from native_catalog.ue2 import FormatError
from native_effect_bundle import MAX_CLASSES, migrate_effect_bundle
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import add_store_file, merge_catalog_slice, read_store_catalog, write_store
from native_store.gap_rows import write_gap_rows
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

SKILL_EFFECT_ROOT_STEP = 'skill-effect-root'
SKILL_EFFECT_ROOT_ALGORITHM_VERSION = 1
SKILL_EFFECT_COMPONENT_SUFFIX = 'native-description-action'
SKILL_ROOT_BUNDLE_ID_PREFIX = 'interlude:skill-root:'
EMITTER_CLASS_COVERAGE_RELATIVE_PATH = 'recipes/actors/emitter-class-coverage.json'
EMITTER_CLASS_COVERAGE_FIELDS = frozenset({'schemaVersion', 'listVersion', 'simulated', 'source'})
EFFECT_STORE_FOLDER = 'effects'
STAGED_MANIFEST_NAME = 'manifest.json'
SOURCE_BUNDLE_FOLDER = 'bundle'
STAGED_EFFECTS_FOLDER = 'effects'
ROOT_OUTCOME_RECORD_NAME = 'root-outcome.json'
CONVERTER_WORK_FOLDER = 'converter'
CONVERTED_ROOT_STATUS = 'converted'
MAXIMUM_SKILL_ROOT_CLASS_CLOSURE = MAX_CLASSES
DEFAULT_READER_CLASS_LIMIT_MESSAGE = 'Native class inheritance/dependency limit exceeded'
STAGE_SCRIPT_RELATIVE_PATH = 'scripts/stage-native-effect.mjs'
TOOL_IDENTITY_FILES = ('scripts/native_effect_bundle.py', STAGE_SCRIPT_RELATIVE_PATH, 'scripts/native_assets_lib/effect_readiness.py')
STAGE_TIMEOUT_SECONDS = 600


class SkillEffectConversionError(ValueError):
    pass


def skill_effect_component_id(skill_id, level):
    return f'interlude:skill:{skill_id}:level:{level}:{SKILL_EFFECT_COMPONENT_SUFFIX}'


def skill_root_bundle_id(visual_root):
    return SKILL_ROOT_BUNDLE_ID_PREFIX + visual_root


def read_simulated_emitter_classes(project_root):
    path = Path(project_root) / EMITTER_CLASS_COVERAGE_RELATIVE_PATH
    document = json.loads(path.read_text(encoding='utf-8'))
    if not (isinstance(document, dict) and set(document) == EMITTER_CLASS_COVERAGE_FIELDS and document['schemaVersion'] == 1
            and type(document['listVersion']) is int and document['listVersion'] >= 1 and isinstance(document['simulated'], list)
            and all(isinstance(name, str) and name.startswith('Engine.') for name in document['simulated'])
            and len(set(document['simulated'])) == len(document['simulated'])):
        raise SkillEffectConversionError(f'{EMITTER_CLASS_COVERAGE_RELATIVE_PATH} must be {{schemaVersion 1, listVersion, simulated, source}} '
                                         'with unique Engine emitter class names')
    return frozenset(document['simulated'])


def skill_root_class_closure(packages, visual_root):
    root, package, item = packages.resolve(visual_root, 'SkillVisualEffect')
    stages, _ = skill_actions(package, item)
    closure = set(native_class_closure(packages, item['classObject']))
    for stage in stages:
        closure.update(native_class_closure(packages, stage['class']))
        effect_class = stage['properties'].get('EffectClass')
        if isinstance(effect_class, dict) and effect_class.get('object'):
            closure.update(native_class_closure(packages, effect_class['object']))
    return tuple(sorted(closure))


def class_limit_reason(visual_root, closure_of):
    packing = pack_items_by_class_closure([visual_root], closure_of, MAXIMUM_SKILL_ROOT_CLASS_CLOSURE + 1, 1)
    if packing.over_limit_items:
        return f'{EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX}{len(closure_of(visual_root))}'
    return None


def path_free_reason(message, *roots):
    for root in roots:
        for spelling in {str(root), Path(root).as_posix()}:
            message = message.replace(spelling, '<path>')
    return ' '.join(message.split())


def stage_effect_bundle(project_root, bundle_root, effects_root):
    command = ['node', str(Path(project_root) / STAGE_SCRIPT_RELATIVE_PATH), '--bundle', str(bundle_root), '--output', str(effects_root),
               '--python', sys.executable]
    run = subprocess.run(command, capture_output=True, text=True, timeout=STAGE_TIMEOUT_SECONDS, stdin=subprocess.DEVNULL, check=False)
    if run.returncode:
        raise SkillEffectConversionError(run.stderr.strip().splitlines()[-1] if run.stderr.strip() else 'native effect stage failed')
    return json.loads(run.stdout)['manifestSha256']


def add_staged_effect_store_files(files, staged_root, manifest_sha256):
    for path in sorted(staged_root.rglob('*')):
        if path.is_file():
            add_store_file(files, f'{EFFECT_STORE_FOLDER}/{manifest_sha256}/{path.relative_to(staged_root).as_posix()}', path.read_bytes())


def skill_effect_component_record(skill_id, level, visual_root, manifest_sha256):
    return {'id': skill_effect_component_id(skill_id, level), 'bundleId': skill_root_bundle_id(visual_root),
            'manifest': f'/l2/{EFFECT_STORE_FOLDER}/{manifest_sha256}/{STAGED_MANIFEST_NAME}', 'manifestSha256': manifest_sha256}


def staged_emitter_classes(manifest):
    return sorted({component['class'] for component in manifest['components']})


def unbound_simulated_component_reason(manifest, simulated_emitter_classes):
    for component in manifest['components']:
        if component['class'] not in simulated_emitter_classes:
            continue
        bindings = component['bindings']
        bound = bindings['texture'] if component['class'] == 'Engine.SpriteEmitter' else bindings['mesh'] and bindings['primitiveMaterials']
        if not bound:
            return f'{CONVERTER_REFUSED_REASON_PREFIX}{component["object"]} has no converted resource'
    return None


class SkillEffectConversionRun:
    def __init__(self, project_root, client_access, store_root, ledger_root, packages=None):
        self.project_root, self.client_access, self.store_root = Path(project_root), client_access, Path(store_root)
        self.tables = DecodedSkillTables(project_root, client_access.root)
        self.bindings_by_root = skill_bindings_by_visual_root(self.tables.binding_rows)
        self.ledger = UnitLedger(ledger_root, SKILL_EFFECT_ROOT_STEP, SKILL_EFFECT_ROOT_ALGORITHM_VERSION)
        self.simulated_emitter_classes = read_simulated_emitter_classes(project_root)
        self.packages = packages or SourcePackages(client_access.root)
        self.tool_identity = {'umodelSha256': UMODEL_SHA256, 'uelibSha256': UELIB_SHA256, 'converterSha256': implementation_hash(),
                              **{path: hashlib.sha256((self.project_root / path).read_bytes()).hexdigest() for path in TOOL_IDENTITY_FILES}}
        self.input_records = locked_input_records(sorted({self.tables.skill_table['source'], self.tables.sound_table['source']}))

    def root_work(self, visual_root):
        representative = representative_skill_binding(self.bindings_by_root[visual_root])
        config = {'visualRoot': visual_root, 'representativeKey': representative['key'] if representative else None,
                  'tools': self.tool_identity}
        fingerprint = self.ledger.unit_fingerprint([record['sha256'] for record in self.input_records], config)
        return skill_root_key(visual_root), representative, config, fingerprint

    def sealed_root_outcome(self, visual_root):
        unit_key, _, _, fingerprint = self.root_work(visual_root)
        if not self.ledger.is_sealed(unit_key, fingerprint):
            return None
        step_directory = self.ledger.unit_step_directory(unit_key)
        return {**json.loads((step_directory / ROOT_OUTCOME_RECORD_NAME).read_bytes()),
                'evidence': (step_directory / RECEIPT_RECORD_NAME).relative_to(self.ledger.lane_folder).as_posix()}

    def convert_root(self, visual_root):
        unit_key, representative, config, fingerprint = self.root_work(visual_root)
        if self.ledger.is_sealed(unit_key, fingerprint):
            return {'key': unit_key, 'status': 'skipped', 'reason': 'already sealed', 'cacheHit': True}
        step_directory = self.ledger.begin(unit_key, fingerprint)
        try:
            outcome = self.root_conversion_outcome(visual_root, representative, step_directory)
        except ReferenceClientLockError:
            raise
        except TRANSIENT_FAILURES as error:
            return {'key': unit_key, 'status': FAILED_STATUS, 'reason': path_free_reason(str(error), self.client_access.root, step_directory),
                    'cacheHit': False}
        outcome_path = step_directory / ROOT_OUTCOME_RECORD_NAME
        outcome_path.write_bytes(canonical_json_bytes(outcome))
        staged_files = sorted(path for path in (step_directory / STAGED_EFFECTS_FOLDER).rglob('*') if path.is_file()) \
            if outcome['status'] == CONVERTED_ROOT_STATUS else []
        outputs = [file_output_record(self.ledger.lane_folder, path) for path in [outcome_path, *staged_files]]
        self.ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': self.input_records, 'outputs': outputs, 'gapRows': []})
        return {'key': unit_key, 'status': outcome['status'], 'reason': outcome['reason'], 'cacheHit': False}

    def root_conversion_outcome(self, visual_root, representative, step_directory):
        if representative is None:
            return {'status': GAP_STATUS, 'reason': NO_EXACT_SKILLSOUND_ROW_REASON, 'emitterClasses': [], 'manifestSha256': None}
        try:
            limit_reason = class_limit_reason(visual_root, lambda root: skill_root_class_closure(self.packages, root))
            if limit_reason is not None:
                return {'status': GAP_STATUS, 'reason': limit_reason, 'emitterClasses': [], 'manifestSha256': None}
            recipe = {'schemaVersion': 1, 'id': skill_root_bundle_id(visual_root), 'skillId': representative['skillId'],
                      'level': representative['level']}
            migrate_effect_bundle(self.client_access.root, recipe, step_directory / SOURCE_BUNDLE_FOLDER,
                                  self.ledger.lane_folder / CONVERTER_WORK_FOLDER)
            manifest_sha256 = stage_effect_bundle(self.project_root, step_directory / SOURCE_BUNDLE_FOLDER,
                                                  step_directory / STAGED_EFFECTS_FOLDER)
        except (FormatError, SkillEffectConversionError) as error:
            message = str(error)
            if DEFAULT_READER_CLASS_LIMIT_MESSAGE in message:
                return {'status': GAP_STATUS, 'reason': f'{EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX}{MAX_CLASSES + 1}', 'emitterClasses': [],
                        'manifestSha256': None}
            reason = CONVERTER_REFUSED_REASON_PREFIX + path_free_reason(message, self.client_access.root, step_directory)
            return {'status': GAP_STATUS, 'reason': reason, 'emitterClasses': [], 'manifestSha256': None}
        manifest = json.loads((step_directory / STAGED_EFFECTS_FOLDER / manifest_sha256 / STAGED_MANIFEST_NAME).read_bytes())
        unbound_reason = unbound_simulated_component_reason(manifest, self.simulated_emitter_classes)
        if unbound_reason is not None:
            return {'status': GAP_STATUS, 'reason': unbound_reason, 'emitterClasses': staged_emitter_classes(manifest), 'manifestSha256': None}
        return {'status': CONVERTED_ROOT_STATUS, 'reason': None, 'emitterClasses': staged_emitter_classes(manifest),
                'manifestSha256': manifest_sha256}

    def root_outcomes(self):
        outcomes = {}
        for visual_root in self.bindings_by_root:
            sealed = self.sealed_root_outcome(visual_root)
            if sealed is None:
                continue
            if sealed['status'] == CONVERTED_ROOT_STATUS:
                status, reason = emitter_class_root_outcome(sealed['emitterClasses'], self.simulated_emitter_classes)
                outcomes[visual_root] = {**sealed, 'status': status, 'reason': reason, 'converted': True}
            else:
                outcomes[visual_root] = {**sealed, 'converted': False}
        return outcomes

    def write_gap_rows(self, root_outcomes):
        rows = skill_binding_gap_rows(self.tables.binding_rows, root_outcomes, self.tables.skill_table_identity)
        write_gap_rows(self.project_root, self.ledger.lane_name, SKILLS_GAP_ROW_STEP, rows)
        return rows

    def write_store_records(self, root_outcomes):
        catalog, before = read_store_catalog(self.store_root)
        catalog['effectComponents'] = [record for record in catalog.get('effectComponents', [])
                                       if not str(record.get('bundleId', '')).startswith(SKILL_ROOT_BUNDLE_ID_PREFIX)]
        files = {}
        for visual_root, outcome in sorted(root_outcomes.items()):
            if not outcome['converted']:
                continue
            staged_root = self.ledger.unit_step_directory(skill_root_key(visual_root)) / STAGED_EFFECTS_FOLDER / outcome['manifestSha256']
            add_staged_effect_store_files(files, staged_root, outcome['manifestSha256'])
            for binding in self.bindings_by_root[visual_root]:
                record = skill_effect_component_record(binding['skillId'], binding['level'], visual_root, outcome['manifestSha256'])
                catalog = merge_catalog_slice(catalog, 'effectComponents', record, len(self.tables.binding_rows))
        catalog['effectComponents'] = sorted(catalog.get('effectComponents', []), key=lambda record: record['id'])
        after = canonical_json_bytes(catalog)
        return write_store(self.store_root, files, before, after)

    def finish(self):
        root_outcomes = self.root_outcomes()
        gap_rows = self.write_gap_rows(root_outcomes)
        store = self.write_store_records(root_outcomes)
        return {'store': store, 'gapRowStatuses': {status: sum(1 for row in gap_rows if row['status'] == status)
                                                   for status in sorted({row['status'] for row in gap_rows})}}


def binding_of_skill(run, skill_id, level):
    matches = [row for row in run.tables.binding_rows if row['skillId'] == skill_id and row['level'] == level]
    if len(matches) != 1:
        raise SkillEffectConversionError(f'skillgrp has no row for skill {skill_id} level {level}')
    return matches[0]


def convert_skill(run, skill_id, level):
    binding = binding_of_skill(run, skill_id, level)
    outcomes = []
    if binding['status'] == VISUAL_ROOT_STATUS:
        outcomes.append(run.convert_root(binding['visualRoot']))
    else:
        outcomes.append({'key': binding['key'], 'status': binding['status'], 'reason': binding['reason'], 'cacheHit': False})
    return outcomes, run.finish()


def convert_skill_batch_slice(run, limit, preflight):
    outcomes, already_sealed = [], 0
    for visual_root in visual_roots_in_first_key_order(run.tables.binding_rows):
        if len(outcomes) >= limit:
            break
        unit_key, _, _, fingerprint = run.root_work(visual_root)
        if run.ledger.is_sealed(unit_key, fingerprint):
            already_sealed += 1
            continue
        preflight()
        outcomes.append(run.convert_root(visual_root))
    return outcomes, {**run.finish(), 'convertedRoots': len(outcomes), 'alreadySealedRoots': already_sealed}


def printed_skill_outcome(outcome):
    return {key: outcome[key] for key in ('key', 'status', 'reason', 'cacheHit')}


def skill_outcomes_failed(outcomes):
    return any(outcome['status'] == FAILED_STATUS for outcome in outcomes)

