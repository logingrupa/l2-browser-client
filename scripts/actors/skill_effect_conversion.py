from pathlib import Path
import hashlib
import json
import subprocess
import sys

from collections import Counter

from actors.effect_bundle_packing import native_class_closure, pack_items_by_class_closure
from actors.emitter_feature_coverage import read_emitter_feature_rules, unported_emitter_feature_reasons
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, GAP_STATUS, TRANSIENT_FAILURES
from actors.npc_store_records import file_output_record
from actors.path_free_messages import path_free_reason
from actors.skill_binding_table import (DISPATCH_CANDIDATE_STATUSES, EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX, NO_EXACT_SKILLSOUND_ROW_REASON,
                                        SKILLS_GAP_ROW_STEP, VISUAL_ROOT_STATUS, DecodedSkillTables, emitter_class_root_outcome,
                                        representative_skill_binding, skill_binding_gap_rows, skill_bindings_by_visual_root,
                                        visual_roots_in_first_key_order)
from actors.skill_bundle_step_names import SKILL_EFFECT_ROOT_STEP, SOURCE_BUNDLE_FOLDER
from actors.skill_dispatch_class_conversion import (SKILL_DISPATCH_CLASS_BUNDLE_ID_PREFIX, SkillDispatchClassUnits,
                                                    skill_dispatch_class_bundle_id)
from actors.skill_unit_inventory import skill_root_key
from native_assets import UMODEL_SHA256, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_catalog.effects import UELIB_SHA256, SourcePackages, skill_actions
from native_catalog.ue2 import FormatError
from native_effect_bundle import MAX_CLASSES, migrate_effect_bundle
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import add_store_file, merge_catalog_slice_records, read_store_catalog, write_store
from native_store.gap_rows import write_gap_rows
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

SKILL_EFFECT_ROOT_ALGORITHM_VERSION = 1
SKILL_EFFECT_COMPONENT_SUFFIX = 'native-description-action'
SKILL_ROOT_BUNDLE_ID_PREFIX = 'interlude:skill-root:'
EMITTER_CLASS_COVERAGE_RELATIVE_PATH = 'recipes/actors/emitter-class-coverage.json'
EMITTER_CLASS_COVERAGE_FIELDS = frozenset({'schemaVersion', 'listVersion', 'simulated', 'source'})
EFFECT_STORE_FOLDER = 'effects'
STAGED_MANIFEST_NAME = 'manifest.json'
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


def skill_dispatch_class_component_record(effect_object, manifest_sha256):
    bundle_id = skill_dispatch_class_bundle_id(effect_object)
    return {'id': bundle_id, 'bundleId': bundle_id, 'manifest': f'/l2/{EFFECT_STORE_FOLDER}/{manifest_sha256}/{STAGED_MANIFEST_NAME}',
            'manifestSha256': manifest_sha256}


def read_staged_manifest(step_directory, manifest_sha256):
    return json.loads((step_directory / STAGED_EFFECTS_FOLDER / manifest_sha256 / STAGED_MANIFEST_NAME).read_bytes())


def staged_emitter_classes(manifest):
    return sorted({component['class'] for component in manifest['components']})


def staged_emitter_feature_gaps(manifest, feature_rules):
    return [{'emitter': component['object'], 'reason': reason} for component in manifest['components']
            for reason in unported_emitter_feature_reasons(component, feature_rules)]


def emitter_feature_gap_roots_by_reason(root_outcomes):
    roots_by_reason = Counter(reason for outcome in root_outcomes.values()
                              for reason in {gap['reason'] for gap in outcome.get('emitterFeatureGaps', [])})
    return dict(sorted(roots_by_reason.items()))


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
        self.emitter_feature_rules = read_emitter_feature_rules(project_root)
        self.packages = packages or SourcePackages(client_access.root)
        self.tool_identity = {'umodelSha256': UMODEL_SHA256, 'uelibSha256': UELIB_SHA256, 'converterSha256': implementation_hash(),
                              **{path: hashlib.sha256((self.project_root / path).read_bytes()).hexdigest() for path in TOOL_IDENTITY_FILES}}
        self.input_records = locked_input_records(sorted({self.tables.skill_table['source'], self.tables.sound_table['source']}))
        self.dispatch_classes = SkillDispatchClassUnits(self, self.tables.dispatch_candidates['document'], self.tables.binding_rows)

    def root_work(self, visual_root):
        representative = representative_skill_binding(self.bindings_by_root[visual_root])
        config = {'visualRoot': visual_root, 'representativeKey': representative['key'] if representative else None,
                  'tools': self.tool_identity}
        fingerprint = self.ledger.unit_fingerprint([record['sha256'] for record in self.input_records], config)
        return skill_root_key(visual_root), representative, config, fingerprint

    def sealed_bundle_outcome(self, ledger, unit_key, fingerprint, outcome_record_name):
        if not ledger.is_sealed(unit_key, fingerprint):
            return None
        step_directory = ledger.unit_step_directory(unit_key)
        return {**json.loads((step_directory / outcome_record_name).read_bytes()),
                'evidence': (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()}

    def sealed_root_outcome(self, visual_root):
        unit_key, _, _, fingerprint = self.root_work(visual_root)
        return self.sealed_bundle_outcome(self.ledger, unit_key, fingerprint, ROOT_OUTCOME_RECORD_NAME)

    def convert_bundle_unit(self, ledger, unit_key, config, fingerprint, outcome_record_name, bundle_outcome):
        if ledger.is_sealed(unit_key, fingerprint):
            return {'key': unit_key, 'status': 'skipped', 'reason': 'already sealed', 'cacheHit': True}
        step_directory = ledger.begin(unit_key, fingerprint)
        try:
            outcome = bundle_outcome(step_directory)
        except ReferenceClientLockError:
            raise
        except TRANSIENT_FAILURES as error:
            return {'key': unit_key, 'status': FAILED_STATUS, 'reason': path_free_reason(str(error), self.client_access.root, step_directory),
                    'cacheHit': False}
        outcome_path = step_directory / outcome_record_name
        outcome_path.write_bytes(canonical_json_bytes(outcome))
        staged_files = sorted(path for path in (step_directory / STAGED_EFFECTS_FOLDER).rglob('*') if path.is_file()) \
            if outcome['status'] == CONVERTED_ROOT_STATUS else []
        outputs = [file_output_record(ledger.lane_folder, path) for path in [outcome_path, *staged_files]]
        ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': self.input_records, 'outputs': outputs, 'gapRows': []})
        return {'key': unit_key, 'status': outcome['status'], 'reason': outcome['reason'], 'cacheHit': False}

    def convert_root(self, visual_root):
        unit_key, representative, config, fingerprint = self.root_work(visual_root)
        return self.convert_bundle_unit(self.ledger, unit_key, config, fingerprint, ROOT_OUTCOME_RECORD_NAME,
                                        lambda step_directory: self.root_conversion_outcome(visual_root, representative, step_directory))

    def gap_outcome(self, reason):
        return {'status': GAP_STATUS, 'reason': reason, 'emitterClasses': [], 'manifestSha256': None}

    def root_conversion_outcome(self, visual_root, representative, step_directory):
        if representative is None:
            return self.gap_outcome(NO_EXACT_SKILLSOUND_ROW_REASON)
        recipe = {'schemaVersion': 1, 'id': skill_root_bundle_id(visual_root), 'skillId': representative['skillId'],
                  'level': representative['level']}
        return self.migrated_bundle_outcome(recipe, visual_root, lambda root: skill_root_class_closure(self.packages, root), step_directory)

    def migrated_bundle_outcome(self, recipe, closure_item, closure_of, step_directory):
        try:
            limit_reason = class_limit_reason(closure_item, closure_of)
            if limit_reason is not None:
                return self.gap_outcome(limit_reason)
            migrate_effect_bundle(self.client_access.root, recipe, step_directory / SOURCE_BUNDLE_FOLDER,
                                  self.ledger.lane_folder / CONVERTER_WORK_FOLDER)
            manifest_sha256 = stage_effect_bundle(self.project_root, step_directory / SOURCE_BUNDLE_FOLDER,
                                                  step_directory / STAGED_EFFECTS_FOLDER)
        except (FormatError, SkillEffectConversionError) as error:
            message = str(error)
            if DEFAULT_READER_CLASS_LIMIT_MESSAGE in message:
                return self.gap_outcome(f'{EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX}{MAX_CLASSES + 1}')
            return self.gap_outcome(CONVERTER_REFUSED_REASON_PREFIX + path_free_reason(message, self.client_access.root, step_directory))
        manifest = read_staged_manifest(step_directory, manifest_sha256)
        return {'status': CONVERTED_ROOT_STATUS, 'reason': None, 'emitterClasses': staged_emitter_classes(manifest),
                'manifestSha256': manifest_sha256}

    def published_bundle_outcome(self, step_directory, sealed):
        if sealed['status'] != CONVERTED_ROOT_STATUS:
            return {**sealed, 'converted': False}
        manifest = read_staged_manifest(step_directory, sealed['manifestSha256'])
        unbound_reason = unbound_simulated_component_reason(manifest, self.simulated_emitter_classes)
        if unbound_reason is not None:
            return {**sealed, 'status': GAP_STATUS, 'reason': unbound_reason, 'converted': False}
        status, reason = emitter_class_root_outcome(sealed['emitterClasses'], self.simulated_emitter_classes)
        feature_gaps = staged_emitter_feature_gaps(manifest, self.emitter_feature_rules)
        if status != GAP_STATUS and feature_gaps:
            status, reason = GAP_STATUS, feature_gaps[0]['reason']
        return {**sealed, 'status': status, 'reason': reason, 'converted': True, 'emitterFeatureGaps': feature_gaps}

    def root_outcomes(self):
        outcomes = {}
        for visual_root in self.bindings_by_root:
            sealed = self.sealed_root_outcome(visual_root)
            if sealed is not None:
                outcomes[visual_root] = self.published_bundle_outcome(self.ledger.unit_step_directory(skill_root_key(visual_root)), sealed)
        return outcomes

    def write_gap_rows(self, root_outcomes):
        rows = skill_binding_gap_rows(self.tables.binding_rows, root_outcomes, self.tables.skill_table_identity)
        write_gap_rows(self.project_root, self.ledger.lane_name, SKILLS_GAP_ROW_STEP, rows)
        return rows

    def write_store_records(self, root_outcomes, class_outcomes):
        catalog, before = read_store_catalog(self.store_root)
        catalog['effectComponents'] = [record for record in catalog.get('effectComponents', [])
                                       if not str(record.get('bundleId', '')).startswith((SKILL_ROOT_BUNDLE_ID_PREFIX,
                                                                                         SKILL_DISPATCH_CLASS_BUNDLE_ID_PREFIX))]
        files, records = {}, []
        for visual_root, outcome in sorted(root_outcomes.items()):
            if not outcome['converted']:
                continue
            staged_root = self.ledger.unit_step_directory(skill_root_key(visual_root)) / STAGED_EFFECTS_FOLDER / outcome['manifestSha256']
            add_staged_effect_store_files(files, staged_root, outcome['manifestSha256'])
            records += [skill_effect_component_record(binding['skillId'], binding['level'], visual_root, outcome['manifestSha256'])
                        for binding in self.bindings_by_root[visual_root]]
        for effect_object, outcome in sorted(class_outcomes.items()):
            if not outcome['converted']:
                continue
            unit_key = self.dispatch_classes.class_work(effect_object)[0]
            staged_root = self.dispatch_classes.ledger.unit_step_directory(unit_key) / STAGED_EFFECTS_FOLDER / outcome['manifestSha256']
            add_staged_effect_store_files(files, staged_root, outcome['manifestSha256'])
            records.append(skill_dispatch_class_component_record(effect_object, outcome['manifestSha256']))
        if records:
            catalog = merge_catalog_slice_records(catalog, 'effectComponents', records,
                                                  len(self.tables.binding_rows) + len(self.dispatch_classes.classes))
        catalog['effectComponents'] = sorted(catalog.get('effectComponents', []), key=lambda record: record['id'])
        after = json_bytes(catalog)
        return write_store(self.store_root, files, before, after)

    def finish(self):
        root_outcomes = self.root_outcomes()
        class_outcomes = self.dispatch_classes.class_outcomes()
        gap_rows = self.write_gap_rows(root_outcomes)
        store = self.write_store_records(root_outcomes, class_outcomes)
        return {'store': store, 'gapRowStatuses': {status: sum(1 for row in gap_rows if row['status'] == status)
                                                   for status in sorted({row['status'] for row in gap_rows})},
                'emitterFeatureGapRoots': emitter_feature_gap_roots_by_reason(root_outcomes)}


def binding_of_skill(run, skill_id, level):
    matches = [row for row in run.tables.binding_rows if row['skillId'] == skill_id and row['level'] == level]
    if len(matches) != 1:
        raise SkillEffectConversionError(f'skillgrp has no row for skill {skill_id} level {level}')
    return matches[0]


def candidate_classes_of_binding(binding):
    return sorted({effect_object for entry in binding['dispatchCandidates'] for effect_object in entry['candidateClasses']})


def convert_skill(run, skill_id, level):
    binding = binding_of_skill(run, skill_id, level)
    if binding['status'] == VISUAL_ROOT_STATUS:
        outcomes = [run.convert_root(binding['visualRoot'])]
    elif binding['status'] in DISPATCH_CANDIDATE_STATUSES:
        outcomes = [run.dispatch_classes.convert_class(effect_object) for effect_object in candidate_classes_of_binding(binding)]
    else:
        outcomes = [{'key': binding['key'], 'status': binding['status'], 'reason': binding['reason'], 'cacheHit': False}]
    return outcomes, run.finish()


def pending_skill_units(run):
    for visual_root in visual_roots_in_first_key_order(run.tables.binding_rows):
        unit_key, _, _, fingerprint = run.root_work(visual_root)
        yield 'root', run.ledger.is_sealed(unit_key, fingerprint), lambda visual_root=visual_root: run.convert_root(visual_root)
    for effect_object in run.dispatch_classes.classes_in_first_row_order():
        yield ('dispatchClass', run.dispatch_classes.is_sealed(effect_object),
               lambda effect_object=effect_object: run.dispatch_classes.convert_class(effect_object))


def convert_skill_batch_slice(run, limit, preflight):
    outcomes, converted, already_sealed = [], Counter(), Counter()
    for unit_kind, sealed, convert in pending_skill_units(run):
        if len(outcomes) >= limit:
            break
        if sealed:
            already_sealed[unit_kind] += 1
            continue
        preflight()
        outcomes.append(convert())
        converted[unit_kind] += 1
    return outcomes, {**run.finish(), 'convertedRoots': converted['root'], 'alreadySealedRoots': already_sealed['root'],
                      'convertedDispatchClasses': converted['dispatchClass'], 'alreadySealedDispatchClasses': already_sealed['dispatchClass']}


def printed_skill_outcome(outcome):
    return {key: outcome[key] for key in ('key', 'status', 'reason', 'cacheHit')}


def skill_outcomes_failed(outcomes):
    return any(outcome['status'] == FAILED_STATUS for outcome in outcomes)

