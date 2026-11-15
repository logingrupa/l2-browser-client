from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH = 'recipes/actors/skill-dispatch-candidates.json'
SKILL_DISPATCH_CANDIDATES_KIND = 'skill-dispatch-candidates'
SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON = 'skill-dispatch-candidate-runtime-unresolved'
SKILL_DISPATCH_CLASS_UNIT_KIND = 'skill-dispatch-class'
ANIMATION_NOTIFY_STAGE = 'animation-notify'
ANIMATION_NOTIFY_ROUTE = 'reviewed-animation-notify-candidates'
NO_ENTRY_GATE = 'none'
CANDIDATE_CAST_STYLE_GATES = {'transient': 0, 'union-target': 12}
ENTRY_GATES = (NO_ENTRY_GATE, *sorted(CANDIDATE_CAST_STYLE_GATES))
ENGINE_FIELDS = {'path', 'sha256', 'imageBase'}
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'engine', 'replay', 'sources', 'stages', 'tables', 'dispatches', 'helperRoutes', 'entryGates',
                   'classes', 'bindings', 'animationNotify'}
CLASS_FIELDS = {'effectObject', 'packageSha256', 'nativeSuperClass'}
BINDING_FIELDS = {'index', 'stage', 'skillId', 'levelRuns', 'dispatchId', 'routeId', 'tableId', 'dispatchKind', 'selectorIndex', 'caseIndex',
                  'caseVA', 'selectorValue', 'resolvedCaseVA', 'helperCaseVA', 'levelTable', 'effectObject', 'classPushVA', 'classLiteralVA',
                  'classReference', 'entryGate', 'status'}
ANIMATION_NOTIFY_FIELDS = {'sourceSha256', 'route', 'verification', 'classes', 'bindings'}
ANIMATION_NOTIFY_BINDING_FIELDS = {'skillId', 'level', 'stage', 'status', 'playbackRecipeStatus', 'conditions', 'routes'}
SHA256_HEX = re.compile(r'[0-9a-f]{64}')
HEX_ADDRESS = re.compile(r'0x[0-9a-f]{8}')
QUALIFIED_CLASS_NAME = re.compile(r'\w+(?:\.\w+)+')


class SkillDispatchCandidatesError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise SkillDispatchCandidatesError(f'{SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH}: {message}')


def refuse_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    require(len(keys) == len(set(keys)), f'repeats a JSON key in {sorted(keys)}')
    return dict(pairs)


def refuse_non_finite_number(value):
    raise SkillDispatchCandidatesError(f'{SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH}: holds the non-finite number {value}')


def read_strict_json_bytes(payload, label):
    try:
        return json.loads(payload.decode('utf-8'), object_pairs_hook=refuse_duplicate_keys, parse_constant=refuse_non_finite_number)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SkillDispatchCandidatesError(f'{label} is not strict UTF-8 JSON: {error}') from error


def inclusive_level_runs(levels):
    runs = []
    for level in sorted(set(levels)):
        if runs and runs[-1][1] + 1 == level:
            runs[-1][1] = level
        else:
            runs.append([level, level])
    return runs


def levels_of_runs(runs):
    return [level for low, high in runs for level in range(low, high + 1)]


def skill_dispatch_class_key(effect_object):
    return f'{SKILL_DISPATCH_CLASS_UNIT_KIND}:{effect_object}'


def require_locked_engine(engine, lock_path):
    require(isinstance(engine, dict) and set(engine) == ENGINE_FIELDS and HEX_ADDRESS.fullmatch(str(engine['imageBase'])),
            'engine must hold path, sha256 and imageBase')
    record = read_reference_client_lock(Path(lock_path)).record(engine['path'])
    require(record is not None and record['class'] == 'equal' and record['eSha256'] == record['importaSha256'] == engine['sha256'],
            f'engine pin {engine["sha256"]} differs from the {str(engine["path"]).casefold()} entry of the reference client lock')


def require_binding(binding, class_names):
    require(isinstance(binding, dict) and set(binding) == BINDING_FIELDS, f'binding fields must be {sorted(BINDING_FIELDS)}')
    require(binding['effectObject'] in class_names, f'binding {binding["index"]} names {binding["effectObject"]}, which classes does not list')
    require(binding['entryGate'] in ENTRY_GATES, f'binding {binding["index"]} names the entry gate {binding["entryGate"]!r}')
    require(type(binding['skillId']) is int and isinstance(binding['levelRuns'], list) and binding['levelRuns']
            and all(type(low) is int and type(high) is int and 1 <= low <= high for low, high in binding['levelRuns']),
            f'binding {binding["index"]} needs a skill id and inclusive level runs')
    require(HEX_ADDRESS.fullmatch(str(binding['caseVA'])), f'binding {binding["index"]} has no case VA')


def require_class_records(classes, label):
    require(isinstance(classes, list) and all(isinstance(record, dict) and set(record) == CLASS_FIELDS
                                              and QUALIFIED_CLASS_NAME.fullmatch(str(record['effectObject']))
                                              and SHA256_HEX.fullmatch(str(record['packageSha256'])) for record in classes),
            f'{label} must be {sorted(CLASS_FIELDS)} records with a qualified name and a package SHA-256')
    class_names = {record['effectObject'] for record in classes}
    require(len(class_names) == len(classes), f'{label} repeat a class')
    return class_names


def require_animation_notify(section, dispatch_class_names):
    require(isinstance(section, dict) and set(section) == ANIMATION_NOTIFY_FIELDS and section['route'] == ANIMATION_NOTIFY_ROUTE,
            f'animationNotify fields must be {sorted(ANIMATION_NOTIFY_FIELDS)} with route {ANIMATION_NOTIFY_ROUTE}')
    class_names = require_class_records(section['classes'], 'animationNotify classes')
    require(not class_names & dispatch_class_names, 'animationNotify classes repeat a dispatch class')
    for binding in section['bindings']:
        require(isinstance(binding, dict) and set(binding) == ANIMATION_NOTIFY_BINDING_FIELDS and binding['stage'] == ANIMATION_NOTIFY_STAGE,
                f'animation notify binding fields must be {sorted(ANIMATION_NOTIFY_BINDING_FIELDS)}')
        effect_objects = [effect['effectObject'] for route in binding['routes'] for effect in route['effects']]
        require(effect_objects and set(effect_objects) <= class_names,
                f'animation notify binding {binding["skillId"]}/{binding["level"]} names a class that animationNotify classes does not list')


def require_skill_dispatch_candidates(document, lock_path):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == SKILL_DISPATCH_CANDIDATES_KIND,
            f'needs schemaVersion 1 and kind {SKILL_DISPATCH_CANDIDATES_KIND}')
    require_locked_engine(document['engine'], lock_path)
    class_names = require_class_records(document['classes'], 'classes')
    require(isinstance(document['bindings'], list) and document['bindings'], 'needs a binding list')
    for binding in document['bindings']:
        require_binding(binding, class_names)
    require_animation_notify(document['animationNotify'], class_names)
    return document


def read_skill_dispatch_candidates(project_root, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    path = Path(project_root) / SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH
    require(path.is_file(), 'is missing; run scripts/actors/skill_dispatch_candidate_recipe.py')
    payload = path.read_bytes()
    document = require_skill_dispatch_candidates(read_strict_json_bytes(payload, SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH), lock_path)
    return {'path': SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(), 'document': document}


def dispatch_candidates_by_skill_key(document):
    classes_by_row_and_case = defaultdict(set)
    for binding in document['bindings']:
        case = (binding['stage'], binding['dispatchKind'], binding['caseIndex'], binding['caseVA'], binding['entryGate'])
        for level in levels_of_runs(binding['levelRuns']):
            classes_by_row_and_case[(binding['skillId'], level), case].add(binding['effectObject'])
    candidates = defaultdict(list)
    for (row, (stage, dispatch_kind, case_index, case_va, entry_gate)), classes in sorted(classes_by_row_and_case.items(), key=repr):
        candidates[row].append({'stage': stage, 'case': {'dispatchKind': dispatch_kind, 'caseIndex': case_index, 'caseVA': case_va},
                                'candidateClasses': sorted(classes), 'entryGate': entry_gate})
    return dict(candidates)


def animation_notify_candidates_by_skill_key(document):
    candidates = {}
    for binding in document['animationNotify']['bindings']:
        routes = [{'npcId': route['npcId'], 'sequence': route['sequence']} for route in binding['routes']]
        classes = sorted({effect['effectObject'] for route in binding['routes'] for effect in route['effects']})
        candidates[(binding['skillId'], binding['level'])] = [{'stage': ANIMATION_NOTIFY_STAGE, 'notifyRoutes': routes, 'candidateClasses': classes}]
    return candidates


def candidate_class_records(document):
    return sorted(document['classes'] + document['animationNotify']['classes'], key=lambda record: record['effectObject'])


def candidate_rows_by_class(document):
    rows_by_class = defaultdict(set)
    for by_skill_key in (dispatch_candidates_by_skill_key(document), animation_notify_candidates_by_skill_key(document)):
        for row, entries in by_skill_key.items():
            for entry in entries:
                for effect_object in entry['candidateClasses']:
                    rows_by_class[effect_object].add(row)
    return {effect_object: sorted(rows) for effect_object, rows in sorted(rows_by_class.items())}


def dispatch_candidate_census(candidates):
    document = candidates['document']
    return {'recipe': candidates['path'], 'recipeSha256': candidates['sha256'], 'bindings': len(document['bindings']),
            'animationNotifyBindings': len(document['animationNotify']['bindings']), 'classes': len(document['classes']),
            'animationNotifyClasses': len(document['animationNotify']['classes']),
            'recipeRows': len(dispatch_candidates_by_skill_key(document)),
            'animationNotifyRows': len(animation_notify_candidates_by_skill_key(document)),
            'gatesByBinding': dict(sorted(Counter(binding['entryGate'] for binding in document['bindings']).items()))}
